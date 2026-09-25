import { and, asc, desc, eq, isNull, or, sql } from "drizzle-orm";
import { AGENT_PERMISSIONS, evaluateAgentPermission } from "@aibos/access-core";
import {
  TEMPLATE_CAPABILITIES,
  compileAgentInstructions,
  getAgentTemplate,
  getTemplateRole,
} from "@aibos/agent-core";
import {
  agentRoleSchema,
  roleTemplateUpdateSchema,
  saveAgentRoleSchema,
  type AgentCapability,
  type AgentRole,
  type AgentRoleDTO,
  type AgentRoleVersionDTO,
  type AgentTemplateKey,
  type CompiledAgentInstructionPack,
  type RoleTemplateDTO,
} from "@aibos/shared";
import type { z } from "zod";
import type { Database } from "../client";
import { ForbiddenError, NotFoundError } from "../errors";
import {
  agentCompanyAssignments,
  agentRoleVersions,
  agents,
  brandRules,
  commercialRules,
  companies,
  complianceRules,
  departments,
  roleTemplates,
  tasks,
  type Agent,
  type RoleTemplate,
} from "../schema";
import { loadAgentAuthorityInput } from "./agent-authority";
import { recordAuditEvent } from "./audit";
import { buildContextPack } from "./context";
import { loadPeople } from "./knowledge";
import { getAiPolicy, getCompanyRecord } from "./profile";
import { FULL_SCOPE, actorAuditFields, scopeWhere, type AccessScope, type Actor } from "./util";
import { getWorkforcePolicy } from "./workforce";

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Db = Database | Tx;

export interface EffectiveTemplate {
  id: string | null;
  key: string;
  name: string;
  role: AgentRole;
  capabilities: AgentCapability[];
  companySpecific: boolean;
}

/** The agent's template layer: its company role template if linked, else the code template. */
export async function effectiveTemplateFor(
  db: Db,
  agent: Pick<Agent, "templateKey" | "roleTemplateId">,
): Promise<EffectiveTemplate> {
  if (agent.roleTemplateId) {
    const [rt] = await db
      .select()
      .from(roleTemplates)
      .where(eq(roleTemplates.id, agent.roleTemplateId));
    if (rt)
      return {
        id: rt.id,
        key: rt.key,
        name: rt.name,
        role: agentRoleSchema.parse(rt.role),
        capabilities: rt.capabilities as AgentCapability[],
        companySpecific: rt.companyId !== null,
      };
  }
  const tpl = getAgentTemplate(agent.templateKey as AgentTemplateKey);
  return {
    id: null,
    key: tpl.key,
    name: tpl.name,
    role: getTemplateRole(tpl.key),
    capabilities: TEMPLATE_CAPABILITIES[tpl.key],
    companySpecific: false,
  };
}

async function getAgentRecord(db: Db, agentId: string): Promise<Agent> {
  const [a] = await db.select().from(agents).where(eq(agents.id, agentId));
  if (!a) throw new NotFoundError("Agent", agentId);
  return a;
}

export async function getAgentRole(
  db: Database,
  agentId: string,
  opts: { viewerCanManage: boolean },
): Promise<AgentRoleDTO> {
  const agent = await getAgentRecord(db, agentId);
  const template = await effectiveTemplateFor(db, agent);
  const rows = await db
    .select()
    .from(agentRoleVersions)
    .where(eq(agentRoleVersions.agentId, agentId))
    .orderBy(desc(agentRoleVersions.version));
  const people = await loadPeople(
    db,
    rows.flatMap((r) => [r.createdByUserId, r.approvedByUserId]),
  );
  const versions: AgentRoleVersionDTO[] = rows.map((r) => ({
    id: r.id,
    version: r.version,
    changeSummary: r.changeSummary,
    material: r.material,
    createdBy: r.createdByUserId ? (people.get(r.createdByUserId) ?? null) : null,
    approvedBy: r.approvedByUserId ? (people.get(r.approvedByUserId) ?? null) : null,
    effectiveFrom: r.effectiveFrom.toISOString(),
    createdAt: r.createdAt.toISOString(),
    isCurrent: r.isCurrent,
  }));
  const current = rows.find((r) => r.isCurrent);
  return {
    agentId,
    source: current ? "agent" : "template",
    role: current ? agentRoleSchema.parse(current.role) : template.role,
    templateRole: template.role,
    roleTemplate: {
      id: template.id,
      key: template.key,
      name: template.name,
      companySpecific: template.companySpecific,
    },
    currentVersion: versions.find((v) => v.isCurrent) ?? null,
    versions,
    capabilities: agent.capabilities as AgentCapability[],
    viewerCanManage: opts.viewerCanManage,
  };
}

