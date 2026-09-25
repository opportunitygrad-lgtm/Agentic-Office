/**
 * DEVELOPMENT SEED — Stage 04 workforce. All rows use origin = 'dev_seed'.
 */
import { eq, inArray, isNull, sql } from "drizzle-orm";
import { normalizeObjective } from "@aibos/delegation-core";
import type { Database } from "../../client";
import {
  auditEvents,
  agents,
  departments,
  handoffs,
  knowledgeItems,
  roleTemplates,
  taskDelegations,
  tasks,
  teamMembers,
  teams,
} from "../../schema";
import { saveAgentRole } from "../../repositories/agent-roles";
import { createHandoff } from "../../repositories/handoffs";
import { createTemporaryAgent } from "../../repositories/temporary-agents";
import { refreshAgentStates } from "../../repositories/workforce";
import { serviceActor } from "../../repositories/util";
import {
  SEED_DELEGATION_TASKS,
  SEED_ROLE_TEMPLATES,
  SEED_TASK_REQUIREMENTS,
  SEED_TEAMS,
  capabilitiesFor,
} from "./workforce-data";

const ORIGIN = "dev_seed" as const;
const SEED_ACTOR = serviceActor("dev-seed");

export async function clearWorkforceSeed(db: Database): Promise<void> {
  await db.delete(teams).where(eq(teams.origin, ORIGIN));
  await db.delete(roleTemplates).where(eq(roleTemplates.origin, ORIGIN));
}

