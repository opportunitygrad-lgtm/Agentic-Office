import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { evaluateCompanyAction, type RuleCandidate } from "@aibos/context-core";
import {
  ConflictError,
  ForbiddenError,
  approveKnowledge,
  archiveKnowledge,
  buildContextPack,
  createKnowledge,
  createKnowledgeAccessPolicy,
  createRule,
  getCompanyProfile,
  getKnowledgeDetail,
  linkKnowledge,
  listCompanyHistory,
  listCompanyRules,
  listKnowledge,
  listKnowledgeConflicts,
  loadRuleRows,
  resolveCompany,
  ruleLifecycle,
  schema,
  submitKnowledge,
  supersedeKnowledge,
  updateAiPolicy,
  updateCompanyProfileSection,
  updateKnowledge,
  updateRule,
  type Actor,
  type KnowledgeVisibility,
} from "../src";
import { seedDev } from "../src/seed/dev/seed-dev";
import { createTestDb, resetOperationalData } from "./helpers";

const handle = createTestDb();
const db = handle.db;
const actor: Actor = { kind: "human", ref: "tester@aibos.example" };
let EPT = "";
let PA = "";
let OG = "";
const everything: KnowledgeVisibility = {
  scope: { companyIds: "all", includeGroup: true },
  includeGlobal: true,
  canRead: () => true,
};
const VIEWER = {
  canEdit: true,
  canApprove: true,
  canArchive: true,
};

const draft = (companyId: string | null, extra: Record<string, unknown> = {}) =>
  createKnowledge(
    db,
    {
      scope: companyId ? "company" : "global",
      companyId,
      title: "Integrated ATPL overview",
      content: "Approved description of the integrated route.",
      type: "service",
      sourceType: "management_entry",
      tags: ["atpl"],
      ...extra,
    },
    actor,
  );

beforeAll(async () => {
  await resetOperationalData(handle);
  await seedDev(db);
  EPT = (await resolveCompany(db, "euro-pilot-training"))!.id;
  PA = (await resolveCompany(db, "pilotsassist"))!.id;
  OG = (await resolveCompany(db, "opportunitygrad"))!.id;
});

afterAll(() => handle.close());

