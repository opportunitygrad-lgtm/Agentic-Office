import type { FastifyInstance } from "fastify";
import { DEV_SEED_PASSWORD } from "@aibos/db/dev-seed";
import { SESSION_COOKIE } from "@aibos/shared";

/** Signs in and returns a Cookie header value for subsequent requests. */
export async function loginCookie(
  app: FastifyInstance,
  email: string,
  password = DEV_SEED_PASSWORD,
): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/v1/auth/login",
    payload: { email, password },
  });
  const c = res.cookies.find((x) => x.name === SESSION_COOKIE);
  if (res.statusCode !== 200 || !c)
    throw new Error(`login failed for ${email}: ${res.statusCode} ${res.body}`);
  return `${SESSION_COOKIE}=${c.value}`;
}

export const healthStub = {
  check: async () => ({ status: "ok" as const, checkedAt: new Date().toISOString(), services: [] }),
};
