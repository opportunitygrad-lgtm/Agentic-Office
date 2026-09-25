import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import { ZodError } from "zod";
import {
  ConflictError,
  ForbiddenError,
  InvalidTokenError,
  NotFoundError,
  type DbHandle,
} from "@aibos/db";
import type { ApiErrorBody } from "@aibos/shared";
import { adminRoutes } from "./admin-routes";
import { authRoutes } from "./auth-routes";
import type { SecurityDelivery } from "./delivery";
import type { HealthProbe } from "./health";
import { registerRoutes } from "./routes";
import { knowledgeRoutes } from "./knowledge-routes";
import { workforceRoutes } from "./workforce-routes";
import { executionRoutes, type ExecutionDeps } from "./execution-routes";
import { MemoryRunBus } from "./run-bus";
import { createProviderRegistry } from "@aibos/provider-core";
import { TooManyRequestsError, UnauthorizedError, securityPlugin } from "./security";
import { MemoryThrottle, type ThrottleStore } from "./throttle";

export interface AppDeps {
  db: DbHandle;
  health: HealthProbe;
  corsOrigins?: string[];
  logger?: boolean | object;
  throttle?: ThrottleStore;
  delivery?: SecurityDelivery;
  cookieSecure?: boolean;
  webOrigin?: string;
  /** Proxies allowed to set X-Forwarded-For (the Next.js rewrite). */
  trustProxy?: string | boolean;
  production?: boolean;
  /** Stage 05 execution: provider registry + run bus. Tests default to mock + in-memory bus. */
  execution?: ExecutionDeps;
}

interface ResolvedDeps extends AppDeps {
  execution: ExecutionDeps;
  throttle: ThrottleStore;
  delivery: SecurityDelivery;
  cookieSecure: boolean;
  webOrigin: string;
}

declare module "fastify" {
  interface FastifyInstance {
    deps: ResolvedDeps;
  }
}

export async function buildApp(input: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: input.logger ?? false,
    bodyLimit: 256 * 1024,
    trustProxy: input.trustProxy ?? "127.0.0.1,::1",
    genReqId: () => crypto.randomUUID(),
  });
  const webOrigin = input.webOrigin ?? "http://localhost:3000";
  const deps: ResolvedDeps = {
    ...input,
    throttle: input.throttle ?? new MemoryThrottle(),
    delivery: input.delivery ?? { passwordReset: async () => {} },
    cookieSecure: input.cookieSecure ?? !!input.production,
    webOrigin,
    execution: input.execution ?? {
      env: {
        registry: createProviderRegistry({ mode: "mock", env: {} }),
        timeoutMs: 30_000,
        historyLimit: 12,
      },
      bus: new MemoryRunBus(),
    },
  };
  app.decorate("deps", deps);

  // JSON bodies only: plain-text / form posts (classic CSRF vectors) get 415.
  app.removeContentTypeParser("text/plain");

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, { origin: input.corsOrigins ?? false, credentials: true });
  await app.register(cookie);
  await app.register(securityPlugin, {
    allowedOrigins: [...new Set([webOrigin, ...(input.corsOrigins ?? [])])],
  });

  app.setErrorHandler((err, req, reply) => {
    let status = 500;
    let body: ApiErrorBody = {
      error: { code: "internal_error", message: "Internal server error" },
    };
    if (err instanceof ZodError) {
      status = 400;
      body = {
        error: {
          code: "validation_error",
          message: "Request validation failed",
          issues: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        },
      };
    } else if (err instanceof UnauthorizedError) {
      status = 401;
      body = { error: { code: err.code, message: err.message } };
    } else if (err instanceof ForbiddenError) {
      status = 403;
      body = { error: { code: err.code, message: err.message } };
    } else if (err instanceof NotFoundError) {
      status = 404;
      body = { error: { code: err.code, message: err.message } };
    } else if (err instanceof ConflictError) {
      status = 409;
      body = { error: { code: err.code, message: err.message } };
    } else if (err instanceof InvalidTokenError) {
      status = 400;
      body = { error: { code: err.code, message: err.message } };
    } else if (err instanceof TooManyRequestsError) {
      status = 429;
      body = { error: { code: "rate_limited", message: err.message } };
    } else if (
      typeof (err as { statusCode?: number }).statusCode === "number" &&
      (err as { statusCode: number }).statusCode < 500
    ) {
      const e = err as { statusCode: number; message: string };
      status = e.statusCode;
      body = { error: { code: "bad_request", message: e.message } };
    } else {
      req.log.error({ err }, "unhandled error");
    }
    void reply.status(status).send(body);
  });

  app.setNotFoundHandler((req, reply) => {
    void reply
      .status(404)
      .send({ error: { code: "not_found", message: `Route ${req.method} ${req.url} not found` } });
  });

  await app.register(authRoutes, { prefix: "/v1" });
  await app.register(adminRoutes, { prefix: "/v1" });
  await app.register(registerRoutes, { prefix: "/v1" });
  await app.register(knowledgeRoutes, { prefix: "/v1" });
  await app.register(workforceRoutes, { prefix: "/v1" });
  await app.register(executionRoutes(deps.execution), { prefix: "/v1" });

  // Public liveness. Production exposes only the overall status.
  app.get("/health", async () => {
    const h = await deps.health.check();
    return input.production ? { status: h.status, checkedAt: h.checkedAt } : h;
  });
  return app;
}
