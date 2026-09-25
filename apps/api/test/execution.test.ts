import { Writable } from "node:stream";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance, InjectOptions } from "fastify";
import { eq, sql } from "drizzle-orm";
import { createTestDb, resetOperationalData } from "@aibos/db/testing";
import { seedDev } from "@aibos/db/dev-seed";
import { createRunStore, schema } from "@aibos/db";
import { executeRun } from "@aibos/execution-core";
import { createProviderRegistry } from "@aibos/provider-core";
import type { AgentRunDetailDTO, ProviderStatusDTO, RunPreviewDTO, TaskDTO } from "@aibos/shared";
import { buildApp } from "../src/app";
import { MemoryRunBus } from "../src/run-bus";
import { healthStub, loginCookie } from "./helpers";

const SECRET = "sk-ant-test-SECRET-value-never-returned";
const handle = createTestDb();
let app: FastifyInstance;
const bus = new MemoryRunBus();
const registry = createProviderRegistry({ mode: "mock", env: {} });
const env = { registry, timeoutMs: 30_000, historyLimit: 12 };
const logs: string[] = [];
const cookies: Record<string, string> = {};
const as = (who: string) => (opts: InjectOptions) =>
  app.inject({ ...opts, headers: { ...opts.headers, cookie: cookies[who] } });
const get = (who: string, url: string) => as(who)({ method: "GET", url });
const post = (who: string, url: string, payload: unknown = {}) =>
  as(who)({ method: "POST", url, payload: payload as never });
const ids: Record<string, string> = {};

async function newTask(title: string) {
  const res = await post("ept.manager", "/v1/tasks", {
    companyId: ids.ept,
    title,
    type: "research",
    onDuplicate: "create",
  });
  const id = res.json<{ data: { task: { id: string } } }>().data.task.id;
  await post("ept.manager", `/v1/tasks/${id}/assign`, { agentId: ids.manager });
  return id;
}
const execute = (runId: string) =>
  executeRun(runId, {
    store: createRunStore(handle.db, env, { publish: (id, m) => bus.publish(id, m) }),
    provider: registry.get("CLAUDE"),
  });

beforeAll(async () => {
  await resetOperationalData(handle);
  await seedDev(handle.db);
  app = await buildApp({
    db: handle,
    health: healthStub,
    execution: { env, bus },
    logger: {
      level: "info",
      stream: new Writable({ write: (c, _e, cb) => (logs.push(String(c)), cb()) }),
    },
  });
  // A staff member (agent.chat but not task.execute).
  await handle.db
    .update(schema.users)
    .set({ status: "active" })
    .where(eq(schema.users.email, "disabled@aibos.example"));
  for (const who of ["owner", "ept.manager", "pa.manager", "disabled"])
    cookies[who] = await loginCookie(app, `${who}@aibos.example`);
  ids.ept = (await get("owner", "/v1/companies/euro-pilot-training")).json<{
    data: { id: string };
  }>().data.id;
  const [manager] = await handle.db
    .select()
    .from(schema.agents)
    .where(eq(schema.agents.name, "EPT Company Manager"));
  ids.manager = manager!.id;
});

afterAll(async () => {
  await app.close();
  await handle.close();
});

describe("providers", () => {
  it("never returns or logs credentials", async () => {
    const live = await buildApp({
      db: handle,
      health: healthStub,
      execution: {
        env: {
          ...env,
          registry: createProviderRegistry({ mode: "live", env: { ANTHROPIC_API_KEY: SECRET } }),
        },
        bus,
      },
      logger: {
        level: "trace",
        stream: new Writable({ write: (c, _e, cb) => (logs.push(String(c)), cb()) }),
      },
    });
    const cookie = await loginCookie(live, "owner@aibos.example");
    const res = await live.inject({ method: "GET", url: "/v1/providers", headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const claude = res
      .json<{ data: ProviderStatusDTO[] }>()
      .data.find((p) => p.provider === "CLAUDE")!;
    expect(claude).toMatchObject({
      connected: true,
      isMock: false,
      standardModel: "claude-sonnet-5",
      premiumModel: "claude-opus-5-5",
    });
    expect(res.body).not.toContain(SECRET);
    expect(res.body).not.toMatch(/sk-ant/);
    await live.close();
    expect(logs.join("")).not.toContain(SECRET);
  });

  it("shows OpenAI/Grok as not connected and restricts test/settings to platform roles", async () => {
    const list = (await get("ept.manager", "/v1/providers")).json<{ data: ProviderStatusDTO[] }>()
      .data;
    expect(list.find((p) => p.provider === "OPENAI")).toMatchObject({
      connected: false,
      state: "not_configured",
    });
    expect(list.find((p) => p.provider === "GROK")).toMatchObject({ connected: false });
    expect((await post("ept.manager", "/v1/providers/CLAUDE/test")).statusCode).toBe(403);
    expect(
      (
        await as("ept.manager")({
          method: "PUT",
          url: "/v1/providers/CLAUDE",
          payload: { standardEffort: "max" },
        })
      ).statusCode,
    ).toBe(403);
    const test = await post("owner", "/v1/providers/CLAUDE/test");
    expect(test.json<{ data: { state: string } }>().data.state).toBe("available");
    const audit = await handle.db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.action, "claude.connection_tested"));
    expect(audit).toHaveLength(1);
    for (let i = 0; i < 4; i++) await post("owner", "/v1/providers/CLAUDE/test");
    expect((await post("owner", "/v1/providers/CLAUDE/test")).statusCode).toBe(429);
  });
});

