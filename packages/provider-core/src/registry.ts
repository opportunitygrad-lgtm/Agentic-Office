import type { ProviderType } from "@aibos/shared";
import { ClaudeProvider, claudeCredentialsFromEnv } from "./claude";
import { ClaudeCodeProvider, claudeCodeConfigFromEnv } from "./claude-code";
import { CodexCliProvider, codexConfigFromEnv } from "./codex";
import { MockClaudeProvider, type MockClaudeOptions } from "./mock-claude";
import { MockCodexProvider, type MockCodexOptions } from "./mock-codex";
import {
  claudeCodeModelConfig,
  claudeModelConfig,
  codexModelConfig,
  type ProviderModelConfig,
} from "./models";
import { LocalProvider, NotConnectedProvider } from "./placeholders";
import type { AIProvider } from "./types";

export type ProviderMode = "live" | "mock";
export type ClaudeTransportSetting = "claude_code" | "anthropic_api";
export type OpenaiTransportSetting = "codex_cli" | "openai_api";

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

/**
 * OPENAI_TRANSPORT selects how the logical OPENAI provider is reached:
 * "codex_cli" (default) — the owner's ChatGPT-subscription-authenticated
 * local Codex CLI; "openai_api" is reserved for a future, deliberately
 * configured API-key transport (not implemented in this stage — selecting it
 * registers OPENAI as not connected rather than silently using an API key).
 * There is never a runtime fallback from the subscription to API billing.
 */
export function openaiTransportFromEnv(
  env: Record<string, string | undefined> = process.env,
): OpenaiTransportSetting {
  const v = env.OPENAI_TRANSPORT?.trim() || "codex_cli";
  if (v !== "codex_cli" && v !== "openai_api")
    throw new Error(`OPENAI_TRANSPORT must be "codex_cli" or "openai_api" (got "${v}")`);
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
 * and OpenAI for their deterministic mock stand-ins (tests, E2E, credit-free
 * local development) and is refused in production.
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
    mockOpenai?: MockCodexOptions;
  } = {},
): ProviderRegistry {
  const env = opts.env ?? process.env;
  const mode = opts.mode ?? providerModeFromEnv(env);
  const claudeTransport = claudeTransportFromEnv(env);
  const openaiTransport = openaiTransportFromEnv(env);
  const claudeModels =
    claudeTransport === "claude_code" ? claudeCodeModelConfig(env) : claudeModelConfig(env);
  const openaiModels = codexModelConfig(env);
  const mockDelay = Number(env.AIBOS_MOCK_CHUNK_DELAY_MS ?? 0);
  const claude =
    mode === "mock"
      ? new MockClaudeProvider(claudeModels, {
          transport: claudeTransport === "claude_code" ? "claude_code_cli" : "anthropic_api",
          ...(opts.mock ?? {
            chunkDelayMs: Number.isFinite(mockDelay) ? Math.min(mockDelay, 1000) : 0,
          }),
        })
      : claudeTransport === "claude_code"
        ? new ClaudeCodeProvider(claudeCodeConfigFromEnv(env, claudeModels))
        : new ClaudeProvider(claudeCredentialsFromEnv(env), claudeModels);
  const openai: AIProvider =
    openaiTransport === "openai_api"
      ? // Optional future transport — not implemented; never a silent API-key fallback.
        new NotConnectedProvider("OPENAI")
      : mode === "mock"
        ? new MockCodexProvider(openaiModels, {
            ...(opts.mockOpenai ?? {
              chunkDelayMs: Number.isFinite(mockDelay) ? Math.min(mockDelay, 1000) : 0,
            }),
          })
        : new CodexCliProvider(codexConfigFromEnv(env, openaiModels));
  return new ProviderRegistry(
    [claude, openai, new NotConnectedProvider("GROK"), new LocalProvider()],
    { CLAUDE: claudeModels, OPENAI: openaiModels },
    mode,
  );
}
