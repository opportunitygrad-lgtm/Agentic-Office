import { Redis } from "ioredis";
import { createDb, providerStatuses } from "@aibos/db";
import {
  chatHistoryLimit,
  providerTimeoutMs,
  subscriptionLimitsFromEnv,
} from "@aibos/execution-core";
import { createProviderRegistry } from "@aibos/provider-core";
import { buildApp } from "./app";
import { loadConfig } from "./config";
import { createDevDelivery } from "./delivery";
import { createHealthProbe } from "./health";
import { createRedisRunBus } from "./run-bus";
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

// Claude defaults to the owner's local Claude Code subscription (CLAUDE_TRANSPORT);
// any optional API credential stays in the server environment, never the browser.
const registry = createProviderRegistry();
const bus = createRedisRunBus(config.REDIS_URL);
const claudeHealth = async () => {
  const [claude] = (await providerStatuses(db.db, registry)).filter((p) => p.provider === "CLAUDE");
  const state = claude?.state ?? "not_configured";
  // Setup still pending (not checked / not installed / login required) is
  // "not configured", not an error.
  const status =
    state === "not_configured" || state === "not_installed" || state === "login_required"
      ? "not_configured"
      : state === "available"
        ? "ok"
        : state === "unavailable" || state === "auth_error"
          ? "down"
          : "degraded";
  const label = claude?.transport === "claude_code_cli" ? "Claude Code" : "Claude API";
  return {
    status: status as "ok" | "degraded" | "down" | "not_configured",
    detail:
      state === "not_configured"
        ? `${label}: not configured`
        : `${label}: ${state.replace(/_/g, " ")}${claude?.isMock ? " (mock)" : ""}`,
  };
};

const app = await buildApp({
  db,
  health: createHealthProbe(db, redis, { claude: claudeHealth }),
  execution: {
    env: {
      registry,
      timeoutMs: providerTimeoutMs(),
      historyLimit: chatHistoryLimit(),
      subscriptionLimits: subscriptionLimitsFromEnv(),
    },
    bus,
  },
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
  await bus.close?.();
  await db.close();
  redis.disconnect();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
