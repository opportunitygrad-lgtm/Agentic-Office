import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EffortLevel, ProviderCapability, ProviderErrorCode } from "@aibos/shared";
import { estimateCost } from "./pricing";
import type { ProviderModelConfig } from "./models";
import {
  Semaphore,
  activeChildrenFor,
  killAllChildrenFor,
  runCommand,
  terminate,
  trackChild,
} from "./subprocess";
import { parseJsonOutput } from "./text-output";
import {
  ProviderError,
  type AIProvider,
  type CliInfo,
  type CostEstimate,
  type ModelPrice,
  type ProviderHealthResult,
  type ProviderRequest,
  type ProviderResult,
  type ProviderUsage,
  type StreamHandlers,
} from "./types";

/**
 * OpenAI through the owner's local, ChatGPT-subscription-authenticated Codex
 * CLI (the default OpenAI transport).
 *
 * The Business OS never implements ChatGPT login, never reads Codex
 * credential files directly and never handles OAuth tokens: the only
 * interface is executing the official `codex` binary and reading its own
 * `doctor --json` / `--version` output. Codex is used as a model transport
 * only for reasoning: a fresh, isolated, read-only-sandboxed workspace per
 * run, no persisted session, no MCP servers, shell/browser/computer-use
 * disabled. Our Context Engine and Instruction Compiler supply everything it
 * sees; Codex is never given the AI Business OS repository or the host's
 * files.
 */

export interface CodexConfig {
  /** Executable name or absolute path (CODEX_BINARY, default "codex"). */
  binary: string;
  models: ProviderModelConfig;
  /** Concurrent Codex runs (CODEX_MAX_CONCURRENCY, default 1). */
  maxConcurrency: number;
  /** The worker's environment; the child gets a sanitised copy, never this object. */
  parentEnv: Record<string, string | undefined>;
  /** Timeout for local CLI checks (`--version`, `doctor --json`). */
  checkTimeoutMs?: number;
}

export function codexConfigFromEnv(
  env: Record<string, string | undefined>,
  models: ProviderModelConfig,
): CodexConfig {
  const n = Number(env.CODEX_MAX_CONCURRENCY ?? 1);
  return {
    binary: env.CODEX_BINARY?.trim() || "codex",
    models,
    maxConcurrency: Number.isInteger(n) && n >= 1 ? Math.min(n, 4) : 1,
    parentEnv: env,
  };
}

/**
 * Environment variables a Codex child may inherit. An allowlist (not a
 * denylist): any OpenAI/Codex/Azure API credential or endpoint override, or
 * one of our own application secrets (DATABASE_URL, SESSION_SECRET, …), never
 * reaches the child — an API key would silently switch Codex off the ChatGPT
 * subscription and onto dollar-billed API usage.
 */
const CHILD_ENV_ALLOWLIST = [
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TZ",
  "TMPDIR",
  "TMP",
  "TEMP",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "XDG_CACHE_HOME",
  "XDG_STATE_HOME",
  "XDG_RUNTIME_DIR",
  // Official Codex config/auth location override (Codex reads it itself).
  "CODEX_HOME",
  // Network configuration (corporate proxies / CA bundles).
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "no_proxy",
  "NODE_EXTRA_CA_CERTS",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  // Windows essentials.
  "SYSTEMROOT",
  "APPDATA",
  "LOCALAPPDATA",
  "USERPROFILE",
] as const;

export function codexChildEnv(parent: Record<string, string | undefined>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of CHILD_ENV_ALLOWLIST) {
    const v = parent[key];
    if (typeof v === "string" && v !== "") env[key] = v;
  }
  return env;
}

/** Flags without which isolation cannot be guaranteed. Checked against `codex exec --help`. */
const REQUIRED_FLAGS = [
  "--json",
  "--skip-git-repo-check",
  "--ephemeral",
  "--ignore-user-config",
  "--ignore-rules",
  "--strict-config",
  "--sandbox",
  "--cd",
  "--disable",
  "--output-schema",
  "--config",
] as const;

/** Tool/browser/computer-use features disabled for a reasoning-only run. */
const DISABLED_FEATURES = [
  "shell_tool",
  "unified_exec",
  "browser_use",
  "browser_use_external",
  "computer_use",
  "in_app_browser",
  "apps",
] as const;

