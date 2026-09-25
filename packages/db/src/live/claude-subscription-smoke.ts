/**
 * MANUAL live acceptance of the DEFAULT Claude transport: the owner's local,
 * subscription-authenticated Claude Code — `pnpm test:claude-subscription-live`.
 *
 * Never part of `pnpm test` / `pnpm test:e2e`. Refuses unless
 * ALLOW_LIVE_AI_TESTS=true. Uses a small amount of Claude subscription usage:
 * local CLI checks (no model call), 1 short Sonnet task, 1 short scoped chat.
 * Never uses Opus. Never reads Claude credentials: it only runs `claude`.
 */
import { and, eq, inArray } from "drizzle-orm";
import { executeRun } from "@aibos/execution-core";
import { ClaudeCodeProvider, createProviderRegistry } from "@aibos/provider-core";
import { agentExecutionResultSchema } from "@aibos/shared";
import { createDb } from "../client";
import { loadEnv, requireEnv } from "../env";
import { assignTask, createWorkforceTask } from "../repositories/delegation";
import { startChatRun, startTaskRun } from "../repositories/execution";
import { createConversation } from "../repositories/handoffs";
import { createRunStore, testProviderConnection } from "../repositories/runs";
import { resolveCompany } from "../repositories/companies";
import {
  agentRuns,
  agents,
  aiUsageRecords,
  auditEvents,
  conversationMessages,
  tasks,
  users,
} from "../schema";

loadEnv();
if (process.env.ALLOW_LIVE_AI_TESTS !== "true") {
  console.error(
    "Refusing: live AI tests use real Claude subscription usage. Set ALLOW_LIVE_AI_TESTS=true to run them explicitly.",
  );
  process.exit(2);
}

const handle = createDb(requireEnv("DATABASE_URL"));
const db = handle.db;
const registry = createProviderRegistry({
  mode: "live",
  env: { ...process.env, CLAUDE_TRANSPORT: "claude_code" },
});
const claude = registry.get("CLAUDE");
const env = { registry, timeoutMs: 180_000, historyLimit: 6 };
let chunks = 0;
const store = createRunStore(db, env, {
  publish: (_runId, m) => {
    if (m.kind === "chunk") chunks++;
  },
});
const checks: Record<string, boolean> = {};
const check = (name: string, ok: boolean) => {
  checks[name] = ok;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
};

