import type { ProviderCapability, ProviderType } from "@aibos/shared";

export interface ProviderMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ProviderTaskRequest {
  /** Correlates the call with tasks / audit events / cost ledger rows. */
  requestId: string;
  taskId?: string;
  agentId?: string;
  companyId?: string;
  model?: string;
  capability: ProviderCapability;
  messages: ProviderMessage[];
  maxOutputTokens?: number;
  /** Hard ceiling in USD; providers must refuse work estimated above it. */
  budgetUsd?: number;
  signal?: AbortSignal;
}

export interface ProviderUsage {
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  toolCostUsd: number;
  providerCostUsd: number;
}

export interface ProviderTaskResult {
  provider: ProviderType;
  model: string;
  output: string;
  usage: ProviderUsage;
  finishReason: "completed" | "cancelled" | "budget_exceeded" | "error";
  latencyMs: number;
}

export interface CostEstimate {
  provider: ProviderType;
  model: string;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  estimatedCostUsd: number;
}

export interface ProviderHealth {
  provider: ProviderType;
  status: "ok" | "degraded" | "down" | "not_configured";
  checkedAt: Date;
  detail?: string;
}

/**
 * The single contract every AI provider must satisfy. The OS depends only on
 * this interface — never on a vendor SDK — so providers stay replaceable.
 */
export interface AIProvider {
  readonly type: ProviderType;
  readonly displayName: string;
  readonly defaultModel: string;
  executeTask(request: ProviderTaskRequest): Promise<ProviderTaskResult>;
  estimateCost(request: ProviderTaskRequest): CostEstimate;
  supportsCapability(capability: ProviderCapability): boolean;
  cancel(requestId: string): Promise<void>;
  healthCheck(): Promise<ProviderHealth>;
}

export class ProviderNotConfiguredError extends Error {
  constructor(provider: ProviderType) {
    super(`${provider} provider is not configured (live calls arrive in a later stage)`);
    this.name = "ProviderNotConfiguredError";
  }
}
