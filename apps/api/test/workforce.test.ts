import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance, InjectOptions } from "fastify";
import { createTestDb, resetOperationalData } from "@aibos/db/testing";
import { seedDev } from "@aibos/db/dev-seed";
import type {
  AgentDTO,
  AgentRoleDTO,
  AuditEventDTO,
  CompiledAgentInstructionPack,
  DelegationDecisionDTO,
  HandoffDTO,
  OrgChartDTO,
  TaskDTO,
  TaskDetailDTO,
  TeamDTO,
} from "@aibos/shared";
import { buildApp } from "../src/app";
import { healthStub, loginCookie } from "./helpers";

const handle = createTestDb();
let app: FastifyInstance;
const cookies: Record<string, string> = {};
const as = (who: string) => (opts: InjectOptions) =>
  app.inject({ ...opts, headers: { ...opts.headers, cookie: cookies[who] } });
const get = (who: string, url: string) => as(who)({ method: "GET", url });
const send = (who: string, method: "POST" | "PUT" | "PATCH", url: string, payload: unknown = {}) =>
  as(who)({ method, url, payload: payload as never });

const ids: Record<string, string> = {};
const agentByName = async (name: string) =>
  (await get("owner", `/v1/agents?q=${encodeURIComponent(name)}`))
    .json<{ data: AgentDTO[] }>()
    .data.find((a) => a.name === name)!;
const taskByTitle = async (title: string, company: string) =>
  (await get("owner", `/v1/tasks?company=${company}&limit=200`))
    .json<{ data: TaskDTO[] }>()
    .data.find((t) => t.title === title)!;

beforeAll(async () => {
  await resetOperationalData(handle);
  await seedDev(handle.db);
  app = await buildApp({ db: handle, health: healthStub });
  for (const who of ["owner", "ept.manager", "pa.manager", "og.marketing", "group.admin"])
    cookies[who] = await loginCookie(app, `${who}@aibos.example`);
  for (const slug of ["euro-pilot-training", "pilotsassist", "opportunitygrad"])
    ids[slug] = (await get("owner", `/v1/companies/${slug}`)).json<{
      data: { id: string };
    }>().data.id;
});

afterAll(async () => {
  await app.close();
  await handle.close();
});

describe("workforce API — authentication & isolation", () => {
  it("rejects unauthenticated requests", async () => {
    for (const url of [
      "/v1/teams",
      "/v1/workforce/org",
      "/v1/handoffs",
      "/v1/operating-policy",
      "/v1/workforce/manager-stats",
    ])
      expect((await app.inject({ method: "GET", url })).statusCode, url).toBe(401);
  });

  it("scopes teams, org chart and handoffs to the viewer's companies", async () => {
    const teams = (await get("ept.manager", "/v1/teams")).json<{ data: TeamDTO[] }>().data;
    expect(teams.map((t) => t.name)).toEqual(["EPT Partnerships Team"]);
    expect((await get("ept.manager", "/v1/teams?company=pilotsassist")).statusCode).toBe(403);
    const paTeam = (await get("owner", "/v1/teams?company=pilotsassist")).json<{
      data: TeamDTO[];
    }>().data[0]!;
    expect((await get("ept.manager", `/v1/teams/${paTeam.id}`)).statusCode).toBe(404);
    const org = (await get("ept.manager", "/v1/workforce/org")).json<{ data: OrgChartDTO }>().data;
    const names = JSON.stringify(org);
    expect(names).toContain("EPT Company Manager");
    expect(names).not.toContain("PilotsAssist");
    const handoffs = (await get("pa.manager", "/v1/handoffs")).json<{ data: HandoffDTO[] }>().data;
    expect(handoffs).toHaveLength(0);
  });
});

