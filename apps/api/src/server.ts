import { Redis } from "ioredis";
import { createDb } from "@aibos/db";
import { buildApp } from "./app";
import { loadConfig } from "./config";
import { createHealthProbe } from "./health";

const config = loadConfig();
const db = createDb(config.DATABASE_URL);
const redis = new Redis(config.REDIS_URL, {
  maxRetriesPerRequest: 1,
  lazyConnect: false,
  enableOfflineQueue: false,
});
redis.on("error", () => {
  /* surfaced through /health; avoid crashing on transient Redis loss */
});

const app = await buildApp({
  db,
  health: createHealthProbe(db, redis),
  corsOrigins: config.API_CORS_ORIGINS,
  logger: {
    level: config.LOG_LEVEL,
    ...(config.NODE_ENV === "development" ? { transport: { target: "pino-pretty" } } : {}),
  },
});

await app.listen({ host: config.API_HOST, port: config.API_PORT });

async function shutdown() {
  await app.close();
  await db.close();
  redis.disconnect();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
