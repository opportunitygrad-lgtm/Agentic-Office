import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AgentRunDetailDTO,
  ConversationDTO,
  ProviderStatusDTO,
  RunPreviewDTO,
  RunStreamMessage,
} from "@aibos/shared";
import { ME_OWNER, ept } from "@/test/fixtures";
import "@/test/next-navigation";
import { SessionProvider } from "../shell/SessionContext";
import { AgentChatShell } from "../workforce/AgentChatShell";
import { LiveRunPanel } from "./LiveRun";
import { ProviderSettings } from "./ProviderSettings";
import { TaskRunPanel } from "./TaskRunPanel";

/** Controllable EventSource: tests push server-sent messages. */
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }
  push(m: RunStreamMessage) {
    act(() => this.onmessage?.({ data: JSON.stringify(m) }));
  }
  close() {
    this.closed = true;
  }
}

type Route = [match: string, body: unknown, status?: number, method?: string];
function stubApi(routes: Route[]) {
  const fn = vi.fn((url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const r = routes.find(([m, , , verb]) => url.includes(m) && (!verb || verb === method));
    return Promise.resolve(
      new Response(JSON.stringify(r ? r[1] : { error: { message: "nope" } }), {
        status: r ? (r[2] ?? 200) : 404,
      }),
    );
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}
const calls = (fn: ReturnType<typeof stubApi>, method: string, fragment: string) =>
  fn.mock.calls.filter(
    ([url, init]) =>
      String(url).includes(fragment) && (init as RequestInit | undefined)?.method === method,
  );

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource);
});
afterEach(() => vi.unstubAllGlobals());

const provider = (over: Partial<ProviderStatusDTO>): ProviderStatusDTO => ({
  provider: "CLAUDE",
  label: "Claude",
  connected: false,
  isMock: false,
  state: "not_configured",
  detail:
    "Anthropic credential not configured. Add ANTHROPIC_API_KEY or an approved bearer credential to the local .env and restart the services.",
  enabled: true,
  standardModel: "claude-sonnet-5",
  premiumModel: "claude-opus-5-5",
  standardEffort: "medium",
  premiumEffort: "high",
  dailyBudgetUsd: null,
  transport: "anthropic_api",
  authMode: "api_key",
  billingMode: "api",
  cli: null,
  premiumAvailable: null,
  rateLimit: null,
  runsToday: 0,
  lastHealthCheckAt: null,
  lastSuccessAt: null,
  lastErrorAt: null,
  lastErrorCode: null,
  callsToday: 0,
  spendTodayUsd: 0,
  prices: [
    {
      model: "claude-sonnet-5",
      inputPerMTok: 2,
      outputPerMTok: 10,
      cacheWritePerMTok: 2.5,
      cacheReadPerMTok: 0.2,
      effectiveFrom: "2026-09-01T00:00:00Z",
      source: "x",
    },
  ],
  ...over,
});

describe("Provider settings", () => {
  it("shows Claude not configured (not an error), OpenAI Codex not yet checked, Grok disconnected and never any credential", () => {
    render(
      <SessionProvider me={ME_OWNER}>
        <ProviderSettings
          providers={[
            provider({}),
            // Stage 06 default: OPENAI reaches Codex CLI, on the same
            // subscription-first footing as Claude Code — never an API key.
            provider({
              provider: "OPENAI",
              label: "OpenAI",
              detail: "OpenAI Codex has not been checked yet — click TEST CODEX CONNECTION.",
              transport: "codex_cli",
              authMode: "subscription_login",
              billingMode: "subscription",
              standardModel: "auto",
              premiumModel: "auto",
              prices: [],
            }),
            provider({
              provider: "GROK",
              label: "Grok",
              detail: "Not connected in this stage",
              standardModel: null,
              premiumModel: null,
              prices: [],
            }),
          ]}
        />
      </SessionProvider>,
    );
    const claude = screen.getByTestId("provider-CLAUDE");
    expect(claude).toHaveTextContent("Anthropic credential not configured");
    expect(claude).toHaveTextContent("claude-sonnet-5");
    // 3 status pills + one extra "Status" row inside OpenAI's subscription facts table.
    expect(screen.getAllByText("Not configured")).toHaveLength(4);
    const openai = screen.getByTestId("provider-OPENAI");
    expect(openai).toHaveTextContent("OpenAI Codex has not been checked yet");
    expect(screen.getByTestId("codex-cli-setup")).toHaveTextContent(
      "OpenAI Codex has not been checked yet.",
    );
    expect(screen.getByTestId("provider-GROK")).toHaveTextContent(
      "Not connected — arrives in a later stage",
    );
    expect(document.body.textContent).not.toMatch(/sk-ant/);
  });

  it("tests the Claude connection when connected", async () => {
    const fn = stubApi([
      ["/test", { data: { state: "available", detail: "Connection verified" } }, 200, "POST"],
    ]);
    const u = userEvent.setup();
    render(
      <SessionProvider
        me={{
          ...ME_OWNER,
          globalPermissions: [
            ...ME_OWNER.globalPermissions,
            "provider.test",
            "provider.settings.manage",
          ],
        }}
      >
        <ProviderSettings
          providers={[provider({ connected: true, state: "available", detail: null })]}
        />
      </SessionProvider>,
    );
    expect(screen.getByText("Connected")).toBeInTheDocument();
    await u.click(screen.getByRole("button", { name: "Test Claude connection" }));
    expect(await screen.findByText(/Test result: available/)).toBeInTheDocument();
    expect(calls(fn, "POST", "/v1/providers/CLAUDE/test")).toHaveLength(1);
  });
});

