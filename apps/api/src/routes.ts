import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { z } from "zod";
import { can, canDecideApproval, companiesWith } from "@aibos/access-core";
import {
  ForbiddenError,
  NotFoundError,
  agentAuthority,
  expireTemporaryAgents,
  createAgent,
  createCompany,
  dashboardSummary,
  decideApproval,
  getAgent,
  getApprovalRow,
  getTaskTree,
  listAgentTemplates,
  listAgents,
  listApprovals,
  listAuditEvents,
  listCompanies,
  listCompanySummaries,
  listDepartments,
  listIntegrations,
  listTasks,
  narrowScope,
  setAgentAutonomy,
  setAgentCompanies,
  setAgentGrants,
  toCompanyDTO,
  usageSummary,
  type DashboardScopes,
} from "@aibos/db";
import { createMockLiveSession } from "@aibos/browser-core";
import {
  agentAutonomySchema,
  agentGrantsSchema,
  approvalDecisionSchema,
  companyScopeQuery,
  createAgentSchema,
  createCompanySchema,
  listAgentsQuery,
  listApprovalsQuery,
  listAuditQuery,
  listTasksQuery,
  setAgentCompaniesSchema,
  uuidSchema,
  type AgentDTO,
  type ApprovalDTO,
  type LiveSessionDTO,
  type ShellDTO,
} from "@aibos/shared";
import {
  actorFrom,
  auditSecurityEvent,
  companyScope,
  principalOf,
  requirePermission,
  scopeFor,
} from "./security";

const idParam = z.object({ id: uuidSchema });
const refParam = z.object({ ref: z.string().min(1).max(64) });

