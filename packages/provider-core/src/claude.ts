import Anthropic from "@anthropic-ai/sdk";
import type { ProviderCapability } from "@aibos/shared";
import { estimateCost } from "./pricing";
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

export interface ClaudeCredentials {
  apiKey?: string | null;
  authToken?: string | null;
}

/** Reads credentials from the server environment. Never logged or returned. */
export function claudeCredentialsFromEnv(
  env: Record<string, string | undefined> = process.env,
): ClaudeCredentials {
  return {
    apiKey: env.ANTHROPIC_API_KEY?.trim() || null,
    authToken: env.ANTHROPIC_AUTH_TOKEN?.trim() || null,
  };
}

const CAPABILITIES: ProviderCapability[] = [
  "reasoning",
  "coding",
  "document_analysis",
  "email_drafting",
];

function retryAfterMs(headers: Headers | undefined): number | null {
  const raw = headers?.get("retry-after");
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(raw);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
}

/**
 * Real Claude provider on the official Anthropic TypeScript SDK (Messages API).
 * Reasoning-only in Stage 05: no tools are ever sent. SDK-level retries are
 * disabled — the execution core owns the retry policy.
 */
export class ClaudeProvider implements AIProvider {
  readonly providerId = "CLAUDE" as const;
  readonly displayName = "Claude (Anthropic API)";
  readonly isMock = false;
  /** Optional transport — only used when CLAUDE_TRANSPORT=anthropic_api is set deliberately. */
  readonly transport = "anthropic_api" as const;
  readonly authMode = "api_key" as const;
  readonly billingMode = "api" as const;
  private readonly client: Anthropic | null;
  private readonly inflight = new Map<string, AbortController>();

  constructor(
    private readonly credentials: ClaudeCredentials,
    private readonly models: ProviderModelConfig,
    client?: Anthropic,
  ) {
    const configured = !!(credentials.apiKey || credentials.authToken);
    this.client =
      client ??
      (configured
        ? new Anthropic({
            apiKey: credentials.apiKey ?? null,
            authToken: credentials.apiKey ? null : (credentials.authToken ?? null),
            maxRetries: 0,
          })
        : null);
  }

  available(): boolean {
    return !!this.client;
  }

