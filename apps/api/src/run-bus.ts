import { EventEmitter } from "node:events";
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import {
  QUEUE_NAMES,
  RUN_CANCEL_CHANNEL,
  runEventsChannel,
  type RunStreamMessage,
} from "@aibos/shared";

/**
 * How the API hands work to the worker and follows it. The API never calls a
 * provider: it enqueues runs, publishes stop requests and relays sanitised
 * run events to browsers (SSE).
 */
export interface RunBus {
  enqueue(runId: string): Promise<void>;
  requestCancel(runId: string): Promise<void>;
  subscribe(runId: string, onMessage: (m: RunStreamMessage) => void): Promise<() => Promise<void>>;
  close?(): Promise<void>;
}

/** In-memory bus for tests (no worker; tests drive execution directly). */
export class MemoryRunBus implements RunBus {
  readonly enqueued: string[] = [];
  readonly cancelled: string[] = [];
  private readonly emitter = new EventEmitter();
  async enqueue(runId: string) {
    this.enqueued.push(runId);
  }
  async requestCancel(runId: string) {
    this.cancelled.push(runId);
  }
  async subscribe(runId: string, onMessage: (m: RunStreamMessage) => void) {
    this.emitter.on(runId, onMessage);
    return async () => {
      this.emitter.off(runId, onMessage);
    };
  }
  publish(runId: string, m: RunStreamMessage) {
    this.emitter.emit(runId, m);
  }
}

export function createRedisRunBus(redisUrl: string): RunBus {
  const queue = new Queue(QUEUE_NAMES.agentRuns, {
    connection: new Redis(redisUrl, { maxRetriesPerRequest: null }),
  });
  const publisher = new Redis(redisUrl, { maxRetriesPerRequest: 1 });
  const subscriber = new Redis(redisUrl, { maxRetriesPerRequest: null });
  const listeners = new Map<string, Set<(m: RunStreamMessage) => void>>();
  for (const c of [publisher, subscriber]) c.on("error", () => {});
  subscriber.on("message", (channel, raw) => {
    const set = listeners.get(channel);
    if (!set) return;
    try {
      const msg = JSON.parse(raw) as RunStreamMessage;
      for (const fn of set) fn(msg);
    } catch {
      /* ignore malformed messages */
    }
  });
  return {
    async enqueue(runId) {
      await queue.add(
        "run",
        { runId },
        { jobId: runId, attempts: 1, removeOnComplete: true, removeOnFail: true },
      );
    },
    async requestCancel(runId) {
      await publisher.publish(RUN_CANCEL_CHANNEL, runId);
    },
    async subscribe(runId, onMessage) {
      const channel = runEventsChannel(runId);
      let set = listeners.get(channel);
      if (!set) {
        set = new Set();
        listeners.set(channel, set);
        await subscriber.subscribe(channel);
      }
      set.add(onMessage);
      return async () => {
        set!.delete(onMessage);
        if (!set!.size) {
          listeners.delete(channel);
          await subscriber.unsubscribe(channel).catch(() => {});
        }
      };
    },
    async close() {
      await queue.close();
      publisher.disconnect();
      subscriber.disconnect();
    },
  };
}
