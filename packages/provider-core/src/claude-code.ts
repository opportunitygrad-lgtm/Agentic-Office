import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EffortLevel, ProviderCapability } from "@aibos/shared";
import { estimateCost } from "./pricing";
import type { ProviderModelConfig } from "./models";
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
  type RateLimitState,
  type StreamHandlers,
} from "./types";

/**
 * Claude through the owner's local, subscription-authenticated Claude Code
 * installation (the default Claude transport).
 *
 * The Business OS never implements Claude login, never reads Claude
 * credential files or the keychain and never handles OAuth tokens: the only
 * interface is executing the official `claude` binary. Claude Code is used as
 * a model transport only — no tools, no MCP, no hooks, no session persistence;
 * our Context Engine and Instruction Compiler supply everything it sees.
 */

export interface ClaudeCodeConfig {
  /** Executable name or absolute path (CLAUDE_CODE_BINARY, default "claude"). */
  binary: string;
  models: ProviderModelConfig;
  /** Concurrent Claude Code runs (CLAUDE_CODE_MAX_CONCURRENCY, default 1). */
  maxConcurrency: number;
  /** Inherit ANTHROPIC_BASE_URL only when explicitly allowed (CLAUDE_CODE_ALLOW_BASE_URL=true). */
  allowBaseUrl: boolean;
  /** The worker's environment; the child gets a sanitised copy, never this object. */
  parentEnv: Record<string, string | undefined>;
  /** Timeout for local CLI checks (`--version`, `--help`, `auth status`). */
  checkTimeoutMs?: number;
}

export function claudeCodeConfigFromEnv(
  env: Record<string, string | undefined>,
  models: ProviderModelConfig,
): ClaudeCodeConfig {
  const n = Number(env.CLAUDE_CODE_MAX_CONCURRENCY ?? 1);
  return {
    binary: env.CLAUDE_CODE_BINARY?.trim() || "claude",
    models,
    maxConcurrency: Number.isInteger(n) && n >= 1 ? Math.min(n, 4) : 1,
    allowBaseUrl: env.CLAUDE_CODE_ALLOW_BASE_URL?.trim() === "true",
    parentEnv: env,
  };
}

/**
 * Environment variables a Claude Code child may inherit. An allowlist (not a
 * denylist): API credentials (ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN, which
 * would override the subscription login), OAuth token variables, third-party
 * provider switches, a custom ANTHROPIC_BASE_URL and our own secrets
 * (DATABASE_URL, SESSION_SECRET, …) never reach the child.
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
  // Official Claude Code config location override (Claude Code reads it itself).
  "CLAUDE_CONFIG_DIR",
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

export function subscriptionChildEnv(
  parent: Record<string, string | undefined>,
  opts: { allowBaseUrl: boolean; maxOutputTokens?: number },
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of CHILD_ENV_ALLOWLIST) {
    const v = parent[key];
    if (typeof v === "string" && v !== "") env[key] = v;
  }
  if (opts.allowBaseUrl && parent.ANTHROPIC_BASE_URL)
    env.ANTHROPIC_BASE_URL = parent.ANTHROPIC_BASE_URL;
  // No auto-update, telemetry or other non-essential traffic from a worker child.
  env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = "1";
  env.DISABLE_AUTOUPDATER = "1";
  if (opts.maxOutputTokens) env.CLAUDE_CODE_MAX_OUTPUT_TOKENS = String(opts.maxOutputTokens);
  return env;
}

/** Flags without which isolation cannot be guaranteed. */
const REQUIRED_FLAGS = [
  "--print",
  "--output-format",
  "--verbose",
  "--model",
  "--tools",
  "--system-prompt",
  "--no-session-persistence",
] as const;

/** `apiKeySource` values that mean subscription (claude.ai) login, not API billing. */
const SUBSCRIPTION_KEY_SOURCES = new Set(["none", "oauth"]);

/** Model aliases/IDs only; must start alphanumeric so it can never be read as a CLI flag. */
const MODEL_ARG = /^[A-Za-z0-9][A-Za-z0-9._[\]-]{0,63}$/;
const EFFORTS: readonly EffortLevel[] = ["low", "medium", "high", "xhigh", "max"];
const MAX_STDOUT_BYTES = 8 * 1024 * 1024;
const MAX_STDERR_BYTES = 8 * 1024;
const KILL_GRACE_MS = 3_000;

