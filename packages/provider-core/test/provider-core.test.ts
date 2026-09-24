import { describe, expect, it } from "vitest";
import {
  MockProvider,
  ProviderNotConfiguredError,
  ProviderRouter,
  UnconfiguredLiveProvider,
  createMockProviders,
} from "../src";

const request = {
  requestId: "r1",
  capability: "reasoning" as const,
  messages: [{ role: "user" as const, content: "Summarise today's operations" }],
};

describe("MockProvider", () => {
  it("executes deterministically without network access", async () => {
    const p = new MockProvider("CLAUDE", { capabilities: ["reasoning"] });
    const r = await p.executeTask(request);
    expect(r.finishReason).toBe("completed");
    expect(r.output).toContain("[mock CLAUDE]");
    expect(r.usage.inputTokens).toBeGreaterThan(0);
  });

  it("refuses work above the budget ceiling", async () => {
    const p = new MockProvider("CLAUDE", { capabilities: ["reasoning"] });
    const r = await p.executeTask({ ...request, budgetUsd: 0, maxOutputTokens: 100_000 });
    expect(r.finishReason).toBe("budget_exceeded");
  });

  it("can be cancelled", async () => {
    const p = new MockProvider("OPENAI", { capabilities: ["reasoning"], latencyMs: 5_000 });
    const pending = p.executeTask(request);
    await p.cancel("r1");
    expect((await pending).finishReason).toBe("cancelled");
  });
});

describe("UnconfiguredLiveProvider", () => {
  it("never executes", async () => {
    const p = new UnconfiguredLiveProvider("GROK");
    await expect(p.executeTask(request)).rejects.toBeInstanceOf(ProviderNotConfiguredError);
    expect((await p.healthCheck()).status).toBe("not_configured");
  });
});

describe("ProviderRouter", () => {
  const router = new ProviderRouter(createMockProviders());

  it("uses the primary provider when capable", () => {
    expect(router.select({ capability: "reasoning", primary: "GROK" }).provider?.type).toBe("GROK");
  });

  it("falls back when the primary lacks the capability", () => {
    const d = router.select({ capability: "x_research", primary: "CLAUDE", fallback: "GROK" });
    expect(d.provider?.type).toBe("GROK");
    expect(d.reason).toBe("fallback provider");
  });

  it("honours unavailability and hard requirements", () => {
    expect(
      router.select({ capability: "coding", primary: "CLAUDE", unavailable: ["CLAUDE"] }).provider
        ?.type,
    ).toBe("OPENAI");
    expect(router.select({ capability: "x_research", required: "OPENAI" }).provider).toBeNull();
  });
});
