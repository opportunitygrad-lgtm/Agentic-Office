import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { agentMaxSensitivity } from "@aibos/context-core";
import {
  conversationMessageSchema,
  createAgentMessageSchema,
  createConversationSchema,
  createHandoffSchema,
  sensitivityRank,
  type AgentMessageDTO,
  type ConversationDTO,
  type ConversationMessageDTO,
  type CreateHandoffInput,
  type HandoffAction,
  type HandoffDTO,
  type SensitivityLevel,
} from "@aibos/shared";
import type { z } from "zod";
import type { Database } from "../client";
import { ConflictError, ForbiddenError, NotFoundError } from "../errors";
import {
  agentCompanyAssignments,
  agentMessages,
  agents,
  companies,
  conversationMessages,
  conversations,
  departments,
  handoffs,
  knowledgeAccessPolicies,
  knowledgeItems,
  tasks,
  teamMembers,
  teams,
  users,
  type Handoff,
} from "../schema";
import { recordAuditEvent } from "./audit";
import { displayNameOf } from "./identity";
import { actorAuditFields, scopeWhere, type AccessScope, type Actor } from "./util";

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Db = Database | Tx;

async function servesCompany(
  db: Db,
  agentId: string,
  companyId: string,
): Promise<{ ok: boolean; name: string; departmentId: string | null }> {
  const [a] = await db.select().from(agents).where(eq(agents.id, agentId));
  if (!a) throw new NotFoundError("Agent", agentId);
  if (a.scope === "global") return { ok: true, name: a.name, departmentId: a.departmentId };
  const [row] = await db
    .select()
    .from(agentCompanyAssignments)
    .where(
      and(
        eq(agentCompanyAssignments.agentId, agentId),
        eq(agentCompanyAssignments.companyId, companyId),
      ),
    );
  return { ok: !!row, name: a.name, departmentId: a.departmentId };
}

/* ---------- handoffs ---------- */

/**
 * Creates a structured handoff. Source and destination must belong to the
 * task's company. Evidence knowledge must be company/GLOBAL knowledge the
 * DESTINATION is cleared to read — restricted knowledge never travels to an
 * agent (or team/department) without clearance.
 */
