import { sql, type SQL } from "drizzle-orm";

/** Timestamp parameter for raw sql`` fragments (postgres-js cannot bind Date there). */
export const ts = (d: Date): SQL => sql`${d.toISOString()}::timestamptz`;

export const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

export const isUuid = (v: string): boolean =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

export function startOfUtcDay(d = new Date()): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export function startOfUtcMonth(d = new Date()): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

/** Who performed an action. Replaced by authenticated users in Stage 02. */
export interface Actor {
  kind: "human" | "agent" | "system";
  ref: string;
  ipAddress?: string;
  userAgent?: string;
  requestId?: string;
}

export const SYSTEM_ACTOR: Actor = { kind: "system", ref: "system" };
