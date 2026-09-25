import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { z } from "zod";
import { can, companiesWith, type HumanAccessContext } from "@aibos/access-core";
import { GLOBAL_OPERATING_POLICY, PLATFORM_SAFETY_RULES } from "@aibos/agent-core";
import {
  ForbiddenError,
  NotFoundError,
  assignTask,
  canSeeKnowledge,
  getKnowledgeRecord,
  compileInstructionsFor,
  createConversation,
  createHandoff,
  createTeam,
  createTemporaryAgent,
  createWorkforceTask,
  delegateTask,
  getAgentRole,
  getDepartmentRecord,
  getOwnConversation,
  getRoleTemplateRecord,
  getTaskDetail,
  getTaskRecord,
  getTeamDetail,
  getTeamRecord,
  getWorkforcePolicy,
  listAgentMessages,
  listAgents,
  listConversationMessages,
  listConversations,
  listDepartmentDetails,
  listHandoffs,
  listRoleTemplates,
  listTasks,
  listTeams,
  managerStats,
  organisationChart,
  previewDelegation,
  recordAuditEvent,
  actorAuditFields,
  saveAgentRole,
  sendAgentMessage,
  setAgentCapabilities,
  setAgentHierarchy,
  setTaskStatus,
  setTeamMembers,
  terminateTemporaryAgent,
  transitionHandoff,
  updateDepartment,
  updateRoleTemplate,
  updateTaskRequirements,
  updateTeam,
  updateWorkforcePolicy,
  type AccessScope,
  type Task,
} from "@aibos/db";
import {
  HANDOFF_ACTIONS,
  HANDOFF_STATUSES,
  SENSITIVITY_READ_PERMISSION,
  agentCapabilitiesSchema,
  agentHierarchySchema,
  assignTaskSchema,
  companyScopeQuery,
  createAgentMessageSchema,
  createConversationSchema,
  createHandoffSchema,
  createTeamSchema,
  createWorkforceTaskSchema,
  delegateTaskSchema,
  departmentUpdateSchema,
  handoffActionSchema,
  instructionPreviewQuery,
  roleTemplateUpdateSchema,
  saveAgentRoleSchema,
  taskRequirementsSchema,
  teamMembersSchema,
  temporaryAgentSchema,
  updateTeamSchema,
  uuidSchema,
  workforcePolicySchema,
  type AgentDTO,
  type SensitivityLevel,
  type TaskDetailDTO,
} from "@aibos/shared";
import { actorFrom, auditSecurityEvent, companyScope, principalOf, scopeFor } from "./security";

const idParam = z.object({ id: uuidSchema });
const optionalReason = z.strictObject({ reason: z.string().trim().max(500).optional() });

function holdsAnywhere(access: HumanAccessContext, permission: string): boolean {
  const ids = companiesWith(access, permission);
  return ids === "all" || ids.length > 0;
}

/** A company-bound resource: permission in that company; group-level (null) resources need global permission. */
function canOn(access: HumanAccessContext, permission: string, companyId: string | null): boolean {
  return can(access, permission, companyId);
}

/**
 * Department-restricted members (e.g. Department Managers) may only act on
 * work inside their departments.
 */
function departmentAllowed(
  access: HumanAccessContext,
  companyId: string | null,
  departmentId: string | null,
): boolean {
  if (!companyId || access.global.size) return true;
  const restricted = access.departments.get(companyId);
  if (!restricted) return true;
  return departmentId !== null && restricted.includes(departmentId);
}

