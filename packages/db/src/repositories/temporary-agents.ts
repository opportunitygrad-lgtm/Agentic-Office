import { and, eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { AGENT_PERMISSION_KEYS, evaluateAgentPermission } from "@aibos/access-core";
import { temporaryAgentSchema, type AutonomyLevel, type TemporaryAgentInput } from "@aibos/shared";
import type { Database } from "../client";
import { ConflictError, ForbiddenError, NotFoundError } from "../errors";
import {
  agentCompanyAssignments,
  agentPermissionGrants,
  agents,
  approvals,
  tasks,
  type Agent,
} from "../schema";
import { loadAgentAuthorityInput } from "./agent-authority";
import { recordAuditEvent } from "./audit";
import { actorAuditFields, type Actor } from "./util";
import { getWorkforcePolicy, refreshAgentStates } from "./workforce";

const AUTONOMY_ORDER: AutonomyLevel[] = [
  "disabled",
  "observe",
  "limited_operator",
  "approval_gated",
  "trusted_automation",
];

/** Who is creating the worker: a person with agent.create, or an agent with delegated authority. */
export type TemporaryCreator =
  { kind: "human"; actor: Actor } | { kind: "agent"; agentId: string; actor: Actor };

export type TemporaryAgentResult =
  | { status: "created"; agent: Agent }
  | { status: "approval_required"; approvalId: string; reasons: string[] };

/**
 * Creates a task-bound temporary worker. Guarantees:
 *  - inherits the parent's company isolation (serves exactly one company);
 *  - bound to one task of that company; expires; has a fixed budget;
 *  - never gets a permission the parent cannot exercise (allow stays allow,
 *    approval-gated stays approval-gated, denied is refused);
 *  - inherits the parent's prohibitions and never exceeds its autonomy;
 *  - cannot create further workers unless a PERSON explicitly permits it;
 *  - agent-initiated creation needs `action.create_temp_worker` (approval if gated).
 */
export async function createTemporaryAgent(
  db: Database,
  input: TemporaryAgentInput,
  creator: TemporaryCreator,
  opts: { origin?: "live" | "dev_seed"; now?: Date } = {},
): Promise<TemporaryAgentResult> {
  const data = temporaryAgentSchema.parse(input);
  const now = opts.now ?? new Date();
  const policy = await getWorkforcePolicy(db);
  const [parent] = await db.select().from(agents).where(eq(agents.id, data.parentAgentId));
  if (!parent) throw new NotFoundError("Agent", data.parentAgentId);
  if (["expired", "terminated", "paused", "offline", "failed"].includes(parent.status))
    throw new ConflictError(`The parent agent is ${parent.status}`);

  if (creator.kind === "agent" && creator.agentId !== parent.id)
    throw new ForbiddenError("An agent can only create workers under its own authority");
  if (parent.isTemporary && !parent.maySpawnTemporary)
    throw new ForbiddenError(
      "Temporary workers cannot create further workers unless explicitly permitted",
    );
  if (data.maySpawnTemporary && (creator.kind !== "human" || parent.isTemporary))
    throw new ForbiddenError(
      "Only a person can let a permanent agent's worker spawn further workers",
    );

  const [assigned] = await db
    .select()
    .from(agentCompanyAssignments)
    .where(
      and(
        eq(agentCompanyAssignments.agentId, parent.id),
        eq(agentCompanyAssignments.companyId, data.companyId),
      ),
    );
  if (parent.scope !== "global" && !assigned)
    throw new ForbiddenError("The parent agent does not serve this company");

  const [task] = await db.select().from(tasks).where(eq(tasks.id, data.taskId));
  if (!task) throw new NotFoundError("Task", data.taskId);
  if (task.companyId !== data.companyId)
    throw new ForbiddenError("The task belongs to a different company");
  if (["completed", "cancelled", "failed"].includes(task.status))
    throw new ConflictError("The task is already finished");

  if (data.expiresInHours > policy.tempAgentMaxExpiryHours)
    throw new ConflictError(
      `Temporary workers may live at most ${policy.tempAgentMaxExpiryHours} hours`,
    );
  if (data.budgetUsd > parent.perTaskBudget)
    throw new ForbiddenError(
      `Budget $${data.budgetUsd} exceeds the parent's per-task budget $${parent.perTaskBudget}`,
    );
  const [{ active }] = (await db
    .select({ active: sql<number>`count(*)::int` })
    .from(agents)
    .where(
      and(
        eq(agents.isTemporary, true),
        sql`${agents.status} not in ('expired','terminated')`,
        sql`${agents.id} in (select agent_id from agent_company_assignments where company_id = ${data.companyId})`,
      ),
    )) as [{ active: number }];
  if (active >= policy.maxActiveTempAgentsPerCompany)
    throw new ConflictError("The company's temporary-worker limit is reached");

  // Never more authority than the parent can exercise in this company.
  const authority = await loadAgentAuthorityInput(db, parent.id);
  const grants: { permission: string; effect: "allow" | "require_approval" }[] = [];
  for (const p of data.permissions) {
    if (!AGENT_PERMISSION_KEYS.has(p)) throw new ConflictError(`Unknown agent permission ${p}`);
    if (p === "action.create_temp_worker" && !data.maySpawnTemporary)
      throw new ForbiddenError(
        "Temporary workers cannot create workers unless explicitly permitted",
      );
    const d = evaluateAgentPermission(authority, data.companyId, p).decision;
    if (d === "deny") throw new ForbiddenError(`The parent agent cannot delegate ${p}`);
    grants.push({ permission: p, effect: d });
  }

  if (creator.kind === "agent") {
    const d = evaluateAgentPermission(authority, data.companyId, "action.create_temp_worker");
    if (d.decision === "deny")
      throw new ForbiddenError(`${parent.name} has no authority to create temporary workers`);
    const reasons: string[] = [];
    if (d.decision === "require_approval")
      reasons.push("Creating temporary workers is approval-gated for this agent");
    if (data.budgetUsd > policy.tempAgentApprovalBudgetUsd)
      reasons.push(
        `Budget $${data.budgetUsd} is above the $${policy.tempAgentApprovalBudgetUsd} temporary-worker approval threshold`,
      );
    if (reasons.length) {
      const [approval] = await db
        .insert(approvals)
        .values({
          companyId: data.companyId,
          taskId: data.taskId,
          agentId: parent.id,
          type: "custom",
          requestedAction: `Create temporary worker "${data.name}"`,
          explanation: `${data.purpose} — ${reasons.join("; ")}`,
          riskLevel: "medium",
          proposedChange: { temporaryAgent: data },
          requiredPermissions: ["approval.decide", "agent.create"],
        })
        .returning({ id: approvals.id });
      await recordAuditEvent(db, {
        ...actorAuditFields(creator.actor),
        companyId: data.companyId,
        agentId: parent.id,
        taskId: data.taskId,
        resourceType: "approval",
        resourceId: approval!.id,
        action: "temp_agent.approval_requested",
        description: `${parent.name} requested a temporary worker "${data.name}"`,
        metadata: { reasons },
      });
      return { status: "approval_required", approvalId: approval!.id, reasons };
    }
  }

  const autonomy =
    AUTONOMY_ORDER[
      Math.min(
        AUTONOMY_ORDER.indexOf(parent.autonomyLevel),
        AUTONOMY_ORDER.indexOf("limited_operator"),
      )
    ]!;
  const origin = opts.origin ?? "live";
  const agent = await db.transaction(async (tx) => {
    const id = randomUUID();
    const [row] = await tx
      .insert(agents)
      .values({
        id,
        name: data.name,
        slug: `temp-${id.slice(0, 8)}`,
        description: data.purpose,
        templateKey: parent.templateKey,
        scope: "company",
        status: "sleeping",
        departmentId: parent.departmentId,
        reportsToAgentId: parent.id,
        roleTemplateId: parent.roleTemplateId,
        primaryProvider: parent.primaryProvider,
        fallbackProvider: parent.fallbackProvider,
        autonomyLevel: autonomy,
        prohibitedActions: parent.prohibitedActions,
        approvalRequirements: parent.approvalRequirements,
        allowedTools: parent.allowedTools,
        capabilities: data.capabilities,
        perTaskBudget: data.budgetUsd,
        dailyBudget: data.budgetUsd,
        maxExternalSearches: parent.maxExternalSearches,
        maxRetries: Math.min(parent.maxRetries, 1),
        concurrencyLimit: data.concurrencyLimit,
        isTemporary: true,
        expiresAt: new Date(now.getTime() + data.expiresInHours * 3_600_000),
        parentAgentId: parent.id,
        boundTaskId: data.taskId,
        purpose: data.purpose,
        maySpawnTemporary: data.maySpawnTemporary,
        origin,
      })
      .returning();
    await tx
      .insert(agentCompanyAssignments)
      .values({ agentId: id, companyId: data.companyId, isPrimary: true });
    // Grants are company-scoped: the worker cannot act for any other company.
    if (grants.length)
      await tx.insert(agentPermissionGrants).values(
        grants.map((g) => ({
          agentId: id,
          companyId: data.companyId,
          permission: g.permission,
          effect: g.effect,
          origin,
        })),
      );
    await tx.insert(agentPermissionGrants).values({
      agentId: id,
      companyId: null,
      permission: "action.destructive",
      effect: "deny",
      origin,
    });
    await recordAuditEvent(
      tx,
      {
        ...actorAuditFields(creator.actor),
        companyId: data.companyId,
        agentId: id,
        taskId: data.taskId,
        resourceType: "agent",
        resourceId: id,
        action: "temp_agent.created",
        description: `Temporary worker "${data.name}" created under ${parent.name} (expires in ${data.expiresInHours}h, budget $${data.budgetUsd})`,
        metadata: {
          parentAgentId: parent.id,
          capabilities: data.capabilities,
          permissions: grants,
          creator: creator.kind,
        },
      },
      origin,
    );
    return row!;
  });
  return { status: "created", agent };
}

export async function terminateTemporaryAgent(
  db: Database,
  agentId: string,
  actor: Actor,
  reason?: string,
): Promise<void> {
  const [agent] = await db.select().from(agents).where(eq(agents.id, agentId));
  if (!agent) throw new NotFoundError("Agent", agentId);
  if (!agent.isTemporary) throw new ConflictError("Only temporary agents can be terminated");
  if (agent.status === "terminated") return;
  await db
    .update(agents)
    .set({ status: "terminated", terminatedAt: new Date() })
    .where(eq(agents.id, agentId));
  await refreshAgentStates(db, [agentId]);
  await recordAuditEvent(db, {
    ...actorAuditFields(actor),
    agentId,
    resourceType: "agent",
    resourceId: agentId,
    action: "temp_agent.terminated",
    description: `Temporary worker "${agent.name}" terminated${reason ? `: ${reason}` : ""}`,
  });
}
