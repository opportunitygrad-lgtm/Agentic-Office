import type { ProviderCapability, ProviderType } from "@aibos/shared";
import type { AIProvider } from "./types";

export interface RouteRequest {
  capability: ProviderCapability;
  /** Explicit requirement (e.g. task.requiredProvider) — no fallback allowed. */
  required?: ProviderType;
  primary?: ProviderType;
  fallback?: ProviderType;
  /** Company default provider, used when the agent has no preference. */
  companyDefault?: ProviderType;
  unavailable?: ProviderType[];
}

export interface RouteDecision {
  provider: AIProvider | null;
  reason: string;
  considered: ProviderType[];
}

/**
 * Chooses a provider for a unit of work. Order: required → primary → fallback
 * → company default → any registered provider with the capability.
 * Stage 10 adds cost/latency scoring and budget awareness.
 */
export class ProviderRouter {
  private readonly providers = new Map<ProviderType, AIProvider>();

  constructor(providers: AIProvider[]) {
    for (const p of providers) this.providers.set(p.type, p);
  }

  get(type: ProviderType): AIProvider | undefined {
    return this.providers.get(type);
  }

  list(): AIProvider[] {
    return [...this.providers.values()];
  }

  select(req: RouteRequest): RouteDecision {
    const unavailable = new Set(req.unavailable ?? []);
    const usable = (t: ProviderType | undefined): t is ProviderType =>
      !!t && !unavailable.has(t) && !!this.providers.get(t)?.supportsCapability(req.capability);

    if (req.required) {
      return usable(req.required)
        ? {
            provider: this.providers.get(req.required)!,
            reason: "required provider",
            considered: [req.required],
          }
        : {
            provider: null,
            reason: `Required provider ${req.required} unavailable for ${req.capability}`,
            considered: [req.required],
          };
    }

    const ordered: ProviderType[] = [];
    for (const t of [req.primary, req.fallback, req.companyDefault, ...this.providers.keys()]) {
      if (t && !ordered.includes(t)) ordered.push(t);
    }
    const considered: ProviderType[] = [];
    for (const t of ordered) {
      considered.push(t);
      if (usable(t)) {
        const reason =
          t === req.primary
            ? "primary provider"
            : t === req.fallback
              ? "fallback provider"
              : t === req.companyDefault
                ? "company default"
                : "capability match";
        return { provider: this.providers.get(t)!, reason, considered };
      }
    }
    return { provider: null, reason: `No provider supports ${req.capability}`, considered };
  }
}
