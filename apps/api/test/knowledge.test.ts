import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance, InjectOptions } from "fastify";
import { createTestDb, resetOperationalData } from "@aibos/db/testing";
import { seedDev } from "@aibos/db/dev-seed";
import type {
  AgentContextPack,
  AgentDTO,
  AuditEventDTO,
  CompanyProfileDTO,
  CompanyRulesDTO,
  KnowledgeDetailDTO,
  KnowledgeItemDTO,
  KnowledgeListDTO,
  TaskDTO,
} from "@aibos/shared";
import { buildApp } from "../src/app";
import { healthStub, loginCookie } from "./helpers";

const handle = createTestDb();
let app: FastifyInstance;
const cookies: Record<string, string> = {};
const as = (who: string) => (opts: InjectOptions) =>
  app.inject({ ...opts, headers: { ...opts.headers, cookie: cookies[who] } });
const get = (who: string, url: string) => as(who)({ method: "GET", url });
const post = (who: string, url: string, payload: unknown = {}) =>
  as(who)({ method: "POST", url, payload: payload as never });

let EPT = "";
const knowledge = async (who: string, qs: string) =>
  (await get(who, `/v1/knowledge?${qs}`)).json<KnowledgeListDTO>();
const itemByTitle = async (title: string) =>
  (await knowledge("owner", `q=${encodeURIComponent(title)}`)).data.find((i) => i.title === title)!;

beforeAll(async () => {
  await resetOperationalData(handle);
  await seedDev(handle.db);
  app = await buildApp({ db: handle, health: healthStub });
  for (const who of ["owner", "ept.manager", "pa.manager", "og.marketing", "group.admin"]) {
    cookies[who] = await loginCookie(app, `${who}@aibos.example`);
  }
  EPT = (await get("owner", "/v1/companies/euro-pilot-training")).json<{ data: { id: string } }>()
    .data.id;
});

afterAll(async () => {
  await app.close();
  await handle.close();
});

