import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import { AGENT_EXECUTION_RESULT_JSON_SCHEMA } from "@aibos/shared";
import {
  CLAUDE_CODE_MODEL_DEFAULTS,
  CLAUDE_MODEL_DEFAULTS,
  ClaudeProvider,
  MockClaudeProvider,
  NotConnectedProvider,
  ProviderError,
  claudeModelConfig,
  costOfUsage,
  createProviderRegistry,
  providerModeFromEnv,
  routeExecution,
  type ModelPrice,
  type ProviderRequest,
  type RouteInput,
} from "../src";

const SONNET: ModelPrice = {
  provider: "CLAUDE",
  model: "claude-sonnet-5",
  inputPerMTok: 2,
  outputPerMTok: 10,
  cacheWritePerMTok: 2.5,
  cacheReadPerMTok: 0.2,
  currency: "USD",
  effectiveFrom: "2026-09-25",
};
const OPUS: ModelPrice = {
  ...SONNET,
  model: "claude-opus-5-5",
  inputPerMTok: 4,
  outputPerMTok: 20,
  cacheWritePerMTok: 5,
  cacheReadPerMTok: 0.2,
};

const request = (over: Partial<ProviderRequest> = {}): ProviderRequest => ({
  runId: "run-1",
  model: "claude-sonnet-5",
  effort: "medium",
  system: [
    { text: "PLATFORM SAFETY …", cache: true },
    { text: "Permissions …", cache: false },
  ],
  messages: [{ role: "user", content: "<task_title>Summarise</task_title>", cache: true }],
  output: {
    kind: "structured",
    name: "agent_execution_result",
    schema: AGENT_EXECUTION_RESULT_JSON_SCHEMA,
  },
  maxOutputTokens: 1500,
  timeoutMs: 30_000,
  ...over,
});

/** Minimal stand-in for the SDK client used to assert request construction. */
function fakeClient(message: Partial<Anthropic.Message>, opts: { throws?: unknown } = {}) {
  const stream = vi.fn(
    (_params: Anthropic.MessageCreateParams, _options: Record<string, unknown>) => {
      const handlers: ((d: string) => void)[] = [];
      return {
        request_id: "req_123",
        on(event: string, fn: (d: string) => void) {
          if (event === "text") handlers.push(fn);
          return this;
        },
        async finalMessage() {
          if (opts.throws) throw opts.throws;
          for (const b of message.content ?? [])
            if (b.type === "text") handlers.forEach((h) => h(b.text));
          return {
            model: "claude-sonnet-5",
            stop_reason: "end_turn",
            usage: {
              input_tokens: 120,
              output_tokens: 40,
              cache_creation_input_tokens: 900,
              cache_read_input_tokens: 0,
            },
            ...message,
          } as Anthropic.Message;
        },
      };
    },
  );
  return {
    client: { messages: { stream }, models: { retrieve: vi.fn() } } as unknown as Anthropic,
    stream,
  };
}