try {
  const [owner] = await db
    .select()
    .from(users)
    .where(eq(users.email, process.env.LIVE_TEST_USER_EMAIL ?? "owner@aibos.example"));
  if (!owner) throw new Error("Live test user not found (set LIVE_TEST_USER_EMAIL)");
  const actor = { kind: "human" as const, ref: owner.email, userId: owner.id };
  const company = await resolveCompany(db, "euro-pilot-training");
  if (!company) throw new Error("Euro Pilot Training not found");
  const [manager] = await db.select().from(agents).where(eq(agents.name, "EPT Company Manager"));
  if (!manager) throw new Error("EPT Company Manager not found");

  // 1–3. Binary, login, and no API-key transport (local CLI checks only).
  check("Claude transport is Claude Code (subscription)", claude instanceof ClaudeCodeProvider);
  const health = await testProviderConnection(db, registry, "CLAUDE", actor);
  console.log(
    `Claude Code: ${health.state} — ${health.detail} (version ${health.cli?.version ?? "?"}, auth ${health.cli?.authMethod ?? "?"}${health.cli?.subscriptionType ? `, plan ${health.cli.subscriptionType}` : ""})`,
  );
  check("Claude Code binary exists", health.state !== "not_installed");
  check("Claude Code authentication is active", health.state === "available");
  check(
    "No API-key transport (subscription login, first-party)",
    health.state === "available" && claude.billingMode === "subscription",
  );
  if (health.state !== "available") process.exit(4);

  // 4. One small Sonnet task.
  const created = await createWorkforceTask(
    db,
    {
      companyId: company.id,
      title: `[DEV SMOKE TEST] Claude Code subscription ${new Date().toISOString().slice(0, 16)}`,
      description:
        "Using only the approved company context currently available, provide a concise internal summary of the company's current objective, important operating rules, and three sensible internal next actions. Do not perform external research.",
      type: "custom",
      onDuplicate: "create",
      requirements: {},
    },
    actor,
  );
  const taskId = created.task!.id;
  await db.update(tasks).set({ responseDetail: "short" }).where(eq(tasks.id, taskId));
  await assignTask(db, taskId, { agentId: manager.id }, actor);
  const started = await startTaskRun(
    db,
    env,
    taskId,
    { modelTier: "standard", responseDetail: "short" },
    actor,
    { viewerMaxSensitivity: "internal" },
  );
  if (started.status !== "started") throw new Error(`Run not started: ${JSON.stringify(started)}`);
  const outcome = await executeRun(started.runId, { store, provider: claude });
  const [run] = await db.select().from(agentRuns).where(eq(agentRuns.id, started.runId));
  const taskChunks = chunks;
  console.log(
    "\nTASK SMOKE",
    JSON.stringify(
      {
        outcome,
        requestedModel: run!.model,
        status: run!.status,
        transport: run!.transport,
        billingMode: run!.billingMode,
        inputTokens: run!.inputTokens,
        outputTokens: run!.outputTokens,
        cacheCreationTokens: run!.cacheCreationTokens,
        cacheReadTokens: run!.cacheReadTokens,
        actualApiCost: run!.actualCost,
        apiEquivalentNotBilledUsd: run!.apiEquivalentCost,
        latencyMs: run!.latencyMs,
        errorCode: run!.errorCode,
        errorMessage: run!.errorMessage,
      },
      null,
      2,
    ),
  );
  console.log("Summary:", (run!.result as { summary?: string } | null)?.summary ?? "-");
  check("Sonnet task completed", outcome === "completed");
  check("Streaming delivered output chunks", taskChunks > 0);
  check(
    "Result persisted and valid (AgentExecutionResult)",
    agentExecutionResultSchema.safeParse(run!.result).success,
  );
  await db.update(tasks).set({ status: "completed" }).where(eq(tasks.id, taskId));

  // 5. One short chat.
  const conversationId = await createConversation(
    db,
    { agentId: manager.id, companyId: company.id, title: "[DEV SMOKE TEST] subscription chat" },
    actor,
  );
  const chat = await startChatRun(
    db,
    env,
    conversationId,
    "In two sentences: what is your responsibility and what information may you use?",
    actor,
    { viewerMaxSensitivity: "internal" },
  );
  const chatOutcome = await executeRun(chat.runId, { store, provider: claude });
  const [chatRun] = await db.select().from(agentRuns).where(eq(agentRuns.id, chat.runId));
  const [reply] = await db
    .select()
    .from(conversationMessages)
    .where(and(eq(conversationMessages.runId, chat.runId), eq(conversationMessages.role, "agent")));
  console.log(
    "\nCHAT SMOKE",
    JSON.stringify(
      {
        outcome: chatOutcome,
        requestedModel: chatRun!.model,
        billingMode: chatRun!.billingMode,
        inputTokens: chatRun!.inputTokens,
        outputTokens: chatRun!.outputTokens,
        cacheReadTokens: chatRun!.cacheReadTokens,
        actualApiCost: chatRun!.actualCost,
        apiEquivalentNotBilledUsd: chatRun!.apiEquivalentCost,
        latencyMs: chatRun!.latencyMs,
        errorCode: chatRun!.errorCode,
      },
      null,
      2,
    ),
  );
  console.log("Reply:", (reply?.content ?? chatRun!.outputText).slice(0, 600));
  check("Chat completed and reply stored", chatOutcome === "completed" && !!reply);

  // 8–10. Audit, SUBSCRIPTION usage, zero API cost.
  const runIds = [started.runId, chat.runId];
  const audit = await db
    .select({ action: auditEvents.action })
    .from(auditEvents)
    .where(inArray(auditEvents.resourceId, runIds));
  const actions = new Set(audit.map((a) => a.action));
  check(
    "Audit recorded (run created/started/completed, usage)",
    ["agent_run.created", "agent_run.started", "agent_run.completed", "ai.usage_recorded"].every(
      (a) => actions.has(a),
    ),
  );
  const usage = await db.select().from(aiUsageRecords).where(inArray(aiUsageRecords.runId, runIds));
  check(
    "Usage marked SUBSCRIPTION via Claude Code",
    usage.length === 2 &&
      usage.every((u) => u.billingMode === "subscription" && u.transport === "claude_code_cli"),
  );
  check(
    "Actual API cost is zero / N/A",
    usage.every((u) => u.actualCost === 0 && u.providerCost === 0) &&
      run!.actualCost === null &&
      chatRun!.actualCost === null,
  );
  const failed = Object.entries(checks).filter(([, ok]) => !ok);
  console.log(
    `\n${failed.length ? "FAILED" : "ALL CHECKS PASSED"} (${Object.keys(checks).length} checks)`,
  );
  process.exitCode = failed.length ? 1 : 0;
} finally {
  await handle.close();
}