  capabilities(): ProviderCapability[] {
    return CAPABILITIES;
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

  async healthCheck(
    opts: { probe?: boolean; model?: string; signal?: AbortSignal } = {},
  ): Promise<ProviderHealthResult> {
    const checkedAt = new Date();
    if (!this.client)
      return {
        provider: "CLAUDE",
        state: "not_configured",
        checkedAt,
        detail: "No Anthropic credential configured",
      };
    if (!opts.probe)
      return { provider: "CLAUDE", state: "available", checkedAt, detail: "Credential configured" };
    try {
      // Smallest authenticated operation: model metadata lookup (no tokens generated).
      await this.client.models.retrieve(
        opts.model ?? this.models.standardModel,
        {},
        { signal: opts.signal, timeout: 15_000 },
      );
      return { provider: "CLAUDE", state: "available", checkedAt, detail: "Connection verified" };
    } catch (err) {
      const e = this.normalizeError(err);
      const state =
        e.code === "AUTH_ERROR" || e.code === "PERMISSION_ERROR"
          ? "auth_error"
          : e.code === "RATE_LIMITED"
            ? "rate_limited"
            : e.code === "NOT_FOUND" || e.code === "INVALID_REQUEST"
              ? "degraded"
              : "unavailable";
      return { provider: "CLAUDE", state, checkedAt, detail: e.code };
    }
  }

  execute(request: ProviderRequest): Promise<ProviderResult> {
    return this.stream(request, {});
  }

  async stream(request: ProviderRequest, handlers: StreamHandlers): Promise<ProviderResult> {
    if (!this.client)
      throw new ProviderError("PROVIDER_NOT_CONFIGURED", "Anthropic credential not configured", {
        provider: "CLAUDE",
      });
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    request.signal?.addEventListener("abort", onAbort, { once: true });
    if (request.signal?.aborted) controller.abort();
    this.inflight.set(request.runId, controller);
    const started = Date.now();
    try {
      const params: Anthropic.MessageCreateParamsNonStreaming = {
        model: request.model,
        max_tokens: request.maxOutputTokens,
        system: request.system.map((b) => ({
          type: "text" as const,
          text: b.text,
          ...(b.cache ? { cache_control: { type: "ephemeral" as const } } : {}),
        })),
        messages: request.messages.map((m) => ({
          role: m.role,
          content: [
            {
              type: "text" as const,
              text: m.content,
              ...(m.cache ? { cache_control: { type: "ephemeral" as const } } : {}),
            },
          ],
        })),
        output_config: {
          ...(request.effort ? { effort: request.effort } : {}),
          ...(request.output.kind === "structured"
            ? { format: { type: "json_schema" as const, schema: request.output.schema } }
            : {}),
        },
      };
      const stream = this.client.messages.stream(params, {
        signal: controller.signal,
        timeout: request.timeoutMs,
        maxRetries: 0,
      });
      let startedStreaming = false;
      stream.on("text", (delta) => {
        if (!startedStreaming) {
          startedStreaming = true;
          handlers.onStart?.();
        }
        handlers.onText?.(delta);
      });
      const message = await stream.finalMessage();
      // Only visible text blocks are kept; thinking blocks are never read or stored.
      const text = message.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("");
      const requestId = stream.request_id ?? null;
      if (message.stop_reason === "refusal")
        throw new ProviderError("REFUSED", "The provider declined this request", {
          provider: "CLAUDE",
          requestId,
        });
      let structured: unknown = null;
      if (request.output.kind === "structured") {
        if (message.stop_reason === "max_tokens")
          throw new ProviderError("OUTPUT_TRUNCATED", "Structured output hit the output limit", {
            provider: "CLAUDE",
            requestId,
          });
        try {
          structured = JSON.parse(text);
        } catch {
          throw new ProviderError("INVALID_OUTPUT", "Structured output was not valid JSON", {
            provider: "CLAUDE",
            requestId,
          });
        }
      }
      return {
        provider: "CLAUDE",
        model: message.model,
        text,
        structured,
        stopReason: message.stop_reason,
        requestId,
        usage: {
          inputTokens: message.usage.input_tokens,
          outputTokens: message.usage.output_tokens,
          cacheCreationTokens: message.usage.cache_creation_input_tokens ?? 0,
          cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
        },
        latencyMs: Date.now() - started,
      };
    } catch (err) {
      throw this.normalizeError(err);
    } finally {
      request.signal?.removeEventListener("abort", onAbort);
      this.inflight.delete(request.runId);
    }
  }

  async cancel(runId: string): Promise<void> {
    this.inflight.get(runId)?.abort();
  }

  /** Maps SDK typed errors (most specific first) — never message strings. */
  normalizeError(err: unknown): ProviderError {
    if (err instanceof ProviderError) return err;
    const base = { provider: "CLAUDE" as const };
    if (err instanceof Anthropic.APIUserAbortError)
      return new ProviderError("CANCELLED", "Request cancelled", base);
    if (err instanceof Anthropic.APIConnectionTimeoutError)
      return new ProviderError("TIMEOUT", "Provider request timed out", {
        ...base,
        retryable: false,
      });
    if (err instanceof Anthropic.APIConnectionError)
      return new ProviderError("NETWORK_ERROR", "Could not reach the provider", {
        ...base,
        retryable: true,
      });
    if (err instanceof Anthropic.AuthenticationError)
      return new ProviderError("AUTH_ERROR", "Provider authentication failed", {
        ...base,
        status: 401,
        requestId: err.requestID,
      });
    if (err instanceof Anthropic.PermissionDeniedError)
      return new ProviderError("PERMISSION_ERROR", "Provider permission denied", {
        ...base,
        status: 403,
        requestId: err.requestID,
      });
    if (err instanceof Anthropic.NotFoundError)
      return new ProviderError("NOT_FOUND", "Model or resource not found", {
        ...base,
        status: 404,
        requestId: err.requestID,
      });
    if (err instanceof Anthropic.RateLimitError)
      return new ProviderError("RATE_LIMITED", "Provider rate limit reached", {
        ...base,
        status: 429,
        retryable: true,
        retryAfterMs: retryAfterMs(err.headers),
        requestId: err.requestID,
      });
    if (
      err instanceof Anthropic.BadRequestError ||
      err instanceof Anthropic.UnprocessableEntityError
    )
      return new ProviderError("INVALID_REQUEST", "Provider rejected the request", {
        ...base,
        status: err.status,
        requestId: err.requestID,
      });
    if (err instanceof Anthropic.InternalServerError) {
      const overloaded = err.status === 529;
      return new ProviderError(
        overloaded ? "OVERLOADED" : "SERVER_ERROR",
        overloaded ? "Provider overloaded" : "Provider server error",
        {
          ...base,
          status: err.status,
          retryable: true,
          retryAfterMs: retryAfterMs(err.headers),
          requestId: err.requestID,
        },
      );
    }
    if (err instanceof Anthropic.APIError)
      return new ProviderError("UNKNOWN", "Provider error", {
        ...base,
        status: typeof err.status === "number" ? err.status : null,
        requestId: err.requestID,
      });
    return new ProviderError("UNKNOWN", "Unexpected provider failure", base);
  }
}
