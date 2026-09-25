import {
  agentExecutionResultSchema,
  type AgentExecutionResult,
  type AgentRunStatus,
  type ProviderErrorCode,
  type RunEventType,
  type RunExecutionType,
} from "@aibos/shared";
import {
  ProviderError,
  type AIProvider,
  type ProviderRequest,
  type ProviderResult,
} from "@aibos/provider-core";
import { DEFAULT_RETRY_POLICY, retryDecision, type RetryPolicy } from "./policy";
import type { ProviderInput } from "./messages";

/** What the executor needs to know about a run (persisted by the store). */
export interface RunSnapshot {
  id: string;
  executionType: RunExecutionType;
  status: AgentRunStatus;
  providerModel: string;
  effort: ProviderRequest["effort"];
  maxOutputTokens: number;
  timeoutMs: number;
  maxRetries: number;
  retryCount: number;
  /** Set durably right before a provider call; cleared when the call fails. */
  providerCallStartedAt: Date | null;
  /** True once the provider response has been durably saved. */
  responseSaved: boolean;
}

export interface SavedResponse {
  result: ProviderResult;
  structured: AgentExecutionResult | null;
}

/**
 * Persistence and side effects for one run. Implemented by @aibos/db;
 * in-memory fakes in tests. The executor never touches a vendor SDK.
 */
export interface RunStore {
  load(runId: string): Promise<RunSnapshot | null>;
  /** Atomically takes a QUEUED run (queued → preparing). Exactly one worker wins. */
  begin(runId: string): Promise<boolean>;
  /** Conditional transition; returns false if the run was cancelled/finalised meanwhile. */
  transition(runId: string, status: AgentRunStatus): Promise<boolean>;
  event(
    runId: string,
    type: RunEventType,
    detail?: string | null,
    data?: Record<string, unknown>,
  ): Promise<void>;
  /** Streamed visible output (published live, persisted in batches). */
  chunk(runId: string, text: string): void;
  /** Re-verifies authority/isolation and builds context + instructions + provider input. */
  prepare(runId: string): Promise<ProviderInput>;
  markProviderCallStarted(runId: string, attempt: number): Promise<void>;
  markProviderCallFailed(runId: string, attempt: number, code: ProviderErrorCode): Promise<void>;
  /** Durable save of provider output + usage ledger + cost (idempotent per run). */
  saveResponse(runId: string, result: ProviderResult): Promise<void>;
  loadSavedResponse(runId: string): Promise<ProviderResult | null>;
  /** Completes task/conversation, stores proposals, settles reservation, releases claim. */
  finalize(runId: string, saved: SavedResponse): Promise<void>;
  fail(runId: string, code: ProviderErrorCode, message: string): Promise<void>;
  cancelled(runId: string): Promise<void>;
  needsReview(runId: string, reason: string): Promise<void>;
  isCancelRequested(runId: string): Promise<boolean>;
  renewLease(runId: string): Promise<void>;
}

export interface ExecuteOptions {
  store: RunStore;
  provider: AIProvider;
  retry?: RetryPolicy;
  /** Called with an abort function; the worker wires Redis cancel messages to it. */
  onCancelHandle?: (abort: () => void) => () => void;
  leaseRenewEveryMs?: number;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

const defaultSleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        resolve();
      },
      { once: true },
    );
  });

export type ExecuteOutcome = "completed" | "failed" | "cancelled" | "needs_review" | "skipped";

/**
 * Executes one agent run: prepare → provider call (with one transient retry)
 * → durable response save → validation → finalisation. Idempotent across
 * worker restarts: a saved response is never re-requested, and an
 * interrupted provider call is marked NEEDS_REVIEW instead of paying twice.
 * ONE run = ONE agent; no automatic cascade to other agents.
 */