export const workforceRoutes: FastifyPluginAsync = async (app) => {
  const { db } = app.deps.db;

  async function deny(
    req: FastifyRequest,
    description: string,
    meta: { resourceType: string; resourceId?: string; companyId?: string | null },
  ) {
    await auditSecurityEvent(req, "security.unauthorized_access", description, {
      resourceType: meta.resourceType,
      resourceId: meta.resourceId,
      companyId: meta.companyId ?? undefined,
    });
    return new ForbiddenError();
  }

  /** IDOR guard: the agent must be visible under agent.view. */
  async function visibleAgent(req: FastifyRequest, id: string): Promise<AgentDTO> {
    const [agent] = await listAgents(db, { ids: [id], scope: scopeFor(req, "agent.view") });
    if (!agent) throw new NotFoundError("Agent", id);
    return agent;
  }

  /** Editing an agent needs the permission in every company the agent operates in. */
  function canManageAgent(req: FastifyRequest, agent: AgentDTO, permission: string): boolean {
    const access = principalOf(req).access;
    if (can(access, permission, null)) return true;
    if (agent.scope === "global") return false;
    return (
      agent.companies.length > 0 && agent.companies.every((c) => can(access, permission, c.id))
    );
  }

  function canViewAgentRole(req: FastifyRequest, agent: AgentDTO): boolean {
    const access = principalOf(req).access;
    if (can(access, "agent.role.view", null)) return true;
    if (agent.scope === "global") return holdsAnywhere(access, "agent.role.view");
    return agent.companies.some((c) => can(access, "agent.role.view", c.id));
  }

  /** IDOR guard for tasks: visible under task.view (department restrictions included). */
  async function visibleTask(req: FastifyRequest, id: string): Promise<Task> {
    const [dto] = await listTasks(db, { ids: [id], scope: scopeFor(req, "task.view") });
    if (!dto) throw new NotFoundError("Task", id);
    const task = await getTaskRecord(db, id);
    if (!task) throw new NotFoundError("Task", id);
    return task;
  }

  async function requireTaskPermission(
    req: FastifyRequest,
    task: Task,
    permission: string,
  ): Promise<void> {
    const access = principalOf(req).access;
    if (
      canOn(access, permission, task.companyId) &&
      departmentAllowed(access, task.companyId, task.departmentId)
    )
      return;
    throw await deny(req, `Denied ${permission} on task`, {
      resourceType: "task",
      resourceId: task.id,
      companyId: task.companyId,
    });
  }

  function taskViewer(req: FastifyRequest, task: Task): TaskDetailDTO["viewer"] {
    const access = principalOf(req).access;
    const ok = (p: string) =>
      canOn(access, p, task.companyId) &&
      departmentAllowed(access, task.companyId, task.departmentId);
    return {
      canAssign: ok("task.assign"),
      canDelegate: ok("agent.delegation.manage"),
      canPause: ok("task.pause"),
      canManageHandoffs: ok("handoff.manage"),
      canCreateTemporary: ok("agent.create"),
    };
  }

  function readKnowledge(req: FastifyRequest) {
    const access = principalOf(req).access;
    return (companyId: string | null, sensitivity: SensitivityLevel) => {
      const permission = SENSITIVITY_READ_PERMISSION[sensitivity];
      if (!permission) return true;
      return companyId === null
        ? holdsAnywhere(access, permission)
        : can(access, permission, companyId);
    };
  }

  /* ---------- operating policy ---------- */

  app.get("/operating-policy", async (req) => {
    if (!holdsAnywhere(principalOf(req).access, "agent.role.view")) throw new ForbiddenError();
    return {
      data: {
        platform: PLATFORM_SAFETY_RULES,
        global: GLOBAL_OPERATING_POLICY,
        workforce: await getWorkforcePolicy(db),
      },
    };
  });

  app.get("/workforce/policy", async (req) => {
    if (!holdsAnywhere(principalOf(req).access, "agent.view")) throw new ForbiddenError();
    return { data: await getWorkforcePolicy(db) };
  });

  app.put("/workforce/policy", async (req) => {
    if (!can(principalOf(req).access, "system.manage", null))
      throw await deny(req, "Denied workforce policy change", { resourceType: "workforce_policy" });
    const body = workforcePolicySchema.parse(req.body);
    return { data: await updateWorkforcePolicy(db, body, actorFrom(req)) };
  });

  /* ---------- departments, teams, organisation ---------- */

  app.get("/workforce/departments", async (req) => {
    const q = companyScopeQuery.parse(req.query);
    const { company, scope } = await companyScope(req, q.company, "team.view");
    return { data: await listDepartmentDetails(db, { companyId: company?.id, scope }) };
  });

  app.patch("/departments/:id", async (req) => {
    const { id } = idParam.parse(req.params);
    const body = departmentUpdateSchema.parse(req.body);
    const dept = await getDepartmentRecord(db, id);
    const access = principalOf(req).access;
    // Global departments are shared by every company: only platform-level team managers edit them.
    if (!can(access, "team.manage", dept.companyId)) {
      if (dept.companyId && !can(access, "team.view", dept.companyId))
        throw new NotFoundError("Department", id);
      throw await deny(req, "Denied department change", {
        resourceType: "department",
        resourceId: id,
        companyId: dept.companyId,
      });
    }
    await updateDepartment(db, id, body, actorFrom(req));
    const [dto] = await listDepartmentDetails(db, { scope: scopeFor(req, "team.view") }).then((l) =>
      l.filter((d) => d.id === id),
    );
    return { data: dto };
  });

  app.get("/teams", async (req) => {
    const q = companyScopeQuery.parse(req.query);
    const { company, scope } = await companyScope(req, q.company, "team.view");
    return { data: await listTeams(db, { companyId: company?.id, scope }) };
  });

  app.get("/teams/:id", async (req) => {
    const { id } = idParam.parse(req.params);
    const team = await getTeamRecord(db, id).catch(() => null);
    const access = principalOf(req).access;
    return {
      data: await getTeamDetail(db, id, {
        scope: scopeFor(req, "team.view"),
        taskScope: scopeFor(req, "task.view"),
        viewerCanManage: !!team && can(access, "team.manage", team.companyId),
      }),
    };
  });

  app.post("/teams", async (req, reply) => {
    const body = createTeamSchema.parse(req.body);
    if (!can(principalOf(req).access, "team.manage", body.companyId))
      throw await deny(
        req,
        body.companyId ? "Denied team creation" : "Denied global team creation",
        {
          resourceType: "team",
          companyId: body.companyId,
        },
      );
    const team = await createTeam(db, body, actorFrom(req));
    return reply.status(201).send({ data: (await listTeams(db, { ids: [team.id] }))[0] });
  });

  async function managedTeam(req: FastifyRequest, id: string) {
    const [visible] = await listTeams(db, { ids: [id], scope: scopeFor(req, "team.view") });
    if (!visible) throw new NotFoundError("Team", id);
    const team = await getTeamRecord(db, id);
    if (!can(principalOf(req).access, "team.manage", team.companyId))
      throw await deny(req, "Denied team change", {
        resourceType: "team",
        resourceId: id,
        companyId: team.companyId,
      });
    return team;
  }

  app.patch("/teams/:id", async (req) => {
    const { id } = idParam.parse(req.params);
    const body = updateTeamSchema.parse(req.body);
    await managedTeam(req, id);
    await updateTeam(db, id, body, actorFrom(req));
    return { data: (await listTeams(db, { ids: [id] }))[0] };
  });

  app.put("/teams/:id/members", async (req) => {
    const { id } = idParam.parse(req.params);
    const body = teamMembersSchema.parse(req.body);
    await managedTeam(req, id);
    await setTeamMembers(db, id, body, actorFrom(req));
    return { data: (await listTeams(db, { ids: [id] }))[0] };
  });

  app.get("/workforce/org", async (req) => {
    const q = companyScopeQuery.parse(req.query);
    const { company, scope: teamScope } = await companyScope(req, q.company, "team.view");
    // Only companies where the viewer may see both teams and agents.
    const agentScope = scopeFor(req, "agent.view");
    const scope: AccessScope =
      teamScope.companyIds === "all"
        ? agentScope
        : agentScope.companyIds === "all"
          ? teamScope
          : {
              companyIds: teamScope.companyIds.filter((c) =>
                (agentScope.companyIds as string[]).includes(c),
              ),
              includeGroup: teamScope.includeGroup && agentScope.includeGroup,
              departments: agentScope.departments,
            };
    return { data: await organisationChart(db, { scope, companyId: company?.id ?? null }) };
  });

  app.get("/workforce/manager-stats", async (req) => {
    const q = companyScopeQuery.parse(req.query);
    const { company, scope } = await companyScope(req, q.company, "task.view");
    return { data: await managerStats(db, { scope, companyId: company?.id ?? null }) };
  });

  /* ---------- agent roles, instructions, hierarchy ---------- */

  app.get("/agents/:id/role", async (req) => {
    const { id } = idParam.parse(req.params);
    const agent = await visibleAgent(req, id);
    if (!canViewAgentRole(req, agent)) throw new ForbiddenError();
    return {
      data: await getAgentRole(db, id, {
        viewerCanManage: canManageAgent(req, agent, "agent.role.manage"),
      }),
    };
  });

  app.put("/agents/:id/role", async (req) => {
    const { id } = idParam.parse(req.params);
    const body = saveAgentRoleSchema.parse(req.body);
    const agent = await visibleAgent(req, id);
    if (!canManageAgent(req, agent, "agent.role.manage")) {
      await auditSecurityEvent(
        req,
        "security.privilege_change_denied",
        "Denied agent role change",
        { resourceType: "agent", resourceId: id },
      );
      throw new ForbiddenError();
    }
    const result = await saveAgentRole(db, id, body, actorFrom(req));
    return { data: { ...result, role: await getAgentRole(db, id, { viewerCanManage: true }) } };
  });

  app.get("/agents/:id/instructions", async (req) => {
    const { id } = idParam.parse(req.params);
    const q = instructionPreviewQuery.parse(req.query);
    const agent = await visibleAgent(req, id);
    const ref = q.company ?? (agent.companies.length === 1 ? agent.companies[0]!.id : undefined);
    if (!ref) throw new ForbiddenError("Choose a company for the instruction preview");
    const { company } = await companyScope(req, ref, "agent.role.view");
    if (!company) throw new ForbiddenError("Choose a company for the instruction preview");
    if (q.task) {
      const task = await visibleTask(req, q.task);
      if (task.companyId !== company.id) throw new NotFoundError("Task", q.task);
    }
    const pack = await compileInstructionsFor(
      db,
      { agentId: id, companyId: company.id, taskId: q.task ?? null },
      { withContext: true },
    );
    await recordAuditEvent(db, {
      ...actorAuditFields(actorFrom(req)),
      companyId: company.id,
      agentId: id,
      taskId: q.task,
      resourceType: "agent",
      resourceId: id,
      action: "instruction.preview_generated",
      description: `Instruction preview generated for ${agent.name}`,
      metadata: { ruleCount: pack.metadata.ruleCount, conflicts: pack.conflicts.length },
    });
    return { data: pack };
  });

  app.put("/agents/:id/hierarchy", async (req) => {
    const { id } = idParam.parse(req.params);
    const body = agentHierarchySchema.parse(req.body);
    const agent = await visibleAgent(req, id);
    if (!canManageAgent(req, agent, "agent.edit")) {
      await auditSecurityEvent(
        req,
        "security.privilege_change_denied",
        "Denied reporting-line change",
        { resourceType: "agent", resourceId: id },
      );
      throw new ForbiddenError();
    }
    // Every referenced manager must be visible to the editor too.
    for (const ref of Object.values(body)) if (ref) await visibleAgent(req, ref);
    await setAgentHierarchy(db, id, body, actorFrom(req));
    return { data: await visibleAgent(req, id) };
  });

  app.put("/agents/:id/capabilities", async (req) => {
    const { id } = idParam.parse(req.params);
    const body = agentCapabilitiesSchema.parse(req.body);
    const agent = await visibleAgent(req, id);
    if (!canManageAgent(req, agent, "agent.role.manage")) {
      await auditSecurityEvent(
        req,
        "security.privilege_change_denied",
        "Denied capability change",
        { resourceType: "agent", resourceId: id },
      );
      throw new ForbiddenError();
    }
    await setAgentCapabilities(db, id, body, actorFrom(req));
    return { data: await visibleAgent(req, id) };
  });

  app.get("/role-templates", async (req) => {
    const q = companyScopeQuery.parse(req.query);
    const { company, scope } = await companyScope(req, q.company, "agent.role.view");
    return { data: await listRoleTemplates(db, { scope, companyId: company?.id }) };
  });

  app.put("/role-templates/:id", async (req) => {
    const { id } = idParam.parse(req.params);
    const body = roleTemplateUpdateSchema.parse(req.body);
    const rt = await getRoleTemplateRecord(db, id);
    const access = principalOf(req).access;
    if (!can(access, "agent.role.manage", rt.companyId)) {
      if (rt.companyId && !can(access, "agent.role.view", rt.companyId))
        throw new NotFoundError("Role template", id);
      await auditSecurityEvent(
        req,
        "security.privilege_change_denied",
        "Denied role template change",
        {
          resourceType: "role_template",
          resourceId: id,
          ...(rt.companyId ? { companyId: rt.companyId } : {}),
        },
      );
      throw new ForbiddenError();
    }
    await updateRoleTemplate(db, id, body, actorFrom(req));
    return { data: (await listRoleTemplates(db, {})).find((t) => t.id === id) };
  });

  /* ---------- temporary agents ---------- */

  app.post("/agents/temporary", async (req, reply) => {
    const body = temporaryAgentSchema.parse(req.body);
    const access = principalOf(req).access;
    if (!can(access, "agent.create", body.companyId))
      throw await deny(req, "Denied temporary worker creation", {
        resourceType: "agent",
        companyId: body.companyId,
      });
    await visibleAgent(req, body.parentAgentId);
    const task = await visibleTask(req, body.taskId);
    if (task.companyId !== body.companyId) throw new NotFoundError("Task", body.taskId);
    // Only platform-level people may let a worker create further workers.
    if (body.maySpawnTemporary && !can(access, "agent.permissions.manage", null))
      throw await deny(req, "Denied recursive temporary workers", {
        resourceType: "agent",
        companyId: body.companyId,
      });
    const result = await createTemporaryAgent(db, body, { kind: "human", actor: actorFrom(req) });
    if (result.status !== "created") return reply.status(202).send({ data: result });
    return reply.status(201).send({ data: await visibleAgent(req, result.agent.id) });
  });

  app.post("/agents/:id/terminate", async (req) => {
    const { id } = idParam.parse(req.params);
    const body = optionalReason.parse(req.body ?? {});
    const agent = await visibleAgent(req, id);
    if (!canManageAgent(req, agent, "agent.edit"))
      throw await deny(req, "Denied agent termination", { resourceType: "agent", resourceId: id });
    await terminateTemporaryAgent(db, id, actorFrom(req), body.reason);
    return { data: await visibleAgent(req, id) };
  });

  /* ---------- tasks, delegation, assignment ---------- */

  app.post("/tasks", async (req, reply) => {
    const body = createWorkforceTaskSchema.parse(req.body);
    const access = principalOf(req).access;
    if (!can(access, "task.create", body.companyId))
      throw await deny(req, "Denied task creation", {
        resourceType: "task",
        companyId: body.companyId,
      });
    if (body.parentTaskId) {
      const parent = await visibleTask(req, body.parentTaskId);
      if (parent.companyId !== body.companyId) throw new NotFoundError("Task", body.parentTaskId);
    }
    const result = await createWorkforceTask(db, body, actorFrom(req));
    return reply.status(result.task ? 201 : 200).send({ data: result });
  });

  app.get("/tasks/:id/detail", async (req) => {
    const { id } = idParam.parse(req.params);
    const task = await visibleTask(req, id);
    return {
      data: await getTaskDetail(db, id, {
        scope: scopeFor(req, "task.view"),
        viewer: taskViewer(req, task),
      }),
    };
  });

  app.put("/tasks/:id/requirements", async (req) => {
    const { id } = idParam.parse(req.params);
    const body = taskRequirementsSchema.parse(req.body);
    const task = await visibleTask(req, id);
    await requireTaskPermission(req, task, "task.assign");
    await updateTaskRequirements(db, id, body, actorFrom(req));
    return {
      data: await getTaskDetail(db, id, {
        scope: scopeFor(req, "task.view"),
        viewer: taskViewer(req, task),
      }),
    };
  });

  app.get("/tasks/:id/delegation", async (req) => {
    const { id } = idParam.parse(req.params);
    const task = await visibleTask(req, id);
    // Candidate lists reveal agents: the viewer must also see the company's agents.
    if (!task.companyId || !can(principalOf(req).access, "agent.view", task.companyId))
      throw new ForbiddenError();
    const q = z.object({ agent: uuidSchema.optional() }).parse(req.query);
    if (q.agent) await visibleAgent(req, q.agent);
    const decision = await previewDelegation(db, id, { requestingAgentId: q.agent });
    // Department-restricted viewers only see candidates they may already see.
    const visible = new Set(
      (await listAgents(db, { companyId: task.companyId, scope: scopeFor(req, "agent.view") })).map(
        (a) => a.id,
      ),
    );
    return {
      data: { ...decision, candidates: decision.candidates.filter((c) => visible.has(c.agentId)) },
    };
  });

  app.post("/tasks/:id/delegate", async (req) => {
    const { id } = idParam.parse(req.params);
    const body = delegateTaskSchema.parse(req.body);
    const task = await visibleTask(req, id);
    await requireTaskPermission(req, task, "agent.delegation.manage");
    for (const ref of [body.targetAgentId, body.requestingAgentId])
      if (ref) await visibleAgent(req, ref);
    const result = await delegateTask(db, id, body, actorFrom(req));
    return { data: result };
  });

  app.post("/tasks/:id/assign", async (req) => {
    const { id } = idParam.parse(req.params);
    const body = assignTaskSchema.parse(req.body);
    const task = await visibleTask(req, id);
    await requireTaskPermission(req, task, "task.assign");
    const agent = await visibleAgent(req, body.agentId);
    // Department-restricted people cannot move work out of their departments.
    if (!departmentAllowed(principalOf(req).access, task.companyId, agent.department?.id ?? null))
      throw await deny(req, "Denied assignment outside the department", {
        resourceType: "task",
        resourceId: id,
        companyId: task.companyId,
      });
    await assignTask(db, id, body, actorFrom(req));
    return {
      data: await getTaskDetail(db, id, {
        scope: scopeFor(req, "task.view"),
        viewer: taskViewer(req, task),
      }),
    };
  });

  const STATUS_ACTIONS = {
    pause: { status: "paused", permission: "task.pause" },
    resume: { status: "queued", permission: "task.pause" },
    complete: { status: "completed", permission: "task.assign" },
    cancel: { status: "cancelled", permission: "task.cancel" },
  } as const;

  app.post("/tasks/:id/:action", async (req) => {
    const params = z
      .object({ id: uuidSchema, action: z.enum(["pause", "resume", "complete", "cancel"]) })
      .parse(req.params);
    const body = z
      .strictObject({ resultSummary: z.string().trim().max(4000).optional() })
      .parse(req.body ?? {});
    const task = await visibleTask(req, params.id);
    const spec = STATUS_ACTIONS[params.action];
    await requireTaskPermission(req, task, spec.permission);
    await setTaskStatus(db, params.id, spec.status, actorFrom(req), body);
    return {
      data: await getTaskDetail(db, params.id, {
        scope: scopeFor(req, "task.view"),
        viewer: taskViewer(req, task),
      }),
    };
  });

  /* ---------- handoffs & agent messages ---------- */

  app.get("/handoffs", async (req) => {
    const q = companyScopeQuery
      .extend({
        task: uuidSchema.optional(),
        agent: uuidSchema.optional(),
        status: z.enum(HANDOFF_STATUSES).optional(),
      })
      .parse(req.query);
    const { scope } = await companyScope(req, q.company, "handoff.view");
    return {
      data: await listHandoffs(db, {
        scope,
        taskId: q.task,
        agentId: q.agent,
        status: q.status,
        canReadKnowledge: readKnowledge(req),
      }),
    };
  });

  app.post("/handoffs", async (req, reply) => {
    const body = createHandoffSchema.parse(req.body);
    const task = await visibleTask(req, body.taskId);
    await requireTaskPermission(req, task, "handoff.manage");
    await visibleAgent(req, body.sourceAgentId);
    if (body.toAgentId) await visibleAgent(req, body.toAgentId);
    // The creator may only attach evidence they can read themselves.
    if (body.knowledgeIds?.length) {
      const scope = scopeFor(req, "knowledge.view");
      const v = {
        scope,
        includeGlobal: scope.companyIds === "all" || scope.companyIds.length > 0,
        canRead: readKnowledge(req),
      };
      for (const kid of body.knowledgeIds) {
        const item = await getKnowledgeRecord(db, kid).catch(() => null);
        if (!item || !canSeeKnowledge(v, item))
          throw new ForbiddenError("You cannot attach knowledge you cannot read");
      }
    }
    const h = await createHandoff(db, body, actorFrom(req));
    const [dto] = await listHandoffs(db, {
      scope: scopeFor(req, "handoff.view"),
      ids: [h.id],
      canReadKnowledge: readKnowledge(req),
    });
    return reply.status(201).send({ data: dto });
  });

  app.post("/handoffs/:id/:action", async (req) => {
    const params = z.object({ id: uuidSchema, action: z.enum(HANDOFF_ACTIONS) }).parse(req.params);
    const body = handoffActionSchema.parse(req.body ?? {});
    const scope = scopeFor(req, "handoff.view");
    const [visible] = await listHandoffs(db, {
      scope,
      ids: [params.id],
      canReadKnowledge: readKnowledge(req),
    });
    if (!visible) throw new NotFoundError("Handoff", params.id);
    if (!can(principalOf(req).access, "handoff.manage", visible.company.id))
      throw await deny(req, "Denied handoff change", {
        resourceType: "handoff",
        resourceId: params.id,
        companyId: visible.company.id,
      });
    await transitionHandoff(db, params.id, params.action, actorFrom(req), body.note);
    const [dto] = await listHandoffs(db, {
      scope,
      ids: [params.id],
      canReadKnowledge: readKnowledge(req),
    });
    return { data: dto };
  });

  app.get("/agent-messages", async (req) => {
    const q = companyScopeQuery
      .extend({ task: uuidSchema.optional(), agent: uuidSchema.optional() })
      .parse(req.query);
    const { scope } = await companyScope(req, q.company, "handoff.view");
    return { data: await listAgentMessages(db, { scope, taskId: q.task, agentId: q.agent }) };
  });

  app.post("/agent-messages", async (req, reply) => {
    const body = createAgentMessageSchema.parse(req.body);
    if (!body.taskId) throw new ForbiddenError("Messages must reference a task");
    const task = await visibleTask(req, body.taskId);
    await requireTaskPermission(req, task, "handoff.manage");
    if (body.recipientAgentId) await visibleAgent(req, body.recipientAgentId);
    if (body.recipientTeamId) {
      const [team] = await listTeams(db, {
        ids: [body.recipientTeamId],
        scope: scopeFor(req, "team.view"),
      });
      if (!team) throw new NotFoundError("Team", body.recipientTeamId);
    }
    const id = await sendAgentMessage(db, body, actorFrom(req));
    return reply.status(201).send({ data: { id } });
  });

  /* ---------- conversations (shell only — no AI replies in Stage 04) ---------- */

  app.get("/conversations", async (req) => {
    const q = z.object({ agent: uuidSchema.optional() }).parse(req.query);
    const p = principalOf(req);
    return {
      data: await listConversations(db, {
        userId: p.user.id,
        agentId: q.agent,
        scope: scopeFor(req, "conversation.view"),
      }),
    };
  });

  app.post("/conversations", async (req, reply) => {
    const body = createConversationSchema.parse(req.body);
    if (!can(principalOf(req).access, "conversation.create", body.companyId))
      throw await deny(req, "Denied conversation creation", {
        resourceType: "conversation",
        companyId: body.companyId,
      });
    await visibleAgent(req, body.agentId);
    if (body.taskId) {
      const task = await visibleTask(req, body.taskId);
      if (task.companyId !== body.companyId) throw new NotFoundError("Task", body.taskId);
    }
    const id = await createConversation(db, body, actorFrom(req));
    return reply.status(201).send({ data: { id } });
  });

  app.get("/conversations/:id/messages", async (req) => {
    const { id } = idParam.parse(req.params);
    await getOwnConversation(db, id, principalOf(req).user.id);
    return { data: await listConversationMessages(db, id) };
  });
};
