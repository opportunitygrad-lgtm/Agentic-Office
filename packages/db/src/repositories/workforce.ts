import { and, eq, inArray, isNull, lte, notInArray, or, sql } from "drizzle-orm";
import {
  MANUAL_AGENT_STATES,
  OPEN_TASK_STATUSES,
  agentCapabilitiesSchema,
  agentHierarchySchema,
  createTeamSchema,
  departmentUpdateSchema,
  slugify,
  teamMembersSchema,
  updateTeamSchema,
  workforcePolicySchema,
  type AgentWorkloadDTO,
  type CreateTeamInput,
  type DepartmentDetailDTO,
  type OrgAgentNode,
  type OrgChartDTO,
  type TaskType,
  type TeamDTO,
  type TeamDetailDTO,
  type WorkforcePolicyDTO,
  type WorkforcePolicyInput,
} from "@aibos/shared";
import type { z } from "zod";
import type { Database } from "../client";
import { ConflictError, ForbiddenError, NotFoundError } from "../errors";
import {
  agentCompanyAssignments,
  agents,
  auditEvents,
  companies,
  departments,
  tasks,
  teamMembers,
  teams,
  users,
  workforcePolicy,
  type Team,
} from "../schema";
import { recordAuditEvent } from "./audit";
import { displayNameOf } from "./identity";
import { listAgents } from "./agents";
import { listTasks } from "./tasks";
import {
  FULL_SCOPE,
  SYSTEM_ACTOR,
  actorAuditFields,
  scopeWhere,
  type AccessScope,
  type Actor,
} from "./util";

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Db = Database | Tx;

/* ---------- workforce policy ---------- */

export async function getWorkforcePolicy(db: Db): Promise<WorkforcePolicyDTO> {
  const [row] = await db.select().from(workforcePolicy).where(eq(workforcePolicy.id, 1));
  const r = row ?? (await db.insert(workforcePolicy).values({ id: 1 }).returning())[0]!;
  return {
    globalActiveAgentLimit: r.globalActiveAgentLimit,
    maxDelegationDepth: r.maxDelegationDepth,
    highCostTaskThresholdUsd: r.highCostTaskThresholdUsd,
    tempAgentMaxExpiryHours: r.tempAgentMaxExpiryHours,
    tempAgentApprovalBudgetUsd: r.tempAgentApprovalBudgetUsd,
    maxActiveTempAgentsPerCompany: r.maxActiveTempAgentsPerCompany,
    globalDailyAiBudgetUsd: r.globalDailyAiBudgetUsd,
    updatedAt: r.updatedAt.toISOString(),
  };
}

export async function updateWorkforcePolicy(
  db: Database,
  input: WorkforcePolicyInput,
  actor: Actor,
): Promise<WorkforcePolicyDTO> {
  const data = workforcePolicySchema.parse(input);
  await db.transaction(async (tx) => {
    const before = await getWorkforcePolicy(tx);
    await tx
      .insert(workforcePolicy)
      .values({ id: 1, ...data, updatedByUserId: actor.userId ?? null })
      .onConflictDoUpdate({
        target: workforcePolicy.id,
        set: { ...data, updatedByUserId: actor.userId ?? null },
      });
    const { updatedAt: _u, ...b } = before;
    await recordAuditEvent(tx, {
      ...actorAuditFields(actor),
      resourceType: "workforce_policy",
      resourceId: "1",
      action: "workforce.policy_updated",
      description: "Workforce concurrency and delegation policy updated",
      before: b,
      after: data,
    });
  });
  return getWorkforcePolicy(db);
}

/* ---------- derived agent state ---------- */

/**
 * Derives operational state from actual work: needs_approval > working >
 * waiting > queued > sleeping. Manual/lifecycle states (paused, offline,
 * error, expired, terminated) are never overwritten.
 */
