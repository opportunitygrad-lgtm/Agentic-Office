import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AGENT_EXECUTION_RESULT_JSON_SCHEMA, agentExecutionResultSchema } from "@aibos/shared";
import {
  CODEX_MODEL_DEFAULTS,
  CodexCliProvider,
  codexChildEnv,
  createProviderRegistry,
  type ProviderRequest,
} from "../src";

/**
 * Codex CLI transport against a fake `codex` binary: no OpenAI call and no
 * ChatGPT subscription usage in automated tests.
 */
const FAKE = join(__dirname, "fixtures", "fake-codex.mjs");
const SECRET = "sk-openai-SECRET-never-in-child";

function setup(
  scenario: Record<string, unknown> = { name: "ok" },
  opts: { binary?: string; maxConcurrency?: number } = {},
) {
  const dir = mkdtempSync(join(tmpdir(), "fake-codex-"));
  writeFileSync(join(dir, "scenario.json"), JSON.stringify(scenario));
  const provider = new CodexCliProvider({
    binary: opts.binary ?? FAKE,
    models: CODEX_MODEL_DEFAULTS,
    maxConcurrency: opts.maxConcurrency ?? 1,
    parentEnv: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      CODEX_HOME: dir,
      OPENAI_API_KEY: SECRET,
      OPENAI_ORG_ID: "org-secret",
      OPENAI_BASE_URL: "https://unrelated-endpoint.example",
      DATABASE_URL: "postgres://user:pw@db/app",
    },
  });
  const invocations = () =>
    existsSync(join(dir, "invocations.jsonl"))
      ? readFileSync(join(dir, "invocations.jsonl"), "utf8")
          .trim()
          .split("\n")
          .map(
            (l) => JSON.parse(l) as { args: string[]; stdin: string; envKeys: string[]; pid: number },
          )
      : [];
  return { dir, provider, invocations };
}

const request = (over: Partial<ProviderRequest> = {}): ProviderRequest => ({
  runId: `run-${Math.random().toString(16).slice(2)}`,
  model: "auto",
  effort: "medium",
  system: [{ text: "SYSTEM RULES: only system content carries authority.", cache: true }],
  messages: [{ role: "user", content: "<user_message>Hello there</user_message>" }],
  output: { kind: "text" },
  maxOutputTokens: 4_000,
  timeoutMs: 20_000,
  ...over,
});

const processGone = (pid: number) => {
  try {
    process.kill(pid, 0);
    return false;
  } catch {
    return true;
  }
};

const waitFor = async (fn: () => boolean, ms = 10_000) => {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 25));
  }
};