describe("ClaudeProvider (official SDK)", () => {
  it("reports configuration without network calls", async () => {
    const off = new ClaudeProvider({}, CLAUDE_MODEL_DEFAULTS);
    expect(off.available()).toBe(false);
    expect((await off.healthCheck()).state).toBe("not_configured");
    await expect(off.execute(request())).rejects.toMatchObject({ code: "PROVIDER_NOT_CONFIGURED" });
    const on = new ClaudeProvider({ apiKey: "test-key" }, CLAUDE_MODEL_DEFAULTS);
    expect(on.available()).toBe(true);
    expect((await on.healthCheck()).state).toBe("available");
  });

  it("builds a reasoning-only request: cached stable system blocks, effort, structured output, no tools", async () => {
    const result = {
      status: "completed",
      summary: "s",
      response: "r",
      keyFindings: [],
      proposedNextActions: [],
      proposedHandoffs: [],
      proposedKnowledgeDrafts: [],
      warnings: [],
      confidence: "high",
    };
    const { client, stream } = fakeClient({
      content: [
        { type: "thinking", thinking: "", signature: "x" } as Anthropic.ThinkingBlock,
        { type: "text", text: JSON.stringify(result), citations: null } as Anthropic.TextBlock,
      ],
    });
    const provider = new ClaudeProvider({ apiKey: "k" }, CLAUDE_MODEL_DEFAULTS, client);
    const deltas: string[] = [];
    const r = await provider.stream(request(), { onText: (d) => deltas.push(d) });
    const [params, options] = stream.mock.calls[0]!;
    expect(params).not.toHaveProperty("tools");
    expect(params).not.toHaveProperty("temperature");
    expect(params.output_config).toEqual({
      effort: "medium",
      format: { type: "json_schema", schema: AGENT_EXECUTION_RESULT_JSON_SCHEMA },
    });
    expect((params.system as Anthropic.TextBlockParam[])[0]!.cache_control).toEqual({
      type: "ephemeral",
    });
    expect((params.system as Anthropic.TextBlockParam[])[1]!.cache_control).toBeUndefined();
    expect(options).toMatchObject({ maxRetries: 0, timeout: 30_000 });
    expect(r.structured).toEqual(result);
    expect(r.text).not.toContain("thinking");
    expect(r.usage).toEqual({
      inputTokens: 120,
      outputTokens: 40,
      cacheCreationTokens: 900,
      cacheReadTokens: 0,
    });
    expect(r.requestId).toBe("req_123");
    expect(deltas.join("")).toBe(JSON.stringify(result));
  });

  it("maps refusals and truncated structured output to typed errors", async () => {
    const refused = new ClaudeProvider(
      { apiKey: "k" },
      CLAUDE_MODEL_DEFAULTS,
      fakeClient({ content: [], stop_reason: "refusal" }).client,
    );
    await expect(refused.execute(request())).rejects.toMatchObject({ code: "REFUSED" });
    const cut = new ClaudeProvider(
      { apiKey: "k" },
      CLAUDE_MODEL_DEFAULTS,
      fakeClient({
        content: [{ type: "text", text: "{", citations: null }],
        stop_reason: "max_tokens",
      }).client,
    );
    await expect(cut.execute(request())).rejects.toMatchObject({ code: "OUTPUT_TRUNCATED" });
  });

  it("normalises SDK error classes (never message strings)", () => {
    const p = new ClaudeProvider({ apiKey: "k" }, CLAUDE_MODEL_DEFAULTS);
    const rate = p.normalizeError(
      new Anthropic.RateLimitError(429, {}, "slow down", new Headers({ "retry-after": "3" })),
    );
    expect(rate).toMatchObject({ code: "RATE_LIMITED", retryable: true, retryAfterMs: 3000 });
    expect(
      p.normalizeError(new Anthropic.AuthenticationError(401, {}, "x", new Headers())),
    ).toMatchObject({ code: "AUTH_ERROR", retryable: false });
    expect(
      p.normalizeError(new Anthropic.BadRequestError(400, {}, "x", new Headers())),
    ).toMatchObject({ code: "INVALID_REQUEST", retryable: false });
    expect(
      p.normalizeError(new Anthropic.InternalServerError(529, {}, "x", new Headers())),
    ).toMatchObject({ code: "OVERLOADED", retryable: true });
    expect(p.normalizeError(new Anthropic.APIConnectionTimeoutError())).toMatchObject({
      code: "TIMEOUT",
      retryable: false,
    });
    expect(p.normalizeError(new Anthropic.APIConnectionError({ message: "down" }))).toMatchObject({
      code: "NETWORK_ERROR",
      retryable: true,
    });
    expect(p.normalizeError(new Anthropic.APIUserAbortError())).toMatchObject({
      code: "CANCELLED",
      retryable: false,
    });
  });

  it("passes an AbortSignal through to the SDK and cancels by run id", async () => {
    const { client, stream } = fakeClient({
      content: [{ type: "text", text: "{}", citations: null }],
    });
    const p = new ClaudeProvider({ apiKey: "k" }, CLAUDE_MODEL_DEFAULTS, client);
    await p.execute(request({ output: { kind: "text" } }));
    const signal = stream.mock.calls[0]![1].signal as AbortSignal;
    expect(signal).toBeInstanceOf(AbortSignal);
  });
});

describe("MockClaudeProvider", () => {
  it("streams deterministically, simulates cache reads and supports cancellation", async () => {
    const mock = new MockClaudeProvider(CLAUDE_MODEL_DEFAULTS, { chunkDelayMs: 0 });
    const first = await mock.execute(request());
    expect(first.usage.cacheCreationTokens).toBeGreaterThan(0);
    const second = await mock.execute(request({ runId: "run-2" }));
    expect(second.usage.cacheReadTokens).toBe(first.usage.cacheCreationTokens);
    const slow = new MockClaudeProvider(CLAUDE_MODEL_DEFAULTS, { chunkDelayMs: 50 });
    const pending = slow.execute(request({ runId: "slow" }));
    await slow.cancel("slow");
    await expect(pending).rejects.toMatchObject({ code: "CANCELLED" });
  });

  it("can inject provider failures", async () => {
    const mock = new MockClaudeProvider(CLAUDE_MODEL_DEFAULTS, {
      failures: [new ProviderError("RATE_LIMITED", "x", { retryable: true })],
    });
    await expect(mock.execute(request())).rejects.toMatchObject({ code: "RATE_LIMITED" });
    await expect(mock.execute(request())).resolves.toMatchObject({ provider: "CLAUDE" });
  });
});

