import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import type { ProviderInput, RunSnapshot, RunStore, SavedResponse } from "@aibos/execution-core";
import {
  costOfUsage,
  modelLabel,
  type CliInfo,
  type ModelPrice,
  type ProviderRegistry,
  type ProviderResult,
  type RateLimitState,
} from "@aibos/provider-core";
import {
  ACTIVE_RUN_STATUSES,
  PROVIDER_LABELS,
  PROVIDER_TYPES,
  RUN_PHASE_LABELS,
  agentExecutionResultSchema,
  agentProviderSettingsSchema,
  providerReviewSchema,
  providerSettingsSchema,
  runFeedbackSchema,
  type AgentExecutionResult,
  type AgentPerformanceDTO,
  type AgentRunDTO,
  type AgentRunDetailDTO,
  type AgentRunEventDTO,
  type AgentRunStatus,
  type BillingMode,
  type ProviderErrorCode,
  type ProviderHealthState,
  type ProviderReview,
  type ProviderStatusDTO,
  type ProviderTransport,
  type ProviderType,
  type RunEventType,
  type RunPurpose,
  type RunStreamMessage,
} from "@aibos/shared";
import type { z } from "zod";
import type { Database } from "../client";
import { ConflictError, NotFoundError } from "../errors";
import {
  agentCompanyAssignments,
  agentRunEvents,
  agentRunFeedback,
  agentRunReviews,
  agentRuns,
  agents,
  aiModelPrices,
  aiProviderSettings,
  aiUsageRecords,
  companies,
  companyAiPolicies,
  conversationMessages,
  conversations,
  tasks,
  users,
  type AgentRun,
} from "../schema";
import { recordAuditEvent } from "./audit";
import { appendRunEvent, planForRun, type ExecutionEnv } from "./execution";
import { displayNameOf } from "./identity";
import { createKnowledge } from "./knowledge";
import {
  actorAuditFields,
  scopeWhere,
  serviceActor,
  startOfUtcDay,
  type AccessScope,
  type Actor,
} from "./util";
import { refreshAgentStates } from "./workforce";

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Db = Database | Tx;

const WORKER = serviceActor("agent-worker");
const FINAL: AgentRunStatus[] = ["completed", "failed", "cancelled", "needs_review"];
const LEASE_SECONDS = 300;

const workerAudit = (run: AgentRun) => ({
  ...actorAuditFields({ ...WORKER, agentId: run.agentId ?? undefined }),
  companyId: run.companyId ?? undefined,
  agentId: run.agentId ?? undefined,
  taskId: run.taskId ?? undefined,
  resourceType: "agent_run",
  resourceId: run.id,
});

async function getRun(db: Db, runId: string): Promise<AgentRun> {
  const [r] = await db.select().from(agentRuns).where(eq(agentRuns.id, runId));
  if (!r) throw new NotFoundError("Run", runId);
  return r;
}

/* ---------- provider health ---------- */

const STATE_FOR_CODE: Partial<Record<ProviderErrorCode, ProviderHealthState>> = {
  RATE_LIMITED: "rate_limited",
  SUBSCRIPTION_LIMIT_REACHED: "rate_limited",
  AUTH_ERROR: "auth_error",
  PERMISSION_ERROR: "auth_error",
  NOT_INSTALLED: "not_installed",
  LOGIN_REQUIRED: "login_required",
  LOGIN_EXPIRED: "login_expired",
  MISCONFIGURED: "misconfigured",
  API_BILLING_REFUSED: "misconfigured",
  SERVER_ERROR: "degraded",
  OVERLOADED: "degraded",
  NETWORK_ERROR: "degraded",
  TIMEOUT: "degraded",
};

/**
 * Health is driven by real call outcomes (no background polling):
 * success → AVAILABLE; usage/rate limit → RATE_LIMITED; login problems →
 * LOGIN_REQUIRED / LOGIN_EXPIRED; transient failures → DEGRADED, and
 * UNAVAILABLE after three in a row. Premium unavailability on a subscription
 * only marks the premium model unavailable — standard work continues.
 */
export async function recordProviderOutcome(
  db: Db,
  provider: ProviderType,
  outcome:
    | { ok: true; rateLimit?: RateLimitState | null; tier?: string }
    | { code: ProviderErrorCode; message?: string; tier?: string },
) {
  const now = new Date();
  await db.insert(aiProviderSettings).values({ provider }).onConflictDoNothing();
  if ("ok" in outcome) {
    await db
      .update(aiProviderSettings)
      .set({
        healthState: "available",
        healthDetail: null,
        lastSuccessAt: now,
        consecutiveFailures: 0,
        ...(outcome.rateLimit ? { rateLimit: outcome.rateLimit } : {}),
        ...(outcome.tier === "premium" ? { premiumAvailable: true } : {}),
      })
      .where(eq(aiProviderSettings.provider, provider));
    return;
  }
  const code = outcome.code;
  if (code === "MODEL_UNAVAILABLE") {
    if (outcome.tier === "premium")
      await db
        .update(aiProviderSettings)
        .set({ premiumAvailable: false, lastErrorAt: now, lastErrorCode: code })
        .where(eq(aiProviderSettings.provider, provider));
    return;
  }
  const state = STATE_FOR_CODE[code] ?? null;
  if (!state) return; // request-specific errors (invalid request, refusal, cancellation) say nothing about health
  const resetsAt = /resets ([0-9TZ:.-]+)/.exec(outcome.message ?? "")?.[1] ?? null;
  await db
    .update(aiProviderSettings)
    .set({
      healthState: sql`case when ${state} = 'degraded' and ${aiProviderSettings.consecutiveFailures} >= 2 then 'unavailable'::provider_health_state else ${state}::provider_health_state end`,
      healthDetail: outcome.message ?? code,
      lastErrorAt: now,
      lastErrorCode: code,
      consecutiveFailures: sql`${aiProviderSettings.consecutiveFailures} + 1`,
      ...(state === "rate_limited"
        ? { rateLimit: { status: "rejected", type: null, resetsAt } }
        : {}),
    })
    .where(eq(aiProviderSettings.provider, provider));
}