export async function refreshAgentStates(db: Db, agentIds?: readonly string[]): Promise<void> {
  if (agentIds && !agentIds.length) return;
  const open = OPEN_TASK_STATUSES.map((s) => `'${s}'`).join(",");
  await db.execute(sql`
    update agents a set status = coalesce(
    -- Stage 05: an agent executing a real run is working, whatever its task mix.
    (select 'working' from agent_runs r where r.agent_id = a.id
       and r.status in ('preparing','routing','running','streaming','cancel_requested') limit 1),
    (
      select case
        when bool_or(t.status = 'needs_approval') then 'needs_approval'
        when bool_or(t.status = 'running') then 'working'
        when bool_or(t.status = 'waiting') then 'waiting'
        when bool_or(t.status in ('queued', 'assigned')) then 'queued'
        else null end
      from tasks t
      where t.assigned_agent_id = a.id and t.status::text in (${sql.raw(open)})
    ), 'sleeping')::agent_status,
    last_active_at = case when a.status = 'working' then now() else a.last_active_at end
    where a.status::text not in (${sql.raw(MANUAL_AGENT_STATES.map((s) => `'${s}'`).join(","))})
    ${
      agentIds
        ? sql`and a.id in (${sql.join(
            agentIds.map((i) => sql`${i}::uuid`),
            sql`, `,
          )})`
        : sql``
    }
  `);
}

/** Temporary agents past their expiry become EXPIRED (called lazily; no scheduler). */
export async function expireTemporaryAgents(db: Database, now = new Date()): Promise<number> {
  const expired = await db
    .update(agents)
    .set({ status: "expired" })
    .where(
      and(
        eq(agents.isTemporary, true),
        lte(agents.expiresAt, now),
        notInArray(agents.status, ["expired", "terminated"]),
      ),
    )
    .returning({ id: agents.id, name: agents.name });
  for (const a of expired)
    await recordAuditEvent(db, {
      ...actorAuditFields(SYSTEM_ACTOR),
      agentId: a.id,
      resourceType: "agent",
      resourceId: a.id,
      action: "temp_agent.expired",
      description: `Temporary agent "${a.name}" expired`,
    });
  return expired.length;
}

/* ---------- workload ---------- */

export async function agentWorkloads(
  db: Db,
  ids: readonly string[],
): Promise<Map<string, AgentWorkloadDTO>> {
  const out = new Map<string, AgentWorkloadDTO>();
  if (!ids.length) return out;
  const since = new Date(Date.now() - 7 * 86_400_000);
  const rows = await db
    .select({
      agentId: tasks.assignedAgentId,
      active: sql<number>`count(*) filter (where ${tasks.status} in ('running','waiting','needs_approval'))::int`,
      queued: sql<number>`count(*) filter (where ${tasks.status} in ('queued','assigned','paused'))::int`,
      completed: sql<number>`count(*) filter (where ${tasks.status} = 'completed' and ${tasks.completedAt} >= ${since.toISOString()}::timestamptz)::int`,
    })
    .from(tasks)
    .where(inArray(tasks.assignedAgentId, [...ids]))
    .groupBy(tasks.assignedAgentId);
  const caps = await db
    .select({ id: agents.id, cap: agents.concurrencyLimit })
    .from(agents)
    .where(inArray(agents.id, [...ids]));
  const byId = new Map(rows.map((r) => [r.agentId, r]));
  for (const { id, cap } of caps) {
    const r = byId.get(id);
    const active = r?.active ?? 0;
    out.set(id, {
      active,
      queued: r?.queued ?? 0,
      completedRecent: r?.completed ?? 0,
      capacity: cap,
      load: cap ? active / cap : 0,
    });
  }
  return out;
}

/* ---------- hierarchy & capabilities ---------- */

async function agentCompanies(
  db: Db,
  agentId: string,
): Promise<{ scope: "global" | "company"; companyIds: string[] }> {
  const [a] = await db.select({ scope: agents.scope }).from(agents).where(eq(agents.id, agentId));
  if (!a) throw new NotFoundError("Agent", agentId);
  const rows = await db
    .select({ c: agentCompanyAssignments.companyId })
    .from(agentCompanyAssignments)
    .where(eq(agentCompanyAssignments.agentId, agentId));
  return { scope: a.scope, companyIds: rows.map((r) => r.c) };
}

