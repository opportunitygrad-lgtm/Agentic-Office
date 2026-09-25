import {
  MAX_OUTPUT_TOKENS_CEILING,
  RESPONSE_DETAIL_TOKENS,
  type ProviderErrorCode,
  type ResponseDetail,
} from "@aibos/shared";
import type { ProviderError } from "@aibos/provider-core";

const DETAIL_ORDER: ResponseDetail[] = ["short", "normal", "detailed", "custom"];

/**
 * Output length control: the requested detail is capped by the company's
 * maximum detail; "custom" uses an explicit token count within the ceiling.
 */
export function maxOutputTokensFor(
  detail: ResponseDetail,
  companyMax: ResponseDetail,
  customTokens?: number | null,
): { detail: ResponseDetail; maxOutputTokens: number } {
  const effective =
    DETAIL_ORDER.indexOf(detail) > DETAIL_ORDER.indexOf(companyMax) ? companyMax : detail;
  if (effective === "custom") {
    const n = Math.min(
      Math.max(256, customTokens ?? RESPONSE_DETAIL_TOKENS.normal),
      MAX_OUTPUT_TOKENS_CEILING,
    );
    return { detail: "custom", maxOutputTokens: n };
  }
  return { detail: effective, maxOutputTokens: RESPONSE_DETAIL_TOKENS[effective] };
}

/** Errors that may be retried once (transient provider conditions only). */
export const RETRYABLE_CODES: readonly ProviderErrorCode[] = [
  "RATE_LIMITED",
  "OVERLOADED",
  "SERVER_ERROR",
  "NETWORK_ERROR",
];

export interface RetryPolicy {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxRetries: 1,
  baseDelayMs: 2_000,
  maxDelayMs: 30_000,
};

/**
 * Retry only transient failures, at most `maxRetries` times (default ONE).
 * Never retries auth, permission, invalid request, budget, refusal, timeout
 * or cancellation. Honors Retry-After when supplied.
 */
export function retryDecision(
  err: ProviderError,
  attempt: number,
  policy: RetryPolicy,
): { retry: boolean; delayMs: number } {
  const retry = err.retryable && RETRYABLE_CODES.includes(err.code) && attempt < policy.maxRetries;
  if (!retry) return { retry: false, delayMs: 0 };
  const backoff = policy.baseDelayMs * 2 ** attempt;
  const delayMs = Math.min(err.retryAfterMs ?? backoff, policy.maxDelayMs);
  return { retry: true, delayMs };
}

/** Provider request timeout (ms) — configurable, always set. */
export function providerTimeoutMs(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.AI_PROVIDER_TIMEOUT_MS);
  return Number.isFinite(n) && n >= 5_000 ? Math.min(n, 15 * 60_000) : 180_000;
}

/** Recent chat window; older turns are dropped (no AI summarisation yet). */
export function chatHistoryLimit(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.CHAT_HISTORY_MAX_MESSAGES);
  return Number.isInteger(n) && n >= 0 ? Math.min(n, 100) : 12;
}

export function recentHistory<T>(messages: T[], limit: number): { kept: T[]; dropped: number } {
  const kept = limit === 0 ? [] : messages.slice(-limit);
  return { kept, dropped: messages.length - kept.length };
}