export async function createHandoff(
  db: Database,
  input: CreateHandoffInput,
  actor: Actor,
  opts: { origin?: "live" | "dev_seed" } = {},
): Promise<Handoff> {
  const data = createHandoffSchema.parse(input);
  return db.transaction(async (tx) => {
    const [task] = await tx.select().from(tasks).where(eq(tasks.id, data.taskId));
    if (!task) throw new NotFoundError("Task", data.taskId);
    if (!task.companyId) throw new ConflictError("Handoffs need a company task");
    const companyId = task.companyId;
    const source = await servesCompany(tx, data.sourceAgentId, companyId);
    if (!source.ok) throw new ForbiddenError("The source agent does not serve this company");

    let maxSensitivity: SensitivityLevel = "internal";
    let destName: string;
    if (data.toAgentId) {
      const dest = await servesCompany(tx, data.toAgentId, companyId);
      if (!dest.ok) throw new ForbiddenError("The destination agent does not serve this company");
      if (data.toAgentId === data.sourceAgentId)
        throw new ConflictError("An agent cannot hand off to itself");
      const policies = await tx
        .select()
        .from(knowledgeAccessPolicies)
        .where(eq(knowledgeAccessPolicies.companyId, companyId));
      maxSensitivity = agentMaxSensitivity(
        { id: data.toAgentId, departmentId: dest.departmentId },
        policies,
      );
      destName = dest.name;
    } else if (data.toTeamId) {
      const [team] = await tx.select().from(teams).where(eq(teams.id, data.toTeamId));
      if (!team) throw new NotFoundError("Team", data.toTeamId);
      if (team.companyId !== null && team.companyId !== companyId)
        throw new ForbiddenError("The destination team belongs to another company");
      destName = team.name;
    } else {
      const [dept] = await tx
        .select()
        .from(departments)
        .where(eq(departments.id, data.toDepartmentId!));
      if (!dept) throw new NotFoundError("Department", data.toDepartmentId!);
      if (dept.companyId !== null && dept.companyId !== companyId)
        throw new ForbiddenError("The destination department belongs to another company");
      destName = dept.name;
    }

    if (data.knowledgeIds.length) {
      const items = await tx
        .select({
          id: knowledgeItems.id,
          companyId: knowledgeItems.companyId,
          sensitivity: knowledgeItems.sensitivity,
          status: knowledgeItems.status,
        })
        .from(knowledgeItems)
        .where(inArray(knowledgeItems.id, data.knowledgeIds));
      if (items.length !== new Set(data.knowledgeIds).size)
        throw new NotFoundError("Knowledge item", "one or more ids");
      for (const k of items) {
        if (k.companyId !== null && k.companyId !== companyId)
          throw new ForbiddenError("Handoff evidence must belong to the same company");
        if (sensitivityRank(k.sensitivity) > sensitivityRank(maxSensitivity))
          throw new ForbiddenError(
            `The destination is not cleared for ${k.sensitivity.toUpperCase()} knowledge`,
          );
      }
    }

    const [row] = await tx
      .insert(handoffs)
      .values({
        companyId,
        taskId: task.id,
        sourceAgentId: data.sourceAgentId,
        toAgentId: data.toAgentId,
        toTeamId: data.toTeamId,
        toDepartmentId: data.toDepartmentId,
        type: data.type,
        objective: data.objective,
        summary: data.summary,
        verifiedFacts: data.verifiedFacts,
        sourceReferences: data.sourceReferences,
        knowledgeIds: data.knowledgeIds,
        contactReference: data.contactReference,
        actionRequired: data.actionRequired,
        priority: data.priority,
        deadline: data.deadline,
        doNotResearchAgainUnless: data.doNotResearchAgainUnless,
        createdByUserId: actor.userId ?? null,
        origin: opts.origin ?? "live",
      })
      .returning();
    if (data.toAgentId || data.toTeamId)
      await tx.insert(agentMessages).values({
        companyId,
        senderType: "agent",
        senderAgentId: data.sourceAgentId,
        recipientAgentId: data.toAgentId,
        recipientTeamId: data.toTeamId,
        taskId: task.id,
        type: "handoff",
        content: `Handoff: ${data.objective}`,
        payload: { handoffId: row!.id },
        origin: opts.origin ?? "live",
      });
    await recordAuditEvent(
      tx,
      {
        ...actorAuditFields(actor),
        companyId,
        taskId: task.id,
        agentId: data.sourceAgentId,
        resourceType: "handoff",
        resourceId: row!.id,
        action: "handoff.created",
        description: `Handoff from ${source.name} to ${destName}: ${data.objective}`,
        metadata: { type: data.type, knowledgeCount: data.knowledgeIds.length },
      },
      opts.origin,
    );
    return row!;
  });
}

const TRANSITIONS: Record<HandoffAction, { from: Handoff["status"][]; to: Handoff["status"] }> = {
  accept: { from: ["pending"], to: "accepted" },
  reject: { from: ["pending"], to: "rejected" },
  complete: { from: ["accepted"], to: "completed" },
  cancel: { from: ["pending", "accepted"], to: "cancelled" },
};

export async function getHandoffRecord(db: Db, id: string): Promise<Handoff> {
  const [h] = await db.select().from(handoffs).where(eq(handoffs.id, id));
  if (!h) throw new NotFoundError("Handoff", id);
  return h;
}

