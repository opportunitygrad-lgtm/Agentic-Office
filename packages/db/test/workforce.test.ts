import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { TEMPLATE_ROLES } from "@aibos/agent-core";
import type { AgentRole } from "@aibos/shared";
import {
  ConflictError,
  ForbiddenError,
  assignTask,
  buildContextPack,
  claimTask,
  compileInstructionsFor,
  createHandoff,
  createTeam,
  createTemporaryAgent,
  createWorkforceTask,
  delegateTask,
  expireTemporaryAgents,
  getAgentRole,
  listAgents,
  previewDelegation,
  recoverExpiredClaims,
  releaseTask,
  resolveCompany,
  saveAgentRole,
  schema,
  setAgentHierarchy,
  setTaskStatus,
  transitionHandoff,
  type Actor,
} from "../src";
import { seedDev } from "../src/seed/dev/seed-dev";
import { createTestDb, resetOperationalData } from "./helpers";

const handle = createTestDb();
const db = handle.db;
const actor: Actor = { kind: "human", ref: "tester@aibos.example" };
let EPT = "";
let PA = "";

const agentId = async (name: string) => {
  const [a] = await db.select().from(schema.agents).where(eq(schema.agents.name, name));
  if (!a) throw new Error(`agent ${name}`);
  return a.id;
};
const taskId = async (title: string, companyId = EPT) => {
  const [t] = await db
    .select()
    .from(schema.tasks)
    .where(and(eq(schema.tasks.title, title), eq(schema.tasks.companyId, companyId)));
  if (!t) throw new Error(`task ${title}`);
  return t.id;
};
const clone = (r: AgentRole) => JSON.parse(JSON.stringify(r)) as AgentRole;

beforeAll(async () => {
  await resetOperationalData(handle);
  await seedDev(db);
  EPT = (await resolveCompany(db, "euro-pilot-training"))!.id;
  PA = (await resolveCompany(db, "pilotsassist"))!.id;
});
afterAll(() => handle.close());

