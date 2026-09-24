import { describe, expect, it } from "vitest";
import { getTemplateKnowledgeProfile } from "@aibos/agent-core";
import { knowledgePrecedence } from "@aibos/shared";
import {
  InMemoryKnowledgeRetriever,
  assembleContextPack,
  evaluateCompanyAction,
  renderContextPack,
  type ContextSources,
  type KnowledgeCandidate,
  type RuleCandidate,
} from "../src";

const NOW = new Date("2026-09-01T10:00:00Z");
const EPT = "00000000-0000-4000-8000-00000000e001";
const PA = "00000000-0000-4000-8000-00000000e002";
const OG = "00000000-0000-4000-8000-00000000e003";
const AGENT = "00000000-0000-4000-8000-00000000a001";
const MARKETING_DEPT = "00000000-0000-4000-8000-00000000d001";
let seq = 0;

function k(over: Partial<KnowledgeCandidate> & { companyId: string | null }): KnowledgeCandidate {
  const id = over.id ?? `00000000-0000-4000-9000-${String(++seq).padStart(12, "0")}`;
  return {
    id,
    scope: over.companyId === null ? "global" : "company",
    departmentId: null,
    title: `Item ${seq}`,
    summary: null,
    content: "Approved company information.",
    type: "company_fact",
    category: null,
    tags: [],
    sourceType: "management_entry",
    sourceReference: null,
    confidence: "high",
    verificationStatus: "management_confirmed",
    status: "approved",
    sensitivity: "internal",
    usableAsUnverified: false,
    effectiveAt: null,
    reviewAt: null,
    expiresAt: null,
    lastVerifiedAt: new Date("2026-08-01T00:00:00Z"),
    conflictKey: null,
    lineageId: id,
    updatedAt: new Date("2026-08-15T00:00:00Z"),
    ...over,
  };
}

function rule(over: Partial<RuleCandidate> & Pick<RuleCandidate, "kind">): RuleCandidate {
  const base = {
    id: `00000000-0000-4000-7000-${String(++seq).padStart(12, "0")}`,
    companyId: EPT,
    title: `Rule ${seq}`,
    description: "Rule description.",
    severity: "required" as const,
    active: true,
    status: "approved" as const,
  };
  if (over.kind === "brand")
    return { ...base, category: "voice", channel: "all", ...over } as RuleCandidate;
  if (over.kind === "commercial")
    return {
      ...base,
      category: "pricing",
      appliesTo: "pricing.change",
      effect: "info",
      limitAmount: null,
      currency: null,
      period: null,
      requiredPermission: null,
      ...over,
    } as RuleCandidate;
  return {
    ...base,
    action: "*",
    jurisdiction: null,
    effect: "info",
    disclosureText: null,
    requiredPermission: null,
    ...over,
  } as RuleCandidate;
}

function sources(over: Partial<ContextSources> = {}, companyId = EPT): ContextSources {
  return {
    now: NOW,
    company: {
      id: companyId,
      name: "Test Co",
      core: [{ label: "Industry", value: "Aviation" }],
      extended: [{ label: "Services", value: "Pilot training" }],
    },
    aiPolicy: {
      staleKnowledgePolicy: "exclude",
      deepResearchPolicy: "approval_required",
      externalActionPolicy: "approval_required",
      browserPolicy: "approval_required",
      autoSendPolicy: "disabled",
      allowedProviders: ["CLAUDE"],
      defaultResearchLimit: 20,
      customRules: [],
    },
    agent: {
      id: AGENT,
      name: "Marketing Agent",
      templateKey: "marketing_manager",
      departmentId: MARKETING_DEPT,
      departmentName: "Marketing",
      reportsTo: "Company Manager",
      autonomyLevel: "approval_gated",
      prohibitedActions: ["Launch ads without approval"],
      maxSearches: 10,
      authority: [
        {
          permission: "tool.web.search",
          label: "Search the web",
          decision: "allow",
          grant: "allow",
          approvalType: null,
        },
        {
          permission: "tool.meta.read",
          label: "Read Meta ads data",
          decision: "allow",
          grant: "allow",
          approvalType: null,
        },
        {
          permission: "tool.meta.write",
          label: "Modify Meta campaigns",
          decision: "require_approval",
          grant: "allow",
          approvalType: "ad_budget_increase",
        },
        {
          permission: "tool.email.send",
          label: "Send email",
          decision: "deny",
          grant: null,
          approvalType: "email_send",
        },
        {
          permission: "action.destructive",
          label: "Destructive",
          decision: "deny",
          grant: "deny",
          approvalType: null,
        },
      ],
    },
    profile: getTemplateKnowledgeProfile("marketing_manager"),
    task: {
      id: "00000000-0000-4000-8000-0000000000t1".replace("t", "a"),
      companyId,
      title: "Plan autumn campaign for pilot training",
      description: "Marketing plan for the autumn intake.",
      type: "marketing",
      priority: "normal",
      status: "running",
      parent: null,
      root: null,
      allowUnverifiedContext: false,
    },
    knowledge: [],
    links: [],
    accessPolicies: [],
    rules: [],
    ...over,
  };
}

