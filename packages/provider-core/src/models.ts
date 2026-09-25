import type { EffortLevel } from "@aibos/shared";

/** Model policy for a provider. IDs come from configuration, never hard-coded call sites. */
export interface ProviderModelConfig {
  standardModel: string;
  premiumModel: string;
  standardEffort: EffortLevel;
  premiumEffort: EffortLevel;
}

const EFFORTS: readonly EffortLevel[] = ["low", "medium", "high", "xhigh", "max"];
const effortOr = (v: string | undefined, fallback: EffortLevel): EffortLevel =>
  v && (EFFORTS as readonly string[]).includes(v) ? (v as EffortLevel) : fallback;

/** Development defaults (overridable with CLAUDE_* environment variables and provider settings). */
export const CLAUDE_MODEL_DEFAULTS: ProviderModelConfig = {
  standardModel: "claude-sonnet-5",
  premiumModel: "claude-opus-5-5",
  standardEffort: "medium",
  premiumEffort: "high",
};

export function claudeModelConfig(
  env: Record<string, string | undefined> = process.env,
): ProviderModelConfig {
  return {
    standardModel: env.CLAUDE_DEFAULT_MODEL?.trim() || CLAUDE_MODEL_DEFAULTS.standardModel,
    premiumModel: env.CLAUDE_PREMIUM_MODEL?.trim() || CLAUDE_MODEL_DEFAULTS.premiumModel,
    standardEffort: effortOr(
      env.CLAUDE_DEFAULT_EFFORT?.trim(),
      CLAUDE_MODEL_DEFAULTS.standardEffort,
    ),
    premiumEffort: effortOr(env.CLAUDE_PREMIUM_EFFORT?.trim(), CLAUDE_MODEL_DEFAULTS.premiumEffort),
  };
}

const LABELS: Record<string, string> = {
  "claude-sonnet-5": "Claude Sonnet 5",
  "claude-opus-5-5": "Claude Opus 5.5",
  "local-deterministic": "Local deterministic",
};

export function modelLabel(model: string): string {
  if (LABELS[model]) return LABELS[model];
  if (model.startsWith("mock-")) return `${modelLabel(model.slice(5))} (mock)`;
  return model;
}