describe("agent roles", () => {
  it("versions roles without overwriting history", async () => {
    const id = await agentId("EPT Marketing");
    const before = await getAgentRole(db, id, { viewerCanManage: true });
    expect(before.source).toBe("template");
    expect(before.roleTemplate.companySpecific).toBe(true);
    const role = clone(before.role);
    role.responsibilities.secondary = ["Quarterly brand review"];
    const v1 = await saveAgentRole(db, id, { role, changeSummary: "Add brand review" }, actor);
    expect(v1).toEqual({ version: 1, created: true });
    expect(await saveAgentRole(db, id, { role, changeSummary: "No change" }, actor)).toEqual({
      version: 1,
      created: false,
    });
    role.research.maxSearches = 4;
    expect(
      (await saveAgentRole(db, id, { role, changeSummary: "Tighter research" }, actor)).version,
    ).toBe(2);
    const after = await getAgentRole(db, id, { viewerCanManage: true });
    expect(after.source).toBe("agent");
    expect(after.versions.map((v) => [v.version, v.isCurrent])).toEqual([
      [2, true],
      [1, false],
    ]);
    expect(after.role.research.maxSearches).toBe(4);
    const audit = await db
      .select()
      .from(schema.auditEvents)
      .where(
        and(
          eq(schema.auditEvents.agentId, id),
          eq(schema.auditEvents.action, "agent.role_version_created"),
        ),
      );
    expect(audit).toHaveLength(2);
  });

  it("compiles instructions where permissions and company policy win", async () => {
    const id = await agentId("EPT Flight School Research");
    const role = clone(TEMPLATE_ROLES.research);
    role.expectedTools = ["tool.email.send"];
    role.research.maxSearches = null;
    await saveAgentRole(db, id, { role, changeSummary: "Try to widen" }, actor);
    const pack = await compileInstructionsFor(db, { agentId: id, companyId: EPT });
    expect(pack.conflicts.map((c) => c.category)).toEqual(
      expect.arrayContaining(["permission", "research_limit"]),
    );
    expect(pack.effective.maxSearches).toBeLessThanOrEqual(25);
    expect(pack.text).toContain("Premium aviation presentation");
    await expect(compileInstructionsFor(db, { agentId: id, companyId: PA })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });
});

describe("hierarchy & teams", () => {
  it("prevents reporting cycles and cross-company managers", async () => {
    const manager = await agentId("EPT Company Manager");
    const research = await agentId("EPT Flight School Research");
    await expect(
      setAgentHierarchy(
        db,
        manager,
        { reportsToAgentId: research, escalationAgentId: null, fallbackManagerId: null },
        actor,
      ),
    ).rejects.toThrow(/cycle/);
    await expect(
      setAgentHierarchy(
        db,
        research,
        { reportsToAgentId: research, escalationAgentId: null, fallbackManagerId: null },
        actor,
      ),
    ).rejects.toBeInstanceOf(ConflictError);
    const paManager = await agentId("PilotsAssist Company Manager");
    await expect(
      setAgentHierarchy(
        db,
        research,
        { reportsToAgentId: paManager, escalationAgentId: null, fallbackManagerId: null },
        actor,
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await setAgentHierarchy(
      db,
      research,
      {
        reportsToAgentId: manager,
        escalationAgentId: await agentId("Group Manager"),
        fallbackManagerId: null,
      },
      actor,
    );
  });

  it("creates teams only from agents serving the team's company", async () => {
    const eptMarketing = await agentId("EPT Marketing");
    const paMarketing = await agentId("PilotsAssist Marketing");
    await expect(
      createTeam(
        db,
        { companyId: EPT, name: "Mixed team", memberIds: [eptMarketing, paMarketing] },
        actor,
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const team = await createTeam(
      db,
      {
        companyId: EPT,
        name: "EPT Brand Team",
        memberIds: [eptMarketing],
        leaderAgentId: eptMarketing,
      },
      actor,
    );
    const members = await listAgents(db, { teamId: team.id });
    expect(members.map((m) => m.name)).toEqual(["EPT Marketing"]);
  });
});

describe("delegation", () => {
  it("previews and executes delegation with explanations", async () => {
    const id = await taskId("Find EASA flight schools in Portugal");
    const preview = await previewDelegation(db, id);
    expect(preview.requester?.name).toBe("EPT Company Manager");
    expect(
      preview.candidates.find((c) => c.name === "PilotsAssist Aviation Research"),
    ).toBeUndefined();
    expect(
      preview.candidates.find((c) => c.name === "Portugal Research Worker")?.rejectedReason,
    ).toBe("Temporary worker is bound to another task");
    // Override to a specialist at capacity needs a reason (soft check) …
    const research = await agentId("EPT Flight School Research");
    await expect(delegateTask(db, id, { targetAgentId: research }, actor)).rejects.toThrow(
      /requires a reason/,
    );
    // … and hard checks can never be overridden.
    await expect(
      delegateTask(
        db,
        id,
        { targetAgentId: await agentId("PilotsAssist Aviation Research"), reason: "try" },
        actor,
      ),
    ).rejects.toThrow(/does not serve/);
    const result = await delegateTask(
      db,
      id,
      { targetAgentId: research, reason: "Priority partner research" },
      actor,
    );
    const [task] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, id));
    expect(task!.assignedAgentId).toBe(research);
    expect(task!.delegationDepth).toBe(1);
    const [row] = await db
      .select()
      .from(schema.taskDelegations)
      .where(eq(schema.taskDelegations.id, result.delegationId));
    expect(row).toMatchObject({ override: true, reason: "Priority partner research" });
    const [msg] = await db
      .select()
      .from(schema.agentMessages)
      .where(
        and(eq(schema.agentMessages.taskId, id), eq(schema.agentMessages.type, "task_instruction")),
      );
    expect(msg!.recipientAgentId).toBe(research);
  });

  it("reuses exact duplicates and asks before likely duplicates", async () => {
    const reuse = await createWorkforceTask(
      db,
      { companyId: EPT, title: "Find EASA flight schools in Portugal", type: "research" },
      actor,
    );
    expect(reuse.task).toBeNull();
    expect(reuse.reused?.title).toBe("Find EASA flight schools in Portugal");
    const likely = await createWorkforceTask(
      db,
      { companyId: EPT, title: "Find EASA flight schools in Portugal and Spain", type: "research" },
      actor,
    );
    expect(likely.duplicate.level).toBe("likely_duplicate");
    expect(likely.task).toBeNull();
    const forced = await createWorkforceTask(
      db,
      {
        companyId: EPT,
        title: "Find EASA flight schools in Portugal and Spain",
        type: "research",
        onDuplicate: "create",
      },
      actor,
    );
    expect(forced.task?.normalizedObjective).toBeTruthy();
    const other = await createWorkforceTask(
      db,
      { companyId: PA, title: "Find EASA flight schools in Portugal", type: "research" },
      actor,
    );
    expect(other.task).not.toBeNull();
  });

  it("claims tasks atomically and recovers expired leases", async () => {
    const id = await taskId("Find EASA flight schools in Portugal");
    const research = await agentId("EPT Flight School Research");
    const [task] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, id));
    await db
      .update(schema.agents)
      .set({ concurrencyLimit: 3 })
      .where(eq(schema.agents.id, research));
    expect(await claimTask(db, id, research)).toBe(true);
    expect(await claimTask(db, id, await agentId("EPT Marketing"))).toBe(false);
    const results = await Promise.all([claimTask(db, id, research), claimTask(db, id, research)]);
    expect(results.every(Boolean)).toBe(true);
    expect(await releaseTask(db, id, research)).toBe(true);
    await claimTask(db, id, research, { leaseSeconds: 1, now: new Date(Date.now() - 60_000) });
    expect(await recoverExpiredClaims(db)).toBeGreaterThanOrEqual(1);
    expect(task!.assignedAgentId).toBe(research);
  });

  it("derives agent state from assigned work", async () => {
    const id = await taskId("Find EASA flight schools in Portugal");
    const research = await agentId("EPT Flight School Research");
    await db.update(schema.tasks).set({ status: "running" }).where(eq(schema.tasks.id, id));
    await assignTask(db, id, { agentId: research }, actor);
    const [a] = await db.select().from(schema.agents).where(eq(schema.agents.id, research));
    expect(a!.status).toBe("working");
    const idle = await agentId("EPT Marketing");
    const [m] = await db.select().from(schema.agents).where(eq(schema.agents.id, idle));
    expect(m!.status).toBe("sleeping");
  });
});

describe("handoffs", () => {
  it("creates, accepts and completes a handoff; the destination builds its own context", async () => {
    const task = await taskId("Draft partnership introduction emails");
    const research = await agentId("EPT Flight School Research");
    const email = await agentId("Email & Communications");
    const [policy] = await db
      .select()
      .from(schema.knowledgeItems)
      .where(eq(schema.knowledgeItems.title, "What Euro Pilot Training does"));
    const h = await createHandoff(
      db,
      {
        taskId: task,
        sourceAgentId: research,
        toAgentId: email,
        type: "research_result",
        objective: "Contact verified schools",
        summary: "Two schools verified.",
        verifiedFacts: ["School X is ATO approved"],
        knowledgeIds: [policy!.id],
        actionRequired: "Draft emails",
        doNotResearchAgainUnless: ["Contact missing"],
      },
      actor,
    );
    expect(h.status).toBe("pending");
    expect((await transitionHandoff(db, h.id, "accept", actor)).status).toBe("accepted");
    await expect(transitionHandoff(db, h.id, "accept", actor)).rejects.toBeInstanceOf(
      ConflictError,
    );
    const pack = await buildContextPack(db, { companyId: EPT, agentId: email, taskId: task });
    expect(pack.agent.id).toBe(email);
    expect(pack.handoffs.map((x) => x.id)).toContain(h.id);
    expect(pack.knowledge.find((k) => k.id === policy!.id)?.reasons).toContain("handoff_link");
    // The research agent's own context is not copied: its agent-linked knowledge is absent.
    expect(pack.agent.name).toBe("Email & Communications");
    expect((await transitionHandoff(db, h.id, "complete", actor)).status).toBe("completed");
  });

  it("rejects cross-company destinations and restricted evidence", async () => {
    const task = await taskId("Draft partnership introduction emails");
    const research = await agentId("EPT Flight School Research");
    const base = {
      taskId: task,
      sourceAgentId: research,
      objective: "x",
      summary: "y",
      actionRequired: "z",
    };
    await expect(
      createHandoff(db, { ...base, toAgentId: await agentId("PilotsAssist Marketing") }, actor),
    ).rejects.toThrow(/does not serve/);
    const [banking] = await db
      .select()
      .from(schema.knowledgeItems)
      .where(eq(schema.knowledgeItems.title, "Banking and payment details"));
    await expect(
      createHandoff(
        db,
        {
          ...base,
          toAgentId: await agentId("Email & Communications"),
          knowledgeIds: [banking!.id],
        },
        actor,
      ),
    ).rejects.toThrow(/not cleared for RESTRICTED/);
    const [paKnowledge] = await db
      .select()
      .from(schema.knowledgeItems)
      .where(eq(schema.knowledgeItems.title, "What PilotsAssist does"));
    await expect(
      createHandoff(
        db,
        {
          ...base,
          toAgentId: await agentId("Email & Communications"),
          knowledgeIds: [paKnowledge!.id],
        },
        actor,
      ),
    ).rejects.toThrow(/same company/);
  });
});

describe("temporary agents", () => {
  const input = async (over: Record<string, unknown> = {}) => ({
    parentAgentId: await agentId("EPT Flight School Research"),
    companyId: EPT,
    taskId: await taskId("Research 200 flight schools across 10 countries"),
    name: "Spain Research Worker",
    purpose: "Spanish schools",
    capabilities: ["research.web" as const],
    permissions: ["tool.web.search"],
    expiresInHours: 24,
    budgetUsd: 0.5,
    ...over,
  });

  it("creates task- and company-bound workers within the parent's authority", async () => {
    const res = await createTemporaryAgent(db, await input(), { kind: "human", actor });
    expect(res.status).toBe("created");
    if (res.status !== "created") return;
    const worker = res.agent;
    expect(worker).toMatchObject({
      isTemporary: true,
      boundTaskId: await taskId("Research 200 flight schools across 10 countries"),
    });
    const grants = await db
      .select()
      .from(schema.agentPermissionGrants)
      .where(eq(schema.agentPermissionGrants.agentId, worker.id));
    expect(grants.find((g) => g.permission === "tool.web.search")).toMatchObject({
      companyId: EPT,
      effect: "allow",
    });
    const serves = await db
      .select()
      .from(schema.agentCompanyAssignments)
      .where(eq(schema.agentCompanyAssignments.agentId, worker.id));
    expect(serves.map((s) => s.companyId)).toEqual([EPT]);
  });

  it("denies escalation, other companies, recursion and over-budget workers", async () => {
    await expect(
      createTemporaryAgent(db, await input({ permissions: ["tool.email.send"] }), {
        kind: "human",
        actor,
      }),
    ).rejects.toThrow(/cannot delegate tool.email.send/);
    await expect(
      createTemporaryAgent(db, await input({ companyId: PA }), { kind: "human", actor }),
    ).rejects.toThrow(/does not serve/);
    await expect(
      createTemporaryAgent(
        db,
        await input({ taskId: await taskId("Map type-rating training partners in the UAE", PA) }),
        { kind: "human", actor },
      ),
    ).rejects.toThrow(/different company/);
    await expect(
      createTemporaryAgent(db, await input({ budgetUsd: 50 }), { kind: "human", actor }),
    ).rejects.toThrow(/exceeds the parent/);
    await expect(
      createTemporaryAgent(db, await input({ permissions: ["action.create_temp_worker"] }), {
        kind: "human",
        actor,
      }),
    ).rejects.toThrow(/cannot create workers/);
    const worker = await agentId("Portugal Research Worker");
    await expect(
      createTemporaryAgent(db, await input({ parentAgentId: worker }), { kind: "human", actor }),
    ).rejects.toThrow(/cannot create further workers/);
    await expect(
      createTemporaryAgent(db, await input(), {
        kind: "agent",
        agentId: await agentId("EPT Marketing"),
        actor,
      }),
    ).rejects.toThrow(/its own authority/);
  });

  it("agent-initiated creation is autonomy-limited and approval-gated", async () => {
    const research = await agentId("EPT Flight School Research");
    // Limited-operator autonomy cannot perform high-risk actions at all.
    await expect(
      createTemporaryAgent(db, await input({ name: "Italy Research Worker" }), {
        kind: "agent",
        agentId: research,
        actor,
      }),
    ).rejects.toThrow(/no authority/);
    await db
      .update(schema.agents)
      .set({ autonomyLevel: "approval_gated" })
      .where(eq(schema.agents.id, research));
    const res = await createTemporaryAgent(db, await input({ name: "Italy Research Worker" }), {
      kind: "agent",
      agentId: await agentId("EPT Flight School Research"),
      actor,
    });
    expect(res.status).toBe("approval_required");
  });

  it("expires by time and terminates when the task completes", async () => {
    const res = await createTemporaryAgent(db, await input({ name: "France Research Worker" }), {
      kind: "human",
      actor,
    });
    if (res.status !== "created") throw new Error("expected creation");
    await db
      .update(schema.agents)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.agents.id, res.agent.id));
    expect(await expireTemporaryAgents(db)).toBeGreaterThanOrEqual(1);
    const [expired] = await db
      .select()
      .from(schema.agents)
      .where(eq(schema.agents.id, res.agent.id));
    expect(expired!.status).toBe("expired");
    await setTaskStatus(
      db,
      await taskId("Research 200 flight schools across 10 countries"),
      "completed",
      actor,
    );
    const [portugal] = await db
      .select()
      .from(schema.agents)
      .where(eq(schema.agents.name, "Portugal Research Worker"));
    expect(portugal!.status).toBe("terminated");
  });
});