/** Key-order-independent JSON (jsonb does not preserve key order). */
function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(",")}]`;
  if (v && typeof v === "object")
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableJson((v as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  return JSON.stringify(v ?? null);
}

/**
 * Saves a new role version. Roles are never overwritten: the previous
 * version stays in history (is_current=false) and the new one becomes current.
 * Saving an identical role is a no-op.
 */
export async function saveAgentRole(
  db: Database,
  agentId: string,
  input: z.input<typeof saveAgentRoleSchema>,
  actor: Actor,
  opts: { origin?: "live" | "dev_seed"; effectiveFrom?: Date } = {},
): Promise<{ version: number; created: boolean }> {
  const data = saveAgentRoleSchema.parse(input);
  return db.transaction(async (tx) => {
    const agent = await getAgentRecord(tx, agentId);
    // Serialise concurrent saves for this agent.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`agent-role:${agentId}`}))`);
    const [current] = await tx
      .select()
      .from(agentRoleVersions)
      .where(and(eq(agentRoleVersions.agentId, agentId), eq(agentRoleVersions.isCurrent, true)));
    const baseline = current ? current.role : (await effectiveTemplateFor(tx, agent)).role;
    if (stableJson(baseline) === stableJson(data.role))
      return { version: current?.version ?? 0, created: false };
    const [{ max }] = (await tx
      .select({ max: sql<number>`coalesce(max(${agentRoleVersions.version}), 0)::int` })
      .from(agentRoleVersions)
      .where(eq(agentRoleVersions.agentId, agentId))) as [{ max: number }];
    if (current)
      await tx
        .update(agentRoleVersions)
        .set({ isCurrent: false })
        .where(eq(agentRoleVersions.id, current.id));
    const version = max + 1;
    const [row] = await tx
      .insert(agentRoleVersions)
      .values({
        agentId,
        version,
        role: data.role,
        changeSummary: data.changeSummary,
        material: true,
        isCurrent: true,
        effectiveFrom: opts.effectiveFrom ?? new Date(),
        createdByUserId: actor.userId ?? null,
        // Role managers approve their own edits; recorded for the audit trail.
        approvedByUserId: actor.userId ?? null,
        origin: opts.origin ?? "live",
      })
      .returning();
    const changed = Object.keys(data.role).filter(
      (k) =>
        stableJson((baseline as Record<string, unknown>)[k]) !==
        stableJson((data.role as Record<string, unknown>)[k]),
    );
    await recordAuditEvent(
      tx,
      {
        ...actorAuditFields(actor),
        agentId,
        resourceType: "agent",
        resourceId: agentId,
        action: "agent.role_version_created",
        description: `Role v${version} for "${agent.name}": ${data.changeSummary}`,
        metadata: {
          version,
          previousVersion: current?.version ?? null,
          changedSections: changed,
          roleVersionId: row!.id,
        },
      },
      opts.origin,
    );
    await recordAuditEvent(
      tx,
      {
        ...actorAuditFields(actor),
        agentId,
        resourceType: "agent",
        resourceId: agentId,
        action: "agent.role_updated",
        description: `Permanent instructions updated for "${agent.name}"`,
        metadata: { version, changedSections: changed },
      },
      opts.origin,
    );
    return { version, created: true };
  });
}

