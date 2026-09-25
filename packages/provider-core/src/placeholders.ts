import type { ProviderCapability, ProviderType } from "@aibos/shared";
import { PROVIDER_LABELS } from "@aibos/shared";
import { estimateCost } from "./pricing";
import {
  ProviderError,
  type AIProvider,
  type CostEstimate,
  type ModelPrice,
  type ProviderHealthResult,
  type ProviderRequest,
  type ProviderResult,
} from "./types";

/**
 * OpenAI and Grok are NOT connected in Stage 05. They fail clearly with
 * PROVIDER_NOT_CONFIGURED and never silently fall back to another provider.
 */
export class NotConnectedProvider implements AIProvider {
  readonly displayName: string;
  readonly isMock = false;
  constructor(readonly providerId: ProviderType) {
    this.displayName = PROVIDER_LABELS[providerId];
  }
  available(): boolean {
    return false;
  }
  capabilities(): ProviderCapability[] {
    return [];
  }
  supportedModels(): string[] {
    return [];
  }
  estimate(
    input: { model: string; inputTokens: number; maxOutputTokens: number },
    price: ModelPrice | null,
  ): CostEstimate {
    return estimateCost(price, { provider: this.providerId, ...input });
  }
  async healthCheck(): Promise<ProviderHealthResult> {
    return {
      provider: this.providerId,
      state: "not_configured",
      checkedAt: new Date(),
      detail: "Not connected in this stage",
    };
  }
  async execute(_request: ProviderRequest): Promise<ProviderResult> {
    throw this.normalizeError(null);
  }
  async stream(request: ProviderRequest): Promise<ProviderResult> {
    return this.execute(request);
  }
  async cancel(): Promise<void> {}
  normalizeError(_err: unknown): ProviderError {
    return new ProviderError("PROVIDER_NOT_CONFIGURED", `${this.displayName} is not connected`, {
      provider: this.providerId,
    });
  }
}

/**
 * LOCAL: deterministic in-process logic for work that needs no AI. It never
 * calls a model and costs nothing.
 */
export class LocalProvider implements AIProvider {
  readonly providerId = "LOCAL" as const;
  readonly displayName = "Local logic";
  readonly isMock = false;
  available(): boolean {
    return true;
  }
  capabilities(): ProviderCapability[] {
    return [];
  }
  supportedModels(): string[] {
    return ["local-deterministic"];
  }
  estimate(input: { model: string; inputTokens: number; maxOutputTokens: number }): CostEstimate {
    return { provider: "LOCAL", model: input.model, inputTokens: 0, outputTokens: 0, costUsd: 0 };
  }
  async healthCheck(): Promise<ProviderHealthResult> {
    return { provider: "LOCAL", state: "available", checkedAt: new Date(), detail: "In-process" };
  }
  async execute(request: ProviderRequest): Promise<ProviderResult> {
    const started = Date.now();
    const structured = {
      status: "needs_human",
      summary: "Handled by deterministic local logic — no AI provider was called.",
      response:
        "This task only needs deterministic data handling. It has been recorded for a person or a later data integration to complete.",
      keyFindings: [],
      proposedNextActions: ["Complete the data operation through the relevant integration"],
      proposedHandoffs: [],
      proposedKnowledgeDrafts: [],
      warnings: [],
      confidence: "high",
    };
    const text =
      request.output.kind === "structured" ? JSON.stringify(structured) : structured.summary;
    return {
      provider: "LOCAL",
      model: "local-deterministic",
      text,
      structured: request.output.kind === "structured" ? structured : null,
      stopReason: "end_turn",
      requestId: null,
      usage: { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 },
      latencyMs: Date.now() - started,
    };
  }
  async stream(
    request: ProviderRequest,
    handlers: { onStart?(): void; onText?(d: string): void },
  ): Promise<ProviderResult> {
    const r = await this.execute(request);
    handlers.onStart?.();
    handlers.onText?.(r.text);
    return r;
  }
  async cancel(): Promise<void> {}
  normalizeError(): ProviderError {
    return new ProviderError("UNKNOWN", "Local processing failed", { provider: "LOCAL" });
  }
}
