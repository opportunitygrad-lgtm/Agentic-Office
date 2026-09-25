import { and, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { TEMPLATE_CAPABILITIES, getAgentTemplate } from "@aibos/agent-core";
import {
  OPEN_TASK_STATUSES,
  createAgentSchema,
  setAgentCompaniesSchema,
  slugify,
  type AgentDTO,
  type AgentStatus,
  type AgentTemplateKey,
  type CreateAgentInput,
  type ProviderType,
  type TaskStatus,
  type AgentCapability,
} from "@aibos/shared";
import type { Database } from "../client";
import { ConflictError, NotFoundError } from "../errors";
import {
  agentCompanyAssignments,
  agentRoleVersions,
  agents,
  companies,
  departments,
  tasks,
  teamMembers,
  teams,
  type Agent,
} from "../schema";
import { agentWorkloads } from "./workforce";
import { applyTemplateGrants } from "./agent-authority";
import { recordAuditEvent } from "./audit";
import {
  FULL_SCOPE,
  actorAuditFields,
  departmentVisible,
  iso,
  scopeAllows,
  scopeWhere,
  type AccessScope,
  type Actor,
} from "./util";

export interface AgentFilters {
  companyId?: string | null;
  /** Include global-scope agents when filtering by company (default true). */
  includeGlobal?: boolean;
  status?: AgentStatus;
  departmentSlug?: string;
  provider?: ProviderType;
  q?: string;
  ids?: string[];
  teamId?: string;
  temporary?: boolean;
  /** Caller's visible companies (company isolation). Defaults to everything. */
  scope?: AccessScope;
}

/** Rank for choosing an agent's "current" task among several open tasks. */
const TASK_STATUS_RANK: Record<TaskStatus, number> = {
  running: 0,
  needs_approval: 1,
  waiting: 2,
  assigned: 3,
  paused: 4,
  queued: 5,
  completed: 9,
  failed: 9,
  cancelled: 9,
};

export async function listAgents(db: Database, filters: AgentFilters = {}): Promise<AgentDTO[]> {
  const manager = alias(agents, "manager");
  const where: SQL[] = [];
  if (filters.companyId) {
    const assigned = sql`${agents.id} in (select ${agentCompanyAssignments.agentId} from ${agentCompanyAssignments} where ${agentCompanyAssignments.companyId} = ${filters.companyId})`;
    where.push(
      filters.includeGlobal === false ? assigned : or(assigned, eq(agents.scope, "global"))!,
    );
  }
  if (filters.status) where.push(eq(agents.status, filters.status));
  if (filters.departmentSlug) where.push(eq(departments.slug, filters.departmentSlug));
  if (filters.provider) where.push(eq(agents.primaryProvider, filters.provider));
  if (filters.q)
    where.push(
      or(ilike(agents.name, `%${filters.q}%`), ilike(agents.description, `%${filters.q}%`))!,
    );
  if (filters.ids) where.push(filters.ids.length ? inArray(agents.id, filters.ids) : sql`false`);
  if (filters.teamId)
    where.push(
      sql`${agents.id} in (select ${teamMembers.agentId} from ${teamMembers} where ${teamMembers.teamId} = ${filters.teamId})`,
    );
  if (filters.temporary !== undefined) where.push(eq(agents.isTemporary, filters.temporary));
  const scope = filters.scope ?? FULL_SCOPE;
  if (scope.companyIds !== "all") {
    const visible = [...scope.companyIds];
    // Global agents serve every company; company agents must serve a visible company.
    where.push(
      visible.length
        ? or(
            eq(agents.scope, "global"),
            sql`${agents.id} in (select ${agentCompanyAssignments.agentId} from ${agentCompanyAssignments} where ${inArray(agentCompanyAssignments.companyId, visible)})`,
          )!
        : sql`false`,
    );
  }

  const rows = await db
    .select({
      agent: agents,
      dept: { id: departments.id, name: departments.name, slug: departments.slug },
      managerName: manager.name,
    })
    .from(agents)
    .leftJoin(departments, eq(departments.id, agents.departmentId))
    .leftJoin(manager, eq(manager.id, agents.reportsToAgentId))
    .where(where.length ? and(...where) : undefined)
    .orderBy(
      sql`case ${agents.scope} when 'global' then 0 else 1 end`,
      agents.createdAt,
      agents.name,
    );

  if (!rows.length) return [];
  const ids = rows.map((r) => r.agent.id);

  const [assignments, openTasks, teamRows, workloads, related, roleVersions] = await Promise.all([
    db
      .select({
        agentId: agentCompanyAssignments.agentId,
        isPrimary: agentCompanyAssignments.isPrimary,
        id: companies.id,
        name: companies.name,
        slug: companies.slug,
        accentColor: companies.accentColor,
      })
      .from(agentCompanyAssignments)
      .innerJoin(companies, eq(companies.id, agentCompanyAssignments.companyId))
      .where(
        and(
          inArray(agentCompanyAssignments.agentId, ids),
          scopeWhere(agentCompanyAssignments.companyId, scope),
        ),
      )
      .orderBy(companies.createdAt),
    db
      .select({
        id: tasks.id,
        title: tasks.title,
        progress: tasks.progress,
        status: tasks.status,
        agentId: tasks.assignedAgentId,
        updatedAt: tasks.updatedAt,
      })
      .from(tasks)
      .where(
        and(
          inArray(tasks.assignedAgentId, ids),
          inArray(tasks.status, [...OPEN_TASK_STATUSES]),
          // Never reveal a task title from a company the caller cannot see.
          scopeWhere(tasks.companyId, scope),
        ),
      ),
    db
      .select({
        agentId: teamMembers.agentId,
        id: teams.id,
        name: teams.name,
        companyId: teams.companyId,
      })
      .from(teamMembers)
      .innerJoin(teams, eq(teams.id, teamMembers.teamId))
      .where(and(inArray(teamMembers.agentId, ids), scopeWhere(teams.companyId, scope))),
    agentWorkloads(db, ids),
    db
      .select({ id: agents.id, name: agents.name })
      .from(agents)
      .where(
        inArray(
          agents.id,
          rows
            .flatMap((r) =>
              [r.agent.escalationAgentId, r.agent.fallbackManagerId, r.agent.parentAgentId].filter(
                (x): x is string => !!x,
              ),
            )
            .concat([ids[0]!]),
        ),
      ),
    db
      .select({ agentId: agentRoleVersions.agentId, version: agentRoleVersions.version })
      .from(agentRoleVersions)
      .where(and(inArray(agentRoleVersions.agentId, ids), eq(agentRoleVersions.isCurrent, true))),
  ]);
  const nameOf = new Map(related.map((r) => [r.id, r.name]));
  const ref = (id: string | null) => (id && nameOf.has(id) ? { id, name: nameOf.get(id)! } : null);
  const versionOf = new Map(roleVersions.map((r) => [r.agentId, r.version]));

  const companiesByAgent = new Map<string, AgentDTO["companies"]>();
  for (const a of assignments) {
    const list = companiesByAgent.get(a.agentId) ?? [];
    list.push({
      id: a.id,
      name: a.name,
      slug: a.slug,
      accentColor: a.accentColor,
      isPrimary: a.isPrimary,
    });
    companiesByAgent.set(a.agentId, list);
  }
  const currentByAgent = new Map<string, (typeof openTasks)[number]>();
  for (const t of openTasks) {
    if (!t.agentId) continue;
    const prev = currentByAgent.get(t.agentId);
    if (
      !prev ||
      TASK_STATUS_RANK[t.status] < TASK_STATUS_RANK[prev.status] ||
      (TASK_STATUS_RANK[t.status] === TASK_STATUS_RANK[prev.status] && t.updatedAt > prev.updatedAt)
    ) {
      currentByAgent.set(t.agentId, t);
    }
  }

  const inDepartmentScope = (a: (typeof rows)[number]["agent"]) => {
    if (!scope.departments?.size) return true;
    const serves =
      a.scope === "global" ? null : (companiesByAgent.get(a.id) ?? []).map((c) => c.id);
    const candidates = serves ?? (scope.companyIds === "all" ? [null] : [...scope.companyIds]);
    return candidates.some(
      (c) => (c === null || scopeAllows(scope, c)) && departmentVisible(scope, c, a.departmentId),
    );
  };

  return rows
    .filter((r) => inDepartmentScope(r.agent))
    .map(({ agent: a, dept, managerName }) => {
      const current = currentByAgent.get(a.id);
      return {
        id: a.id,
        name: a.name,
        slug: a.slug,
        description: a.description,
        templateKey: a.templateKey as AgentTemplateKey,
        scope: a.scope,
        status: a.status,
        department: dept?.id ? dept : null,
        reportsTo:
          a.reportsToAgentId && managerName ? { id: a.reportsToAgentId, name: managerName } : null,
        companies: companiesByAgent.get(a.id) ?? [],
        primaryProvider: a.primaryProvider,
        fallbackProvider: a.fallbackProvider,
        preferredModel: a.preferredModel,
        autonomyLevel: a.autonomyLevel,
        responsibilities: a.responsibilities,
        prohibitedActions: a.prohibitedActions,
        allowedTools: a.allowedTools,
        readPermissions: a.readPermissions,
        writePermissions: a.writePermissions,
        approvalRequirements: a.approvalRequirements,
        perTaskBudget: a.perTaskBudget,
        dailyBudget: a.dailyBudget,
        maxExternalSearches: a.maxExternalSearches,
        maxRetries: a.maxRetries,
        concurrencyLimit: a.concurrencyLimit,
        isTemporary: a.isTemporary,
        currentTask: current
          ? {
              id: current.id,
              title: current.title,
              progress: current.progress,
              status: current.status,
            }
          : null,
        capabilities: a.capabilities as AgentCapability[],
        teams: teamRows.filter((t) => t.agentId === a.id).map((t) => ({ id: t.id, name: t.name })),
        workload: workloads.get(a.id) ?? {
          active: 0,
          queued: 0,
          completedRecent: 0,
          capacity: a.concurrencyLimit,
          load: 0,
        },
        escalationAgent: ref(a.escalationAgentId),
        fallbackManager: ref(a.fallbackManagerId),
        parentAgent: ref(a.parentAgentId),
        purpose: a.purpose,
        expiresAt: iso(a.expiresAt),
        boundTaskId: a.boundTaskId,
        maySpawnTemporary: a.maySpawnTemporary,
        roleVersion: versionOf.get(a.id) ?? null,
        preferredModelTier: a.preferredModelTier,
        defaultEffort: a.defaultEffort,
        preferredReviewerProvider: a.preferredReviewerProvider,
        lastActiveAt: iso(a.lastActiveAt),
        origin: a.origin,
        createdAt: a.createdAt.toISOString(),
        updatedAt: a.updatedAt.toISOString(),
      };
    });
}

export async function getAgent(db: Database, id: string, scope?: AccessScope): Promise<AgentDTO> {
  const [agent] = await listAgents(db, { ids: [id], scope });
  if (!agent) throw new NotFoundError("Agent", id);
  return agent;
}

/** Creates an agent from a template, applying template defaults to unset fields. */
export async function createAgent(
  db: Database,
  input: CreateAgentInput,
  actor: Actor,
  opts: { origin?: "live" | "dev_seed" } = {},
): Promise<Agent> {
  const data = createAgentSchema.parse(input);
  const tpl = getAgentTemplate(data.templateKey);
  const slug = data.slug ?? slugify(data.name);
  const origin = opts.origin ?? "live";

  return db.transaction(async (tx) => {
    const clash = await tx.select({ id: agents.id }).from(agents).where(eq(agents.slug, slug));
    if (clash.length) throw new ConflictError(`An agent with slug "${slug}" already exists`);

    let departmentId = data.departmentId ?? null;
    if (!departmentId) {
      const [dept] = await tx
        .select({ id: departments.id })
        .from(departments)
        .where(and(eq(departments.slug, tpl.department), sql`${departments.companyId} is null`));
      departmentId = dept?.id ?? null;
    }

    const [agent] = await tx
      .insert(agents)
      .values({
        name: data.name,
        slug,
        description: data.description ?? tpl.description,
        templateKey: data.templateKey,
        scope: data.scope,
        status: data.status,
        departmentId,
        reportsToAgentId: data.reportsToAgentId,
        primaryProvider: data.primaryProvider,
        fallbackProvider: data.fallbackProvider ?? tpl.fallbackProvider,
        preferredModel: data.preferredModel,
        autonomyLevel: data.autonomyLevel,
        responsibilities: tpl.responsibilities,
        prohibitedActions: tpl.prohibitedActions,
        allowedTools: tpl.defaultTools,
        approvalRequirements: tpl.approvalRequirements,
        capabilities: TEMPLATE_CAPABILITIES[data.templateKey],
        perTaskBudget: data.perTaskBudget,
        dailyBudget: data.dailyBudget,
        maxExternalSearches: data.maxExternalSearches,
        maxRetries: data.maxRetries,
        concurrencyLimit: data.concurrencyLimit,
        isTemporary: data.isTemporary,
        origin,
      })
      .returning();
    if (!agent) throw new Error("Agent insert failed");

    await applyTemplateGrants(tx, agent.id, data.templateKey, origin);
    if (data.companyIds.length) {
      await tx.insert(agentCompanyAssignments).values(
        data.companyIds.map((companyId, i) => ({
          agentId: agent.id,
          companyId,
          isPrimary: i === 0,
        })),
      );
    }

    await recordAuditEvent(
      tx,
      {
        ...actorAuditFields(actor),
        agentId: agent.id,
        companyId: data.companyIds[0],
        resourceType: "agent",
        resourceId: agent.id,
        action: "agent.created",
        description: `Agent "${agent.name}" created from template ${tpl.name}`,
        metadata: { templateKey: data.templateKey, companyIds: data.companyIds, actor: actor.ref },
      },
      origin,
    );
    return agent;
  });
}

/** Replaces an agent's company assignments (multi-company support). */
export async function setAgentCompanies(
  db: Database,
  agentId: string,
  input: { companyIds: string[]; primaryCompanyId?: string },
  actor: Actor,
): Promise<AgentDTO> {
  const data = setAgentCompaniesSchema.parse(input);
  const companyIds = [...new Set(data.companyIds)];
  await db.transaction(async (tx) => {
    const [agent] = await tx.select().from(agents).where(eq(agents.id, agentId));
    if (!agent) throw new NotFoundError("Agent", agentId);
    if (companyIds.length) {
      const found = await tx
        .select({ id: companies.id })
        .from(companies)
        .where(inArray(companies.id, companyIds));
      if (found.length !== companyIds.length) throw new NotFoundError("Company", "one or more ids");
    }
    const before = await tx
      .select({ companyId: agentCompanyAssignments.companyId })
      .from(agentCompanyAssignments)
      .where(eq(agentCompanyAssignments.agentId, agentId));
    await tx.delete(agentCompanyAssignments).where(eq(agentCompanyAssignments.agentId, agentId));
    if (companyIds.length) {
      const primary = data.primaryCompanyId ?? companyIds[0];
      await tx
        .insert(agentCompanyAssignments)
        .values(
          companyIds.map((companyId) => ({ agentId, companyId, isPrimary: companyId === primary })),
        );
    }
    await recordAuditEvent(tx, {
      ...actorAuditFields(actor),
      agentId,
      resourceType: "agent",
      resourceId: agentId,
      action: "agent.assignments_changed",
      description: `Company assignments updated for "${agent.name}"`,
      before: { companyIds: before.map((b) => b.companyId) },
      after: { companyIds },
    });
  });
  return getAgent(db, agentId);
}
