import { and, eq, gt, isNull, sql } from "drizzle-orm";
import {
  burnPasswordCheck,
  generateToken,
  hashPassword,
  sha256,
  verifyPassword,
} from "../auth/crypto";
import type { Database } from "../client";
import { ConflictError, InvalidTokenError } from "../errors";
import { authTokens, companyMemberships, users, type User } from "../schema";
import { recordAuditEvent } from "./audit";
import {
  countUsers,
  findUserByEmail,
  getRoleByKey,
  insertMembership,
  insertUser,
} from "./identity";
import { revokeUserSessions } from "./sessions";
import { actorAuditFields, serviceActor, type Actor } from "./util";

export const PASSWORD_RESET_TTL_MS = 60 * 60_000;

export type AuthResult =
  | { ok: true; user: User }
  | { ok: false; reason: "invalid_credentials"; user?: User }
  | { ok: false; reason: "account_inactive"; user: User };

/**
 * Verifies credentials in constant-ish time. Unknown emails still run an
 * argon2 verification so response timing does not reveal account existence.
 * Inactive status is only revealed after the correct password is supplied.
 */
export async function authenticate(
  db: Database,
  email: string,
  password: string,
): Promise<AuthResult> {
  const user = await findUserByEmail(db, email);
  if (!user || !user.passwordHash) {
    await burnPasswordCheck(password);
    return { ok: false, reason: "invalid_credentials", user: user ?? undefined };
  }
  if (!(await verifyPassword(user.passwordHash, password)))
    return { ok: false, reason: "invalid_credentials", user };
  if (user.status !== "active") return { ok: false, reason: "account_inactive", user };
  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
  return { ok: true, user };
}

/* ---------- single-use tokens ---------- */

export async function issueAuthToken(
  db: Pick<Database, "insert" | "update">,
  userId: string,
  type: "password_reset" | "invitation",
  ttlMs: number,
  createdByUserId: string | null = null,
): Promise<{ token: string; expiresAt: Date }> {
  // Only the newest token of a type is valid.
  await db
    .update(authTokens)
    .set({ usedAt: new Date() })
    .where(
      and(eq(authTokens.userId, userId), eq(authTokens.type, type), isNull(authTokens.usedAt)),
    );
  const token = generateToken();
  const expiresAt = new Date(Date.now() + ttlMs);
  await db
    .insert(authTokens)
    .values({ userId, type, tokenHash: sha256(token), expiresAt, createdByUserId });
  return { token, expiresAt };
}

/** Looks up a usable token without consuming it (e.g. to render the invite page). */
export async function peekAuthToken(
  db: Database,
  token: string,
  type: "password_reset" | "invitation",
) {
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(token)) return null;
  const [row] = await db
    .select({ token: authTokens, user: users })
    .from(authTokens)
    .innerJoin(users, eq(users.id, authTokens.userId))
    .where(
      and(
        eq(authTokens.tokenHash, sha256(token)),
        eq(authTokens.type, type),
        isNull(authTokens.usedAt),
        gt(authTokens.expiresAt, new Date()),
      ),
    );
  return row ?? null;
}

/** Atomically consumes a token; invalid, expired and used tokens are indistinguishable. */
async function consumeAuthToken(
  tx: Parameters<Parameters<Database["transaction"]>[0]>[0],
  token: string,
  type: "password_reset" | "invitation",
) {
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(token)) throw new InvalidTokenError();
  const [row] = await tx
    .update(authTokens)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(authTokens.tokenHash, sha256(token)),
        eq(authTokens.type, type),
        isNull(authTokens.usedAt),
        gt(authTokens.expiresAt, new Date()),
      ),
    )
    .returning();
  if (!row) throw new InvalidTokenError();
  return row;
}

/**
 * Starts a password reset. Always "succeeds" from the caller's perspective;
 * returns a token only when an active account exists (for delivery).
 */
