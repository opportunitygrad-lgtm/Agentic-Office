/**
 * MANUAL live check of the OPTIONAL Anthropic API transport — `pnpm test:claude-live`.
 * (The default Claude transport is Claude Code; see `pnpm test:claude-subscription-live`.)
 *
 * Never part of `pnpm test` / `pnpm test:e2e`. Refuses unless
 * ALLOW_LIVE_AI_TESTS=true AND an Anthropic credential is configured.
 * Spends real credit: 1 connection test (no tokens), 1 short Sonnet 5 task,
 * 1 short scoped chat reply. Never uses the premium model.
 */
import { eq } from "drizzle-orm";
import { executeRun } from "@aibos/execution-core";
import { createProviderRegistry } from "@aibos/provider-core";
import { createDb } from "../client";
import { loadEnv, requireEnv } from "../env";
import { assignTask, createWorkforceTask } from "../repositories/delegation";
import { startChatRun, startTaskRun } from "../repositories/execution";
import { createConversation } from "../repositories/handoffs";
import { createRunStore, testProviderConnection } from "../repositories/runs";
import { resolveCompany } from "../repositories/companies";
import { agentRuns, agents, conversationMessages, tasks, users } from "../schema";

loadEnv();
if (process.env.ALLOW_LIVE_AI_TESTS !== "true") {
  console.error(
    "Refusing: live AI tests spend real credit. Set ALLOW_LIVE_AI_TESTS=true to run them explicitly.",
  );
  process.exit(2);
}
if (!process.env.ANTHROPIC_API_KEY?.trim() && !process.env.ANTHROPIC_AUTH_TOKEN?.trim()) {
  console.error(
    "Anthropic credential not configured. Add ANTHROPIC_API_KEY or an approved bearer credential to the local .env and restart the services.",
  );
  process.exit(3);
}

const handle = createDb(requireEnv("DATABASE_URL"));
const db = handle.db;
const registry = createProviderRegistry({
  mode: "live",
  env: { ...process.env, CLAUDE_TRANSPORT: "anthropic_api" },
});
const env = { registry, timeoutMs: 120_000, historyLimit: 6 };
const store = createRunStore(db, env, { publish: () => {} });

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

  const health = await testProviderConnection(db, registry, "CLAUDE", actor);
  console.log(`Connection test: ${health.state} (${health.detail})`);
  if (health.state !== "available") process.exit(4);

  const created = await createWorkforceTask(
    db,
    {
      companyId: company.id,
      title: `[DEV SMOKE TEST] EPT internal summary ${new Date().toISOString().slice(0, 16)}`,
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
  const outcome = await executeRun(started.runId, { store, provider: registry.get("CLAUDE") });
  const [run] = await db.select().from(agentRuns).where(eq(agentRuns.id, started.runId));
  console.log(
    "\nTASK SMOKE",
    JSON.stringify(
      {
        outcome,
        model: run!.model,
        status: run!.status,
        inputTokens: run!.inputTokens,
        outputTokens: run!.outputTokens,
        cacheCreationTokens: run!.cacheCreationTokens,
        cacheReadTokens: run!.cacheReadTokens,
        actualCostUsd: run!.actualCost,
        latencyMs: run!.latencyMs,
        errorCode: run!.errorCode,
      },
      null,
      2,
    ),
  );
  console.log(
    "Summary:",
    (run!.result as { summary?: string } | null)?.summary ?? run!.errorMessage,
  );
  // Clearly mark the development test task as finished.
  await db.update(tasks).set({ status: "completed" }).where(eq(tasks.id, taskId));

  const conversationId = await createConversation(
    db,
    { agentId: manager.id, companyId: company.id, title: "[DEV SMOKE TEST] scoped chat" },
    actor,
  );
  const chat = await startChatRun(
    db,
    env,
    conversationId,
    "What is your current responsibility and what information are you allowed to use?",
    actor,
    { viewerMaxSensitivity: "internal" },
  );
  const chatOutcome = await executeRun(chat.runId, { store, provider: registry.get("CLAUDE") });
  const [chatRun] = await db.select().from(agentRuns).where(eq(agentRuns.id, chat.runId));
  const [reply] = await db
    .select()
    .from(conversationMessages)
    .where(eq(conversationMessages.runId, chat.runId))
    .orderBy(conversationMessages.createdAt);
  console.log(
    "\nCHAT SMOKE",
    JSON.stringify(
      {
        outcome: chatOutcome,
        model: chatRun!.model,
        inputTokens: chatRun!.inputTokens,
        outputTokens: chatRun!.outputTokens,
        cacheReadTokens: chatRun!.cacheReadTokens,
        actualCostUsd: chatRun!.actualCost,
        latencyMs: chatRun!.latencyMs,
      },
      null,
      2,
    ),
  );
  console.log("Reply:", chatRun!.outputText.slice(0, 600) || reply?.content);
  process.exitCode = outcome === "completed" && chatOutcome === "completed" ? 0 : 1;
} finally {
  await handle.close();
}