describe("knowledge API security", () => {
  it("rejects unauthenticated requests", async () => {
    for (const url of [
      "/v1/knowledge",
      "/v1/companies/euro-pilot-training/profile",
      "/v1/companies/euro-pilot-training/rules",
    ]) {
      expect((await app.inject({ method: "GET", url })).statusCode).toBe(401);
    }
  });

  it("rejects other companies, including through query manipulation", async () => {
    for (const url of [
      "/v1/knowledge?company=pilotsassist",
      "/v1/knowledge/conflicts?company=opportunitygrad",
      "/v1/companies/pilotsassist/profile",
      "/v1/companies/pilotsassist/rules",
      "/v1/companies/pilotsassist/history",
      "/v1/companies/does-not-exist/profile",
    ]) {
      expect((await get("ept.manager", url)).statusCode, url).toBe(403);
    }
    const mine = await knowledge("ept.manager", "");
    expect(
      mine.data.every((i) => i.company === null || i.company.slug === "euro-pilot-training"),
    ).toBe(true);
    expect(mine.data.some((i) => i.scope === "global")).toBe(true);
    // A PilotsAssist item by id is invisible (404, not 403: existence is not revealed).
    const pa = await itemByTitle("What PilotsAssist does");
    expect((await get("ept.manager", `/v1/knowledge/${pa.id}`)).statusCode).toBe(404);
  });

  it("protects RESTRICTED knowledge and audits the attempt", async () => {
    const banking = await itemByTitle("Banking and payment details");
    expect(banking.sensitivity).toBe("restricted");
    const list = await knowledge("ept.manager", "company=euro-pilot-training");
    expect(list.data.some((i) => i.id === banking.id)).toBe(false);
    expect(list.facets.hiddenBySensitivity).toBeGreaterThan(0);
    expect((await get("ept.manager", `/v1/knowledge/${banking.id}`)).statusCode).toBe(403);
    expect((await get("owner", `/v1/knowledge/${banking.id}`)).statusCode).toBe(200);
    const audit = (await get("owner", "/v1/audit-events?company=euro-pilot-training")).json<{
      data: AuditEventDTO[];
    }>().data;
    expect(audit.some((e) => e.action === "security.knowledge_access_denied")).toBe(true);
  });

  it("denies knowledge approval without knowledge.approve", async () => {
    const created = await post("og.marketing", "/v1/knowledge", {
      companyId: (await get("owner", "/v1/companies/opportunitygrad")).json<{
        data: { id: string };
      }>().data.id,
      title: "Campaign learning",
      content: "Short-form video performs well for enquiries.",
      type: "marketing",
      sourceType: "management_entry",
      departmentId: (await itemByTitle("Marketing objective: qualified enquiries")).department!.id,
    });
    expect(created.statusCode).toBe(201);
    const item = created.json<{ data: KnowledgeItemDTO }>().data;
    expect(item.status).toBe("draft");
    expect((await post("og.marketing", `/v1/knowledge/${item.id}/submit`)).statusCode).toBe(200);
    expect((await post("og.marketing", `/v1/knowledge/${item.id}/approve`)).statusCode).toBe(403);
    expect((await post("owner", `/v1/knowledge/${item.id}/approve`)).statusCode).toBe(200);
  });

  it("department-scoped users cannot write outside their departments", async () => {
    const res = await post("og.marketing", "/v1/knowledge", {
      companyId: (await get("owner", "/v1/companies/opportunitygrad")).json<{
        data: { id: string };
      }>().data.id,
      title: "Finance note",
      content: "x",
      type: "financial",
      sourceType: "management_entry",
    });
    expect(res.statusCode).toBe(403);
  });

  it("denies GLOBAL knowledge without knowledge.global.manage", async () => {
    const payload = {
      scope: "global",
      title: "Global rule",
      content: "Applies everywhere.",
      type: "policy",
      sourceType: "management_entry",
    };
    expect((await post("ept.manager", "/v1/knowledge", payload)).statusCode).toBe(403);
    // A group admin scoped to some companies does not govern knowledge shared by ALL companies.
    expect((await post("group.admin", "/v1/knowledge", payload)).statusCode).toBe(403);
    const ok = await post("owner", "/v1/knowledge", payload);
    expect(ok.statusCode).toBe(201);
    const id = ok.json<{ data: KnowledgeItemDTO }>().data.id;
    expect((await post("ept.manager", `/v1/knowledge/${id}/approve`)).statusCode).toBe(403);
    expect((await post("group.admin", `/v1/knowledge/${id}/approve`)).statusCode).toBe(403);
    expect((await post("owner", `/v1/knowledge/${id}/approve`)).statusCode).toBe(200);
    // Everyone with knowledge access can read approved global knowledge.
    expect((await get("ept.manager", `/v1/knowledge/${id}`)).statusCode).toBe(200);
  });

  it("rejects tampering: unknown fields, scope changes and classification above clearance", async () => {
    const item = await itemByTitle("Enquiry reply standards");
    const tamper = await as("ept.manager")({
      method: "PATCH",
      url: `/v1/knowledge/${item.id}`,
      payload: { companyId: "x", status: "approved" },
    });
    expect(tamper.statusCode).toBe(400);
    const above = await as("ept.manager")({
      method: "PATCH",
      url: `/v1/knowledge/${item.id}`,
      payload: { sensitivity: "restricted" },
    });
    expect(above.statusCode).toBe(403);
  });

  it("creates a new version for material edits and keeps history", async () => {
    const item = await itemByTitle("Enquiry reply standards");
    const res = await as("ept.manager")({
      method: "PATCH",
      url: `/v1/knowledge/${item.id}`,
      payload: { summary: "Reply within one business day in a premium tone." },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: KnowledgeItemDTO; newVersion: boolean }>();
    expect(body.newVersion).toBe(true);
    expect(body.data.version).toBe(2);
    expect((await post("ept.manager", `/v1/knowledge/${body.data.id}/approve`)).statusCode).toBe(
      200,
    );
    const detail = (await get("ept.manager", `/v1/knowledge/${body.data.id}`)).json<{
      data: KnowledgeDetailDTO;
    }>().data;
    expect(detail.versions.map((v) => v.status)).toEqual(["approved", "superseded"]);
  });
});

describe("profile, rules and history API", () => {
  it("returns the profile with viewer capabilities", async () => {
    const res = await get("ept.manager", "/v1/companies/euro-pilot-training/profile");
    expect(res.statusCode).toBe(200);
    const p = res.json<{ data: CompanyProfileDTO }>().data;
    expect(p.company.industry).toBe("European Pilot Training / Aviation Education");
    expect(p.viewer).toMatchObject({
      canEdit: true,
      canManagePolicy: true,
      canApprovePolicy: false,
    });
    expect(p.stats.rules.critical).toBeGreaterThan(0);
  });

  it("updates profile sections with the right permission only", async () => {
    const brand = {
      brandPositioning: "Premium European-focused pilot training brand.",
      brandPersonality: null,
      brandVoice: "Confident",
      brandTone: null,
      visualGuidance: null,
      approvedPhrases: [],
      prohibitedPhrases: ["cheap"],
      claimsAllowed: [],
      claimsRequiringEvidence: [],
      prohibitedClaims: [],
      competitorNotes: null,
    };
    const url = "/v1/companies/euro-pilot-training/profile/brand";
    expect((await as("ept.manager")({ method: "PUT", url, payload: brand })).statusCode).toBe(200);
    expect((await as("pa.manager")({ method: "PUT", url, payload: brand })).statusCode).toBe(403);
    const escalate = await as("ept.manager")({
      method: "PUT",
      url,
      payload: { ...brand, dailyAiBudget: 9999 },
    });
    expect(escalate.statusCode).toBe(400);
    const policy = await as("ept.manager")({
      method: "PUT",
      url: "/v1/companies/euro-pilot-training/ai-policy",
      payload: {
        defaultProvider: "CLAUDE",
        allowedProviders: ["CLAUDE"],
        defaultResearchLimit: 5,
        deepResearchPolicy: "allowed",
        externalActionPolicy: "allowed",
        browserPolicy: "allowed",
        autoSendPolicy: "allowed",
        staleKnowledgePolicy: "exclude",
        customRules: [],
      },
    });
    expect(policy.statusCode).toBe(403);
    const history = (await get("ept.manager", "/v1/companies/euro-pilot-training/history")).json<{
      data: AuditEventDTO[];
    }>().data;
    expect(history[0]?.action).toBe("company.profile_updated");
  });

  it("lets managers draft rules but only approvers approve them", async () => {
    const created = await post("ept.manager", "/v1/companies/euro-pilot-training/rules/brand", {
      title: "No slang",
      description: "Avoid slang in all channels.",
      category: "tone",
    });
    expect(created.statusCode).toBe(201);
    const rule = created.json<{ data: { id: string; status: string } }>().data;
    expect(rule.status).toBe("draft");
    expect((await post("ept.manager", `/v1/rules/brand/${rule.id}/approve`)).statusCode).toBe(403);
    expect(
      (
        await post("ept.manager", "/v1/companies/euro-pilot-training/rules/brand", {
          title: "x",
          description: "y",
          category: "tone",
          approve: true,
        })
      ).statusCode,
    ).toBe(403);
    expect((await post("owner", `/v1/rules/brand/${rule.id}/approve`)).statusCode).toBe(200);
    expect((await post("pa.manager", `/v1/rules/brand/${rule.id}/archive`)).statusCode).toBe(404);
    const rules = (await get("og.marketing", "/v1/companies/opportunitygrad/rules")).json<{
      data: CompanyRulesDTO;
    }>().data;
    expect(rules.commercial.find((r) => r.appliesTo === "meta.budget_increase")?.limitAmount).toBe(
      100,
    );
    expect(
      rules.brand.some((r) => r.companyId === null) ||
        rules.compliance.some((r) => r.companyId === null),
    ).toBe(true);
  });
});

describe("context preview API", () => {
  const agents = async (who: string, company: string) =>
    (await get(who, `/v1/agents?company=${company}`)).json<{ data: AgentDTO[] }>().data;

  it("builds an EPT-only pack with reasons and audits the preview", async () => {
    const marketing = (await agents("ept.manager", "euro-pilot-training")).find(
      (a) => a.name === "EPT Marketing",
    )!;
    const res = await get(
      "ept.manager",
      `/v1/agents/${marketing.id}/context?company=euro-pilot-training`,
    );
    expect(res.statusCode).toBe(200);
    const pack = res.json<{ data: AgentContextPack }>().data;
    expect(pack.request.companyId).toBe(EPT);
    expect(
      pack.rules.brand.some((r) => r.title === "Premium aviation presentation" && r.mandatory),
    ).toBe(true);
    expect(pack.knowledge.every((k) => k.reasons.length > 0)).toBe(true);
    const text = JSON.stringify(pack);
    expect(text).not.toContain("PilotsAssist");
    expect(text).not.toContain("Opportunitygrad");
    const audit = (await get("owner", "/v1/audit-events?company=euro-pilot-training")).json<{
      data: AuditEventDTO[];
    }>().data;
    expect(audit.some((e) => e.action === "context.preview_generated")).toBe(true);
  });

  it("builds a task pack with explicit links first", async () => {
    const tasks = (await get("ept.manager", "/v1/tasks?company=euro-pilot-training")).json<{
      data: TaskDTO[];
    }>().data;
    const task = tasks.find((t) => t.title === "Draft partnership introduction emails")!;
    const res = await get("ept.manager", `/v1/tasks/${task.id}/context`);
    expect(res.statusCode).toBe(200);
    const pack = res.json<{ data: AgentContextPack }>().data;
    expect(pack.task?.id).toBe(task.id);
    expect(pack.knowledge[0]?.reasons).toContain("task_link");
  });

  it("denies previews without company or agent access", async () => {
    const paAgent = (await agents("owner", "pilotsassist")).find(
      (a) => a.name === "PilotsAssist Marketing",
    )!;
    expect((await get("ept.manager", `/v1/agents/${paAgent.id}/context`)).statusCode).toBe(404);
    const eptAgent = (await agents("owner", "euro-pilot-training")).find(
      (a) => a.name === "EPT Marketing",
    )!;
    expect(
      (await get("ept.manager", `/v1/agents/${eptAgent.id}/context?company=pilotsassist`))
        .statusCode,
    ).toBe(403);
    const paTask = (await get("owner", "/v1/tasks?company=pilotsassist")).json<{
      data: TaskDTO[];
    }>().data[0]!;
    expect((await get("ept.manager", `/v1/tasks/${paTask.id}/context`)).statusCode).toBe(404);
    expect((await get("ept.manager", `/v1/tasks/${paTask.id}`)).statusCode).toBe(404);
    expect(
      (await get("ept.manager", `/v1/agents/${eptAgent.id}/context?task=${paTask.id}`)).statusCode,
    ).toBe(404);
    // Department-scoped marketing manager cannot preview a non-marketing agent.
    const ogResearch = (await agents("owner", "opportunitygrad")).find(
      (a) => a.name === "Opportunitygrad University Research",
    )!;
    expect((await get("og.marketing", `/v1/agents/${ogResearch.id}/context`)).statusCode).toBe(404);
  });

  it("redacts knowledge the viewer is not cleared for, even if the agent is", async () => {
    const eptAgent = (await agents("owner", "euro-pilot-training")).find(
      (a) => a.name === "EPT Marketing",
    )!;
    const banking = await itemByTitle("Banking and payment details");
    expect(
      (
        await post("owner", "/v1/companies/euro-pilot-training/knowledge-access", {
          agentId: eptAgent.id,
          maxSensitivity: "restricted",
        })
      ).statusCode,
    ).toBe(201);
    // A manager cannot grant above their own clearance.
    expect(
      (
        await post("ept.manager", "/v1/companies/euro-pilot-training/knowledge-access", {
          agentId: eptAgent.id,
          maxSensitivity: "restricted",
        })
      ).statusCode,
    ).toBe(403);
    await as("owner")({
      method: "PUT",
      url: `/v1/agents/${eptAgent.id}/knowledge-profile`,
      payload: {
        profile: {
          requiredTypes: ["financial"],
          preferredTags: [],
          brandCategories: [],
          commercialCategories: [],
        },
      },
    });
    const owner = (
      await get("owner", `/v1/agents/${eptAgent.id}/context?company=euro-pilot-training`)
    ).json<{ data: AgentContextPack }>().data;
    expect(owner.knowledge.find((k) => k.id === banking.id)?.title).toBe(
      "Banking and payment details",
    );
    const manager = (
      await get("ept.manager", `/v1/agents/${eptAgent.id}/context?company=euro-pilot-training`)
    ).json<{ data: AgentContextPack; redactedForViewer: number }>();
    const entry = manager.data.knowledge.find((k) => k.id === banking.id)!;
    expect(entry.redacted).toBe(true);
    expect(JSON.stringify(manager.data)).not.toContain("Banking and payment details");
    expect(manager.redactedForViewer).toBeGreaterThan(0);
  });
});
