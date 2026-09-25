import type {
  AgentCapability,
  EffortLevel,
  ModelTier,
  ProviderType,
  RouteDecisionDTO,
} from "@aibos/shared";
import { modelLabel, type ProviderModelConfig } from "./models";
import { estimateCost } from "./pricing";
import type { ModelPrice } from "./types";

const EFFORT_RANK: Record<EffortLevel, number> = { low: 0, medium: 1, high: 2, xhigh: 3, max: 4 };

/** Capabilities that deterministic local logic can satisfy without any model. */
export const LOCAL_ONLY_CAPABILITIES: readonly AgentCapability[] = [
  "data.update",
  "analytics.calculate",
];

export interface ProviderAvailability {
  provider: ProviderType;
  available: boolean;
  isMock: boolean;
  /** Supports reasoning-only execution. */
  reasoning: boolean;
}

export interface RouteInput {
  company: {
    allowedProviders: ProviderType[];
    preferredProvider: ProviderType | null;
    defaultModelTier: ModelTier;
    premiumAllowed: boolean;
    fallbackAllowed: boolean;
  };
  agent: {
    primaryProvider: ProviderType;
    fallbackProvider: ProviderType | null;
    preferredModelTier: ModelTier;
    defaultEffort: EffortLevel | null;
  };
  task: {
    /** Explicit provider requirement (no substitution). */
    providerRequirement: ProviderType | null;
    modelTier: ModelTier | null;
    /** Deterministic AUTO signal: premium only for explicitly high-complexity work. */
    highComplexity: boolean;
    requiredCapabilities: readonly AgentCapability[];
  } | null;
  /** Run-level override chosen by a person (still bound by company policy). */
  requestedTier?: ModelTier | null;
  providers: ProviderAvailability[];
  models: Partial<Record<ProviderType, ProviderModelConfig>>;
  price: (provider: ProviderType, model: string) => ModelPrice | null;
  estimate: { inputTokens: number; maxOutputTokens: number };
}

const blocked = (
  reason: string,
  reasons: string[],
  extra: Partial<RouteDecisionDTO> = {},
): RouteDecisionDTO => ({
  provider: null,
  model: null,
  modelLabel: null,
  effort: null,
  tier: null,
  reasons: [...reasons, reason],
  estimatedInputTokens: 0,
  estimatedOutputTokens: 0,
  estimatedCostUsd: 0,
  fallbackProvider: null,
  approvalRequired: false,
  blockedReason: reason,
  isMock: false,
  ...extra,
});

/**
 * Deterministic provider/model/effort selection. No AI participates, and the
 * model never chooses or upgrades its own model. Priority:
 * 1 LOCAL when no AI is needed · 2 explicit task requirement · 3 agent
 * primary · 4 company preferred · 5 capability · 6 availability · 7 tier ·
 * 8 approved fallback. Budget is evaluated separately on the returned estimate.
 */
