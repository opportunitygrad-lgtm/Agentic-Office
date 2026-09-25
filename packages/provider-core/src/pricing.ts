import type { CostEstimate, ModelPrice, ProviderUsage } from "./types";

/**
 * Local token estimate (~4 characters per token). Used for pre-flight cost
 * estimates so no provider request is spent just counting tokens; the
 * provider-reported usage is authoritative after the call.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

const round = (n: number) => Math.round(n * 1_000_000) / 1_000_000;

export function estimateCost(
  price: ModelPrice | null,
  input: {
    provider: ModelPrice["provider"];
    model: string;
    inputTokens: number;
    maxOutputTokens: number;
  },
): CostEstimate {
  const costUsd = price
    ? round(
        (input.inputTokens * price.inputPerMTok + input.maxOutputTokens * price.outputPerMTok) /
          1_000_000,
      )
    : 0;
  return {
    provider: input.provider,
    model: input.model,
    inputTokens: input.inputTokens,
    outputTokens: input.maxOutputTokens,
    costUsd,
  };
}

/**
 * Actual cost from provider usage and the price snapshot in force when the
 * call ran. `inputTokens` excludes cache reads/writes (provider semantics).
 */
export function costOfUsage(price: ModelPrice, usage: ProviderUsage): number {
  return round(
    (usage.inputTokens * price.inputPerMTok +
      usage.outputTokens * price.outputPerMTok +
      usage.cacheCreationTokens * price.cacheWritePerMTok +
      usage.cacheReadTokens * price.cacheReadPerMTok) /
      1_000_000,
  );
}