const EFFORTS: readonly EffortLevel[] = ["low", "medium", "high", "xhigh", "max"];
/** Codex's `model_reasoning_effort` accepts low/medium/high only. */
const CODEX_EFFORTS = new Set(["low", "medium", "high"]);
function codexEffort(effort: EffortLevel | null): string | null {
  if (!effort) return null;
  if (CODEX_EFFORTS.has(effort)) return effort;
  return "high"; // xhigh/max clamp down: Codex has no higher tier.
}

/** Model aliases/IDs only; must start alphanumeric so it can never be read as a CLI flag. */
const MODEL_ARG = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const MAX_STDOUT_BYTES = 8 * 1024 * 1024;
const MAX_STDERR_BYTES = 8 * 1024;

export const CODEX_SETUP_STEPS = [
  "Install or update the official Codex CLI if necessary.",
  "Open Terminal.",
  "Run: codex",
  "Sign in with ChatGPT.",
  "Return here and click TEST CODEX CONNECTION.",
] as const;

/** For graceful worker shutdown: stop every running Codex child. */
export function killAllCodexChildren(): number {
  return killAllChildrenFor("OPENAI");
}
export function activeCodexChildren(): number {
  return activeChildrenFor("OPENAI");
}

/**
 * Turns the prepared provider-neutral request into one Codex prompt. Codex
 * `exec` has no separate system-instructions channel, so the authority
 * (system) blocks are placed first, clearly labelled, ahead of the
 * already-fenced data blocks the execution core built.
 */
export function codexInputs(request: ProviderRequest): string {
  const system = request.system.map((b) => b.text).join("\n\n");
  const structured =
    request.output.kind === "structured"
      ? `\n\n## Output format\nRespond with ONLY one JSON object (no prose, no code fence, no markdown) that validates against the provided JSON Schema.`
      : "";
  const messages = request.messages.map((m) => `<${m.role}_turn>\n${m.content}\n</${m.role}_turn>`).join("\n\n");
  return [
    '<system_instructions trust="authority">',
    system + structured,
    "</system_instructions>",
    "",
    messages,
  ].join("\n");
}

/** Best-effort classification of Codex's free-text turn/thread error messages
 * (the CLI's JSON stream carries no structured error code — see AI_EXECUTION.md). */
function classifyCodexError(message: string): { code: ProviderErrorCode; retryable: boolean } {
  const m = message.toLowerCase();
  if (/usage limit|quota exceeded|plan limit|weekly limit|monthly limit/.test(m))
    return { code: "SUBSCRIPTION_LIMIT_REACHED", retryable: false };
  if (/rate limit|too many requests|\b429\b/.test(m)) return { code: "RATE_LIMITED", retryable: true };
  if (/overloaded|high demand|at capacity|\b529\b/.test(m)) return { code: "OVERLOADED", retryable: true };
  if (/not (logged in|authenticated)|unauthoriz|\b401\b|please (log|sign) in/.test(m))
    return { code: "LOGIN_EXPIRED", retryable: false };
  if (/model .*(not found|not available|unavailable|unknown|unsupported)/.test(m))
    return { code: "MODEL_UNAVAILABLE", retryable: false };
  if (/\b5\d\d\b|internal (server )?error|server error/.test(m))
    return { code: "SERVER_ERROR", retryable: true };
  if (/context window|too long|token limit/.test(m)) return { code: "INVALID_REQUEST", retryable: false };
  return { code: "UNKNOWN", retryable: false };
}

interface DoctorCheck {
  status: "ok" | "warning" | "fail" | string;
  summary: string;
  details?: Record<string, unknown>;
}
interface CliCapabilities {
  installed: boolean;
  version: string | null;
  flags: Set<string>;
  missing: string[];
}

export class CodexCliProvider implements AIProvider {
  readonly providerId = "OPENAI" as const;
  readonly displayName = "Codex";
  readonly isMock = false;
  readonly transport = "codex_cli" as const;
  readonly authMode = "subscription_login" as const;
  readonly billingMode = "subscription" as const;
  private readonly inflight = new Map<string, AbortController>();
  private readonly semaphore: Semaphore;
  private caps: { at: number; value: CliCapabilities } | null = null;
  private knownUnusable: string | null = null;

  constructor(readonly config: CodexConfig) {
    this.semaphore = new Semaphore(config.maxConcurrency, "OPENAI");
  }