export function routeExecution(input: RouteInput): RouteDecisionDTO {
  const reasons: string[] = [];
  const allowed = new Set(input.company.allowedProviders);
  const info = (p: ProviderType) => input.providers.find((x) => x.provider === p);
  const usable = (p: ProviderType) =>
    allowed.has(p) && !!info(p)?.available && !!info(p)?.reasoning;

  // 1. Deterministic local work.
  const caps = input.task?.requiredCapabilities ?? [];
  if (caps.length > 0 && caps.every((c) => LOCAL_ONLY_CAPABILITIES.includes(c))) {
    return {
      provider: "LOCAL",
      model: "local-deterministic",
      modelLabel: modelLabel("local-deterministic"),
      effort: null,
      tier: "standard",
      reasons: ["No AI needed: every required capability is deterministic local logic"],
      estimatedInputTokens: 0,
      estimatedOutputTokens: 0,
      estimatedCostUsd: 0,
      fallbackProvider: null,
      approvalRequired: false,
      blockedReason: null,
      isMock: false,
    };
  }

  // 2–4. Candidate provider.
  let provider: ProviderType | null;
  let fallback: ProviderType | null = null;
  const requirement = input.task?.providerRequirement ?? null;
  if (requirement) {
    if (!allowed.has(requirement))
      return blocked(`Task requires ${requirement}, which company policy does not allow`, reasons);
    if (!usable(requirement))
      return blocked(
        `PROVIDER_NOT_CONFIGURED: task requires ${requirement}, which is not connected`,
        reasons,
      );
    provider = requirement;
    reasons.push(`Task requires ${requirement}`);
  } else {
    const preferred = [
      { p: input.agent.primaryProvider, why: "agent primary provider" },
      { p: input.company.preferredProvider, why: "company preferred provider" },
    ].filter((x): x is { p: ProviderType; why: string } => !!x.p && allowed.has(x.p));
    const first = preferred[0];
    if (!first) return blocked("No provider permitted by company policy for this agent", reasons);
    if (usable(first.p)) {
      provider = first.p;
      reasons.push(`${first.p}: ${first.why}`);
    } else {
      reasons.push(`${first.p} (${first.why}) is not connected`);
      // 8. Fallback only when policy explicitly permits it.
      const fb = input.agent.fallbackProvider;
      if (input.company.fallbackAllowed && fb && usable(fb)) {
        provider = fb;
        reasons.push(`${fb}: approved fallback (company policy permits fallback)`);
      } else {
        return blocked(
          `PROVIDER_NOT_CONFIGURED: ${first.p} is not connected${input.company.fallbackAllowed ? " and no usable fallback" : "; fallback not permitted by company policy"}`,
          reasons,
        );
      }
    }
    const fb = input.agent.fallbackProvider;
    fallback = input.company.fallbackAllowed && fb && fb !== provider && usable(fb) ? fb : null;
  }

  // 7. Model tier (AUTO is deterministic).
  const requested =
    input.requestedTier ??
    input.task?.modelTier ??
    input.agent.preferredModelTier ??
    input.company.defaultModelTier;
  let tier: "standard" | "premium" = "standard";
  if (requested === "premium") {
    if (!input.company.premiumAllowed)
      return blocked("Premium model not permitted by company policy", reasons, { provider });
    tier = "premium";
    reasons.push("Premium tier explicitly selected");
  } else if (requested === "auto") {
    if (input.task?.highComplexity && input.company.premiumAllowed) {
      tier = "premium";
      reasons.push("AUTO: high-complexity task and premium permitted → premium");
    } else reasons.push("AUTO: normal complexity → standard");
  } else reasons.push("Standard tier");

  const models = input.models[provider];
  if (!models) return blocked(`No model configuration for ${provider}`, reasons, { provider });
  const model = tier === "premium" ? models.premiumModel : models.standardModel;
  // An agent may lower effort for its work but never raise it above the tier's
  // configured effort (no hidden cost escalation).
  const tierEffort = tier === "premium" ? models.premiumEffort : models.standardEffort;
  const agentEffort = input.agent.defaultEffort;
  const effort =
    agentEffort && EFFORT_RANK[agentEffort] < EFFORT_RANK[tierEffort] ? agentEffort : tierEffort;
  const price = input.price(provider, model);
  if (!price)
    return blocked(`No price configured for ${model} — cost cannot be controlled`, reasons, {
      provider,
    });
  const est = estimateCost(price, { provider, model, ...input.estimate });
  reasons.push(`${modelLabel(model)} at ${effort} effort`);
  return {
    provider,
    model,
    modelLabel: modelLabel(model),
    effort,
    tier,
    reasons,
    estimatedInputTokens: est.inputTokens,
    estimatedOutputTokens: est.outputTokens,
    estimatedCostUsd: est.costUsd,
    fallbackProvider: fallback,
    approvalRequired: false,
    blockedReason: null,
    isMock: !!info(provider)?.isMock,
  };
}
