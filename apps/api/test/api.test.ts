import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance, InjectOptions } from "fastify";
import { VALID_COMPANY, createTestDb, resetOperationalData } from "@aibos/db/testing";
import type { AgentDTO, CompanyDTO, DashboardSummaryDTO, TaskDTO } from "@aibos/shared";
import { seedDev } from "@aibos/db/dev-seed";
import { buildApp } from "../src/app";
import { loginCookie } from "./helpers";

const handle = createTestDb();
let app: FastifyInstance;
let cookie = "";
/** Requests as the development Platform Owner. */
const owner = (opts: InjectOptions) =>
  app.inject({ ...opts, headers: { ...opts.headers, cookie } });

beforeAll(async () => {
  await resetOperationalData(handle);
  await seedDev(handle.db);
  app = await buildApp({
    db: handle,
    health: {
      check: async () => ({ status: "ok", checkedAt: new Date().toISOString(), services: [] }),
    },
  });
  cookie = await loginCookie(app, "owner@aibos.example");
});

afterAll(async () => {
  await app.close();
  await handle.close();
});

describe("companies API", () => {
  it("lists the seeded companies", async () => {
    const res = await owner({ method: "GET", url: "/v1/companies?stats=true" });
    expect(res.statusCode).toBe(200);
    const { data } = res.json<{ data: (CompanyDTO & { stats: { agents: number } })[] }>();
    expect(data.map((c) => c.name)).toEqual([
      "Euro Pilot Training",
      "PilotsAssist",
      "Opportunitygrad",
    ]);
    expect(data[0]?.stats.agents).toBeGreaterThan(0);
  });

  it("creates a company with initial agents", async () => {
    const res = await owner({
      method: "POST",
      url: "/v1/companies",
      payload: {
        ...VALID_COMPANY,
        name: "SkyBridge Academy",
        initialAgents: ["company_manager", "research"],
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json<{ data: CompanyDTO; agentsCreated: number }>();
    expect(body.data.slug).toBe("skybridge-academy");
    expect(body.agentsCreated).toBe(2);

    const agents = await owner({ method: "GET", url: "/v1/agents?company=skybridge-academy" });
    const names = agents.json<{ data: AgentDTO[] }>().data.map((a) => a.name);
    expect(names).toContain("SkyBridge Academy Research Agent");
  });

  it("rejects an invalid company", async () => {
    const res = await owner({ method: "POST", url: "/v1/companies", payload: { name: "" } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("validation_error");
  });

  it("rejects an invalid budget", async () => {
    const res = await owner({
      method: "POST",
      url: "/v1/companies",
      payload: { ...VALID_COMPANY, name: "Budget Co", dailyAiBudget: -10 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.issues[0].path).toBe("dailyAiBudget");
  });

  it("rejects invalid concurrency", async () => {
    const res = await owner({
      method: "POST",
      url: "/v1/companies",
      payload: { ...VALID_COMPANY, name: "Concurrency Co", concurrencyLimit: 500 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.issues[0].path).toBe("concurrencyLimit");
  });

  it("rejects duplicates with 409 and unknown companies with 404", async () => {
    const dup = await owner({
      method: "POST",
      url: "/v1/companies",
      payload: { ...VALID_COMPANY, name: "PilotsAssist" },
    });
    expect(dup.statusCode).toBe(409);
    const missing = await owner({ method: "GET", url: "/v1/agents?company=nope" });
    expect(missing.statusCode).toBe(404);
  });
});

describe("agents API", () => {
  it("lists agents and filters by company and status", async () => {
    const all = (await owner({ method: "GET", url: "/v1/agents" })).json<{
      data: AgentDTO[];
    }>().data;
    expect(all.length).toBeGreaterThanOrEqual(18);

    const og = (await owner({ method: "GET", url: "/v1/agents?company=opportunitygrad" })).json<{
      data: AgentDTO[];
    }>().data;
    expect(og.some((a) => a.name === "Opportunitygrad Admissions")).toBe(true);
    expect(og.some((a) => a.name === "EPT Marketing")).toBe(false);
    expect(og.some((a) => a.scope === "global")).toBe(true);

    const working = (await owner({ method: "GET", url: "/v1/agents?status=working" })).json<{
      data: AgentDTO[];
    }>().data;
    expect(working.every((a) => a.status === "working")).toBe(true);
    expect(working.find((a) => a.name === "Group Manager")?.currentTask?.title).toBeTruthy();

    const email = all.find((a) => a.name === "Email & Communications")!;
    expect(email.companies).toHaveLength(3);
  });

  it("reassigns an agent to multiple companies", async () => {
    const all = (await owner({ method: "GET", url: "/v1/agents" })).json<{
      data: AgentDTO[];
    }>().data;
    const agent = all.find((a) => a.name === "EPT Marketing")!;
    const companies = (await owner({ method: "GET", url: "/v1/companies" })).json<{
      data: CompanyDTO[];
    }>().data;
    const ids = companies.filter((c) => c.slug !== "opportunitygrad").map((c) => c.id);
    const res = await owner({
      method: "PUT",
      url: `/v1/agents/${agent.id}/companies`,
      payload: { companyIds: ids },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ data: AgentDTO }>().data.companies.length).toBe(ids.length);
  });
});

describe("tasks, dashboard, live sessions", () => {
  it("lists tasks with status filters and hierarchy", async () => {
    const res = await owner({ method: "GET", url: "/v1/tasks?status=running,needs_approval" });
    const tasks = res.json<{ data: TaskDTO[] }>().data;
    expect(tasks.length).toBeGreaterThan(0);
    expect(tasks.every((t) => ["running", "needs_approval"].includes(t.status))).toBe(true);

    const root = tasks.find((t) => t.title === "Build EASA flight school partner shortlist")!;
    const tree = (await owner({ method: "GET", url: `/v1/tasks/${root.id}/tree` })).json<{
      data: TaskDTO[];
    }>().data;
    expect(tree.map((t) => t.title)).toEqual(
      expect.arrayContaining([
        "Research European EASA flight schools",
        "Verify ATO approvals against EASA register",
        "Draft partnership introduction emails",
      ]),
    );
  });

  it("returns a dashboard summary (global and scoped)", async () => {
    const global = (
      await owner({ method: "GET", url: "/v1/dashboard/summary" })
    ).json<DashboardSummaryDTO>();
    expect(global.scope).toBeNull();
    expect(global.workforce.total).toBeGreaterThanOrEqual(18);
    expect(global.approvals.length).toBeGreaterThan(0);
    expect(global.usage.providers.map((p) => p.provider)).toEqual([
      "CLAUDE",
      "OPENAI",
      "GROK",
      "LOCAL",
    ]);
    expect(global.usage.isMock).toBe(true);

    const ept = (
      await owner({ method: "GET", url: "/v1/dashboard/summary?company=euro-pilot-training" })
    ).json<DashboardSummaryDTO>();
    expect(ept.scope?.name).toBe("Euro Pilot Training");
    expect(ept.tasks.every((t) => t.company?.slug === "euro-pilot-training")).toBe(true);
  });

  it("serves mock live sessions and health", async () => {
    const res = await owner({ method: "GET", url: "/v1/live-sessions" });
    const body = res.json<{ data: { isMock: boolean; surface: string }[]; isMock: boolean }>();
    expect(body.isMock).toBe(true);
    expect(body.data.length).toBeGreaterThan(0);
    expect((await owner({ method: "GET", url: "/health" })).statusCode).toBe(200);
  });
});