const preview = (
  over: Partial<RunPreviewDTO["route"]> = {},
): RunPreviewDTO & { canExecute: boolean } => ({
  eligible: true,
  reasons: [],
  agent: { id: "a1", name: "EPT Company Manager" },
  company: ept,
  route: {
    provider: "CLAUDE",
    model: "claude-sonnet-5",
    modelLabel: "Claude Sonnet 5",
    effort: "medium",
    tier: "standard",
    reasons: [],
    estimatedInputTokens: 6200,
    estimatedOutputTokens: 4000,
    estimatedCostUsd: 0.0524,
    fallbackProvider: null,
    approvalRequired: false,
    blockedReason: null,
    isMock: false,
    transport: "anthropic_api",
    billingMode: "api",
    apiEquivalentUsd: null,
    ...over,
  },
  budget: { decision: "allowed", checks: [], reasons: [] },
  context: { contextVersion: "ctx-1", approxTokens: 6200, knowledgeItems: 7, criticalRules: 4 },
  instructions: { version: "instr-1", ruleCount: 40, roleVersion: null },
  activeRunId: null,
  approval: null,
  canExecute: true,
});

const run = (over: Partial<AgentRunDetailDTO> = {}): AgentRunDetailDTO => ({
  id: "run-1",
  number: 1,
  executionType: "task",
  status: "streaming",
  purpose: "primary",
  reviewedRunId: null,
  company: ept,
  task: { id: "t1", title: "Operational brief" },
  agent: { id: "a1", name: "EPT Company Manager" },
  conversationId: null,
  provider: "CLAUDE",
  model: "claude-sonnet-5",
  modelLabel: "Claude Sonnet 5",
  effort: "medium",
  tier: "standard",
  responseDetail: "normal",
  maxOutputTokens: 4000,
  isMock: false,
  startedBy: "Platform Owner",
  createdAt: new Date().toISOString(),
  startedAt: new Date().toISOString(),
  completedAt: null,
  cancelledAt: null,
  errorCode: null,
  errorMessage: null,
  contextVersion: "ctx-1",
  instructionVersion: "instr-1",
  contextSummary: { knowledgeItems: 7, criticalRules: 4, approxTokens: 6200, handoffs: 0 },
  providerRequestId: null,
  outputText: "",
  result: null,
  usage: null,
  estimatedCostUsd: 0.0524,
  actualCostUsd: null,
  transport: "anthropic_api",
  billingMode: "api",
  apiEquivalentUsd: null,
  latencyMs: null,
  stopReason: null,
  retryCount: 0,
  phase: "Generating result",
  feedback: null,
  proposals: { handoffs: 0, knowledgeDrafts: 0 },
  viewer: { canStop: true, canFeedback: false, canRequestReview: false },
  events: [],
  review: null,
  ...over,
});

const RESULT = {
  status: "completed" as const,
  summary: "EPT focuses on premium European pilot training.",
  response: "Full internal brief.",
  keyFindings: ["Premium positioning"],
  proposedNextActions: ["Review partner shortlist"],
  proposedHandoffs: [
    { department: "marketing", objective: "Refresh messaging", reason: "Brand rules" },
  ],
  proposedKnowledgeDrafts: [],
  warnings: [],
  confidence: "medium" as const,
};

