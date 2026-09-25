#!/usr/bin/env node
// Fake Codex CLI for automated tests — never contacts OpenAI and never
// consumes ChatGPT subscription usage. Behaviour comes from
// $CODEX_HOME/scenario.json; each invocation is recorded to
// $CODEX_HOME/invocations.jsonl. Event shapes match Codex CLI 0.157.0's
// `codex exec --json` (thread.started / turn.started / item.* / turn.completed
// / turn.failed / error) and `codex doctor --json` (checks["auth.credentials"]).
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = process.env.CODEX_HOME;
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

if (args[0] === "--version") {
  console.log(`codex-cli ${scenario.version ?? "9.9.9"}`);
  process.exit(0);
}
if (args[0] === "exec" && args[1] === "--help") {
  const flags = [
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
    "--model",
  ];
  console.log(
    "Usage: codex exec [OPTIONS]\n" +
      (scenario.name === "old_version" ? flags.slice(0, -3) : flags).map((f) => `  ${f}`).join("\n"),
  );
  process.exit(0);
}
if (args[0] === "doctor" && args.includes("--json")) {
  const loggedIn = scenario.name !== "login_required";
  const apiKeyMode = scenario.authMode === "api_key";
  const details = apiKeyMode
    ? { "stored auth mode": "api_key", "stored API key": "true", "stored ChatGPT tokens": "false" }
    : { "stored auth mode": "chatgpt", "stored API key": "false", "stored ChatGPT tokens": "true" };
  console.log(
    JSON.stringify({
      schemaVersion: 1,
      overallStatus: loggedIn ? "ok" : "fail",
      codexVersion: scenario.version ?? "9.9.9",
      checks: {
        "auth.credentials": loggedIn
          ? { id: "auth.credentials", category: "auth", status: "ok", summary: "auth is configured", details }
          : {
              id: "auth.credentials",
              category: "auth",
              status: "fail",
              summary: "no Codex credentials were found",
              details: {},
              remediation: "Run codex login or provide an API key through a supported auth env var.",
            },
      },
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
      pid: process.pid,
    }) + "\n",
  );
if (scenario.name === "slow" && dir) writeFileSync(join(dir, "pid"), String(process.pid));

const thread_id = "00000000-0000-4000-8000-000000000002";

const fail = (message) => {
  out({ type: "turn.failed", error: { message } });
  process.exit(1);
};

if (scenario.name === "login_required" || scenario.name === "login_expired") {
  out({ type: "thread.started", thread_id });
  out({ type: "turn.started" });
  fail("You are not authenticated. Please log in.");
  process.exit(0);
}
if (scenario.name === "crash") process.exit(3);

out({ type: "thread.started", thread_id });
out({ type: "turn.started" });

if (scenario.name === "usage_limit") fail("ChatGPT usage limit reached for this plan.");
if (scenario.name === "opus_unavailable" && argAfter("--model") === "premium-model")
  fail("The requested model is not available on this account.");

const structured = args.includes("--output-schema");
const text =
  scenario.text ??
  (structured
    ? JSON.stringify({
        status: "completed",
        summary: "Fake Codex summary",
        response: "Fake Codex response using only the supplied context.",
        keyFindings: ["Fake finding"],
        proposedNextActions: [],
        proposedHandoffs: [],
        proposedKnowledgeDrafts: [],
        warnings: [],
        confidence: "medium",
      })
    : `Fake Codex reply to: ${stdin.slice(-80)}`);

out({
  type: "item.started",
  item: { id: "item_reasoning_0", type: "reasoning", text: "" },
});
out({
  type: "item.updated",
  item: { id: "item_reasoning_0", type: "reasoning", text: "HIDDEN internal reasoning" },
});
out({
  type: "item.completed",
  item: { id: "item_reasoning_0", type: "reasoning", text: "HIDDEN internal reasoning" },
});

out({ type: "item.started", item: { id: "item_msg_0", type: "agent_message", text: "" } });
const chunks = text.match(/.{1,40}/gs) ?? [text];
let acc = "";
for (const c of chunks) {
  if (scenario.name === "slow") await sleep(scenario.delayMs ?? 200);
  acc += c;
  out({ type: "item.updated", item: { id: "item_msg_0", type: "agent_message", text: acc } });
}
out({ type: "item.completed", item: { id: "item_msg_0", type: "agent_message", text: acc } });

out({
  type: "turn.completed",
  usage: {
    input_tokens: 1100,
    cached_input_tokens: 700,
    cache_write_input_tokens: 0,
    output_tokens: 280,
    reasoning_output_tokens: 40,
  },
});
