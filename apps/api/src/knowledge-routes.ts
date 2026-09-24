import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { z } from "zod";
import { can, companiesWith, type HumanAccessContext } from "@aibos/access-core";
import {
  ForbiddenError,
  NotFoundError,
  actorAuditFields,
  approveKnowledge,
  archiveKnowledge,
  buildContextPack,
  canSeeKnowledge,
  createKnowledge,
  createKnowledgeAccessPolicy,
  createRule,
  deleteKnowledgeAccessPolicy,
  getAgentKnowledgeProfile,
  getCompanyProfile,
  getKnowledgeDetail,
  getKnowledgeDTO,
  getKnowledgeRecord,
  getRuleRecord,
  getTaskRecord,
  knowledgeChanges,
  knowledgeSensitivities,
  linkKnowledge,
  listAgents,
  listTasks,
  listCompanyHistory,
  listCompanyRules,
  listKnowledge,
  listKnowledgeAccessPolicies,
  listKnowledgeConflicts,
  recordAuditEvent,
  rejectKnowledge,
  ruleLifecycle,
  setAgentKnowledgeProfile,
  submitKnowledge,
  supersedeKnowledge,
  unlinkKnowledge,
  updateAiPolicy,
  updateCompanyProfileSection,
  updateKnowledge,
  updateRule,
  type KnowledgeItem,
  type KnowledgeVisibility,
} from "@aibos/db";
import {
  PROFILE_SECTIONS,
  PROFILE_SECTION_PERMISSION,
  RULE_ACTIONS,
  RULE_KINDS,
  SENSITIVITY_READ_PERMISSION,
  agentKnowledgeProfileSchema,
  aiPolicySchema,
  contextPreviewQuery,
  createKnowledgeSchema,
  knowledgeAccessPolicySchema,
  knowledgeApproveSchema,
  knowledgeLinkSchema,
  knowledgeNotesSchema,
  knowledgeSupersedeSchema,
  listKnowledgeQuery,
  ruleUpdateSchema,
  uuidSchema,
  type AgentContextPack,
  type AgentDTO,
  type CompanyProfileDTO,
  type KnowledgeListDTO,
  type SensitivityLevel,
} from "@aibos/shared";
import { actorFrom, auditSecurityEvent, companyScope, principalOf, scopeFor } from "./security";

const idParam = z.object({ id: uuidSchema });
const refParam = z.object({ ref: z.string().min(1).max(64) });

/* ---------- permission helpers ---------- */

function holdsAnywhere(access: HumanAccessContext, permission: string): boolean {
  const ids = companiesWith(access, permission);
  return ids === "all" || ids.length > 0;
}

/** Can the viewer read knowledge of this sensitivity for this company (null = global)? */
function canReadSensitivity(
  access: HumanAccessContext,
  companyId: string | null,
  sensitivity: SensitivityLevel,
): boolean {
  const permission = SENSITIVITY_READ_PERMISSION[sensitivity];
  if (!permission) return true;
  return companyId === null
    ? holdsAnywhere(access, permission)
    : can(access, permission, companyId);
}

function visibility(req: FastifyRequest): KnowledgeVisibility {
  const access = principalOf(req).access;
  const scope = scopeFor(req, "knowledge.view");
  return {
    scope,
    includeGlobal: scope.companyIds === "all" || scope.companyIds.length > 0,
    canRead: (companyId, sensitivity) => canReadSensitivity(access, companyId, sensitivity),
  };
}

/** Department-restricted members may only write knowledge in their departments. */
function departmentWriteAllowed(
  access: HumanAccessContext,
  companyId: string | null,
  departmentId: string | null,
): boolean {
  if (companyId === null) return true;
  const restricted = access.departments.get(companyId);
  if (!restricted || access.global.size) return true;
  return departmentId !== null && restricted.includes(departmentId);
}

/**
 * Knowledge permission check. GLOBAL knowledge is managed only with
 * knowledge.global.manage (platform / group administrators).
 */
function canOnKnowledge(
  access: HumanAccessContext,
  permission: string,
  item: Pick<KnowledgeItem, "companyId" | "departmentId">,
): boolean {
  if (item.companyId === null) return can(access, "knowledge.global.manage", null);
  return (
    can(access, permission, item.companyId) &&
    departmentWriteAllowed(access, item.companyId, item.departmentId)
  );
}

