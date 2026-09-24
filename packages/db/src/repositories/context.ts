import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { AGENT_PERMISSIONS, evaluateAgentPermission } from "@aibos/access-core";
import { getTemplateKnowledgeProfile, type AgentKnowledgeProfile } from "@aibos/agent-core";
import {
  assembleContextPack,
  type ContextRequest,
  type ContextSources,
  type KnowledgeCandidate,
  type KnowledgeRetriever,
  type RetrievalQuery,
  type RuleCandidate,
} from "@aibos/context-core";
import {
  agentKnowledgeProfileSchema,
  knowledgeAccessPolicySchema,
  type AgentContextPack,
  type AgentKnowledgeProfileDTO,
  type AgentKnowledgeProfileInput,
  type KnowledgeAccessPolicyDTO,
} from "@aibos/shared";
import type { z } from "zod";
import type { Database } from "../client";
import { ConflictError, ForbiddenError, NotFoundError } from "../errors";
import {
  agentCompanyAssignments,
  agentKnowledgeProfiles,
  agents,
  departments,
  knowledgeAccessPolicies,
  knowledgeItems,
  tasks,
  type Company,
  type KnowledgeItem,
} from "../schema";
import { loadAgentAuthorityInput } from "./agent-authority";
import { recordAuditEvent } from "./audit";
import { assertDepartmentFor, knowledgeLinksFor } from "./knowledge";
import { getAiPolicy, getCompanyRecord } from "./profile";
import { loadRuleRows } from "./rules";
import { actorAuditFields, type Actor } from "./util";

/* ---------- retriever (deterministic, Postgres) ---------- */

function toCandidate(k: KnowledgeItem): KnowledgeCandidate {
  return {
    id: k.id,
    companyId: k.companyId,
    scope: k.scope,
    departmentId: k.departmentId,
    title: k.title,
    summary: k.summary,
    content: k.content,
    type: k.type,
    category: k.category,
    tags: k.tags,
    sourceType: k.sourceType,
    sourceReference: k.sourceReference,
    confidence: k.confidence,
    verificationStatus: k.verificationStatus,
    status: k.status,
    sensitivity: k.sensitivity,
    usableAsUnverified: k.usableAsUnverified,
    effectiveAt: k.effectiveAt,
    reviewAt: k.reviewAt,
    expiresAt: k.expiresAt,
    lastVerifiedAt: k.lastVerifiedAt,
    conflictKey: k.conflictKey,
    lineageId: k.lineageId,
    updatedAt: k.updatedAt,
  };
}

/**
 * Stage 03 retriever: every non-archived item of the company plus GLOBAL
 * items, and explicitly linked ids (so the engine can block cross-company
 * links visibly). No embeddings — relevance is decided by the engine.
 */
export class PostgresKnowledgeRetriever implements KnowledgeRetriever {
  readonly name = "postgres-deterministic";
  constructor(private readonly db: Database) {}

  async retrieve(q: RetrievalQuery): Promise<KnowledgeCandidate[]> {
    const scoped = or(
      eq(knowledgeItems.companyId, q.companyId),
      and(isNull(knowledgeItems.companyId), eq(knowledgeItems.scope, "global")),
    );
    const rows = await this.db
      .select()
      .from(knowledgeItems)
      .where(
        q.explicitIds.length ? or(scoped, inArray(knowledgeItems.id, [...q.explicitIds])) : scoped,
      )
      .limit(q.limit);
    return rows.map(toCandidate);
  }
}

/* ---------- agent knowledge profile ---------- */

export async function getAgentKnowledgeProfile(
  db: Database,
  agentId: string,
): Promise<AgentKnowledgeProfileDTO> {
  const [agent] = await db.select().from(agents).where(eq(agents.id, agentId));
  if (!agent) throw new NotFoundError("Agent", agentId);
  const [override] = await db
    .select()
    .from(agentKnowledgeProfiles)
    .where(eq(agentKnowledgeProfiles.agentId, agentId));
  const template = getTemplateKnowledgeProfile(agent.templateKey);
  const o = override
    ? {
        requiredTypes: override.requiredTypes,
        preferredTags: override.preferredTags,
        brandCategories: override.brandCategories,
        commercialCategories: override.commercialCategories,
      }
    : null;
  const union = <T>(a: readonly T[], b: readonly T[] | undefined) => [
    ...new Set([...a, ...(b ?? [])]),
  ];
  return {
    agentId,
    templateKey: agent.templateKey,
    template,
    override: o,
    effective: {
      requiredTypes: union(template.requiredTypes, o?.requiredTypes),
      preferredTags: union(template.preferredTags, o?.preferredTags),
      brandCategories: union(template.brandCategories, o?.brandCategories),
      commercialCategories: union(template.commercialCategories, o?.commercialCategories),
    },
  };
}