export async function transitionHandoff(
  db: Database,
  id: string,
  action: HandoffAction,
  actor: Actor,
  note?: string,
): Promise<Handoff> {
  return db.transaction(async (tx) => {
    const h = await getHandoffRecord(tx, id);
    const rule = TRANSITIONS[action];
    if (!rule.from.includes(h.status))
      throw new ConflictError(`Cannot ${action} a ${h.status} handoff`);
    const now = new Date();
    const [row] = await tx
      .update(handoffs)
      .set({
        status: rule.to,
        note: note ?? h.note,
        ...(rule.to === "accepted" ? { acceptedAt: now } : {}),
        ...(rule.to === "completed" ? { completedAt: now } : {}),
      })
      .where(eq(handoffs.id, id))
      .returning();
    await recordAuditEvent(tx, {
      ...actorAuditFields(actor),
      companyId: h.companyId,
      taskId: h.taskId,
      resourceType: "handoff",
      resourceId: id,
      action: `handoff.${rule.to}`,
      description: `Handoff "${h.objective}" ${rule.to}`,
      metadata: { note: note ?? null },
    });
    return row!;
  });
}

export async function listHandoffs(
  db: Database,
  opts: {
    scope: AccessScope;
    taskId?: string;
    agentId?: string;
    status?: Handoff["status"];
    ids?: string[];
    canReadKnowledge: (companyId: string | null, sensitivity: SensitivityLevel) => boolean;
  },
): Promise<HandoffDTO[]> {
  const src = alias(agents, "src");
  const dst = alias(agents, "dst");
  const rows = await db
    .select({
      h: handoffs,
      company: {
        id: companies.id,
        name: companies.name,
        slug: companies.slug,
        accentColor: companies.accentColor,
      },
      taskTitle: tasks.title,
      srcName: src.name,
      dstName: dst.name,
      teamName: teams.name,
      deptName: departments.name,
      creator: {
        id: users.id,
        email: users.email,
        displayName: users.displayName,
        firstName: users.firstName,
        lastName: users.lastName,
      },
    })
    .from(handoffs)
    .innerJoin(companies, eq(companies.id, handoffs.companyId))
    .innerJoin(tasks, eq(tasks.id, handoffs.taskId))
    .innerJoin(src, eq(src.id, handoffs.sourceAgentId))
    .leftJoin(dst, eq(dst.id, handoffs.toAgentId))
    .leftJoin(teams, eq(teams.id, handoffs.toTeamId))
    .leftJoin(departments, eq(departments.id, handoffs.toDepartmentId))
    .leftJoin(users, eq(users.id, handoffs.createdByUserId))
    .where(
      and(
        scopeWhere(handoffs.companyId, { ...opts.scope, includeGroup: false }),
        opts.taskId ? eq(handoffs.taskId, opts.taskId) : undefined,
        opts.agentId
          ? or(eq(handoffs.toAgentId, opts.agentId), eq(handoffs.sourceAgentId, opts.agentId))
          : undefined,
        opts.status ? eq(handoffs.status, opts.status) : undefined,
        opts.ids ? (opts.ids.length ? inArray(handoffs.id, opts.ids) : sql`false`) : undefined,
      ),
    )
    .orderBy(desc(handoffs.createdAt))
    .limit(200);
  const kIds = [...new Set(rows.flatMap((r) => r.h.knowledgeIds))];
  const kRows = kIds.length
    ? await db
        .select({
          id: knowledgeItems.id,
          title: knowledgeItems.title,
          companyId: knowledgeItems.companyId,
          sensitivity: knowledgeItems.sensitivity,
        })
        .from(knowledgeItems)
        .where(inArray(knowledgeItems.id, kIds))
    : [];
  return rows.map(({ h, company, taskTitle, srcName, dstName, teamName, deptName, creator }) => ({
    id: h.id,
    company,
    task: { id: h.taskId, title: taskTitle },
    from: { id: h.sourceAgentId, name: srcName },
    to: h.toAgentId
      ? { kind: "agent" as const, id: h.toAgentId, name: dstName ?? "—" }
      : h.toTeamId
        ? { kind: "team" as const, id: h.toTeamId, name: teamName ?? "—" }
        : { kind: "department" as const, id: h.toDepartmentId!, name: deptName ?? "—" },
    type: h.type,
    objective: h.objective,
    summary: h.summary,
    verifiedFacts: h.verifiedFacts,
    sourceReferences: h.sourceReferences,
    // Knowledge the viewer cannot read is listed without its title.
    knowledge: h.knowledgeIds.map((id) => {
      const k = kRows.find((x) => x.id === id);
      const readable = !!k && opts.canReadKnowledge(k.companyId, k.sensitivity);
      return { id, title: readable ? k!.title : null, redacted: !readable };
    }),
    contactReference: h.contactReference,
    actionRequired: h.actionRequired,
    priority: h.priority,
    deadline: h.deadline?.toISOString() ?? null,
    doNotResearchAgainUnless: h.doNotResearchAgainUnless,
    status: h.status,
    createdBy: creator?.id ? displayNameOf(creator) : null,
    createdAt: h.createdAt.toISOString(),
    acceptedAt: h.acceptedAt?.toISOString() ?? null,
    completedAt: h.completedAt?.toISOString() ?? null,
    origin: h.origin,
  }));
}