export async function providerStatuses(
  db: Database,
  registry: ProviderRegistry,
): Promise<ProviderStatusDTO[]> {
  const day = startOfUtcDay(new Date());
  const [settings, usage, prices] = await Promise.all([
    db.select().from(aiProviderSettings),
    db
      .select({
        provider: aiUsageRecords.provider,
        calls: sql<number>`count(*)::int`,
        // Only API-billed usage is spend; subscription rows are always 0 anyway.
        spend: sql<number>`coalesce(sum(${aiUsageRecords.actualCost}) filter (where ${aiUsageRecords.billingMode} = 'api'), 0)::float8`,
        subscriptionRuns: sql<number>`count(*) filter (where ${aiUsageRecords.billingMode} = 'subscription')::int`,
      })
      .from(aiUsageRecords)
      .where(
        and(
          sql`${aiUsageRecords.occurredAt} >= ${day.toISOString()}::timestamptz`,
          eq(aiUsageRecords.origin, "live"),
          isNotNull(aiUsageRecords.runId),
        ),
      )
      .groupBy(aiUsageRecords.provider),
    db.select().from(aiModelPrices).orderBy(desc(aiModelPrices.effectiveFrom)),
  ]);
  return PROVIDER_TYPES.map((provider) => {
    const p = registry.get(provider);
    const s = settings.find((x) => x.provider === provider);
    const m = registry.models[provider];
    const cliTransport = p.transport === "claude_code_cli";
    const configured = p.available();
    const recorded = s?.healthState ?? null;
    // Claude Code has no credential for the OS to inspect: its state comes from
    // explicit Test Connection (local CLI checks) and real run outcomes.
    const state: ProviderHealthState = cliTransport
      ? p.isMock
        ? configured
          ? "available"
          : "login_required"
        : (recorded ?? "not_configured")
      : !configured
        ? "not_configured"
        : recorded === "not_configured" || !recorded
          ? "available"
          : recorded;
    const u = usage.find((x) => x.provider === provider);
    const cli = (s?.cliInfo ?? null) as CliInfo | null;
    const rateLimit = (s?.rateLimit ?? null) as RateLimitState | null;
    const detail = cliTransport
      ? state === "not_configured"
        ? "Claude Code has not been checked yet — click TEST CLAUDE CODE."
        : (s?.healthDetail ??
          (p.isMock ? "Deterministic mock Claude Code — no AI is called" : null))
      : !configured
        ? provider === "CLAUDE"
          ? "Anthropic credential not configured. Add ANTHROPIC_API_KEY or an approved bearer credential to the local .env and restart the services."
          : "Not connected in this stage"
        : (s?.healthDetail ?? (p.isMock ? "Deterministic mock provider — no AI is called" : null));
    return {
      provider,
      label: PROVIDER_LABELS[provider],
      connected: cliTransport ? state === "available" : configured,
      isMock: p.isMock,
      state,
      detail,
      transport: p.transport,
      authMode: p.authMode,
      billingMode: p.billingMode,
      cli: cliTransport
        ? {
            binary: cli?.binary ?? (p.isMock ? "mock" : "claude"),
            version: cli?.version ?? null,
            authMethod: cli?.authMethod ?? null,
            subscriptionType: cli?.subscriptionType ?? null,
            maxConcurrency: (p as unknown as { maxConcurrency?: number }).maxConcurrency ?? 1,
          }
        : null,
      premiumAvailable: s?.premiumAvailable ?? null,
      rateLimit: rateLimit
        ? { status: rateLimit.status, resetsAt: rateLimit.resetsAt, type: rateLimit.type }
        : null,
      runsToday: u?.subscriptionRuns ?? 0,
      enabled: s?.enabled ?? true,
      standardModel: m ? (s?.standardModel ?? m.standardModel) : null,
      premiumModel: m ? (s?.premiumModel ?? m.premiumModel) : null,
      standardEffort: m ? (s?.standardEffort ?? m.standardEffort) : null,
      premiumEffort: m ? (s?.premiumEffort ?? m.premiumEffort) : null,
      dailyBudgetUsd: s?.dailyBudgetUsd ?? null,
      lastHealthCheckAt: s?.lastHealthCheckAt?.toISOString() ?? null,
      lastSuccessAt: s?.lastSuccessAt?.toISOString() ?? null,
      lastErrorAt: s?.lastErrorAt?.toISOString() ?? null,
      lastErrorCode: s?.lastErrorCode ?? null,
      callsToday: u?.calls ?? 0,
      spendTodayUsd: Math.round((u?.spend ?? 0) * 1e4) / 1e4,
      prices: prices
        .filter((x) => x.provider === provider)
        .map((x) => ({
          model: x.model,
          inputPerMTok: x.inputPerMTok,
          outputPerMTok: x.outputPerMTok,
          cacheWritePerMTok: x.cacheWritePerMTok,
          cacheReadPerMTok: x.cacheReadPerMTok,
          effectiveFrom: x.effectiveFrom.toISOString(),
          source: x.source,
        })),
    };
  });
}

export async function updateProviderSettings(
  db: Database,
  provider: ProviderType,
  input: z.input<typeof providerSettingsSchema>,
  actor: Actor,
) {
  const data = providerSettingsSchema.parse(input);
  await db.transaction(async (tx) => {
    await tx.insert(aiProviderSettings).values({ provider }).onConflictDoNothing();
    await tx
      .update(aiProviderSettings)
      .set({ ...data, updatedByUserId: actor.userId ?? null })
      .where(eq(aiProviderSettings.provider, provider));
    await recordAuditEvent(tx, {
      ...actorAuditFields(actor),
      resourceType: "ai_provider",
      resourceId: provider,
      action: "provider.settings_updated",
      description: `${PROVIDER_LABELS[provider]} settings updated`,
      after: data,
    });
  });
}

/** Explicit Test Connection: the smallest authenticated operation, audited. */
export async function testProviderConnection(
  db: Database,
  registry: ProviderRegistry,
  provider: ProviderType,
  actor: Actor,
) {
  const p = registry.get(provider);
  const models = registry.models[provider];
  const health = await p.healthCheck({ probe: true, model: models?.standardModel });
  await db.insert(aiProviderSettings).values({ provider }).onConflictDoNothing();
  await db
    .update(aiProviderSettings)
    .set({
      healthState: health.state,
      healthDetail: health.detail,
      lastHealthCheckAt: health.checkedAt,
      // CLI facts only (version, auth method, plan) — never credentials.
      ...(health.cli !== undefined ? { cliInfo: health.cli } : {}),
      ...(health.state === "available" && p.available()
        ? { lastSuccessAt: health.checkedAt, consecutiveFailures: 0 }
        : {}),
    })
    .where(eq(aiProviderSettings.provider, provider));
  await recordAuditEvent(db, {
    ...actorAuditFields(actor),
    resourceType: "ai_provider",
    resourceId: provider,
    action: provider === "CLAUDE" ? "claude.connection_tested" : "provider.connection_tested",
    description: `${p.displayName} connection test: ${health.state}`,
    outcome: health.state === "available" ? "success" : "failure",
    metadata: {
      state: health.state,
      detail: health.detail,
      isMock: p.isMock,
      transport: p.transport,
      cliVersion: health.cli?.version ?? null,
    },
  });
  return health;
}

/* ---------- worker-side RunStore ---------- */

export interface RunPublisher {
  publish(runId: string, message: RunStreamMessage): void;
}

