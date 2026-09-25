#!/usr/bin/env node
// Fake Claude Code CLI for automated tests — never contacts Anthropic and never
// consumes subscription usage. Behaviour comes from $CLAUDE_CONFIG_DIR/scenario.json;
// each invocation is recorded to $CLAUDE_CONFIG_DIR/invocations.jsonl.
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = process.env.CLAUDE_CONFIG_DIR;
const args = process.argv.slice(2);
let scenario = { name: "ok" };
try {
  scenario = JSON.parse(readFileSync(join(dir, "scenario.json"), "utf8"));
} catch {
  // No scenario file → default "ok" behaviour.
}
const out = (o) => process.stdout.write(JSON.stringify(o) + "\n");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const argAfter = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};

const FLAGS = [
  "--print",
  "--output-format",
  "--verbose",
  "--model",
  "--tools",
  "--system-prompt",
  "--no-session-persistence",
  "--include-partial-messages",
  "--effort",
  "--strict-mcp-config",
  "--safe-mode",
  "--restricted",
  "--disable-slash-commands",
  "--permission-prompts",
];

if (args[0] === "--version") {
  console.log(`${scenario.version ?? "9.9.9"} (Claude Code)`);
  process.exit(0);
}
if (args[0] === "--help") {
  const flags = scenario.name === "old_version" ? FLAGS.filter((f) => f !== "--tools") : FLAGS;
  console.log("Usage: claude [options]\n" + flags.map((f) => `  ${f}`).join("\n"));
  process.exit(0);
}
if (args[0] === "auth" && args[1] === "status") {
  const loggedIn = scenario.name !== "login_required";
  console.log(
    JSON.stringify({
      loggedIn,
      authMethod: scenario.authMethod ?? (loggedIn ? "claude.ai" : "none"),
      apiProvider: scenario.apiProvider ?? "firstParty",
    }),
  );
  process.exit(loggedIn ? 0 : 1);
}

let stdin = "";
for await (const c of process.stdin) stdin += c;
if (dir)
  appendFileSync(
    join(dir, "invocations.jsonl"),
    JSON.stringify({
      args,
      stdin,
      envKeys: Object.keys(process.env).sort(),
      baseUrl: process.env.ANTHROPIC_BASE_URL ?? null,
      maxOutputTokens: process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS ?? null,
      pid: process.pid,
    }) + "\n",
  );
if (scenario.name === "slow" && dir) writeFileSync(join(dir, "pid"), String(process.pid));

const session_id = "00000000-0000-4000-8000-000000000001";
const model = argAfter("--model") === "opus" ? "claude-opus-5-5" : "claude-sonnet-5";
out({
  type: "system",
  subtype: "init",
  apiKeySource: scenario.apiKeySource ?? "none",
  model,
  session_id,
  tools: [],
  mcp_servers: [],
});

const errorTurn = (error, extra = {}) => {
  out({
    type: "assistant",
    error,
    message: { content: [{ type: "text", text: "error" }] },
    parent_tool_use_id: null,
    session_id,
  });
  out({
    type: "result",
    subtype: "success",
    is_error: true,
    result: "error",
    session_id,
    ...extra,
  });
  process.exit(1);
};
if (scenario.name === "login_required" || scenario.name === "login_expired")
  errorTurn("authentication_failed");
if (scenario.name === "rate_limited") {
  out({
    type: "rate_limit_event",
    rate_limit_info: { status: "rejected", rateLimitType: "five_hour", resetsAt: 1790000000 },
    session_id,
  });
  errorTurn("rate_limit");
}
if (scenario.name === "opus_unavailable" && argAfter("--model") === "opus")
  errorTurn("model_not_found");
if (scenario.name === "crash") process.exit(3);

out({
  type: "rate_limit_event",
  rate_limit_info: { status: "allowed", rateLimitType: "five_hour" },
  session_id,
});
const structured =
  args.includes("--system-prompt") && /Output format/.test(argAfter("--system-prompt") ?? "");
const text =
  scenario.text ??
  (structured
    ? JSON.stringify({
        status: "completed",
        summary: "Fake Claude Code summary",
        response: "Fake Claude Code response using only the supplied context.",
        keyFindings: ["Fake finding"],
        proposedNextActions: [],
        proposedHandoffs: [],
        proposedKnowledgeDrafts: [],
        warnings: [],
        confidence: "medium",
      })
    : `Fake Claude Code reply to: ${stdin.slice(-80)}`);
const chunks = text.match(/.{1,40}/gs) ?? [text];
for (const c of chunks) {
  if (scenario.name === "slow") await sleep(scenario.delayMs ?? 200);
  out({
    type: "stream_event",
    event: {
      type: "content_block_delta",
      index: 0,
      delta: { type: "thinking_delta", thinking: "HIDDEN" },
    },
    parent_tool_use_id: null,
    session_id,
  });
  out({
    type: "stream_event",
    event: { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: c } },
    parent_tool_use_id: null,
    session_id,
  });
}
out({
  type: "assistant",
  request_id: "req_fake_1",
  message: {
    content: [
      { type: "thinking", thinking: "HIDDEN" },
      { type: "text", text },
    ],
  },
  parent_tool_use_id: null,
  session_id,
});
out({
  type: "result",
  subtype: "success",
  is_error: false,
  result: text,
  stop_reason: "end_turn",
  duration_ms: 10,
  total_cost_usd: 0.01,
  usage: {
    input_tokens: 1200,
    output_tokens: 300,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 800,
  },
  modelUsage: { [model]: { inputTokens: 1200, outputTokens: 300 } },
  session_id,
});