describe("task runs", () => {
  it("previews, enqueues (no inline provider call), executes in the worker path and reports results", async () => {
    const id = await newTask("Operational brief for EPT");
    const preview = (await get("ept.manager", `/v1/tasks/${id}/run-preview`)).json<{
      data: RunPreviewDTO & { canExecute: boolean };
    }>().data;
    expect(preview).toMatchObject({ eligible: true, canExecute: true });
    expect(preview.route).toMatchObject({
      provider: "CLAUDE",
      modelLabel: "Claude Sonnet 5",
      effort: "medium",
    });
    const callsBefore = (registry.get("CLAUDE") as unknown as { calls: unknown[] }).calls.length;
    const started = await post("ept.manager", `/v1/tasks/${id}/runs`, {
      idempotencyKey: "click-123456",
    });
    expect(started.statusCode).toBe(201);
    const run = started.json<{ data: { run: AgentRunDetailDTO } }>().data.run;
    expect(run.status).toBe("queued");
    expect(bus.enqueued).toContain(run.id);
    expect((registry.get("CLAUDE") as unknown as { calls: unknown[] }).calls.length).toBe(
      callsBefore,
    ); // API never calls the provider
    // Repeated click → same run, not a second provider call.
    const again = await post("ept.manager", `/v1/tasks/${id}/runs`, {
      idempotencyKey: "click-123456",
    });
    expect(again.statusCode).toBe(200);
    expect(again.json<{ data: { run: { id: string } } }>().data.run.id).toBe(run.id);
    expect(await execute(run.id)).toBe("completed");
    const done = (await get("ept.manager", `/v1/runs/${run.id}`)).json<{
      data: AgentRunDetailDTO;
    }>().data;
    expect(done).toMatchObject({
      status: "completed",
      isMock: true,
      modelLabel: "Claude Sonnet 5",
    });
    expect(done.result?.summary).toBeTruthy();
    expect(done.usage?.inputTokens).toBeGreaterThan(0);
    expect(done.events.length).toBeGreaterThan(8);
    const history = (await get("ept.manager", `/v1/tasks/${id}/runs`)).json<{
      data: AgentRunDetailDTO[];
    }>().data;
    expect(history.map((r) => r.number)).toEqual([1]);
    const fb = await post("ept.manager", `/v1/runs/${run.id}/feedback`, {
      rating: "useful",
      note: "Clear",
    });
    expect(fb.json<{ data: AgentRunDetailDTO }>().data.feedback).toMatchObject({
      rating: "useful",
    });
  });

  it("isolates runs by company and requires task.execute", async () => {
    const id = await newTask("Isolation check task");
    expect((await post("pa.manager", `/v1/tasks/${id}/runs`)).statusCode).toBe(404);
    expect((await post("disabled", `/v1/tasks/${id}/runs`)).statusCode).toBe(403);
    const { run } = (await post("ept.manager", `/v1/tasks/${id}/runs`)).json<{
      data: { run: { id: string } };
    }>().data;
    expect((await get("pa.manager", `/v1/runs/${run.id}`)).statusCode).toBe(404);
    expect((await post("pa.manager", `/v1/runs/${run.id}/cancel`)).statusCode).toBe(404);
    expect((await get("pa.manager", `/v1/runs/${run.id}/stream`)).statusCode).toBe(404);
    const cancelled = await post("ept.manager", `/v1/runs/${run.id}/cancel`);
    expect(cancelled.json<{ data: AgentRunDetailDTO }>().data.status).toBe("cancelled");
  });

  it("blocks premium when company policy forbids it, even via the API", async () => {
    const id = await newTask("Premium bypass attempt");
    const res = await post("ept.manager", `/v1/tasks/${id}/runs`, { modelTier: "premium" });
    expect(res.statusCode).toBe(409);
    expect(res.json<{ error: { message: string } }>().error.message).toMatch(
      /Premium model not permitted/,
    );
  });

  it("stops running runs through the worker channel", async () => {
    const id = await newTask("Stop via channel");
    const { run } = (await post("ept.manager", `/v1/tasks/${id}/runs`)).json<{
      data: { run: { id: string } };
    }>().data;
    await handle.db
      .update(schema.agentRuns)
      .set({ status: "streaming" })
      .where(eq(schema.agentRuns.id, run.id));
    const res = await post("ept.manager", `/v1/runs/${run.id}/cancel`);
    expect(res.json<{ data: AgentRunDetailDTO }>().data.status).toBe("cancel_requested");
    expect(bus.cancelled).toContain(run.id);
  });

  it("streams a snapshot for finished runs via SSE", async () => {
    const [done] = await handle.db
      .select()
      .from(schema.agentRuns)
      .where(eq(schema.agentRuns.status, "completed"))
      .limit(1);
    const res = await get("ept.manager", `/v1/runs/${done!.id}/stream`);
    expect(res.headers["content-type"]).toContain("text/event-stream");
    expect(res.body).toContain('"kind":"snapshot"');
  });
});