describe("Claude Code subscription provider", () => {
  const cc = (over: Partial<ProviderStatusDTO>) =>
    provider({
      transport: "claude_code_cli",
      authMode: "subscription_login",
      billingMode: "subscription",
      standardModel: "sonnet",
      premiumModel: "opus",
      cli: {
        binary: "claude",
        version: "2.1.282",
        authMethod: "claude.ai",
        subscriptionType: "pro",
        maxConcurrency: 1,
      },
      ...over,
    });
  const owner = {
    ...ME_OWNER,
    globalPermissions: [...ME_OWNER.globalPermissions, "provider.test", "provider.settings.manage"],
  };

  it("shows the Claude Code card: Pro subscription, local transport, included billing, API key not used", () => {
    render(
      <SessionProvider me={owner}>
        <ProviderSettings
          providers={[
            cc({
              connected: true,
              state: "available",
              detail: "Claude Code 2.1.282 signed in with a Claude subscription",
              runsToday: 3,
              rateLimit: { status: "allowed", resetsAt: null, type: "five_hour" },
            }),
          ]}
        />
      </SessionProvider>,
    );
    const card = screen.getByTestId("claude-code-facts");
    for (const text of [
      "Pro subscription",
      "Local Claude Code",
      "Connected",
      "Sonnet",
      "Included subscription usage",
      "Not used",
      "Within usage limits",
    ])
      expect(card).toHaveTextContent(text);
    expect(screen.getByRole("button", { name: "Test Claude Code" })).toBeEnabled();
    expect(screen.queryByTestId("claude-code-setup")).not.toBeInTheDocument();
    // No API-key entry anywhere; no credential field of any kind.
    expect(document.body.textContent).not.toMatch(/Enter API Key|ANTHROPIC_API_KEY/i);
    expect(document.querySelector('input[type="password"]')).toBeNull();
    expect(screen.getByText(/NOT BILLED — ESTIMATED API EQUIVALENT/)).toBeInTheDocument();
  });

  it("guides login in Terminal when Claude Code is not authenticated (never asks for credentials)", () => {
    render(
      <SessionProvider me={owner}>
        <ProviderSettings
          providers={[
            cc({
              state: "login_required",
              detail: "Login required. Open Terminal and run: claude login",
            }),
          ]}
        />
      </SessionProvider>,
    );
    const setup = screen.getByTestId("claude-code-setup");
    expect(setup).toHaveTextContent("Claude Code is not authenticated.");
    expect(setup).toHaveTextContent("Open Terminal.");
    expect(setup).toHaveTextContent("claude login");
    expect(setup).toHaveTextContent("Sign in using your Claude Pro account.");
    expect(screen.getAllByText("Login required").length).toBeGreaterThan(0);
    expect(document.querySelector("input[type='password']")).toBeNull();
  });

  it("labels subscription runs as included usage with a NOT BILLED API-equivalent", async () => {
    stubApi([
      [
        "/run-preview",
        {
          data: preview({
            model: "sonnet",
            modelLabel: "Claude Sonnet",
            transport: "claude_code_cli",
            billingMode: "subscription",
            estimatedCostUsd: 0,
            apiEquivalentUsd: 0.05,
          }),
        },
      ],
      ["/runs", { data: [] }],
    ]);
    render(
      <SessionProvider me={ME_OWNER}>
        <TaskRunPanel taskId="t1" />
      </SessionProvider>,
    );
    expect(await screen.findByTestId("estimated-cost")).toHaveTextContent(
      "Included in subscription",
    );
    render(
      <LiveRunPanel
        run={run({
          status: "completed",
          transport: "claude_code_cli",
          billingMode: "subscription",
          apiEquivalentUsd: 0.031,
        })}
        output=""
      />,
    );
    expect(screen.getByText("N/A — included in subscription")).toBeInTheDocument();
    expect(screen.getByText("~$0.03")).toBeInTheDocument();
  });
});