  get maxConcurrency() {
    return this.config.maxConcurrency;
  }
  get inUse() {
    return this.semaphore.inUse;
  }

  private childEnv() {
    return codexChildEnv(this.config.parentEnv);
  }

  available(): boolean {
    return this.knownUnusable === null;
  }
  capabilities(): ProviderCapability[] {
    return ["reasoning", "coding", "document_analysis", "email_drafting"];
  }
  supportedModels(): string[] {
    return [this.config.models.standardModel, this.config.models.premiumModel];
  }
  estimate(
    input: { model: string; inputTokens: number; maxOutputTokens: number },
    price: ModelPrice | null,
  ): CostEstimate {
    return estimateCost(price, { provider: "OPENAI", ...input });
  }

  /** `codex --version` + `codex exec --help`: installed? which flags does this version support? */
  async cliCapabilities(force = false): Promise<CliCapabilities> {
    if (!force && this.caps && Date.now() - this.caps.at < 5 * 60_000) return this.caps.value;
    const env = this.childEnv();
    const timeout = this.config.checkTimeoutMs ?? 15_000;
    const version = await runCommand("OPENAI", this.config.binary, ["--version"], env, timeout);
    if (version.missing || version.code !== 0) {
      const value = { installed: false, version: null, flags: new Set<string>(), missing: [] };
      this.caps = { at: Date.now(), value };
      return value;
    }
    const help = await runCommand("OPENAI", this.config.binary, ["exec", "--help"], env, timeout);
    const flags = new Set(help.stdout.match(/--[a-z][a-z-]+/g) ?? []);
    const value = {
      installed: true,
      version: /\d+\.\d+\.\d+/.exec(version.stdout)?.[0] ?? (version.stdout.trim() || null),
      flags,
      missing: REQUIRED_FLAGS.filter((f) => !flags.has(f)),
    };
    this.caps = { at: Date.now(), value };
    return value;
  }

  /**
   * `codex doctor --json` — a redacted, local machine-readable report; never
   * a model call, never subscription usage. Auth state comes from its
   * `auth.credentials` check only (never read directly from disk).
   */
  async doctor(): Promise<{ cli: CliInfo; check: DoctorCheck | null }> {
    const r = await runCommand(
      "OPENAI",
      this.config.binary,
      ["doctor", "--json"],
      this.childEnv(),
      this.config.checkTimeoutMs ?? 15_000,
    );
    const cli: CliInfo = {
      binary: this.config.binary,
      version: this.caps?.value.version ?? null,
      loggedIn: null,
      authMethod: null,
      apiProvider: null,
      subscriptionType: null,
    };
    let check: DoctorCheck | null = null;
    try {
      const report = JSON.parse(r.stdout) as { checks?: Record<string, DoctorCheck> };
      check = report.checks?.["auth.credentials"] ?? null;
      if (check) {
        const d = check.details ?? {};
        const mode = typeof d["stored auth mode"] === "string" ? (d["stored auth mode"] as string) : null;
        const envVars = typeof d["auth env vars present"] === "string" ? (d["auth env vars present"] as string) : null;
        cli.loggedIn = check.status === "ok";
        cli.authMethod = envVars ? "api_key" : (mode ?? (check.status === "ok" ? "chatgpt" : null));
      }
    } catch {
      // Unparseable → unknown; treated as a health failure below.
    }
    return { cli, check };
  }

  /** Local checks only (no model call, no subscription usage). */
  async healthCheck(): Promise<ProviderHealthResult> {
    const checkedAt = new Date();
    const caps = await this.cliCapabilities(true);
    const base = { provider: "OPENAI" as const, checkedAt };
    if (!caps.installed) {
      this.knownUnusable = "not_installed";
      return {
        ...base,
        state: "not_installed",
        detail: `Codex CLI not found (${this.config.binary}). Install it, then run: codex`,
        cli: null,
      };
    }
    if (caps.missing.length) {
      this.knownUnusable = "misconfigured";
      return {
        ...base,
        state: "misconfigured",
        detail: `Codex ${caps.version ?? ""} lacks required options (${caps.missing.join(", ")}). Run: codex update`,
        cli: null,
      };
    }
    const { cli, check } = await this.doctor();
    const problem = this.authProblem(check, cli);
    if (problem) {
      this.knownUnusable = problem.state;
      return { ...base, ...problem, cli };
    }
    this.knownUnusable = null;
    return {
      ...base,
      state: "available",
      detail: `Codex ${caps.version ?? ""} signed in with a ChatGPT subscription`,
      cli,
    };
  }

