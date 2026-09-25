import type { ProviderType } from "@aibos/shared";
import { ClaudeProvider, claudeCredentialsFromEnv } from "./claude";
import { ClaudeCodeProvider, claudeCodeConfigFromEnv } from "./claude-code";
import { MockClaudeProvider, type MockClaudeOptions } from "./mock-claude";
import { claudeCodeModelConfig, claudeModelConfig, type ProviderModelConfig } from "./models";
import { LocalProvider, NotConnectedProvider } from "./placeholders";
import type { AIProvider } from "./types";

export type ProviderMode = "live" | "mock";
export type ClaudeTransportSetting = "claude_code" | "anthropic_api";

/**
 * CLAUDE_TRANSPORT selects how the logical CLAUDE provider is reached:
 * "claude_code" (default) — the owner's subscription-authenticated local Claude
 * Code; "anthropic_api" — optional API-key billing, only when set deliberately.
 * Exactly one transport is registered; there is never a runtime fallback
 * from the subscription to API billing.
 */
export function claudeTransportFromEnv(
  env: Record<string, string | undefined> = process.env,
): ClaudeTransportSetting {
  const v = env.CLAUDE_TRANSPORT?.trim() || "claude_code";
  if (v !== "claude_code" && v !== "anthropic_api")
    throw new Error(`CLAUDE_TRANSPORT must be "claude_code" or "anthropic_api" (got "${v}")`);
  return v;
}

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
  const transport = claudeTransportFromEnv(env);
  const claudeModels =
    transport === "claude_code" ? claudeCodeModelConfig(env) : claudeModelConfig(env);
  const mockDelay = Number(env.AIBOS_MOCK_CHUNK_DELAY_MS ?? 0);
  const claude =
    mode === "mock"
      ? new MockClaudeProvider(claudeModels, {
          transport: transport === "claude_code" ? "claude_code_cli" : "anthropic_api",
          ...(opts.mock ?? {
            chunkDelayMs: Number.isFinite(mockDelay) ? Math.min(mockDelay, 1000) : 0,
          }),
        })
      : transport === "claude_code"
        ? new ClaudeCodeProvider(claudeCodeConfigFromEnv(env, claudeModels))
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
