import { and, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { requiredApprovalPermissions, type ApprovalRequirementRule } from "@aibos/access-core";
import {
  createApprovalSchema,
  type ApprovalDTO,
  type ApprovalStatus,
  type CreateApprovalInput,
} from "@aibos/shared";
import type { Database } from "../client";
import { ConflictError, NotFoundError } from "../errors";
import {
  agents,
  approvalRequirements,
  approvals,
  companies,
  tasks,
  type Approval,
} from "../schema";
import { recordAuditEvent } from "./audit";
import {
  FULL_SCOPE,
  actorAuditFields,
  departmentVisible,
  iso,
  scopeWhere,
  type AccessScope,
  type Actor,
} from "./util";

export async function listApprovals(
  db: Database,
  filters: {
    companyId?: string | null;
    status?: ApprovalStatus;
    limit?: number;
    scope?: AccessScope;
    ids?: string[];
  } = {},
): Promise<ApprovalDTO[]> {
  const where: SQL[] = [];
  const scope = filters.scope ?? FULL_SCOPE;
  const scoped = scopeWhere(approvals.companyId, scope);
  if (scoped) where.push(scoped);
  if (filters.ids) where.push(filters.ids.length ? inArray(approvals.id, filters.ids) : sql`false`);
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
      agentDepartmentId: agents.departmentId,
    })
    .from(approvals)
    .leftJoin(companies, eq(companies.id, approvals.companyId))
    .leftJoin(tasks, eq(tasks.id, approvals.taskId))
    .leftJoin(agents, eq(agents.id, approvals.agentId))
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(approvals.requestedAt))
    .limit(filters.limit ?? 100);

  return rows
    .filter((r) => departmentVisible(scope, r.a.companyId, r.agentDepartmentId))
    .map(({ a, company, taskTitle, agentName }) => ({
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
      requiredPermissions: a.requiredPermissions.length
        ? a.requiredPermissions
        : requiredApprovalPermissions({
            type: a.type,
            riskLevel: a.riskLevel,
            companyId: a.companyId,
          }),
      decidedBy: a.decidedBy,
      decidedByUserId: a.decidedByUserId,
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
    const rules = await loadApprovalRules(tx);
    const requiredPermissions = requiredApprovalPermissions(
      { type: data.type, riskLevel: data.riskLevel, companyId: data.companyId ?? null },
      rules,
    );
    const [row] = await tx
      .insert(approvals)
      .values({
        ...data,
        requiredPermissions,
        origin,
        ...(opts.requestedAt ? { requestedAt: opts.requestedAt } : {}),
      })
      .returning();
    if (!row) throw new Error("Approval insert failed");
    await recordAuditEvent(
      tx,
      {
        ...actorAuditFields(actor),
        companyId: data.companyId,
        agentId: data.agentId,
        taskId: data.taskId,
        resourceType: "approval",
        resourceId: row.id,
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

type Tx = Pick<Database, "select">;

/** Loads data-driven approval authority rules (approval_requirements). */
export async function loadApprovalRules(db: Tx): Promise<ApprovalRequirementRule[]> {
  const rows = await db.select().from(approvalRequirements);
  return rows.map((r) => ({
    approvalType: r.approvalType as ApprovalRequirementRule["approvalType"],
    minRiskLevel: r.minRiskLevel,
    requiredPermission: r.requiredPermission,
    companyId: r.companyId,
  }));
}

export async function getApprovalRow(db: Database, id: string): Promise<Approval> {
  const [row] = await db.select().from(approvals).where(eq(approvals.id, id));
  if (!row) throw new NotFoundError("Approval", id);
  return row;
}

/**
 * Records a human decision. Authority (permissions) is verified by the caller
 * via canDecideApproval; this function enforces state transitions atomically
 * (only pending, unexpired approvals can be decided — exactly once).
 */
export async function decideApproval(
  db: Database,
  id: string,
  input: { decision: "approve" | "reject"; notes?: string },
  actor: Actor,
): Promise<Approval> {
  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(approvals).where(eq(approvals.id, id)).for("update");
    if (!current) throw new NotFoundError("Approval", id);
    if (current.status !== "pending")
      throw new ConflictError(`Approval is already ${current.status}`);
    if (current.expiresAt && current.expiresAt < new Date()) {
      await tx.update(approvals).set({ status: "expired" }).where(eq(approvals.id, id));
      throw new ConflictError("Approval has expired");
    }
    const status = input.decision === "approve" ? "approved" : "rejected";
    const [row] = await tx
      .update(approvals)
      .set({
        status,
        decidedBy: actor.ref,
        decidedByUserId: actor.userId ?? null,
        decisionNotes: input.notes ?? null,
        decidedAt: new Date(),
      })
      .where(and(eq(approvals.id, id), eq(approvals.status, "pending")))
      .returning();
    if (!row) throw new ConflictError("Approval was decided concurrently");
    await recordAuditEvent(tx, {
      ...actorAuditFields(actor),
      companyId: row.companyId ?? undefined,
      agentId: row.agentId ?? undefined,
      taskId: row.taskId ?? undefined,
      resourceType: "approval",
      resourceId: row.id,
      action: input.decision === "approve" ? "approval.approved" : "approval.rejected",
      description: `${input.decision === "approve" ? "Approved" : "Rejected"}: ${row.requestedAction}`,
      metadata: {
        type: row.type,
        riskLevel: row.riskLevel,
        requiredPermissions: row.requiredPermissions,
        notes: input.notes ?? null,
      },
      before: { status: "pending" },
      after: { status },
    });
    return row;
  });
}
