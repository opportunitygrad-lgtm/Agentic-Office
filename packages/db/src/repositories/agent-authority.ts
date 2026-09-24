import { and, eq, inArray, isNull } from "drizzle-orm";
import {
  AGENT_PERMISSIONS,
  AGENT_PERMISSION_KEYS,
  evaluateAgentPermission,
  type AgentAuthorityInput,
  type AgentDecision,
  type AgentGrant,
} from "@aibos/access-core";
import { TEMPLATE_GRANTS } from "@aibos/agent-core";
import {
  agentGrantsSchema,
  type AgentAuthorityDTO,
  type AgentTemplateKey,
  type AutonomyLevel,
} from "@aibos/shared";
import type { z } from "zod";
import type { Database } from "../client";
import { ConflictError, NotFoundError } from "../errors";
import { agentCompanyAssignments, agentPermissionGrants, agents, companies } from "../schema";
import { recordAuditEvent } from "./audit";
import { actorAuditFields, type Actor } from "./util";

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

/** Applies a template's default grants to a newly created agent. */
export async function applyTemplateGrants(
  db: Database | Tx,
  agentId: string,
  templateKey: AgentTemplateKey,
  origin: "live" | "dev_seed" = "live",
): Promise<void> {
  const grants = TEMPLATE_GRANTS[templateKey];
  const rows = Object.entries(grants).map(([permission, effect]) => ({
    agentId,
    companyId: null,
    permission,
    effect,
    origin,
  }));
  if (rows.length) await db.insert(agentPermissionGrants).values(rows).onConflictDoNothing();
}

export async function loadAgentAuthorityInput(
  db: Database,
  agentId: string,
): Promise<AgentAuthorityInput & { raw: typeof agents.$inferSelect }> {
  const [agent] = await db.select().from(agents).where(eq(agents.id, agentId));
  if (!agent) throw new NotFoundError("Agent", agentId);
  const [assignments, grants] = await Promise.all([
    db
      .select({ companyId: agentCompanyAssignments.companyId })
      .from(agentCompanyAssignments)
      .where(eq(agentCompanyAssignments.agentId, agentId)),
    db.select().from(agentPermissionGrants).where(eq(agentPermissionGrants.agentId, agentId)),
  ]);
  return {
    raw: agent,
    agent: {
      id: agent.id,
      status: agent.status,
      autonomyLevel: agent.autonomyLevel,
      scope: agent.scope,
      companyIds: assignments.map((a) => a.companyId),
      approvalRequirements: agent.approvalRequirements,
    },
    grants: grants.map((g): AgentGrant => ({
      permission: g.permission,
      effect: g.effect,
      companyId: g.companyId,
    })),
  };
}

/**
 * canAgent(agentId, companyId, permission) — the authority check the future
 * execution controller calls before every tool call or action.
 */
export async function canAgent(
  db: Database,
  agentId: string,
  companyId: string | null,
  permission: string,
): Promise<AgentDecision> {
  try {
    const input = await loadAgentAuthorityInput(db, agentId);
    return evaluateAgentPermission(input, companyId, permission);
  } catch (e) {
    if (e instanceof NotFoundError) return { decision: "deny", reason: "Unknown agent" };
    throw e;
  }
}