export const registerRoutes: FastifyPluginAsync = async (app) => {
  const { db } = app.deps.db;

  function dashboardScopes(req: FastifyRequest): DashboardScopes {
    return {
      company: scopeFor(req, "company.view"),
      agent: scopeFor(req, "agent.view"),
      task: scopeFor(req, "task.view"),
      approval: scopeFor(req, "approval.view"),
      cost: scopeFor(req, "cost.view"),
      audit: scopeFor(req, "audit.view"),
    };
  }

  /** Adds the viewer's decision authority to approvals (UI hint; API re-checks on decide). */
  function withAuthority(req: FastifyRequest, list: ApprovalDTO[]): ApprovalDTO[] {
    const access = principalOf(req).access;
    return list.map((a) => {
      const result = canDecideApproval(access, {
        companyId: a.company?.id ?? null,
        requiredPermissions: a.requiredPermissions,
      });
      return {
        ...a,
        viewerCanDecide: a.status === "pending" && result.allowed,
        viewerMissingPermissions: result.missing,
      };
    });
  }

  /** IDOR guard for a single agent: it must be visible under agent.view. */
  async function visibleAgent(req: FastifyRequest, id: string): Promise<AgentDTO> {
    const [agent] = await listAgents(db, { ids: [id], scope: scopeFor(req, "agent.view") });
    if (!agent) throw new NotFoundError("Agent", id);
    return agent;
  }

  /** Managing an agent needs the permission everywhere the agent operates. */
  function canManageAgent(req: FastifyRequest, agent: AgentDTO, permission: string): boolean {
    const access = principalOf(req).access;
    if (can(access, permission, null)) return true;
    if (agent.scope === "global") return false;
    return (
      agent.companies.length > 0 && agent.companies.every((c) => can(access, permission, c.id))
    );
  }

  /* ---- shell & dashboard ---- */

  app.get("/shell", async (req): Promise<ShellDTO> => {
    const summary = await dashboardSummary(db, null, dashboardScopes(req));
    return {
      companies: summary.companies.map((c) => ({
        id: c.id,
        name: c.name,
        slug: c.slug,
        accentColor: c.accentColor,
        status: c.status,
        timezone: c.timezone,
      })),
      pendingApprovals: summary.approvals.length,
      alerts: summary.alerts,
      containsDevSeedData: summary.containsDevSeedData,
    };
  });

  app.get("/dashboard/summary", async (req) => {
    const q = companyScopeQuery.parse(req.query);
    const { company } = await companyScope(req, q.company, "company.view");
    const summary = await dashboardSummary(db, company?.id ?? null, dashboardScopes(req));
    return { ...summary, approvals: withAuthority(req, summary.approvals) };
  });

  /* ---- companies ---- */

  app.get("/companies", async (req) => {
    const q = z.object({ stats: z.enum(["true", "false"]).optional() }).parse(req.query);
    const scope = scopeFor(req, "company.view");
    return {
      data:
        q.stats === "true" ? await listCompanySummaries(db, scope) : await listCompanies(db, scope),
    };
  });

  app.get("/companies/:ref", async (req) => {
    const { ref } = refParam.parse(req.params);
    const { company } = await companyScope(req, ref, "company.view");
    return { data: toCompanyDTO(company!) };
  });

  app.post("/companies", async (req, reply) => {
    requirePermission(req, "company.create", null);
    const body = createCompanySchema.parse(req.body);
    const result = await createCompany(db, body, actorFrom(req));
    return reply.status(201).send({ data: result.company, agentsCreated: result.agents.length });
  });

  /* ---- workforce ---- */

  app.get("/agents", async (req) => {
    const q = listAgentsQuery.parse(req.query);
    const { company, scope } = await companyScope(req, q.company, "agent.view");
    // Temporary workers past their expiry are retired before listing (no background scheduler yet).
    await expireTemporaryAgents(db);
    const list = await listAgents(db, {
      companyId: company?.id,
      status: q.status,
      departmentSlug: q.department,
      provider: q.provider,
      q: q.q,
      teamId: q.team,
      temporary: q.kind ? q.kind === "temporary" : undefined,
      scope,
    });
    return { data: q.autonomy ? list.filter((a) => a.autonomyLevel === q.autonomy) : list };
  });

  app.get("/agents/:id", async (req) => {
    const { id } = idParam.parse(req.params);
    return { data: await visibleAgent(req, id) };
  });

  app.post("/agents", async (req, reply) => {
    const body = createAgentSchema.parse(req.body);
    const access = principalOf(req).access;
    const allowed =
      can(access, "agent.create", null) ||
      (body.scope !== "global" &&
        body.companyIds.length > 0 &&
        body.companyIds.every((c) => can(access, "agent.create", c)));
    if (!allowed) throw new ForbiddenError();
    const agent = await createAgent(db, body, actorFrom(req));
    return reply
      .status(201)
      .send({ data: await getAgent(db, agent.id, scopeFor(req, "agent.view")) });
  });

  app.put("/agents/:id/companies", async (req) => {
    const { id } = idParam.parse(req.params);
    const body = setAgentCompaniesSchema.parse(req.body);
    const agent = await visibleAgent(req, id);
    const access = principalOf(req).access;
    const touched = [...new Set([...agent.companies.map((c) => c.id), ...body.companyIds])];
    if (!can(access, "agent.edit", null) && !touched.every((c) => can(access, "agent.edit", c)))
      throw new ForbiddenError();
    return { data: await setAgentCompanies(db, id, body, actorFrom(req)) };
  });

  app.get("/agents/:id/authority", async (req) => {
    const { id } = idParam.parse(req.params);
    const q = companyScopeQuery.parse(req.query);
    const agent = await visibleAgent(req, id);
    const { company } = await companyScope(req, q.company, "agent.view");
    return {
      data: await agentAuthority(db, id, company?.id ?? null, {
        visibleCompanyIds: companiesWith(principalOf(req).access, "agent.view"),
        viewerCanManage: canManageAgent(req, agent, "agent.permissions.manage"),
      }),
    };
  });

  app.put("/agents/:id/autonomy", async (req) => {
    const { id } = idParam.parse(req.params);
    const body = agentAutonomySchema.parse(req.body);
    const agent = await visibleAgent(req, id);
    if (!canManageAgent(req, agent, "agent.permissions.manage")) {
      await auditSecurityEvent(
        req,
        "security.privilege_change_denied",
        "Denied agent autonomy change",
        { resourceType: "agent", resourceId: id },
      );
      throw new ForbiddenError();
    }
    await setAgentAutonomy(db, id, body.autonomyLevel, actorFrom(req));
    return { data: await visibleAgent(req, id) };
  });

  app.put("/agents/:id/permissions", async (req) => {
    const { id } = idParam.parse(req.params);
    const body = agentGrantsSchema.parse(req.body);
    const agent = await visibleAgent(req, id);
    const access = principalOf(req).access;
    const allowed = body.companyId
      ? can(access, "agent.permissions.manage", body.companyId) &&
        (agent.scope === "global" || agent.companies.some((c) => c.id === body.companyId))
      : canManageAgent(req, agent, "agent.permissions.manage");
    if (!allowed) {
      await auditSecurityEvent(
        req,
        "security.privilege_change_denied",
        "Denied agent permission change",
        { resourceType: "agent", resourceId: id },
      );
      throw new ForbiddenError();
    }
    await setAgentGrants(db, id, body, actorFrom(req));
    return {
      data: await agentAuthority(db, id, body.companyId, {
        visibleCompanyIds: companiesWith(access, "agent.view"),
        viewerCanManage: true,
      }),
    };
  });

  app.get("/agent-templates", async () => ({ data: await listAgentTemplates(db) }));

  app.get("/departments", async (req) => {
    const q = companyScopeQuery.parse(req.query);
    const { company, scope } = await companyScope(req, q.company, "company.view");
    return { data: await listDepartments(db, company?.id, scope) };
  });

  /* ---- tasks ---- */

  app.get("/tasks", async (req) => {
    const q = listTasksQuery.parse(req.query);
    const { scope } = await companyScope(req, q.company, "task.view");
    return {
      data: await listTasks(db, { statuses: q.status, agentId: q.agent, limit: q.limit, scope }),
    };
  });

  app.get("/tasks/:id", async (req) => {
    const { id } = idParam.parse(req.params);
    const [task] = await listTasks(db, { ids: [id], scope: scopeFor(req, "task.view") });
    if (!task) throw new NotFoundError("Task", id);
    return { data: task };
  });

  app.get("/tasks/:id/tree", async (req) => {
    const { id } = idParam.parse(req.params);
    const tree = await getTaskTree(db, id, scopeFor(req, "task.view"));
    if (!tree.some((t) => t.id === id)) throw new NotFoundError("Task", id);
    return { data: tree };
  });

  /* ---- governance ---- */

  app.get("/approvals", async (req) => {
    const q = listApprovalsQuery.parse(req.query);
    const { scope } = await companyScope(req, q.company, "approval.view");
    return { data: withAuthority(req, await listApprovals(db, { status: q.status, scope })) };
  });

  app.post("/approvals/:id/decision", async (req) => {
    const { id } = idParam.parse(req.params);
    const body = approvalDecisionSchema.parse(req.body);
    const access = principalOf(req).access;
    const row = await getApprovalRow(db, id);
    // Existence is only revealed to people who can see the approval.
    if (!can(access, "approval.view", row.companyId)) throw new NotFoundError("Approval", id);
    const [dto] = await listApprovals(db, { ids: [id], scope: scopeFor(req, "approval.view") });
    if (!dto) throw new NotFoundError("Approval", id);
    const authority = canDecideApproval(access, {
      companyId: row.companyId,
      requiredPermissions: dto.requiredPermissions,
    });
    if (!authority.allowed) {
      await auditSecurityEvent(
        req,
        "security.approval_denied",
        "Approval decision denied: insufficient authority",
        {
          companyId: row.companyId ?? undefined,
          resourceType: "approval",
          resourceId: id,
          metadata: { missing: authority.missing },
        },
      );
      throw new ForbiddenError(`Missing approval authority: ${authority.missing.join(", ")}`);
    }
    await decideApproval(db, id, body, actorFrom(req));
    const [updated] = await listApprovals(db, { ids: [id] });
    return { data: withAuthority(req, [updated!])[0] };
  });

  app.get("/audit-events", async (req) => {
    const q = listAuditQuery.parse(req.query);
    const { scope } = await companyScope(req, q.company, "audit.view");
    return { data: await listAuditEvents(db, { limit: q.limit, scope }) };
  });

  app.get("/usage", async (req) => {
    const q = companyScopeQuery.parse(req.query);
    const { company, scope } = await companyScope(req, q.company, "cost.view");
    return { data: await usageSummary(db, company?.id, scope) };
  });

  app.get("/integrations", async (req) => {
    const q = companyScopeQuery.parse(req.query);
    const { company, scope } = await companyScope(req, q.company, "integration.view");
    return { data: await listIntegrations(db, company?.id, scope) };
  });

  /** Detailed health for signed-in users; the public /health is minimal in production. */
  app.get("/system/health", async () => app.deps.health.check());

  /* ---- live sessions (MOCK until Stage 31) ---- */
  app.get("/live-sessions", async (req) => {
    const q = companyScopeQuery.parse(req.query);
    const { company, scope } = await companyScope(req, q.company, "agent.view");
    const taskScope = scopeFor(req, "task.view");
    const agents = await listAgents(db, { companyId: company?.id, scope });
    const openTasks = await listTasks(db, {
      statuses: ["running", "waiting", "needs_approval"],
      scope: company ? narrowScope(taskScope, company.id) : taskScope,
    });
    const taskById = new Map(openTasks.map((t) => [t.id, t]));
    const sessions: LiveSessionDTO[] = agents
      .filter(
        (a) =>
          ["working", "waiting", "needs_approval", "blocked"].includes(a.status) || a.currentTask,
      )
      .map((a) => {
        const t = a.currentTask ? taskById.get(a.currentTask.id) : undefined;
        return createMockLiveSession({
          agent: { id: a.id, name: a.name, status: a.status, templateKey: a.templateKey },
          company: t
            ? t.company
            : a.scope === "global"
              ? null
              : (a.companies.find((c) => c.isPrimary) ?? a.companies[0] ?? null),
          task: t
            ? {
                id: t.id,
                title: t.title,
                progress: t.progress,
                currentAction: t.currentAction,
                currentTool: t.currentTool,
              }
            : null,
        });
      });
    return { data: sessions, isMock: true };
  });
};
