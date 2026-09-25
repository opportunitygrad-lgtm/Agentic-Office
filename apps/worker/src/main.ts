import { Queue, Worker } from "bullmq";
import { Redis } from "ioredis";
import pino from "pino";
import { createDb, loadEnv, requireEnv } from "@aibos/db";
import {
  chatHistoryLimit,
  providerTimeoutMs,
  subscriptionLimitsFromEnv,
} from "@aibos/execution-core";
import {
  claudeCodeConfigFromEnv,
  createProviderRegistry,
  killAllClaudeCodeChildren,
} from "@aibos/provider-core";
import { QUEUE_NAMES } from "@aibos/shared";
import { processAgentTask, writeHeartbeat, type AgentTaskJobData } from "./processors";
import { createRunProcessor, recoverRuns, type AgentRunJobData } from "./runs";

loadEnv();
const logger = pino({
  name: "aibos-worker",
  level: process.env.LOG_LEVEL ?? "info",
  ...(process.env.NODE_ENV !== "production" ? { transport: { target: "pino-pretty" } } : {}),
});

const redisUrl = requireEnv("REDIS_URL");
const connection = () => new Redis(redisUrl, { maxRetriesPerRequest: null });
const redis = connection();
const concurrency = Number(process.env.WORKER_CONCURRENCY ?? 2);
const queues = Object.values(QUEUE_NAMES);

const systemQueue = new Queue(QUEUE_NAMES.system, { connection: connection() });
await systemQueue.upsertJobScheduler("heartbeat", { every: 15_000 }, { name: "heartbeat" });

const systemWorker = new Worker(
  QUEUE_NAMES.system,
  async (job) => {
    if (job.name === "heartbeat") return writeHeartbeat(redis, queues);
    logger.warn({ job: job.name }, "unknown system job");
    return null;
  },
  { connection: connection(), concurrency: 1 },
);

// Agent execution. Claude runs through the owner's local Claude Code
// subscription by default (CLAUDE_TRANSPORT); this worker must run on the
// machine/user account where `claude login` was done.
const dbHandle = createDb(requireEnv("DATABASE_URL"));
const registry = createProviderRegistry();
const env = {
  registry,
  timeoutMs: providerTimeoutMs(),
  historyLimit: chatHistoryLimit(),
  subscriptionLimits: subscriptionLimitsFromEnv(),
};
const claude = registry.get("CLAUDE");
// Subscription capacity is finite: run at most CLAUDE_CODE_MAX_CONCURRENCY (default 1)
// agent runs at once; the rest wait QUEUED in BullMQ.
const runConcurrency =
  claude.transport === "claude_code_cli"
    ? claudeCodeConfigFromEnv(process.env, registry.models.CLAUDE!).maxConcurrency
    : concurrency;
const runQueue = new Queue<AgentRunJobData>(QUEUE_NAMES.agentRuns, { connection: connection() });
const processRun = createRunProcessor({
  db: dbHandle.db,
  env,
  redis,
  subscriber: connection(),
  logger,
});
const runWorker = new Worker<AgentRunJobData>(QUEUE_NAMES.agentRuns, (job) => processRun(job), {
  connection: connection(),
  concurrency: runConcurrency,
  // Long provider calls must not be treated as stalled while streaming.
  lockDuration: 5 * 60_000,
});
await recoverRuns(dbHandle.db, runQueue, logger);
logger.info(
  {
    mode: registry.mode,
    claudeTransport: claude.transport,
    claudeBilling: claude.billingMode,
    runConcurrency,
  },
  "AI providers",
);

const agentWorker = new Worker<AgentTaskJobData>(
  QUEUE_NAMES.agentTasks,
  async (job) => {
    const result = await processAgentTask(job);
    logger.info(result, "agent task received (no-op in Stage 01)");
    return result;
  },
  { connection: connection(), concurrency },
);

for (const w of [systemWorker, agentWorker, runWorker]) {
  w.on("failed", (job, err) => logger.error({ job: job?.id, err }, "job failed"));
  w.on("error", (err) => logger.error({ err }, "worker error"));
}

await writeHeartbeat(redis, queues);
logger.info({ queues, concurrency }, "worker started");

let stopping = false;
async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  logger.info({ signal }, "shutting down worker");
  // Never leave a Claude Code child running on its own.
  const killed = killAllClaudeCodeChildren();
  if (killed) logger.warn({ killed }, "terminated running Claude Code processes");
  await Promise.allSettled([
    systemWorker.close(),
    agentWorker.close(),
    runWorker.close(),
    systemQueue.close(),
    runQueue.close(),
  ]);
  await dbHandle.close();
  redis.disconnect();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
