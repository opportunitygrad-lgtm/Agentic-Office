import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { effectivePermissions } from "@aibos/access-core";
import {
  acceptInvitation,
  authenticate,
  countUsers,
  createSession,
  getUserDTO,
  listCompanies,
  peekAuthToken,
  recordAuditEvent,
  requestPasswordReset,
  resetPassword,
  revokeSession,
  sessionRef,
  type Session,
  type User,
} from "@aibos/db";
import {
  SESSION_COOKIE,
  acceptInvitationSchema,
  loginSchema,
  passwordResetConfirmSchema,
  passwordResetRequestSchema,
  tokenSchema,
  type MeDTO,
} from "@aibos/shared";
import { LIMITS } from "./throttle";
import {
  TooManyRequestsError,
  actorFrom,
  clearSessionCookie,
  principalOf,
  scopeFor,
} from "./security";

export const authRoutes: FastifyPluginAsync = async (app) => {
  const { db } = app.deps.db;
  const throttle = app.deps.throttle;
  const secure = app.deps.cookieSecure;

  async function limit(key: string, rule: { max: number; window: number }) {
    if ((await throttle.hit(key, rule.window)) > rule.max) throw new TooManyRequestsError();
  }

  function setSessionCookie(reply: FastifyReply, token: string, session: Session) {
    void reply.setCookie(SESSION_COOKIE, token, {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure,
      expires: session.absoluteExpiresAt,
    });
  }

  async function startSession(req: FastifyRequest, reply: FastifyReply, user: User) {
    // Session rotation: any session presented with this login is revoked.
    if (req.principal) await revokeSession(db, req.principal.session.id, "rotated");
    const { token, session } = await createSession(db, user.id, {
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });
    setSessionCookie(reply, token, session);
    return session;
  }

  app.get("/auth/status", async () => ({ bootstrapRequired: (await countUsers(db)) === 0 }));

  app.post("/auth/login", async (req, reply) => {
    const body = loginSchema.parse(req.body);
    await limit(`login:ip:${req.ip}`, LIMITS.loginPerIp);
    const emailKey = `login:email:${body.email}`;
    if ((await throttle.peek(emailKey)) >= LIMITS.loginFailuresPerEmail.max)
      throw new TooManyRequestsError();

    const result = await authenticate(db, body.email, body.password);
    const meta = {
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"]?.slice(0, 500),
      requestId: req.id,
    };
    if (!result.ok && result.reason === "invalid_credentials") {
      await throttle.hit(emailKey, LIMITS.loginFailuresPerEmail.window);
      await recordAuditEvent(db, {
        actorType: "anonymous",
        ...meta,
        resourceType: "user",
        resourceId: result.user?.id,
        action: "auth.login_failed",
        description: "Failed sign-in attempt",
        outcome: "failure",
        metadata: { email: body.email },
      });
      return reply
        .status(401)
        .send({ error: { code: "invalid_credentials", message: "Invalid email or password" } });
    }
    if (!result.ok) {
      await recordAuditEvent(db, {
        actorType: "human",
        actorUser: result.user.email,
        actorUserId: result.user.id,
        ...meta,
        resourceType: "user",
        resourceId: result.user.id,
        action: "auth.login_blocked",
        description: `Sign-in blocked: account ${result.user.status}`,
        outcome: "failure",
      });
      return reply.status(403).send({
        error: {
          code: "account_disabled",
          message: "This account is disabled. Contact an administrator.",
        },
      });
    }
    await throttle.reset(emailKey);
    const session = await startSession(req, reply, result.user);
    await recordAuditEvent(db, {
      actorType: "human",
      actorUser: result.user.email,
      actorUserId: result.user.id,
      sessionId: sessionRef(session.id),
      ...meta,
      resourceType: "user",
      resourceId: result.user.id,
      action: "auth.login_succeeded",
      description: "Signed in",
    });
    return { ok: true };
  });

  app.post("/auth/logout", async (req, reply) => {
    if (req.principal) {
      await revokeSession(db, req.principal.session.id, "logout");
      const actor = actorFrom(req);
      await recordAuditEvent(db, {
        actorType: "human",
        actorUser: actor.ref,
        actorUserId: actor.userId,
        sessionId: actor.sessionRef,
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
        requestId: actor.requestId,
        action: "auth.logout",
        description: "Signed out",
      });
    }
    clearSessionCookie(reply, secure);
    return reply.status(204).send();
  });

  app.get("/auth/me", async (req): Promise<MeDTO> => {
    const p = principalOf(req);
    const user = await getUserDTO(db, p.user.id);
    const visible = scopeFor(req, "company.view");
    const companies = await listCompanies(db, visible);
    return {
      user,
      session: { expiresAt: p.session.expiresAt.toISOString() },
      isPlatformOwner: p.access.isPlatformOwner,
      globalPermissions: [...p.access.global].sort(),
      companyPermissions: Object.fromEntries(
        companies.map((c) => [c.id, effectivePermissions(p.access, c.id)]),
      ),
      accessibleCompanies: companies.map((c) => ({
        id: c.id,
        name: c.name,
        slug: c.slug,
        accentColor: c.accentColor,
      })),
    };
  });

  /* ---------- password reset (no user enumeration) ---------- */

  app.post("/auth/password-reset/request", async (req, reply) => {
    const { email } = passwordResetRequestSchema.parse(req.body);
    await limit(`reset:ip:${req.ip}`, LIMITS.resetPerIp);
    if (
      (await throttle.hit(`reset:email:${email}`, LIMITS.resetPerEmail.window)) <=
      LIMITS.resetPerEmail.max
    ) {
      const issued = await requestPasswordReset(db, email);
      if (issued)
        await app.deps.delivery.passwordReset(
          issued.user.email,
          `${app.deps.webOrigin}/reset-password?token=${issued.token}`,
        );
    }
    return reply.status(202).send({
      ok: true,
      message: "If an account exists for that email, a reset link has been sent.",
    });
  });

  app.post("/auth/password-reset/confirm", async (req) => {
    const body = passwordResetConfirmSchema.parse(req.body);
    await limit(`token:ip:${req.ip}`, LIMITS.tokenPerIp);
    await resetPassword(db, body.token, body.password, { ipAddress: req.ip, requestId: req.id });
    return { ok: true };
  });

  /* ---------- invitations ---------- */

  // POST (not GET /:token) so single-use tokens never appear in URLs or request logs.
  app.post("/auth/invitations/lookup", async (req, reply) => {
    await limit(`token:ip:${req.ip}`, LIMITS.tokenPerIp);
    const parsed = z.object({ token: tokenSchema }).safeParse(req.body);
    const row = parsed.success ? await peekAuthToken(db, parsed.data.token, "invitation") : null;
    if (!row || row.user.status !== "invited") {
      return reply.status(404).send({
        error: { code: "invalid_token", message: "This invitation is invalid or has expired" },
      });
    }
    return {
      email: row.user.email,
      firstName: row.user.firstName,
      lastName: row.user.lastName,
      expiresAt: row.token.expiresAt.toISOString(),
    };
  });

  app.post("/auth/invitations/accept", async (req, reply) => {
    const body = acceptInvitationSchema.parse(req.body);
    await limit(`token:ip:${req.ip}`, LIMITS.tokenPerIp);
    const user = await acceptInvitation(db, body, { ipAddress: req.ip, requestId: req.id });
    await startSession(req, reply, user);
    return { ok: true };
  });
};
