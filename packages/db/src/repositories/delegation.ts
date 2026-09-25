import { and, desc, eq, gte, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { evaluateAgentPermission } from "@aibos/access-core";
import {
  decideDelegation,
  detectDuplicates,
  normalizeObjective,
  requiredPermissionsFor,
  type DelegationAgent,
  type DelegationRequest,
  type DelegationRequester,
} from "@aibos/delegation-core";
import {
  OPEN_TASK_STATUSES,
  assignTaskSchema,
  createWorkforceTaskSchema,
  delegateTaskSchema,
  taskRequirementsSchema,
  type AgentCapability,
  type CreateWorkforceTaskInput,
  type DelegationDecisionDTO,
  type DuplicateResult,
  type ManagerStatsDTO,
  type TaskDetailDTO,
  type TaskRequirementsInput,
} from "@aibos/shared";
import type { z } from "zod";
import type { Database } from "../client";
import { ConflictError, ForbiddenError, NotFoundError } from "../errors";
import {
  agentCompanyAssignments,
  agentMessages,
  agentRuns,
  agents,
  aiUsageRecords,
  approvals,
  auditEvents,
  companies,
  departments,
  handoffs,
  taskDelegations,
  tasks,
  teamMembers,
  teams,
  type Agent,
  type Task,
} from "../schema";
import { loadAgentAuthorityInput } from "./agent-authority";
import { getAgentRole } from "./agent-roles";
import { recordAuditEvent } from "./audit";
import { createTask, listTasks } from "./tasks";
import { startOfUtcDay, actorAuditFields, scopeWhere, type AccessScope, type Actor } from "./util";
import {
  activeAgentCounts,
  agentWorkloads,
  getWorkforcePolicy,
  refreshAgentStates,
} from "./workforce";

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Db = Database | Tx;

export async function requireTask(db: Db, id: string): Promise<Task> {
  const [t] = await db.select().from(tasks).where(eq(tasks.id, id));
  if (!t) throw new NotFoundError("Task", id);
  return t;
}

/* ---------- task creation with duplicate prevention ---------- */

async function openCompanyTasks(db: Db, companyId: string) {
  const since = new Date(Date.now() - 30 * 86_400_000);
  return db
    .select({
      id: tasks.id,
      title: tasks.title,
      description: tasks.description,
      companyId: tasks.companyId,
      type: tasks.type,
      status: tasks.status,
      targetEntity: tasks.targetEntity,
      departmentId: tasks.departmentId,
    })
    .from(tasks)
    .where(
      and(
        eq(tasks.companyId, companyId),
        or(
          inArray(tasks.status, [...OPEN_TASK_STATUSES]),
          and(eq(tasks.status, "completed"), gte(tasks.completedAt, since)),
        ),
      ),
    )
    .limit(500);
}

export interface CreateWorkforceTaskResult {
  task: Task | null;
  /** Existing task reused instead of creating new work. */
  reused: Task | null;
  duplicate: DuplicateResult;
}

/**
 * Creates a task with requirements. EXACT duplicates of active work are
 * reused (nothing new is created); LIKELY duplicates need `onDuplicate: "create"`.
 */
export async function createWorkforceTask(
  db: Database,
  input: CreateWorkforceTaskInput,
  actor: Actor,
): Promise<CreateWorkforceTaskResult> {
  const data = createWorkforceTaskSchema.parse(input);
  const existing = await openCompanyTasks(db, data.companyId);
  const duplicate = detectDuplicates(
    {
      companyId: data.companyId,
      title: data.title,
      type: data.type,
      targetEntity: data.requirements.targetEntity,
    },
    existing,
  );
  const top = duplicate.matches[0];
  if (
    top &&
    (duplicate.level === "exact_duplicate" ||
      (duplicate.level === "likely_duplicate" && data.onDuplicate === "reuse"))
  ) {
    await recordAuditEvent(db, {
      ...actorAuditFields(actor),
      companyId: data.companyId,
      taskId: top.taskId,
      resourceType: "task",
      resourceId: top.taskId,
      action: "task.duplicate_detected",
      description: `Duplicate task avoided: "${data.title}" matches "${top.title}" (${duplicate.level.replace(/_/g, " ")})`,
      metadata: { level: duplicate.level, similarity: top.similarity, requestedTitle: data.title },
    });
    if (duplicate.level === "exact_duplicate")
      return { task: null, reused: await requireTask(db, top.taskId), duplicate };
    return { task: null, reused: null, duplicate };
  }
  const created = await createTask(
    db,
    {
      companyId: data.companyId,
      title: data.title,
      description: data.description ?? undefined,
      type: data.type,
      priority: data.priority,
      parentTaskId: data.parentTaskId ?? undefined,
      dueAt: data.dueAt ?? undefined,
      estimatedCost: data.requirements.maxBudget ?? undefined,
    },
    actor,
  );
  await db
    .update(tasks)
    .set({
      ...requirementColumns(data.requirements),
      normalizedObjective: normalizeObjective(data.title),
    })
    .where(eq(tasks.id, created.id));
  return { task: await requireTask(db, created.id), reused: null, duplicate };
}

function requirementColumns(input: TaskRequirementsInput) {
  const r = taskRequirementsSchema.parse(input);
  return {
    requiredCapabilities: r.requiredCapabilities,
    preferredDepartmentId: r.preferredDepartmentId,
    preferredAgentId: r.preferredAgentId,
    preferredTeamId: r.preferredTeamId,
    providerPreference: r.providerPreference,
    maxBudget: r.maxBudget,
    maxConcurrency: r.maxConcurrency,
    delegationAllowed: r.delegationAllowed,
    parallelAllowed: r.parallelAllowed,
    externalActionAllowed: r.externalActionAllowed,
    approvalRequirements: r.approvalRequirements,
    resultSchema: r.resultSchema,
    stoppingCondition: r.stoppingCondition,
    expectedOutcome: r.expectedOutcome,
    targetEntity: r.targetEntity,
    workItems: r.workItems,
  };
}

export async function updateTaskRequirements(
  db: Database,
  taskId: string,
  input: TaskRequirementsInput,
  actor: Actor,
): Promise<void> {
  const cols = requirementColumns(input);
  await db.transaction(async (tx) => {
    const t = await requireTask(tx, taskId);
    await tx.update(tasks).set(cols).where(eq(tasks.id, taskId));
    await recordAuditEvent(tx, {
      ...actorAuditFields(actor),
      companyId: t.companyId ?? undefined,
      taskId,
      resourceType: "task",
      resourceId: taskId,
      action: "task.requirements_updated",
      description: `Requirements updated for "${t.title}"`,
      after: cols,
    });
  });
}

/* ---------- task detail ---------- */

export async function getTaskDetail(
  db: Database,
  id: string,
  opts: { scope: AccessScope; viewer: TaskDetailDTO["viewer"] },
): Promise<TaskDetailDTO> {
  const [dto] = await listTasks(db, { ids: [id], scope: opts.scope });
  if (!dto) throw new NotFoundError("Task", id);
  const t = await requireTask(db, id);
  const refIds = [t.preferredAgentId, t.delegatedFromAgentId, t.claimedByAgentId].filter(
    (x): x is string => !!x,
  );
  const [agentNames, deptRows, teamRows, delegationRows] = await Promise.all([
    refIds.length
      ? db
          .select({ id: agents.id, name: agents.name })
          .from(agents)
          .where(inArray(agents.id, refIds))
      : [],
    db
      .select({ id: departments.id, name: departments.name })
      .from(departments)
      .where(
        inArray(
          departments.id,
          [t.preferredDepartmentId, t.departmentId]
            .filter((x): x is string => !!x)
            .concat("00000000-0000-0000-0000-000000000000"),
        ),
      ),
    db
      .select({ id: teams.id, name: teams.name })
      .from(teams)
      .where(
        inArray(
          teams.id,
          [t.preferredTeamId, t.teamId]
            .filter((x): x is string => !!x)
            .concat("00000000-0000-0000-0000-000000000000"),
        ),
      ),
    listDelegations(db, id),
  ]);
  const name = (list: { id: string; name: string }[], idv: string | null) =>
    idv ? (list.find((x) => x.id === idv) ?? null) : null;
  return {
    ...dto,
    requirements: {
      requiredCapabilities: t.requiredCapabilities as AgentCapability[],
      preferredDepartment: name(deptRows, t.preferredDepartmentId),
      preferredAgent: name(agentNames, t.preferredAgentId),
      preferredTeam: name(teamRows, t.preferredTeamId),
      providerPreference: t.providerPreference,
      maxBudget: t.maxBudget,
      maxConcurrency: t.maxConcurrency,
      delegationAllowed: t.delegationAllowed,
      parallelAllowed: t.parallelAllowed,
      externalActionAllowed: t.externalActionAllowed,
      approvalRequirements: t.approvalRequirements,
      resultSchema: t.resultSchema,
      stoppingCondition: t.stoppingCondition,
      expectedOutcome: t.expectedOutcome,
      targetEntity: t.targetEntity,
      workItems: t.workItems,
    },
    department: name(deptRows, t.departmentId),
    team: name(teamRows, t.teamId),
    delegationDepth: t.delegationDepth,
    delegatedFrom: name(agentNames, t.delegatedFromAgentId),
    claim:
      t.claimedByAgentId && t.claimedAt
        ? {
            agentId: t.claimedByAgentId,
            agentName: name(agentNames, t.claimedByAgentId)?.name ?? "—",
            claimedAt: t.claimedAt.toISOString(),
            leaseExpiresAt: t.leaseExpiresAt?.toISOString() ?? null,
          }
        : null,
    delegations: delegationRows,
    viewer: opts.viewer,
  };
}

async function listDelegations(db: Db, taskId: string): Promise<TaskDetailDTO["delegations"]> {
  const fromA = alias(agents, "from_agent");
  const toA = alias(agents, "to_agent");
  const rows = await db
    .select({
      d: taskDelegations,
      fromName: fromA.name,
      toName: toA.name,
      teamName: teams.name,
      decidedBy: sql<
        string | null
      >`(select email from users u where u.id = ${taskDelegations.decidedByUserId})`,
    })
    .from(taskDelegations)
    .leftJoin(fromA, eq(fromA.id, taskDelegations.fromAgentId))
    .leftJoin(toA, eq(toA.id, taskDelegations.toAgentId))
    .leftJoin(teams, eq(teams.id, taskDelegations.toTeamId))
    .where(eq(taskDelegations.taskId, taskId))
    .orderBy(desc(taskDelegations.createdAt));
  return rows.map(({ d, fromName, toName, teamName, decidedBy }) => ({
    id: d.id,
    outcome: d.outcome,
    from: d.fromAgentId && fromName ? { id: d.fromAgentId, name: fromName } : null,
    to:
      d.toTeamId && teamName
        ? { id: d.toTeamId, name: teamName, kind: "team" as const }
        : d.toAgentId && toName
          ? { id: d.toAgentId, name: toName, kind: "agent" as const }
          : null,
    override: d.override,
    reason: d.reason,
    decidedBy,
    createdAt: d.createdAt.toISOString(),
  }));
}

/* ---------- delegation request ---------- */

async function companyIdsOf(db: Db, agentIds: string[]) {
  const rows = agentIds.length
    ? await db
        .select({
          agentId: agentCompanyAssignments.agentId,
          companyId: agentCompanyAssignments.companyId,
        })
        .from(agentCompanyAssignments)
        .where(inArray(agentCompanyAssignments.agentId, agentIds))
    : [];
  const map = new Map<string, string[]>();
  for (const r of rows) map.set(r.agentId, [...(map.get(r.agentId) ?? []), r.companyId]);
  return map;
}

/** Default requester: the explicit agent, the task's assignee, the company manager, else the group manager. */
async function resolveRequester(db: Db, task: Task, explicit?: string): Promise<Agent> {
  const companyId = task.companyId!;
  const byId = async (id: string) => (await db.select().from(agents).where(eq(agents.id, id)))[0];
  if (explicit) {
    const a = await byId(explicit);
    if (!a) throw new NotFoundError("Agent", explicit);
    return a;
  }
  if (task.assignedAgentId) {
    const a = await byId(task.assignedAgentId);
    if (a) return a;
  }
  const managers = await db
    .select({ a: agents, companyId: agentCompanyAssignments.companyId })
    .from(agents)
    .leftJoin(agentCompanyAssignments, eq(agentCompanyAssignments.agentId, agents.id))
    .where(
      and(
        eq(agents.templateKey, "company_manager"),
        inArray(agents.status, [
          "sleeping",
          "queued",
          "working",
          "waiting",
          "needs_approval",
          "blocked",
        ]),
      ),
    );
  const company = managers.find((m) => m.a.scope === "company" && m.companyId === companyId);
  const group = managers.find((m) => m.a.scope === "global");
  const pick = company?.a ?? group?.a;
  if (!pick) throw new ConflictError("No manager agent is available to route this task");
  return pick;
}

async function toDelegationAgent(
  db: Db,
  a: Agent,
  ctx: {
    companyId: string;
    companyMap: Map<string, string[]>;
    teamMap: Map<string, string[]>;
    deptSlug: Map<string, string>;
    spent: Map<string, number>;
    workloads: Awaited<ReturnType<typeof agentWorkloads>>;
    perms: string[];
  },
): Promise<DelegationAgent> {
  const input = await loadAgentAuthorityInput(db as Database, a.id);
  const permissions: DelegationAgent["permissions"] = {};
  for (const p of ctx.perms)
    permissions[p] = evaluateAgentPermission(input, ctx.companyId, p).decision;
  const w = ctx.workloads.get(a.id);
  return {
    agentId: a.id,
    name: a.name,
    templateKey: a.templateKey,
    scope: a.scope,
    companyIds: ctx.companyMap.get(a.id) ?? [],
    departmentId: a.departmentId,
    departmentSlug: a.departmentId ? (ctx.deptSlug.get(a.departmentId) ?? null) : null,
    teamIds: ctx.teamMap.get(a.id) ?? [],
    capabilities: a.capabilities as AgentCapability[],
    status: a.status,
    isTemporary: a.isTemporary,
    expiresAt: a.expiresAt,
    boundTaskId: a.boundTaskId,
    permissions,
    workload: { active: w?.active ?? 0, queued: w?.queued ?? 0, capacity: a.concurrencyLimit },
    perTaskBudget: a.perTaskBudget,
    dailyBudget: a.dailyBudget,
    spentToday: ctx.spent.get(a.id) ?? 0,
  };
}

export async function buildDelegationRequest(
  db: Database,
  taskId: string,
  opts: { requestingAgentId?: string; now?: Date } = {},
): Promise<{ request: DelegationRequest; task: Task }> {
  const now = opts.now ?? new Date();
  const task = await requireTask(db, taskId);
  if (!task.companyId)
    throw new ConflictError("Group-level tasks cannot be delegated to a single company workforce");
  const companyId = task.companyId;
  const [company] = await db.select().from(companies).where(eq(companies.id, companyId));
  const requesterRow = await resolveRequester(db, task, opts.requestingAgentId);
  const policy = await getWorkforcePolicy(db);

  const candidateRows = await db
    .select()
    .from(agents)
    .where(
      and(
        or(
          eq(agents.scope, "global"),
          sql`${agents.id} in (select agent_id from agent_company_assignments where company_id = ${companyId})`,
        ),
        sql`${agents.status} not in ('terminated')`,
      ),
    );
  const all = candidateRows.some((c) => c.id === requesterRow.id)
    ? candidateRows
    : [...candidateRows, requesterRow];
  const ids = all.map((a) => a.id);
  const [
    companyMap,
    teamRows,
    deptRows,
    spentRows,
    workloads,
    teamList,
    delegRows,
    tree,
    active,
    tempCount,
  ] = await Promise.all([
    companyIdsOf(db, ids),
    db.select().from(teamMembers).where(inArray(teamMembers.agentId, ids)),
    db.select().from(departments),
    db
      .select({
        agentId: aiUsageRecords.agentId,
        spent: sql<number>`coalesce(sum(${aiUsageRecords.actualCost}),0)::float8`,
      })
      .from(aiUsageRecords)
      .where(
        and(
          inArray(aiUsageRecords.agentId, ids),
          gte(aiUsageRecords.occurredAt, startOfUtcDay(now)),
        ),
      )
      .groupBy(aiUsageRecords.agentId),
    agentWorkloads(db, ids),
    db
      .select({
        t: teams,
        activeTasks: sql<number>`(select count(*)::int from ${tasks} where ${tasks.teamId} = ${teams.id} and ${tasks.status} in ('running','waiting','needs_approval','assigned','queued'))`,
      })
      .from(teams)
      .where(or(eq(teams.companyId, companyId), isNull(teams.companyId))),
    db
      .select({ from: taskDelegations.fromAgentId, to: taskDelegations.toAgentId })
      .from(taskDelegations)
      .where(eq(taskDelegations.taskId, taskId)),
    db
      .select({ id: tasks.id })
      .from(tasks)
      .where(
        or(
          eq(tasks.rootTaskId, task.rootTaskId ?? task.id),
          eq(tasks.id, task.rootTaskId ?? task.id),
        ),
      ),
    activeAgentCounts(db, companyId),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(agents)
      .where(
        and(
          eq(agents.isTemporary, true),
          sql`${agents.status} not in ('expired','terminated')`,
          sql`${agents.id} in (select agent_id from agent_company_assignments where company_id = ${companyId})`,
        ),
      ),
  ]);
  const teamMap = new Map<string, string[]>();
  for (const r of teamRows) teamMap.set(r.agentId, [...(teamMap.get(r.agentId) ?? []), r.teamId]);
  const deptSlug = new Map(deptRows.map((d) => [d.id, d.slug]));
  const spent = new Map(spentRows.filter((s) => s.agentId).map((s) => [s.agentId!, s.spent]));

  const reqs = {
    requiredCapabilities: task.requiredCapabilities as AgentCapability[],
    externalActionAllowed: task.externalActionAllowed,
  };
  const perms = [...requiredPermissionsFor(reqs), "action.create_temp_worker"];
  const ctx = { companyId, companyMap, teamMap, deptSlug, spent, workloads, perms };
  const candidates = await Promise.all(all.map((a) => toDelegationAgent(db, a, ctx)));
  const requesterBase = candidates.find((c) => c.agentId === requesterRow.id)!;
  const role = await getAgentRole(db, requesterRow.id, { viewerCanManage: false });
  const requester: DelegationRequester = {
    ...requesterBase,
    delegation: {
      mayDelegate: role.templateRole.delegation.mayDelegate && role.role.delegation.mayDelegate,
      allowedDelegates: role.role.delegation.allowedDelegates,
      allowedDepartments: role.role.delegation.allowedDepartments,
      maxDepth: Math.min(role.templateRole.delegation.maxDepth, role.role.delegation.maxDepth),
    },
    maySpawnTemporary: requesterRow.maySpawnTemporary,
  };

  const deptActive = await db
    .select({ id: tasks.departmentId, n: sql<number>`count(*)::int` })
    .from(tasks)
    .where(
      and(
        inArray(tasks.status, ["running", "waiting", "needs_approval"]),
        sql`${tasks.departmentId} is not null`,
      ),
    )
    .groupBy(tasks.departmentId);
  const departmentsConc: DelegationRequest["concurrency"]["departments"] = {};
  for (const d of deptRows)
    departmentsConc[d.id] = {
      active: deptActive.find((x) => x.id === d.id)?.n ?? 0,
      limit: d.concurrencyLimit,
    };

  const [companySpend] = await db
    .select({ s: sql<number>`coalesce(sum(${aiUsageRecords.actualCost}),0)::float8` })
    .from(aiUsageRecords)
    .where(
      and(
        eq(aiUsageRecords.companyId, companyId),
        gte(aiUsageRecords.occurredAt, startOfUtcDay(now)),
      ),
    );

  const chain = [
    ...new Set(
      delegRows
        .flatMap((d) => [d.from, d.to])
        .filter((x): x is string => !!x && x !== requesterRow.id),
    ),
  ];
  const openTasks = await openCompanyTasks(db, companyId);

  const request: DelegationRequest = {
    now,
    requester,
    task: {
      id: task.id,
      companyId,
      title: task.title,
      type: task.type,
      priority: task.priority,
      requiredCapabilities: reqs.requiredCapabilities,
      preferredDepartmentId: task.preferredDepartmentId,
      preferredAgentId: task.preferredAgentId,
      preferredTeamId: task.preferredTeamId,
      maxBudget: task.maxBudget,
      estimatedCost: task.estimatedCost,
      delegationAllowed: task.delegationAllowed,
      parallelAllowed: task.parallelAllowed,
      externalActionAllowed: task.externalActionAllowed,
      requiresApproval: task.requiresApproval,
      delegationDepth: task.delegationDepth,
      targetEntity: task.targetEntity,
      departmentId: task.departmentId,
      workItems: task.workItems,
    },
    candidates,
    teams: teamList.map(({ t, activeTasks }) => ({
      id: t.id,
      name: t.name,
      companyId: t.companyId,
      departmentId: t.departmentId,
      leaderAgentId: t.leaderAgentId,
      memberIds: teamRows.filter((m) => m.teamId === t.id).map((m) => m.agentId),
      concurrencyLimit: t.concurrencyLimit,
      activeTasks,
      active: t.active,
    })),
    concurrency: {
      global: { active: active.global, limit: policy.globalActiveAgentLimit },
      company: { active: active.company, limit: company?.concurrencyLimit ?? 1 },
      departments: departmentsConc,
    },
    budget: {
      companyDailyRemaining: Math.max(0, (company?.dailyAiBudget ?? 0) - (companySpend?.s ?? 0)),
      departmentRemaining: Object.fromEntries(deptRows.map((d) => [d.id, d.dailyBudgetUsd])),
      highCostThresholdUsd: policy.highCostTaskThresholdUsd,
      tempAgentApprovalBudgetUsd: policy.tempAgentApprovalBudgetUsd,
    },
    chain,
    maxDepth: policy.maxDelegationDepth,
    openTasks,
    relatedTaskIds: tree.map((x) => x.id),
    policy: {
      tempWorkerMinItems: 20,
      activeTempAgents: tempCount[0]?.n ?? 0,
      maxTempAgents: policy.maxActiveTempAgentsPerCompany,
    },
  };
  return { request, task };
}

export async function previewDelegation(
  db: Database,
  taskId: string,
  opts: { requestingAgentId?: string; now?: Date } = {},
): Promise<DelegationDecisionDTO> {
  const { request } = await buildDelegationRequest(db, taskId, opts);
  return decideDelegation(request);
}

/* ---------- executing delegation / assignment ---------- */

const HARD_CHECKS = new Set(["company", "status", "circular", "permission"]);

async function applyAssignment(
  tx: Tx,
  task: Task,
  target: { agentId: string; teamId: string | null },
  meta: {
    outcome: DelegationDecisionDTO["outcome"];
    fromAgentId: string | null;
    override: boolean;
    reason: string | null;
    explanation: string[];
    depthIncrement: number;
  },
  actor: Actor,
) {
  const [agent] = await tx.select().from(agents).where(eq(agents.id, target.agentId));
  if (!agent) throw new NotFoundError("Agent", target.agentId);
  await tx
    .update(tasks)
    .set({
      assignedAgentId: agent.id,
      teamId: target.teamId,
      departmentId: agent.departmentId,
      status: task.status === "queued" ? "assigned" : task.status,
      delegationDepth: task.delegationDepth + meta.depthIncrement,
      delegatedFromAgentId: meta.fromAgentId,
      // A new owner means any previous claim is void.
      claimedByAgentId: null,
      claimedAt: null,
      leaseExpiresAt: null,
    })
    .where(eq(tasks.id, task.id));
  const [row] = await tx
    .insert(taskDelegations)
    .values({
      taskId: task.id,
      companyId: task.companyId,
      fromAgentId: meta.fromAgentId,
      toAgentId: agent.id,
      toTeamId: target.teamId,
      outcome: meta.outcome,
      override: meta.override,
      reason: meta.reason,
      explanation: meta.explanation,
      decidedByUserId: actor.userId ?? null,
    })
    .returning();
  await tx.insert(agentMessages).values({
    companyId: task.companyId,
    senderType: meta.fromAgentId ? "agent" : actor.kind === "human" ? "human" : "system",
    senderAgentId: meta.fromAgentId,
    senderUserId: actor.userId ?? null,
    recipientAgentId: agent.id,
    taskId: task.id,
    type: "task_instruction",
    content: `You have been assigned "${task.title}".${meta.reason ? ` Note: ${meta.reason}` : ""}`,
    payload: { delegationId: row!.id, outcome: meta.outcome },
  });
  const verb =
    meta.outcome === "handle_self" ? "kept by" : meta.override ? "reassigned to" : "delegated to";
  await recordAuditEvent(tx, {
    ...actorAuditFields(actor),
    companyId: task.companyId ?? undefined,
    taskId: task.id,
    agentId: agent.id,
    resourceType: "task",
    resourceId: task.id,
    action:
      meta.override || meta.outcome === "require_human_review"
        ? "task.reassigned"
        : "task.delegated",
    description: `Task "${task.title}" ${verb} ${agent.name}${target.teamId ? " (team)" : ""}`,
    metadata: {
      outcome: meta.outcome,
      fromAgentId: meta.fromAgentId,
      teamId: target.teamId,
      override: meta.override,
      reason: meta.reason,
    },
  });
  await refreshAgentStates(tx, [agent.id, ...(task.assignedAgentId ? [task.assignedAgentId] : [])]);
  return row!.id;
}

/**
 * Delegates a task. Without a target, the engine's recommendation is applied.
 * With a target, it is an override: soft checks (capability, capacity, budget,
 * delegation scope) may be overridden with a reason; hard checks (company,
 * availability, circular delegation, permissions) never.
 */
export async function delegateTask(
  db: Database,
  taskId: string,
  input: z.input<typeof delegateTaskSchema>,
  actor: Actor,
): Promise<{ decision: DelegationDecisionDTO; delegationId: string }> {
  const data = delegateTaskSchema.parse(input);
  const { request, task } = await buildDelegationRequest(db, taskId, {
    requestingAgentId: data.requestingAgentId,
  });
  const decision = decideDelegation(request);
  const block = async (message: string, forbidden = false) => {
    await recordAuditEvent(db, {
      ...actorAuditFields(actor),
      companyId: task.companyId ?? undefined,
      taskId,
      resourceType: "task",
      resourceId: taskId,
      action: "delegation.blocked",
      description: `Delegation blocked for "${task.title}": ${message}`,
      outcome: "failure",
      metadata: { outcome: decision.outcome, explanation: decision.explanation },
    });
    // Company-isolation failures are authorisation errors; the rest are state conflicts.
    return forbidden ? new ForbiddenError(message) : new ConflictError(message);
  };

  let target: { agentId: string; teamId: string | null };
  let override = false;
  if (data.targetTeamId) {
    const team = request.teams.find((t) => t.id === data.targetTeamId);
    if (!team) throw await block("The team does not serve this company", true);
    const members = decision.candidates.filter(
      (c) => c.eligible && team.memberIds.includes(c.agentId),
    );
    const lead = members.find((m) => m.agentId === team.leaderAgentId) ?? members[0];
    if (!lead) throw await block(`No eligible member in team "${team.name}"`);
    override = decision.target?.id !== team.id;
    target = { agentId: lead.agentId, teamId: team.id };
  } else if (data.targetAgentId) {
    const ev =
      data.targetAgentId === request.requester.agentId
        ? { checks: [], eligible: true, name: request.requester.name }
        : decision.candidates.find((c) => c.agentId === data.targetAgentId);
    if (!ev) throw await block("The agent does not serve this company", true);
    const hard = ev.checks.filter((c) => !c.passed && HARD_CHECKS.has(c.check));
    if (hard.length)
      throw await block(
        `${ev.name}: ${hard.map((h) => h.detail).join("; ")}`,
        hard.some((h) => h.check === "company"),
      );
    override = decision.target?.id !== data.targetAgentId;
    if (override && !ev.eligible && !data.reason)
      throw await block("Overriding a failed check requires a reason");
    target = { agentId: data.targetAgentId, teamId: null };
  } else {
    if (decision.outcome === "blocked" || decision.outcome === "require_human_review")
      throw await block(decision.explanation.at(-1) ?? "No eligible delegate");
    if (decision.outcome === "create_temporary_worker")
      throw await block(
        "The recommendation is a temporary worker — create it first, then delegate to it",
      );
    if (decision.outcome === "delegate_to_team") {
      const team = request.teams.find((t) => t.id === decision.target!.id)!;
      const members = decision.candidates.filter(
        (c) => c.eligible && team.memberIds.includes(c.agentId),
      );
      const lead = members.find((m) => m.agentId === team.leaderAgentId) ?? members[0]!;
      target = { agentId: lead.agentId, teamId: team.id };
    } else target = { agentId: decision.target!.id!, teamId: null };
  }
  if (decision.budget.decision === "blocked") throw await block(decision.budget.reasons.join("; "));

  const delegationId = await db.transaction(async (tx) => {
    // Re-read under lock so two concurrent delegations cannot both win.
    const [locked] = await tx.select().from(tasks).where(eq(tasks.id, taskId)).for("update");
    if (!locked || locked.updatedAt.getTime() !== task.updatedAt.getTime())
      throw new ConflictError("The task changed while delegating — refresh and try again");
    const isSelf = target.agentId === request.requester.agentId;
    return applyAssignment(
      tx,
      locked,
      target,
      {
        outcome: isSelf ? "handle_self" : target.teamId ? "delegate_to_team" : "delegate_to_agent",
        fromAgentId: request.requester.agentId,
        override,
        reason: data.reason ?? null,
        explanation: decision.explanation,
        depthIncrement: isSelf ? 0 : 1,
      },
      actor,
    );
  });
  return { decision, delegationId };
}

/** Manual assignment by a person (hard constraints still apply). */
export async function assignTask(
  db: Database,
  taskId: string,
  input: z.input<typeof assignTaskSchema>,
  actor: Actor,
): Promise<void> {
  const data = assignTaskSchema.parse(input);
  const task = await requireTask(db, taskId);
  if (!task.companyId)
    throw new ConflictError("Group-level tasks cannot be assigned to a company agent");
  const [agent] = await db.select().from(agents).where(eq(agents.id, data.agentId));
  if (!agent) throw new NotFoundError("Agent", data.agentId);
  const companyIds = (await companyIdsOf(db, [agent.id])).get(agent.id) ?? [];
  if (agent.scope !== "global" && !companyIds.includes(task.companyId))
    throw new ForbiddenError("The agent does not serve this company");
  if (["paused", "offline", "failed", "expired", "terminated"].includes(agent.status))
    throw new ConflictError(`The agent is ${agent.status} and cannot take work`);
  await db.transaction(async (tx) => {
    await applyAssignment(
      tx,
      task,
      { agentId: agent.id, teamId: null },
      {
        outcome: "delegate_to_agent",
        fromAgentId: null,
        override: true,
        reason: data.reason ?? null,
        explanation: ["Manual assignment by a person"],
        depthIncrement: 0,
      },
      actor,
    );
  });
}

export async function setTaskStatus(
  db: Database,
  taskId: string,
  status: "paused" | "queued" | "completed" | "cancelled",
  actor: Actor,
  opts: { resultSummary?: string } = {},
): Promise<void> {
  await db.transaction(async (tx) => {
    const t = await requireTask(tx, taskId);
    const done = status === "completed" || status === "cancelled";
    await tx
      .update(tasks)
      .set({
        status,
        ...(status === "completed"
          ? {
              completedAt: new Date(),
              progress: 100,
              resultSummary: opts.resultSummary ?? t.resultSummary,
            }
          : {}),
        ...(done ? { claimedByAgentId: null, claimedAt: null, leaseExpiresAt: null } : {}),
      })
      .where(eq(tasks.id, taskId));
    await recordAuditEvent(tx, {
      ...actorAuditFields(actor),
      companyId: t.companyId ?? undefined,
      taskId,
      resourceType: "task",
      resourceId: taskId,
      action: `task.${status === "queued" ? "resumed" : status}`,
      description: `Task "${t.title}" ${status === "queued" ? "resumed" : status}`,
      metadata: { previousStatus: t.status },
    });
    if (done) {
      // Temporary workers bound to a finished task terminate with it.
      const workers = await tx
        .update(agents)
        .set({ status: "terminated", terminatedAt: new Date() })
        .where(
          and(
            eq(agents.boundTaskId, taskId),
            eq(agents.isTemporary, true),
            sql`${agents.status} not in ('expired','terminated')`,
          ),
        )
        .returning({ id: agents.id, name: agents.name });
      for (const w of workers)
        await recordAuditEvent(tx, {
          ...actorAuditFields(actor),
          companyId: t.companyId ?? undefined,
          agentId: w.id,
          resourceType: "agent",
          resourceId: w.id,
          action: "temp_agent.terminated",
          description: `Temporary agent "${w.name}" terminated: its task is ${status}`,
        });
    }
    if (t.assignedAgentId) await refreshAgentStates(tx, [t.assignedAgentId]);
  });
}

/* ---------- task claiming (atomic; lease prepared for the execution stage) ---------- */

/**
 * Atomically claims a task for the agent it is assigned to. Succeeds only when
 * the task is unclaimed or the previous lease expired, and the agent is under
 * its concurrency limit. Returns false when someone else holds it.
 */
export async function claimTask(
  db: Database,
  taskId: string,
  agentId: string,
  opts: { leaseSeconds?: number; now?: Date } = {},
): Promise<boolean> {
  const now = opts.now ?? new Date();
  const lease = new Date(now.getTime() + (opts.leaseSeconds ?? 300) * 1000);
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`agent-claims:${agentId}`}))`);
    const [agent] = await tx.select().from(agents).where(eq(agents.id, agentId));
    if (!agent) throw new NotFoundError("Agent", agentId);
    const [{ held }] = (await tx
      .select({ held: sql<number>`count(*)::int` })
      .from(tasks)
      .where(
        and(
          eq(tasks.claimedByAgentId, agentId),
          sql`${tasks.leaseExpiresAt} > ${now.toISOString()}::timestamptz`,
        ),
      )) as [{ held: number }];
    if (held >= agent.concurrencyLimit) return false;
    const claimed = await tx
      .update(tasks)
      .set({ claimedByAgentId: agentId, claimedAt: now, leaseExpiresAt: lease })
      .where(
        and(
          eq(tasks.id, taskId),
          eq(tasks.assignedAgentId, agentId),
          or(
            isNull(tasks.claimedByAgentId),
            lt(tasks.leaseExpiresAt, now),
            eq(tasks.claimedByAgentId, agentId),
          ),
        ),
      )
      .returning({ id: tasks.id });
    return claimed.length === 1;
  });
}

export async function releaseTask(db: Database, taskId: string, agentId: string): Promise<boolean> {
  const released = await db
    .update(tasks)
    .set({ claimedByAgentId: null, claimedAt: null, leaseExpiresAt: null })
    .where(and(eq(tasks.id, taskId), eq(tasks.claimedByAgentId, agentId)))
    .returning({ id: tasks.id });
  return released.length === 1;
}

/** Recovery: releases claims whose lease expired (e.g. a crashed worker). */
export async function recoverExpiredClaims(db: Database, now = new Date()): Promise<number> {
  const rows = await db
    .update(tasks)
    .set({ claimedByAgentId: null, claimedAt: null, leaseExpiresAt: null })
    .where(and(sql`${tasks.claimedByAgentId} is not null`, lt(tasks.leaseExpiresAt, now)))
    .returning({ id: tasks.id });
  return rows.length;
}

/* ---------- manager dashboard ---------- */

export async function managerStats(
  db: Database,
  opts: { scope: AccessScope; companyId?: string | null },
): Promise<ManagerStatsDTO> {
  const since = new Date(Date.now() - 30 * 86_400_000);
  const companyCond = opts.companyId
    ? eq(taskDelegations.companyId, opts.companyId)
    : scopeWhere(taskDelegations.companyId, opts.scope);
  const [deleg] = await db
    .select({
      received: sql<number>`count(distinct ${taskDelegations.taskId})::int`,
      self: sql<number>`count(*) filter (where ${taskDelegations.outcome} = 'handle_self')::int`,
      delegated: sql<number>`count(*) filter (where ${taskDelegations.outcome} in ('delegate_to_agent','delegate_to_team'))::int`,
    })
    .from(taskDelegations)
    .where(and(companyCond, gte(taskDelegations.createdAt, since)));
  const [dups] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(auditEvents)
    .where(
      and(
        eq(auditEvents.action, "task.duplicate_detected"),
        opts.companyId
          ? eq(auditEvents.companyId, opts.companyId)
          : scopeWhere(auditEvents.companyId, opts.scope),
        gte(auditEvents.occurredAt, since),
      ),
    );
  const [approvalsWaiting] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(approvals)
    .where(
      and(
        eq(approvals.status, "pending"),
        opts.companyId
          ? eq(approvals.companyId, opts.companyId)
          : scopeWhere(approvals.companyId, opts.scope),
      ),
    );
  const tempCond = opts.companyId
    ? sql`${agents.id} in (select agent_id from agent_company_assignments where company_id = ${opts.companyId})`
    : opts.scope.companyIds === "all"
      ? undefined
      : opts.scope.companyIds.length
        ? sql`${agents.id} in (select agent_id from agent_company_assignments where company_id in (${sql.join(
            opts.scope.companyIds.map((c) => sql`${c}::uuid`),
            sql`, `,
          )}))`
        : sql`false`;
  const [temps] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(agents)
    .where(
      and(
        eq(agents.isTemporary, true),
        sql`${agents.status} not in ('expired','terminated')`,
        tempCond,
      ),
    );
  const [pending] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(handoffs)
    .where(
      and(
        eq(handoffs.status, "pending"),
        opts.companyId
          ? eq(handoffs.companyId, opts.companyId)
          : scopeWhere(handoffs.companyId, opts.scope),
      ),
    );
  const policy = await getWorkforcePolicy(db);
  const active = await activeAgentCounts(db, opts.companyId ?? null);
  const [manager] = await db
    .select({ id: agents.id, name: agents.name })
    .from(agents)
    .where(
      and(
        eq(agents.templateKey, "company_manager"),
        opts.companyId
          ? sql`${agents.id} in (select agent_id from agent_company_assignments where company_id = ${opts.companyId})`
          : eq(agents.scope, "global"),
      ),
    )
    .limit(1);
  // Stage 05: real execution figures (today, UTC). Mock runs are labelled, never counted as spend.
  const day = new Date();
  day.setUTCHours(0, 0, 0, 0);
  const runScope = opts.companyId
    ? eq(agentRuns.companyId, opts.companyId)
    : scopeWhere(agentRuns.companyId, opts.scope);
  const [runs] = await db
    .select({
      today: sql<number>`count(*) filter (where ${agentRuns.createdAt} >= ${day.toISOString()}::timestamptz and not ${agentRuns.isMock})::int`,
      mockToday: sql<number>`count(*) filter (where ${agentRuns.createdAt} >= ${day.toISOString()}::timestamptz and ${agentRuns.isMock})::int`,
      completed: sql<number>`count(*) filter (where ${agentRuns.createdAt} >= ${day.toISOString()}::timestamptz and ${agentRuns.status} = 'completed')::int`,
      failed: sql<number>`count(*) filter (where ${agentRuns.createdAt} >= ${day.toISOString()}::timestamptz and ${agentRuns.status} in ('failed','needs_review'))::int`,
      waiting: sql<number>`count(*) filter (where ${agentRuns.status} in ('queued','preparing','routing','running','streaming','waiting','cancel_requested'))::int`,
      spend: sql<number>`coalesce(sum(${agentRuns.actualCost}) filter (where ${agentRuns.createdAt} >= ${day.toISOString()}::timestamptz and not ${agentRuns.isMock}), 0)::float8`,
      activeAgents: sql<number>`count(distinct ${agentRuns.agentId}) filter (where ${agentRuns.status} in ('preparing','routing','running','streaming'))::int`,
    })
    .from(agentRuns)
    .where(runScope);
  return {
    manager: manager ?? null,
    runsToday: runs?.today ?? 0,
    mockRunsToday: runs?.mockToday ?? 0,
    runsCompletedToday: runs?.completed ?? 0,
    runsFailedToday: runs?.failed ?? 0,
    runsInProgress: runs?.waiting ?? 0,
    providerSpendTodayUsd: Math.round((runs?.spend ?? 0) * 10_000) / 10_000,
    agentsExecuting: runs?.activeAgents ?? 0,
    tasksReceived: deleg?.received ?? 0,
    handledDirectly: deleg?.self ?? 0,
    delegated: deleg?.delegated ?? 0,
    waitingApprovals: approvalsWaiting?.n ?? 0,
    duplicatesAvoided: dups?.n ?? 0,
    temporaryAgentsActive: temps?.n ?? 0,
    concurrency: {
      active: opts.companyId ? active.company : active.global,
      limit: policy.globalActiveAgentLimit,
    },
    handoffsPending: pending?.n ?? 0,
  };
}
