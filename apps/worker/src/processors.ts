import type { Job } from "bullmq";
import type { Redis } from "ioredis";
import { WORKER_HEARTBEAT_KEY, WORKER_HEARTBEAT_TTL_SECONDS } from "@aibos/shared";

export interface Heartbeat {
  at: string;
  pid: number;
  hostname: string;
  queues: string[];
  stage: "01-foundation";
}

export function buildHeartbeat(queues: string[], now = new Date()): Heartbeat {
  return {
    at: now.toISOString(),
    pid: process.pid,
    hostname: process.env.HOSTNAME ?? "local",
    queues,
    stage: "01-foundation",
  };
}

export async function writeHeartbeat(
  redis: Pick<Redis, "set">,
  queues: string[],
): Promise<Heartbeat> {
  const hb = buildHeartbeat(queues);
  await redis.set(WORKER_HEARTBEAT_KEY, JSON.stringify(hb), "EX", WORKER_HEARTBEAT_TTL_SECONDS);
  return hb;
}

export interface AgentTaskJobData {
  taskId: string;
  companyId: string | null;
  agentId: string | null;
}

/**
 * Stage 01 placeholder for agent task execution. Stage 06 replaces this with
 * orchestration (routing → provider call → tool calls → audit → cost ledger).
 * It deliberately performs no AI calls and no external actions.
 */
export async function processAgentTask(job: Pick<Job<AgentTaskJobData>, "id" | "data">) {
  return {
    jobId: job.id,
    taskId: job.data.taskId,
    status: "skipped" as const,
    reason: "Task orchestration is not enabled until Stage 06",
  };
}
