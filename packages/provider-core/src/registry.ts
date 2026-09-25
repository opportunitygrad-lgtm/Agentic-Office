import type { ProviderType } from "@aibos/shared";
import { ClaudeProvider, claudeCredentialsFromEnv } from "./claude";
import { MockClaudeProvider, type MockClaudeOptions } from "./mock-claude";
import { claudeModelConfig, type ProviderModelConfig } from "./models";
import { LocalProvider, NotConnectedProvider } from "./placeholders";
import type { AIProvider } from "./types";

export type ProviderMode = "live" | "mock";

export class ProviderRegistry {
  private readonly providers = new Map<ProviderType, AIProvider>();
  constructor(
    list: AIProvider[],
    readonly models: Partial<Record<ProviderType, ProviderModelConfig>>,
    readonly mode: ProviderMode,
  ) {
    for (const p of list) this.providers.set(p.providerId, p);
  }
  get(type: ProviderType): AIProvider {
    const p = this.providers.get(type);
    if (!p) throw new Error(`Provider ${type} is not registered`);
    return p;
  }
  list(): AIProvider[] {
    return [...this.providers.values()];
  }
}

/**
 * Mode comes from AIBOS_AI_PROVIDER_MODE ("live" default). "mock" swaps Claude
 * for the deterministic MockClaudeProvider (tests, E2E, credit-free local
 * development) and is refused in production.
 */
export function providerModeFromEnv(
  env: Record<string, string | undefined> = process.env,
): ProviderMode {
  const mode = env.AIBOS_AI_PROVIDER_MODE?.trim() === "mock" ? "mock" : "live";
  if (mode === "mock" && env.NODE_ENV === "production")
    throw new Error("AIBOS_AI_PROVIDER_MODE=mock is not allowed in production");
  return mode;
}

export function createProviderRegistry(
  opts: {
    env?: Record<string, string | undefined>;
    mode?: ProviderMode;
    mock?: MockClaudeOptions;
  } = {},
): ProviderRegistry {
  const env = opts.env ?? process.env;
  const mode = opts.mode ?? providerModeFromEnv(env);
  const claudeModels = claudeModelConfig(env);
  const mockDelay = Number(env.AIBOS_MOCK_CHUNK_DELAY_MS ?? 0);
  const claude =
    mode === "mock"
      ? new MockClaudeProvider(
          claudeModels,
          opts.mock ?? { chunkDelayMs: Number.isFinite(mockDelay) ? Math.min(mockDelay, 1000) : 0 },
        )
      : new ClaudeProvider(claudeCredentialsFromEnv(env), claudeModels);
  return new ProviderRegistry(
    [
      claude,
      new NotConnectedProvider("OPENAI"),
      new NotConnectedProvider("GROK"),
      new LocalProvider(),
    ],
    { CLAUDE: claudeModels },
    mode,
  );
}