/* ---------- role templates ---------- */

function toRoleTemplateDTO(
  rt: RoleTemplate,
  company: RoleTemplateDTO["company"],
  agentCount: number,
): RoleTemplateDTO {
  return {
    id: rt.id,
    key: rt.key,
    name: rt.name,
    company,
    baseTemplateKey: rt.baseTemplateKey,
    departmentSlug: rt.departmentSlug,
    capabilities: rt.capabilities as AgentCapability[],
    role: agentRoleSchema.parse(rt.role),
    agentCount,
    updatedAt: rt.updatedAt.toISOString(),
    origin: rt.origin,
  };
}

export async function listRoleTemplates(
  db: Database,
  opts: { scope?: AccessScope; companyId?: string | null } = {},
): Promise<RoleTemplateDTO[]> {
  const scope = opts.scope ?? FULL_SCOPE;
  const rows = await db
    .select({
      rt: roleTemplates,
      company: {
        id: companies.id,
        name: companies.name,
        slug: companies.slug,
        accentColor: companies.accentColor,
      },
      agentCount: sql<number>`(select count(*)::int from ${agents} where ${agents.roleTemplateId} = ${roleTemplates.id})`,
    })
    .from(roleTemplates)
    .leftJoin(companies, eq(companies.id, roleTemplates.companyId))
    .where(
      and(
        opts.companyId
          ? or(eq(roleTemplates.companyId, opts.companyId), isNull(roleTemplates.companyId))
          : undefined,
        scopeWhere(roleTemplates.companyId, { ...scope, includeGroup: true }),
      ),
    )
    .orderBy(asc(companies.name), asc(roleTemplates.name));
  return rows.map((r) => toRoleTemplateDTO(r.rt, r.company?.id ? r.company : null, r.agentCount));
}

export async function getRoleTemplateRecord(db: Db, id: string): Promise<RoleTemplate> {
  const [rt] = await db.select().from(roleTemplates).where(eq(roleTemplates.id, id));
  if (!rt) throw new NotFoundError("Role template", id);
  return rt;
}

export async function updateRoleTemplate(
  db: Database,
  id: string,
  input: z.input<typeof roleTemplateUpdateSchema>,
  actor: Actor,
): Promise<void> {
  const data = roleTemplateUpdateSchema.parse(input);
  await db.transaction(async (tx) => {
    const rt = await getRoleTemplateRecord(tx, id);
    await tx
      .update(roleTemplates)
      .set({ ...data, updatedByUserId: actor.userId ?? null })
      .where(eq(roleTemplates.id, id));
    await recordAuditEvent(tx, {
      ...actorAuditFields(actor),
      companyId: rt.companyId ?? undefined,
      resourceType: "role_template",
      resourceId: id,
      action: "role_template.updated",
      description: `Role template "${rt.name}" updated`,
      metadata: { changedFields: Object.keys(data) },
    });
  });
}

/* ---------- instruction compilation ---------- */

/**
 * Compiles the provider-neutral instruction pack for (agent, company, task),
 * including Context Pack metadata. Enforces company isolation like the
 * Context Engine: the agent must serve the company, the task must belong to it.
 */