describe("roles & instructions", () => {
  it("lets a company manager edit own agents' roles with versioned history", async () => {
    const agent = await agentByName("EPT Marketing");
    const role = (await get("ept.manager", `/v1/agents/${agent.id}/role`)).json<{
      data: AgentRoleDTO;
    }>().data;
    expect(role.viewerCanManage).toBe(true);
    const next = {
      ...role.role,
      freeText: "Lead with Portuguese and Spanish candidate markets this quarter.",
    };
    const res = await send("ept.manager", "PUT", `/v1/agents/${agent.id}/role`, {
      role: next,
      changeSummary: "Quarter focus",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ data: { version: number } }>().data.version).toBe(1);
  });

  it("denies role edits on another company's agent and on shared global agents", async () => {
    const pa = await agentByName("PilotsAssist Marketing");
    const res = await send("ept.manager", "PUT", `/v1/agents/${pa.id}/role`, {
      role: {},
      changeSummary: "x",
    });
    expect([403, 404, 400]).toContain(res.statusCode);
    const paRole = (await get("owner", `/v1/agents/${pa.id}/role`)).json<{ data: AgentRoleDTO }>()
      .data;
    expect(
      (
        await send("ept.manager", "PUT", `/v1/agents/${pa.id}/role`, {
          role: paRole.role,
          changeSummary: "x",
        })
      ).statusCode,
    ).toBe(404);
    const global = await agentByName("Group Manager");
    const gRole = (await get("ept.manager", `/v1/agents/${global.id}/role`)).json<{
      data: AgentRoleDTO;
    }>().data;
    expect(gRole.viewerCanManage).toBe(false);
    expect(
      (
        await send("ept.manager", "PUT", `/v1/agents/${global.id}/role`, {
          role: gRole.role,
          changeSummary: "x",
        })
      ).statusCode,
    ).toBe(403);
  });

  it("previews compiled instructions for a permitted company only (audited)", async () => {
    const agent = await agentByName("EPT Flight School Research");
    const res = await get(
      "ept.manager",
      `/v1/agents/${agent.id}/instructions?company=euro-pilot-training`,
    );
    expect(res.statusCode).toBe(200);
    const pack = res.json<{ data: CompiledAgentInstructionPack }>().data;
    expect(pack.layers[0]!.layer).toBe("platform");
    expect(pack.text).toContain("## PLATFORM SAFETY");
    expect(
      (await get("ept.manager", `/v1/agents/${agent.id}/instructions?company=pilotsassist`))
        .statusCode,
    ).toBe(403);
    const audit = (await get("owner", "/v1/audit-events?limit=50")).json<{
      data: AuditEventDTO[];
    }>().data;
    expect(audit.some((e) => e.action === "instruction.preview_generated")).toBe(true);
  });

  it("only platform-level people can create global teams or change the workforce policy", async () => {
    const ept = await agentByName("EPT Marketing");
    const global = await send("ept.manager", "POST", "/v1/teams", {
      companyId: null,
      name: "Global Ops",
      memberIds: [],
    });
    expect(global.statusCode).toBe(403);
    const own = await send("ept.manager", "POST", "/v1/teams", {
      companyId: ids["euro-pilot-training"],
      name: "EPT Brand",
      memberIds: [ept.id],
    });
    expect(own.statusCode).toBe(201);
    const pa = await agentByName("PilotsAssist Marketing");
    const mixed = await send("ept.manager", "POST", "/v1/teams", {
      companyId: ids["euro-pilot-training"],
      name: "Mixed",
      memberIds: [pa.id],
    });
    expect(mixed.statusCode).toBe(403);
    expect(
      (await send("ept.manager", "PUT", "/v1/workforce/policy", { globalActiveAgentLimit: 50 }))
        .statusCode,
    ).toBe(403);
    expect(
      (
        await send("owner", "POST", "/v1/teams", {
          companyId: null,
          name: "Global Ops",
          memberIds: [],
        })
      ).statusCode,
    ).toBe(201);
  });

  it("prevents reporting cycles through the API", async () => {
    const manager = await agentByName("EPT Company Manager");
    const research = await agentByName("EPT Flight School Research");
    const res = await send("ept.manager", "PUT", `/v1/agents/${manager.id}/hierarchy`, {
      reportsToAgentId: research.id,
      escalationAgentId: null,
      fallbackManagerId: null,
    });
    expect(res.statusCode).toBe(409);
  });
});

