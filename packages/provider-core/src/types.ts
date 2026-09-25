import type {
  EffortLevel,
  ProviderCapability,
  ProviderErrorCode,
  ProviderHealthState,
  ProviderType,
} from "@aibos/shared";

/**
 * Provider-neutral execution contract. The OS orchestrates (tasks, context,
 * instructions, budgets, audit); a provider only turns a prepared request into
 * a response. Nothing outside provider adapters depends on a vendor SDK.
 */

/** A system/instruction block. `cache` marks stable content worth caching. */
export interface SystemBlock {
  text: string;
  cache: boolean;
}

export interface ProviderMessage {
  role: "user" | "assistant";
  content: string;
  /** Mark the end of a stable prefix (e.g. the context pack) as cacheable. */
  cache?: boolean;
}

export type OutputSpec =
  { kind: "text" } | { kind: "structured"; name: string; schema: Record<string, unknown> };

export interface ProviderRequest {
  runId: string;
  model: string;
  effort: EffortLevel | null;
  system: SystemBlock[];
  messages: ProviderMessage[];
  output: OutputSpec;
  maxOutputTokens: number;
  timeoutMs: number;
  signal?: AbortSignal;
}

export interface ProviderUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}

export interface ProviderResult {
  provider: ProviderType;
  model: string;
  /** Final visible text (never hidden reasoning). */
  text: string;
  /** Parsed JSON for structured output (validated later by the caller). */
  structured: unknown;
  stopReason: string | null;
  requestId: string | null;
  usage: ProviderUsage;
  latencyMs: number;
}

export interface StreamHandlers {
  /** The provider accepted the request and started streaming. */
  onStart?(): void;
  /** Visible output text deltas only. */
  onText?(delta: string): void;
}

export interface ProviderHealthResult {
  provider: ProviderType;
  state: ProviderHealthState;
  checkedAt: Date;
  detail: string | null;
}

export interface ModelPrice {
  provider: ProviderType;
  model: string;
  inputPerMTok: number;
  outputPerMTok: number;
  cacheWritePerMTok: number;
  cacheReadPerMTok: number;
  currency: "USD";
  effectiveFrom: string;
  source?: string | null;
}

export interface CostEstimate {
  provider: ProviderType;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface AIProvider {
  readonly providerId: ProviderType;
  readonly displayName: string;
  /** True for deterministic development/test providers (clearly labelled in the UI). */
  readonly isMock: boolean;
  /** Credentials/configuration present — never makes a network call. */
  available(): boolean;
  /**
   * Health without network I/O by default. `probe: true` performs the smallest
   * supported authenticated operation (explicit Test Connection only).
   */
  healthCheck(opts?: {
    probe?: boolean;
    model?: string;
    signal?: AbortSignal;
  }): Promise<ProviderHealthResult>;
  capabilities(): ProviderCapability[];
  supportedModels(): string[];
  /** Local estimate — no provider call. */
  estimate(
    input: { model: string; inputTokens: number; maxOutputTokens: number },
    price: ModelPrice | null,
  ): CostEstimate;
  execute(request: ProviderRequest): Promise<ProviderResult>;
  stream(request: ProviderRequest, handlers: StreamHandlers): Promise<ProviderResult>;
  /** Abort an in-flight request started with this runId. */
  cancel(runId: string): Promise<void>;
  normalizeError(err: unknown): ProviderError;
}

/** Normalised provider error. Decisions use `code`/`retryable`, never messages. */
export class ProviderError extends Error {
  constructor(
    readonly code: ProviderErrorCode,
    message: string,
    readonly opts: {
      retryable?: boolean;
      retryAfterMs?: number | null;
      status?: number | null;
      requestId?: string | null;
      provider?: ProviderType;
    } = {},
  ) {
    super(message);
    this.name = "ProviderError";
  }
  get retryable(): boolean {
    return this.opts.retryable ?? false;
  }
  get retryAfterMs(): number | null {
    return this.opts.retryAfterMs ?? null;
  }
}

export const isProviderError = (e: unknown): e is ProviderError => e instanceof ProviderError;
