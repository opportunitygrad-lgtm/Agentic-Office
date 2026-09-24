import { Queue, Worker } from "bullmq";
import { Redis } from "ioredis";
import pino from "pino";
import { loadEnv, requireEnv } from "@aibos/db";
import { QUEUE_NAMES } from "@aibos/shared";
import { processAgentTask, writeHeartbeat, type AgentTaskJobData } from "./processors";

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

const agentWorker = new Worker<AgentTaskJobData>(
  QUEUE_NAMES.agentTasks,
  async (job) => {
    const result = await processAgentTask(job);
    logger.info(result, "agent task received (no-op in Stage 01)");
    return result;
  },
  { connection: connection(), concurrency },
);

for (const w of [systemWorker, agentWorker]) {
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
  await Promise.allSettled([systemWorker.close(), agentWorker.close(), systemQueue.close()]);
  redis.disconnect();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
