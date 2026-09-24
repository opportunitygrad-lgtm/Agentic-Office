import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import { ZodError } from "zod";
import { ConflictError, NotFoundError, type DbHandle } from "@aibos/db";
import type { ApiErrorBody } from "@aibos/shared";
import type { HealthProbe } from "./health";
import { registerRoutes } from "./routes";

export interface AppDeps {
  db: DbHandle;
  health: HealthProbe;
  corsOrigins?: string[];
  logger?: boolean | object;
}

declare module "fastify" {
  interface FastifyInstance {
    deps: AppDeps;
  }
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: deps.logger ?? false,
    bodyLimit: 256 * 1024,
    genReqId: () => crypto.randomUUID(),
  });
  app.decorate("deps", deps);

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, { origin: deps.corsOrigins ?? false });

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
    } else if (err instanceof NotFoundError) {
      status = 404;
      body = { error: { code: err.code, message: err.message } };
    } else if (err instanceof ConflictError) {
      status = 409;
      body = { error: { code: err.code, message: err.message } };
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

  await app.register(registerRoutes, { prefix: "/v1" });
  app.get("/health", async () => deps.health.check());
  return app;
}