export const CLAUDE_CODE_SETUP_STEPS = [
  "Install Claude Code if necessary.",
  "Open Terminal.",
  "Run: claude login",
  "Sign in using your Claude Pro account.",
  "Return here and click TEST CONNECTION.",
] as const;

/* ---------- child-process registry (no orphans) ---------- */

const liveChildren = new Set<ChildProcess>();
let exitHookInstalled = false;
function trackChild(child: ChildProcess) {
  liveChildren.add(child);
  child.once("exit", () => liveChildren.delete(child));
  if (!exitHookInstalled) {
    exitHookInstalled = true;
    // If the worker exits, no Claude Code child may keep running on its own.
    process.once("exit", () => {
      for (const c of liveChildren) c.kill("SIGKILL");
    });
  }
}
/** For graceful worker shutdown: stop every running Claude Code child. */
export function killAllClaudeCodeChildren(): number {
  const n = liveChildren.size;
  for (const c of liveChildren) terminate(c);
  return n;
}
export function activeClaudeCodeChildren(): number {
  return liveChildren.size;
}

function alive(child: ChildProcess) {
  return child.exitCode === null && child.signalCode === null;
}
function terminate(child: ChildProcess) {
  if (!alive(child)) return;
  child.kill("SIGTERM");
  const t = setTimeout(() => {
    if (alive(child)) child.kill("SIGKILL");
  }, KILL_GRACE_MS);
  t.unref();
  child.once("exit", () => clearTimeout(t));
}

/* ---------- small helpers ---------- */

interface CommandResult {
  code: number | null;
  stdout: string;
  stderr: string;
  missing: boolean;
  timedOut: boolean;
}

/** Runs a short local CLI command with an argument array — never a shell. */
function runCommand(
  binary: string,
  args: string[],
  env: Record<string, string>,
  timeoutMs: number,
): Promise<CommandResult> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let child: ChildProcess;
    try {
      child = spawn(binary, args, { env, shell: false, stdio: ["ignore", "pipe", "pipe"] });
    } catch {
      return resolve({ code: null, stdout, stderr, missing: true, timedOut });
    }
    trackChild(child);
    const timer = setTimeout(() => {
      timedOut = true;
      terminate(child);
    }, timeoutMs);
    child.stdout?.on("data", (d: Buffer) => {
      if (stdout.length < 256 * 1024) stdout += d.toString("utf8");
    });
    child.stderr?.on("data", (d: Buffer) => {
      if (stderr.length < MAX_STDERR_BYTES) stderr += d.toString("utf8");
    });
    child.once("error", (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      resolve({ code: null, stdout, stderr, missing: err.code === "ENOENT", timedOut });
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, missing: false, timedOut });
    });
  });
}

function toIso(epoch: unknown): string | null {
  if (typeof epoch !== "number" || !Number.isFinite(epoch)) return null;
  return new Date(epoch < 1e12 ? epoch * 1000 : epoch).toISOString();
}

function rateLimitFrom(info: unknown): RateLimitState | null {
  if (!info || typeof info !== "object") return null;
  const i = info as Record<string, unknown>;
  const status = i.status;
  if (status !== "allowed" && status !== "allowed_warning" && status !== "rejected") return null;
  return {
    status,
    type: typeof i.rateLimitType === "string" ? i.rateLimitType : null,
    resetsAt: toIso(i.resetsAt),
  };
}

/** Turns the prepared provider-neutral request into Claude Code inputs. */
export function claudeCodeInputs(request: ProviderRequest): { system: string; prompt: string } {
  const system = request.system.map((b) => b.text).join("\n\n");
  const structured =
    request.output.kind === "structured"
      ? `\n\n## Output format\nRespond with ONLY one JSON object (no prose, no code fence) that validates against this JSON Schema:\n${JSON.stringify(request.output.schema)}`
      : "";
  const prompt =
    request.messages.length === 1 && request.messages[0]!.role === "user"
      ? request.messages[0]!.content
      : request.messages
          .map((m) => `<${m.role}_turn>\n${m.content}\n</${m.role}_turn>`)
          .join("\n\n");
  return { system: system + structured, prompt };
}

