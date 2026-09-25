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

export interface MockCodexOptions {
  /** Delay between streamed chunks (ms). */
  chunkDelayMs?: number;
  /** Errors to throw on successive calls (then succeed). */
  failures?: ProviderError[];
  /** Override the structured result produced. */
  result?: (request: ProviderRequest) => unknown;
  /** Pretend the CLI is not authenticated. */
  configured?: boolean;
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted)
      return reject(new ProviderError("CANCELLED", "Request cancelled", { provider: "OPENAI" }));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(new ProviderError("CANCELLED", "Request cancelled", { provider: "OPENAI" }));
      },
      { once: true },
    );
  });

/**
 * Deterministic Codex/OpenAI stand-in for tests and local development. Never
 * makes network calls and never consumes ChatGPT subscription usage.
 */
export class MockCodexProvider implements AIProvider {
  readonly providerId = "OPENAI" as const;
  readonly displayName = "Codex (mock)";
  readonly isMock = true;
  readonly transport = "codex_cli" as const;
  readonly authMode = "subscription_login" as const;
  readonly billingMode = "subscription" as const;
  readonly calls: ProviderRequest[] = [];
  private readonly inflight = new Map<string, AbortController>();
  private readonly failures: ProviderError[];

  constructor(
    private readonly models: ProviderModelConfig,
    private readonly options: MockCodexOptions = {},
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
    return estimateCost(price, { provider: "OPENAI", ...input });
  }
  async healthCheck(opts: { probe?: boolean } = {}): Promise<ProviderHealthResult> {
    return {
      provider: "OPENAI",
      state: this.available() ? "available" : "login_required",
      checkedAt: new Date(),
      detail: this.available()
        ? opts.probe
          ? "Mock connection verified"
          : "Mock provider"
        : "Login required. Open Terminal and run: codex",
      cli: {
        binary: "mock",
        version: "mock",
        loggedIn: this.available(),
        authMethod: "mock",
        apiProvider: null,
        subscriptionType: null,
      },
    };
  }
  execute(request: ProviderRequest): Promise<ProviderResult> {
    return this.stream(request, {});
  }

  async stream(request: ProviderRequest, handlers: StreamHandlers): Promise<ProviderResult> {
    if (!this.available())
      throw new ProviderError("LOGIN_REQUIRED", "Login required. Run in Terminal: codex", {
        provider: "OPENAI",
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
          ? JSON.stringify(
              this.options.result?.(request) ??
                (request.output.name === "provider_review"
                  ? defaultReview(userText)
                  : defaultResult(userText)),
            )
          : `[Mock Codex — no AI was called] I received your message: "${lastUser(request).slice(0, 200)}". ` +
            "I can only use my approved company context and have no external tools.";
      handlers.onStart?.();
      const chunks = output.match(/.{1,48}/gs) ?? [output];
      for (const c of chunks) {
        await sleep(this.options.chunkDelayMs ?? 0, controller.signal);
        handlers.onText?.(c);
      }
      const allInput = estimateTokens(request.system.map((b) => b.text).join("\n") + userText);
      return {
        provider: "OPENAI",
        model: request.model,
        text: output,
        structured: request.output.kind === "structured" ? JSON.parse(output) : null,
        stopReason: "end_turn",
        requestId: `mock_codex_${request.runId.slice(0, 8)}`,
        usage: {
          inputTokens: allInput,
          outputTokens: estimateTokens(output),
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
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
      : new ProviderError("UNKNOWN", "Mock provider failure", { provider: "OPENAI" });
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
    summary: `[Mock Codex] Internal summary for "${title}" using only the supplied context.`,
    response: `This is a deterministic development response for "${title}". No AI provider was called and no external action was taken.`,
    keyFindings: ["Context was supplied by the Context Engine", "No external research was performed"],
    proposedNextActions: ["Review the result", "Decide on follow-up tasks"],
    proposedHandoffs: [],
    proposedKnowledgeDrafts: [],
    warnings: ["Mock provider output — not real analysis"],
    confidence: "low",
  };
}

/** Deterministic stand-in for a second-opinion review — never a ranking or verdict. */
function defaultReview(userText: string) {
  const title = /<task_title>([\s\S]*?)<\/task_title>/.exec(userText)?.[1]?.trim() ?? "the task";
  return {
    agreementPoints: [`The result for "${title}" is consistent with the supplied company context.`],
    disagreementPoints: [],
    possibleErrors: [],
    missingConsiderations: ["No independent research was performed by this mock reviewer."],
    unsupportedClaims: [],
    risks: [],
    suggestedCorrections: [],
    confidence: "low",
    overallReviewSummary: `[Mock Codex review] The original result for "${title}" appears supported by the supplied context.`,
  };
}