describe("OpenAI Codex subscription provider", () => {
  const codex = (over: Partial<ProviderStatusDTO>) =>
    provider({
      provider: "OPENAI",
      label: "OpenAI",
      transport: "codex_cli",
      authMode: "subscription_login",
      billingMode: "subscription",
      standardModel: "auto",
      premiumModel: "auto",
      cli: {
        binary: "codex",
        version: "0.157.0",
        authMethod: "chatgpt",
        subscriptionType: "plus",
        maxConcurrency: 1,
      },
      prices: [],
      ...over,
    });
  const owner = {
    ...ME_OWNER,
    globalPermissions: [...ME_OWNER.globalPermissions, "provider.test", "provider.settings.manage"],
  };

  it("shows the OpenAI Codex card: ChatGPT subscription, Codex CLI transport, included billing, API key not used", () => {
    render(
      <SessionProvider me={owner}>
        <ProviderSettings
          providers={[
            codex({
              connected: true,
              state: "available",
              detail: "Codex 0.157.0 signed in with a ChatGPT subscription",
              runsToday: 2,
            }),
          ]}
        />
      </SessionProvider>,
    );
    const card = screen.getByTestId("codex-cli-facts");
    for (const text of [
      "Plus subscription", // the reported ChatGPT plan name, like Claude's "Pro subscription"
      "Local Codex CLI",
      "Connected",
      "Auto",
      "Included subscription usage",
      "Not used",
    ])
      expect(card).toHaveTextContent(text);
    expect(screen.getByRole("button", { name: "Test Codex Connection" })).toBeEnabled();
    expect(screen.queryByTestId("codex-cli-setup")).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/Enter API Key|OPENAI_API_KEY/i);
    expect(document.querySelector('input[type="password"]')).toBeNull();
  });

  it("guides login in Terminal when Codex is not authenticated (never asks for credentials)", () => {
    render(
      <SessionProvider me={owner}>
        <ProviderSettings
          providers={[
            codex({
              state: "login_required",
              detail: "Login required. Open Terminal and run: codex",
            }),
          ]}
        />
      </SessionProvider>,
    );
    const setup = screen.getByTestId("codex-cli-setup");
    expect(setup).toHaveTextContent("OpenAI Codex is not authenticated.");
    expect(setup).toHaveTextContent("Open Terminal.");
    expect(setup).toHaveTextContent("codex");
    expect(setup).toHaveTextContent("Sign in with your ChatGPT account.");
    expect(screen.getAllByText("Login required").length).toBeGreaterThan(0);
    expect(document.querySelector("input[type='password']")).toBeNull();
  });

  it("shows a ChatGPT usage-limit state without ever switching to API billing", () => {
    render(
      <SessionProvider me={owner}>
        <ProviderSettings
          providers={[
            codex({
              state: "rate_limited",
              connected: false,
              rateLimit: { status: "rejected", resetsAt: null, type: null },
            }),
          ]}
        />
      </SessionProvider>,
    );
    expect(screen.getByTestId("codex-cli-facts")).toHaveTextContent(
      "ChatGPT plan usage limit reached",
    );
    // No leaked key value and no password-style credential field anywhere.
    expect(document.body.textContent).not.toMatch(/OPENAI_API_KEY=|sk-[a-zA-Z0-9]/);
    expect(document.querySelector('input[type="password"]')).toBeNull();
  });

  it("tests the Codex connection when connected", async () => {
    const fn = stubApi([
      ["/test", { data: { state: "available", detail: "Connection verified" } }, 200, "POST"],
    ]);
    const u = userEvent.setup();
    render(
      <SessionProvider me={owner}>
        <ProviderSettings providers={[codex({ connected: true, state: "available" })]} />
      </SessionProvider>,
    );
    await u.click(screen.getByRole("button", { name: "Test Codex Connection" }));
    expect(await screen.findByText(/Test result: available/)).toBeInTheDocument();
    expect(calls(fn, "POST", "/v1/providers/OPENAI/test")).toHaveLength(1);
  });
});

