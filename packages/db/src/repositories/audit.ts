import { and, desc, eq } from "drizzle-orm";
import {
  createAuditEventSchema,
  type AuditEventDTO,
  type CreateAuditEventInput,
} from "@aibos/shared";
import type { Database } from "../client";
import { agents, auditEvents, companies, type AuditEvent } from "../schema";
import { FULL_SCOPE, scopeWhere, type AccessScope } from "./util";

type Tx = Pick<Database, "insert" | "select">;

/** Appends an audit event. Validates input; the audit table is append-only. */
export async function recordAuditEvent(
  db: Tx,
  input: CreateAuditEventInput,
  origin: "live" | "dev_seed" = "live",
): Promise<AuditEvent> {
  const data = createAuditEventSchema.parse(input);
  const [row] = await db
    .insert(auditEvents)
    .values({ ...data, origin })
    .returning();
  return row!;
}

export async function listAuditEvents(
  db: Database,
  opts: { companyId?: string | null; limit?: number; scope?: AccessScope } = {},
): Promise<AuditEventDTO[]> {
  const rows = await db
    .select({
      e: auditEvents,
      company: {
        id: companies.id,
        name: companies.name,
        slug: companies.slug,
        accentColor: companies.accentColor,
      },
      agentName: agents.name,
    })
    .from(auditEvents)
    .leftJoin(companies, eq(companies.id, auditEvents.companyId))
    .leftJoin(agents, eq(agents.id, auditEvents.agentId))
    .where(
      and(
        opts.companyId ? eq(auditEvents.companyId, opts.companyId) : undefined,
        scopeWhere(auditEvents.companyId, opts.scope ?? FULL_SCOPE),
      ),
    )
    .orderBy(desc(auditEvents.occurredAt))
    .limit(opts.limit ?? 100);

  return rows.map(({ e, company, agentName }) => ({
    id: e.id,
    occurredAt: e.occurredAt.toISOString(),
    company: company?.id ? company : null,
    agent: e.agentId && agentName ? { id: e.agentId, name: agentName } : null,
    taskId: e.taskId,
    actorType: e.actorType,
    actorUser: e.actorUser,
    actorUserId: e.actorUserId,
    actorServiceId: e.actorServiceId,
    resourceType: e.resourceType,
    resourceId: e.resourceId,
    action: e.action,
    tool: e.tool,
    provider: e.provider,
    description: e.description,
    metadata: e.metadata,
    outcome: e.outcome,
    error: e.error,
    origin: e.origin,
  }));
}