export async function requestPasswordReset(
  db: Database,
  email: string,
): Promise<{ user: User; token: string; expiresAt: Date } | null> {
  const user = await findUserByEmail(db, email);
  if (!user || user.status !== "active") return null;
  const issued = await issueAuthToken(db, user.id, "password_reset", PASSWORD_RESET_TTL_MS);
  await recordAuditEvent(db, {
    actorType: "anonymous",
    resourceType: "user",
    resourceId: user.id,
    action: "auth.password_reset_requested",
    description: `Password reset requested for ${user.email}`,
  });
  return { user, ...issued };
}

export async function resetPassword(
  db: Database,
  token: string,
  password: string,
  meta: Partial<Actor> = {},
): Promise<User> {
  const passwordHash = await hashPassword(password);
  return db.transaction(async (tx) => {
    const row = await consumeAuthToken(tx, token, "password_reset");
    const [user] = await tx
      .update(users)
      .set({ passwordHash, passwordChangedAt: new Date() })
      .where(and(eq(users.id, row.userId), eq(users.status, "active")))
      .returning();
    if (!user) throw new InvalidTokenError();
    await revokeUserSessions(tx, user.id, "password_reset");
    await recordAuditEvent(tx, {
      actorType: "human",
      actorUser: user.email,
      actorUserId: user.id,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      requestId: meta.requestId,
      resourceType: "user",
      resourceId: user.id,
      action: "auth.password_reset",
      description: "Password reset completed; all sessions revoked",
    });
    return user;
  });
}

export async function acceptInvitation(
  db: Database,
  input: { token: string; password: string; firstName?: string; lastName?: string },
  meta: Partial<Actor> = {},
): Promise<User> {
  const passwordHash = await hashPassword(input.password);
  return db.transaction(async (tx) => {
    const row = await consumeAuthToken(tx, input.token, "invitation");
    const [user] = await tx
      .update(users)
      .set({
        passwordHash,
        passwordChangedAt: new Date(),
        status: "active",
        ...(input.firstName ? { firstName: input.firstName } : {}),
        ...(input.lastName ? { lastName: input.lastName } : {}),
      })
      .where(and(eq(users.id, row.userId), eq(users.status, "invited")))
      .returning();
    if (!user) throw new InvalidTokenError();
    await tx
      .update(companyMemberships)
      .set({ status: "active", joinedAt: new Date() })
      .where(and(eq(companyMemberships.userId, user.id), eq(companyMemberships.status, "invited")));
    await recordAuditEvent(tx, {
      actorType: "human",
      actorUser: user.email,
      actorUserId: user.id,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      requestId: meta.requestId,
      resourceType: "user",
      resourceId: user.id,
      action: "user.invitation_accepted",
      description: `${user.email} accepted their invitation`,
    });
    return user;
  });
}

/**
 * Creates the first Platform Owner. Refuses when ANY user exists, under a
 * transaction-scoped advisory lock, so it can never silently add admins later.
 */
export async function bootstrapPlatformOwner(
  db: Database,
  input: { email: string; password: string; firstName?: string; lastName?: string },
): Promise<User> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(7302202601)`);
    if ((await countUsers(tx)) > 0) {
      throw new ConflictError(
        "Bootstrap refused: users already exist. Use Settings → Users & Access instead.",
      );
    }
    const user = await insertUser(tx, {
      email: input.email,
      firstName: input.firstName ?? null,
      lastName: input.lastName ?? null,
      password: input.password,
      status: "active",
    });
    const role = await getRoleByKey(tx, "platform_owner");
    await insertMembership(tx, {
      userId: user.id,
      companyId: null,
      roleId: role.id,
      status: "active",
    });
    await recordAuditEvent(tx, {
      ...actorAuditFields(serviceActor("bootstrap-cli")),
      resourceType: "user",
      resourceId: user.id,
      action: "auth.bootstrap_admin_created",
      description: `First Platform Owner created: ${user.email}`,
    });
    return user;
  });
}
