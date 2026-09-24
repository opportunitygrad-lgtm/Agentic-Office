import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  createAgent,
  createCompany,
  dashboardSummary,
  getAgent,
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
  resolveCompany,
  setAgentCompanies,
  toCompanyDTO,
  usageSummary,
} from "@aibos/db";
import { createMockLiveSession } from "@aibos/browser-core";
import {
  listAgentsQuery,
  listApprovalsQuery,
  listAuditQuery,
  listTasksQuery,
  companyScopeQuery,
  uuidSchema,
  type LiveSessionDTO,
  type ShellDTO,
} from "@aibos/shared";
import { actorFrom } from "./actor";

const idParam = z.object({ id: uuidSchema });
const refParam = z.object({ ref: z.string().min(1).max(64) });

export const registerRoutes: FastifyPluginAsync = async (app) => {
  const { db } = app.deps.db;

  /* ---- dashboard ---- */
  app.get("/dashboard/summary", async (req) => {
    const q = companyScopeQuery.parse(req.query);
    return dashboardSummary(db, q.company);
  });

  /** Lightweight data for the application shell (header + navigation). */
  app.get("/shell", async () => {
    const summary = await dashboardSummary(db);
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
    } satisfies ShellDTO;
  });

  /* ---- companies ---- */
  app.get("/companies", async (req) => {
    const q = z.object({ stats: z.enum(["true", "false"]).optional() }).parse(req.query);
    return { data: q.stats === "true" ? await listCompanySummaries(db) : await listCompanies(db) };
  });

  app.get("/companies/:ref", async (req) => {
    const { ref } = refParam.parse(req.params);
    const company = await resolveCompany(db, ref);
    return { data: toCompanyDTO(company!) };
  });

  app.post("/companies", async (req, reply) => {
    const result = await createCompany(db, req.body as never, actorFrom(req));
    return reply.status(201).send({ data: result.company, agentsCreated: result.agents.length });
  });

  /* ---- workforce ---- */
  app.get("/agents", async (req) => {
    const q = listAgentsQuery.parse(req.query);
    const company = await resolveCompany(db, q.company);
    return {
      data: await listAgents(db, {
        companyId: company?.id,
        status: q.status,
        departmentSlug: q.department,
        provider: q.provider,
        q: q.q,
      }),
    };
  });

  app.get("/agents/:id", async (req) => {
    const { id } = idParam.parse(req.params);
    return { data: await getAgent(db, id) };
  });

  app.post("/agents", async (req, reply) => {
    const agent = await createAgent(db, req.body as never, actorFrom(req));
    return reply.status(201).send({ data: await getAgent(db, agent.id) });
  });

  app.put("/agents/:id/companies", async (req) => {
    const { id } = idParam.parse(req.params);
    return { data: await setAgentCompanies(db, id, req.body as never, actorFrom(req)) };
  });

  app.get("/agent-templates", async () => ({ data: await listAgentTemplates(db) }));

  app.get("/departments", async (req) => {
    const q = companyScopeQuery.parse(req.query);
    const company = await resolveCompany(db, q.company);
    return { data: await listDepartments(db, company?.id) };
  });

  /* ---- tasks ---- */
  app.get("/tasks", async (req) => {
    const q = listTasksQuery.parse(req.query);
    const company = await resolveCompany(db, q.company);
    return {
      data: await listTasks(db, {
        companyId: company?.id,
        statuses: q.status,
        agentId: q.agent,
        limit: q.limit,
      }),
    };
  });

  app.get("/tasks/:id/tree", async (req) => {
    const { id } = idParam.parse(req.params);
    return { data: await getTaskTree(db, id) };
  });

  /* ---- governance ---- */
  app.get("/approvals", async (req) => {
    const q = listApprovalsQuery.parse(req.query);
    const company = await resolveCompany(db, q.company);
    return { data: await listApprovals(db, { companyId: company?.id, status: q.status }) };
  });

  app.get("/audit-events", async (req) => {
    const q = listAuditQuery.parse(req.query);
    const company = await resolveCompany(db, q.company);
    return { data: await listAuditEvents(db, { companyId: company?.id, limit: q.limit }) };
  });

  app.get("/usage", async (req) => {
    const q = companyScopeQuery.parse(req.query);
    const company = await resolveCompany(db, q.company);
    return { data: await usageSummary(db, company?.id) };
  });

  app.get("/integrations", async (req) => {
    const q = companyScopeQuery.parse(req.query);
    const company = await resolveCompany(db, q.company);
    return { data: await listIntegrations(db, company?.id) };
  });

  /* ---- live sessions (MOCK until Stage 31) ---- */
  app.get("/live-sessions", async (req) => {
    const q = companyScopeQuery.parse(req.query);
    const company = await resolveCompany(db, q.company);
    const agents = await listAgents(db, { companyId: company?.id });
    const openTasks = await listTasks(db, {
      companyId: company?.id,
      statuses: ["running", "waiting", "needs_approval"],
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