const req = (companyId = EPT, extra = {}) => ({ companyId, agentId: AGENT, ...extra });

describe("company isolation", () => {
  const ept = k({ companyId: EPT, type: "marketing", title: "EPT marketing fact" });
  const pa = k({ companyId: PA, type: "marketing", title: "PA marketing fact" });
  const og = k({ companyId: OG, type: "marketing", title: "OG marketing fact" });
  const all = [ept, pa, og];

  it.each([
    [EPT, ept],
    [PA, pa],
    [OG, og],
  ])("a %s task receives only that company's knowledge", (companyId, expected) => {
    const pack = assembleContextPack(req(companyId), sources({ knowledge: all }, companyId));
    expect(pack.knowledge.map((e) => e.id)).toEqual([expected.id]);
    expect(pack.metadata.blockedCrossCompany).toBe(2);
    const text = renderContextPack(pack);
    for (const other of all.filter((x) => x !== expected)) expect(text).not.toContain(other.title);
  });

  it("blocks knowledge linked to the task from another company without revealing it", () => {
    const pack = assembleContextPack(
      req(),
      sources({ knowledge: [pa], links: [{ knowledgeId: pa.id, target: "task" }] }),
    );
    expect(pack.knowledge).toHaveLength(0);
    const ex = pack.excluded.find((e) => e.id === pa.id)!;
    expect(ex.reason).toBe("other_company");
    expect(ex.title).toBeNull();
    expect(JSON.stringify(pack)).not.toContain("PA marketing fact");
  });

  it("includes approved GLOBAL knowledge but no other company's rules", () => {
    const global = k({ companyId: null, type: "policy", title: "Universal agent rule" });
    const paRule = rule({
      kind: "brand",
      companyId: PA,
      severity: "critical",
      title: "PA critical",
    });
    const pack = assembleContextPack(req(), sources({ knowledge: [global], rules: [paRule] }));
    expect(pack.knowledge.map((e) => e.id)).toEqual([global.id]);
    expect(pack.knowledge[0]!.global).toBe(true);
    expect(pack.rules.brand).toHaveLength(0);
    expect(JSON.stringify(pack)).not.toContain("PA critical");
  });

  it("rejects a task that belongs to another company", () => {
    const s = sources();
    s.task = { ...s.task!, companyId: PA };
    expect(() => assembleContextPack(req(), s)).toThrow(/different company/);
  });

  it("the in-memory retriever only returns company + global candidates", async () => {
    const r = new InMemoryKnowledgeRetriever(all);
    const got = await r.retrieve({ companyId: EPT, explicitIds: [], text: "", limit: 10 });
    expect(got.map((x) => x.id)).toEqual([ept.id]);
  });
});