/** Would making `managerId` the manager of `agentId` create a reporting cycle? */
export async function wouldCreateCycle(
  db: Db,
  agentId: string,
  managerId: string,
): Promise<boolean> {
  let cursor: string | null = managerId;
  const seen = new Set<string>();
  while (cursor) {
    if (cursor === agentId) return true;
    if (seen.has(cursor)) return true;
    seen.add(cursor);
    const [row] = await db
      .select({ next: agents.reportsToAgentId })
      .from(agents)
      .where(eq(agents.id, cursor));
    cursor = row?.next ?? null;
  }
  return false;
}

export async function setAgentHierarchy(
  db: Database,
  agentId: string,
  input: z.input<typeof agentHierarchySchema>,
  actor: Actor,
): Promise<void> {
  const data = agentHierarchySchema.parse(input);
  await db.transaction(async (tx) => {
    const [agent] = await tx.select().from(agents).where(eq(agents.id, agentId));
    if (!agent) throw new NotFoundError("Agent", agentId);
    const mine = await agentCompanies(tx, agentId);
    for (const [field, target] of Object.entries(data)) {
      if (!target) continue;
      if (target === agentId) throw new ConflictError("An agent cannot report to itself");
      const theirs = await agentCompanies(tx, target);
      // Managers must be global or share a company (no cross-company reporting lines).
      const compatible =
        theirs.scope === "global" ||
        (mine.scope === "company" && mine.companyIds.some((c) => theirs.companyIds.includes(c)));
      if (!compatible)
        throw new ForbiddenError(`The ${field.replace(/Id$/, "")} must serve the same company`);
      if (field === "reportsToAgentId" && (await wouldCreateCycle(tx, agentId, target)))
        throw new ConflictError("This reporting line would create a cycle");
    }
    await tx.update(agents).set(data).where(eq(agents.id, agentId));
    await recordAuditEvent(tx, {
      ...actorAuditFields(actor),
      agentId,
      resourceType: "agent",
      resourceId: agentId,
      action: "agent.manager_changed",
      description: `Reporting lines updated for "${agent.name}"`,
      before: {
        reportsToAgentId: agent.reportsToAgentId,
        escalationAgentId: agent.escalationAgentId,
        fallbackManagerId: agent.fallbackManagerId,
      },
      after: data,
    });
  });
}

export async function setAgentCapabilities(
  db: Database,
  agentId: string,
  input: z.input<typeof agentCapabilitiesSchema>,
  actor: Actor,
): Promise<void> {
  const { capabilities } = agentCapabilitiesSchema.parse(input);
  await db.transaction(async (tx) => {
    const [agent] = await tx.select().from(agents).where(eq(agents.id, agentId));
    if (!agent) throw new NotFoundError("Agent", agentId);
    await tx.update(agents).set({ capabilities }).where(eq(agents.id, agentId));
    await recordAuditEvent(tx, {
      ...actorAuditFields(actor),
      agentId,
      resourceType: "agent",
      resourceId: agentId,
      action: "agent.capabilities_changed",
      description: `Capabilities updated for "${agent.name}"`,
      before: { capabilities: agent.capabilities },
      after: { capabilities },
    });
  });
}

/* ---------- departments ---------- */

