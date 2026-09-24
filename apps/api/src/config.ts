import { z } from "zod";
import { loadEnv } from "@aibos/db";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.string().default("info"),
  API_HOST: z.string().default("127.0.0.1"),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  API_CORS_ORIGINS: z
    .string()
    .default("http://localhost:3000")
    .transform((v) =>
      v
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  /** Public URL of the web app — used to build invitation / reset links. */
  WEB_ORIGIN: z.string().url().default("http://localhost:3000"),
  /** Secure cookies (default: on in production). */
  COOKIE_SECURE: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === "true")),
  /** Proxies whose X-Forwarded-For is trusted (the web app's rewrite runs on loopback). */
  TRUST_PROXY: z.string().default("127.0.0.1,::1"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  REDIS_URL: z.string().min(1, "REDIS_URL is required"),
});

export type ApiConfig = z.infer<typeof schema>;

export function loadConfig(): ApiConfig {
  loadEnv();
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid API configuration — ${msg}`);
  }
  return parsed.data;
}
