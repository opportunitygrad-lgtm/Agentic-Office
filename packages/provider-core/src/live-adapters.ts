import type { ProviderCapability, ProviderType } from "@aibos/shared";
import { PROVIDER_LABELS } from "@aibos/shared";
import {
  ProviderNotConfiguredError,
  type AIProvider,
  type CostEstimate,
  type ProviderHealth,
  type ProviderTaskRequest,
  type ProviderTaskResult,
} from "./types";

/**
 * Placeholder for live vendor adapters (Claude: Stage 07, OpenAI: Stage 08,
 * Grok: Stage 09). They intentionally perform no network calls and hold no
 * credentials; every execution throws ProviderNotConfiguredError.
 */
export class UnconfiguredLiveProvider implements AIProvider {
  readonly displayName: string;
  readonly defaultModel = "unconfigured";

  constructor(readonly type: ProviderType) {
    this.displayName = PROVIDER_LABELS[type];
  }

  supportsCapability(_capability: ProviderCapability): boolean {
    return false;
  }

  estimateCost(request: ProviderTaskRequest): CostEstimate {
    return {
      provider: this.type,
      model: request.model ?? this.defaultModel,
      estimatedInputTokens: 0,
      estimatedOutputTokens: 0,
      estimatedCostUsd: 0,
    };
  }

  async executeTask(_request: ProviderTaskRequest): Promise<ProviderTaskResult> {
    throw new ProviderNotConfiguredError(this.type);
  }

  async cancel(_requestId: string): Promise<void> {}

  async healthCheck(): Promise<ProviderHealth> {
    return { provider: this.type, status: "not_configured", checkedAt: new Date() };
  }
}
