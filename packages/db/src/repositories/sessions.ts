import { and, eq, isNull } from "drizzle-orm";
import { generateToken, sha256 } from "../auth/crypto";
import type { Database } from "../client";
import { sessions, users, type Session, type User } from "../schema";

/**
 * Session design (see docs/ARCHITECTURE.md → Sessions):
 * - 256-bit random token in an HttpOnly cookie; DB stores SHA-256(token).
 * - Sliding idle expiry (IDLE_TTL) capped by an absolute lifetime (ABSOLUTE_TTL).
 * - A new session is issued on every login (rotation); logout, password
 *   reset and account disable revoke server-side.
 */
export const SESSION_IDLE_TTL_MS = 24 * 3_600_000;
export const SESSION_ABSOLUTE_TTL_MS = 7 * 24 * 3_600_000;
/** Avoid a write per request: only extend when last activity is older than this. */
const TOUCH_INTERVAL_MS = 5 * 60_000;

export function sessionRef(sessionId: string): string {
  return sessionId.slice(0, 16);
}

export async function createSession(
  db: Database,
  userId: string,
  meta: { ipAddress?: string; userAgent?: string } = {},
  now = new Date(),
): Promise<{ token: string; session: Session }> {
  const token = generateToken();
  const [session] = await db
    .insert(sessions)
    .values({
      id: sha256(token),
      userId,
      createdAt: now,
      lastSeenAt: now,
      expiresAt: new Date(now.getTime() + SESSION_IDLE_TTL_MS),
      absoluteExpiresAt: new Date(now.getTime() + SESSION_ABSOLUTE_TTL_MS),
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent?.slice(0, 500),
    })
    .returning();
  if (!session) throw new Error("Session insert failed");
  return { token, session };
}

export type SessionValidation =
  | { ok: true; session: Session; user: User }
  | { ok: false; reason: "invalid" | "expired" | "revoked" | "account_inactive"; userId?: string };

export async function validateSessionToken(
  db: Database,
  token: string,
  now = new Date(),
): Promise<SessionValidation> {
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(token)) return { ok: false, reason: "invalid" };
  const [row] = await db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.id, sha256(token)));
  if (!row) return { ok: false, reason: "invalid" };
  const { session, user } = row;
  if (session.revokedAt) return { ok: false, reason: "revoked", userId: user.id };
  if (session.expiresAt <= now || session.absoluteExpiresAt <= now)
    return { ok: false, reason: "expired", userId: user.id };
  if (user.status !== "active") return { ok: false, reason: "account_inactive", userId: user.id };

  if (now.getTime() - session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
    const expiresAt = new Date(
      Math.min(now.getTime() + SESSION_IDLE_TTL_MS, session.absoluteExpiresAt.getTime()),
    );
    await db
      .update(sessions)
      .set({ lastSeenAt: now, expiresAt })
      .where(eq(sessions.id, session.id));
    session.lastSeenAt = now;
    session.expiresAt = expiresAt;
  }
  return { ok: true, session, user };
}

export async function revokeSession(
  db: Database,
  sessionId: string,
  reason: string,
): Promise<void> {
  await db
    .update(sessions)
    .set({ revokedAt: new Date(), revokedReason: reason })
    .where(and(eq(sessions.id, sessionId), isNull(sessions.revokedAt)));
}

export async function revokeUserSessions(
  db: Pick<Database, "update">,
  userId: string,
  reason: string,
): Promise<void> {
  await db
    .update(sessions)
    .set({ revokedAt: new Date(), revokedReason: reason })
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
}
