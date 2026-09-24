import { Redis } from "ioredis";
import { createDb } from "@aibos/db";
import { buildApp } from "./app";
import { loadConfig } from "./config";
import { createDevDelivery } from "./delivery";
import { createHealthProbe } from "./health";
import { RedisThrottle } from "./throttle";

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
  throttle: new RedisThrottle(redis),
  cookieSecure: config.COOKIE_SECURE ?? config.NODE_ENV === "production",
  webOrigin: config.WEB_ORIGIN,
  trustProxy: config.TRUST_PROXY,
  production: config.NODE_ENV === "production",
  logger: {
    level: config.LOG_LEVEL,
    // Never log credentials, cookies or single-use tokens.
    redact: ["req.headers.cookie", "req.headers.authorization", 'res.headers["set-cookie"]'],
    serializers: {
      req: (req: { method: string; url: string; id: string }) => ({
        method: req.method,
        url: req.url.replace(/([?&]token=)[^&]+/g, "$1[redacted]"),
        id: req.id,
      }),
    },
    ...(config.NODE_ENV === "development" ? { transport: { target: "pino-pretty" } } : {}),
  },
});

app.deps.delivery = createDevDelivery(app.log, config.NODE_ENV);

await app.listen({ host: config.API_HOST, port: config.API_PORT });

async function shutdown() {
  await app.close();
  await db.close();
  redis.disconnect();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
