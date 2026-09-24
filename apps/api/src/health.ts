import type { Redis } from "ioredis";
import type { HealthState, SystemHealthDTO } from "@aibos/shared";
import { WORKER_HEARTBEAT_KEY } from "@aibos/shared";
import type { DbHandle } from "@aibos/db";

export interface HealthProbe {
  check(): Promise<SystemHealthDTO>;
}

const withTimeout = <T>(p: Promise<T>, ms: number, fallback: T) =>
  Promise.race([p, new Promise<T>((r) => setTimeout(() => r(fallback), ms))]);

export function createHealthProbe(db: DbHandle, redis: Redis | null): HealthProbe {
  return {
    async check() {
      const dbOk = await withTimeout(db.ping(), 2_000, false);
      let redisState: HealthState = "unknown";
      let workerState: HealthState = "unknown";
      let workerDetail = "Redis unavailable";
      if (redis) {
        const pong = await withTimeout(
          redis.ping().catch(() => null),
          1_500,
          null,
        );
        redisState = pong === "PONG" ? "ok" : "down";
        if (redisState === "ok") {
          const raw = await redis.get(WORKER_HEARTBEAT_KEY).catch(() => null);
          if (raw) {
            const hb = JSON.parse(raw) as { at: string };
            const age = Math.round((Date.now() - Date.parse(hb.at)) / 1000);
            workerState = age < 45 ? "ok" : "degraded";
            workerDetail = `last heartbeat ${age}s ago`;
          } else {
            workerState = "down";
            workerDetail = "no heartbeat";
          }
        }
      }
      const services = [
        { name: "API", status: "ok" as HealthState },
        { name: "PostgreSQL", status: (dbOk ? "ok" : "down") as HealthState },
        { name: "Redis", status: redisState },
        { name: "Worker", status: workerState, detail: workerDetail },
      ];
      const status: HealthState = services.some(
        (s) => s.name === "PostgreSQL" && s.status === "down",
      )
        ? "down"
        : services.every((s) => s.status === "ok")
          ? "ok"
          : "degraded";
      return { status, checkedAt: new Date().toISOString(), services };
    },
  };
}