function eventDTO(row: typeof agentRunEvents.$inferSelect): AgentRunEventDTO {
  const type = row.type as RunEventType;
  return {
    id: row.id,
    seq: row.seq,
    type,
    label: RUN_PHASE_LABELS[type] ?? type,
    detail: row.detail,
    data: (row.data ?? {}) as Record<string, unknown>,
    occurredAt: row.occurredAt.toISOString(),
  };
}

/**
 * Database-backed RunStore for @aibos/execution-core. Every state change is a
 * conditional update, so a cancelled or finalised run can never be revived.
 */
export function createRunStore(
  db: Database,
  env: ExecutionEnv,
  publisher: RunPublisher,
): RunStore & { flush(runId: string): Promise<void> } {
  const queues = new Map<string, Promise<void>>();
  const buffers = new Map<string, string>();
  const timers = new Map<string, ReturnType<typeof setInterval>>();

  const serial = (runId: string, fn: () => Promise<void>) => {
    const next = (queues.get(runId) ?? Promise.resolve()).then(fn, fn);
    queues.set(
      runId,
      next.catch(() => {}),
    );
    return next;
  };
  const flush = async (runId: string) => {
    const text = buffers.get(runId);
    if (!text) return;
    buffers.set(runId, "");
    await db
      .update(agentRuns)
      .set({ outputText: sql`${agentRuns.outputText} || ${text}` })
      .where(eq(agentRuns.id, runId));
  };
  const stopBuffer = async (runId: string) => {
    const t = timers.get(runId);
    if (t) clearInterval(t);
    timers.delete(runId);
    buffers.delete(runId);
    await queues.get(runId);
    queues.delete(runId);
  };
  const event = (
    runId: string,
    type: RunEventType,
    detail: string | null = null,
    data: Record<string, unknown> = {},
  ) =>
    serial(runId, async () => {
      await appendRunEvent(db, runId, type, detail, data);
      const [row] = await db
        .select()
        .from(agentRunEvents)
        .where(eq(agentRunEvents.runId, runId))
        .orderBy(desc(agentRunEvents.seq))
        .limit(1);
      if (row) publisher.publish(runId, { kind: "event", event: eventDTO(row) });
    });
  // Second-opinion runs share the reviewed run's taskId/agentId for budget and
  // history grouping, but never hold or clear the task claim — that belongs
  // solely to the primary run that is actually doing the task's work.
  const releaseClaim = async (tx: Db, run: AgentRun) => {
    if (run.taskId && run.agentId && run.runPurpose !== "second_opinion")
      await tx
        .update(tasks)
        .set({ claimedByAgentId: null, claimedAt: null, leaseExpiresAt: null })
        .where(and(eq(tasks.id, run.taskId), eq(tasks.claimedByAgentId, run.agentId)));
  };
  const releaseReservation = {
    reservationStatus: sql`case when ${agentRuns.reservationStatus} = 'active' then 'released' else ${agentRuns.reservationStatus} end`,
  };
  const chatNotice = async (tx: Db, run: AgentRun, content: string) => {
    if (run.conversationId)
      await tx
        .insert(conversationMessages)
        .values({ conversationId: run.conversationId, role: "system", content, runId: run.id });
  };
  const status = (runId: string, s: AgentRunStatus) =>
    publisher.publish(runId, {
      kind: "status",
      status: s,
      phase: RUN_PHASE_LABELS[s === "streaming" ? "PROVIDER_STREAM_STARTED" : "RUN_CREATED"] ?? s,
    });

  return {
    flush,
    async load(runId): Promise<RunSnapshot | null> {
      const [r] = await db.select().from(agentRuns).where(eq(agentRuns.id, runId));
      if (!r) return null;
      return {
        id: r.id,
        executionType: r.executionType,
        status: r.status,
        providerModel: r.model,
        effort: r.effort,
        maxOutputTokens: r.maxOutputTokens,
        timeoutMs: r.timeoutMs,
        maxRetries: r.maxRetries,
        retryCount: r.retryCount,
        providerCallStartedAt: r.providerCallStartedAt,
        responseSaved: !!r.responseSavedAt,
      };
    },
    async begin(runId) {
      const taken = await db
        .update(agentRuns)
        .set({ status: "preparing" })
        .where(and(eq(agentRuns.id, runId), eq(agentRuns.status, "queued")))
        .returning({ id: agentRuns.id });
      if (taken.length) status(runId, "preparing");
      return taken.length === 1;
    },
    async transition(runId, next) {
      const [before] = await db
        .select({ startedAt: agentRuns.startedAt, status: agentRuns.status })
        .from(agentRuns)
        .where(eq(agentRuns.id, runId));
      const updated = await db
        .update(agentRuns)
        .set({
          status: next,
          ...(next === "running"
            ? { startedAt: sql`coalesce(${agentRuns.startedAt}, now())` }
            : {}),
        })
        .where(
          and(
            eq(agentRuns.id, runId),
            sql`${agentRuns.status} not in ('completed','failed','cancelled','needs_review','cancel_requested')`,
          ),
        )
        .returning();
      const run = updated[0];
      if (!run) return false;
      status(runId, next);
      if (next === "running" && before && !before.startedAt) {
        // A second-opinion run shares the reviewed run's taskId for grouping only —
        // it never drives that task's own status (the task may already be completed).
        if (run.taskId && run.runPurpose !== "second_opinion")
          await db
            .update(tasks)
            .set({ status: "running", startedAt: sql`coalesce(${tasks.startedAt}, now())` })
            .where(eq(tasks.id, run.taskId));
        await recordAuditEvent(db, {
          ...workerAudit(run),
          action: "agent_run.started",
          description: `Agent run started (${modelLabel(run.model)})`,
        });
        if (run.agentId) await refreshAgentStates(db, [run.agentId]);
      }
      return true;
    },
    event,
    chunk(runId, text) {
      publisher.publish(runId, { kind: "chunk", text });
      buffers.set(runId, (buffers.get(runId) ?? "") + text);
      if (!timers.has(runId))
        timers.set(
          runId,
          setInterval(() => void serial(runId, () => flush(runId)), 750),
        );
    },
    async prepare(runId): Promise<ProviderInput> {
      const run = await getRun(db, runId);
      const plan = await planForRun(db, env, runId);
      if (plan.route.provider !== run.provider)
        throw new ConflictError("Provider policy changed since the run was created");
      const s = plan.contextSummary;
      await db
        .update(agentRuns)
        .set({
          contextVersion: plan.context.version,
          instructionVersion: plan.instructions.version,
          contextSummary: s,
        })
        .where(eq(agentRuns.id, runId));
      await event(
        runId,
        "CONTEXT_READY",
        `${s.knowledgeItems} knowledge items · ${s.criticalRules} critical rules · ~${s.approxTokens} tokens`,
        s,
      );
      await event(
        runId,
        "INSTRUCTIONS_COMPILED",
        `${plan.instructions.metadata.ruleCount} rules · ${plan.instructions.version}`,
        { roleVersion: plan.instructions.metadata.roleVersion },
      );
      return plan.input;
    },
    async markProviderCallStarted(runId, attempt) {
      const [run] = await db
        .update(agentRuns)
        .set({ providerCallStartedAt: new Date(), retryCount: attempt })
        .where(eq(agentRuns.id, runId))
        .returning();
      if (run)
        await recordAuditEvent(db, {
          ...workerAudit(run),
          action: "provider.call_started",
          description: `${run.provider} ${run.model} call started (attempt ${attempt + 1})`,
        });
    },
    async markProviderCallFailed(runId, attempt, code, message) {
      const [run] = await db
        .update(agentRuns)
        .set({ providerCallStartedAt: null })
        .where(eq(agentRuns.id, runId))
        .returning();
      if (!run) return;
      await recordProviderOutcome(db, run.provider, { code, message, tier: run.tier });
      await recordAuditEvent(db, {
        ...workerAudit(run),
        action: "provider.call_failed",
        description: `${run.provider} call failed: ${code}`,
        outcome: "failure",
        metadata: { attempt, code },
      });
    },
    async saveResponse(runId, result) {
      await serial(runId, async () => {
        const timer = timers.get(runId);
        if (timer) clearInterval(timer);
        timers.delete(runId);
        buffers.delete(runId);
      });
      await db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`run-save:${runId}`}))`);
        const run = await getRun(tx, runId);
        if (run.responseSavedAt) return; // idempotent
        const price = run.priceSnapshot as ModelPrice | null;
        // Subscription (Claude Code) usage is included in the plan: actual API
        // cost is N/A (stored as NULL on the run, 0 in the ledger) and only a
        // clearly-labelled, NOT BILLED API-equivalent estimate is kept.
        const subscription = run.billingMode === "subscription";
        const usageCost = price ? costOfUsage(price, result.usage) : 0;
        const cost = subscription ? 0 : usageCost;
        const apiEquivalent = subscription && price ? usageCost : null;
        await tx
          .update(agentRuns)
          .set({
            outputText: result.text,
            result: (result.structured ?? null) as never,
            stopReason: result.stopReason,
            providerRequestId: result.requestId,
            inputTokens: result.usage.inputTokens,
            outputTokens: result.usage.outputTokens,
            cacheCreationTokens: result.usage.cacheCreationTokens,
            cacheReadTokens: result.usage.cacheReadTokens,
            actualCost: subscription ? null : cost,
            apiEquivalentCost: apiEquivalent,
            latencyMs: result.latencyMs,
            responseSavedAt: new Date(),
          })
          .where(eq(agentRuns.id, runId));
        // Mock runs are recorded as development data so they never count as real spend.
        await tx.insert(aiUsageRecords).values({
          provider: run.provider,
          // The model that actually ran (Claude Code resolves aliases such as "sonnet").
          model: result.model || run.model,
          companyId: run.companyId,
          agentId: run.agentId,
          taskId: run.taskId,
          requestId: result.requestId,
          runId,
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          cachedTokens: result.usage.cacheReadTokens,
          cacheCreationTokens: result.usage.cacheCreationTokens,
          cacheReadTokens: result.usage.cacheReadTokens,
          providerCost: cost,
          estimatedCost: run.estimatedCost,
          actualCost: cost,
          priceSnapshot: price,
          transport: run.transport,
          billingMode: run.billingMode,
          apiEquivalentCost: apiEquivalent,
          rateLimit: result.rateLimit ?? null,
          origin: run.isMock ? "dev_seed" : "live",
        });
        await recordProviderOutcome(tx, run.provider, {
          ok: true,
          rateLimit: result.rateLimit,
          tier: run.tier,
        });
        await recordAuditEvent(tx, {
          ...workerAudit(run),
          action: "provider.call_completed",
          description: `${run.provider} ${run.model} responded in ${result.latencyMs}ms`,
          metadata: {
            requestId: result.requestId,
            stopReason: result.stopReason,
            latencyMs: result.latencyMs,
          },
        });
        await recordAuditEvent(tx, {
          ...workerAudit(run),
          action: "ai.usage_recorded",
          description: subscription
            ? `Subscription usage recorded (${result.usage.inputTokens} in / ${result.usage.outputTokens} out${run.isMock ? ", mock" : ""}) — no API cost`
            : `AI usage recorded: $${cost} (${result.usage.inputTokens} in / ${result.usage.outputTokens} out${run.isMock ? ", mock" : ""})`,
          metadata: {
            ...result.usage,
            costUsd: cost,
            billingMode: run.billingMode,
            transport: run.transport,
            apiEquivalentUsd: apiEquivalent,
            isMock: run.isMock,
          },
        });
      });
      const run = await getRun(db, runId);
      await event(
        runId,
        "PROVIDER_RESPONSE_RECEIVED",
        `${result.usage.outputTokens} output tokens · ${(result.latencyMs / 1000).toFixed(1)}s`,
        { stopReason: result.stopReason },
      );
      await event(
        runId,
        "USAGE_RECORDED",
        run.billingMode === "subscription"
          ? `Subscription usage${run.isMock ? " (mock)" : ""} — no API cost`
          : `$${run.actualCost ?? 0}${run.isMock ? " (mock)" : ""}`,
        {
          ...result.usage,
          costUsd: run.actualCost,
          billingMode: run.billingMode,
          apiEquivalentUsd: run.apiEquivalentCost,
        },
      );
    },
    async loadSavedResponse(runId): Promise<ProviderResult | null> {
      const r = await getRun(db, runId);
      if (!r.responseSavedAt) return null;
      return {
        provider: r.provider,
        model: r.model,
        text: r.outputText,
        structured: r.result,
        stopReason: r.stopReason,
        requestId: r.providerRequestId,
        usage: {
          inputTokens: r.inputTokens ?? 0,
          outputTokens: r.outputTokens ?? 0,
          cacheCreationTokens: r.cacheCreationTokens ?? 0,
          cacheReadTokens: r.cacheReadTokens ?? 0,
        },
        latencyMs: r.latencyMs ?? 0,
      };
    },
    async validateStructured(runId, data) {
      const run = await getRun(db, runId);
      const schema = run.runPurpose === "second_opinion" ? providerReviewSchema : agentExecutionResultSchema;
      return schema.safeParse(data);
    },
    async finalize(runId, saved: SavedResponse) {
      const structured = saved.structured;
      let drafts: AgentExecutionResult["proposedKnowledgeDrafts"] = [];
      const run = await db.transaction(async (tx) => {
        const [r] = await tx
          .update(agentRuns)
          .set({
            status: "completed",
            completedAt: new Date(),
            result: (structured ?? null) as never,
            providerCallStartedAt: null,
            reservationStatus: sql`case when ${agentRuns.reservationStatus} = 'active' then 'settled' else ${agentRuns.reservationStatus} end`,
          })
          .where(
            and(
              eq(agentRuns.id, runId),
              sql`${agentRuns.status} not in ('completed','failed','cancelled','needs_review')`,
            ),
          )
          .returning();
        if (!r) return null;
        // Validated by executeRun() before finalize() is ever called (see RunStore.validateStructured).
        const taskResult = r.executionType === "task" ? (structured as AgentExecutionResult | null) : null;
        if (taskResult && r.taskId) {
          await tx
            .update(tasks)
            .set(
              taskResult.status === "completed"
                ? {
                    status: "completed",
                    completedAt: new Date(),
                    progress: 100,
                    resultSummary: taskResult.summary,
                    error: null,
                  }
                : {
                    status: "waiting",
                    resultSummary: taskResult.summary,
                    error:
                      taskResult.status === "blocked" ? "Agent reported the task is blocked" : null,
                  },
            )
            .where(eq(tasks.id, r.taskId));
          await releaseClaim(tx, r);
          for (const h of taskResult.proposedHandoffs)
            await recordAuditEvent(tx, {
              ...workerAudit(r),
              action: "ai.handoff_proposed",
              description: `Handoff proposed to ${h.department}: ${h.objective}`,
              metadata: h,
            });
          drafts = taskResult.proposedKnowledgeDrafts;
        }
        if (r.executionType === "chat" && r.conversationId) {
          await tx.insert(conversationMessages).values({
            conversationId: r.conversationId,
            role: "agent",
            content: saved.result.text,
            runId: r.id,
            provider: r.provider,
            model: r.model,
          });
          await tx
            .update(conversations)
            .set({ updatedAt: new Date() })
            .where(eq(conversations.id, r.conversationId));
          await recordAuditEvent(tx, {
            ...workerAudit(r),
            resourceType: "conversation",
            resourceId: r.conversationId,
            action: "agent.response_created",
            description: `Agent reply created (${r.outputTokens ?? 0} tokens)`,
          });
        }
        await recordAuditEvent(tx, {
          ...workerAudit(r),
          action: "agent_run.completed",
          description:
            r.billingMode === "subscription"
              ? "Agent run completed (Claude subscription — no API cost)"
              : `Agent run completed ($${r.actualCost ?? 0})`,
          metadata: {
            costUsd: r.actualCost,
            billingMode: r.billingMode,
            latencyMs: r.latencyMs,
            status: taskResult?.status ?? "text",
          },
        });
        return r;
      });
      if (!run) return;
      // Knowledge proposals become DRAFT, unverified items at most — never approved facts.
      for (const d of drafts) {
        if (!run.companyId) break;
        try {
          const item = await createKnowledge(
            db,
            {
              scope: "company",
              companyId: run.companyId,
              title: d.title.slice(0, 200) || "AI knowledge proposal",
              summary: d.summary.slice(0, 1000) || null,
              content: d.content.slice(0, 20_000) || d.summary || "(empty)",
              type: "custom",
              sourceType: run.provider === "CLAUDE" ? "claude_research" : "system_generated",
              sourceReference: `Agent run ${run.id}`,
              confidence: "low",
              verificationStatus: "unverified",
              provenanceNotes:
                "Proposed by an AI agent run. Not authoritative — requires human review and approval.",
            },
            { ...WORKER, agentId: run.agentId ?? undefined },
          );
          await recordAuditEvent(db, {
            ...workerAudit(run),
            action: "ai.knowledge_draft_proposed",
            description: `Knowledge draft proposed: ${item.title}`,
            metadata: { knowledgeId: item.id },
          });
        } catch {
          await recordAuditEvent(db, {
            ...workerAudit(run),
            action: "ai.knowledge_draft_proposed",
            description: "Knowledge draft proposal could not be stored",
            outcome: "failure",
          });
        }
      }
      if (run.executionType === "task") {
        const taskStatus = (structured as AgentExecutionResult | null)?.status;
        await event(
          runId,
          "TASK_COMPLETED",
          taskStatus === "completed" ? "Task completed" : `Agent reported: ${taskStatus}`,
        );
      }
      if (run.runPurpose === "second_opinion" && run.reviewedRunId)
        await event(
          run.reviewedRunId,
          "REVIEW_COMPLETED",
          `Second opinion from ${run.provider} completed`,
          { reviewerRunId: run.id, reviewerProvider: run.provider },
        );
      status(runId, "completed");
      if (run.agentId) await refreshAgentStates(db, [run.agentId]);
      await stopBuffer(runId);
    },
    async fail(runId, code, message) {
      await serial(runId, () => flush(runId));
      const run = await db.transaction(async (tx) => {
        const [r] = await tx
          .update(agentRuns)
          .set({
            status: "failed",
            errorCode: code,
            errorMessage: message.slice(0, 500),
            completedAt: new Date(),
            providerCallStartedAt: null,
            ...releaseReservation,
          })
          .where(
            and(
              eq(agentRuns.id, runId),
              sql`${agentRuns.status} not in ('completed','failed','cancelled','needs_review')`,
            ),
          )
          .returning();
        if (!r) return null;
        await releaseClaim(tx, r);
        if (r.taskId && r.executionType === "task")
          await tx
            .update(tasks)
            .set({ error: `Agent run failed: ${code}` })
            .where(eq(tasks.id, r.taskId));
        await chatNotice(tx, r, `The agent could not reply (${code}). You can retry.`);
        await recordAuditEvent(tx, {
          ...workerAudit(r),
          action: "agent_run.failed",
          description: `Agent run failed: ${code}`,
          outcome: "failure",
          metadata: { code },
        });
        return r;
      });
      if (!run) return;
      await event(runId, "RUN_FAILED", `${code}: ${message}`.slice(0, 300), { code });
      status(runId, "failed");
      if (run.agentId) await refreshAgentStates(db, [run.agentId]);
      await stopBuffer(runId);
    },
    async cancelled(runId) {
      await serial(runId, () => flush(runId));
      const run = await finishCancelled(db, runId);
      if (!run) return;
      await event(runId, "RUN_CANCELLED");
      status(runId, "cancelled");
      await stopBuffer(runId);
    },
    async needsReview(runId, reason) {
      const run = await db.transaction(async (tx) => {
        const [r] = await tx
          .update(agentRuns)
          .set({
            status: "needs_review",
            errorCode: "UNKNOWN",
            errorMessage: reason,
            completedAt: new Date(),
            ...releaseReservation,
          })
          .where(
            and(
              eq(agentRuns.id, runId),
              sql`${agentRuns.status} not in ('completed','failed','cancelled','needs_review')`,
            ),
          )
          .returning();
        if (!r) return null;
        await releaseClaim(tx, r);
        await chatNotice(tx, r, "The reply was interrupted and needs review.");
        await recordAuditEvent(tx, {
          ...workerAudit(r),
          action: "agent_run.needs_review",
          description: reason,
          outcome: "failure",
        });
        return r;
      });
      if (!run) return;
      await event(runId, "RUN_NEEDS_REVIEW", reason);
      status(runId, "needs_review");
      if (run.agentId) await refreshAgentStates(db, [run.agentId]);
    },
    async isCancelRequested(runId) {
      const [r] = await db
        .select({ s: agentRuns.status, at: agentRuns.cancelRequestedAt })
        .from(agentRuns)
        .where(eq(agentRuns.id, runId));
      return !!r && (r.s === "cancel_requested" || r.s === "cancelled" || !!r.at);
    },
    async renewLease(runId) {
      const run = await getRun(db, runId);
      if (run.taskId && run.agentId)
        await db
          .update(tasks)
          .set({ leaseExpiresAt: new Date(Date.now() + LEASE_SECONDS * 1000) })
          .where(and(eq(tasks.id, run.taskId), eq(tasks.claimedByAgentId, run.agentId)));
    },
  };
}

async function finishCancelled(db: Database, runId: string): Promise<AgentRun | null> {
  const run = await db.transaction(async (tx) => {
    const [r] = await tx
      .update(agentRuns)
      .set({
        status: "cancelled",
        cancelledAt: new Date(),
        completedAt: new Date(),
        providerCallStartedAt: null,
        reservationStatus: sql`case when ${agentRuns.reservationStatus} = 'active' then 'released' else ${agentRuns.reservationStatus} end`,
      })
      .where(
        and(
          eq(agentRuns.id, runId),
          sql`${agentRuns.status} not in ('completed','failed','cancelled','needs_review')`,
        ),
      )
      .returning();
    if (!r) return null;
    // See createRunStore's releaseClaim: a second-opinion run shares taskId/agentId
    // for grouping only and never holds the task's execution claim.
    if (r.taskId && r.agentId && r.runPurpose !== "second_opinion")
      await tx
        .update(tasks)
        .set({ claimedByAgentId: null, claimedAt: null, leaseExpiresAt: null })
        .where(and(eq(tasks.id, r.taskId), eq(tasks.claimedByAgentId, r.agentId)));
    if (r.taskId && r.executionType === "task")
      await tx
        .update(tasks)
        .set({ status: "assigned" })
        .where(and(eq(tasks.id, r.taskId), eq(tasks.status, "running")));
    if (r.conversationId)
      await tx.insert(conversationMessages).values({
        conversationId: r.conversationId,
        role: "system",
        content: "Response stopped.",
        runId: r.id,
      });
    await recordAuditEvent(tx, {
      ...workerAudit(r),
      action: "agent_run.cancelled",
      description: "Agent run cancelled",
    });
    return r;
  });
  if (run?.agentId) await refreshAgentStates(db, [run.agentId]);
  return run;
}

/* ---------- cancellation (API) ---------- */

/**
 * Stop a run. Queued runs are cancelled immediately; running ones become
 * CANCEL_REQUESTED and the caller notifies the worker, which aborts the
 * provider request (AbortSignal) and finalises as CANCELLED.
 */
export async function requestRunCancel(
  db: Database,
  runId: string,
  actor: Actor,
): Promise<{ status: AgentRunStatus; notifyWorker: boolean }> {
  const run = await getRun(db, runId);
  if (FINAL.includes(run.status)) return { status: run.status, notifyWorker: false };
  if (run.status === "queued") {
    const done = await finishCancelled(db, runId);
    await appendRunEvent(db, runId, "CANCEL_REQUESTED", `By ${actor.ref}`);
    await appendRunEvent(db, runId, "RUN_CANCELLED");
    await recordAuditEvent(db, {
      ...actorAuditFields(actor),
      companyId: run.companyId ?? undefined,
      agentId: run.agentId ?? undefined,
      taskId: run.taskId ?? undefined,
      resourceType: "agent_run",
      resourceId: runId,
      action: "agent_run.cancel_requested",
      description: "Stop requested for a queued run",
    });
    return { status: done?.status ?? "cancelled", notifyWorker: false };
  }
  await db
    .update(agentRuns)
    .set({ status: "cancel_requested", cancelRequestedAt: new Date() })
    .where(
      and(
        eq(agentRuns.id, runId),
        sql`${agentRuns.status} not in ('completed','failed','cancelled','needs_review')`,
      ),
    );
  await appendRunEvent(db, runId, "CANCEL_REQUESTED", `By ${actor.ref}`);
  await recordAuditEvent(db, {
    ...actorAuditFields(actor),
    companyId: run.companyId ?? undefined,
    agentId: run.agentId ?? undefined,
    taskId: run.taskId ?? undefined,
    resourceType: "agent_run",
    resourceId: runId,
    action: "agent_run.cancel_requested",
    description: "Stop requested",
  });
  return { status: "cancel_requested", notifyWorker: true };
}

/* ---------- recovery (worker start) ---------- */

/**
 * After a worker restart: runs that never reached the provider are re-queued;
 * runs interrupted DURING a provider call become NEEDS_REVIEW (never re-paid
 * automatically); saved responses are re-queued to finish; stop requests are
 * honoured. Assumes a single worker process (see docs/AI_EXECUTION.md).
 */
export async function recoverInterruptedRuns(
  db: Database,
): Promise<{ requeue: string[]; needsReview: string[]; cancelled: string[] }> {
  const rows = await db
    .select()
    .from(agentRuns)
    .where(inArray(agentRuns.status, [...ACTIVE_RUN_STATUSES]));
  const out = { requeue: [] as string[], needsReview: [] as string[], cancelled: [] as string[] };
  for (const r of rows) {
    if (r.status === "cancel_requested" && !r.responseSavedAt) {
      await finishCancelled(db, r.id);
      out.cancelled.push(r.id);
    } else if (r.responseSavedAt || !r.providerCallStartedAt) {
      if (!r.responseSavedAt && r.status !== "queued")
        await db.update(agentRuns).set({ status: "queued" }).where(eq(agentRuns.id, r.id));
      out.requeue.push(r.id);
    } else out.needsReview.push(r.id);
  }
  return out;
}

/* ---------- queries ---------- */

export interface RunViewer {
  canStop(companyId: string | null): boolean;
  canRequestReview(companyId: string | null): boolean;
  userId: string | null;
}

export async function listRuns(
  db: Database,
  opts: {
    taskId?: string;
    agentId?: string;
    conversationId?: string;
    ids?: string[];
    activeOnly?: boolean;
    companyId?: string;
    scope: AccessScope;
    viewer: RunViewer;
    limit?: number;
  },
): Promise<AgentRunDTO[]> {
  const rows = await db
    .select({
      r: agentRuns,
      company: {
        id: companies.id,
        name: companies.name,
        slug: companies.slug,
        accentColor: companies.accentColor,
      },
      taskTitle: tasks.title,
      agentName: agents.name,
      startedBy: {
        email: users.email,
        displayName: users.displayName,
        firstName: users.firstName,
        lastName: users.lastName,
      },
      lastEvent: sql<
        string | null
      >`(select type from agent_run_events e where e.run_id = ${agentRuns.id} order by seq desc limit 1)`,
    })
    .from(agentRuns)
    .leftJoin(companies, eq(companies.id, agentRuns.companyId))
    .leftJoin(tasks, eq(tasks.id, agentRuns.taskId))
    .leftJoin(agents, eq(agents.id, agentRuns.agentId))
    .leftJoin(users, eq(users.id, agentRuns.startedByUserId))
    .where(
      and(
        opts.taskId ? eq(agentRuns.taskId, opts.taskId) : undefined,
        opts.agentId ? eq(agentRuns.agentId, opts.agentId) : undefined,
        opts.conversationId ? eq(agentRuns.conversationId, opts.conversationId) : undefined,
        opts.ids ? (opts.ids.length ? inArray(agentRuns.id, opts.ids) : sql`false`) : undefined,
        opts.activeOnly ? inArray(agentRuns.status, [...ACTIVE_RUN_STATUSES]) : undefined,
        opts.companyId ? eq(agentRuns.companyId, opts.companyId) : undefined,
        scopeWhere(agentRuns.companyId, opts.scope),
        // Chat runs are private to the conversation owner.
        opts.viewer.userId
          ? sql`(${agentRuns.conversationId} is null or exists (select 1 from conversations c where c.id = ${agentRuns.conversationId} and c.user_id = ${opts.viewer.userId}))`
          : sql`${agentRuns.conversationId} is null`,
      ),
    )
    .orderBy(desc(agentRuns.createdAt))
    .limit(opts.limit ?? 50);
  const ids = rows.map((x) => x.r.id);
  const feedback =
    ids.length && opts.viewer.userId
      ? await db
          .select()
          .from(agentRunFeedback)
          .where(
            and(
              inArray(agentRunFeedback.runId, ids),
              eq(agentRunFeedback.userId, opts.viewer.userId),
            ),
          )
      : [];
  return rows.map(({ r, company, taskTitle, agentName, startedBy, lastEvent }) => {
    const fb = feedback.find((f) => f.runId === r.id);
    // A second-opinion run's `result` is a ProviderReview, not an AgentExecutionResult —
    // never surfaced through this field (see AgentRunDetailDTO.review for that content).
    const result = (
      r.status === "completed" && r.runPurpose !== "second_opinion" ? r.result : null
    ) as AgentExecutionResult | null;
    return {
      id: r.id,
      number: r.number,
      purpose: r.runPurpose as RunPurpose,
      reviewedRunId: r.reviewedRunId,
      executionType: r.executionType,
      status: r.status,
      company: company?.id ? company : null,
      task: r.taskId && taskTitle ? { id: r.taskId, title: taskTitle } : null,
      agent: r.agentId && agentName ? { id: r.agentId, name: agentName } : null,
      conversationId: r.conversationId,
      provider: r.provider,
      model: r.model,
      modelLabel: modelLabel(r.model),
      effort: r.effort,
      tier: r.tier === "premium" ? "premium" : "standard",
      responseDetail: r.responseDetail,
      maxOutputTokens: r.maxOutputTokens,
      isMock: r.isMock,
      startedBy: startedBy?.email ? displayNameOf(startedBy) : null,
      createdAt: r.createdAt.toISOString(),
      startedAt: r.startedAt?.toISOString() ?? null,
      completedAt: r.completedAt?.toISOString() ?? null,
      cancelledAt: r.cancelledAt?.toISOString() ?? null,
      errorCode: (r.errorCode as ProviderErrorCode | null) ?? null,
      errorMessage: r.errorMessage,
      contextVersion: r.contextVersion,
      instructionVersion: r.instructionVersion,
      contextSummary: (r.contextSummary as AgentRunDTO["contextSummary"]) ?? null,
      providerRequestId: r.providerRequestId,
      outputText: r.outputText,
      result,
      usage:
        r.inputTokens === null
          ? null
          : {
              inputTokens: r.inputTokens,
              outputTokens: r.outputTokens ?? 0,
              cacheCreationTokens: r.cacheCreationTokens ?? 0,
              cacheReadTokens: r.cacheReadTokens ?? 0,
            },
      estimatedCostUsd: r.estimatedCost,
      actualCostUsd: r.billingMode === "subscription" ? null : r.actualCost,
      transport: r.transport as ProviderTransport,
      billingMode: r.billingMode as BillingMode,
      apiEquivalentUsd: r.apiEquivalentCost,
      latencyMs: r.latencyMs,
      stopReason: r.stopReason,
      retryCount: r.retryCount,
      phase: (lastEvent && RUN_PHASE_LABELS[lastEvent as RunEventType]) ?? r.status,
      feedback: fb
        ? { rating: fb.rating as "useful" | "not_useful", note: fb.note, by: null }
        : null,
      proposals: {
        handoffs: result?.proposedHandoffs.length ?? 0,
        knowledgeDrafts: result?.proposedKnowledgeDrafts.length ?? 0,
      },
      viewer: {
        canStop: ACTIVE_RUN_STATUSES.includes(r.status) && opts.viewer.canStop(r.companyId),
        canFeedback: r.status === "completed" && !!opts.viewer.userId,
        canRequestReview: opts.viewer.canRequestReview(r.companyId),
      },
    };
  });
}

export async function getRunDetail(
  db: Database,
  runId: string,
  opts: { scope: AccessScope; viewer: RunViewer },
): Promise<AgentRunDetailDTO> {
  const [run] = await listRuns(db, {
    ids: [runId],
    scope: opts.scope,
    viewer: opts.viewer,
    limit: 1,
  });
  if (!run) throw new NotFoundError("Run", runId);
  const [events, [latestReview]] = await Promise.all([
    db
      .select()
      .from(agentRunEvents)
      .where(eq(agentRunEvents.runId, runId))
      .orderBy(agentRunEvents.seq),
    // The most recent COMPLETED independent review of this run, if any — never
    // the reviewer's in-progress or failed attempts, and never this run's own
    // review of someone else (that lives on the reviewer run's own detail).
    db
      .select({ result: agentRuns.result })
      .from(agentRunReviews)
      .innerJoin(agentRuns, eq(agentRuns.id, agentRunReviews.reviewerRunId))
      .where(and(eq(agentRunReviews.reviewedRunId, runId), eq(agentRuns.status, "completed")))
      .orderBy(desc(agentRunReviews.createdAt))
      .limit(1),
  ]);
  return {
    ...run,
    events: events.map(eventDTO),
    review: (latestReview?.result ?? null) as ProviderReview | null,
  };
}

export async function setRunFeedback(
  db: Database,
  runId: string,
  input: z.input<typeof runFeedbackSchema>,
  actor: Actor,
) {
  const data = runFeedbackSchema.parse(input);
  const run = await getRun(db, runId);
  if (run.status !== "completed") throw new ConflictError("Feedback is for completed runs");
  await db
    .insert(agentRunFeedback)
    .values({ runId, userId: actor.userId!, rating: data.rating, note: data.note ?? null })
    .onConflictDoUpdate({
      target: [agentRunFeedback.runId, agentRunFeedback.userId],
      set: { rating: data.rating, note: data.note ?? null, updatedAt: new Date() },
    });
  await recordAuditEvent(db, {
    ...actorAuditFields(actor),
    companyId: run.companyId ?? undefined,
    agentId: run.agentId ?? undefined,
    resourceType: "agent_run",
    resourceId: runId,
    action: "agent_run.feedback",
    description: `Run marked ${data.rating === "useful" ? "useful" : "not useful"}`,
  });
}

/** Observable performance only — no invented quality scores. */
export async function agentPerformance(
  db: Database,
  agentId: string,
): Promise<AgentPerformanceDTO> {
  const [r] = await db
    .select({
      completed: sql<number>`count(*) filter (where ${agentRuns.status} = 'completed')::int`,
      failed: sql<number>`count(*) filter (where ${agentRuns.status} in ('failed','needs_review'))::int`,
      latency: sql<
        number | null
      >`avg(${agentRuns.latencyMs}) filter (where ${agentRuns.status} = 'completed')::float8`,
      cost: sql<
        number | null
      >`avg(${agentRuns.actualCost}) filter (where ${agentRuns.status} = 'completed')::float8`,
      output: sql<
        number | null
      >`avg(${agentRuns.outputTokens}) filter (where ${agentRuns.status} = 'completed')::float8`,
    })
    .from(agentRuns)
    .where(eq(agentRuns.agentId, agentId));
  const [f] = await db
    .select({
      useful: sql<number>`count(*) filter (where ${agentRunFeedback.rating} = 'useful')::int`,
      notUseful: sql<number>`count(*) filter (where ${agentRunFeedback.rating} = 'not_useful')::int`,
    })
    .from(agentRunFeedback)
    .innerJoin(agentRuns, eq(agentRuns.id, agentRunFeedback.runId))
    .where(eq(agentRuns.agentId, agentId));
  const round = (n: number | null, d = 0) =>
    n === null || n === undefined ? null : Math.round(n * 10 ** d) / 10 ** d;
  return {
    agentId,
    runsCompleted: r?.completed ?? 0,
    runsFailed: r?.failed ?? 0,
    averageLatencyMs: round(r?.latency ?? null),
    averageCostUsd: round(r?.cost ?? null, 6),
    averageOutputTokens: round(r?.output ?? null),
    feedbackUseful: f?.useful ?? 0,
    feedbackNotUseful: f?.notUseful ?? 0,
  };
}

/** Run ids for the unfinished chat runs of a conversation (UI resumes streaming). */
export async function activeConversationRun(
  db: Database,
  conversationId: string,
): Promise<string | null> {
  const [r] = await db
    .select({ id: agentRuns.id })
    .from(agentRuns)
    .where(
      and(
        eq(agentRuns.conversationId, conversationId),
        inArray(agentRuns.status, [...ACTIVE_RUN_STATUSES]),
      ),
    );
  return r?.id ?? null;
}

export async function runCompanyId(
  db: Database,
  runId: string,
): Promise<{ companyId: string | null; conversationUserId: string | null }> {
  const [r] = await db
    .select({ companyId: agentRuns.companyId, userId: conversations.userId })
    .from(agentRuns)
    .leftJoin(conversations, eq(conversations.id, agentRuns.conversationId))
    .where(eq(agentRuns.id, runId));
  if (!r) throw new NotFoundError("Run", runId);
  return { companyId: r.companyId, conversationUserId: r.userId };
}

/** Minimal routing facts the worker needs to pick the provider for a run. */
export async function runExecutionInfo(db: Database, runId: string) {
  const [r] = await db
    .select({
      provider: agentRuns.provider,
      model: agentRuns.model,
      companyId: agentRuns.companyId,
      agentId: agentRuns.agentId,
      taskId: agentRuns.taskId,
    })
    .from(agentRuns)
    .where(eq(agentRuns.id, runId));
  return r ?? null;
}

/**
 * Agent provider preferences. A provider prohibited by any company the agent
 * serves (or any company at all, for global agents) is rejected.
 */
export async function setAgentProviderSettings(
  db: Database,
  agentId: string,
  input: z.input<typeof agentProviderSettingsSchema>,
  actor: Actor,
): Promise<void> {
  const data = agentProviderSettingsSchema.parse(input);
  const [agent] = await db.select().from(agents).where(eq(agents.id, agentId));
  if (!agent) throw new NotFoundError("Agent", agentId);
  const companyIds =
    agent.scope === "global"
      ? (await db.select({ id: companies.id }).from(companies)).map((c) => c.id)
      : (
          await db
            .select({ id: agentCompanyAssignments.companyId })
            .from(agentCompanyAssignments)
            .where(eq(agentCompanyAssignments.agentId, agentId))
        ).map((c) => c.id);
  for (const companyId of companyIds) {
    const [policy] = await db
      .select()
      .from(companyAiPolicies)
      .where(eq(companyAiPolicies.companyId, companyId));
    const allowed = policy?.allowedProviders ?? PROVIDER_TYPES;
    for (const p of [
      data.primaryProvider,
      data.fallbackProvider,
      data.preferredReviewerProvider,
    ].filter((x): x is ProviderType => !!x))
      if (!allowed.includes(p))
        throw new ConflictError(
          `${PROVIDER_LABELS[p]} is not allowed by a company this agent serves`,
        );
    if (data.preferredModelTier === "premium" && !(policy?.premiumAllowed ?? false))
      throw new ConflictError("Premium tier is not permitted by a company this agent serves");
  }
  await db
    .update(agents)
    .set({
      primaryProvider: data.primaryProvider,
      fallbackProvider: data.fallbackProvider,
      preferredModelTier: data.preferredModelTier,
      defaultEffort: data.defaultEffort,
      preferredReviewerProvider: data.preferredReviewerProvider,
    })
    .where(eq(agents.id, agentId));
  await recordAuditEvent(db, {
    ...actorAuditFields(actor),
    agentId,
    resourceType: "agent",
    resourceId: agentId,
    action: "agent.provider_settings_changed",
    description: `Provider settings changed for ${agent.name}`,
    after: data,
  });
}