/** Sets (or clears with null) the agent's additions to its template knowledge profile. */
export async function setAgentKnowledgeProfile(
  db: Database,
  agentId: string,
  input: AgentKnowledgeProfileInput | null,
  actor: Actor,
): Promise<AgentKnowledgeProfileDTO> {
  await db.transaction(async (tx) => {
    const [agent] = await tx.select().from(agents).where(eq(agents.id, agentId));
    if (!agent) throw new NotFoundError("Agent", agentId);
    if (input === null) {
      await tx.delete(agentKnowledgeProfiles).where(eq(agentKnowledgeProfiles.agentId, agentId));
    } else {
      const data = agentKnowledgeProfileSchema.parse(input);
      await tx
        .insert(agentKnowledgeProfiles)
        .values({ agentId, ...data, updatedByUserId: actor.userId ?? null })
        .onConflictDoUpdate({
          target: agentKnowledgeProfiles.agentId,
          set: { ...data, updatedByUserId: actor.userId ?? null },
        });
    }
    await recordAuditEvent(tx, {
      ...actorAuditFields(actor),
      agentId,
      resourceType: "agent",
      resourceId: agentId,
      action: "agent.knowledge_profile_changed",
      description: `Default knowledge profile ${input === null ? "reset" : "updated"} for "${agent.name}"`,
      after: input ?? undefined,
    });
  });
  return getAgentKnowledgeProfile(db, agentId);
}

/* ---------- knowledge access policies ---------- */

export async function listKnowledgeAccessPolicies(
  db: Database,
  companyId: string,
): Promise<KnowledgeAccessPolicyDTO[]> {
  const rows = await db
    .select({
      p: knowledgeAccessPolicies,
      agentName: agents.name,
      departmentName: departments.name,
    })
    .from(knowledgeAccessPolicies)
    .leftJoin(agents, eq(agents.id, knowledgeAccessPolicies.agentId))
    .leftJoin(departments, eq(departments.id, knowledgeAccessPolicies.departmentId))
    .where(eq(knowledgeAccessPolicies.companyId, companyId));
  return rows.map(({ p, agentName, departmentName }) => ({
    id: p.id,
    companyId: p.companyId,
    agent: p.agentId ? { id: p.agentId, name: agentName ?? "—" } : null,
    department: p.departmentId ? { id: p.departmentId, name: departmentName ?? "—" } : null,
    maxSensitivity: p.maxSensitivity,
    note: p.note,
    createdAt: p.createdAt.toISOString(),
  }));
}

export async function createKnowledgeAccessPolicy(
  db: Database,
  companyId: string,
  input: z.input<typeof knowledgeAccessPolicySchema>,
  actor: Actor,
  opts: { origin?: "live" | "dev_seed" } = {},
): Promise<void> {
  const data = knowledgeAccessPolicySchema.parse(input);
  await db.transaction(async (tx) => {
    await assertDepartmentFor(tx, companyId, data.departmentId);
    if (data.agentId) {
      const [agent] = await tx.select().from(agents).where(eq(agents.id, data.agentId));
      if (!agent) throw new NotFoundError("Agent", data.agentId);
      if (agent.scope !== "global") {
        const [assigned] = await tx
          .select()
          .from(agentCompanyAssignments)
          .where(
            and(
              eq(agentCompanyAssignments.agentId, data.agentId),
              eq(agentCompanyAssignments.companyId, companyId),
            ),
          );
        if (!assigned) throw new ForbiddenError("The agent does not serve this company");
      }
    }
    const [row] = await tx
      .insert(knowledgeAccessPolicies)
      .values({
        companyId,
        ...data,
        createdByUserId: actor.userId ?? null,
        origin: opts.origin ?? "live",
      })
      .onConflictDoNothing()
      .returning();
    if (!row) throw new ConflictError("A policy for this agent/department already exists");
    await recordAuditEvent(
      tx,
      {
        ...actorAuditFields(actor),
        companyId,
        agentId: data.agentId ?? undefined,
        resourceType: "knowledge_access_policy",
        resourceId: row.id,
        action: "knowledge_access.granted",
        description: `Agent knowledge access up to ${data.maxSensitivity.toUpperCase()} granted (${data.agentId ? "agent" : data.departmentId ? "department" : "all company agents"})`,
        after: {
          agentId: data.agentId,
          departmentId: data.departmentId,
          maxSensitivity: data.maxSensitivity,
        },
      },
      opts.origin,
    );
  });
}

