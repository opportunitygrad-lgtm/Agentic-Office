import type { Job, Queue } from "bullmq";
import type { Redis } from "ioredis";
import type { Logger } from "pino";
import {
  createRunStore,
  recoverInterruptedRuns,
  runExecutionInfo,
  type Database,
  type ExecutionEnv,
} from "@aibos/db";
import { executeRun } from "@aibos/execution-core";
import { RUN_CANCEL_CHANNEL, runEventsChannel } from "@aibos/shared";

export interface AgentRunJobData {
  runId: string;
}

/**
 * Executes agent runs. Provider calls happen only here (never in the API).
 * Cancellation: the API publishes the run id on RUN_CANCEL_CHANNEL; the
 * matching in-flight run's AbortController is triggered, which aborts the
 * provider request itself (no tokens keep streaming after STOP).
 */
export function createRunProcessor(deps: {
  db: Database;
  env: ExecutionEnv;
  redis: Redis;
  subscriber: Redis;
  logger: Logger;
}) {
  const aborters = new Map<string, () => void>();
  const store = createRunStore(deps.db, deps.env, {
    publish: (runId, message) => {
      void deps.redis.publish(runEventsChannel(runId), JSON.stringify(message)).catch(() => {});
    },
  });

  void deps.subscriber.subscribe(RUN_CANCEL_CHANNEL);
  deps.subscriber.on("message", (channel, runId) => {
    if (channel === RUN_CANCEL_CHANNEL) aborters.get(runId)?.();
  });

  return async function processRun(job: Pick<Job<AgentRunJobData>, "id" | "data">) {
    const { runId } = job.data;
    const run = await runExecutionInfo(deps.db, runId);
    if (!run) return { runId, outcome: "missing" };
    const provider = deps.env.registry.get(run.provider);
    const started = Date.now();
    const outcome = await executeRun(runId, {
      store,
      provider,
      onCancelHandle: (abort) => {
        aborters.set(runId, abort);
        return () => aborters.delete(runId);
      },
    });
    // Structured operational log — never credentials, context or model output.
    deps.logger.info(
      {
        runId,
        companyId: run.companyId,
        agentId: run.agentId,
        taskId: run.taskId,
        provider: run.provider,
        model: run.model,
        outcome,
        ms: Date.now() - started,
        mock: provider.isMock,
      },
      "agent run finished",
    );
    return { runId, outcome };
  };
}

/** On start: re-queue safe runs, mark interrupted provider calls for review. */
export async function recoverRuns(db: Database, queue: Queue<AgentRunJobData>, logger: Logger) {
  const r = await recoverInterruptedRuns(db);
  // Interrupted provider calls are enqueued too: the executor marks them NEEDS_REVIEW without calling the provider.
  for (const runId of [...r.requeue, ...r.needsReview])
    await queue.add(
      "run",
      { runId },
      {
        jobId: `${runId}-recover-${Date.now()}`,
        attempts: 1,
        removeOnComplete: true,
        removeOnFail: true,
      },
    );
  if (r.requeue.length || r.needsReview.length || r.cancelled.length)
    logger.warn(r, "recovered agent runs after restart");
  return r;
}