export async function listDepartmentDetails(
  db: Database,
  opts: { companyId?: string | null; scope?: AccessScope } = {},
): Promise<DepartmentDetailDTO[]> {
  const scope = opts.scope ?? FULL_SCOPE;
  const manager = sql<
    string | null
  >`(select name from agents m where m.id = ${departments.managerAgentId})`;
  const rows = await db
    .select({
      d: departments,
      company: {
        id: companies.id,
        name: companies.name,
        slug: companies.slug,
        accentColor: companies.accentColor,
      },
      managerName: manager,
      human: {
        id: users.id,
        email: users.email,
        displayName: users.displayName,
        firstName: users.firstName,
        lastName: users.lastName,
      },
      agentCount: sql<number>`(select count(*)::int from ${agents} where ${agents.departmentId} = ${departments.id} and ${agents.status} not in ('expired','terminated'))`,
      activeTasks: sql<number>`(select count(*)::int from ${tasks} where ${tasks.departmentId} = ${departments.id} and ${tasks.status} in ('running','waiting','needs_approval'))`,
    })
    .from(departments)
    .leftJoin(companies, eq(companies.id, departments.companyId))
    .leftJoin(users, eq(users.id, departments.humanManagerUserId))
    .where(
      and(
        opts.companyId
          ? or(isNull(departments.companyId), eq(departments.companyId, opts.companyId))
          : undefined,
        scopeWhere(departments.companyId, { ...scope, includeGroup: true }),
      ),
    )
    .orderBy(departments.name);
  return rows.map(({ d, company, managerName, human, agentCount, activeTasks }) => ({
    id: d.id,
    name: d.name,
    slug: d.slug,
    company: company?.id ? company : null,
    description: d.description,
    mission: d.mission,
    color: d.color,
    managerAgent:
      d.managerAgentId && managerName ? { id: d.managerAgentId, name: managerName } : null,
    humanManager: human?.id ? { id: human.id, name: displayNameOf(human) } : null,
    defaultProvider: d.defaultProvider,
    concurrencyLimit: d.concurrencyLimit,
    dailyBudgetUsd: d.dailyBudgetUsd,
    active: d.active,
    instructions: d.instructions,
    allowedTaskTypes: d.allowedTaskTypes as TaskType[],
    handoffDestinations: d.handoffDestinations,
    agentCount,
    activeTasks,
  }));
}

export async function getDepartmentRecord(db: Db, id: string) {
  const [d] = await db.select().from(departments).where(eq(departments.id, id));
  if (!d) throw new NotFoundError("Department", id);
  return d;
}

export async function updateDepartment(
  db: Database,
  id: string,
  input: z.input<typeof departmentUpdateSchema>,
  actor: Actor,
): Promise<void> {
  const data = departmentUpdateSchema.parse(input);
  await db.transaction(async (tx) => {
    const d = await getDepartmentRecord(tx, id);
    if (data.managerAgentId) {
      const m = await agentCompanies(tx, data.managerAgentId);
      if (d.companyId && m.scope !== "global" && !m.companyIds.includes(d.companyId))
        throw new ForbiddenError("The department manager must serve the department's company");
    }
    await tx.update(departments).set(data).where(eq(departments.id, id));
    await recordAuditEvent(tx, {
      ...actorAuditFields(actor),
      companyId: d.companyId ?? undefined,
      resourceType: "department",
      resourceId: id,
      action: "department.updated",
      description: `Department "${d.name}" updated`,
      metadata: { changedFields: Object.keys(data) },
    });
  });
}

/* ---------- teams ---------- */

function toTeamDTO(
  t: Team,
  extra: {
    company: TeamDTO["company"];
    department: TeamDTO["department"];
    leaderName: string | null;
    memberCount: number;
    activeTasks: number;
  },
): TeamDTO {
  return {
    id: t.id,
    name: t.name,
    slug: t.slug,
    company: extra.company,
    department: extra.department,
    description: t.description,
    purpose: t.purpose,
    leader:
      t.leaderAgentId && extra.leaderName ? { id: t.leaderAgentId, name: extra.leaderName } : null,
    concurrencyLimit: t.concurrencyLimit,
    defaultTaskTypes: t.defaultTaskTypes as TaskType[],
    active: t.active,
    isTemporary: t.isTemporary,
    expiresAt: t.expiresAt?.toISOString() ?? null,
    memberCount: extra.memberCount,
    activeTasks: extra.activeTasks,
    origin: t.origin,
  };
}

