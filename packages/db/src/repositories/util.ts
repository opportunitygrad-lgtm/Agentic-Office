import { inArray, isNotNull, isNull, or, sql, type AnyColumn, type SQL } from "drizzle-orm";

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

/**
 * Who performed an action. Humans, agents and internal services are distinct
 * principal types; audit records always state which one acted.
 */
export interface Actor {
  kind: "human" | "agent" | "service" | "system";
  /** Display label: email for humans, service key, agent name or "system". */
  ref: string;
  userId?: string;
  agentId?: string;
  serviceId?: string;
  /** Short, non-reversible session reference (never the token). */
  sessionRef?: string;
  ipAddress?: string;
  userAgent?: string;
  requestId?: string;
}

export const SYSTEM_ACTOR: Actor = { kind: "system", ref: "system" };

export function serviceActor(serviceId: string): Actor {
  return { kind: "service", ref: serviceId, serviceId };
}

/** Audit columns describing the actor (spread into recordAuditEvent input). */
export function actorAuditFields(actor: Actor) {
  return {
    actorType: actor.kind,
    actorUser: actor.kind === "human" || actor.kind === "service" ? actor.ref : undefined,
    actorUserId: actor.userId,
    actorServiceId: actor.serviceId,
    sessionId: actor.sessionRef,
    ipAddress: actor.ipAddress,
    userAgent: actor.userAgent,
    requestId: actor.requestId,
  };
}

/* ---------- company data scope ---------- */

/**
 * The set of companies a caller may see for a given permission. Every
 * company-scoped repository query accepts one; the API derives it from the
 * authenticated principal. `includeGroup` exposes rows with company_id NULL
 * (group-level data), which only global access may see.
 */
export interface AccessScope {
  companyIds: "all" | readonly string[];
  includeGroup: boolean;
  /** Department restrictions per company (absent = whole company). */
  departments?: ReadonlyMap<string, readonly string[]>;
}

export const FULL_SCOPE: AccessScope = { companyIds: "all", includeGroup: true };
export const EMPTY_SCOPE: AccessScope = { companyIds: [], includeGroup: false };

export function scopeWhere(column: AnyColumn, scope: AccessScope): SQL | undefined {
  if (scope.companyIds === "all") return scope.includeGroup ? undefined : isNotNull(column);
  const ids = [...scope.companyIds];
  if (!ids.length) return scope.includeGroup ? isNull(column) : sql`false`;
  return scope.includeGroup ? or(inArray(column, ids), isNull(column)) : inArray(column, ids);
}

export function scopeAllows(scope: AccessScope, companyId: string | null): boolean {
  if (companyId === null) return scope.includeGroup;
  return scope.companyIds === "all" || scope.companyIds.includes(companyId);
}

/** Narrows a scope to one company (empty if the scope does not include it). */
export function narrowScope(scope: AccessScope, companyId: string): AccessScope {
  return {
    companyIds: scopeAllows(scope, companyId) ? [companyId] : [],
    includeGroup: false,
    departments: scope.departments,
  };
}

/** Department-level visibility for a row belonging to (company, department). */
export function departmentVisible(
  scope: AccessScope,
  companyId: string | null,
  departmentId: string | null,
): boolean {
  if (!scope.departments || companyId === null) return true;
  const restricted = scope.departments.get(companyId);
  if (!restricted) return true;
  return departmentId !== null && restricted.includes(departmentId);
}
