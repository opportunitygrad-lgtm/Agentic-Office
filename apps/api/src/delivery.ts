import type { FastifyBaseLogger } from "fastify";

/**
 * Outbound delivery of security links. Real email delivery arrives with the
 * Outlook integration (Stage 14); until then links are only surfaced in
 * development logs. Tokens are NEVER logged in production.
 */
export interface SecurityDelivery {
  passwordReset(email: string, url: string): Promise<void>;
}

export function createDevDelivery(logger: FastifyBaseLogger, env: string): SecurityDelivery {
  return {
    async passwordReset(email, url) {
      if (env === "production") {
        logger.warn(
          { email },
          "password reset requested but no email transport is configured (Stage 14)",
        );
        return;
      }
      logger.info({ email, url }, "DEVELOPMENT ONLY — password reset link");
    },
  };
}
