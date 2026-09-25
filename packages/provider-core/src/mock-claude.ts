import type { ProviderCapability } from "@aibos/shared";
import { estimateCost, estimateTokens } from "./pricing";
import type { ProviderModelConfig } from "./models";
import {
  ProviderError,
  type AIProvider,
  type CostEstimate,
  type ModelPrice,
  type ProviderHealthResult,
  type ProviderRequest,
  type ProviderResult,
  type StreamHandlers,
} from "./types";

export interface MockClaudeOptions {
  /** Delay between streamed chunks (ms). */
  chunkDelayMs?: number;
  /** Errors to throw on successive calls (then succeed). */
  failures?: ProviderError[];
  /** Override the structured result produced. */
  result?: (request: ProviderRequest) => unknown;
  /** Pretend credentials are missing. */
  configured?: boolean;
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted)
      return reject(new ProviderError("CANCELLED", "Request cancelled", { provider: "CLAUDE" }));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(new ProviderError("CANCELLED", "Request cancelled", { provider: "CLAUDE" }));
      },
      { once: true },
    );
  });

/**
 * Deterministic Claude stand-in for tests and local development. Never makes
 * network calls. Simulates streaming, prompt-cache accounting (a repeated
 * cacheable prefix is reported as cache reads), cancellation and failures.
 */
export class MockClaudeProvider implements AIProvider {
  readonly providerId = "CLAUDE" as const;
  readonly displayName = "Claude (mock)";
  readonly isMock = true;
  readonly calls: ProviderRequest[] = [];
  private readonly seenPrefixes = new Set<string>();
  private readonly inflight = new Map<string, AbortController>();
  private readonly failures: ProviderError[];

  constructor(
    private readonly models: ProviderModelConfig,
    private readonly options: MockClaudeOptions = {},
  ) {
    this.failures = [...(options.failures ?? [])];
  }

  available(): boolean {
    return this.options.configured ?? true;
  }
  capabilities(): ProviderCapability[] {
    return ["reasoning", "coding", "document_analysis", "email_drafting"];
  }
  supportedModels(): string[] {
    return [this.models.standardModel, this.models.premiumModel];
  }
  estimate(
    input: { model: string; inputTokens: number; maxOutputTokens: number },
    price: ModelPrice | null,
  ): CostEstimate {
    return estimateCost(price, { provider: "CLAUDE", ...input });
  }
  async healthCheck(opts: { probe?: boolean } = {}): Promise<ProviderHealthResult> {
    return {
      provider: "CLAUDE",
      state: this.available() ? "available" : "not_configured",
      checkedAt: new Date(),
      detail: this.available()
        ? opts.probe
          ? "Mock connection verified"
          : "Mock provider"
        : "Mock provider not configured",
    };
  }
  execute(request: ProviderRequest): Promise<ProviderResult> {
    return this.stream(request, {});
  }

  async stream(request: ProviderRequest, handlers: StreamHandlers): Promise<ProviderResult> {
    if (!this.available())
      throw new ProviderError("PROVIDER_NOT_CONFIGURED", "Anthropic credential not configured", {
        provider: "CLAUDE",
      });
    this.calls.push(request);
    const controller = new AbortController();
    request.signal?.addEventListener("abort", () => controller.abort(), { once: true });
    if (request.signal?.aborted) controller.abort();
    this.inflight.set(request.runId, controller);
    const started = Date.now();
    try {
      const failure = this.failures.shift();
      if (failure) throw failure;
      const userText = request.messages.map((m) => m.content).join("\n");
      const output =
        request.output.kind === "structured"
          ? JSON.stringify(this.options.result?.(request) ?? defaultResult(userText))
          : `[Mock Claude — no AI was called] I received your message: "${lastUser(request).slice(0, 200)}". ` +
            "I can only use my approved company context and have no external tools.";
      handlers.onStart?.();
      const chunks = output.match(/.{1,48}/gs) ?? [output];
      for (const c of chunks) {
        await sleep(this.options.chunkDelayMs ?? 0, controller.signal);
        handlers.onText?.(c);
      }
      // Cache simulation: cacheable system prefix seen before → cache read.
      const prefix = request.system
        .filter((b) => b.cache)
        .map((b) => b.text)
        .join("\n");
      const prefixTokens = estimateTokens(prefix);
      const hit = prefix.length > 0 && this.seenPrefixes.has(prefix);
      if (prefix) this.seenPrefixes.add(prefix);
      const allInput = estimateTokens(request.system.map((b) => b.text).join("\n") + userText);
      return {
        provider: "CLAUDE",
        model: request.model,
        text: output,
        structured: request.output.kind === "structured" ? JSON.parse(output) : null,
        stopReason: "end_turn",
        requestId: `mock_req_${request.runId.slice(0, 8)}`,
        usage: {
          inputTokens: Math.max(1, allInput - prefixTokens),
          outputTokens: estimateTokens(output),
          cacheCreationTokens: hit ? 0 : prefixTokens,
          cacheReadTokens: hit ? prefixTokens : 0,
        },
        latencyMs: Date.now() - started,
      };
    } finally {
      this.inflight.delete(request.runId);
    }
  }

  async cancel(runId: string): Promise<void> {
    this.inflight.get(runId)?.abort();
  }
  normalizeError(err: unknown): ProviderError {
    return err instanceof ProviderError
      ? err
      : new ProviderError("UNKNOWN", "Mock provider failure", { provider: "CLAUDE" });
  }
}

function lastUser(r: ProviderRequest): string {
  const m = [...r.messages].reverse().find((x) => x.role === "user");
  const text = m?.content ?? "";
  const match = /<user_message[^>]*>([\s\S]*?)<\/user_message>/.exec(text);
  return (match?.[1] ?? text.slice(-300)).trim();
}

function defaultResult(userText: string) {
  const title = /<task_title>([\s\S]*?)<\/task_title>/.exec(userText)?.[1]?.trim() ?? "the task";
  return {
    status: "completed",
    summary: `[Mock Claude] Internal summary for "${title}" using only the supplied context.`,
    response: `This is a deterministic development response for "${title}". No AI provider was called and no external action was taken.`,
    keyFindings: [
      "Context was supplied by the Context Engine",
      "No external research was performed",
    ],
    proposedNextActions: ["Review the result", "Decide on follow-up tasks"],
    proposedHandoffs: [],
    proposedKnowledgeDrafts: [],
    warnings: ["Mock provider output — not real analysis"],
    confidence: "low",
  };
}