describe("agent chat", () => {
  it("answers authorised chat and denies cross-company or unauthorised use", async () => {
    const conv = await post("ept.manager", "/v1/conversations", {
      agentId: ids.manager,
      companyId: ids.ept,
    });
    const cid = conv.json<{ data: { id: string } }>().data.id;
    const sent = await post("ept.manager", `/v1/conversations/${cid}/messages`, {
      content: "What is your current responsibility and what information are you allowed to use?",
    });
    expect(sent.statusCode).toBe(201);
    const { runId } = sent.json<{ data: { runId: string } }>().data;
    expect(await execute(runId)).toBe("completed");
    const msgs = (await get("ept.manager", `/v1/conversations/${cid}/messages`)).json<{
      data: { role: string; model: string | null }[];
    }>().data;
    expect(msgs.map((m) => m.role)).toEqual(["human", "agent"]);
    expect(msgs[1]!.model).toBe("claude-sonnet-5");
    // Another person cannot use or read this conversation.
    expect(
      (await post("pa.manager", `/v1/conversations/${cid}/messages`, { content: "hi" })).statusCode,
    ).toBe(404);
    expect((await get("pa.manager", `/v1/runs/${runId}`)).statusCode).toBe(404);
    // PilotsAssist manager cannot open a conversation with an EPT agent.
    expect(
      (await post("pa.manager", "/v1/conversations", { agentId: ids.manager, companyId: ids.ept }))
        .statusCode,
    ).toBe(403);
  });

  it("requires agent.chat", async () => {
    const conv = await post("disabled", "/v1/conversations", {
      agentId: ids.manager,
      companyId: ids.ept,
    });
    const cid = conv.json<{ data: { id: string } }>().data.id;
    expect(
      (await post("disabled", `/v1/conversations/${cid}/messages`, { content: "Hello" }))
        .statusCode,
    ).toBe(201);
    await handle.db.execute(
      sql`update company_memberships set role_id = (select id from roles where key = 'viewer') where user_id = (select id from users where email = 'disabled@aibos.example')`,
    );
    await handle.db
      .update(schema.agentRuns)
      .set({ status: "cancelled" })
      .where(eq(schema.agentRuns.conversationId, cid));
    expect(
      (await post("disabled", `/v1/conversations/${cid}/messages`, { content: "Hello again" }))
        .statusCode,
    ).toBe(403);
  });
});

describe("dashboards", () => {
  it("labels mock usage and keeps real Claude usage separate", async () => {
    const usage = (await get("owner", "/v1/usage")).json<{
      data?: unknown;
      isMock?: boolean;
      providers?: { provider: string; isMock: boolean }[];
    }>();
    const body = (usage as { data?: typeof usage }).data ?? usage;
    const providers = (body as { providers: { provider: string; isMock: boolean }[] }).providers;
    expect(providers.find((p) => p.provider === "CLAUDE")!.isMock).toBe(false);
    expect(providers.find((p) => p.provider === "OPENAI")!.isMock).toBe(true);
    const stats = (await get("ept.manager", "/v1/workforce/manager-stats")).json<{
      data: { runsToday: number; mockRunsToday: number };
    }>().data;
    expect(stats.runsToday).toBe(0); // only mock runs happened
    expect(stats.mockRunsToday).toBeGreaterThan(0);
  });

  it("task list is unaffected for other companies", async () => {
    const tasks = (await get("pa.manager", "/v1/tasks?limit=200")).json<{ data: TaskDTO[] }>().data;
    expect(tasks.every((t) => t.company?.slug !== "euro-pilot-training")).toBe(true);
  });
});
