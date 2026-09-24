/**
 * DEVELOPMENT SEED — creates demo agents, tasks, approvals, audit events and
 * mock AI usage so the Command Centre is visually useful. Re-runnable: all
 * origin='dev_seed' rows (except companies, which are upserted) are replaced.
 */
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { getAgentTemplate } from "@aibos/agent-core";
import { INTEGRATION_CATALOG } from "@aibos/integration-core";
import { PROVIDER_TYPES } from "@aibos/shared";
import type { Database } from "../../client";
import { createCompany } from "../../repositories/companies";
import {
  agentCompanyAssignments,
  agents,
  aiUsageRecords,
  approvals,
  auditEvents,
  budgetPolicies,
  companies,
  departments,
  integrations,
  tasks,
} from "../../schema";
import {
  SEED_AGENTS,
  SEED_APPROVALS,
  SEED_COMPANIES,
  SEED_COMPANY_SPLIT,
  SEED_EVENTS,
  SEED_TASKS,
  SEED_USAGE_PROFILE,
} from "./data";

const SEED_ACTOR = { kind: "system" as const, ref: "dev-seed" };
const ORIGIN = "dev_seed" as const;

/** Deterministic PRNG so seeded charts look the same on every run. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export async function clearDevSeed(db: Database): Promise<void> {
  await db.delete(aiUsageRecords).where(eq(aiUsageRecords.origin, ORIGIN));
  await db.delete(auditEvents).where(eq(auditEvents.origin, ORIGIN));
  await db.delete(approvals).where(eq(approvals.origin, ORIGIN));
  await db.delete(tasks).where(eq(tasks.origin, ORIGIN));
  await db.delete(agents).where(eq(agents.origin, ORIGIN));
  await db
    .delete(budgetPolicies)
    .where(and(eq(budgetPolicies.origin, ORIGIN), isNull(budgetPolicies.companyId)));
  await db.delete(integrations).where(eq(integrations.origin, ORIGIN));
}

export async function seedDev(db: Database, now = new Date()): Promise<Record<string, number>> {
  await clearDevSeed(db);
  const ago = (min: number) => new Date(now.getTime() - min * 60_000);

  /* companies (upsert by slug; created through the real repository path) */
  const companyIds = new Map<string, string>();
  for (const c of SEED_COMPANIES) {
    const [existing] = await db.select().from(companies).where(eq(companies.slug, c.slug));
    if (existing) {
      companyIds.set(c.slug, existing.id);
      continue;
    }
    const { company } = await createCompany(db, c, SEED_ACTOR, { origin: ORIGIN });
    companyIds.set(c.slug, company.id);
  }
  const cid = (slug: string | null) => (slug ? companyIds.get(slug)! : null);

  /* agents */
  const deptRows = await db.select().from(departments).where(isNull(departments.companyId));
  const deptId = new Map(deptRows.map((d) => [d.slug, d.id]));
  const agentIds = new Map<string, string>();
  for (const a of SEED_AGENTS) {
    const tpl = getAgentTemplate(a.template);
    const [row] = await db
      .insert(agents)
      .values({
        name: a.name,
        slug: `seed-${a.key}`,
        description: tpl.description,
        templateKey: a.template,
        scope: a.company ? "company" : "global",
        status: a.status,
        departmentId: deptId.get(a.department) ?? null,
        primaryProvider: a.provider ?? tpl.defaultProvider,
        fallbackProvider: tpl.fallbackProvider,
        autonomyLevel: tpl.defaultAutonomy,
        responsibilities: tpl.responsibilities,
        prohibitedActions: tpl.prohibitedActions,
        allowedTools: tpl.defaultTools,
        approvalRequirements: tpl.approvalRequirements,
        readPermissions: a.company ? [`company:${a.company}:read`] : ["company:*:read"],
        writePermissions: [],
        concurrencyLimit: a.company ? 1 : 3,
        dailyBudget: a.company ? 5 : 15,
        lastActiveAt: a.status === "working" ? ago(1) : ago(600),
        origin: ORIGIN,
      })
      .returning({ id: agents.id });
    agentIds.set(a.key, row!.id);
  }
  for (const a of SEED_AGENTS) {
    if (a.reportsTo) {
      await db
        .update(agents)
        .set({ reportsToAgentId: agentIds.get(a.reportsTo)! })
        .where(eq(agents.id, agentIds.get(a.key)!));
    }
    const serves = [...new Set([...(a.company ? [a.company] : []), ...(a.alsoServes ?? [])])];
    if (serves.length) {
      await db.insert(agentCompanyAssignments).values(
        serves.map((slug) => ({
          agentId: agentIds.get(a.key)!,
          companyId: cid(slug)!,
          isPrimary: slug === a.company,
        })),
      );
    }
  }
  const aid = (key?: string | null) => (key ? agentIds.get(key)! : null);

  /* tasks (parents first — SEED_TASKS is ordered) */
  const taskIds = new Map<string, string>();
  const taskMeta = new Map<string, { root: string; depth: number }>();
  for (const t of SEED_TASKS) {
    const id = crypto.randomUUID();
    const parent = t.parent ? taskMeta.get(t.parent) : undefined;
    const root = parent ? parent.root : id;
    const depth = parent ? parent.depth + 1 : 0;
    await db.insert(tasks).values({
      id,
      companyId: cid(t.company),
      title: t.title,
      description: t.description,
      type: t.type,
      priority: t.priority,
      status: t.status,
      assignedAgentId: aid(t.agent),
      createdByKind: t.parent ? "agent" : "human",
      createdByRef: t.parent ? "seed-group-manager" : "dev-user",
      parentTaskId: t.parent ? taskIds.get(t.parent)! : null,
      rootTaskId: root,
      depth,
      progress: t.progress,
      currentAction: t.currentAction,
      currentTool: t.currentTool,
      requiresApproval: t.requiresApproval ?? false,
      estimatedCost: t.estimatedCost,
      actualCost: t.actualCost,
      startedAt: t.startedMinutesAgo !== undefined ? ago(t.startedMinutesAgo) : null,
      completedAt: t.completedMinutesAgo !== undefined ? ago(t.completedMinutesAgo) : null,
      dueAt: t.dueInHours !== undefined ? new Date(now.getTime() + t.dueInHours * 3_600_000) : null,
      error: t.error,
      resultSummary: t.resultSummary,
      createdAt: ago((t.startedMinutesAgo ?? 30) + 5),
      updatedAt: ago(t.completedMinutesAgo ?? Math.min(t.startedMinutesAgo ?? 30, 15)),
      origin: ORIGIN,
    });
    taskIds.set(t.key, id);
    taskMeta.set(t.key, { root, depth });
  }
  const tid = (key?: string) => (key ? taskIds.get(key)! : null);

  /* approvals */
  for (const a of SEED_APPROVALS) {
    await db.insert(approvals).values({
      companyId: cid(a.company),
      taskId: tid(a.task),
      agentId: aid(a.agent),
      type: a.type,
      requestedAction: a.requestedAction,
      explanation: a.explanation,
      riskLevel: a.riskLevel,
      proposedChange: a.proposedChange,
      beforeState: a.beforeState,
      afterState: a.afterState,
      status: a.status ?? "pending",
      requestedAt: ago(a.minutesAgo),
      expiresAt: new Date(now.getTime() + 48 * 3_600_000),
      decidedBy: a.status && a.status !== "pending" ? "dev-user" : null,
      decidedAt: a.status && a.status !== "pending" ? ago(a.minutesAgo - 30) : null,
      decisionNotes: a.status === "approved" ? "Approved in weekly review (seed)" : null,
      origin: ORIGIN,
    });
  }

  /* audit events */
  await db.insert(auditEvents).values(
    SEED_EVENTS.map((e) => ({
      occurredAt: ago(e.minutesAgo),
      companyId: cid(e.company),
      agentId: aid(e.agent),
      taskId: tid(e.task),
      actorUser: e.action === "approval.granted" ? "dev-user" : null,
      action: e.action,
      tool: e.tool,
      provider: e.provider,
      description: e.description,
      metadata: { seed: true },
      outcome: e.outcome ?? "success",
      error: e.error,
      origin: ORIGIN,
    })),
  );

  /* mock AI usage ledger: 35 days, per provider, split across companies */
  const rand = mulberry32(20260101);
  const dayFraction = Math.max(0.35, (now.getUTCHours() * 60 + now.getUTCMinutes()) / 1440);
  const usageRows: (typeof aiUsageRecords.$inferInsert)[] = [];
  const agentForCompany: Record<string, string> = {
    "euro-pilot-training": "ept-research",
    pilotsassist: "pa-web-seo",
    opportunitygrad: "og-marketing-meta",
  };
  for (let d = 34; d >= 0; d--) {
    const dayStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - d),
    );
    const weekend = [0, 6].includes(dayStart.getUTCDay()) ? 0.45 : 1;
    for (const provider of PROVIDER_TYPES) {
      const profile = SEED_USAGE_PROFILE[provider];
      for (const [slug, share] of Object.entries(SEED_COMPANY_SPLIT)) {
        const jitter = 0.7 + rand() * 0.6;
        let cost = profile.daily * share * weekend * jitter;
        if (d === 0) cost *= dayFraction;
        const calls =
          provider === "LOCAL" ? 20 + Math.floor(rand() * 30) : Math.max(1, Math.round(cost * 3));
        const inputTokens = provider === "LOCAL" ? 0 : Math.round(cost * 180_000);
        const outputTokens = provider === "LOCAL" ? 0 : Math.round(cost * 22_000);
        const at =
          d === 0
            ? new Date(now.getTime() - rand() * dayFraction * 86_400_000 * 0.9)
            : new Date(dayStart.getTime() + (8 + rand() * 10) * 3_600_000);
        usageRows.push({
          occurredAt: at,
          provider,
          model: profile.model,
          companyId: cid(slug),
          agentId: aid(agentForCompany[slug]),
          inputTokens,
          outputTokens,
          cachedTokens: Math.round(inputTokens * 0.2),
          providerCost: Number(cost.toFixed(4)),
          estimatedCost: Number((cost * 1.05).toFixed(4)),
          actualCost: Number(cost.toFixed(4)),
          requestId: `mock-${provider}-${slug}-${d}-${calls}`,
          origin: ORIGIN,
        });
      }
    }
  }
  await db.insert(aiUsageRecords).values(usageRows);

  // Group-wide and provider-level budget policies
  await db.insert(budgetPolicies).values([
    {
      name: "Group — daily AI ceiling",
      scope: "global_day",
      limitUsd: 60,
      actionOnExceed: "block",
      origin: ORIGIN,
    },
    {
      name: "Grok — daily cap",
      scope: "provider_day",
      provider: "GROK",
      limitUsd: 5,
      actionOnExceed: "require_approval",
      origin: ORIGIN,
    },
    {
      name: "Research agent — per task",
      scope: "task",
      agentId: aid("ept-research"),
      limitUsd: 5,
      actionOnExceed: "require_approval",
      origin: ORIGIN,
    },
    {
      name: "Meta agent — per day",
      scope: "agent_day",
      agentId: aid("og-marketing-meta"),
      limitUsd: 6,
      actionOnExceed: "warn",
      origin: ORIGIN,
    },
  ]);

  /* per-company integration placeholders (all not_configured — no credentials) */
  const perCompany = INTEGRATION_CATALOG.filter((d) => d.perCompany);
  const existing = await db
    .select({ kind: integrations.kind, companyId: integrations.companyId })
    .from(integrations)
    .where(inArray(integrations.companyId, [...companyIds.values()]));
  const have = new Set(existing.map((e) => `${e.kind}|${e.companyId}`));
  const rows: (typeof integrations.$inferInsert)[] = [];
  for (const companyId of companyIds.values()) {
    for (const d of perCompany) {
      if (!have.has(`${d.kind}|${companyId}`)) {
        rows.push({
          kind: d.kind,
          companyId,
          name: d.name,
          capabilities: d.capabilities,
          origin: ORIGIN,
        });
      }
    }
  }
  if (rows.length) await db.insert(integrations).values(rows);

  const [counts] = await db.execute<{
    agents: number;
    tasks: number;
    approvals: number;
    events: number;
    usage: number;
  }>(sql`
    select (select count(*)::int from ${agents}) as agents, (select count(*)::int from ${tasks}) as tasks,
           (select count(*)::int from ${approvals}) as approvals, (select count(*)::int from ${auditEvents}) as events,
           (select count(*)::int from ${aiUsageRecords}) as usage`);
  return { companies: companyIds.size, ...(counts ?? {}) };
}