describe("delegation & assignment", () => {
  it("previews delegation with per-candidate checks", async () => {
    const task = await taskByTitle("Find EASA flight schools in Portugal", "euro-pilot-training");
    const res = await get("ept.manager", `/v1/tasks/${task.id}/delegation`);
    expect(res.statusCode).toBe(200);
    const d = res.json<{ data: DelegationDecisionDTO }>().data;
    expect(d.candidates.length).toBeGreaterThan(0);
    expect(d.candidates.every((c) => c.checks.length > 0)).toBe(true);
    expect(JSON.stringify(d)).not.toContain("PilotsAssist");
    expect((await get("pa.manager", `/v1/tasks/${task.id}/delegation`)).statusCode).toBe(404);
  });

  it("blocks cross-company delegation and assignment", async () => {
    const task = await taskByTitle("Find EASA flight schools in Portugal", "euro-pilot-training");
    const pa = await agentByName("PilotsAssist Aviation Research");
    expect((await send("pa.manager", "POST", `/v1/tasks/${task.id}/delegate`, {})).statusCode).toBe(
      404,
    );
    // The EPT manager cannot even see the PilotsAssist agent.
    expect(
      (
        await send("ept.manager", "POST", `/v1/tasks/${task.id}/delegate`, {
          targetAgentId: pa.id,
          reason: "x",
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await send("owner", "POST", `/v1/tasks/${task.id}/delegate`, {
          targetAgentId: pa.id,
          reason: "x",
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (await send("owner", "POST", `/v1/tasks/${task.id}/assign`, { agentId: pa.id })).statusCode,
    ).toBe(403);
  });

  it("audits manual assignment and override reasons", async () => {
    const task = await taskByTitle("Find EASA flight schools in Portugal", "euro-pilot-training");
    const research = await agentByName("EPT Flight School Research");
    const res = await send("ept.manager", "POST", `/v1/tasks/${task.id}/assign`, {
      agentId: research.id,
      reason: "Owner of partner research",
    });
    expect(res.statusCode).toBe(200);
    const detail = res.json<{ data: TaskDetailDTO }>().data;
    expect(detail.assignedAgent?.id).toBe(research.id);
    expect(detail.delegations[0]).toMatchObject({
      override: true,
      reason: "Owner of partner research",
    });
    expect((await send("ept.manager", "POST", `/v1/tasks/${task.id}/pause`)).statusCode).toBe(200);
    expect((await send("ept.manager", "POST", `/v1/tasks/${task.id}/resume`)).statusCode).toBe(200);
  });

  it("limits department managers to their department", async () => {
    const meta = await taskByTitle("Review Meta campaign performance", "opportunitygrad");
    expect((await get("og.marketing", `/v1/tasks/${meta.id}/detail`)).statusCode).toBe(200);
    // The delegation preview never reveals agents outside the viewer's departments.
    const preview = (await get("og.marketing", `/v1/tasks/${meta.id}/delegation`)).json<{
      data: DelegationDecisionDTO;
    }>().data;
    const visible = (await get("og.marketing", "/v1/agents"))
      .json<{ data: AgentDTO[] }>()
      .data.map((a) => a.id);
    expect(preview.candidates.every((c) => visible.includes(c.agentId))).toBe(true);
    expect(preview.candidates.map((c) => c.name)).not.toContain(
      "Opportunitygrad Sales / Counselling",
    );
    expect(
      (await send("og.marketing", "POST", `/v1/tasks/${meta.id}/delegate`, {})).statusCode,
    ).toBe(403);
    // Agents outside the department are not even visible to a department manager.
    const sales = await agentByName("Opportunitygrad Sales / Counselling");
    expect(
      (await send("og.marketing", "POST", `/v1/tasks/${meta.id}/assign`, { agentId: sales.id }))
        .statusCode,
    ).toBe(404);
    expect(
      (
        await send("og.marketing", "POST", "/v1/teams", {
          companyId: ids.opportunitygrad,
          name: "Mine",
          memberIds: [],
        })
      ).statusCode,
    ).toBe(403);
    const lead = await taskByTitle("Sync counselling leads to Google Sheet", "opportunitygrad");
    // Another department's work is invisible (404), so it cannot be paused either.
    expect((await send("og.marketing", "POST", `/v1/tasks/${lead.id}/pause`)).statusCode).toBe(404);
  });

  it("warns about duplicates instead of creating another active task", async () => {
    const res = await send("ept.manager", "POST", "/v1/tasks", {
      companyId: ids["euro-pilot-training"],
      title: "Find EASA flight schools in Portugal",
      type: "research",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{
      data: { task: unknown; reused: { id: string } | null; duplicate: { level: string } };
    }>().data;
    expect(body.task).toBeNull();
    expect(body.duplicate.level).toBe("exact_duplicate");
    expect(
      (
        await send("ept.manager", "POST", "/v1/tasks", {
          companyId: ids.pilotsassist,
          title: "Anything",
        })
      ).statusCode,
    ).toBe(403);
  });
});

describe("temporary workers & handoffs", () => {
  it("refuses temporary workers that exceed the parent's authority or cross companies", async () => {
    const task = await taskByTitle(
      "Research 200 flight schools across 10 countries",
      "euro-pilot-training",
    );
    const parent = await agentByName("EPT Flight School Research");
    const base = {
      parentAgentId: parent.id,
      companyId: ids["euro-pilot-training"],
      taskId: task.id,
      name: "Spain Worker",
      purpose: "Spanish schools",
      capabilities: ["research.web"],
      permissions: ["tool.web.search"],
      expiresInHours: 24,
      budgetUsd: 0.5,
    };
    expect(
      (
        await send("pa.manager", "POST", "/v1/agents/temporary", {
          ...base,
          companyId: ids.pilotsassist,
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await send("ept.manager", "POST", "/v1/agents/temporary", {
          ...base,
          permissions: ["tool.email.send"],
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await send("ept.manager", "POST", "/v1/agents/temporary", {
          ...base,
          maySpawnTemporary: true,
        })
      ).statusCode,
    ).toBe(403);
    const ok = await send("ept.manager", "POST", "/v1/agents/temporary", base);
    expect(ok.statusCode).toBe(201);
    const worker = ok.json<{ data: AgentDTO }>().data;
    expect(worker).toMatchObject({ isTemporary: true, boundTaskId: task.id });
    expect(worker.companies.map((c) => c.slug)).toEqual(["euro-pilot-training"]);
    expect((await send("pa.manager", "POST", `/v1/agents/${worker.id}/terminate`)).statusCode).toBe(
      404,
    );
    expect(
      (
        await send("ept.manager", "POST", `/v1/agents/${worker.id}/terminate`, { reason: "Done" })
      ).json<{ data: AgentDTO }>().data.status,
    ).toBe("terminated");
  });

  it("creates handoffs but never with evidence the creator or destination may not read", async () => {
    const task = await taskByTitle("Draft partnership introduction emails", "euro-pilot-training");
    const research = await agentByName("EPT Flight School Research");
    const email = await agentByName("Email & Communications");
    const base = {
      taskId: task.id,
      sourceAgentId: research.id,
      toAgentId: email.id,
      objective: "Contact",
      summary: "Done",
      actionRequired: "Draft",
    };
    const created = await send("ept.manager", "POST", "/v1/handoffs", base);
    expect(created.statusCode).toBe(201);
    const h = created.json<{ data: HandoffDTO }>().data;
    expect(h.status).toBe("pending");
    expect((await send("pa.manager", "POST", `/v1/handoffs/${h.id}/accept`)).statusCode).toBe(404);
    expect(
      (await send("ept.manager", "POST", `/v1/handoffs/${h.id}/accept`)).json<{
        data: HandoffDTO;
      }>().data.status,
    ).toBe("accepted");
    const paTask = await taskByTitle(
      "Map type-rating training partners in the UAE",
      "pilotsassist",
    );
    expect(
      (await send("ept.manager", "POST", "/v1/handoffs", { ...base, taskId: paTask.id }))
        .statusCode,
    ).toBe(404);
  });

  it("stores conversation messages with a placeholder and no AI reply", async () => {
    const agent = await agentByName("EPT Marketing");
    const c = await send("ept.manager", "POST", "/v1/conversations", {
      agentId: agent.id,
      companyId: ids["euro-pilot-training"],
    });
    expect(c.statusCode).toBe(201);
    const id = c.json<{ data: { id: string } }>().data.id;
    const msgs = (
      await send("ept.manager", "POST", `/v1/conversations/${id}/messages`, { content: "Hello" })
    ).json<{ data: { role: string }[] }>().data;
    expect(msgs.map((m) => m.role)).toEqual(["human", "system"]);
    expect((await get("pa.manager", `/v1/conversations/${id}/messages`)).statusCode).toBe(404);
  });
});
