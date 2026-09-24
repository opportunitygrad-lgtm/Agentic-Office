import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createTestDb, resetOperationalData } from "@aibos/db/testing";
import { DEV_SEED_PASSWORD, seedDev } from "@aibos/db/dev-seed";
import { SESSION_COOKIE } from "@aibos/shared";
import { buildApp } from "../src/app";
import { MemoryThrottle } from "../src/throttle";
import { healthStub, loginCookie } from "./helpers";

const handle = createTestDb();
let app: FastifyInstance;
const resetLinks: string[] = [];

beforeAll(async () => {
  await resetOperationalData(handle);
  await seedDev(handle.db);
});

beforeEach(async () => {
  // Fresh throttle per test so brute-force tests don't bleed into others.
  await app?.close();
  app = await buildApp({
    db: handle,
    health: healthStub,
    throttle: new MemoryThrottle(),
    delivery: { passwordReset: async (_email, url) => void resetLinks.push(url) },
    corsOrigins: ["http://localhost:3000"],
  });
});

afterAll(async () => {
  await app.close();
  await handle.close();
});

describe("authentication", () => {
  it("logs in with a secure session cookie and returns the principal", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { email: "OWNER@aibos.example", password: DEV_SEED_PASSWORD },
    });
    expect(res.statusCode).toBe(200);
    const c = res.cookies.find((x) => x.name === SESSION_COOKIE)!;
    expect(c.httpOnly).toBe(true);
    expect(c.sameSite).toBe("Lax");
    expect(c.path).toBe("/");
    expect(res.body).not.toContain("argon2");

    const me = await app.inject({
      method: "GET",
      url: "/v1/auth/me",
      headers: { cookie: `${SESSION_COOKIE}=${c.value}` },
    });
    expect(me.statusCode).toBe(200);
    const body = me.json();
    expect(body.user.email).toBe("owner@aibos.example");
    expect(body.isPlatformOwner).toBe(true);
    expect(body.accessibleCompanies).toHaveLength(3);
    expect(JSON.stringify(body)).not.toMatch(/passwordHash|password_hash|\$argon2/);
  });

  it("rejects bad credentials with a generic message (no enumeration)", async () => {
    const wrong = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { email: "owner@aibos.example", password: "nope-nope-nope" },
    });
    const unknown = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { email: "ghost@aibos.example", password: "nope-nope-nope" },
    });
    expect(wrong.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(wrong.json()).toEqual(unknown.json());
    expect(wrong.cookies.find((c) => c.name === SESSION_COOKIE)).toBeUndefined();
  });

  it("throttles repeated failures for an account", async () => {
    for (let i = 0; i < 5; i++) {
      await app.inject({
        method: "POST",
        url: "/v1/auth/login",
        payload: { email: "ept.manager@aibos.example", password: "wrong-password-x" },
      });
    }
    const blocked = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { email: "ept.manager@aibos.example", password: DEV_SEED_PASSWORD },
    });
    expect(blocked.statusCode).toBe(429);
  });

  it("denies disabled accounts", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { email: "disabled@aibos.example", password: DEV_SEED_PASSWORD },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("account_disabled");
  });

  it("logs out and invalidates the session server-side", async () => {
    const cookie = await loginCookie(app, "pa.manager@aibos.example");
    expect(
      (await app.inject({ method: "GET", url: "/v1/auth/me", headers: { cookie } })).statusCode,
    ).toBe(200);
    const out = await app.inject({ method: "POST", url: "/v1/auth/logout", headers: { cookie } });
    expect(out.statusCode).toBe(204);
    const after = await app.inject({ method: "GET", url: "/v1/auth/me", headers: { cookie } });
    expect(after.statusCode).toBe(401);
    expect(after.json().error.code).toBe("session_expired");
  });

  it("requires authentication on protected routes (401) but not on health", async () => {
    for (const url of [
      "/v1/auth/me",
      "/v1/companies",
      "/v1/tasks",
      "/v1/dashboard/summary",
      "/v1/users",
      "/v1/shell",
    ]) {
      const res = await app.inject({ method: "GET", url });
      expect(res.statusCode, url).toBe(401);
    }
    expect((await app.inject({ method: "GET", url: "/health" })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/v1/auth/status" })).json()).toEqual({
      bootstrapRequired: false,
    });
  });

  it("rejects cross-origin state-changing requests and non-JSON bodies", async () => {
    const evil = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      headers: { origin: "https://evil.example" },
      payload: { email: "owner@aibos.example", password: DEV_SEED_PASSWORD },
    });
    expect(evil.statusCode).toBe(403);
    const form = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      headers: { "content-type": "text/plain" },
      payload: "email=x",
    });
    expect(form.statusCode).toBe(415);
  });

  it("resets a password with a single-use token and rejects invalid tokens", async () => {
    const generic = await app.inject({
      method: "POST",
      url: "/v1/auth/password-reset/request",
      payload: { email: "nobody@aibos.example" },
    });
    expect(generic.statusCode).toBe(202);
    const before = resetLinks.length;
    const req = await app.inject({
      method: "POST",
      url: "/v1/auth/password-reset/request",
      payload: { email: "pa.manager@aibos.example" },
    });
    expect(req.json()).toEqual(generic.json());
    expect(resetLinks.length).toBe(before + 1);
    const token = new URL(resetLinks.at(-1)!).searchParams.get("token")!;

    const weak = await app.inject({
      method: "POST",
      url: "/v1/auth/password-reset/confirm",
      payload: { token, password: "short" },
    });
    expect(weak.statusCode).toBe(400);
    const ok = await app.inject({
      method: "POST",
      url: "/v1/auth/password-reset/confirm",
      payload: { token, password: "a-new-long-password-2026" },
    });
    expect(ok.statusCode).toBe(200);
    const reuse = await app.inject({
      method: "POST",
      url: "/v1/auth/password-reset/confirm",
      payload: { token, password: "another-long-password-2026" },
    });
    expect(reuse.statusCode).toBe(400);
    expect(reuse.json().error.code).toBe("invalid_token");
    const bogus = await app.inject({
      method: "POST",
      url: "/v1/auth/password-reset/confirm",
      payload: { token: "A".repeat(43), password: "another-long-password-2026" },
    });
    expect(bogus.json().error.code).toBe("invalid_token");
    expect(
      (await loginCookie(app, "pa.manager@aibos.example", "a-new-long-password-2026")).startsWith(
        SESSION_COOKIE,
      ),
    ).toBe(true);
  });

  it("runs the invitation lifecycle: lookup, accept (auto sign-in), single use", async () => {
    const owner = await loginCookie(app, "owner@aibos.example");
    const roles = (
      await app.inject({ method: "GET", url: "/v1/roles", headers: { cookie: owner } })
    ).json<{ data: { id: string; key: string }[] }>().data;
    const companies = (
      await app.inject({ method: "GET", url: "/v1/companies", headers: { cookie: owner } })
    ).json<{ data: { id: string }[] }>().data;
    const invite = await app.inject({
      method: "POST",
      url: "/v1/users/invitations",
      headers: { cookie: owner },
      payload: {
        email: "invitee@aibos.example",
        firstName: "Invitee",
        memberships: [
          { companyId: companies[0]!.id, roleId: roles.find((r) => r.key === "viewer")!.id },
        ],
      },
    });
    expect(invite.statusCode).toBe(201);
    const token = String(invite.json().invitationUrl).split("/invite/")[1]!;

    const lookup = await app.inject({
      method: "POST",
      url: "/v1/auth/invitations/lookup",
      payload: { token },
    });
    expect(lookup.json()).toMatchObject({ email: "invitee@aibos.example" });
    const accept = await app.inject({
      method: "POST",
      url: "/v1/auth/invitations/accept",
      payload: { token, password: "invitee-password-2026" },
    });
    expect(accept.statusCode).toBe(200);
    const c = accept.cookies.find((x) => x.name === SESSION_COOKIE)!;
    const me = await app.inject({
      method: "GET",
      url: "/v1/auth/me",
      headers: { cookie: `${SESSION_COOKIE}=${c.value}` },
    });
    expect(me.json().accessibleCompanies).toHaveLength(1);
    expect(
      (await app.inject({ method: "POST", url: "/v1/auth/invitations/lookup", payload: { token } }))
        .statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/auth/invitations/accept",
          payload: { token, password: "invitee-password-2026" },
        })
      ).json().error.code,
    ).toBe("invalid_token");
  });
});