describe("Task run panel", () => {
  it("previews provider/model/effort/cost, runs, streams live output and shows the result", async () => {
    const fn = stubApi([
      ["/run-preview", { data: preview() }],
      ["/runs", { data: { status: "started", run: run({ status: "queued" }) } }, 201, "POST"],
      ["/runs", { data: [] }],
      [
        "/feedback",
        {
          data: run({
            status: "completed",
            result: RESULT,
            feedback: { rating: "useful", note: null, by: null },
            viewer: { canStop: false, canFeedback: true, canRequestReview: false },
          }),
        },
        200,
        "POST",
      ],
    ]);
    const u = userEvent.setup();
    render(<TaskRunPanel taskId="t1" />);
    const pv = await screen.findByTestId("provider-preview");
    expect(pv).toHaveTextContent("Claude Sonnet 5");
    expect(pv).toHaveTextContent("medium");
    expect(pv).toHaveTextContent("~6,200 tokens");
    expect(screen.getByTestId("estimated-cost")).toHaveTextContent("$0.05");
    await u.click(screen.getByRole("button", { name: "Run" }));
    expect(calls(fn, "POST", "/v1/tasks/t1/runs")).toHaveLength(1);
    await waitFor(() => expect(FakeEventSource.instances.length).toBeGreaterThan(0));
    const es = FakeEventSource.instances.at(-1)!;
    expect(es.url).toBe("/api/v1/runs/run-1/stream");
    es.push({ kind: "snapshot", run: run() });
    es.push({ kind: "chunk", text: "Drafting the brief" });
    es.push({
      kind: "event",
      event: {
        id: "e1",
        seq: 1,
        type: "PROVIDER_STREAM_STARTED",
        label: "Generating result",
        detail: null,
        data: {},
        occurredAt: new Date().toISOString(),
      },
    });
    const panel = screen.getByTestId("live-run-panel");
    expect(within(panel).getByTestId("run-output")).toHaveTextContent("Drafting the brief");
    expect(within(panel).getByTestId("provider-badge")).toHaveTextContent(
      "Claude · Claude Sonnet 5· medium effort",
    );
    expect(within(panel).getByTestId("run-timeline")).toHaveTextContent("Generating result");
    es.push({
      kind: "snapshot",
      run: run({
        status: "completed",
        result: RESULT,
        actualCostUsd: 0.031,
        usage: {
          inputTokens: 6100,
          outputTokens: 900,
          cacheCreationTokens: 1200,
          cacheReadTokens: 0,
        },
        viewer: { canStop: false, canFeedback: true, canRequestReview: false },
      }),
    });
    expect(await screen.findByTestId("run-result")).toHaveTextContent(
      "EPT focuses on premium European pilot training.",
    );
    expect(screen.getByTestId("run-result")).toHaveTextContent(
      "Proposed handoffs — require delegation checks",
    );
    expect(screen.getByTestId("run-usage")).toHaveTextContent("Cache write1,200");
    await u.click(screen.getByRole("button", { name: "Useful" }));
    expect(calls(fn, "POST", "/feedback")).toHaveLength(1);
  });

  it("warns about premium cost and shows blockers", async () => {
    stubApi([
      [
        "/run-preview",
        {
          data: {
            ...preview({
              model: "claude-opus-5-5",
              modelLabel: "Claude Opus 5.5",
              tier: "premium",
              effort: "high",
            }),
          },
        },
      ],
      ["/runs", { data: [] }],
    ]);
    render(<TaskRunPanel taskId="t1" />);
    expect(await screen.findByText(/Premium model — expect roughly double/)).toBeInTheDocument();
    expect(screen.getByTestId("provider-preview")).toHaveTextContent("Claude Opus 5.5");
  });

  it("disables Run when not eligible and lists why", async () => {
    stubApi([
      [
        "/run-preview",
        {
          data: {
            ...preview({
              provider: null,
              blockedReason:
                "PROVIDER_NOT_CONFIGURED: CLAUDE is not connected; fallback not permitted by company policy",
            }),
            eligible: false,
            reasons: [
              "PROVIDER_NOT_CONFIGURED: CLAUDE is not connected; fallback not permitted by company policy",
            ],
          },
        },
      ],
      ["/runs", { data: [] }],
    ]);
    render(<TaskRunPanel taskId="t1" />);
    expect(await screen.findByTestId("run-blockers")).toHaveTextContent("PROVIDER_NOT_CONFIGURED");
    expect(screen.getByRole("button", { name: "Run" })).toBeDisabled();
  });

  it("shows history, a failed run and stops an active run", async () => {
    const fn = stubApi([
      ["/run-preview", { data: preview() }],
      ["/cancel", { data: run({ status: "cancel_requested" }) }, 200, "POST"],
      [
        "/runs",
        {
          data: [
            { ...run({ id: "run-2", number: 2, status: "streaming" }) },
            {
              ...run({
                id: "run-1",
                number: 1,
                status: "failed",
                errorCode: "RATE_LIMITED",
                errorMessage: "Provider rate limit reached",
                actualCostUsd: null,
              }),
            },
          ],
        },
      ],
    ]);
    const u = userEvent.setup();
    render(<TaskRunPanel taskId="t1" />);
    const history = await screen.findByTestId("run-history");
    expect(within(history).getAllByRole("button")).toHaveLength(2);
    expect(history).toHaveTextContent("Failed");
    await waitFor(() =>
      expect(FakeEventSource.instances.some((e) => e.url.includes("run-2"))).toBe(true),
    );
    FakeEventSource.instances
      .find((e) => e.url.includes("run-2"))!
      .push({ kind: "snapshot", run: run({ id: "run-2", number: 2 }) });
    await u.click(screen.getByRole("button", { name: "Stop run" }));
    expect(calls(fn, "POST", "/v1/runs/run-2/cancel")).toHaveLength(1);
    // Opening the failed run shows its error.
    await u.click(within(history).getByRole("button", { name: /#1/ }));
    await waitFor(() =>
      expect(FakeEventSource.instances.some((e) => e.url.includes("run-1"))).toBe(true),
    );
    FakeEventSource.instances
      .find((e) => e.url.includes("run-1"))!
      .push({
        kind: "snapshot",
        run: run({
          id: "run-1",
          status: "failed",
          errorCode: "RATE_LIMITED",
          errorMessage: "Provider rate limit reached",
          viewer: { canStop: false, canFeedback: false, canRequestReview: false },
        }),
      });
    expect(await screen.findByTestId("run-error")).toHaveTextContent(
      "RATE_LIMITED: Provider rate limit reached",
    );
  });
});

describe("Agent chat", () => {
  const conv: ConversationDTO = {
    id: "c1",
    company: ept,
    agent: { id: "a1", name: "EPT Company Manager" },
    task: null,
    title: null,
    status: "open",
    messageCount: 0,
    lastMessageAt: null,
    createdAt: new Date().toISOString(),
  };
  const msg = (role: "human" | "agent", content: string, extra = {}) => ({
    id: `${role}-${content}`,
    role,
    author: role === "human" ? "Platform Owner" : "Agent",
    content,
    createdAt: new Date().toISOString(),
    runId: "run-9",
    runStatus: null,
    provider: role === "agent" ? "CLAUDE" : null,
    model: role === "agent" ? "claude-sonnet-5" : null,
    ...extra,
  });

  it("sends a message, streams the reply with model indicator and supports stop", async () => {
    let replied = false;
    const fn = vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const body = (d: unknown) => Promise.resolve(new Response(JSON.stringify({ data: d })));
      if (url.includes("/active-run")) return body({ runId: null });
      if (url.includes("/cancel")) return body(run({ status: "cancel_requested" }));
      if (url.includes("/messages") && method === "POST")
        return body({ runId: "run-9", messages: [msg("human", "What is your role?")] });
      if (url.includes("/messages"))
        return body(
          replied
            ? [msg("human", "What is your role?"), msg("agent", "I manage EPT operations.")]
            : [],
        );
      return body([conv]);
    });
    vi.stubGlobal("fetch", fn);
    const u = userEvent.setup();
    render(
      <SessionProvider
        me={{ ...ME_OWNER, globalPermissions: [...ME_OWNER.globalPermissions, "agent.chat"] }}
      >
        <AgentChatShell agentId="a1" companies={[{ id: ept.id, name: ept.name }]} />
      </SessionProvider>,
    );
    await u.click(await screen.findByRole("button", { name: /Euro Pilot Training conversation/ }));
    expect(screen.getByText(/Company: Euro Pilot Training/)).toBeInTheDocument();
    await u.type(screen.getByLabelText("Message"), "What is your role?");
    await u.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() =>
      expect(FakeEventSource.instances.some((e) => e.url.includes("run-9"))).toBe(true),
    );
    const es = FakeEventSource.instances.find((e) => e.url.includes("run-9"))!;
    es.push({
      kind: "snapshot",
      run: run({ id: "run-9", executionType: "chat", task: null, conversationId: "c1" }),
    });
    es.push({ kind: "chunk", text: "I manage EPT" });
    expect(screen.getByTestId("chat-streaming")).toHaveTextContent("I manage EPT");
    expect(screen.getByTestId("chat-streaming")).toHaveTextContent("Claude Sonnet 5");
    await u.click(screen.getByRole("button", { name: "Stop generating" }));
    expect(
      fn.mock.calls.some(
        ([url, init]) => String(url).includes("/v1/runs/run-9/cancel") && init?.method === "POST",
      ),
    ).toBe(true);
    replied = true;
    es.push({
      kind: "snapshot",
      run: run({
        id: "run-9",
        status: "completed",
        executionType: "chat",
        task: null,
        outputText: "I manage EPT operations.",
      }),
    });
    const list = await screen.findByTestId("chat-messages");
    await waitFor(() => expect(list).toHaveTextContent("I manage EPT operations."));
    expect(list).toHaveTextContent("Claude Sonnet 5");
  });
});

