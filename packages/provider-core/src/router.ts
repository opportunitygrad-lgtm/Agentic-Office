import {
  TRANSPORT_LABELS,
  type AgentCapability,
  type BillingMode,
  type EffortLevel,
  type ModelTier,
  type ProviderTransport,
  type ProviderType,
  type RouteDecisionDTO,
} from "@aibos/shared";
import { modelLabel, priceModelFor, type ProviderModelConfig } from "./models";
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
  /** Resolved by configuration (CLAUDE_TRANSPORT); the router never switches transport. */
  transport: ProviderTransport;
  billingMode: BillingMode;
  /** Why the provider cannot run now (e.g. "Claude Code login required"). */
  unavailableReason?: string | null;
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
  /**
   * Explicit provider choice for this run (e.g. "run with OpenAI instead"),
   * still bound by company policy and availability — never a bypass. Ignored
   * when the task has a hard `providerRequirement`, which always wins.
   */
  requestedProvider?: ProviderType | null;
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
  transport: "none",
  billingMode: "none",
  apiEquivalentUsd: null,
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
  const why = (p: ProviderType) => info(p)?.unavailableReason ?? `${p} is not connected`;

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
      transport: "local",
      billingMode: "none",
      apiEquivalentUsd: null,
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
        `PROVIDER_NOT_CONFIGURED: task requires ${requirement} — ${why(requirement)}`,
        reasons,
      );
    provider = requirement;
    reasons.push(`Task requires ${requirement}`);
  } else if (input.requestedProvider) {
    // 2b. Explicit person choice for this run — still policy-bound, never a bypass.
    const rp = input.requestedProvider;
    if (!allowed.has(rp))
      return blocked(`${rp} is not permitted by company policy for this run`, reasons);
    if (!usable(rp))
      return blocked(`PROVIDER_NOT_CONFIGURED: ${why(rp)}`, reasons);
    provider = rp;
    reasons.push(`${rp}: explicitly selected for this run`);
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
      reasons.push(`${first.p} (${first.why}): ${why(first.p)}`);
      // 8. Fallback only when policy explicitly permits it.
      const fb = input.agent.fallbackProvider;
      if (input.company.fallbackAllowed && fb && usable(fb)) {
        provider = fb;
        reasons.push(`${fb}: approved fallback (company policy permits fallback)`);
      } else {
        return blocked(
          `PROVIDER_NOT_CONFIGURED: ${why(first.p)}${input.company.fallbackAllowed ? " and no usable fallback" : "; fallback not permitted by company policy"}`,
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
  const transport = info(provider)?.transport ?? "none";
  const billingMode = info(provider)?.billingMode ?? "api";
  // API billing needs a price to control cost. Subscription runs are governed by
  // operational limits; their price only feeds the NOT BILLED API-equivalent estimate.
  const price = input.price(
    provider,
    billingMode === "subscription" ? priceModelFor(model) : model,
  );
  if (!price && billingMode === "api")
    return blocked(`No price configured for ${model} — cost cannot be controlled`, reasons, {
      provider,
    });
  const est = estimateCost(price, { provider, model, ...input.estimate });
  reasons.push(`${modelLabel(model)} at ${effort} effort`);
  if (billingMode === "subscription")
    reasons.push(
      `${provider} subscription via ${TRANSPORT_LABELS[transport]} — included usage, no API billing`,
    );
  return {
    provider,
    model,
    modelLabel: modelLabel(model),
    effort,
    tier,
    reasons,
    estimatedInputTokens: est.inputTokens,
    estimatedOutputTokens: est.outputTokens,
    estimatedCostUsd: billingMode === "subscription" ? 0 : est.costUsd,
    fallbackProvider: fallback,
    approvalRequired: false,
    blockedReason: null,
    isMock: !!info(provider)?.isMock,
    transport,
    billingMode,
    apiEquivalentUsd: billingMode === "subscription" && price ? est.costUsd : null,
  };
}