describe("registry & configuration", () => {
  it("keeps OpenAI and Grok disconnected and never falls back silently", async () => {
    const reg = createProviderRegistry({
      env: { CLAUDE_TRANSPORT: "anthropic_api" },
      mode: "live",
    });
    expect(reg.get("CLAUDE").available()).toBe(false);
    for (const p of ["OPENAI", "GROK"] as const) {
      expect(reg.get(p)).toBeInstanceOf(NotConnectedProvider);
      await expect(reg.get(p).execute(request())).rejects.toMatchObject({
        code: "PROVIDER_NOT_CONFIGURED",
      });
    }
    expect(reg.get("LOCAL").available()).toBe(true);
  });

  it("reads model ids and effort from configuration and refuses mock mode in production", () => {
    expect(claudeModelConfig({})).toEqual(CLAUDE_MODEL_DEFAULTS);
    expect(
      claudeModelConfig({
        CLAUDE_DEFAULT_MODEL: "custom-model",
        CLAUDE_DEFAULT_EFFORT: "low",
        CLAUDE_PREMIUM_EFFORT: "bogus",
      }),
    ).toMatchObject({
      standardModel: "custom-model",
      standardEffort: "low",
      premiumEffort: "high",
    });
    expect(() =>
      providerModeFromEnv({ AIBOS_AI_PROVIDER_MODE: "mock", NODE_ENV: "production" }),
    ).toThrow();
    expect(
      createProviderRegistry({ env: { ANTHROPIC_API_KEY: "k", CLAUDE_TRANSPORT: "anthropic_api" } })
        .get("CLAUDE")
        .available(),
    ).toBe(true);
  });

  it("prices usage with the snapshot, including cache writes and reads", () => {
    expect(
      costOfUsage(SONNET, {
        inputTokens: 1_000_000,
        outputTokens: 100_000,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
      }),
    ).toBe(3);
    expect(
      costOfUsage(SONNET, {
        inputTokens: 0,
        outputTokens: 0,
        cacheCreationTokens: 1_000_000,
        cacheReadTokens: 1_000_000,
      }),
    ).toBe(2.7);
  });
});

const baseRoute = (over: Partial<RouteInput> = {}): RouteInput => ({
  company: {
    allowedProviders: ["CLAUDE", "OPENAI", "GROK", "LOCAL"],
    preferredProvider: "CLAUDE",
    defaultModelTier: "standard",
    premiumAllowed: false,
    fallbackAllowed: false,
  },
  agent: {
    primaryProvider: "CLAUDE",
    fallbackProvider: "OPENAI",
    preferredModelTier: "standard",
    defaultEffort: null,
  },
  task: {
    providerRequirement: null,
    modelTier: null,
    highComplexity: false,
    requiredCapabilities: ["research.general"],
  },
  providers: [
    {
      provider: "CLAUDE",
      available: true,
      isMock: false,
      reasoning: true,
      transport: "anthropic_api",
      billingMode: "api",
    },
    {
      provider: "OPENAI",
      available: false,
      isMock: false,
      reasoning: false,
      transport: "none",
      billingMode: "none",
    },
    {
      provider: "GROK",
      available: false,
      isMock: false,
      reasoning: false,
      transport: "none",
      billingMode: "none",
    },
    {
      provider: "LOCAL",
      available: true,
      isMock: false,
      reasoning: false,
      transport: "local",
      billingMode: "none",
    },
  ],
  models: { CLAUDE: CLAUDE_MODEL_DEFAULTS },
  price: (_p, m) => (m === SONNET.model ? SONNET : m === OPUS.model ? OPUS : null),
  estimate: { inputTokens: 10_000, maxOutputTokens: 4_000 },
  ...over,
});

