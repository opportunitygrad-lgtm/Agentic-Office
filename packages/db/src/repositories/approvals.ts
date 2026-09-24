import { and, desc, eq, type SQL } from "drizzle-orm";
import {
  createApprovalSchema,
  type ApprovalDTO,
  type ApprovalStatus,
  type CreateApprovalInput,
} from "@aibos/shared";
import type { Database } from "../client";
import { agents, approvals, companies, tasks, type Approval } from "../schema";
import { recordAuditEvent } from "./audit";
import { iso, type Actor } from "./util";

export async function listApprovals(
  db: Database,
  filters: { companyId?: string | null; status?: ApprovalStatus; limit?: number } = {},
): Promise<ApprovalDTO[]> {
  const where: SQL[] = [];
  if (filters.companyId) where.push(eq(approvals.companyId, filters.companyId));
  if (filters.status) where.push(eq(approvals.status, filters.status));

  const rows = await db
    .select({
      a: approvals,
      company: {
        id: companies.id,
        name: companies.name,
        slug: companies.slug,
        accentColor: companies.accentColor,
      },
      taskTitle: tasks.title,
      agentName: agents.name,
    })
    .from(approvals)
    .leftJoin(companies, eq(companies.id, approvals.companyId))
    .leftJoin(tasks, eq(tasks.id, approvals.taskId))
    .leftJoin(agents, eq(agents.id, approvals.agentId))
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(approvals.requestedAt))
    .limit(filters.limit ?? 100);

  return rows.map(({ a, company, taskTitle, agentName }) => ({
    id: a.id,
    company: company?.id ? company : null,
    task: a.taskId && taskTitle ? { id: a.taskId, title: taskTitle } : null,
    agent: a.agentId && agentName ? { id: a.agentId, name: agentName } : null,
    type: a.type,
    requestedAction: a.requestedAction,
    explanation: a.explanation,
    riskLevel: a.riskLevel,
    proposedChange: a.proposedChange,
    beforeState: a.beforeState,
    afterState: a.afterState,
    status: a.status,
    requestedAt: a.requestedAt.toISOString(),
    expiresAt: iso(a.expiresAt),
    decidedBy: a.decidedBy,
    decisionNotes: a.decisionNotes,
    decidedAt: iso(a.decidedAt),
    origin: a.origin,
  }));
}

export async function createApproval(
  db: Database,
  input: CreateApprovalInput,
  actor: Actor,
  opts: { origin?: "live" | "dev_seed"; requestedAt?: Date } = {},
): Promise<Approval> {
  const data = createApprovalSchema.parse(input);
  const origin = opts.origin ?? "live";
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(approvals)
      .values({ ...data, origin, ...(opts.requestedAt ? { requestedAt: opts.requestedAt } : {}) })
      .returning();
    if (!row) throw new Error("Approval insert failed");
    await recordAuditEvent(
      tx,
      {
        companyId: data.companyId,
        agentId: data.agentId,
        taskId: data.taskId,
        action: "approval.requested",
        description: `Approval requested: ${data.requestedAction}`,
        metadata: {
          approvalId: row.id,
          type: data.type,
          riskLevel: data.riskLevel,
          actor: actor.ref,
        },
      },
      origin,
    );
    return row;
  });
}