export async function listTeams(
  db: Database,
  opts: { companyId?: string | null; scope?: AccessScope; ids?: string[] } = {},
): Promise<TeamDTO[]> {
  const scope = opts.scope ?? FULL_SCOPE;
  const rows = await db
    .select({
      t: teams,
      company: {
        id: companies.id,
        name: companies.name,
        slug: companies.slug,
        accentColor: companies.accentColor,
      },
      department: { id: departments.id, name: departments.name, slug: departments.slug },
      leaderName: sql<
        string | null
      >`(select name from agents l where l.id = ${teams.leaderAgentId})`,
      memberCount: sql<number>`(select count(*)::int from ${teamMembers} where ${teamMembers.teamId} = ${teams.id})`,
      activeTasks: sql<number>`(select count(*)::int from ${tasks} where ${tasks.teamId} = ${teams.id} and ${tasks.status} in ('running','waiting','needs_approval','assigned','queued'))`,
    })
    .from(teams)
    .leftJoin(companies, eq(companies.id, teams.companyId))
    .leftJoin(departments, eq(departments.id, teams.departmentId))
    .where(
      and(
        opts.companyId ? eq(teams.companyId, opts.companyId) : undefined,
        opts.ids ? (opts.ids.length ? inArray(teams.id, opts.ids) : sql`false`) : undefined,
        scopeWhere(teams.companyId, scope),
      ),
    )
    .orderBy(teams.name);
  return rows.map((r) =>
    toTeamDTO(r.t, {
      company: r.company?.id ? r.company : null,
      department: r.department?.id ? r.department : null,
      leaderName: r.leaderName,
      memberCount: r.memberCount,
      activeTasks: r.activeTasks,
    }),
  );
}

export async function getTeamRecord(db: Db, id: string): Promise<Team> {
  const [t] = await db.select().from(teams).where(eq(teams.id, id));
  if (!t) throw new NotFoundError("Team", id);
  return t;
}

export async function getTeamDetail(
  db: Database,
  id: string,
  opts: { scope?: AccessScope; taskScope?: AccessScope; viewerCanManage: boolean },
): Promise<TeamDetailDTO> {
  const [team] = await listTeams(db, { ids: [id], scope: opts.scope });
  if (!team) throw new NotFoundError("Team", id);
  const record = await getTeamRecord(db, id);
  const memberRows = await db
    .select({
      id: agents.id,
      name: agents.name,
      status: agents.status,
      templateKey: agents.templateKey,
      isTemporary: agents.isTemporary,
    })
    .from(teamMembers)
    .innerJoin(agents, eq(agents.id, teamMembers.agentId))
    .where(eq(teamMembers.teamId, id))
    .orderBy(agents.name);
  const workloads = await agentWorkloads(
    db,
    memberRows.map((m) => m.id),
  );
  const teamTasks = await listTasks(db, { teamId: id, scope: opts.taskScope, limit: 50 });
  const dept = record.departmentId ? await getDepartmentRecord(db, record.departmentId) : null;
  const activity = await db
    .select({
      id: auditEvents.id,
      description: auditEvents.description,
      occurredAt: auditEvents.occurredAt,
      actor: auditEvents.actorUser,
    })
    .from(auditEvents)
    .where(and(eq(auditEvents.resourceType, "team"), eq(auditEvents.resourceId, id)))
    .orderBy(sql`${auditEvents.occurredAt} desc`)
    .limit(20);
  return {
    ...team,
    members: memberRows.map((m) => ({
      ...m,
      isLeader: m.id === record.leaderAgentId,
      workload: workloads.get(m.id) ?? {
        active: 0,
        queued: 0,
        completedRecent: 0,
        capacity: 1,
        load: 0,
      },
    })),
    tasks: teamTasks,
    handoffDestinations: dept?.handoffDestinations ?? [],
    activity: activity.map((a) => ({
      id: a.id,
      description: a.description,
      occurredAt: a.occurredAt.toISOString(),
      actor: a.actor,
    })),
    viewerCanManage: opts.viewerCanManage,
  };
}