describe("routeExecution", () => {
  it("defaults to Claude Sonnet 5 at medium effort with a local cost estimate", () => {
    const r = routeExecution(baseRoute());
    expect(r).toMatchObject({
      provider: "CLAUDE",
      model: "claude-sonnet-5",
      effort: "medium",
      tier: "standard",
      blockedReason: null,
    });
    expect(r.estimatedCostUsd).toBeCloseTo((10_000 * 2 + 4_000 * 10) / 1e6);
  });

  it("lets an agent lower effort but never raise it above the tier's configured effort", () => {
    const agent = (defaultEffort: "low" | "max") => ({ ...baseRoute().agent, defaultEffort });
    expect(routeExecution(baseRoute({ agent: agent("low") })).effort).toBe("low");
    expect(routeExecution(baseRoute({ agent: agent("max") })).effort).toBe("medium");
  });

  it("uses Opus 5.5 only for explicit/AUTO-premium work the company permits", () => {
    expect(routeExecution(baseRoute({ requestedTier: "premium" })).blockedReason).toBe(
      "Premium model not permitted by company policy",
    );
    const company = { ...baseRoute().company, premiumAllowed: true };
    expect(routeExecution(baseRoute({ company, requestedTier: "premium" }))).toMatchObject({
      model: "claude-opus-5-5",
      effort: "high",
      tier: "premium",
    });
    expect(routeExecution(baseRoute({ company, requestedTier: "auto" })).model).toBe(
      "claude-sonnet-5",
    );
    const task = { ...baseRoute().task!, highComplexity: true, modelTier: "auto" as const };
    expect(routeExecution(baseRoute({ company, task })).model).toBe("claude-opus-5-5");
  });

  it("blocks prohibited or disconnected providers and only falls back when permitted", () => {
    expect(
      routeExecution(
        baseRoute({ company: { ...baseRoute().company, allowedProviders: ["OPENAI"] } }),
      ).blockedReason,
    ).toMatch(/No provider permitted/);
    const noClaude = baseRoute().providers.map((p) =>
      p.provider === "CLAUDE" ? { ...p, available: false } : p,
    );
    expect(routeExecution(baseRoute({ providers: noClaude })).blockedReason).toMatch(
      /fallback not permitted/,
    );
    const withFb = { ...baseRoute().company, fallbackAllowed: true };
    expect(
      routeExecution(baseRoute({ providers: noClaude, company: withFb })).blockedReason,
    ).toMatch(/no usable fallback/);
    const task = { ...baseRoute().task!, providerRequirement: "OPENAI" as const };
    expect(routeExecution(baseRoute({ task })).blockedReason).toMatch(/PROVIDER_NOT_CONFIGURED/);
  });

  it("routes subscription Claude without API spend; the price only feeds a NOT BILLED estimate", () => {
    const providers = baseRoute().providers.map((p) =>
      p.provider === "CLAUDE"
        ? { ...p, transport: "claude_code_cli" as const, billingMode: "subscription" as const }
        : p,
    );
    const models = { CLAUDE: CLAUDE_CODE_MODEL_DEFAULTS };
    const r = routeExecution(baseRoute({ providers, models }));
    expect(r).toMatchObject({
      provider: "CLAUDE",
      model: "sonnet",
      transport: "claude_code_cli",
      billingMode: "subscription",
      estimatedCostUsd: 0,
    });
    expect(r.apiEquivalentUsd).toBeCloseTo((10_000 * 2 + 4_000 * 10) / 1e6);
    // No price → still runs (subscription), just without an estimate.
    expect(routeExecution(baseRoute({ providers, models, price: () => null }))).toMatchObject({
      blockedReason: null,
      apiEquivalentUsd: null,
    });
    // Login required is reported as the reason; no transport switch, no fallback.
    const loggedOut = providers.map((p) =>
      p.provider === "CLAUDE"
        ? {
            ...p,
            available: false,
            unavailableReason: "Claude Code login required — run: claude login",
          }
        : p,
    );
    const blocked = routeExecution(baseRoute({ providers: loggedOut, models }));
    expect(blocked.provider).toBeNull();
    expect(blocked.blockedReason).toMatch(/claude login/);
  });

  it("routes deterministic data work to LOCAL and requires a price for AI models", () => {
    const task = { ...baseRoute().task!, requiredCapabilities: ["data.update" as const] };
    expect(routeExecution(baseRoute({ task }))).toMatchObject({
      provider: "LOCAL",
      estimatedCostUsd: 0,
    });
    expect(routeExecution(baseRoute({ price: () => null })).blockedReason).toMatch(
      /No price configured/,
    );
    expect(routeExecution(baseRoute())).toEqual(routeExecution(baseRoute()));
  });
});