/** Handoffs for the Context Engine: this task, addressed to this agent (directly, via team or department). */
export async function handoffsForContext(
  db: Db,
  taskId: string,
  agentId: string,
  companyId: string,
) {
  const [agent] = await db
    .select({ departmentId: agents.departmentId })
    .from(agents)
    .where(eq(agents.id, agentId));
  const teamIds = (
    await db
      .select({ id: teamMembers.teamId })
      .from(teamMembers)
      .where(eq(teamMembers.agentId, agentId))
  ).map((t) => t.id);
  const src = alias(agents, "src");
  const rows = await db
    .select({ h: handoffs, from: src.name })
    .from(handoffs)
    .innerJoin(src, eq(src.id, handoffs.sourceAgentId))
    .where(
      and(
        eq(handoffs.taskId, taskId),
        eq(handoffs.companyId, companyId),
        inArray(handoffs.status, ["pending", "accepted", "completed"]),
        or(
          eq(handoffs.toAgentId, agentId),
          teamIds.length ? inArray(handoffs.toTeamId, teamIds) : sql`false`,
          agent?.departmentId ? eq(handoffs.toDepartmentId, agent.departmentId) : sql`false`,
        ),
      ),
    )
    .orderBy(handoffs.createdAt);
  return rows.map(({ h, from }) => ({
    id: h.id,
    companyId: h.companyId,
    from,
    type: h.type,
    objective: h.objective,
    summary: h.summary,
    verifiedFacts: h.verifiedFacts,
    sourceReferences: h.sourceReferences,
    actionRequired: h.actionRequired,
    doNotResearchAgainUnless: h.doNotResearchAgainUnless,
    knowledgeIds: h.knowledgeIds,
    status: h.status,
  }));
}

/* ---------- agent messages ---------- */

export async function sendAgentMessage(
  db: Database,
  input: z.input<typeof createAgentMessageSchema>,
  actor: Actor,
): Promise<string> {
  const data = createAgentMessageSchema.parse(input);
  let companyId: string | null = null;
  if (data.taskId) {
    const [t] = await db.select().from(tasks).where(eq(tasks.id, data.taskId));
    if (!t) throw new NotFoundError("Task", data.taskId);
    companyId = t.companyId;
    if (
      data.recipientAgentId &&
      companyId &&
      !(await servesCompany(db, data.recipientAgentId, companyId)).ok
    )
      throw new ForbiddenError("The recipient does not serve the task's company");
  }
  const [row] = await db
    .insert(agentMessages)
    .values({
      companyId,
      senderType:
        actor.kind === "human" ? "human" : actor.kind === "service" ? "service" : "system",
      senderUserId: actor.userId ?? null,
      senderServiceId: actor.serviceId ?? null,
      recipientAgentId: data.recipientAgentId,
      recipientTeamId: data.recipientTeamId,
      taskId: data.taskId,
      type: data.type,
      content: data.content,
      payload: data.payload,
    })
    .returning({ id: agentMessages.id });
  await recordAuditEvent(db, {
    ...actorAuditFields(actor),
    companyId: companyId ?? undefined,
    taskId: data.taskId ?? undefined,
    agentId: data.recipientAgentId ?? undefined,
    resourceType: "agent_message",
    resourceId: row!.id,
    action: "agent.message_sent",
    description: `${data.type.replace(/_/g, " ")} message sent`,
  });
  return row!.id;
}

