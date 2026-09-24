import type { ProviderCapability, ProviderType } from "@aibos/shared";
import { PROVIDER_LABELS } from "@aibos/shared";
import { estimateTokens, priceTokens } from "./pricing";
import type {
  AIProvider,
  CostEstimate,
  ProviderHealth,
  ProviderTaskRequest,
  ProviderTaskResult,
} from "./types";

export interface MockProviderOptions {
  capabilities: ProviderCapability[];
  model?: string;
  latencyMs?: number;
  healthy?: boolean;
}

/**
 * Deterministic development provider. Never performs network I/O. Used by
 * tests, local development and the worker until live adapters are enabled.
 */
export class MockProvider implements AIProvider {
  readonly displayName: string;
  readonly defaultModel: string;
  private readonly inflight = new Map<string, AbortController>();

  constructor(
    readonly type: ProviderType,
    private readonly options: MockProviderOptions,
  ) {
    this.displayName = `${PROVIDER_LABELS[type]} (mock)`;
    this.defaultModel = options.model ?? `mock-${type.toLowerCase()}`;
  }

  supportsCapability(capability: ProviderCapability): boolean {
    return this.options.capabilities.includes(capability);
  }

  estimateCost(request: ProviderTaskRequest): CostEstimate {
    const input = estimateTokens(request.messages.map((m) => m.content).join("\n"));
    const output = request.maxOutputTokens ?? 1024;
    return {
      provider: this.type,
      model: request.model ?? this.defaultModel,
      estimatedInputTokens: input,
      estimatedOutputTokens: output,
      estimatedCostUsd: priceTokens(this.type, input, output),
    };
  }

  async executeTask(request: ProviderTaskRequest): Promise<ProviderTaskResult> {
    const started = Date.now();
    const estimate = this.estimateCost(request);
    const base = { provider: this.type, model: estimate.model };
    const zeroUsage = {
      inputTokens: 0,
      outputTokens: 0,
      cachedTokens: 0,
      toolCostUsd: 0,
      providerCostUsd: 0,
    };

    if (!this.supportsCapability(request.capability)) {
      throw new Error(`${this.displayName} does not support ${request.capability}`);
    }
    if (request.budgetUsd !== undefined && estimate.estimatedCostUsd > request.budgetUsd) {
      return {
        ...base,
        output: "",
        usage: zeroUsage,
        finishReason: "budget_exceeded",
        latencyMs: 0,
      };
    }

    const controller = new AbortController();
    this.inflight.set(request.requestId, controller);
    request.signal?.addEventListener("abort", () => controller.abort());
    try {
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, this.options.latencyMs ?? 0);
        controller.signal.addEventListener("abort", () => {
          clearTimeout(t);
          resolve();
        });
      });
      if (controller.signal.aborted) {
        return {
          ...base,
          output: "",
          usage: zeroUsage,
          finishReason: "cancelled",
          latencyMs: Date.now() - started,
        };
      }
      const last = request.messages.at(-1)?.content ?? "";
      const output = `[mock ${this.type}] ${request.capability}: ${last.slice(0, 120)}`;
      const outputTokens = estimateTokens(output);
      return {
        ...base,
        output,
        usage: {
          inputTokens: estimate.estimatedInputTokens,
          outputTokens,
          cachedTokens: 0,
          toolCostUsd: 0,
          providerCostUsd: priceTokens(this.type, estimate.estimatedInputTokens, outputTokens),
        },
        finishReason: "completed",
        latencyMs: Date.now() - started,
      };
    } finally {
      this.inflight.delete(request.requestId);
    }
  }

  async cancel(requestId: string): Promise<void> {
    this.inflight.get(requestId)?.abort();
  }

  async healthCheck(): Promise<ProviderHealth> {
    return {
      provider: this.type,
      status: this.options.healthy === false ? "down" : "ok",
      checkedAt: new Date(),
      detail: "mock provider",
    };
  }
}

/** Mock capability matrix mirroring each vendor's intended role. */
export function createMockProviders(): AIProvider[] {
  return [
    new MockProvider("CLAUDE", {
      model: "mock-claude",
      capabilities: [
        "reasoning",
        "coding",
        "web_research",
        "computer_use",
        "vision",
        "document_analysis",
        "email_drafting",
      ],
    }),
    new MockProvider("OPENAI", {
      model: "mock-openai",
      capabilities: [
        "reasoning",
        "coding",
        "web_research",
        "vision",
        "document_analysis",
        "email_drafting",
      ],
    }),
    new MockProvider("GROK", {
      model: "mock-grok",
      capabilities: ["reasoning", "x_research", "web_research"],
    }),
    new MockProvider("LOCAL", { model: "local-rules", capabilities: ["reasoning"] }),
  ];
}
