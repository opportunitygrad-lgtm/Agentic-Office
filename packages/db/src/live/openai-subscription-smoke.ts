/**
 * MANUAL live acceptance of the DEFAULT OpenAI transport: the owner's local,
 * ChatGPT-subscription-authenticated Codex CLI — `pnpm test:openai-subscription-live`.
 *
 * Never part of `pnpm test` / `pnpm test:e2e`. Refuses unless
 * ALLOW_LIVE_AI_TESTS=true. Uses a small amount of ChatGPT Codex subscription
 * usage: local CLI checks (no model call), 1 short primary task, 1 short
 * second-opinion review. Never invokes live Claude — the "original" result the
 * review critiques is a stored fixture, not a real Claude call, so this test
 * never spends two providers' subscriptions at once. Never reads Codex
 * credentials: it only runs `codex`.
 */
import { eq, inArray } from "drizzle-orm";
import { executeRun } from "@aibos/execution-core";
import { CodexCliProvider, createProviderRegistry } from "@aibos/provider-core";
import { agentExecutionResultSchema, providerReviewSchema } from "@aibos/shared";
import { createDb } from "../client";
import { loadEnv, requireEnv } from "../env";
import { assignTask, createWorkforceTask } from "../repositories/delegation";
import { startTaskRun, requestSecondOpinion } from "../repositories/execution";
import { createRunStore, testProviderConnection } from "../repositories/runs";
import { resolveCompany } from "../repositories/companies";
import { agentRuns, agents, aiUsageRecords, auditEvents, tasks, users } from "../schema";

loadEnv();
if (process.env.ALLOW_LIVE_AI_TESTS !== "true") {
  console.error(
    "Refusing: live AI tests use real ChatGPT Codex subscription usage. Set ALLOW_LIVE_AI_TESTS=true to run them explicitly.",
  );
  process.exit(2);
}

const handle = createDb(requireEnv("DATABASE_URL"));
const db = handle.db;
const registry = createProviderRegistry({
  mode: "live",
  env: { ...process.env, OPENAI_TRANSPORT: "codex_cli" },
});
const openai = registry.get("OPENAI");
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