/** Accepts bare JSON or JSON wrapped in one code fence; nothing else. */
export function parseJsonOutput(text: string): unknown {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n```$/.exec(trimmed);
  return JSON.parse(fenced ? fenced[1]! : trimmed);
}

/* ---------- semaphore (subscription capacity is finite) ---------- */

class Semaphore {
  private active = 0;
  private readonly waiters: (() => void)[] = [];
  constructor(private readonly max: number) {}
  get inUse() {
    return this.active;
  }
  async acquire(signal?: AbortSignal): Promise<() => void> {
    if (this.active >= this.max)
      await new Promise<void>((resolve, reject) => {
        const onAbort = () => {
          const i = this.waiters.indexOf(go);
          if (i >= 0) this.waiters.splice(i, 1);
          reject(new ProviderError("CANCELLED", "Request cancelled", { provider: "CLAUDE" }));
        };
        const go = () => {
          signal?.removeEventListener("abort", onAbort);
          resolve();
        };
        if (signal?.aborted) return onAbort();
        signal?.addEventListener("abort", onAbort, { once: true });
        this.waiters.push(go);
      });
    this.active++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active--;
      this.waiters.shift()?.();
    };
  }
}

/* ---------- provider ---------- */

interface CliCapabilities {
  installed: boolean;
  version: string | null;
  flags: Set<string>;
  missing: string[];
}

export class ClaudeCodeProvider implements AIProvider {
  readonly providerId = "CLAUDE" as const;
  readonly displayName = "Claude Code";
  readonly isMock = false;
  readonly transport = "claude_code_cli" as const;
  readonly authMode = "subscription_login" as const;
  readonly billingMode = "subscription" as const;
  private readonly inflight = new Map<string, AbortController>();
  private readonly semaphore: Semaphore;
  private caps: { at: number; value: CliCapabilities } | null = null;
  /** Last locally known unusable state (per process); the DB holds the shared state. */
  private knownUnusable: string | null = null;

  constructor(readonly config: ClaudeCodeConfig) {
    this.semaphore = new Semaphore(config.maxConcurrency);
  }

  get maxConcurrency() {
    return this.config.maxConcurrency;
  }
  get inUse() {
    return this.semaphore.inUse;
  }

  private childEnv(maxOutputTokens?: number) {
    return subscriptionChildEnv(this.config.parentEnv, {
      allowBaseUrl: this.config.allowBaseUrl,
      maxOutputTokens,
    });
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
    return estimateCost(price, { provider: "CLAUDE", ...input });
  }

  /** `claude --version` + `claude --help`: installed? which flags does this version support? */
  async cliCapabilities(force = false): Promise<CliCapabilities> {
    if (!force && this.caps && Date.now() - this.caps.at < 5 * 60_000) return this.caps.value;
    const env = this.childEnv();
    const timeout = this.config.checkTimeoutMs ?? 15_000;
    const version = await runCommand(this.config.binary, ["--version"], env, timeout);
    if (version.missing || version.code !== 0) {
      const value = { installed: false, version: null, flags: new Set<string>(), missing: [] };
      this.caps = { at: Date.now(), value };
      return value;
    }
    const help = await runCommand(this.config.binary, ["--help"], env, timeout);
    const flags = new Set(help.stdout.match(/--[a-z][a-z-]+/g) ?? []);
    const value = {
      installed: true,
      version: /\d+\.\d+\.\d+/.exec(version.stdout)?.[0] ?? (version.stdout.trim() || null),
      flags,
      missing: [
        ...REQUIRED_FLAGS.filter((f) => !flags.has(f)),
        // Hooks/plugins/user settings must not run: needs safe mode or restricted mode.
        ...(flags.has("--safe-mode") || flags.has("--restricted") ? [] : ["--safe-mode"]),
      ],
    };
    this.caps = { at: Date.now(), value };
    return value;
  }

  /** `claude auth status --json` — the supported way to learn login state (no credential access). */
  async authStatus(): Promise<CliInfo> {
    const r = await runCommand(
      this.config.binary,
      ["auth", "status", "--json"],
      this.childEnv(),
      this.config.checkTimeoutMs ?? 15_000,
    );
    const info: CliInfo = {
      binary: this.config.binary,
      version: this.caps?.value.version ?? null,
      loggedIn: null,
      authMethod: null,
      apiProvider: null,
      subscriptionType: null,
    };
    try {
      const j = JSON.parse(r.stdout) as Record<string, unknown>;
      info.loggedIn = typeof j.loggedIn === "boolean" ? j.loggedIn : null;
      info.authMethod = typeof j.authMethod === "string" ? j.authMethod : null;
      info.apiProvider = typeof j.apiProvider === "string" ? j.apiProvider : null;
      info.subscriptionType = typeof j.subscriptionType === "string" ? j.subscriptionType : null;
    } catch {
      // Unparseable → unknown; a non-zero exit with no JSON means "not logged in" on current CLIs.
      if (r.code !== 0 && !r.timedOut) info.loggedIn = false;
    }
    return info;
  }

  /**
   * Local checks only (no model call, no subscription usage): binary present,
   * version supports isolation flags, logged in with a subscription (not an API
   * key), first-party provider.
   */
  async healthCheck(): Promise<ProviderHealthResult> {
    const checkedAt = new Date();
    const caps = await this.cliCapabilities(true);
    const base = { provider: "CLAUDE" as const, checkedAt };
    if (!caps.installed) {
      this.knownUnusable = "not_installed";
      return {
        ...base,
        state: "not_installed",
        detail: `Claude Code not found (${this.config.binary}). Install Claude Code, then run: claude login`,
        cli: null,
      };
    }
    if (caps.missing.length) {
      this.knownUnusable = "misconfigured";
      return {
        ...base,
        state: "misconfigured",
        detail: `Claude Code ${caps.version ?? ""} lacks required options (${caps.missing.join(", ")}). Run: claude update`,
        cli: { ...(await this.authStatus()), version: caps.version },
      };
    }
    const cli = { ...(await this.authStatus()), version: caps.version };
    const problem = this.authProblem(cli);
    if (problem) {
      this.knownUnusable = problem.state;
      return { ...base, ...problem, cli };
    }
    this.knownUnusable = null;
    return {
      ...base,
      state: "available",
      detail: `Claude Code ${caps.version ?? ""} signed in with a Claude subscription`,
      cli,
    };
  }

  private authProblem(
    cli: CliInfo,
  ): { state: "login_required" | "misconfigured"; detail: string } | null {
    if (cli.loggedIn === false)
      return {
        state: "login_required",
        detail: "Login required. Open Terminal and run: claude login",
      };
    if (cli.apiProvider && cli.apiProvider !== "firstParty")
      return {
        state: "misconfigured",
        detail: `Claude Code is configured for a third-party provider (${cli.apiProvider}), not a Claude subscription.`,
      };
    if (cli.authMethod && /api[_-]?key/i.test(cli.authMethod))
      return {
        state: "misconfigured",
        detail:
          "Claude Code is signed in with an API key, not a Claude subscription. Run: claude logout, then claude login",
      };
    return null;
  }

  execute(request: ProviderRequest): Promise<ProviderResult> {
    return this.stream(request, {});
  }

  async stream(request: ProviderRequest, handlers: StreamHandlers): Promise<ProviderResult> {
    if (!MODEL_ARG.test(request.model))
      throw new ProviderError("INVALID_REQUEST", "Invalid model alias", { provider: "CLAUDE" });
    if (request.effort && !EFFORTS.includes(request.effort))
      throw new ProviderError("INVALID_REQUEST", "Invalid effort", { provider: "CLAUDE" });

    const controller = new AbortController();
    const onAbort = () => controller.abort();
    request.signal?.addEventListener("abort", onAbort, { once: true });
    if (request.signal?.aborted) controller.abort();
    this.inflight.set(request.runId, controller);
    let release: (() => void) | null = null;
    let workdir: string | null = null;
    try {
      // Queue behind other Claude Code runs (CLAUDE_CODE_MAX_CONCURRENCY).
      release = await this.semaphore.acquire(controller.signal);
      const caps = await this.cliCapabilities();
      if (!caps.installed)
        throw new ProviderError(
          "NOT_INSTALLED",
          "Claude Code is not installed on this machine. Install it, then run: claude login",
          { provider: "CLAUDE" },
        );
      if (caps.missing.length)
        throw new ProviderError(
          "MISCONFIGURED",
          `Claude Code lacks required options (${caps.missing.join(", ")}). Run: claude update`,
          { provider: "CLAUDE" },
        );
      // Private, empty working directory: no project CLAUDE.md or settings are discovered.
      workdir = await mkdtemp(join(tmpdir(), "aibos-claude-"));
      const { system, prompt } = claudeCodeInputs(request);
      const args = [
        "--print",
        "--output-format",
        "stream-json",
        "--verbose",
        "--model",
        request.model,
        ...(request.effort && caps.flags.has("--effort") ? ["--effort", request.effort] : []),
        // No tools of any kind: no Bash, files, web, browser, MCP or external actions.
        "--tools",
        "",
        ...(caps.flags.has("--strict-mcp-config") ? ["--strict-mcp-config"] : []),
        ...(caps.flags.has("--safe-mode") ? ["--safe-mode"] : []),
        ...(caps.flags.has("--restricted") ? ["--restricted"] : []),
        ...(caps.flags.has("--disable-slash-commands") ? ["--disable-slash-commands"] : []),
        ...(caps.flags.has("--permission-prompts") ? ["--permission-prompts", "none"] : []),
        "--no-session-persistence",
        ...(caps.flags.has("--include-partial-messages") ? ["--include-partial-messages"] : []),
      ];
      if (caps.flags.has("--system-prompt-file")) {
        const file = join(workdir, "system.txt");
        await writeFile(file, system, { mode: 0o600 });
        args.push("--system-prompt-file", file);
      } else {
        if (system.length > 100_000)
          throw new ProviderError("INVALID_REQUEST", "Instructions too large for Claude Code", {
            provider: "CLAUDE",
          });
        args.push("--system-prompt", system);
      }
      return await this.run(args, prompt, workdir, request, controller.signal, handlers);
    } catch (err) {
      // An auth failure is "expired" while Claude Code still believes it is
      // signed in, and "required" once it reports no login.
      if (err instanceof ProviderError && err.code === "LOGIN_EXPIRED") {
        const status = await this.authStatus().catch(() => null);
        if (status?.loggedIn === false)
          throw this.normalizeError(
            new ProviderError("LOGIN_REQUIRED", "Login required. Run in Terminal: claude login", {
              provider: "CLAUDE",
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
        return reject(new ProviderError("CANCELLED", "Request cancelled", { provider: "CLAUDE" }));
      // spawn with an argument array and shell:false — task/company/user text is
      // only ever written to stdin, so it can never become shell syntax.
      const child = spawn(this.config.binary, args, {
        cwd,
        env: this.childEnv(request.maxOutputTokens),
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
      });
      trackChild(child);

      let settled = false;
      let failure: ProviderError | null = null;
      let buffered = "";
      let stdoutBytes = 0;
      let stderr = "";
      let streamedText = "";
      let assistantText = "";
      let sawDelta = false;
      let startedStreaming = false;
      let initModel: string | null = null;
      let requestId: string | null = null;
      let rateLimit: RateLimitState | null = null;
      let assistantError: string | null = null;
      let apiRetries = 0;
      let result: Record<string, unknown> | null = null;

      const fail = (err: ProviderError) => {
        if (!failure) failure = err;
        terminate(child);
      };
      const timer = setTimeout(
        () => fail(new ProviderError("TIMEOUT", "Claude Code timed out", { provider: "CLAUDE" })),
        request.timeoutMs,
      );
      const onAbort = () =>
        fail(new ProviderError("CANCELLED", "Request cancelled", { provider: "CLAUDE" }));
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
        streamedText += delta;
        handlers.onText?.(delta);
      };

      const handle = (msg: Record<string, unknown>) => {
        const type = msg.type;
        if (typeof msg.session_id === "string" && !requestId) requestId = `cc:${msg.session_id}`;
        if (type === "system" && msg.subtype === "init") {
          initModel = typeof msg.model === "string" ? msg.model : null;
          // Guard against hidden API billing: an API key in Claude Code's own
          // configuration would silently switch it off the subscription.
          const source = typeof msg.apiKeySource === "string" ? msg.apiKeySource : "none";
          if (!SUBSCRIPTION_KEY_SOURCES.has(source))
            fail(
              new ProviderError(
                "API_BILLING_REFUSED",
                "Claude Code would use API-key billing, not the Claude subscription. Remove the API key from Claude Code's configuration, then run: claude login",
                { provider: "CLAUDE" },
              ),
            );
          return;
        }
        if (type === "system" && msg.subtype === "api_retry") {
          apiRetries++;
          const e = String(msg.error ?? "");
          if (["rate_limit", "billing_error", "authentication_failed"].includes(e)) {
            assistantError = e;
            terminate(child);
          } else if (apiRetries > 1) {
            // At most one retry per run — Claude Code's own retry counts as ours.
            fail(this.errorFromCode(e || "server_error", rateLimit));
          }
          return;
        }
        if (type === "rate_limit_event") {
          rateLimit = rateLimitFrom(msg.rate_limit_info) ?? rateLimit;
          return;
        }
        if (type === "stream_event" && msg.parent_tool_use_id == null) {
          const ev = msg.event as Record<string, unknown> | undefined;
          const delta = ev?.delta as Record<string, unknown> | undefined;
          // Visible text only; thinking deltas are never read or stored.
          if (ev?.type === "content_block_delta" && delta?.type === "text_delta") {
            sawDelta = true;
            emit(String(delta.text ?? ""));
          }
          return;
        }
        if (type === "assistant" && msg.parent_tool_use_id == null) {
          if (typeof msg.request_id === "string") requestId = msg.request_id;
          if (typeof msg.error === "string") assistantError = msg.error;
          const content = (msg.message as { content?: unknown[] } | undefined)?.content ?? [];
          const text = content
            .filter(
              (b): b is { type: "text"; text: string } =>
                !!b && typeof b === "object" && (b as { type?: string }).type === "text",
            )
            .map((b) => b.text)
            .join("");
          assistantText += text;
          if (!sawDelta) emit(text);
          return;
        }
        if (type === "result") result = msg;
      };

      child.stdout.on("data", (chunk: Buffer) => {
        stdoutBytes += chunk.length;
        if (stdoutBytes > MAX_STDOUT_BYTES)
          return fail(
            new ProviderError("OUTPUT_TRUNCATED", "Claude Code output exceeded the limit", {
              provider: "CLAUDE",
            }),
          );
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
            ? new ProviderError(
                "NOT_INSTALLED",
                "Claude Code is not installed on this machine. Install it, then run: claude login",
                { provider: "CLAUDE" },
              )
            : new ProviderError("UNKNOWN", "Could not start Claude Code", { provider: "CLAUDE" }),
        ),
      );

      child.once("close", (code) => {
        if (failure) return finish(failure);
        const r = result;
        if (!r) {
          if (assistantError) return finish(this.errorFromCode(assistantError, rateLimit));
          if (/not logged in|please run \/login|claude login/i.test(stderr))
            return finish(
              new ProviderError("LOGIN_REQUIRED", "Login required. Run: claude login", {
                provider: "CLAUDE",
              }),
            );
          return finish(
            new ProviderError(
              "UNKNOWN",
              `Claude Code exited without a result (exit ${code ?? "signal"})`,
              { provider: "CLAUDE" },
            ),
          );
        }
        if (r.is_error === true || r.subtype !== "success") {
          if (r.subtype === "error_max_structured_output_retries")
            return finish(
              new ProviderError("INVALID_OUTPUT", "Structured output was not valid", {
                provider: "CLAUDE",
              }),
            );
          if (typeof r.startup_failure_reason === "string")
            return finish(
              new ProviderError(
                "MISCONFIGURED",
                "Claude Code could not start in this environment",
                { provider: "CLAUDE" },
              ),
            );
          return finish(this.errorFromCode(assistantError ?? "unknown", rateLimit));
        }
        const text =
          typeof r.result === "string" && r.result ? r.result : assistantText || streamedText;
        if (text && !startedStreaming) emit(text);
        const stopReason = typeof r.stop_reason === "string" ? r.stop_reason : null;
        if (stopReason === "refusal")
          return finish(
            new ProviderError("REFUSED", "The provider declined this request", {
              provider: "CLAUDE",
              requestId,
            }),
          );
        let structured: unknown = null;
        if (request.output.kind === "structured") {
          if (stopReason === "max_tokens")
            return finish(
              new ProviderError("OUTPUT_TRUNCATED", "Structured output hit the output limit", {
                provider: "CLAUDE",
                requestId,
              }),
            );
          try {
            structured = parseJsonOutput(text);
          } catch {
            return finish(
              new ProviderError("INVALID_OUTPUT", "Structured output was not valid JSON", {
                provider: "CLAUDE",
                requestId,
              }),
            );
          }
        }
        const usage = (r.usage ?? {}) as Record<string, unknown>;
        const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
        const modelUsage = Object.keys((r.modelUsage as Record<string, unknown>) ?? {});
        const providerUsage: ProviderUsage = {
          inputTokens: n(usage.input_tokens),
          outputTokens: n(usage.output_tokens),
          cacheCreationTokens: n(usage.cache_creation_input_tokens),
          cacheReadTokens: n(usage.cache_read_input_tokens),
        };
        finish({
          provider: "CLAUDE",
          model: initModel ?? modelUsage[0] ?? request.model,
          text,
          structured,
          stopReason,
          requestId,
          usage: providerUsage,
          latencyMs: Date.now() - started,
          rateLimit,
        });
      });
    });
  }

  /** Claude Code's typed assistant error values → our stable codes. */
  private errorFromCode(code: string, rateLimit: RateLimitState | null): ProviderError {
    const opts = { provider: "CLAUDE" as const };
    switch (code) {
      case "authentication_failed":
        return new ProviderError(
          "LOGIN_EXPIRED",
          "Claude login expired. Run in Terminal: claude login",
          opts,
        );
      case "oauth_org_not_allowed":
      case "account_on_hold":
      case "verification_required":
      case "cloud_credential_error":
        return new ProviderError(
          "MISCONFIGURED",
          "The Claude account needs attention in Claude Code (run: claude login)",
          opts,
        );
      case "rate_limit":
      case "billing_error":
        return new ProviderError(
          "SUBSCRIPTION_LIMIT_REACHED",
          `Claude Pro usage limit reached${rateLimit?.resetsAt ? ` (resets ${rateLimit.resetsAt})` : ""}. No API fallback is used.`,
          opts,
        );
      case "overloaded":
        return new ProviderError("OVERLOADED", "Claude is overloaded", opts);
      case "server_error":
        return new ProviderError("SERVER_ERROR", "Claude server error", opts);
      case "model_not_found":
        return new ProviderError(
          "MODEL_UNAVAILABLE",
          "This model is not available on the Claude subscription",
          opts,
        );
      case "invalid_request":
        return new ProviderError("INVALID_REQUEST", "Claude rejected the request", opts);
      case "max_output_tokens":
        return new ProviderError("OUTPUT_TRUNCATED", "Output hit the output limit", opts);
      default:
        return new ProviderError("UNKNOWN", "Claude Code reported an error", opts);
    }
  }

  async cancel(runId: string): Promise<void> {
    this.inflight.get(runId)?.abort();
  }

  normalizeError(err: unknown): ProviderError {
    if (err instanceof ProviderError) {
      // Remember states that make the transport unusable until re-checked.
      if (["NOT_INSTALLED", "LOGIN_REQUIRED", "LOGIN_EXPIRED", "MISCONFIGURED"].includes(err.code))
        this.knownUnusable = err.code.toLowerCase();
      return err;
    }
    return new ProviderError("UNKNOWN", "Unexpected Claude Code failure", { provider: "CLAUDE" });
  }
}