export async function seedWorkforce(
  db: Database,
  ctx: {
    now: Date;
    companyIds: Map<string, string>;
    agentIds: Map<string, string>;
    taskIds: Map<string, string>;
    ownerId: string;
  },
): Promise<Record<string, number>> {
  const { now } = ctx;
  const cid = (slug: string) => ctx.companyIds.get(slug)!;
  const aid = (key: string) => ctx.agentIds.get(key)!;
  const ownerActor = { kind: "human" as const, ref: "owner@aibos.example", userId: ctx.ownerId };
  const deptRows = await db.select().from(departments).where(isNull(departments.companyId));
  const dept = (slug: string) => deptRows.find((d) => d.slug === slug)?.id ?? null;

  /* company specialist role templates → linked agents */
  for (const t of SEED_ROLE_TEMPLATES) {
    const [row] = await db
      .insert(roleTemplates)
      .values({
        key: t.key,
        companyId: cid(t.company),
        baseTemplateKey: t.base,
        name: t.name,
        departmentSlug: t.department,
        capabilities: capabilitiesFor(t),
        role: t.role,
        origin: ORIGIN,
      })
      .returning({ id: roleTemplates.id });
    for (const key of t.agents)
      await db
        .update(agents)
        .set({ roleTemplateId: row!.id, capabilities: capabilitiesFor(t) })
        .where(eq(agents.id, aid(key)));
  }

  /* department managers */
  await db
    .update(departments)
    .set({ managerAgentId: aid("group-manager") })
    .where(eq(departments.slug, "management"));

  /* teams */
  for (const t of SEED_TEAMS) {
    const [team] = await db
      .insert(teams)
      .values({
        companyId: cid(t.company),
        departmentId: dept(t.department),
        name: t.name,
        slug: t.key,
        purpose: t.purpose,
        description: t.purpose,
        leaderAgentId: aid(t.leader),
        concurrencyLimit: 3,
        defaultTaskTypes: [...t.taskTypes],
        origin: ORIGIN,
      })
      .returning({ id: teams.id });
    await db
      .insert(teamMembers)
      .values(t.members.map((m) => ({ teamId: team!.id, agentId: aid(m) })));
  }

  /* role versions: history for EPT Partnerships and the Group Manager */
  const partnerships = SEED_ROLE_TEMPLATES.find((t) => t.key === "ept-partnerships")!.role;
  await saveAgentRole(
    db,
    aid("ept-partnerships"),
    {
      role: { ...partnerships, research: { ...partnerships.research, maxSearches: 10 } },
      changeSummary: "Initial EPT partnerships role (wider research allowance)",
    },
    ownerActor,
    {
      origin: ORIGIN,
      effectiveFrom: new Date(now.getTime() - 14 * 86_400_000),
    },
  );
  await saveAgentRole(
    db,
    aid("ept-partnerships"),
    {
      role: {
        ...partnerships,
        research: { ...partnerships.research, maxSearches: 6 },
        freeText: "Prefer schools with integrated ATPL programmes when shortlisting.",
      },
      changeSummary: "Tighter search limit; integrated-ATPL preference",
    },
    ownerActor,
    { origin: ORIGIN },
  );

  /* seeded work belongs to the assigned agent's department */
  await db.execute(
    sql`update tasks t set department_id = a.department_id from agents a where a.id = t.assigned_agent_id and t.department_id is null and t.origin = 'dev_seed'`,
  );

  /* task requirements */
  for (const [key, r] of Object.entries(SEED_TASK_REQUIREMENTS)) {
    const id = ctx.taskIds.get(key);
    if (!id) continue;
    const [t] = await db.select({ title: tasks.title }).from(tasks).where(eq(tasks.id, id));
    await db
      .update(tasks)
      .set({
        requiredCapabilities: r.capabilities,
        maxBudget: r.maxBudget ?? null,
        targetEntity: r.targetEntity ?? null,
        stoppingCondition: r.stop ?? null,
        expectedOutcome: r.outcome ?? null,
        normalizedObjective: normalizeObjective(t!.title),
      })
      .where(eq(tasks.id, id));
  }
  const newTaskIds: string[] = [];
  for (const t of SEED_DELEGATION_TASKS) {
    const [row] = await db
      .insert(tasks)
      .values({
        companyId: cid(t.company),
        title: t.title,
        description: t.description,
        type: t.type,
        priority: "normal",
        status: "queued",
        createdByKind: "human",
        createdByRef: "owner@aibos.example",
        requiredCapabilities: t.capabilities,
        maxBudget: t.maxBudget,
        estimatedCost: t.estimatedCost,
        parallelAllowed: "parallel" in t ? t.parallel : false,
        workItems: "workItems" in t ? t.workItems : null,
        normalizedObjective: normalizeObjective(t.title),
        origin: ORIGIN,
      })
      .returning({ id: tasks.id });
    await db.update(tasks).set({ rootTaskId: row!.id }).where(eq(tasks.id, row!.id));
    ctx.taskIds.set(t.key, row!.id);
    newTaskIds.push(row!.id);
  }

  /* delegation history (what the manager did) */
  const eptResearchTask = ctx.taskIds.get("ept-research")!;
  const eptEmailTask = ctx.taskIds.get("ept-email")!;
  await db.insert(taskDelegations).values([
    {
      taskId: eptResearchTask,
      companyId: cid("euro-pilot-training"),
      fromAgentId: aid("ept-manager"),
      toAgentId: aid("ept-research"),
      outcome: "delegate_to_agent",
      explanation: [
        "DELEGATE → EPT Flight School Research: required capability match, available capacity.",
      ],
      origin: ORIGIN,
      createdAt: new Date(now.getTime() - 3 * 3_600_000),
    },
    {
      taskId: eptEmailTask,
      companyId: cid("euro-pilot-training"),
      fromAgentId: aid("ept-manager"),
      toAgentId: aid("email-comms"),
      outcome: "delegate_to_agent",
      explanation: ["DELEGATE → Email & Communications: required capability match."],
      origin: ORIGIN,
      createdAt: new Date(now.getTime() - 2 * 3_600_000),
    },
    {
      taskId: ctx.taskIds.get("og-meta-review")!,
      companyId: cid("opportunitygrad"),
      fromAgentId: aid("og-manager"),
      toAgentId: aid("og-marketing-meta"),
      outcome: "delegate_to_agent",
      explanation: ["DELEGATE → Opportunitygrad Marketing / Meta: specialist match."],
      origin: ORIGIN,
      createdAt: new Date(now.getTime() - 90 * 60_000),
    },
  ]);
  await db
    .update(tasks)
    .set({ delegatedFromAgentId: aid("ept-manager"), delegationDepth: 1 })
    .where(inArray(tasks.id, [eptResearchTask, eptEmailTask]));
  await db.insert(auditEvents).values({
    actorType: "agent",
    agentId: aid("ept-manager"),
    companyId: cid("euro-pilot-training"),
    resourceType: "task",
    resourceId: eptResearchTask,
    action: "task.duplicate_detected",
    description:
      'Duplicate task avoided: "Research EASA flight schools in Europe" matches "Research European EASA flight schools"',
    origin: ORIGIN,
    occurredAt: new Date(now.getTime() - 100 * 60_000),
  });

  /* research → email handoff (reused by the Email agent's context) */
  const [partnerPolicy] = await db
    .select({ id: knowledgeItems.id })
    .from(knowledgeItems)
    .where(eq(knowledgeItems.title, "Flight-school partnership approach"));
  const handoff = await createHandoff(
    db,
    {
      taskId: eptEmailTask,
      sourceAgentId: aid("ept-research"),
      toAgentId: aid("email-comms"),
      type: "research_result",
      objective: "Introduce Euro Pilot Training to verified European flight schools",
      summary:
        "Development seed example: the shortlist research is complete; verified schools are recorded in the linked task.",
      verifiedFacts: [
        "Approval claims were checked against the official register (development seed example)",
      ],
      sourceReferences: ["Task: Verify ATO approvals against EASA register"],
      knowledgeIds: partnerPolicy ? [partnerPolicy.id] : [],
      contactReference: "Partner contact records are referenced by the research task (dev seed)",
      actionRequired: "Draft partnership introduction emails for human approval",
      priority: "normal",
      doNotResearchAgainUnless: [
        "A contact is missing",
        "Information is outdated or contradictory",
      ],
    },
    SEED_ACTOR,
    { origin: ORIGIN },
  );
  await db
    .update(handoffs)
    .set({ status: "accepted", acceptedAt: now })
    .where(eq(handoffs.id, handoff.id));

  /* temporary worker bound to the 200-school sweep */
  const bigTask = ctx.taskIds.get("ept-200-schools")!;
  const temp = await createTemporaryAgent(
    db,
    {
      parentAgentId: aid("ept-research"),
      companyId: cid("euro-pilot-training"),
      taskId: bigTask,
      name: "Portugal Research Worker",
      purpose: "Research Portuguese flight schools for the 200-school sweep",
      capabilities: ["research.web"],
      permissions: ["tool.web.search"],
      expiresInHours: 72,
      budgetUsd: 1,
    },
    { kind: "human", actor: ownerActor },
    { origin: ORIGIN, now },
  );
  if (temp.status === "created") ctx.agentIds.set("temp-portugal", temp.agent.id);

  await refreshAgentStates(db);
  return {
    roleTemplates: SEED_ROLE_TEMPLATES.length,
    teams: SEED_TEAMS.length,
    delegationTasks: newTaskIds.length,
  };
}