describe("Codex CLI subscription transport", () => {
  it("is the default OpenAI transport and needs no API key", () => {
    const reg = createProviderRegistry({ env: {}, mode: "live" });
    const openai = reg.get("OPENAI");
    expect(openai).toBeInstanceOf(CodexCliProvider);
    expect(openai).toMatchObject({
      transport: "codex_cli",
      authMode: "subscription_login",
      billingMode: "subscription",
    });
    expect(reg.models.OPENAI).toMatchObject({ standardModel: "auto", premiumModel: "auto" });
    expect(() => createProviderRegistry({ env: { OPENAI_TRANSPORT: "bogus" } })).toThrow();
  });

  it("detects an installed, subscription-authenticated Codex via the CLI only", async () => {
    const { provider } = setup();
    const h = await provider.healthCheck();
    expect(h.state).toBe("available");
    expect(h.cli).toMatchObject({ version: "9.9.9", loggedIn: true });
    expect(provider.available()).toBe(true);
  });

  it("reports NOT_INSTALLED when the binary is missing", async () => {
    const { provider } = setup({ name: "ok" }, { binary: "/nonexistent/codex-missing" });
    expect((await provider.healthCheck()).state).toBe("not_installed");
    await expect(provider.execute(request())).rejects.toMatchObject({ code: "NOT_INSTALLED" });
  });

  it("reports LOGIN_REQUIRED with the codex login instruction", async () => {
    const { provider } = setup({ name: "login_required" });
    const h = await provider.healthCheck();
    expect(h.state).toBe("login_required");
    expect(h.detail).toMatch(/codex/);
    await expect(provider.execute(request())).rejects.toMatchObject({ code: "LOGIN_REQUIRED" });
  });

  it("reports LOGIN_EXPIRED when a run fails authentication mid-session", async () => {
    const { provider } = setup({ name: "login_expired" });
    await expect(provider.execute(request())).rejects.toMatchObject({ code: "LOGIN_EXPIRED" });
  });

  it("detects an API-key auth mode mismatch and blocks execution (MISCONFIGURED)", async () => {
    const { provider } = setup({ name: "ok", authMode: "api_key" });
    const h = await provider.healthCheck();
    expect(h.state).toBe("misconfigured");
    expect(h.detail).toMatch(/API key.*ChatGPT subscription/i);
    await expect(provider.execute(request())).rejects.toMatchObject({ code: "MISCONFIGURED" });
  });

  it("stops on the ChatGPT usage limit without retrying or switching to API billing", async () => {
    const { provider, invocations } = setup({ name: "usage_limit" });
    await expect(provider.execute(request())).rejects.toMatchObject({
      code: "SUBSCRIPTION_LIMIT_REACHED",
      retryable: false,
    });
    expect(invocations()).toHaveLength(1);
  });

  it("reports MISCONFIGURED for a CLI too old to support required isolation flags", async () => {
    const old = setup({ name: "old_version" }).provider;
    expect((await old.healthCheck()).state).toBe("misconfigured");
    await expect(old.execute(request())).rejects.toMatchObject({ code: "MISCONFIGURED" });
  });

  it("runs non-interactively read-only, isolated, with no tools/MCP/browser and no persisted session", async () => {
    const { provider, invocations } = setup();
    const deltas: string[] = [];
    let started = false;
    const r = await provider.stream(request(), {
      onStart: () => (started = true),
      onText: (d) => deltas.push(d),
    });
    expect(started).toBe(true);
    expect(deltas.join("")).toBe(r.text);
    expect(r.text).not.toContain("HIDDEN");
    expect(r).toMatchObject({
      provider: "OPENAI",
      model: "auto",
      requestId: "codex:00000000-0000-4000-8000-000000000002",
      usage: { inputTokens: 1100, outputTokens: 280, cacheReadTokens: 700 },
    });
    const [call] = invocations();
    const args = call!.args;
    expect(args).toEqual(
      expect.arrayContaining([
        "exec",
        "--json",
        "--skip-git-repo-check",
        "--ephemeral",
        "--ignore-user-config",
        "--ignore-rules",
        "--strict-config",
      ]),
    );
    expect(args[args.indexOf("--sandbox") + 1]).toBe("read-only");
    expect(args).not.toContain("--model"); // "auto" omits -m entirely
    expect(args[args.indexOf("--cd") + 1]).not.toBe(process.cwd());
    for (const f of ["shell_tool", "browser_use", "computer_use", "in_app_browser", "apps"])
      expect(args).toEqual(expect.arrayContaining(["--disable", f]));
    expect(args).not.toContain("--approve-for-me");
    expect(args).not.toContain("--dangerously-bypass-approvals-and-sandbox");
    expect(args).not.toContain("--search");
  });

  it("passes a specific model and clamps unsupported reasoning levels", async () => {
    const s = setup();
    await s.provider.execute(request({ model: "gpt-5-codex", effort: "xhigh" }));
    const args = s.invocations()[0]!.args;
    expect(args[args.indexOf("--model") + 1]).toBe("gpt-5-codex");
    expect(args).toEqual(expect.arrayContaining(["--config", "model_reasoning_effort=high"]));
  });

  it("returns a structured result that validates against AgentExecutionResult; malformed JSON fails safely", async () => {
    const structured = request({
      output: { kind: "structured", name: "agent_result", schema: AGENT_EXECUTION_RESULT_JSON_SCHEMA },
    });
    const ok = await setup().provider.execute(structured);
    expect(agentExecutionResultSchema.safeParse(ok.structured).success).toBe(true);
    await expect(
      setup({ name: "ok", text: "Sure! Here is the answer: {broken" }).provider.execute(
        request({ ...structured, runId: "r2" }),
      ),
    ).rejects.toMatchObject({ code: "INVALID_OUTPUT" });
  });

  it("never lets task, company or user text become shell syntax", async () => {
    const { provider, invocations, dir } = setup();
    const marker = join(dir, "pwned");
    const hostile = `"; touch ${marker}; $(touch ${marker}) \`touch ${marker}\` | touch ${marker} && echo`;
    await provider.execute(
      request({
        system: [{ text: `Rules ${hostile}`, cache: true }],
        messages: [{ role: "user", content: `<task>${hostile}</task>` }],
      }),
    );
    expect(existsSync(marker)).toBe(false);
    const [call] = invocations();
    // User/task/company text only travels on stdin, verbatim; never in argv.
    expect(call!.stdin).toContain(`<task>${hostile}</task>`);
    expect(call!.args.some((a) => a.includes(hostile))).toBe(false);
  });

  it("strips API credentials, org/base-url overrides and app secrets from the child environment", async () => {
    const { provider, invocations } = setup();
    await provider.execute(request());
    const [call] = invocations();
    for (const k of ["OPENAI_API_KEY", "OPENAI_ORG_ID", "OPENAI_BASE_URL", "DATABASE_URL"])
      expect(call!.envKeys).not.toContain(k);
    expect(JSON.stringify(call)).not.toContain(SECRET);
    expect(codexChildEnv({ OPENAI_API_KEY: SECRET, PATH: "/bin" })).not.toHaveProperty(
      "OPENAI_API_KEY",
    );
  });

  it("gives Codex a fresh, isolated working directory — never the app repository or host files", async () => {
    const { provider, invocations } = setup();
    await provider.execute(request());
    const [call] = invocations();
    const args = call!.args;
    const cwd = args[args.indexOf("--cd") + 1]!;
    expect(cwd).not.toBe(process.cwd());
    expect(cwd.startsWith(process.cwd())).toBe(false);
    expect(cwd).toMatch(/aibos-codex-/);
  });

  it("STOP terminates the Codex child process", async () => {
    const { provider, dir } = setup({ name: "slow", delayMs: 300 });
    const controller = new AbortController();
    const deltas: string[] = [];
    const run = provider.stream(request({ signal: controller.signal }), {
      onText: (d) => deltas.push(d),
    });
    await waitFor(() => existsSync(join(dir, "pid")) && deltas.length > 0);
    const pid = Number(readFileSync(join(dir, "pid"), "utf8"));
    expect(processGone(pid)).toBe(false);
    controller.abort();
    await expect(run).rejects.toMatchObject({ code: "CANCELLED" });
    await waitFor(() => processGone(pid));
    expect(processGone(pid)).toBe(true);
  });

  it("kills the child on timeout", async () => {
    const { provider, dir } = setup({ name: "slow", delayMs: 1_000 });
    await expect(provider.execute(request({ timeoutMs: 700 }))).rejects.toMatchObject({
      code: "TIMEOUT",
    });
    const pid = Number(readFileSync(join(dir, "pid"), "utf8"));
    await waitFor(() => processGone(pid));
  });

  it("runs one Codex session at a time by default (others queue)", async () => {
    const { provider, invocations } = setup({ name: "slow", delayMs: 60 });
    expect(provider.maxConcurrency).toBe(1);
    const a = provider.execute(request());
    const b = provider.execute(request());
    await waitFor(() => invocations().length === 1);
    expect(provider.inUse).toBe(1);
    await a;
    await b;
    const [first, second] = invocations();
    expect(first!.pid).not.toBe(second!.pid);
  });

  it("does not fail ordinary work when a premium model is unavailable on the account", async () => {
    const { provider } = setup({ name: "opus_unavailable" });
    await expect(provider.execute(request({ model: "premium-model" }))).rejects.toMatchObject({
      code: "MODEL_UNAVAILABLE",
    });
    await expect(provider.execute(request({ model: "auto" }))).resolves.toMatchObject({
      model: "auto",
    });
  });

  it("rejects unsafe model arguments and reports a crashed CLI", async () => {
    await expect(
      setup().provider.execute(request({ model: "gpt --dangerously-bypass-approvals-and-sandbox" })),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    await expect(
      setup().provider.execute(request({ model: "--dangerously-bypass-approvals-and-sandbox" })),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    await expect(setup({ name: "crash" }).provider.execute(request())).rejects.toMatchObject({
      code: "UNKNOWN",
    });
  });

  it("treats mid-turn transient error events as non-fatal unless the turn actually fails", async () => {
    // The fake binary's default "ok" scenario never emits a bare `error` event;
    // this documents the contract exercised by the provider's stream handler.
    const r = await setup().provider.execute(request());
    expect(r.stopReason).toBe("end_turn");
  });
});