describe("lifecycle, freshness and sensitivity", () => {
  it("excludes draft, review, archived and superseded knowledge", () => {
    const items = (["draft", "review", "archived", "superseded"] as const).map((status) =>
      k({ companyId: EPT, type: "marketing", status }),
    );
    const pack = assembleContextPack(req(), sources({ knowledge: items }));
    expect(pack.knowledge).toHaveLength(0);
    expect(pack.excluded.map((e) => e.reason).sort()).toEqual(
      ["archived", "draft", "in_review", "superseded"].sort(),
    );
  });

  it("handles expired knowledge according to the company policy", () => {
    const expired = k({
      companyId: EPT,
      type: "pricing",
      expiresAt: new Date("2026-08-30T00:00:00Z"),
    });
    const excluded = assembleContextPack(req(), sources({ knowledge: [expired] }));
    expect(excluded.knowledge).toHaveLength(0);
    expect(excluded.excluded[0]!.reason).toBe("expired");

    const s = sources({ knowledge: [expired] });
    s.aiPolicy.staleKnowledgePolicy = "mark_stale";
    const marked = assembleContextPack(req(), s);
    expect(marked.knowledge).toHaveLength(1);
    expect(marked.knowledge[0]!.freshness).toBe("expired");
    expect(marked.knowledge[0]!.warnings.join(" ")).toMatch(/STALE/);
    expect(marked.metadata.staleCount).toBe(1);
    expect(renderContextPack(marked)).toContain("STALE");
  });

  it("flags review-due knowledge and excludes not-yet-effective items", () => {
    const due = k({
      companyId: EPT,
      type: "marketing",
      reviewAt: new Date("2026-08-01T00:00:00Z"),
    });
    const future = k({
      companyId: EPT,
      type: "marketing",
      effectiveAt: new Date("2027-01-01T00:00:00Z"),
    });
    const pack = assembleContextPack(req(), sources({ knowledge: [due, future] }));
    expect(pack.knowledge.map((e) => e.id)).toEqual([due.id]);
    expect(pack.knowledge[0]!.warnings).toContain("Review overdue");
    expect(pack.excluded.find((e) => e.id === future.id)!.reason).toBe("not_yet_effective");
  });

  it("denies confidential/restricted knowledge unless an access policy grants it", () => {
    const conf = k({ companyId: EPT, type: "pricing", sensitivity: "confidential" });
    const restricted = k({
      companyId: EPT,
      type: "financial",
      sensitivity: "restricted",
      tags: ["marketing"],
    });
    const denied = assembleContextPack(req(), sources({ knowledge: [conf, restricted] }));
    expect(denied.knowledge).toHaveLength(0);
    expect(denied.excluded.every((e) => e.reason === "sensitivity")).toBe(true);

    const granted = assembleContextPack(
      req(),
      sources({
        knowledge: [conf, restricted],
        accessPolicies: [
          { agentId: null, departmentId: MARKETING_DEPT, maxSensitivity: "confidential" },
        ],
      }),
    );
    expect(granted.knowledge.map((e) => e.id)).toEqual([conf.id]);
    expect(granted.excluded.find((e) => e.id === restricted.id)!.reason).toBe("sensitivity");
  });

  it("uses unverified research only when the task allows it, clearly labelled", () => {
    const research = k({
      companyId: EPT,
      type: "market_research",
      status: "draft",
      usableAsUnverified: true,
      sourceType: "grok_research",
      verificationStatus: "unverified",
      tags: ["marketing"],
    });
    const off = assembleContextPack(req(), sources({ knowledge: [research] }));
    expect(off.unverified).toHaveLength(0);
    const on = assembleContextPack(
      req(EPT, { allowUnverified: true }),
      sources({ knowledge: [research] }),
    );
    expect(on.knowledge).toHaveLength(0);
    expect(on.unverified.map((e) => e.id)).toEqual([research.id]);
    expect(renderContextPack(on)).toContain("UNVERIFIED CONTEXT (NOT AUTHORITATIVE");
  });
});

