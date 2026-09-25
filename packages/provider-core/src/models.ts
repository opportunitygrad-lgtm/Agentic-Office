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

/**
 * Claude Code subscription defaults: CLI model aliases, never API model IDs.
 * The owner's plan decides which models the aliases resolve to.
 */
export const CLAUDE_CODE_MODEL_DEFAULTS: ProviderModelConfig = {
  standardModel: "sonnet",
  premiumModel: "opus",
  standardEffort: "medium",
  premiumEffort: "high",
};

export function claudeCodeModelConfig(
  env: Record<string, string | undefined> = process.env,
): ProviderModelConfig {
  return {
    standardModel: env.CLAUDE_CODE_MODEL?.trim() || CLAUDE_CODE_MODEL_DEFAULTS.standardModel,
    premiumModel: env.CLAUDE_CODE_PREMIUM_MODEL?.trim() || CLAUDE_CODE_MODEL_DEFAULTS.premiumModel,
    standardEffort: effortOr(
      env.CLAUDE_CODE_EFFORT?.trim(),
      CLAUDE_CODE_MODEL_DEFAULTS.standardEffort,
    ),
    premiumEffort: effortOr(
      env.CLAUDE_CODE_PREMIUM_EFFORT?.trim(),
      CLAUDE_CODE_MODEL_DEFAULTS.premiumEffort,
    ),
  };
}

/**
 * Which price-table model an alias is compared against for the analytical
 * API-equivalent estimate (NOT BILLED). The model Claude Code actually used is
 * recorded from its own output after the run.
 */
const ALIAS_PRICE_MODELS: Record<string, string> = {
  sonnet: "claude-sonnet-5",
  opus: "claude-opus-5-5",
};
export function priceModelFor(model: string): string {
  return ALIAS_PRICE_MODELS[model] ?? model;
}

/**
 * Codex CLI (ChatGPT subscription) defaults. Model availability depends on
 * the signed-in account and CLI version, so AUTO omits `-m` entirely and lets
 * Codex/ChatGPT choose; "premium" is only used when explicitly configured to
 * a distinct, stronger model — never assumed.
 */
export const CODEX_MODEL_DEFAULTS: ProviderModelConfig = {
  standardModel: "auto",
  premiumModel: "auto",
  standardEffort: "medium",
  premiumEffort: "high",
};

export function codexModelConfig(
  env: Record<string, string | undefined> = process.env,
): ProviderModelConfig {
  return {
    standardModel: env.CODEX_DEFAULT_MODEL?.trim() || CODEX_MODEL_DEFAULTS.standardModel,
    premiumModel:
      env.CODEX_PREMIUM_MODEL?.trim() ||
      env.CODEX_DEFAULT_MODEL?.trim() ||
      CODEX_MODEL_DEFAULTS.premiumModel,
    standardEffort: effortOr(
      env.CODEX_DEFAULT_REASONING?.trim(),
      CODEX_MODEL_DEFAULTS.standardEffort,
    ),
    premiumEffort: effortOr(
      env.CODEX_PREMIUM_REASONING?.trim(),
      CODEX_MODEL_DEFAULTS.premiumEffort,
    ),
  };
}

const LABELS: Record<string, string> = {
  sonnet: "Claude Sonnet",
  opus: "Claude Opus",
  "claude-sonnet-5": "Claude Sonnet 5",
  "claude-opus-5-5": "Claude Opus 5.5",
  "local-deterministic": "Local deterministic",
  auto: "Auto (Codex default)",
};

export function modelLabel(model: string): string {
  if (LABELS[model]) return LABELS[model];
  if (model.startsWith("mock-")) return `${modelLabel(model.slice(5))} (mock)`;
  return model;
}