export async function compileInstructionsFor(
  db: Database,
  input: { agentId: string; companyId: string; taskId?: string | null; notes?: string[] },
  opts: { now?: Date; withContext?: boolean } = {},
): Promise<CompiledAgentInstructionPack> {
  const now = opts.now ?? new Date();
  const agent = await getAgentRecord(db, input.agentId);
  const company = await getCompanyRecord(db, input.companyId);
  const assigned = await db
    .select({ c: agentCompanyAssignments.companyId })
    .from(agentCompanyAssignments)
    .where(eq(agentCompanyAssignments.agentId, agent.id));
  if (agent.scope !== "global" && !assigned.some((a) => a.c === company.id))
    throw new ForbiddenError("This agent is not assigned to the company");
  let task: typeof tasks.$inferSelect | undefined;
  if (input.taskId) {
    [task] = await db.select().from(tasks).where(eq(tasks.id, input.taskId));
    if (!task) throw new NotFoundError("Task", input.taskId);
    if (task.companyId !== company.id)
      throw new ForbiddenError("The task belongs to a different company");
  }

  const [aiPolicy, template, dept, manager, current, policy, authorityInput, critical] =
    await Promise.all([
      getAiPolicy(db, company.id),
      effectiveTemplateFor(db, agent),
      agent.departmentId
        ? db.select().from(departments).where(eq(departments.id, agent.departmentId))
        : Promise.resolve([]),
      agent.reportsToAgentId
        ? db.select({ name: agents.name }).from(agents).where(eq(agents.id, agent.reportsToAgentId))
        : Promise.resolve([]),
      db
        .select()
        .from(agentRoleVersions)
        .where(and(eq(agentRoleVersions.agentId, agent.id), eq(agentRoleVersions.isCurrent, true))),
      getWorkforcePolicy(db),
      loadAgentAuthorityInput(db, agent.id),
      Promise.all(
        [brandRules, commercialRules, complianceRules].map((t) =>
          db
            .select({ id: t.id, title: t.title, description: t.description })
            .from(t)
            .where(
              and(
                or(eq(t.companyId, company.id), isNull(t.companyId)),
                eq(t.status, "approved"),
                eq(t.active, true),
                eq(t.severity, "critical"),
              ),
            ),
        ),
      ),
    ]);
  const d = dept[0];
  const context =
    opts.withContext === false
      ? null
      : await buildContextPack(db, {
          companyId: company.id,
          agentId: agent.id,
          taskId: task?.id ?? null,
        }).catch(() => null);

  return compileAgentInstructions({
    now,
    agent: {
      id: agent.id,
      name: agent.name,
      templateKey: agent.templateKey,
      companyId: company.id,
      companyName: company.name,
      departmentName: d?.name ?? null,
      reportsTo: manager[0]?.name ?? null,
      autonomyLevel: agent.autonomyLevel,
      maxExternalSearches: agent.maxExternalSearches,
      maxRetries: agent.maxRetries,
      perTaskBudget: agent.perTaskBudget,
      providers: [
        agent.primaryProvider,
        ...(agent.fallbackProvider ? [agent.fallbackProvider] : []),
      ],
    },
    company: {
      aiPolicy,
      companyRules: company.companyRules,
      prohibitedClaims: company.prohibitedClaims,
      criticalRules: critical.flat(),
    },
    department: d ? { name: d.name, mission: d.mission, instructions: d.instructions } : null,
    template: {
      key: template.key,
      name: template.name,
      role: template.role,
      companySpecific: template.companySpecific,
    },
    agentRole: current[0]
      ? { role: agentRoleSchema.parse(current[0].role), version: current[0].version }
      : null,
    task: task
      ? {
          id: task.id,
          title: task.title,
          description: task.description,
          stoppingCondition: task.stoppingCondition,
          resultSchema: task.resultSchema,
          expectedOutcome: task.expectedOutcome,
          maxBudget: task.maxBudget,
          externalActionAllowed: task.externalActionAllowed,
          notes: input.notes ?? [],
        }
      : null,
    authority: AGENT_PERMISSIONS.map((def) => ({
      permission: def.key,
      decision: evaluateAgentPermission(authorityInput, company.id, def.key).decision,
    })),
    context: context
      ? {
          contextVersion: context.version,
          approxTokens: context.metadata.approxTokens,
          includedKnowledgeIds: context.metadata.includedKnowledgeIds,
        }
      : null,
    maxDelegationDepth: policy.maxDelegationDepth,
  });
}
