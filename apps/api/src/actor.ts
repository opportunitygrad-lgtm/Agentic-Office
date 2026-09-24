import type { FastifyRequest } from "fastify";
import type { Actor } from "@aibos/db";

/**
 * Until authentication lands (Stage 02) every request acts as the local
 * development user. All mutations still carry request metadata into the audit log.
 */
export function actorFrom(req: FastifyRequest): Actor {
  return {
    kind: "human",
    ref: "dev-user",
    ipAddress: req.ip,
    userAgent: req.headers["user-agent"]?.slice(0, 500),
    requestId: req.id,
  };
}
