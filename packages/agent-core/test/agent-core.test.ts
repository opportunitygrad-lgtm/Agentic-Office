import { describe, expect, it } from "vitest";
import { AGENT_TEMPLATE_KEYS } from "@aibos/shared";
import {
  AGENT_TEMPLATES,
  DEFAULT_DEPARTMENTS,
  RuleBasedTaskRouter,
  getAgentTemplate,
} from "../src";

describe("agent templates", () => {
  it("defines exactly one template per template key", () => {
    expect(AGENT_TEMPLATES.map((t) => t.key).sort()).toEqual([...AGENT_TEMPLATE_KEYS].sort());
  });

  it("references only known departments", () => {
    const slugs = new Set(DEFAULT_DEPARTMENTS.map((d) => d.slug));
    for (const t of AGENT_TEMPLATES) expect(slugs.has(t.department)).toBe(true);
  });

  it("resolves by key", () => {
    expect(getAgentTemplate("meta_ads").name).toBe("Meta Ads");
  });
});

describe("RuleBasedTaskRouter", () => {
  const research = getAgentTemplate("research");
  const router = new RuleBasedTaskRouter();

  it("prefers the company's own agent over a global one", () => {
    const decision = router.route(
      { id: "t1", companyId: "c1", type: "research", priority: "normal" },
      [
        {
          id: "global",
          status: "sleeping",
          companyIds: [],
          scope: "global",
          template: research,
          openTaskCount: 0,
          concurrencyLimit: 2,
        },
        {
          id: "local",
          status: "working",
          companyIds: ["c1"],
          scope: "company",
          template: research,
          openTaskCount: 1,
          concurrencyLimit: 2,
        },
      ],
    );
    expect(decision.agentId).toBe("local");
  });

  it("skips agents from other companies and agents at capacity", () => {
    const decision = router.route(
      { id: "t1", companyId: "c1", type: "research", priority: "normal" },
      [
        {
          id: "other",
          status: "sleeping",
          companyIds: ["c2"],
          scope: "company",
          template: research,
          openTaskCount: 0,
          concurrencyLimit: 2,
        },
        {
          id: "full",
          status: "working",
          companyIds: ["c1"],
          scope: "company",
          template: research,
          openTaskCount: 1,
          concurrencyLimit: 1,
        },
      ],
    );
    expect(decision.agentId).toBeNull();
  });
});