export async function executeRun(runId: string, opts: ExecuteOptions): Promise<ExecuteOutcome> {
  const { store, provider } = opts;
  const policy = opts.retry ?? DEFAULT_RETRY_POLICY;
  const sleep = opts.sleep ?? defaultSleep;
  const run = await store.load(runId);
  if (!run) return "skipped";
  if (["completed", "failed", "cancelled", "needs_review"].includes(run.status)) return "skipped";

  // Recovery: a response was saved but finalisation did not finish → finish it without a new call.
  if (run.responseSaved) {
    const saved = await store.loadSavedResponse(runId);
    if (saved) return finish(runId, saved, store);
  }
  // Recovery: a provider call was in flight when the worker stopped → do not pay again automatically.
  if (run.providerCallStartedAt) {
    await store.needsReview(
      runId,
      "The worker stopped during a provider call; the outcome is unknown, so it was not repeated automatically.",
    );
    return "needs_review";
  }
  if (run.status === "cancel_requested" || (await store.isCancelRequested(runId))) {
    await store.cancelled(runId);
    return "cancelled";
  }

  const controller = new AbortController();
  const detach = opts.onCancelHandle?.(() => controller.abort()) ?? (() => {});
  const lease = setInterval(() => {
    void store.renewLease(runId).catch(() => {});
    void store
      .isCancelRequested(runId)
      .then((c) => c && controller.abort())
      .catch(() => {});
  }, opts.leaseRenewEveryMs ?? 10_000);

  try {
    if (!(await store.begin(runId))) return cancelledOr(runId, store);
    await store.event(runId, "CONTEXT_BUILDING");
    let input: ProviderInput;
    try {
      input = await store.prepare(runId);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Preparation failed";
      await store.fail(runId, "INVALID_REQUEST", message);
      return "failed";
    }
    if (!(await store.transition(runId, "routing"))) return cancelledOr(runId, store);
    if (!provider.available()) {
      await store.fail(
        runId,
        "PROVIDER_NOT_CONFIGURED",
        `${provider.displayName} is not configured`,
      );
      return "failed";
    }

    let result: ProviderResult | null = null;
    for (let attempt = run.retryCount; ; attempt++) {
      if (controller.signal.aborted) return cancelledOr(runId, store, true);
      if (!(await store.transition(runId, "running"))) return cancelledOr(runId, store);
      await store.markProviderCallStarted(runId, attempt);
      await store.event(runId, "PROVIDER_REQUEST_STARTED", null, { attempt });
      try {
        result = await provider.stream(
          {
            runId,
            model: run.providerModel,
            effort: run.effort,
            system: input.system,
            messages: input.messages,
            output: input.output,
            maxOutputTokens: run.maxOutputTokens,
            timeoutMs: run.timeoutMs,
            signal: controller.signal,
          },
          {
            onStart: () => {
              void store.transition(runId, "streaming");
              void store.event(runId, "PROVIDER_STREAM_STARTED");
            },
            onText: (delta) => store.chunk(runId, delta),
          },
        );
        break;
      } catch (e) {
        const err = e instanceof ProviderError ? e : provider.normalizeError(e);
        await store.markProviderCallFailed(runId, attempt, err.code);
        if (err.code === "CANCELLED" || controller.signal.aborted)
          return cancelledOr(runId, store, true);
        const { retry, delayMs } = retryDecision(err, attempt, {
          ...policy,
          maxRetries: Math.min(policy.maxRetries, run.maxRetries),
        });
        if (!retry) {
          await store.fail(runId, err.code, err.message);
          return "failed";
        }
        await store.event(
          runId,
          "PROVIDER_RETRY",
          `${err.code}: retrying in ${Math.round(delayMs / 1000)}s`,
          { attempt, delayMs },
        );
        await sleep(delayMs, controller.signal);
      }
    }

    // Durable save BEFORE anything else: a crash after this point never re-pays.
    await store.saveResponse(runId, result);
    return finish(runId, result, store);
  } finally {
    clearInterval(lease);
    detach();
  }
}

async function finish(
  runId: string,
  result: ProviderResult,
  store: RunStore,
): Promise<ExecuteOutcome> {
  let structured: AgentExecutionResult | null = null;
  if (result.structured !== null && result.structured !== undefined) {
    const parsed = agentExecutionResultSchema.safeParse(result.structured);
    if (!parsed.success) {
      await store.fail(
        runId,
        "INVALID_OUTPUT",
        "The provider response did not match the result schema",
      );
      return "failed";
    }
    structured = parsed.data;
    await store.event(runId, "RESULT_VALIDATED");
  }
  await store.finalize(runId, { result, structured });
  return "completed";
}

async function cancelledOr(
  runId: string,
  store: RunStore,
  aborted = false,
): Promise<ExecuteOutcome> {
  const snap = await store.load(runId);
  if (aborted || snap?.status === "cancel_requested" || (await store.isCancelRequested(runId))) {
    await store.cancelled(runId);
    return "cancelled";
  }
  return "skipped";
}