export async function listAgentMessages(
  db: Database,
  opts: { taskId?: string; agentId?: string; scope: AccessScope; limit?: number },
): Promise<AgentMessageDTO[]> {
  const sender = alias(agents, "sender");
  const recipient = alias(agents, "recipient");
  const rows = await db
    .select({
      m: agentMessages,
      senderName: sender.name,
      recipientName: recipient.name,
      teamName: teams.name,
      userEmail: users.email,
    })
    .from(agentMessages)
    .leftJoin(sender, eq(sender.id, agentMessages.senderAgentId))
    .leftJoin(recipient, eq(recipient.id, agentMessages.recipientAgentId))
    .leftJoin(teams, eq(teams.id, agentMessages.recipientTeamId))
    .leftJoin(users, eq(users.id, agentMessages.senderUserId))
    .where(
      and(
        scopeWhere(agentMessages.companyId, opts.scope),
        opts.taskId ? eq(agentMessages.taskId, opts.taskId) : undefined,
        opts.agentId
          ? or(
              eq(agentMessages.recipientAgentId, opts.agentId),
              eq(agentMessages.senderAgentId, opts.agentId),
            )
          : undefined,
      ),
    )
    .orderBy(desc(agentMessages.createdAt))
    .limit(opts.limit ?? 100);
  return rows.map(({ m, senderName, recipientName, teamName, userEmail }) => ({
    id: m.id,
    sender: {
      type: m.senderType === "anonymous" ? "system" : m.senderType,
      id: m.senderAgentId ?? m.senderUserId ?? m.senderServiceId,
      name: senderName ?? userEmail ?? m.senderServiceId ?? "System",
    },
    recipient: m.recipientAgentId
      ? { kind: "agent" as const, id: m.recipientAgentId, name: recipientName ?? "—" }
      : { kind: "team" as const, id: m.recipientTeamId!, name: teamName ?? "—" },
    taskId: m.taskId,
    type: m.type,
    content: m.content,
    payload: m.payload,
    createdAt: m.createdAt.toISOString(),
    readAt: m.readAt?.toISOString() ?? null,
  }));
}

/* ---------- conversations (foundation — no AI replies in Stage 04) ---------- */

export const CONVERSATION_PLACEHOLDER =
  "Message recorded. Live agent replies arrive with provider integration (Stage 05); no AI was called.";

export async function createConversation(
  db: Database,
  input: z.input<typeof createConversationSchema>,
  actor: Actor,
): Promise<string> {
  const data = createConversationSchema.parse(input);
  if (!actor.userId) throw new ForbiddenError("Only people can start conversations");
  if (!(await servesCompany(db, data.agentId, data.companyId)).ok)
    throw new ForbiddenError("The agent does not serve this company");
  if (data.taskId) {
    const [t] = await db.select().from(tasks).where(eq(tasks.id, data.taskId));
    if (!t || t.companyId !== data.companyId)
      throw new ForbiddenError("The task belongs to a different company");
  }
  const [row] = await db
    .insert(conversations)
    .values({ ...data, userId: actor.userId })
    .returning({ id: conversations.id });
  await recordAuditEvent(db, {
    ...actorAuditFields(actor),
    companyId: data.companyId,
    agentId: data.agentId,
    resourceType: "conversation",
    resourceId: row!.id,
    action: "conversation.created",
    description: "Conversation with agent started",
  });
  return row!.id;
}