describe("rules, permissions and priorities", () => {
  it("always includes critical rules and restrictions; skips irrelevant ones", () => {
    const critical = rule({
      kind: "brand",
      category: "visual",
      severity: "critical",
      title: "Premium only",
    });
    const irrelevant = rule({
      kind: "brand",
      category: "custom",
      channel: "internal",
      severity: "info",
    });
    const draft = rule({ kind: "brand", severity: "critical", status: "draft" });
    const pack = assembleContextPack(req(), sources({ rules: [critical, irrelevant, draft] }));
    expect(pack.rules.brand.map((r) => r.id)).toEqual([critical.id]);
    expect(pack.rules.brand[0]!.mandatory).toBe(true);
    expect(pack.excluded.find((e) => e.id === irrelevant.id)!.reason).toBe("not_relevant");
    expect(pack.excluded.find((e) => e.id === draft.id)!.reason).toBe("inactive_rule");
  });

  it("includes permission, prohibition and approval data", () => {
    const budget = rule({
      kind: "commercial",
      category: "advertising_budget",
      appliesTo: "meta.budget_increase",
      effect: "limit",
      limitAmount: 100,
      currency: "INR",
      period: "day",
      requiredPermission: "approval.financial",
      severity: "critical",
    });
    const pack = assembleContextPack(req(), sources({ rules: [budget] }));
    expect(pack.agent.allowed).toContain("tool.meta.read");
    expect(pack.agent.approvalRequired).toContain("tool.meta.write");
    expect(pack.agent.denied).toContain("tool.email.send");
    expect(pack.prohibitedActions.map((p) => p.action).join(" ")).toMatch(/Destructive/);
    expect(pack.prohibitedActions.some((p) => p.action === "Email auto-send")).toBe(true);
    expect(pack.requiredApprovals.some((r) => r.action === "meta.budget_increase")).toBe(true);
    expect(pack.rules.commercial[0]!.detail).toMatch(/INR 100 per day/);
  });

  it("prioritises explicitly linked task knowledge above general retrieval", () => {
    const linked = k({ companyId: EPT, type: "partnership", title: "Linked partner record" });
    const general = Array.from({ length: 6 }, () =>
      k({ companyId: EPT, type: "marketing", content: "x".repeat(550) }),
    );
    const pack = assembleContextPack(
      req(EPT, { budget: "small" }),
      sources({
        knowledge: [...general, linked],
        links: [{ knowledgeId: linked.id, target: "task" }],
      }),
    );
    expect(pack.knowledge[0]!.id).toBe(linked.id);
    expect(pack.knowledge[0]!.reasons).toContain("task_link");
  });

  it("drops lower-priority items first but never mandatory rules", () => {
    const critical = Array.from({ length: 3 }, () =>
      rule({
        kind: "compliance",
        severity: "critical",
        effect: "prohibit",
        description: "y".repeat(400),
      }),
    );
    const many = Array.from({ length: 30 }, () =>
      k({ companyId: EPT, type: "marketing", summary: "z".repeat(500) }),
    );
    const pack = assembleContextPack(
      req(EPT, { budget: "small" }),
      sources({ knowledge: many, rules: critical }),
    );
    expect(pack.rules.compliance).toHaveLength(3);
    expect(pack.metadata.droppedForBudget).toBeGreaterThan(0);
    expect(pack.knowledge.length).toBeLessThan(30);
    expect(pack.metadata.approxChars).toBeLessThanOrEqual(pack.metadata.budgetChars);
    expect(pack.excluded.filter((e) => e.reason === "budget").length).toBe(
      pack.metadata.droppedForBudget - (pack.company.extendedIncluded ? 0 : 1),
    );
  });

  it("marks everything over budget instead of dropping mandatory content", () => {
    const huge = rule({
      kind: "compliance",
      severity: "critical",
      effect: "prohibit",
      description: "q".repeat(9000),
    });
    const pack = assembleContextPack(req(EPT, { budget: "small" }), sources({ rules: [huge] }));
    expect(pack.rules.compliance).toHaveLength(1);
    expect(pack.metadata.overBudget).toBe(true);
  });

  it("gives deterministic why-included reasons", () => {
    const item = k({
      companyId: EPT,
      type: "marketing",
      tags: ["advertising"],
      departmentId: MARKETING_DEPT,
    });
    const pack = assembleContextPack(req(), sources({ knowledge: [item] }));
    expect(pack.knowledge[0]!.reasons).toEqual(
      expect.arrayContaining([
        "required_by_agent",
        "matching_department",
        "matching_tag",
        "task_type",
      ]),
    );
    const again = assembleContextPack(req(), sources({ knowledge: [item] }));
    expect(again.knowledge).toEqual(pack.knowledge);
  });

  it("flags potential conflicts between approved items", () => {
    const a = k({ companyId: EPT, type: "pricing", conflictKey: "fee:atpl", content: "Fee is X" });
    const b = k({ companyId: EPT, type: "pricing", conflictKey: "fee:atpl", content: "Fee is Y" });
    const pack = assembleContextPack(req(), sources({ knowledge: [a, b] }));
    expect(pack.warnings.join(" ")).toMatch(/Potential conflict on "fee:atpl"/);
    expect(pack.knowledge.every((e) => e.warnings.some((w) => w.includes("CONFLICT")))).toBe(true);
  });
});

