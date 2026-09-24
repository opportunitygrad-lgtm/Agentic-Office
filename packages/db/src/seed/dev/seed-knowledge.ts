/**
 * DEVELOPMENT SEED — Stage 03 company profiles, knowledge, rules, links and
 * access policies. All rows use origin = 'dev_seed' and are replaced on every run.
 */
import { and, eq, inArray } from "drizzle-orm";
import type { Database } from "../../client";
import {
  brandRules,
  commercialRules,
  companies,
  companyAiPolicies,
  complianceRules,
  departments,
  knowledgeAccessPolicies,
  knowledgeItems,
  knowledgeLinks,
  tasks,
} from "../../schema";
import { SEED_COMPANIES } from "./data";
import {
  SEED_AI_POLICIES,
  SEED_KNOWLEDGE,
  SEED_LINKS,
  SEED_PROFILES,
  SEED_RULES,
  SEED_UNVERIFIED_TASKS,
} from "./knowledge-data";

const ORIGIN = "dev_seed" as const;

export async function clearKnowledgeSeed(db: Database): Promise<void> {
  await db.delete(knowledgeLinks).where(eq(knowledgeLinks.origin, ORIGIN));
  await db.delete(knowledgeAccessPolicies).where(eq(knowledgeAccessPolicies.origin, ORIGIN));
  await db.delete(knowledgeItems).where(eq(knowledgeItems.origin, ORIGIN));
  await db.delete(brandRules).where(eq(brandRules.origin, ORIGIN));
  await db.delete(commercialRules).where(eq(commercialRules.origin, ORIGIN));
  await db.delete(complianceRules).where(eq(complianceRules.origin, ORIGIN));
}