/** Members must serve the team's company (or be global agents); never temporary agents of another company. */
async function assertMembers(db: Db, companyId: string | null, memberIds: readonly string[]) {
  for (const id of memberIds) {
    const a = await agentCompanies(db, id);
    if (companyId && a.scope !== "global" && !a.companyIds.includes(companyId))
      throw new ForbiddenError("Every team member must serve the team's company");
  }
}

export async function createTeam(
  db: Database,
  input: CreateTeamInput,
  actor: Actor,
  opts: { origin?: "live" | "dev_seed" } = {},
): Promise<Team> {
  const data = createTeamSchema.parse(input);
  return db.transaction(async (tx) => {
    await assertMembers(tx, data.companyId, data.memberIds);
    if (data.leaderAgentId && !data.memberIds.includes(data.leaderAgentId))
      data.memberIds.push(data.leaderAgentId);
    if (data.leaderAgentId) await assertMembers(tx, data.companyId, [data.leaderAgentId]);
    const { memberIds, ...fields } = data;
    const slug = slugify(data.name);
    const [row] = await tx
      .insert(teams)
      .values({ ...fields, slug, origin: opts.origin ?? "live" })
      .onConflictDoNothing()
      .returning();
    if (!row) throw new ConflictError(`A team called "${data.name}" already exists`);
    if (memberIds.length)
      await tx
        .insert(teamMembers)
        .values(memberIds.map((agentId) => ({ teamId: row.id, agentId })));
    await recordAuditEvent(
      tx,
      {
        ...actorAuditFields(actor),
        companyId: row.companyId ?? undefined,
        resourceType: "team",
        resourceId: row.id,
        action: "team.created",
        description: `Team "${row.name}" created with ${memberIds.length} member(s)`,
        metadata: { memberIds },
      },
      row.origin,
    );
    return row;
  });
}

export async function updateTeam(
  db: Database,
  id: string,
  input: z.input<typeof updateTeamSchema>,
  actor: Actor,
): Promise<void> {
  const data = updateTeamSchema.parse(input);
  await db.transaction(async (tx) => {
    const team = await getTeamRecord(tx, id);
    if (data.leaderAgentId) {
      await assertMembers(tx, team.companyId, [data.leaderAgentId]);
      await tx
        .insert(teamMembers)
        .values({ teamId: id, agentId: data.leaderAgentId })
        .onConflictDoNothing();
    }
    await tx
      .update(teams)
      .set({ ...data, ...(data.name ? { slug: slugify(data.name) } : {}) })
      .where(eq(teams.id, id));
    await recordAuditEvent(tx, {
      ...actorAuditFields(actor),
      companyId: team.companyId ?? undefined,
      resourceType: "team",
      resourceId: id,
      action: "team.updated",
      description: `Team "${team.name}" updated`,
      metadata: { changedFields: Object.keys(data) },
    });
  });
}

export async function setTeamMembers(
  db: Database,
  id: string,
  input: z.input<typeof teamMembersSchema>,
  actor: Actor,
): Promise<void> {
  const { memberIds } = teamMembersSchema.parse(input);
  await db.transaction(async (tx) => {
    const team = await getTeamRecord(tx, id);
    await assertMembers(tx, team.companyId, memberIds);
    const ids = [...new Set([...memberIds, ...(team.leaderAgentId ? [team.leaderAgentId] : [])])];
    const before = await tx
      .select({ id: teamMembers.agentId })
      .from(teamMembers)
      .where(eq(teamMembers.teamId, id));
    await tx.delete(teamMembers).where(eq(teamMembers.teamId, id));
    if (ids.length)
      await tx.insert(teamMembers).values(ids.map((agentId) => ({ teamId: id, agentId })));
    await recordAuditEvent(tx, {
      ...actorAuditFields(actor),
      companyId: team.companyId ?? undefined,
      resourceType: "team",
      resourceId: id,
      action: "agent.team_assigned",
      description: `Members of team "${team.name}" updated (${ids.length})`,
      before: { memberIds: before.map((b) => b.id) },
      after: { memberIds: ids },
    });
  });
}

/* ---------- organisation chart ---------- */