  private authProblem(
    check: DoctorCheck | null,
    cli: CliInfo,
  ): { state: "login_required" | "misconfigured"; detail: string } | null {
    if (!check || check.status !== "ok") {
      if (check?.summary?.toLowerCase().includes("no codex credentials"))
        return { state: "login_required", detail: "Login required. Open Terminal and run: codex" };
      return {
        state: "misconfigured",
        detail: check?.summary
          ? `Codex authentication problem: ${check.summary}. Run: codex`
          : "Codex authentication could not be checked. Run: codex",
      };
    }
    if (cli.authMethod === "api_key")
      return {
        state: "misconfigured",
        detail:
          "Codex is signed in with an API key, not a ChatGPT subscription. Run: codex logout, then codex and sign in with ChatGPT.",
      };
    return null;
  }

  execute(request: ProviderRequest): Promise<ProviderResult> {
    return this.stream(request, {});
  }

  async stream(request: ProviderRequest, handlers: StreamHandlers): Promise<ProviderResult> {
    if (!MODEL_ARG.test(request.model) && request.model !== "auto")
      throw new ProviderError("INVALID_REQUEST", "Invalid model alias", { provider: "OPENAI" });
    if (request.effort && !EFFORTS.includes(request.effort))
      throw new ProviderError("INVALID_REQUEST", "Invalid effort", { provider: "OPENAI" });

    const controller = new AbortController();
    const onAbort = () => controller.abort();
    request.signal?.addEventListener("abort", onAbort, { once: true });
    if (request.signal?.aborted) controller.abort();
    this.inflight.set(request.runId, controller);
    let release: (() => void) | null = null;
    let workdir: string | null = null;
    try {
      // Queue behind other Codex runs (CODEX_MAX_CONCURRENCY).
      release = await this.semaphore.acquire(controller.signal);
      const caps = await this.cliCapabilities();
      if (!caps.installed)
        throw new ProviderError("NOT_INSTALLED", "Codex CLI is not installed on this machine. Install it, then run: codex", {
          provider: "OPENAI",
        });
      if (caps.missing.length)
        throw new ProviderError(
          "MISCONFIGURED",
          `Codex lacks required options (${caps.missing.join(", ")}). Run: codex update`,
          { provider: "OPENAI" },
        );
      // Codex's exec JSON stream carries no per-turn auth-mode signal (unlike
      // Claude Code's system.init.apiKeySource), so the subscription-vs-API-key
      // check happens here, once per run, via the same local `doctor --json`
      // used for Test Connection — never a model call, never subscription usage.
      const { cli, check } = await this.doctor();
      const authIssue = this.authProblem(check, cli);
      if (authIssue)
        throw new ProviderError(
          authIssue.state === "login_required" ? "LOGIN_REQUIRED" : "MISCONFIGURED",
          authIssue.detail,
          { provider: "OPENAI" },
        );
      // A fresh, empty, isolated workspace per run: Codex never sees this
      // repository, the host's documents or anything unrelated to this task.
      workdir = await mkdtemp(join(tmpdir(), "aibos-codex-"));
      const prompt = codexInputs(request);
      const args = [
        "exec",
        "--json",
        "--skip-git-repo-check",
        "--ephemeral",
        "--ignore-user-config",
        "--ignore-rules",
        "--strict-config",
        "--sandbox",
        "read-only",
        "--cd",
        workdir,
        ...(request.model !== "auto" ? ["--model", request.model] : []),
        ...(codexEffort(request.effort)
          ? ["--config", `model_reasoning_effort=${codexEffort(request.effort)}`]
          : []),
        ...DISABLED_FEATURES.flatMap((f) => ["--disable", f]),
      ];
      if (request.output.kind === "structured") {
        const schemaFile = join(workdir, "schema.json");
        await writeFile(schemaFile, JSON.stringify(request.output.schema), { mode: 0o600 });
        args.push("--output-schema", schemaFile);
      }
      return await this.run(args, prompt, workdir, request, controller.signal, handlers);
    } catch (err) {
      // A run-time auth failure is "expired" while Codex still believes it is
      // signed in, and "required" once its own doctor check reports otherwise.
      if (err instanceof ProviderError && err.code === "LOGIN_EXPIRED") {
        const status = await this.doctor().catch(() => null);
        if (status && status.cli.loggedIn === false)
          throw this.normalizeError(
            new ProviderError("LOGIN_REQUIRED", "Login required. Run in Terminal: codex", {
              provider: "OPENAI",
            }),
          );
      }
      throw this.normalizeError(err);
    } finally {
      release?.();
      request.signal?.removeEventListener("abort", onAbort);
      this.inflight.delete(request.runId);
      if (workdir) await rm(workdir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private run(
    args: string[],
    prompt: string,
    cwd: string,
    request: ProviderRequest,
    signal: AbortSignal,
    handlers: StreamHandlers,
  ): Promise<ProviderResult> {
    const started = Date.now();
    return new Promise<ProviderResult>((resolve, reject) => {
      if (signal.aborted)
        return reject(new ProviderError("CANCELLED", "Request cancelled", { provider: "OPENAI" }));
      // spawn with an argument array and shell:false — task/company/user text is
      // only ever written to stdin, so it can never become shell syntax.
      const child = spawn(this.config.binary, args, {
        cwd,
        env: this.childEnv(),
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
      });
      trackChild(child, "OPENAI");

      let settled = false;
      let failure: ProviderError | null = null;
      let buffered = "";
      let stdoutBytes = 0;
      let stderr = "";
      let startedStreaming = false;
      let threadId: string | null = null;
      // Text seen so far per agent_message item id, to compute streamed deltas.
      const agentMessages = new Map<string, string>();
      const agentMessageOrder: string[] = [];
      let lastThreadError: string | null = null;
      let turnFailedMessage: string | null = null;
      let usage: ProviderUsage = { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 };
      let completed = false;

      const fail = (err: ProviderError) => {
        if (!failure) failure = err;
        terminate(child, "SIGINT");
      };
      const timer = setTimeout(
        () => fail(new ProviderError("TIMEOUT", "Codex timed out", { provider: "OPENAI" })),
        request.timeoutMs,
      );
      // SIGINT asks Codex to interrupt the turn gracefully; SIGKILL follows
      // after a grace period if it does not exit (see subprocess.ts).
      const onAbort = () =>
        fail(new ProviderError("CANCELLED", "Request cancelled", { provider: "OPENAI" }));
      signal.addEventListener("abort", onAbort, { once: true });

      const start = () => {
        if (!startedStreaming) {
          startedStreaming = true;
          handlers.onStart?.();
        }
      };
      const emit = (delta: string) => {
        if (!delta) return;
        start();
        handlers.onText?.(delta);
      };

      const handleAgentMessage = (id: string, text: string) => {
        const prior = agentMessages.get(id) ?? "";
        if (!agentMessages.has(id)) agentMessageOrder.push(id);
        agentMessages.set(id, text);
        // Codex reports the item's cumulative current text; emit only the new suffix.
        if (text.startsWith(prior)) emit(text.slice(prior.length));
        else emit(text); // non-monotonic update (rare) — surface the whole thing once
      };

      const handle = (msg: Record<string, unknown>) => {
        const type = msg.type;
        if (type === "thread.started") {
          threadId = typeof msg.thread_id === "string" ? msg.thread_id : threadId;
          return;
        }
        if (type === "turn.started") return;
        if (type === "item.started" || type === "item.updated" || type === "item.completed") {
          const item = msg.item as Record<string, unknown> | undefined;
          if (!item) return;
          const kind = item.type;
          // Reasoning is never read, stored or streamed — only the final visible answer.
          if (kind === "reasoning") return;
          if (kind === "agent_message" && typeof item.id === "string" && typeof item.text === "string")
            handleAgentMessage(item.id, item.text);
          return;
        }
        if (type === "turn.completed") {
          completed = true;
          const u = (msg.usage ?? {}) as Record<string, unknown>;
          const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
          usage = {
            inputTokens: n(u.input_tokens),
            outputTokens: n(u.output_tokens),
            cacheCreationTokens: n(u.cache_write_input_tokens),
            cacheReadTokens: n(u.cached_input_tokens),
          };
          return;
        }
        if (type === "turn.failed") {
          const err = msg.error as Record<string, unknown> | undefined;
          turnFailedMessage = typeof err?.message === "string" ? err.message : "Codex turn failed";
          return;
        }
        if (type === "error") {
          // Codex emits non-fatal transient errors mid-turn (e.g. reconnect
          // retries) using the same shape as a fatal thread error — only
          // `turn.failed` or a process exit with no `turn.completed` means
          // the run actually failed (see AI_EXECUTION.md).
          lastThreadError = typeof msg.message === "string" ? msg.message : lastThreadError;
        }
      };

      child.stdout.on("data", (chunk: Buffer) => {
        stdoutBytes += chunk.length;
        if (stdoutBytes > MAX_STDOUT_BYTES)
          return fail(new ProviderError("OUTPUT_TRUNCATED", "Codex output exceeded the limit", { provider: "OPENAI" }));
        buffered += chunk.toString("utf8");
        let nl: number;
        while ((nl = buffered.indexOf("\n")) >= 0) {
          const line = buffered.slice(0, nl).trim();
          buffered = buffered.slice(nl + 1);
          if (!line) continue;
          try {
            handle(JSON.parse(line) as Record<string, unknown>);
          } catch {
            // Non-JSON lines are ignored (never echoed into results or logs).
          }
        }
      });
      child.stderr.on("data", (d: Buffer) => {
        if (stderr.length < MAX_STDERR_BYTES) stderr += d.toString("utf8");
      });
      child.stdin.on("error", () => undefined);
      child.stdin.end(prompt);

      const finish = (outcome: ProviderResult | ProviderError) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal.removeEventListener("abort", onAbort);
        if (outcome instanceof ProviderError) reject(outcome);
        else resolve(outcome);
      };

      child.once("error", (err: NodeJS.ErrnoException) =>
        finish(
          err.code === "ENOENT"
            ? new ProviderError("NOT_INSTALLED", "Codex CLI is not installed on this machine. Install it, then run: codex", {
                provider: "OPENAI",
              })
            : new ProviderError("UNKNOWN", "Could not start Codex", { provider: "OPENAI" }),
        ),
      );

      child.once("close", () => {
        if (failure) return finish(failure);
        if (!completed) {
          const message = turnFailedMessage ?? lastThreadError;
          if (message) {
            const { code, retryable } = classifyCodexError(message);
            return finish(new ProviderError(code, message, { provider: "OPENAI", retryable }));
          }
          if (/not (logged in|authenticated)/i.test(stderr))
            return finish(new ProviderError("LOGIN_REQUIRED", "Login required. Run in Terminal: codex", { provider: "OPENAI" }));
          return finish(new ProviderError("UNKNOWN", "Codex exited without completing the turn", { provider: "OPENAI" }));
        }
        const text = agentMessageOrder.map((id) => agentMessages.get(id) ?? "").join("");
        let structured: unknown = null;
        if (request.output.kind === "structured") {
          if (!text.trim())
            return finish(new ProviderError("OUTPUT_TRUNCATED", "Structured output was empty", { provider: "OPENAI" }));
          try {
            structured = parseJsonOutput(text);
          } catch {
            return finish(new ProviderError("INVALID_OUTPUT", "Structured output was not valid JSON", { provider: "OPENAI" }));
          }
        }
        finish({
          provider: "OPENAI",
          // Codex's exec JSON stream does not report the resolved model; the
          // configured alias/model is persisted instead (see AI_EXECUTION.md).
          model: request.model,
          text,
          structured,
          stopReason: "end_turn",
          requestId: threadId ? `codex:${threadId}` : null,
          usage,
          latencyMs: Date.now() - started,
        });
      });
    });
  }

  async cancel(runId: string): Promise<void> {
    this.inflight.get(runId)?.abort();
  }

  normalizeError(err: unknown): ProviderError {
    if (err instanceof ProviderError) {
      if (["NOT_INSTALLED", "LOGIN_REQUIRED", "LOGIN_EXPIRED", "MISCONFIGURED"].includes(err.code))
        this.knownUnusable = err.code.toLowerCase();
      return err;
    }
    return new ProviderError("UNKNOWN", "Unexpected Codex failure", { provider: "OPENAI" });
  }
}
