import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import { can, companiesWith, type HumanAccessContext } from "@aibos/access-core";
import {
  ForbiddenError,
  loadAccessContext,
  NotFoundError,
  recordAuditEvent,
  resolveCompany,
  sessionRef,
  validateSessionToken,
  type AccessScope,
  type Actor,
  type Session,
  type User,
} from "@aibos/db";
import { SESSION_COOKIE } from "@aibos/shared";

type Company = NonNullable<Awaited<ReturnType<typeof resolveCompany>>>;

/** Authenticated human principal attached to every protected request. */
export interface HumanPrincipal {
  kind: "human";
  user: User;
  session: Session;
  access: HumanAccessContext;
}

export class UnauthorizedError extends Error {
  constructor(
    readonly code: "unauthenticated" | "session_expired" | "account_disabled" = "unauthenticated",
    message = "Authentication required",
  ) {
    super(message);
    this.name = "UnauthorizedError";
  }
}

export class TooManyRequestsError extends Error {
  constructor(message = "Too many attempts. Please wait and try again.") {
    super(message);
    this.name = "TooManyRequestsError";
  }
}

declare module "fastify" {
  interface FastifyRequest {
    principal: HumanPrincipal | null;
    /** Why a presented session was rejected (for clearer 401 codes). */
    sessionRejection: "expired" | "revoked" | "account_inactive" | "invalid" | null;
  }
}

/** Routes reachable without a session. Everything else under /v1 requires one. */
const PUBLIC_ROUTES = new Set([
  "GET /health",
  "GET /v1/auth/status",
  "POST /v1/auth/login",
  "POST /v1/auth/logout",
  "POST /v1/auth/password-reset/request",
  "POST /v1/auth/password-reset/confirm",
  "POST /v1/auth/invitations/lookup",
  "POST /v1/auth/invitations/accept",
]);

const UNSAFE = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export interface SecurityOptions {
  allowedOrigins: string[];
}

/**
 * Session authentication + CSRF defence:
 *  - resolves the HttpOnly session cookie to a principal on every request;
 *  - rejects unsafe methods whose Origin is not an allowed web origin
 *    (together with SameSite=Lax cookies and JSON-only bodies).
 */
export const securityPlugin = fp<SecurityOptions>(async (app, opts) => {
  app.decorateRequest("principal", null);
  app.decorateRequest("sessionRejection", null);
  const db = app.deps.db.db;

  app.addHook("onRequest", async (req) => {
    if (UNSAFE.has(req.method)) {
      const origin = req.headers.origin;
      if (origin && !opts.allowedOrigins.includes(origin)) {
        throw new ForbiddenError("Cross-origin request rejected");
      }
    }
    const token = req.cookies[SESSION_COOKIE];
    if (!token) return;
    const result = await validateSessionToken(db, token);
    if (!result.ok) {
      req.sessionRejection = result.reason;
      return;
    }
    req.principal = {
      kind: "human",
      user: result.user,
      session: result.session,
      access: await loadAccessContext(db, result.user.id),
    };
  });

  app.addHook("preHandler", async (req) => {
    const route = `${req.method} ${req.routeOptions.url ?? ""}`;
    if (PUBLIC_ROUTES.has(route) || !req.routeOptions.url) return;
    if (!req.principal) {
      if (req.sessionRejection === "account_inactive")
        throw new UnauthorizedError("account_disabled", "This account is disabled");
      if (req.sessionRejection === "expired" || req.sessionRejection === "revoked") {
        throw new UnauthorizedError(
          "session_expired",
          "Your session has ended. Please sign in again.",
        );
      }
      throw new UnauthorizedError();
    }
  });
});

/* ---------- request helpers ---------- */

export function principalOf(req: FastifyRequest): HumanPrincipal {
  if (!req.principal) throw new UnauthorizedError();
  return req.principal;
}

export function actorFrom(req: FastifyRequest): Actor {
  const p = req.principal;
  const base = {
    ipAddress: req.ip,
    userAgent: req.headers["user-agent"]?.slice(0, 500),
    requestId: req.id,
  };
  if (!p) return { kind: "system", ref: "anonymous", ...base };
  return {
    kind: "human",
    ref: p.user.email,
    userId: p.user.id,
    sessionRef: sessionRef(p.session.id),
    ...base,
  };
}

export function requirePermission(
  req: FastifyRequest,
  permission: string,
  companyId: string | null,
): void {
  const p = principalOf(req);
  if (!can(p.access, permission, companyId)) throw new ForbiddenError();
}

/** Visible companies for a permission, including department restrictions. */
export function scopeFor(req: FastifyRequest, permission: string): AccessScope {
  const access = principalOf(req).access;
  const ids = companiesWith(access, permission);
  if (ids === "all") return { companyIds: "all", includeGroup: true };
  const departments = new Map(
    [...access.departments.entries()].filter(([companyId]) => ids.includes(companyId)),
  );
  return {
    companyIds: ids,
    includeGroup: false,
    departments: departments.size ? departments : undefined,
  };
}

export async function auditSecurityEvent(
  req: FastifyRequest,
  action: string,
  description: string,
  extra: {
    companyId?: string;
    resourceType?: string;
    resourceId?: string;
    metadata?: Record<string, unknown>;
  } = {},
): Promise<void> {
  const actor = actorFrom(req);
  await recordAuditEvent(req.server.deps.db.db, {
    actorType: actor.kind === "human" ? "human" : "anonymous",
    actorUser: actor.kind === "human" ? actor.ref : undefined,
    actorUserId: actor.userId,
    sessionId: actor.sessionRef,
    ipAddress: actor.ipAddress,
    userAgent: actor.userAgent,
    requestId: actor.requestId,
    action,
    description,
    outcome: "failure",
    ...extra,
    metadata: { route: req.routeOptions.url, method: req.method, ...extra.metadata },
  }).catch((err: unknown) => req.log.error({ err }, "failed to write security audit event"));
}

/**
 * Resolves `?company=` for a permission. Never trusts the query string:
 * unknown and forbidden companies are indistinguishable (403) unless the
 * caller has global access, and forbidden attempts on real companies are audited.
 */
export async function companyScope(
  req: FastifyRequest,
  ref: string | undefined,
  permission: string,
): Promise<{ company: Company | null; scope: AccessScope }> {
  const scope = scopeFor(req, permission);
  if (!ref || ref === "all") {
    if (scope.companyIds !== "all" && scope.companyIds.length === 0) throw new ForbiddenError();
    return { company: null, scope };
  }
  const company: Company | null = await resolveCompany(req.server.deps.db.db, ref).catch(
    (e: unknown) => {
      if (!(e instanceof NotFoundError) || scope.companyIds === "all") throw e;
      // Unknown and forbidden companies look identical to scoped users.
      throw new ForbiddenError("You do not have access to this company");
    },
  );
  if (!company || !can(principalOf(req).access, permission, company.id)) {
    await auditSecurityEvent(
      req,
      "security.unauthorized_access",
      `Denied ${permission} on another company`,
      {
        companyId: company?.id,
        resourceType: "company",
        resourceId: company?.id,
        metadata: { permission },
      },
    );
    throw new ForbiddenError("You do not have access to this company");
  }
  return {
    company,
    scope: {
      companyIds: [company.id],
      includeGroup: false,
      departments: scope.departments,
    },
  };
}

export function clearSessionCookie(reply: FastifyReply, secure: boolean) {
  void reply.clearCookie(SESSION_COOKIE, { path: "/", httpOnly: true, sameSite: "lax", secure });
}

export type { FastifyInstance };
