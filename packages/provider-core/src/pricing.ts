import type { ProviderType } from "@aibos/shared";

/**
 * PLACEHOLDER pricing (USD per 1M tokens) used only for development estimates.
 * Stage 11 (Cost Governor) replaces this with a maintained, dated price table.
 */
export const PLACEHOLDER_PRICING: Record<ProviderType, { input: number; output: number }> = {
  CLAUDE: { input: 3, output: 15 },
  OPENAI: { input: 2.5, output: 10 },
  GROK: { input: 3, output: 15 },
  LOCAL: { input: 0, output: 0 },
};

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function priceTokens(provider: ProviderType, input: number, output: number): number {
  const p = PLACEHOLDER_PRICING[provider];
  return Number(((input * p.input + output * p.output) / 1_000_000).toFixed(6));
}
