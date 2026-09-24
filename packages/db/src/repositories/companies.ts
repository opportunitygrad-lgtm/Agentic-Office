import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { getAgentTemplate } from "@aibos/agent-core";
import {
  OPEN_TASK_STATUSES,
  createCompanySchema,
  slugify,
  type CompanyDTO,
  type CompanyRef,
  type CompanySummaryDTO,
  type CreateCompanyInput,
} from "@aibos/shared";
import type { Database } from "../client";
import { ConflictError, NotFoundError } from "../errors";
import {
  agentCompanyAssignments,
  agents,
  aiUsageRecords,
  approvals,
  budgetPolicies,
  companies,
  departments,
  tasks,
  type Agent,
  type Company,
} from "../schema";
import { recordAuditEvent } from "./audit";
import { isUuid, startOfUtcDay, startOfUtcMonth, ts, type Actor } from "./util";

export function toCompanyRef(c: Pick<Company, "id" | "name" | "slug" | "accentColor">): CompanyRef {
  return { id: c.id, name: c.name, slug: c.slug, accentColor: c.accentColor };
}

export function toCompanyDTO(c: Company): CompanyDTO {
  return {
    ...toCompanyRef(c),
    legalName: c.legalName,
    industry: c.industry,
    description: c.description,
    website: c.website,
    logoUrl: c.logoUrl,
    primaryCountry: c.primaryCountry,
    countriesServed: c.countriesServed,
    timezone: c.timezone,
    defaultCurrency: c.defaultCurrency,
    targetAudiences: c.targetAudiences,
    targetMarkets: c.targetMarkets,
    productsServices: c.productsServices,
    businessObjectives: c.businessObjectives,
    primaryObjective: c.primaryObjective,
    revenueObjective: c.revenueObjective,
    brandPositioning: c.brandPositioning,
    brandTone: c.brandTone,
    companyRules: c.companyRules,
    prohibitedClaims: c.prohibitedClaims,
    competitorNotes: c.competitorNotes,
    complianceNotes: c.complianceNotes,
    defaultProvider: c.defaultProvider,
    monthlyAiBudget: c.monthlyAiBudget,
    dailyAiBudget: c.dailyAiBudget,
    concurrencyLimit: c.concurrencyLimit,
    status: c.status,
    settings: c.settings,
    origin: c.origin,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

/** Resolves a company by id or slug. `undefined`/"all" → null (global scope). */
export async function resolveCompany(db: Database, ref?: string | null): Promise<Company | null> {
  if (!ref || ref === "all") return null;
  const [row] = await db
    .select()
    .from(companies)
    .where(isUuid(ref) ? eq(companies.id, ref) : eq(companies.slug, ref))
    .limit(1);
  if (!row) throw new NotFoundError("Company", ref);
  return row;
}

export async function listCompanies(db: Database): Promise<CompanyDTO[]> {
  const rows = await db.select().from(companies).orderBy(companies.createdAt, companies.name);
  return rows.map(toCompanyDTO);
}

export async function listCompanySummaries(db: Database): Promise<CompanySummaryDTO[]> {
  const rows = await db.select().from(companies).orderBy(companies.createdAt, companies.name);
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const now = new Date();

  const [agentStats, taskStats, approvalStats, spendStats] = await Promise.all([
    db
      .select({
        companyId: agentCompanyAssignments.companyId,
        total: sql<number>`count(*)::int`,
        working: sql<number>`count(*) filter (where ${agents.status} = 'working')::int`,
      })
      .from(agentCompanyAssignments)
      .innerJoin(agents, eq(agents.id, agentCompanyAssignments.agentId))
      .where(inArray(agentCompanyAssignments.companyId, ids))
      .groupBy(agentCompanyAssignments.companyId),
    db
      .select({ companyId: tasks.companyId, open: sql<number>`count(*)::int` })
      .from(tasks)
      .where(and(inArray(tasks.companyId, ids), inArray(tasks.status, [...OPEN_TASK_STATUSES])))
      .groupBy(tasks.companyId),
    db
      .select({ companyId: approvals.companyId, pending: sql<number>`count(*)::int` })
      .from(approvals)
      .where(and(inArray(approvals.companyId, ids), eq(approvals.status, "pending")))
      .groupBy(approvals.companyId),
    db
      .select({
        companyId: aiUsageRecords.companyId,
        month: sql<number>`coalesce(sum(${aiUsageRecords.actualCost}), 0)::float8`,
        today: sql<number>`coalesce(sum(${aiUsageRecords.actualCost}) filter (where ${aiUsageRecords.occurredAt} >= ${ts(startOfUtcDay(now))}), 0)::float8`,
      })
      .from(aiUsageRecords)
      .where(
        and(
          inArray(aiUsageRecords.companyId, ids),
          gte(aiUsageRecords.occurredAt, startOfUtcMonth(now)),
        ),
      )
      .groupBy(aiUsageRecords.companyId),
  ]);

  const by = <T extends { companyId: string | null }>(list: T[]) =>
    new Map(list.map((x) => [x.companyId, x] as const));
  const a = by(agentStats);
  const t = by(taskStats);
  const p = by(approvalStats);
  const s = by(spendStats);

  return rows.map((c) => ({
    ...toCompanyDTO(c),
    stats: {
      agents: a.get(c.id)?.total ?? 0,
      workingAgents: a.get(c.id)?.working ?? 0,
      openTasks: t.get(c.id)?.open ?? 0,
      pendingApprovals: p.get(c.id)?.pending ?? 0,
      spendTodayUsd: s.get(c.id)?.today ?? 0,
      spendMonthUsd: s.get(c.id)?.month ?? 0,
    },
  }));
}

const ACCENTS = ["#2563eb", "#0d9488", "#7c3aed", "#db2777", "#ea580c", "#16a34a", "#0891b2"];

export interface CreateCompanyResult {
  company: CompanyDTO;
  agents: Agent[];
}

/**
 * Creates a company, its budget policies and any initial agents chosen in the
 * onboarding wizard — atomically, with an audit trail.
 */
export async function createCompany(
  db: Database,
  input: CreateCompanyInput,
  actor: Actor,
  opts: { origin?: "live" | "dev_seed" } = {},
): Promise<CreateCompanyResult> {
  const data = createCompanySchema.parse(input);
  const slug = data.slug ?? slugify(data.name);
  if (slug.length < 2) throw new ConflictError("Company name must produce a valid slug");
  const origin = opts.origin ?? "live";

  return db.transaction(async (tx) => {
    const existing = await tx
      .select({ id: companies.id })
      .from(companies)
      .where(eq(companies.slug, slug));
    if (existing.length) throw new ConflictError(`A company with slug "${slug}" already exists`);

    const [{ count }] = (await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(companies)) as [{ count: number }];

    const [company] = await tx
      .insert(companies)
      .values({
        name: data.name,
        slug,
        legalName: data.legalName,
        industry: data.industry,
        description: data.description,
        website: data.website,
        logoUrl: data.logoUrl,
        accentColor: data.accentColor ?? ACCENTS[count % ACCENTS.length],
        primaryCountry: data.primaryCountry,
        countriesServed: data.countriesServed.length ? data.countriesServed : [data.primaryCountry],
        timezone: data.timezone,
        defaultCurrency: data.defaultCurrency,
        targetAudiences: data.targetAudiences,
        targetMarkets: data.targetMarkets,
        productsServices: data.productsServices,
        businessObjectives: [data.primaryObjective, data.revenueObjective].filter(
          (v): v is string => !!v,
        ),
        primaryObjective: data.primaryObjective,
        revenueObjective: data.revenueObjective,
        brandPositioning: data.brandPositioning,
        brandTone: data.brandTone,
        companyRules: data.companyRules,
        prohibitedClaims: data.prohibitedClaims,
        competitorNotes: data.competitorNotes,
        complianceNotes: data.complianceNotes,
        defaultProvider: data.defaultProvider,
        dailyAiBudget: data.dailyAiBudget,
        monthlyAiBudget: data.monthlyAiBudget,
        concurrencyLimit: data.concurrencyLimit,
        settings: {
          version: 1,
          approvals: {
            highCostTasks: data.requireApprovalHighCost,
            deepResearch: data.requireApprovalDeepResearch,
          },
        },
        origin,
      })
      .returning();
    if (!company) throw new Error("Company insert failed");

    await tx.insert(budgetPolicies).values([
      {
        name: `${company.name} — daily AI budget`,
        scope: "company_day",
        companyId: company.id,
        limitUsd: data.dailyAiBudget,
        origin,
      },
      {
        name: `${company.name} — monthly AI budget`,
        scope: "company_month",
        companyId: company.id,
        limitUsd: data.monthlyAiBudget,
        origin,
      },
    ]);

    const created: Agent[] = [];
    if (data.initialAgents.length) {
      const deptRows = await tx
        .select()
        .from(departments)
        .where(sql`${departments.companyId} is null`);
      const deptBySlug = new Map(deptRows.map((d) => [d.slug, d.id]));
      const keys = [...new Set(data.initialAgents)];
      // Company Manager first so specialists can report to it.
      keys.sort((x, y) => (x === "company_manager" ? -1 : y === "company_manager" ? 1 : 0));
      let managerId: string | null = null;

      for (const key of keys) {
        const tpl = getAgentTemplate(key);
        const agentId = randomUUID();
        const inserted: Agent[] = await tx
          .insert(agents)
          .values({
            id: agentId,
            name: `${company.name} ${tpl.name}`,
            slug: `${slug}-${key.replace(/_/g, "-")}`,
            description: tpl.description,
            templateKey: key,
            scope: "company",
            status: "sleeping",
            departmentId: deptBySlug.get(tpl.department) ?? null,
            reportsToAgentId: key === "company_manager" ? null : managerId,
            primaryProvider:
              data.defaultProvider === "LOCAL" ? tpl.defaultProvider : data.defaultProvider,
            fallbackProvider: tpl.fallbackProvider,
            autonomyLevel: tpl.defaultAutonomy,
            responsibilities: tpl.responsibilities,
            prohibitedActions: tpl.prohibitedActions,
            allowedTools: tpl.defaultTools,
            approvalRequirements: tpl.approvalRequirements,
            readPermissions: [`company:${slug}:read`],
            writePermissions: [],
            origin,
          })
          .returning();
        const agent = inserted[0];
        if (!agent) throw new Error("Agent insert failed");
        if (key === "company_manager") managerId = agent.id;
        await tx
          .insert(agentCompanyAssignments)
          .values({ agentId: agent.id, companyId: company.id, isPrimary: true });
        created.push(agent);
      }
    }

    await recordAuditEvent(
      tx,
      {
        companyId: company.id,
        actorUser: actor.kind === "human" ? actor.ref : undefined,
        action: "company.created",
        description: `Company "${company.name}" created with ${created.length} initial agent(s)`,
        metadata: { slug, initialAgents: data.initialAgents, actor: actor.ref },
        after: {
          name: company.name,
          slug,
          dailyAiBudget: data.dailyAiBudget,
          monthlyAiBudget: data.monthlyAiBudget,
        },
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
        requestId: actor.requestId,
      },
      origin,
    );

    return { company: toCompanyDTO(company), agents: created };
  });
}