describe("company action evaluation (future execution controllers)", () => {
  const ogBudget = rule({
    kind: "commercial",
    companyId: OG,
    category: "advertising_budget",
    appliesTo: "meta.budget_increase",
    effect: "limit",
    limitAmount: 100,
    currency: "INR",
    period: "day",
    requiredPermission: "approval.financial",
  });
  const disclosure = rule({
    kind: "compliance",
    companyId: OG,
    action: "email.*",
    effect: "require_disclosure",
    disclosureText: "Admission decisions are made by universities.",
  });

  it("allows a budget increase within ₹100 and escalates above it", () => {
    const within = evaluateCompanyAction([ogBudget], {
      companyId: OG,
      action: "meta.budget_increase",
      amount: 60,
      currency: "INR",
      periodTotal: 30,
    });
    expect(within.decision).toBe("allow");
    const above = evaluateCompanyAction([ogBudget], {
      companyId: OG,
      action: "meta.budget_increase",
      amount: 60,
      currency: "INR",
      periodTotal: 50,
    });
    expect(above.decision).toBe("require_approval");
    expect(above.requiredPermissions).toEqual(["approval.financial"]);
  });

  it("does not apply one company's rules to another and adds disclosures", () => {
    expect(
      evaluateCompanyAction([ogBudget], {
        companyId: EPT,
        action: "meta.budget_increase",
        amount: 5000,
        currency: "INR",
      }).decision,
    ).toBe("allow");
    const email = evaluateCompanyAction([disclosure], { companyId: OG, action: "email.send" });
    expect(email.disclosures).toEqual(["Admission decisions are made by universities."]);
  });

  it("is conservative when the amount cannot be checked", () => {
    expect(
      evaluateCompanyAction([ogBudget], {
        companyId: OG,
        action: "meta.budget_increase",
        amount: 1,
        currency: "EUR",
      }).decision,
    ).toBe("require_approval");
  });
});

describe("knowledge precedence", () => {
  it("never ranks model inference as an approved fact", () => {
    expect(
      knowledgePrecedence({
        type: "company_fact",
        sourceType: "claude_research",
        status: "approved",
        verificationStatus: "unverified",
      }).tier,
    ).toBe(7);
    expect(
      knowledgePrecedence({
        type: "company_fact",
        sourceType: "system_generated",
        status: "draft",
        verificationStatus: "unverified",
      }).tier,
    ).toBe(8);
    expect(
      knowledgePrecedence({
        type: "policy",
        sourceType: "management_entry",
        status: "approved",
        verificationStatus: "management_confirmed",
      }).tier,
    ).toBe(1);
    expect(
      knowledgePrecedence({
        type: "sop",
        sourceType: "company_document",
        status: "approved",
        verificationStatus: "verified",
      }).tier,
    ).toBe(4);
  });
});
