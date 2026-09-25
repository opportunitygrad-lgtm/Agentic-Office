import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  ConflictError,
  createAgent,
  createApproval,
  createCompany,
  createTask,
  dashboardSummary,
  getTaskTree,
  listAgents,
  listApprovals,
  listAuditEvents,
  recordAuditEvent,
  schema,
  setAgentCompanies,
  type Actor,
} from "../src";
import { seedDev } from "../src/seed/dev/seed-dev";
import { VALID_COMPANY, createTestDb, resetOperationalData } from "./helpers";

const handle = createTestDb();
const db = handle.db;
const actor: Actor = { kind: "human", ref: "test-user" };

beforeEach(async () => {
  await resetOperationalData(handle);
});

afterAll(async () => {
  await handle.close();
});

describe("companies", () => {
  it("creates a company with budget policies, initial agents and an audit event", async () => {
    const { company, agents } = await createCompany(
      db,
      { ...VALID_COMPANY, initialAgents: ["company_manager", "research", "email_communications"] },
      actor,
    );
    expect(company.slug).toBe("test-aviation-ltd");
    expect(company.settings).toMatchObject({
      approvals: { highCostTasks: true, deepResearch: true },
    });
    expect(agents).toHaveLength(3);

    const manager = agents.find((a) => a.templateKey === "company_manager")!;
    const research = agents.find((a) => a.templateKey === "research")!;
    expect(research.reportsToAgentId).toBe(manager.id);

    const policies = await db
      .select()
      .from(schema.budgetPolicies)
      .where(eq(schema.budgetPolicies.companyId, company.id));
    expect(policies.map((p) => p.scope).sort()).toEqual(["company_day", "company_month"]);

    const events = await listAuditEvents(db, { companyId: company.id });
    expect(events[0]?.action).toBe("company.created");
  });

  it("rejects duplicate slugs and invalid input", async () => {
    await createCompany(db, VALID_COMPANY, actor);
    await expect(createCompany(db, VALID_COMPANY, actor)).rejects.toBeInstanceOf(ConflictError);
    await expect(
      createCompany(db, { ...VALID_COMPANY, name: "Other", concurrencyLimit: 0 }, actor),
    ).rejects.toThrow();
    await expect(
      createCompany(db, { ...VALID_COMPANY, name: "Other", dailyAiBudget: -5 }, actor),
    ).rejects.toThrow();
  });
});

describe("agents", () => {
  it("creates an agent with template defaults", async () => {
    const { company } = await createCompany(db, VALID_COMPANY, actor);
    const agent = await createAgent(
      db,
      { name: "Meta Watcher", templateKey: "meta_ads", companyIds: [company.id] },
      actor,
    );
    expect(agent.allowedTools).toContain("meta");
    expect(agent.approvalRequirements).toContain("ad_launch");
    const [dto] = await listAgents(db, { ids: [agent.id] });
    expect(dto?.department?.slug).toBe("marketing");
    expect(dto?.companies.map((c) => c.id)).toEqual([company.id]);
  });

  it("assigns one agent to several companies and filters by company", async () => {
    const a = await createCompany(db, { ...VALID_COMPANY, name: "Alpha Co" }, actor);
    const b = await createCompany(db, { ...VALID_COMPANY, name: "Beta Co" }, actor);
    const c = await createCompany(db, { ...VALID_COMPANY, name: "Gamma Co" }, actor);
    const agent = await createAgent(
      db,
      { name: "Shared Comms", templateKey: "email_communications", companyIds: [a.company.id] },
      actor,
    );

    const updated = await setAgentCompanies(
      db,
      agent.id,
      { companyIds: [a.company.id, b.company.id], primaryCompanyId: b.company.id },
      actor,
    );
    expect(updated.companies.map((x) => x.slug).sort()).toEqual(["alpha-co", "beta-co"]);
    expect(updated.companies.find((x) => x.isPrimary)?.slug).toBe("beta-co");

    expect((await listAgents(db, { companyId: b.company.id })).map((x) => x.id)).toContain(
      agent.id,
    );
    expect((await listAgents(db, { companyId: c.company.id })).map((x) => x.id)).not.toContain(
      agent.id,
    );

    const events = await listAuditEvents(db);
    expect(events.some((e) => e.action === "agent.assignments_changed")).toBe(true);
  });
});