export async function deleteKnowledgeAccessPolicy(
  db: Database,
  companyId: string,
  id: string,
  actor: Actor,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [row] = await tx
      .delete(knowledgeAccessPolicies)
      .where(
        and(eq(knowledgeAccessPolicies.id, id), eq(knowledgeAccessPolicies.companyId, companyId)),
      )
      .returning();
    if (!row) throw new NotFoundError("Knowledge access policy", id);
    await recordAuditEvent(tx, {
      ...actorAuditFields(actor),
      companyId,
      agentId: row.agentId ?? undefined,
      resourceType: "knowledge_access_policy",
      resourceId: row.id,
      action: "knowledge_access.revoked",
      description: `Agent knowledge access up to ${row.maxSensitivity.toUpperCase()} revoked`,
      before: {
        agentId: row.agentId,
        departmentId: row.departmentId,
        maxSensitivity: row.maxSensitivity,
      },
    });
  });
}

/* ---------- context sources ---------- */

const join = (list: readonly string[]) => list.join("; ");

function companySnapshot(c: Company): ContextSources["company"] {
  const line = (label: string, value: string | null | undefined) =>
    value ? [{ label, value }] : [];
  const listLine = (label: string, value: readonly string[]) =>
    value.length ? [{ label, value: join(value) }] : [];
  return {
    id: c.id,
    name: c.name,
    // Identity + restrictions: always included.
    core: [
      ...line(
        "Company",
        c.tradingName && c.tradingName !== c.name
          ? `${c.name} (trading as ${c.tradingName})`
          : c.name,
      ),
      ...line("Industry", c.industry),
      ...line("Website", c.website),
      ...line("What the company does", c.description),
      ...line("Positioning", c.brandPositioning),
      ...line("Primary objective", c.primaryObjective),
      ...listLine("Prohibited claims", c.prohibitedClaims),
      ...listLine("Prohibited phrases", c.prohibitedPhrases),
      ...listLine("Claims requiring evidence", c.claimsRequiringEvidence),
      ...listLine("Company rules", c.companyRules),
      ...listLine("Legal disclaimers", c.legalDisclaimers),
      ...listLine("Data handling rules", c.dataHandlingRules),
    ],
    // Business detail: dropped first under a tight budget.
    extended: [
      ...listLine("Products", c.products),
      ...listLine("Services", c.productsServices),
      ...listLine("Target audiences", c.targetAudiences),
      ...listLine("Target markets", c.targetMarkets),
      ...listLine("Countries served", c.countriesServed),
      ...line("Revenue model", c.revenueModel),
      ...listLine("Secondary objectives", c.secondaryObjectives),
      ...listLine("Sales channels", c.salesChannels),
      ...listLine("Marketing channels", c.marketingChannels),
      ...line("Brand personality", c.brandPersonality),
      ...line("Brand voice", c.brandVoice),
      ...line("Tone", c.brandTone),
      ...line("Visual guidance", c.visualGuidance),
      ...listLine("Approved phrases", c.approvedPhrases),
      ...listLine("Claims allowed", c.claimsAllowed),
      ...listLine("Jurisdictions", c.jurisdictions),
      ...listLine("Regulators", c.regulators),
    ],
  };
}

export interface LoadContextInput {
  companyId: string;
  agentId: string;
  taskId?: string | null;
}

/**
 * Loads everything the Context Engine needs for (company, agent, task).
 * Enforces: the agent serves the company, the task belongs to the company.
 * Knowledge comes only from the retriever (company + GLOBAL + explicit links).
 */