const FIXTURE_RESULT = {
  status: "completed" as const,
  summary: "EPT's operating rules emphasise premium positioning and internal-only data use.",
  response:
    "This is a stored fixture standing in for a Claude result — no live Claude call was made. " +
    "It exists only so this live test can exercise a real second-opinion review without " +
    "spending two providers' subscriptions in one run.",
  keyFindings: ["Fixture result — not a live Claude output"],
  proposedNextActions: ["None — this is a fixture for live review testing"],
  proposedHandoffs: [],
  proposedKnowledgeDrafts: [],
  warnings: ["This result is a fixture, not real analysis"],
  confidence: "low" as const,
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

  // 1. Connection / auth verification (local CLI checks only — no model call).
  check("OpenAI transport is Codex CLI (subscription)", openai instanceof CodexCliProvider);
  const health = await testProviderConnection(db, registry, "OPENAI", actor);
  console.log(
    `Codex CLI: ${health.state} — ${health.detail} (version ${health.cli?.version ?? "?"}, auth ${health.cli?.authMethod ?? "?"})`,
  );
  check("Codex CLI binary exists", health.state !== "not_installed");
  check("Codex authentication is active", health.state === "available");
  check(
    "No API-key transport (ChatGPT subscription login, first-party)",
    health.state === "available" && openai.billingMode === "subscription",
  );
  if (health.state !== "available") process.exit(4);

  // 2. One short OpenAI/Codex primary task.
  const created = await createWorkforceTask(
    db,
    {
      companyId: company.id,
      title: `[DEV SMOKE TEST] OpenAI Codex subscription ${new Date().toISOString().slice(0, 16)}`,
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
    { responseDetail: "short", provider: "OPENAI" },
    actor,
    { viewerMaxSensitivity: "internal" },
  );
  if (started.status !== "started") throw new Error(`Run not started: ${JSON.stringify(started)}`);
  const outcome = await executeRun(started.runId, { store, provider: openai });
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
  check("Codex task completed", outcome === "completed");
  check("Streaming delivered output chunks", taskChunks > 0);
  check(
    "Result persisted and valid (AgentExecutionResult)",
    agentExecutionResultSchema.safeParse(run!.result).success,
  );
  await db.update(tasks).set({ status: "completed" }).where(eq(tasks.id, taskId));

  // 3. One short second-opinion review — of a stored FIXTURE "Claude" result,
  // never a live Claude call, so this test spends only Codex subscription usage.
  const fixtureTask = await createWorkforceTask(
    db,
    {
      companyId: company.id,
      title: `[DEV SMOKE TEST] Fixture for Codex review ${new Date().toISOString().slice(0, 16)}`,
      description: "Summarise EPT's current objective and operating rules in one paragraph.",
      type: "custom",
      onDuplicate: "create",
      requirements: {},
    },
    actor,
  );
  const fixtureTaskId = fixtureTask.task!.id;
  await assignTask(db, fixtureTaskId, { agentId: manager.id }, actor);
  const fixtureStarted = await startTaskRun(db, env, fixtureTaskId, {}, actor, {
    viewerMaxSensitivity: "internal",
  });
  if (fixtureStarted.status !== "started")
    throw new Error(`Fixture run not started: ${JSON.stringify(fixtureStarted)}`);
  // Mark the fixture run completed directly with a stored fixture result — this
  // never calls any provider (live Claude included).
  await db
    .update(agentRuns)
    .set({
      status: "completed",
      completedAt: new Date(),
      outputText: FIXTURE_RESULT.response,
      result: FIXTURE_RESULT,
      inputTokens: 1200,
      outputTokens: 180,
      latencyMs: 1,
      actualCost: null,
      reservationStatus: "settled",
    })
    .where(eq(agentRuns.id, fixtureStarted.runId));
  await db.update(tasks).set({ status: "completed" }).where(eq(tasks.id, fixtureTaskId));

  const review = await requestSecondOpinion(db, env, fixtureStarted.runId, "OPENAI", actor, {
    viewerMaxSensitivity: "internal",
  });
  const reviewOutcome = await executeRun(review.runId, { store, provider: openai });
  const [reviewRun] = await db.select().from(agentRuns).where(eq(agentRuns.id, review.runId));
  console.log(
    "\nSECOND OPINION SMOKE",
    JSON.stringify(
      {
        sourceProvider: "CLAUDE (fixture, not live)",
        reviewerProvider: reviewRun!.provider,
        reviewerModel: reviewRun!.model,
        outcome: reviewOutcome,
        status: reviewRun!.status,
        billingMode: reviewRun!.billingMode,
        actualApiCost: reviewRun!.actualCost,
        latencyMs: reviewRun!.latencyMs,
      },
      null,
      2,
    ),
  );
  console.log("Review summary:", (reviewRun!.result as { overallReviewSummary?: string } | null)?.overallReviewSummary ?? "-");
  check("Second-opinion review completed", reviewOutcome === "completed");
  check(
    "Review result persisted and valid (ProviderReview)",
    providerReviewSchema.safeParse(reviewRun!.result).success,
  );
  check("Review never reviewed itself", reviewRun!.provider !== "CLAUDE");

  // Audit + usage accounting.
  const runIds = [started.runId, review.runId];
  const audit = await db
    .select({ action: auditEvents.action })
    .from(auditEvents)
    .where(inArray(auditEvents.resourceId, runIds));
  const actions = new Set(audit.map((a) => a.action));
  check(
    "Audit recorded (run created/started/completed, usage, second opinion requested)",
    [
      "agent_run.created",
      "agent_run.started",
      "agent_run.completed",
      "ai.usage_recorded",
      "agent_run.second_opinion_requested",
    ].every((a) => actions.has(a)),
  );
  const usage = await db.select().from(aiUsageRecords).where(inArray(aiUsageRecords.runId, runIds));
  check(
    "Usage marked SUBSCRIPTION via Codex CLI",
    usage.length === 2 &&
      usage.every((u) => u.billingMode === "subscription" && u.transport === "codex_cli"),
  );
  check(
    "Actual API cost is zero / N/A for both runs",
    usage.every((u) => u.actualCost === 0 && u.providerCost === 0) &&
      run!.actualCost === null &&
      reviewRun!.actualCost === null,
  );

  const failed = Object.entries(checks).filter(([, ok]) => !ok);
  console.log(
    `\n${failed.length ? "FAILED" : "ALL CHECKS PASSED"} (${Object.keys(checks).length} checks)`,
  );
  process.exitCode = failed.length ? 1 : 0;
} finally {
  await handle.close();
}