describe("second-opinion review UI", () => {
  const REVIEW = {
    agreementPoints: ["The response aligns with EPT's supplied context."],
    disagreementPoints: ["The pricing figure is not directly supported by the context."],
    possibleErrors: [],
    missingConsiderations: ["Seasonal demand was not addressed."],
    unsupportedClaims: [],
    risks: ["Relying on this without further review could overstate confidence."],
    suggestedCorrections: ["Add a caveat about seasonal variation."],
    confidence: "medium" as const,
    overallReviewSummary: "Mostly supported by context, with one gap worth flagging.",
  };

  it("shows an Ask OpenAI to review button on a completed Claude run when permitted, and requests it", async () => {
    const fn = stubApi([
      ["/review", { data: { status: "started", run: run({ provider: "OPENAI" }) } }, 201, "POST"],
      ["/runs/run-1", { data: run({ status: "completed", result: RESULT }) }],
    ]);
    const u = userEvent.setup();
    const onChange = vi.fn();
    render(
      <LiveRunPanel
        run={run({
          status: "completed",
          result: RESULT,
          purpose: "primary",
          viewer: { canStop: false, canFeedback: true, canRequestReview: true },
        })}
        output=""
        onChange={onChange}
      />,
    );
    const button = screen.getByRole("button", { name: "Ask OpenAI to review" });
    await u.click(button);
    expect(await screen.findByText(/Second-opinion review requested from OpenAI/)).toBeInTheDocument();
    expect(calls(fn, "POST", "/v1/runs/run-1/review")).toHaveLength(1);
    await waitFor(() => expect(onChange).toHaveBeenCalled());
  });

  it("hides the ask-to-review button when the viewer lacks permission", () => {
    render(
      <LiveRunPanel
        run={run({
          status: "completed",
          result: RESULT,
          purpose: "primary",
          viewer: { canStop: false, canFeedback: true, canRequestReview: false },
        })}
        output=""
      />,
    );
    expect(screen.queryByRole("button", { name: /Ask .* to review/ })).not.toBeInTheDocument();
  });

  it("shows the review card — separated from the original result, never merged — instead of the ask button once a review exists", () => {
    render(
      <LiveRunPanel
        run={run({
          status: "completed",
          result: RESULT,
          purpose: "primary",
          review: REVIEW,
          viewer: { canStop: false, canFeedback: true, canRequestReview: true },
        })}
        output=""
      />,
    );
    expect(screen.getByTestId("run-result")).toHaveTextContent(RESULT.summary);
    const card = screen.getByTestId("review-card");
    expect(card).toHaveTextContent("Second opinion");
    expect(card).toHaveTextContent("Mostly supported by context");
    expect(card).toHaveTextContent("Seasonal demand was not addressed");
    expect(card).toHaveTextContent("Add a caveat about seasonal variation");
    expect(screen.queryByRole("button", { name: /Ask .* to review/ })).not.toBeInTheDocument();
    // Never a "winner" verdict between providers.
    expect(card.textContent).not.toMatch(/wins|winner/i);
  });

  it("labels a second-opinion run itself with a SECOND OPINION badge, not an ask-to-review button", () => {
    render(
      <LiveRunPanel
        run={run({
          status: "completed",
          result: null,
          provider: "OPENAI",
          purpose: "second_opinion",
          reviewedRunId: "run-0",
          viewer: { canStop: false, canFeedback: false, canRequestReview: true },
        })}
        output=""
      />,
    );
    expect(screen.getByTestId("run-purpose-badge")).toHaveTextContent("SECOND OPINION");
    expect(screen.queryByRole("button", { name: /Ask .* to review/ })).not.toBeInTheDocument();
  });
});