describe("knowledge lifecycle", () => {
  it("creates company knowledge as a draft with provenance and an audit event", async () => {
    const item = await draft(EPT, { sourceUrl: "https://example.com/doc", sourceOwner: "Ops" });
    expect(item.status).toBe("draft");
    expect(item.version).toBe(1);
    expect(item.lineageId).toBe(item.id);
    expect(item.sourceUrl).toBe("https://example.com/doc");
    const [event] = await db
      .select()
      .from(schema.auditEvents)
      .where(
        and(
          eq(schema.auditEvents.resourceId, item.id),
          eq(schema.auditEvents.action, "knowledge.created"),
        ),
      );
    expect(event?.companyId).toBe(EPT);
    expect(JSON.stringify(event)).not.toContain("Approved description");
  });

  it("goes draft → review → approved, recording the approver", async () => {
    const item = await draft(EPT);
    expect((await submitKnowledge(db, item.id, actor)).status).toBe("review");
    const approved = await approveKnowledge(
      db,
      item.id,
      { verificationStatus: "management_confirmed" },
      actor,
    );
    expect(approved.status).toBe("approved");
    expect(approved.approvedAt).not.toBeNull();
    expect(approved.lastVerifiedAt).not.toBeNull();
    await expect(submitKnowledge(db, item.id, actor)).rejects.toBeInstanceOf(ConflictError);
  });

  it("versions material edits of approved knowledge and supersedes on approval", async () => {
    const v1 = await draft(EPT, { title: "Refund policy" });
    await approveKnowledge(db, v1.id, {}, actor);
    // Non-material edit (tags) happens in place.
    const inPlace = await updateKnowledge(db, v1.id, { tags: ["refunds"] }, actor);
    expect(inPlace.newVersion).toBe(false);
    // Material edit creates v2 as a draft; v1 stays approved.
    const v2 = await updateKnowledge(
      db,
      v1.id,
      { content: "Refunds are decided by management." },
      actor,
    );
    expect(v2.newVersion).toBe(true);
    expect(v2.item.version).toBe(2);
    expect(v2.item.status).toBe("draft");
    expect(v2.item.supersedesId).toBe(v1.id);
    await expect(updateKnowledge(db, v1.id, { content: "Another change" }, actor)).rejects.toThrow(
      /newer draft/,
    );
    await approveKnowledge(db, v2.item.id, {}, actor);
    const [old] = await db
      .select()
      .from(schema.knowledgeItems)
      .where(eq(schema.knowledgeItems.id, v1.id));
    expect(old!.status).toBe("superseded");
    expect(old!.supersededById).toBe(v2.item.id);
    const detail = await getKnowledgeDetail(db, v2.item.id, {
      visibility: everything,
      viewer: VIEWER,
    });
    expect(detail.versions.map((v) => [v.version, v.status])).toEqual([
      [2, "approved"],
      [1, "superseded"],
    ]);
    expect(detail.history.some((h) => h.action === "knowledge.superseded")).toBe(true);
    await expect(updateKnowledge(db, v1.id, { title: "x" }, actor)).rejects.toThrow(/superseded/);
  });

  it("supersedes manually (conflict resolution) and archives", async () => {
    const a = await draft(EPT, { title: "Fee A", conflictKey: "fee:test", content: "Fee is 1" });
    const b = await draft(EPT, { title: "Fee B", conflictKey: "fee:test", content: "Fee is 2" });
    await approveKnowledge(db, a.id, {}, actor);
    await approveKnowledge(db, b.id, {}, actor);
    const conflicts = await listKnowledgeConflicts(db, EPT, everything);
    expect(conflicts.find((c) => c.conflictKey === "fee:test")?.items).toHaveLength(2);
    await supersedeKnowledge(db, a.id, b.id, "B is current", actor);
    expect(
      (await listKnowledgeConflicts(db, EPT, everything)).some((c) => c.conflictKey === "fee:test"),
    ).toBe(false);
    const archived = await archiveKnowledge(db, b.id, undefined, actor);
    expect(archived.status).toBe("archived");
    expect(archived.archivedAt).not.toBeNull();
  });

  it("never lets AI-sourced knowledge become a fact silently", async () => {
    const ai = await draft(EPT, { sourceType: "grok_research", title: "Grok finding" });
    await expect(approveKnowledge(db, ai.id, {}, actor)).rejects.toThrow(/verified by a human/);
    await expect(
      approveKnowledge(db, ai.id, { verificationStatus: "management_confirmed" }, actor),
    ).rejects.toThrow(/cannot be management confirmed/);
    const ok = await approveKnowledge(db, ai.id, { verificationStatus: "verified" }, actor);
    expect(ok.status).toBe("approved");
    // The database constraint is the last line of defence.
    await expect(
      db
        .update(schema.knowledgeItems)
        .set({ verificationStatus: "management_confirmed" })
        .where(eq(schema.knowledgeItems.id, ai.id)),
    ).rejects.toThrow();
  });

  it("tracks stale state and sensitivity in listings", async () => {
    const stale = await draft(EPT, {
      title: "Old intake dates",
      expiresAt: new Date(Date.now() - 86_400_000),
      effectiveAt: new Date(Date.now() - 10 * 86_400_000),
    });
    const restricted = await draft(EPT, {
      title: "Bank account",
      sensitivity: "restricted",
      type: "financial",
    });
    const list = await listKnowledge(db, {
      companyId: EPT,
      query: { freshness: ["expired"] },
      visibility: everything,
    });
    expect(list.items.map((i) => i.id)).toContain(stale.id);
    const noClearance: KnowledgeVisibility = {
      ...everything,
      canRead: (_c, s) => s !== "restricted",
    };
    const limited = await listKnowledge(db, {
      companyId: EPT,
      query: { type: ["financial"] },
      visibility: noClearance,
    });
    expect(limited.items.some((i) => i.id === restricted.id)).toBe(false);
    expect(limited.hiddenBySensitivity).toBeGreaterThan(0);
    // A text search never reveals that hidden items matched (no content oracle).
    const searched = await listKnowledge(db, {
      companyId: EPT,
      query: { q: "bank account" },
      visibility: noClearance,
    });
    expect(searched.items.some((i) => i.id === restricted.id)).toBe(false);
    expect(searched.hiddenBySensitivity).toBe(0);
  });

  it("searches title, content and tags with Postgres full-text search", async () => {
    await draft(EPT, {
      title: "Helicopter licence pathway",
      content: "Rotary wing training guidance",
      tags: ["rotary"],
    });
    const byContent = await listKnowledge(db, {
      companyId: EPT,
      query: { q: "rotary wing" },
      visibility: everything,
    });
    expect(byContent.items[0]?.title).toBe("Helicopter licence pathway");
    const byTag = await listKnowledge(db, {
      companyId: EPT,
      query: { q: "rotary" },
      visibility: everything,
    });
    expect(byTag.items.length).toBeGreaterThan(0);
  });

  it("keeps company knowledge isolated and shares GLOBAL knowledge", async () => {
    const global = await draft(null, { title: "Global security rule", type: "policy" });
    await approveKnowledge(db, global.id, {}, actor);
    const eptOnly: KnowledgeVisibility = {
      scope: { companyIds: [EPT], includeGroup: false },
      includeGlobal: true,
      canRead: () => true,
    };
    const list = await listKnowledge(db, { companyId: null, query: {}, visibility: eptOnly });
    expect(list.items.every((i) => i.company === null || i.company.id === EPT)).toBe(true);
    expect(list.items.some((i) => i.id === global.id)).toBe(true);
    expect(list.items.some((i) => i.company?.id === PA)).toBe(false);
    await expect(
      createKnowledge(
        db,
        {
          scope: "global",
          companyId: EPT,
          title: "x",
          content: "y",
          type: "policy",
          sourceType: "management_entry",
        },
        actor,
      ),
    ).rejects.toThrow();
  });

  it("rejects departments that belong to another company", async () => {
    const [paDept] = await db
      .insert(schema.departments)
      .values({ companyId: PA, name: "PA Ops", slug: "pa-ops" })
      .returning();
    await expect(draft(EPT, { departmentId: paDept!.id })).rejects.toBeInstanceOf(ForbiddenError);
    const ok = await draft(PA, { departmentId: paDept!.id });
    expect(ok.departmentId).toBe(paDept!.id);
  });

  it("only links knowledge to tasks and agents of the same company", async () => {
    const item = await draft(EPT);
    const [paTask] = await db
      .select()
      .from(schema.tasks)
      .where(eq(schema.tasks.companyId, PA))
      .limit(1);
    await expect(linkKnowledge(db, item.id, { taskId: paTask!.id }, actor)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    const [eptTask] = await db
      .select()
      .from(schema.tasks)
      .where(eq(schema.tasks.companyId, EPT))
      .limit(1);
    const link = await linkKnowledge(db, item.id, { taskId: eptTask!.id }, actor);
    expect(link.target).toBe("task");
  });
});

describe("company profile & rules", () => {
  it("updates a profile section, audits changed fields and rejects out-of-section keys", async () => {
    const before = await getCompanyProfile(db, EPT, {} as never);
    await updateCompanyProfileSection(
      db,
      EPT,
      "business",
      {
        products: ["Integrated ATPL"],
        productsServices: before.company.productsServices,
        targetAudiences: before.company.targetAudiences,
        targetMarkets: before.company.targetMarkets,
        revenueModel: "Placement fees",
        primaryObjective: before.company.primaryObjective,
        secondaryObjectives: [],
        salesChannels: ["Direct"],
        marketingChannels: [],
      },
      actor,
    );
    const after = await getCompanyProfile(db, EPT, {} as never);
    expect(after.company.products).toEqual(["Integrated ATPL"]);
    const history = await listCompanyHistory(db, EPT);
    expect(history[0]?.action).toBe("company.profile_updated");
    expect(history[0]?.metadata.changedFields).toEqual(
      expect.arrayContaining(["products", "revenueModel"]),
    );
    await expect(
      updateCompanyProfileSection(db, EPT, "identity", { status: "inactive" } as never, actor),
    ).rejects.toThrow();
  });

  it("updates the AI policy and keeps the default provider allowed", async () => {
    const policy = await updateAiPolicy(
      db,
      EPT,
      {
        defaultProvider: "OPENAI",
        allowedProviders: ["OPENAI", "CLAUDE"],
        defaultResearchLimit: 5,
        deepResearchPolicy: "disabled",
        externalActionPolicy: "approval_required",
        browserPolicy: "disabled",
        autoSendPolicy: "disabled",
        staleKnowledgePolicy: "exclude",
        customRules: [],
      },
      actor,
    );
    expect(policy.defaultProvider).toBe("OPENAI");
    expect(policy.deepResearchPolicy).toBe("disabled");
    await expect(
      updateAiPolicy(
        db,
        EPT,
        { ...policy, defaultProvider: "GROK", allowedProviders: ["CLAUDE"] },
        actor,
      ),
    ).rejects.toThrow();
  });

  it("creates brand rules as drafts, edits revert to draft without approval rights, and approves", async () => {
    const rule = await createRule(
      db,
      "brand",
      EPT,
      {
        title: "No emojis",
        description: "Avoid emojis in email.",
        category: "email",
        channel: "email",
      },
      actor,
    );
    expect(rule.status).toBe("draft");
    const approved = await ruleLifecycle(db, "brand", rule.id, "approve", actor);
    expect(approved.status).toBe("approved");
    const edited = await updateRule(db, "brand", rule.id, { severity: "critical" }, actor, {
      canApprove: false,
    });
    expect(edited.status).toBe("draft");
    await expect(
      updateRule(db, "brand", rule.id, { companyId: PA }, actor, { canApprove: true }),
    ).rejects.toThrow(/cannot be edited/);
    const archived = await ruleLifecycle(db, "brand", rule.id, "archive", actor);
    expect(archived.status).toBe("archived");
  });

  it("stores Opportunitygrad's ₹100 Meta rule as a generic, queryable commercial rule", async () => {
    const rules = await listCompanyRules(db, OG);
    const meta = rules.commercial.find((r) => r.appliesTo === "meta.budget_increase")!;
    expect(meta).toMatchObject({
      effect: "limit",
      limitAmount: 100,
      currency: "INR",
      severity: "critical",
    });
    const rows = await loadRuleRows(db, OG);
    const candidates: RuleCandidate[] = rows.commercial.map((r) => ({
      ...r,
      kind: "commercial" as const,
    }));
    expect(
      evaluateCompanyAction(candidates, {
        companyId: OG,
        action: "meta.budget_increase",
        amount: 250,
        currency: "INR",
      }).decision,
    ).toBe("require_approval");
    // The rule belongs to Opportunitygrad only.
    expect(
      (await listCompanyRules(db, EPT)).commercial.some(
        (r) => r.appliesTo === "meta.budget_increase",
      ),
    ).toBe(false);
  });

  it("validates commercial and compliance rules", async () => {
    await expect(
      createRule(
        db,
        "commercial",
        EPT,
        {
          title: "Limit",
          description: "x",
          category: "discount",
          appliesTo: "sales.discount",
          effect: "limit",
        },
        actor,
      ),
    ).rejects.toThrow(/amount and currency/);
    const c = await createRule(
      db,
      "compliance",
      EPT,
      {
        title: "Disclose",
        description: "x",
        action: "email.send",
        effect: "require_disclosure",
        disclosureText: "Text",
      },
      actor,
      { approve: true },
    );
    expect(c.status).toBe("approved");
    await expect(
      createRule(
        db,
        "compliance",
        EPT,
        { title: "Bad", description: "x", action: "Not An Action", effect: "prohibit" },
        actor,
      ),
    ).rejects.toThrow();
  });
});

describe("context packs from the database", () => {
  async function agentOf(company: string, name: string) {
    const [row] = await db.select().from(schema.agents).where(eq(schema.agents.name, name));
    expect(row, `${name} (${company})`).toBeTruthy();
    return row!;
  }

  it("builds company-isolated packs for each company", async () => {
    for (const [companyId, agentName] of [
      [EPT, "EPT Marketing"],
      [OG, "Opportunitygrad Admissions"],
    ] as const) {
      const agent = await agentOf(companyId, agentName);
      const pack = await buildContextPack(db, { companyId, agentId: agent.id });
      const knowledgeCompanies = await db
        .select({ companyId: schema.knowledgeItems.companyId })
        .from(schema.knowledgeItems)
        .where(eq(schema.knowledgeItems.id, pack.metadata.includedKnowledgeIds[0] ?? companyId));
      for (const k of knowledgeCompanies) expect([companyId, null]).toContain(k.companyId);
      const all = await db.select().from(schema.knowledgeItems);
      const foreign = all.filter((k) => k.companyId && k.companyId !== companyId).map((k) => k.id);
      expect(pack.metadata.includedKnowledgeIds.some((id) => foreign.includes(id))).toBe(false);
    }
  });

  it("refuses an agent that does not serve the company, and a foreign task", async () => {
    const eptAgent = await agentOf(EPT, "EPT Marketing");
    await expect(
      buildContextPack(db, { companyId: PA, agentId: eptAgent.id }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const [paTask] = await db
      .select()
      .from(schema.tasks)
      .where(eq(schema.tasks.companyId, PA))
      .limit(1);
    await expect(
      buildContextPack(db, { companyId: EPT, agentId: eptAgent.id, taskId: paTask!.id }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("applies agent knowledge access policies to sensitive knowledge", async () => {
    const agent = await agentOf(PA, "PilotsAssist Training Partnerships");
    const finance = (
      await db
        .select()
        .from(schema.knowledgeItems)
        .where(eq(schema.knowledgeItems.title, "Describing training finance facilitation"))
    )[0]!;
    const withPolicy = await buildContextPack(db, {
      companyId: PA,
      agentId: agent.id,
      explicitKnowledgeIds: [finance.id],
    });
    expect(withPolicy.metadata.includedKnowledgeIds).toContain(finance.id);
    const other = await agentOf(PA, "PilotsAssist Marketing");
    const without = await buildContextPack(db, {
      companyId: PA,
      agentId: other.id,
      explicitKnowledgeIds: [finance.id],
    });
    expect(without.excluded.find((e) => e.id === finance.id)?.reason).toBe("sensitivity");
    await createKnowledgeAccessPolicy(
      db,
      PA,
      { agentId: other.id, maxSensitivity: "confidential" },
      actor,
    );
    const granted = await buildContextPack(db, {
      companyId: PA,
      agentId: other.id,
      explicitKnowledgeIds: [finance.id],
    });
    expect(granted.metadata.includedKnowledgeIds).toContain(finance.id);
  });

  it("follows task links to the current approved version", async () => {
    const [task] = await db
      .select()
      .from(schema.tasks)
      .where(eq(schema.tasks.title, "Draft partnership introduction emails"));
    const agent = task!.assignedAgentId!;
    const item = (
      await db
        .select()
        .from(schema.knowledgeItems)
        .where(eq(schema.knowledgeItems.title, "Flight-school partnership approach"))
    )[0]!;
    const v2 = await updateKnowledge(
      db,
      item.id,
      { summary: "Updated partnership approach." },
      actor,
    );
    await approveKnowledge(db, v2.item.id, {}, actor);
    const pack = await buildContextPack(db, { companyId: EPT, agentId: agent, taskId: task!.id });
    const entry = pack.knowledge.find((k) => k.id === v2.item.id);
    expect(entry?.reasons).toContain("task_link");
    expect(pack.metadata.includedKnowledgeIds).not.toContain(item.id);
  });
});