export const knowledgeRoutes: FastifyPluginAsync = async (app) => {
  const { db } = app.deps.db;

  /** IDOR guard: 404 outside the viewer's scope; 403 (audited) when the sensitivity is too high. */
  async function visibleKnowledge(req: FastifyRequest, id: string): Promise<KnowledgeItem> {
    const item = await getKnowledgeRecord(db, id);
    const v = visibility(req);
    const inScope = canSeeKnowledge({ ...v, canRead: () => true }, item);
    if (!inScope) throw new NotFoundError("Knowledge item", id);
    if (!v.canRead(item.companyId, item.sensitivity)) {
      await auditSecurityEvent(
        req,
        "security.knowledge_access_denied",
        `Denied ${item.sensitivity} knowledge`,
        {
          companyId: item.companyId ?? undefined,
          resourceType: "knowledge",
          resourceId: item.id,
          metadata: { sensitivity: item.sensitivity },
        },
      );
      throw new ForbiddenError(
        `This knowledge is ${item.sensitivity.toUpperCase()}; you are not cleared to read it`,
      );
    }
    return item;
  }

  async function requireOnKnowledge(
    req: FastifyRequest,
    permission: string,
    item: Pick<KnowledgeItem, "id" | "companyId" | "departmentId">,
    action = "security.unauthorized_access",
  ): Promise<void> {
    if (canOnKnowledge(principalOf(req).access, permission, item)) return;
    await auditSecurityEvent(
      req,
      action,
      `Denied ${item.companyId === null ? "knowledge.global.manage" : permission}`,
      {
        companyId: item.companyId ?? undefined,
        resourceType: "knowledge",
        resourceId: item.id,
        metadata: { permission },
      },
    );
    throw new ForbiddenError(
      item.companyId === null
        ? "Only platform or group administrators can manage GLOBAL knowledge"
        : `Missing permission: ${permission}`,
    );
  }

  async function visibleAgent(req: FastifyRequest, id: string): Promise<AgentDTO> {
    const [agent] = await listAgents(db, { ids: [id], scope: scopeFor(req, "agent.view") });
    if (!agent) throw new NotFoundError("Agent", id);
    return agent;
  }

  function canManageAgent(req: FastifyRequest, agent: AgentDTO, permission: string): boolean {
    const access = principalOf(req).access;
    if (can(access, permission, null)) return true;
    if (agent.scope === "global") return false;
    return (
      agent.companies.length > 0 && agent.companies.every((c) => can(access, permission, c.id))
    );
  }

  async function visibleTask(req: FastifyRequest, id: string) {
    const task = await getTaskRecord(db, id);
    if (!task || !can(principalOf(req).access, "task.view", task.companyId))
      throw new NotFoundError("Task", id);
    return task;
  }

  /* ---------- knowledge library ---------- */

  app.get("/knowledge", async (req): Promise<KnowledgeListDTO> => {
    const q = listKnowledgeQuery.parse(req.query);
    const { company } = await companyScope(req, q.company, "knowledge.view");
    const result = await listKnowledge(db, {
      companyId: company?.id ?? null,
      query: q,
      visibility: visibility(req),
    });
    return {
      data: result.items,
      facets: {
        tags: result.tags,
        categories: result.categories,
        total: result.items.length,
        stale: result.items.filter(
          (i) =>
            i.status === "approved" && (i.freshness === "expired" || i.freshness === "review_due"),
        ).length,
        conflicts: result.items.filter((i) => i.conflictsWith.length > 0).length,
        hiddenBySensitivity: result.hiddenBySensitivity,
      },
    };
  });

  app.get("/knowledge/conflicts", async (req) => {
    const q = z.object({ company: z.string().max(64) }).parse(req.query);
    const { company } = await companyScope(req, q.company, "knowledge.view");
    return { data: await listKnowledgeConflicts(db, company!.id, visibility(req)) };
  });

  app.get("/knowledge/:id", async (req) => {
    const { id } = idParam.parse(req.params);
    const item = await visibleKnowledge(req, id);
    const access = principalOf(req).access;
    const detail = await getKnowledgeDetail(db, id, {
      visibility: visibility(req),
      viewer: {
        canEdit: canOnKnowledge(access, "knowledge.edit", item),
        canApprove: canOnKnowledge(access, "knowledge.approve", item),
        canArchive: canOnKnowledge(access, "knowledge.archive", item),
      },
    });
    // Only show links to tasks/agents the viewer can see (department scope included).
    const taskIds = detail.links.filter((l) => l.target === "task").map((l) => l.targetId);
    const agentIds = detail.links.filter((l) => l.target === "agent").map((l) => l.targetId);
    const [visibleTasks, visibleAgents] = await Promise.all([
      taskIds.length ? listTasks(db, { ids: taskIds, scope: scopeFor(req, "task.view") }) : [],
      agentIds.length ? listAgents(db, { ids: agentIds, scope: scopeFor(req, "agent.view") }) : [],
    ]);
    const seen = new Set([...visibleTasks.map((t) => t.id), ...visibleAgents.map((a) => a.id)]);
    return { data: { ...detail, links: detail.links.filter((l) => seen.has(l.targetId)) } };
  });

  app.post("/knowledge", async (req, reply) => {
    const body = createKnowledgeSchema.parse(req.body);
    const access = principalOf(req).access;
    const target = { id: "new", companyId: body.companyId, departmentId: body.departmentId };
    if (body.companyId) await companyScope(req, body.companyId, "knowledge.create");
    await requireOnKnowledge(req, "knowledge.create", target);
    if (!canReadSensitivity(access, body.companyId, body.sensitivity))
      throw new ForbiddenError(`You cannot create ${body.sensitivity.toUpperCase()} knowledge`);
    const item = await createKnowledge(db, body, actorFrom(req));
    return reply.status(201).send({ data: await getKnowledgeDTO(db, item.id) });
  });

  app.patch("/knowledge/:id", async (req) => {
    const { id } = idParam.parse(req.params);
    const item = await visibleKnowledge(req, id);
    await requireOnKnowledge(req, "knowledge.edit", item);
    const { data, material } = knowledgeChanges(item, req.body as never);
    const access = principalOf(req).access;
    // Changing an approved fact in place (no new version) is an authority decision.
    if (item.status === "approved" && !material)
      await requireOnKnowledge(
        req,
        "knowledge.approve",
        item,
        "security.knowledge_approval_denied",
      );
    if (
      data.sensitivity &&
      !canReadSensitivity(access, item.companyId, data.sensitivity as SensitivityLevel)
    )
      throw new ForbiddenError("You cannot classify knowledge above your own clearance");
    if (
      data.departmentId !== undefined &&
      !departmentWriteAllowed(access, item.companyId, data.departmentId as string | null)
    )
      throw new ForbiddenError("You can only file knowledge in your own departments");
    const result = await updateKnowledge(db, id, req.body as never, actorFrom(req));
    return { data: await getKnowledgeDTO(db, result.item.id), newVersion: result.newVersion };
  });

  app.post("/knowledge/:id/submit", async (req) => {
    const { id } = idParam.parse(req.params);
    const item = await visibleKnowledge(req, id);
    const access = principalOf(req).access;
    const own =
      item.createdByUserId === principalOf(req).user.id &&
      canOnKnowledge(access, "knowledge.create", item);
    if (!own) await requireOnKnowledge(req, "knowledge.edit", item);
    await submitKnowledge(db, id, actorFrom(req));
    return { data: await getKnowledgeDTO(db, id) };
  });

  app.post("/knowledge/:id/approve", async (req) => {
    const { id } = idParam.parse(req.params);
    const body = knowledgeApproveSchema.parse(req.body ?? {});
    const item = await visibleKnowledge(req, id);
    await requireOnKnowledge(req, "knowledge.approve", item, "security.knowledge_approval_denied");
    await approveKnowledge(db, id, body, actorFrom(req));
    return { data: await getKnowledgeDTO(db, id) };
  });

  app.post("/knowledge/:id/reject", async (req) => {
    const { id } = idParam.parse(req.params);
    const body = knowledgeNotesSchema.parse(req.body ?? {});
    const item = await visibleKnowledge(req, id);
    await requireOnKnowledge(req, "knowledge.approve", item, "security.knowledge_approval_denied");
    await rejectKnowledge(db, id, body.notes, actorFrom(req));
    return { data: await getKnowledgeDTO(db, id) };
  });

  app.post("/knowledge/:id/supersede", async (req) => {
    const { id } = idParam.parse(req.params);
    const body = knowledgeSupersedeSchema.parse(req.body ?? {});
    const item = await visibleKnowledge(req, id);
    await requireOnKnowledge(req, "knowledge.approve", item, "security.knowledge_approval_denied");
    if (body.replacementId) await visibleKnowledge(req, body.replacementId);
    await supersedeKnowledge(db, id, body.replacementId, body.notes, actorFrom(req));
    return { data: await getKnowledgeDTO(db, id) };
  });

  app.post("/knowledge/:id/archive", async (req) => {
    const { id } = idParam.parse(req.params);
    const body = knowledgeNotesSchema.parse(req.body ?? {});
    const item = await visibleKnowledge(req, id);
    await requireOnKnowledge(req, "knowledge.archive", item);
    await archiveKnowledge(db, id, body.notes, actorFrom(req));
    return { data: await getKnowledgeDTO(db, id) };
  });

  app.post("/knowledge/:id/links", async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const body = knowledgeLinkSchema.parse(req.body);
    const item = await visibleKnowledge(req, id);
    await requireOnKnowledge(req, "knowledge.edit", item);
    if (body.taskId) await visibleTask(req, body.taskId);
    if (body.agentId) await visibleAgent(req, body.agentId);
    return reply.status(201).send({ data: await linkKnowledge(db, id, body, actorFrom(req)) });
  });

  app.delete("/knowledge/:id/links/:linkId", async (req, reply) => {
    const { id, linkId } = z.object({ id: uuidSchema, linkId: uuidSchema }).parse(req.params);
    const item = await visibleKnowledge(req, id);
    await requireOnKnowledge(req, "knowledge.edit", item);
    await unlinkKnowledge(db, id, linkId, actorFrom(req));
    return reply.status(204).send();
  });

  /* ---------- company profile ---------- */

  app.get("/companies/:ref/profile", async (req): Promise<{ data: CompanyProfileDTO }> => {
    const { ref } = refParam.parse(req.params);
    const { company } = await companyScope(req, ref, "company.view");
    const access = principalOf(req).access;
    const c = company!.id;
    return {
      data: await getCompanyProfile(db, c, {
        canEdit: can(access, "company.edit", c),
        canManagePolicy: can(access, "policy.manage", c),
        canApprovePolicy: can(access, "policy.approve", c),
        canManageSettings: can(access, "company.settings.manage", c),
        canCreateKnowledge: can(access, "knowledge.create", c),
        canApproveKnowledge: can(access, "knowledge.approve", c),
        canManageAgentAccess: can(access, "agent.permissions.manage", c),
        canPreviewContext: can(access, "context.preview", c),
      }),
    };
  });

  app.put("/companies/:ref/profile/:section", async (req) => {
    const { ref, section } = z
      .object({ ref: z.string().min(1).max(64), section: z.enum(PROFILE_SECTIONS) })
      .parse(req.params);
    const { company } = await companyScope(req, ref, PROFILE_SECTION_PERMISSION[section]);
    await updateCompanyProfileSection(db, company!.id, section, req.body as never, actorFrom(req));
    return { ok: true };
  });

  app.put("/companies/:ref/ai-policy", async (req) => {
    const { ref } = refParam.parse(req.params);
    const { company } = await companyScope(req, ref, "company.settings.manage");
    const body = aiPolicySchema.parse(req.body);
    return { data: await updateAiPolicy(db, company!.id, body, actorFrom(req)) };
  });

  app.get("/companies/:ref/history", async (req) => {
    const { ref } = refParam.parse(req.params);
    const q = z
      .object({ limit: z.coerce.number().int().min(1).max(200).default(100) })
      .parse(req.query);
    const { company } = await companyScope(req, ref, "company.view");
    return { data: await listCompanyHistory(db, company!.id, q.limit) };
  });

  /* ---------- rules ---------- */

  app.get("/companies/:ref/rules", async (req) => {
    const { ref } = refParam.parse(req.params);
    const q = z.object({ archived: z.enum(["true", "false"]).optional() }).parse(req.query);
    const { company } = await companyScope(req, ref, "knowledge.view");
    return {
      data: await listCompanyRules(db, company!.id, { includeArchived: q.archived === "true" }),
    };
  });

  app.post("/companies/:ref/rules/:kind", async (req, reply) => {
    const { ref, kind } = z
      .object({ ref: z.string().min(1).max(64), kind: z.enum(RULE_KINDS) })
      .parse(req.params);
    const { company } = await companyScope(req, ref, "policy.manage");
    const { approve, ...rule } = z
      .object({ approve: z.boolean().default(false) })
      .loose()
      .parse(req.body);
    const access = principalOf(req).access;
    if (approve && !can(access, "policy.approve", company!.id))
      throw new ForbiddenError("Missing permission: policy.approve");
    return reply
      .status(201)
      .send({ data: await createRule(db, kind, company!.id, rule, actorFrom(req), { approve }) });
  });

  async function ruleForWrite(
    req: FastifyRequest,
    kind: (typeof RULE_KINDS)[number],
    id: string,
    permission: string,
  ) {
    const rule = await getRuleRecord(db, kind, id);
    const access = principalOf(req).access;
    if (rule.companyId === null) {
      if (!can(access, "knowledge.global.manage", null))
        throw new ForbiddenError("Global rules are managed by platform administrators");
      return rule;
    }
    if (!can(access, "knowledge.view", rule.companyId)) throw new NotFoundError("Rule", id);
    if (!can(access, permission, rule.companyId)) {
      await auditSecurityEvent(
        req,
        "security.unauthorized_access",
        `Denied ${permission} on a ${kind} rule`,
        {
          companyId: rule.companyId,
          resourceType: `${kind}_rule`,
          resourceId: id,
          metadata: { permission },
        },
      );
      throw new ForbiddenError(`Missing permission: ${permission}`);
    }
    return rule;
  }

  app.patch("/rules/:kind/:id", async (req) => {
    const { kind, id } = z.object({ kind: z.enum(RULE_KINDS), id: uuidSchema }).parse(req.params);
    const rule = await ruleForWrite(req, kind, id, "policy.manage");
    const patch = ruleUpdateSchema.parse(req.body);
    const canApprove =
      rule.companyId === null
        ? can(principalOf(req).access, "knowledge.global.manage", null)
        : can(principalOf(req).access, "policy.approve", rule.companyId);
    return { data: await updateRule(db, kind, id, patch, actorFrom(req), { canApprove }) };
  });

  app.post("/rules/:kind/:id/:action", async (req) => {
    const { kind, id, action } = z
      .object({ kind: z.enum(RULE_KINDS), id: uuidSchema, action: z.enum(RULE_ACTIONS) })
      .parse(req.params);
    await ruleForWrite(req, kind, id, action === "approve" ? "policy.approve" : "policy.manage");
    return { data: await ruleLifecycle(db, kind, id, action, actorFrom(req)) };
  });

  /* ---------- agent knowledge access & profiles ---------- */

  app.get("/companies/:ref/knowledge-access", async (req) => {
    const { ref } = refParam.parse(req.params);
    const { company } = await companyScope(req, ref, "agent.view");
    return { data: await listKnowledgeAccessPolicies(db, company!.id) };
  });

  app.post("/companies/:ref/knowledge-access", async (req, reply) => {
    const { ref } = refParam.parse(req.params);
    const { company } = await companyScope(req, ref, "agent.permissions.manage");
    const body = knowledgeAccessPolicySchema.parse(req.body);
    // No escalation: you cannot grant agents access above your own clearance.
    if (!canReadSensitivity(principalOf(req).access, company!.id, body.maxSensitivity))
      throw new ForbiddenError(`You cannot grant ${body.maxSensitivity.toUpperCase()} access`);
    if (body.agentId) await visibleAgent(req, body.agentId);
    await createKnowledgeAccessPolicy(db, company!.id, body, actorFrom(req));
    return reply.status(201).send({ data: await listKnowledgeAccessPolicies(db, company!.id) });
  });

  app.delete("/companies/:ref/knowledge-access/:id", async (req, reply) => {
    const { ref, id } = z
      .object({ ref: z.string().min(1).max(64), id: uuidSchema })
      .parse(req.params);
    const { company } = await companyScope(req, ref, "agent.permissions.manage");
    await deleteKnowledgeAccessPolicy(db, company!.id, id, actorFrom(req));
    return reply.status(204).send();
  });

  app.get("/agents/:id/knowledge-profile", async (req) => {
    const { id } = idParam.parse(req.params);
    await visibleAgent(req, id);
    return { data: await getAgentKnowledgeProfile(db, id) };
  });

  app.put("/agents/:id/knowledge-profile", async (req) => {
    const { id } = idParam.parse(req.params);
    const agent = await visibleAgent(req, id);
    if (!canManageAgent(req, agent, "agent.edit")) throw new ForbiddenError();
    const body = z.object({ profile: agentKnowledgeProfileSchema.nullable() }).parse(req.body);
    return { data: await setAgentKnowledgeProfile(db, id, body.profile, actorFrom(req)) };
  });

  /* ---------- context preview ---------- */

  /** Redacts knowledge the viewer is not cleared to read (the agent may be). */
  async function redactForViewer(
    req: FastifyRequest,
    pack: AgentContextPack,
  ): Promise<{ pack: AgentContextPack; redacted: number }> {
    const ids = [
      ...pack.knowledge,
      ...pack.unverified,
      ...pack.excluded.filter((e) => e.kind === "knowledge"),
    ].map((e) => e.id);
    if (!ids.length) return { pack, redacted: 0 };
    const rows = await knowledgeSensitivities(db, ids);
    const access = principalOf(req).access;
    const hidden = new Set(
      rows.filter((r) => !canReadSensitivity(access, r.companyId, r.sensitivity)).map((r) => r.id),
    );
    const redactEntry = <
      T extends { id: string; title: string; snippet: string; reasonDetails: string[] },
    >(
      e: T,
    ): T =>
      hidden.has(e.id)
        ? {
            ...e,
            title: "Restricted knowledge item",
            snippet: "Hidden — you are not cleared for this sensitivity.",
            reasonDetails: [],
            redacted: true,
          }
        : e;
    return {
      redacted: hidden.size,
      pack: {
        ...pack,
        knowledge: pack.knowledge.map(redactEntry),
        unverified: pack.unverified.map(redactEntry),
        excluded: pack.excluded.map((e) => (hidden.has(e.id) ? { ...e, title: null } : e)),
      },
    };
  }

  async function preview(
    req: FastifyRequest,
    input: { companyId: string; agentId: string; taskId: string | null },
    q: z.output<typeof contextPreviewQuery>,
  ) {
    const pack = await buildContextPack(db, {
      companyId: input.companyId,
      agentId: input.agentId,
      taskId: input.taskId,
      budget: q.budget,
      maxChars: q.maxChars,
      capability: q.capability,
      categories: q.categories,
    });
    await recordAuditEvent(db, {
      ...actorAuditFields(actorFrom(req)),
      companyId: input.companyId,
      agentId: input.agentId,
      taskId: input.taskId ?? undefined,
      resourceType: "context_pack",
      resourceId: input.taskId ?? input.agentId,
      action: "context.preview_generated",
      description: "Agent context preview generated",
      metadata: {
        budget: q.budget,
        approxChars: pack.metadata.approxChars,
        included: pack.metadata.includedKnowledgeIds.length,
        excluded: pack.metadata.excludedCount,
      },
    });
    const { pack: safe, redacted } = await redactForViewer(req, pack);
    return { data: safe, redactedForViewer: redacted };
  }

  app.get("/agents/:id/context", async (req) => {
    const { id } = idParam.parse(req.params);
    const q = contextPreviewQuery.parse(req.query);
    const agent = await visibleAgent(req, id);
    const access = principalOf(req).access;
    let ref = q.company;
    if (!ref) {
      const candidates = [...agent.companies].sort(
        (a, b) => Number(b.isPrimary) - Number(a.isPrimary),
      );
      ref = candidates.find((c) => can(access, "context.preview", c.id))?.slug;
      if (!ref) throw new ForbiddenError("Choose a company you can preview context for");
    }
    const { company } = await companyScope(req, ref, "context.preview");
    let taskId: string | null = null;
    if (q.task) {
      const task = await visibleTask(req, q.task);
      if (task.companyId !== company!.id)
        throw new ForbiddenError("The task belongs to a different company");
      taskId = task.id;
    }
    return preview(req, { companyId: company!.id, agentId: agent.id, taskId }, q);
  });

  app.get("/tasks/:id/context", async (req) => {
    const { id } = idParam.parse(req.params);
    const q = contextPreviewQuery.parse(req.query);
    const task = await visibleTask(req, id);
    if (!task.companyId)
      throw new ForbiddenError("Group-level tasks have no single company context");
    const { company } = await companyScope(req, task.companyId, "context.preview");
    const agentId = q.agent ?? task.assignedAgentId;
    if (!agentId) throw new NotFoundError("Assigned agent", id);
    await visibleAgent(req, agentId);
    return preview(req, { companyId: company!.id, agentId, taskId: task.id }, q);
  });
};