export async function agentAuthority(
  db: Database,
  agentId: string,
  companyId: string | null,
  opts: { visibleCompanyIds: "all" | readonly string[]; viewerCanManage: boolean },
): Promise<AgentAuthorityDTO> {
  const input = await loadAgentAuthorityInput(db, agentId);
  const a = input.raw;
  const companyRows = input.agent.companyIds.length
    ? await db
        .select({
          id: companies.id,
          name: companies.name,
          slug: companies.slug,
          accentColor: companies.accentColor,
        })
        .from(companies)
        .where(inArray(companies.id, [...input.agent.companyIds]))
    : [];
  const visible = companyRows.filter(
    (c) =>
      input.agent.companyIds.includes(c.id) &&
      (opts.visibleCompanyIds === "all" || opts.visibleCompanyIds.includes(c.id)),
  );
  const groups = new Map<string, AgentAuthorityDTO["groups"][number]["items"]>();
  for (const def of AGENT_PERMISSIONS) {
    const grant =
      (companyId
        ? input.grants.find((g) => g.permission === def.key && g.companyId === companyId)
        : undefined) ?? input.grants.find((g) => g.permission === def.key && g.companyId === null);
    const decision = evaluateAgentPermission(input, companyId, def.key);
    const list = groups.get(def.group) ?? [];
    list.push({
      permission: def.key,
      verb: def.verb,
      label: def.label,
      risk: def.risk,
      grant: grant?.effect ?? null,
      decision: decision.decision,
      reason: decision.reason,
    });
    groups.set(def.group, list);
  }
  return {
    agentId,
    companyId,
    autonomyLevel: a.autonomyLevel,
    status: a.status,
    companies: visible,
    groups: [...groups.entries()].map(([group, items]) => ({ group, items })),
    approvalGates: a.approvalRequirements,
    prohibitedActions: a.prohibitedActions,
    limits: {
      perTaskBudget: a.perTaskBudget,
      dailyBudget: a.dailyBudget,
      maxExternalSearches: a.maxExternalSearches,
      maxRetries: a.maxRetries,
      concurrencyLimit: a.concurrencyLimit,
    },
    viewerCanManage: opts.viewerCanManage,
  };
}

export async function setAgentAutonomy(
  db: Database,
  agentId: string,
  level: AutonomyLevel,
  actor: Actor,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [before] = await tx.select().from(agents).where(eq(agents.id, agentId));
    if (!before) throw new NotFoundError("Agent", agentId);
    if (before.autonomyLevel === level) return;
    await tx.update(agents).set({ autonomyLevel: level }).where(eq(agents.id, agentId));
    await recordAuditEvent(tx, {
      ...actorAuditFields(actor),
      agentId,
      resourceType: "agent",
      resourceId: agentId,
      action: "agent.autonomy_changed",
      description: `Autonomy for "${before.name}" changed from ${before.autonomyLevel} to ${level}`,
      before: { autonomyLevel: before.autonomyLevel },
      after: { autonomyLevel: level },
    });
  });
}

/** Upserts (effect) or removes (effect null) agent grants for one scope. */
export async function setAgentGrants(
  db: Database,
  agentId: string,
  input: z.input<typeof agentGrantsSchema>,
  actor: Actor,
): Promise<void> {
  const data = agentGrantsSchema.parse(input);
  const unknown = data.grants
    .filter((g) => !AGENT_PERMISSION_KEYS.has(g.permission))
    .map((g) => g.permission);
  if (unknown.length) throw new ConflictError(`Unknown agent permissions: ${unknown.join(", ")}`);
  await db.transaction(async (tx) => {
    const [agent] = await tx.select().from(agents).where(eq(agents.id, agentId));
    if (!agent) throw new NotFoundError("Agent", agentId);
    const scopeCond = data.companyId
      ? eq(agentPermissionGrants.companyId, data.companyId)
      : isNull(agentPermissionGrants.companyId);
    const before = await tx
      .select()
      .from(agentPermissionGrants)
      .where(and(eq(agentPermissionGrants.agentId, agentId), scopeCond));
    for (const g of data.grants) {
      const cond = and(
        eq(agentPermissionGrants.agentId, agentId),
        scopeCond,
        eq(agentPermissionGrants.permission, g.permission),
      );
      if (g.effect === null) {
        await tx.delete(agentPermissionGrants).where(cond);
      } else if (before.some((b) => b.permission === g.permission)) {
        await tx
          .update(agentPermissionGrants)
          .set({ effect: g.effect, createdByUserId: actor.userId ?? null })
          .where(cond);
      } else {
        await tx.insert(agentPermissionGrants).values({
          agentId,
          companyId: data.companyId,
          permission: g.permission,
          effect: g.effect,
          createdByUserId: actor.userId ?? null,
        });
      }
    }
    await recordAuditEvent(tx, {
      ...actorAuditFields(actor),
      agentId,
      companyId: data.companyId ?? undefined,
      resourceType: "agent",
      resourceId: agentId,
      action: "agent.permissions_changed",
      description: `Tool/action permissions changed for "${agent.name}"`,
      before: Object.fromEntries(before.map((b) => [b.permission, b.effect])),
      after: Object.fromEntries(data.grants.map((g) => [g.permission, g.effect])),
    });
  });
}