export async function loadContextSources(
  db: Database,
  input: LoadContextInput,
  opts: { now?: Date; explicitIds?: string[]; retriever?: KnowledgeRetriever } = {},
): Promise<ContextSources> {
  const now = opts.now ?? new Date();
  const company = await getCompanyRecord(db, input.companyId);
  const authorityInput = await loadAgentAuthorityInput(db, input.agentId);
  const a = authorityInput.raw;
  if (a.scope !== "global" && !authorityInput.agent.companyIds.includes(company.id))
    throw new ForbiddenError("This agent is not assigned to the company");

  let task: ContextSources["task"] = null;
  if (input.taskId) {
    const [t] = await db.select().from(tasks).where(eq(tasks.id, input.taskId));
    if (!t) throw new NotFoundError("Task", input.taskId);
    if (t.companyId !== company.id)
      throw new ForbiddenError("The task belongs to a different company");
    const related = [t.parentTaskId, t.rootTaskId].filter((x): x is string => !!x);
    const relatedRows = related.length
      ? await db
          .select({ id: tasks.id, title: tasks.title, companyId: tasks.companyId })
          .from(tasks)
          .where(inArray(tasks.id, related))
      : [];
    const ref = (id: string | null) => {
      const r = relatedRows.find((x) => x.id === id);
      // Parent/root titles only when they are in the same company.
      return r && r.companyId === company.id ? { id: r.id, title: r.title } : null;
    };
    task = {
      id: t.id,
      companyId: t.companyId,
      title: t.title,
      description: t.description,
      type: t.type,
      priority: t.priority,
      status: t.status,
      parent: ref(t.parentTaskId),
      root: t.rootTaskId && t.rootTaskId !== t.id ? ref(t.rootTaskId) : null,
      allowUnverifiedContext: t.allowUnverifiedContext,
    };
  }

  const [dept, manager, profileDTO, aiPolicy, links, policies, ruleRows] = await Promise.all([
    a.departmentId
      ? db
          .select({ name: departments.name })
          .from(departments)
          .where(eq(departments.id, a.departmentId))
      : Promise.resolve([]),
    a.reportsToAgentId
      ? db.select({ name: agents.name }).from(agents).where(eq(agents.id, a.reportsToAgentId))
      : Promise.resolve([]),
    getAgentKnowledgeProfile(db, a.id),
    getAiPolicy(db, company.id),
    knowledgeLinksFor(db, { taskId: task?.id ?? null, agentId: a.id }),
    db
      .select()
      .from(knowledgeAccessPolicies)
      .where(eq(knowledgeAccessPolicies.companyId, company.id)),
    loadRuleRows(db, company.id),
  ]);

  const retriever = opts.retriever ?? new PostgresKnowledgeRetriever(db);
  let knowledge = await retriever.retrieve({
    companyId: company.id,
    explicitIds: [...links.map((l) => l.knowledgeId), ...(opts.explicitIds ?? [])],
    text: [task?.title, task?.description].filter(Boolean).join(" "),
    limit: 1000,
  });

  // Links follow the lineage: a link to a superseded version points at the current approved one.
  const byId = new Map(knowledge.map((k) => [k.id, k]));
  const resolvedLinks = links.map((l) => {
    const k = byId.get(l.knowledgeId);
    if (k && k.status === "superseded") {
      const current = knowledge.find((x) => x.lineageId === k.lineageId && x.status === "approved");
      if (current) return { ...l, knowledgeId: current.id };
    }
    return l;
  });
  knowledge = knowledge.filter(
    (k) => k.status !== "archived" || resolvedLinks.some((l) => l.knowledgeId === k.id),
  );

  const authority = AGENT_PERMISSIONS.map((def) => {
    const grant =
      authorityInput.grants.find((g) => g.permission === def.key && g.companyId === company.id) ??
      authorityInput.grants.find((g) => g.permission === def.key && g.companyId === null);
    return {
      permission: def.key,
      label: def.label,
      decision: evaluateAgentPermission(authorityInput, company.id, def.key).decision,
      grant: grant?.effect ?? null,
      approvalType: def.approvalType,
    };
  });

  const rules: RuleCandidate[] = [
    ...ruleRows.brand.map((r) => ({ ...r, kind: "brand" as const })),
    ...ruleRows.commercial.map((r) => ({ ...r, kind: "commercial" as const })),
    ...ruleRows.compliance.map((r) => ({ ...r, kind: "compliance" as const })),
  ];

  const profile: AgentKnowledgeProfile = profileDTO.effective;
  return {
    now,
    company: companySnapshot(company),
    aiPolicy,
    agent: {
      id: a.id,
      name: a.name,
      templateKey: a.templateKey,
      departmentId: a.departmentId,
      departmentName: dept[0]?.name ?? null,
      reportsTo: manager[0]?.name ?? null,
      autonomyLevel: a.autonomyLevel,
      prohibitedActions: a.prohibitedActions,
      authority,
      maxSearches: a.maxExternalSearches,
    },
    profile,
    task,
    knowledge,
    links: resolvedLinks,
    accessPolicies: policies.map((p) => ({
      agentId: p.agentId,
      departmentId: p.departmentId,
      maxSensitivity: p.maxSensitivity,
    })),
    rules,
  };
}

/** Task → Context Engine → AgentContextPack. The only path providers will use. */
export async function buildContextPack(
  db: Database,
  request: ContextRequest,
  opts: { now?: Date; retriever?: KnowledgeRetriever } = {},
): Promise<AgentContextPack> {
  const sources = await loadContextSources(
    db,
    { companyId: request.companyId, agentId: request.agentId, taskId: request.taskId },
    { now: opts.now, explicitIds: request.explicitKnowledgeIds, retriever: opts.retriever },
  );
  return assembleContextPack(request, sources);
}