export async function seedKnowledge(
  db: Database,
  ctx: {
    now: Date;
    companyIds: Map<string, string>;
    agentIds: Map<string, string>;
    taskIds: Map<string, string>;
    approverId: string;
  },
): Promise<Record<string, number>> {
  const { now, approverId } = ctx;
  const day = 86_400_000;
  const cid = (slug: string | null) => (slug ? ctx.companyIds.get(slug)! : null);

  /* profiles + AI policies (dev-seed companies only; edits are reset by re-seeding) */
  for (const c of SEED_COMPANIES) {
    const id = cid(c.slug)!;
    const {
      slug: _s,
      initialAgents: _i,
      dailyAiBudget: _d,
      monthlyAiBudget: _m,
      concurrencyLimit: _c,
      ...identity
    } = c;
    await db
      .update(companies)
      .set({
        // Clear Stage 01 demo text that is not known company information.
        legalName: null,
        website: null,
        revenueObjective: null,
        competitorNotes: null,
        complianceNotes: null,
        businessObjectives: [],
        ...identity,
        ...SEED_PROFILES[c.slug],
      })
      .where(and(eq(companies.id, id), eq(companies.origin, ORIGIN)));
    const policy = SEED_AI_POLICIES[c.slug]!;
    await db
      .insert(companyAiPolicies)
      .values({ companyId: id, ...policy })
      .onConflictDoUpdate({ target: companyAiPolicies.companyId, set: policy });
  }

  /* knowledge */
  const deptRows = await db.select().from(departments);
  const deptId = (slug?: string) =>
    slug ? (deptRows.find((d) => d.slug === slug && d.companyId === null)?.id ?? null) : null;
  const knowledgeIds = new Map<string, string>();
  for (const k of SEED_KNOWLEDGE) {
    const id = crypto.randomUUID();
    const approved = k.status === "approved";
    await db.insert(knowledgeItems).values({
      id,
      lineageId: id,
      companyId: cid(k.company),
      scope: k.company ? "company" : "global",
      departmentId: deptId(k.department),
      title: k.title,
      summary: k.summary ?? null,
      content: k.content,
      type: k.type,
      tags: k.tags,
      sourceType: k.sourceType,
      sourceReference: k.sourceReference ?? null,
      sourceOwner: k.sourceType === "management_entry" ? "Management" : null,
      provenanceNotes: "Development seed — known high-level information only.",
      confidence: k.confidence ?? "medium",
      verificationStatus: k.verification,
      status: k.status,
      sensitivity: k.sensitivity ?? "internal",
      usableAsUnverified: k.usableAsUnverified ?? false,
      conflictKey: k.conflictKey ?? null,
      expiresAt:
        k.expiresInDays !== undefined ? new Date(now.getTime() + k.expiresInDays * day) : null,
      reviewAt:
        k.reviewInDays !== undefined
          ? new Date(now.getTime() + k.reviewInDays * day)
          : new Date(now.getTime() + 180 * day),
      lastVerifiedAt:
        k.verifiedDaysAgo !== undefined ? new Date(now.getTime() - k.verifiedDaysAgo * day) : null,
      submittedAt: k.status === "review" ? new Date(now.getTime() - day) : null,
      approvedAt: approved ? new Date(now.getTime() - (k.verifiedDaysAgo ?? 1) * day) : null,
      approvedByUserId: approved ? approverId : null,
      createdByUserId: approverId,
      origin: ORIGIN,
    });
    knowledgeIds.set(k.key, id);
  }

  /* rules */
  for (const r of SEED_RULES) {
    const common = {
      companyId: cid(r.company),
      title: r.title,
      description: r.description,
      severity: r.severity,
      status: r.status ?? "approved",
      approvedAt: (r.status ?? "approved") === "approved" ? now : null,
      approvedByUserId: (r.status ?? "approved") === "approved" ? approverId : null,
      createdByUserId: approverId,
      origin: ORIGIN,
    };
    if (r.kind === "brand")
      await db.insert(brandRules).values({
        ...common,
        category: r.category as typeof brandRules.$inferInsert.category,
        channel: r.channel ?? "all",
      });
    else if (r.kind === "commercial")
      await db.insert(commercialRules).values({
        ...common,
        category: r.category as typeof commercialRules.$inferInsert.category,
        appliesTo: r.appliesTo!,
        effect: r.effect as typeof commercialRules.$inferInsert.effect,
        limitAmount: r.limitAmount ?? null,
        currency: r.currency ?? null,
        period: r.period ?? null,
        requiredPermission: r.requiredPermission ?? null,
      });
    else
      await db.insert(complianceRules).values({
        ...common,
        action: r.action!,
        effect: r.effect as typeof complianceRules.$inferInsert.effect,
        disclosureText: r.disclosureText ?? null,
        requiredPermission: r.requiredPermission ?? null,
      });
  }

  /* explicit links */
  for (const l of SEED_LINKS) {
    await db.insert(knowledgeLinks).values({
      knowledgeId: knowledgeIds.get(l.knowledge)!,
      target: l.task ? "task" : "agent",
      taskId: l.task ? ctx.taskIds.get(l.task)! : null,
      agentId: l.agent ? ctx.agentIds.get(l.agent)! : null,
      createdByUserId: approverId,
      origin: ORIGIN,
    });
  }

  /* tasks that may use UNVERIFIED research */
  const unverifiedTasks = SEED_UNVERIFIED_TASKS.map((k) => ctx.taskIds.get(k)!).filter(Boolean);
  if (unverifiedTasks.length)
    await db
      .update(tasks)
      .set({ allowUnverifiedContext: true })
      .where(inArray(tasks.id, unverifiedTasks));

  /* access policy: the PilotsAssist partnerships agent may read CONFIDENTIAL knowledge */
  const pa = cid("pilotsassist")!;
  const paSales = ctx.agentIds.get("pa-partnerships");
  if (paSales)
    await db.insert(knowledgeAccessPolicies).values({
      companyId: pa,
      agentId: paSales,
      maxSensitivity: "confidential",
      note: "Development seed: partnerships agent may use confidential finance guidance.",
      createdByUserId: approverId,
      origin: ORIGIN,
    });

  return {
    knowledge: SEED_KNOWLEDGE.length,
    rules: SEED_RULES.length,
    links: SEED_LINKS.length,
  };
}