export async function listConversations(
  db: Database,
  opts: { userId: string; agentId?: string; scope: AccessScope },
): Promise<ConversationDTO[]> {
  const rows = await db
    .select({
      c: conversations,
      company: {
        id: companies.id,
        name: companies.name,
        slug: companies.slug,
        accentColor: companies.accentColor,
      },
      agentName: agents.name,
      taskTitle: tasks.title,
      count: sql<number>`(select count(*)::int from ${conversationMessages} where ${conversationMessages.conversationId} = ${conversations.id})`,
      last: sql<
        string | null
      >`(select max(${conversationMessages.createdAt})::text from ${conversationMessages} where ${conversationMessages.conversationId} = ${conversations.id})`,
    })
    .from(conversations)
    .innerJoin(companies, eq(companies.id, conversations.companyId))
    .innerJoin(agents, eq(agents.id, conversations.agentId))
    .leftJoin(tasks, eq(tasks.id, conversations.taskId))
    .where(
      and(
        eq(conversations.userId, opts.userId),
        scopeWhere(conversations.companyId, { ...opts.scope, includeGroup: false }),
        opts.agentId ? eq(conversations.agentId, opts.agentId) : undefined,
      ),
    )
    .orderBy(desc(conversations.updatedAt));
  return rows.map(({ c, company, agentName, taskTitle, count, last }) => ({
    id: c.id,
    company,
    agent: { id: c.agentId, name: agentName },
    task: c.taskId && taskTitle ? { id: c.taskId, title: taskTitle } : null,
    title: c.title,
    status: c.status,
    messageCount: count,
    lastMessageAt: last ? new Date(last).toISOString() : null,
    createdAt: c.createdAt.toISOString(),
  }));
}

/** Conversations are private to the person who started them. */
export async function getOwnConversation(db: Database, id: string, userId: string) {
  const [c] = await db.select().from(conversations).where(eq(conversations.id, id));
  if (!c || c.userId !== userId) throw new NotFoundError("Conversation", id);
  return c;
}

export async function listConversationMessages(
  db: Database,
  conversationId: string,
): Promise<ConversationMessageDTO[]> {
  const rows = await db
    .select({
      m: conversationMessages,
      u: {
        email: users.email,
        displayName: users.displayName,
        firstName: users.firstName,
        lastName: users.lastName,
      },
    })
    .from(conversationMessages)
    .leftJoin(users, eq(users.id, conversationMessages.authorUserId))
    .where(eq(conversationMessages.conversationId, conversationId))
    // A human message and its placeholder share a timestamp: the human message comes first.
    .orderBy(
      conversationMessages.createdAt,
      sql`case when ${conversationMessages.role} = 'human' then 0 else 1 end`,
    );
  return rows.map(({ m, u }) => ({
    id: m.id,
    role: m.role as ConversationMessageDTO["role"],
    author:
      m.role === "human" && u?.email ? displayNameOf(u) : m.role === "system" ? "System" : "Agent",
    content: m.content,
    createdAt: m.createdAt.toISOString(),
  }));
}

export async function addConversationMessage(
  db: Database,
  conversationId: string,
  input: z.input<typeof conversationMessageSchema>,
  actor: Actor,
): Promise<ConversationMessageDTO[]> {
  const data = conversationMessageSchema.parse(input);
  const c = await getOwnConversation(db, conversationId, actor.userId ?? "");
  if (c.status === "closed") throw new ConflictError("This conversation is closed");
  await db.insert(conversationMessages).values([
    { conversationId, role: "human", authorUserId: actor.userId ?? null, content: data.content },
    { conversationId, role: "system", content: CONVERSATION_PLACEHOLDER },
  ]);
  await db
    .update(conversations)
    .set({ updatedAt: new Date() })
    .where(eq(conversations.id, conversationId));
  return listConversationMessages(db, conversationId);
}