export async function organisationChart(
  db: Database,
  opts: { scope: AccessScope; companyId?: string | null },
): Promise<OrgChartDTO> {
  const list = await listAgents(db, { scope: opts.scope, companyId: opts.companyId ?? undefined });
  const live = list.filter((a) => a.status !== "terminated");
  const node = (a: (typeof live)[number]): OrgAgentNode => ({
    id: a.id,
    name: a.name,
    templateKey: a.templateKey,
    status: a.status,
    autonomyLevel: a.autonomyLevel,
    isTemporary: a.isTemporary,
    reportsToId: a.reportsTo?.id ?? null,
    workload: a.workload,
    currentTask: a.currentTask?.title ?? null,
  });
  const teamList = await listTeams(db, {
    scope: opts.scope,
    companyId: opts.companyId ?? undefined,
  });
  const memberRows = teamList.length
    ? await db
        .select()
        .from(teamMembers)
        .where(
          inArray(
            teamMembers.teamId,
            teamList.map((t) => t.id),
          ),
        )
    : [];
  const companyRows = await db
    .select({
      id: companies.id,
      name: companies.name,
      slug: companies.slug,
      accentColor: companies.accentColor,
    })
    .from(companies)
    .where(
      and(
        scopeWhere(companies.id, opts.scope),
        opts.companyId ? eq(companies.id, opts.companyId) : undefined,
      ),
    )
    .orderBy(companies.createdAt);
  const deptRows = await db.select().from(departments).orderBy(departments.name);

  const group = live.filter((a) => a.scope === "global").map(node);
  return {
    group,
    companies: companyRows.map((c) => {
      const members = live.filter(
        (a) => a.scope === "company" && a.companies.some((x) => x.id === c.id),
      );
      const managers = members.filter((a) => a.templateKey === "company_manager");
      const rest = members.filter((a) => a.templateKey !== "company_manager");
      const companyTeams = teamList.filter((t) => t.company?.id === c.id);
      const inTeam = new Set(
        memberRows.filter((m) => companyTeams.some((t) => t.id === m.teamId)).map((m) => m.agentId),
      );
      const byDept = new Map<string, typeof rest>();
      for (const a of rest) {
        const key = a.department?.id ?? "none";
        byDept.set(key, [...(byDept.get(key) ?? []), a]);
      }
      for (const t of companyTeams)
        if (t.department && !byDept.has(t.department.id)) byDept.set(t.department.id, []);
      return {
        company: c,
        managers: managers.map(node),
        departments: [...byDept.entries()]
          .map(([deptId, agentsInDept]) => {
            const d = deptRows.find((x) => x.id === deptId);
            const deptTeams = companyTeams.filter((t) => (t.department?.id ?? "none") === deptId);
            return {
              department: d
                ? { id: d.id, name: d.name, slug: d.slug, color: d.color }
                : { id: "none", name: "Unassigned", slug: "unassigned", color: null },
              teams: deptTeams.map((t) => ({
                id: t.id,
                name: t.name,
                leaderId: t.leader?.id ?? null,
                members: members
                  .filter((a) => memberRows.some((m) => m.teamId === t.id && m.agentId === a.id))
                  .map(node),
              })),
              agents: agentsInDept.filter((a) => !inTeam.has(a.id)).map(node),
            };
          })
          .sort((a, b) => a.department.name.localeCompare(b.department.name)),
      };
    }),
  };
}

/** Counts of agents actively working (for concurrency). */
export async function activeAgentCounts(db: Db, companyId: string | null) {
  const [global] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(agents)
    .where(inArray(agents.status, ["working", "waiting", "needs_approval", "blocked"]));
  let company = 0;
  if (companyId) {
    const [row] = await db
      .select({ n: sql<number>`count(distinct ${tasks.assignedAgentId})::int` })
      .from(tasks)
      .where(
        and(
          eq(tasks.companyId, companyId),
          inArray(tasks.status, ["running", "waiting", "needs_approval"]),
        ),
      );
    company = row?.n ?? 0;
  }
  return { global: global?.n ?? 0, company };
}