describe("tasks", () => {
  it("keeps manager → research → verification → email traceable", async () => {
    const { company } = await createCompany(db, VALID_COMPANY, actor);
    const manager = await createTask(
      db,
      { companyId: company.id, title: "Partner shortlist", type: "management" },
      actor,
    );
    const research = await createTask(
      db,
      { parentTaskId: manager.id, title: "Research schools", type: "research" },
      actor,
    );
    const verify = await createTask(
      db,
      { parentTaskId: research.id, title: "Verify approvals", type: "verification" },
      actor,
    );
    const email = await createTask(
      db,
      { parentTaskId: verify.id, title: "Draft emails", type: "email" },
      actor,
    );

    expect(manager.rootTaskId).toBe(manager.id);
    expect(email.rootTaskId).toBe(manager.id);
    expect(email.depth).toBe(3);
    expect(email.companyId).toBe(company.id);

    const tree = await getTaskTree(db, manager.id);
    expect(tree).toHaveLength(4);
    expect(tree.find((t) => t.id === manager.id)?.childCount).toBe(1);
  });

  it("rejects invalid progress", async () => {
    await expect(createTask(db, { title: "Bad", progress: 140 }, actor)).rejects.toThrow();
  });
});

describe("approvals and audit", () => {
  it("creates an approval and logs the request", async () => {
    const { company } = await createCompany(db, VALID_COMPANY, actor);
    await createApproval(
      db,
      {
        companyId: company.id,
        type: "ad_budget_increase",
        requestedAction: "Raise budget",
        riskLevel: "high",
        beforeState: { daily: 40 },
        afterState: { daily: 65 },
      },
      actor,
    );
    const pending = await listApprovals(db, { companyId: company.id, status: "pending" });
    expect(pending).toHaveLength(1);
    expect(pending[0]?.afterState).toEqual({ daily: 65 });
    const events = await listAuditEvents(db, { companyId: company.id });
    expect(events.some((e) => e.action === "approval.requested")).toBe(true);
  });

  it("records structured audit events and rejects un-namespaced actions", async () => {
    const event = await recordAuditEvent(db, {
      action: "provider.called",
      provider: "CLAUDE",
      description: "Mock call",
      metadata: { tokens: 120 },
      outcome: "success",
      ipAddress: "127.0.0.1",
    });
    expect(event.metadata).toEqual({ tokens: 120 });
    await expect(recordAuditEvent(db, { action: "bad", description: "x" })).rejects.toThrow();
  });
});

describe("development seed + dashboard", () => {
  it("seeds idempotently and produces a dashboard summary", async () => {
    await seedDev(db);
    const second = await seedDev(db);
    expect(second.companies).toBe(3);
    // 18 Stage 01 agents + 3 company managers + 1 temporary worker (Stage 04).
    expect(second.agents).toBe(22);

    const summary = await dashboardSummary(db);
    expect(summary.companies.map((c) => c.slug)).toEqual([
      "euro-pilot-training",
      "pilotsassist",
      "opportunitygrad",
    ]);
    expect(summary.workforce.total).toBe(22);
    // States are derived from assigned work (Stage 04): an agent with a task awaiting approval is needs_approval.
    expect(summary.workforce.working).toBe(3);
    expect(summary.workforce.needs_approval).toBe(1);
    expect(summary.approvals.length).toBe(4);
    expect(summary.usage.isMock).toBe(true);
    expect(summary.containsDevSeedData).toBe(true);

    const og = await dashboardSummary(db, "opportunitygrad");
    expect(og.scope?.slug).toBe("opportunitygrad");
    expect(og.tasks.every((t) => t.company?.slug === "opportunitygrad")).toBe(true);
  });
});
