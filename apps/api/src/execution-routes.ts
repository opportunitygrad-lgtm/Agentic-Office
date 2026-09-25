import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { can, companiesWith, type HumanAccessContext } from "@aibos/access-core";
import {
  ForbiddenError,
  NotFoundError,
  activeConversationRun,
  agentPerformance,
  getOwnConversation,
  getRunDetail,
  getTaskRecord,
  listAgents,
  listConversationMessages,
  listRuns,
  listTasks,
  previewTaskRun,
  providerStatuses,
  requestRunCancel,
  runCompanyId,
  setAgentProviderSettings,
  setRunFeedback,
  startChatRun,
  startTaskRun,
  testProviderConnection,
  updateProviderSettings,
  viewerClearance,
  type ExecutionEnv,
  type RunViewer,
  type Task,
} from "@aibos/db";
import {
  FINAL_RUN_STATUSES,
  MODEL_TIERS,
  PROVIDER_TYPES,
  RESPONSE_DETAILS,
  agentProviderSettingsSchema,
  chatSendSchema,
  providerSettingsSchema,
  runFeedbackSchema,
  startTaskRunSchema,
  uuidSchema,
  type AgentDTO,
  type RunStreamMessage,
} from "@aibos/shared";
import type { RunBus } from "./run-bus";
import {
  TooManyRequestsError,
  actorFrom,
  auditSecurityEvent,
  companyScope,
  principalOf,
  scopeFor,
} from "./security";
import { LIMITS } from "./throttle";

const idParam = z.object({ id: uuidSchema });
const providerParam = z.object({ provider: z.enum(PROVIDER_TYPES) });

function holdsAnywhere(access: HumanAccessContext, permission: string): boolean {
  const ids = companiesWith(access, permission);
  return ids === "all" || ids.length > 0;
}

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

export interface ExecutionDeps {
  env: ExecutionEnv;
  bus: RunBus;
}

export const executionRoutes =
  (deps: ExecutionDeps): FastifyPluginAsync =>
  async (app) => {
    const { db } = app.deps.db;
    const { env, bus } = deps;

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

    async function visibleTask(req: FastifyRequest, id: string): Promise<Task> {
      const [dto] = await listTasks(db, { ids: [id], scope: scopeFor(req, "task.view") });
      if (!dto) throw new NotFoundError("Task", id);
      const task = await getTaskRecord(db, id);
      if (!task) throw new NotFoundError("Task", id);
      return task;
    }

    async function visibleAgent(req: FastifyRequest, id: string): Promise<AgentDTO> {
      const [agent] = await listAgents(db, { ids: [id], scope: scopeFor(req, "agent.view") });
      if (!agent) throw new NotFoundError("Agent", id);
      return agent;
    }

    const clearance = (req: FastifyRequest, companyId: string) =>
      viewerClearance((p) => can(principalOf(req).access, p, companyId));

    function viewer(req: FastifyRequest): RunViewer {
      const access = principalOf(req).access;
      return {
        canStop: (companyId) => can(access, "agent.run.stop", companyId),
        userId: principalOf(req).user.id,
      };
    }

    /** Run visibility: agent.run.view in its company; chat runs only for the conversation owner. */
    async function visibleRun(req: FastifyRequest, runId: string) {
      const { companyId, conversationUserId } = await runCompanyId(db, runId).catch(() => {
        throw new NotFoundError("Run", runId);
      });
      const access = principalOf(req).access;
      if (!can(access, "agent.run.view", companyId)) throw new NotFoundError("Run", runId);
      if (conversationUserId && conversationUserId !== principalOf(req).user.id)
        throw new NotFoundError("Run", runId);
      return { companyId, conversationUserId };
    }

    /* ---------- providers ---------- */

    app.get("/providers", async (req) => {
      if (!holdsAnywhere(principalOf(req).access, "provider.view")) throw new ForbiddenError();
      return { data: await providerStatuses(db, env.registry), mode: env.registry.mode };
    });

    app.put("/providers/:provider", async (req) => {
      const { provider } = providerParam.parse(req.params);
      if (!can(principalOf(req).access, "provider.settings.manage", null))
        throw await deny(req, "Denied provider settings change", {
          resourceType: "ai_provider",
          resourceId: provider,
        });
      const body = providerSettingsSchema.parse(req.body);
      await updateProviderSettings(db, provider, body, actorFrom(req));
      return {
        data: (await providerStatuses(db, env.registry)).find((p) => p.provider === provider),
      };
    });

    app.post("/providers/:provider/test", async (req) => {
      const { provider } = providerParam.parse(req.params);
      if (!can(principalOf(req).access, "provider.test", null))
        throw await deny(req, "Denied provider connection test", {
          resourceType: "ai_provider",
          resourceId: provider,
        });
      // Each test is a real (token-free) provider request: rate-limited per user.
      const rule = LIMITS.providerTestPerUser;
      if (
        (await app.deps.throttle.hit(`provider-test:${principalOf(req).user.id}`, rule.window)) >
        rule.max
      )
        throw new TooManyRequestsError("Too many connection tests. Please wait a few minutes.");
      const health = await testProviderConnection(db, env.registry, provider, actorFrom(req));
      return {
        data: {
          state: health.state,
          detail: health.detail,
          checkedAt: health.checkedAt.toISOString(),
        },
      };
    });

    /* ---------- task runs ---------- */

    const previewQuery = z.object({
      tier: z.enum(MODEL_TIERS).optional(),
      detail: z.enum(RESPONSE_DETAILS).optional(),
    });

    app.get("/tasks/:id/run-preview", async (req) => {
      const { id } = idParam.parse(req.params);
      const q = previewQuery.parse(req.query);
      const task = await visibleTask(req, id);
      if (!task.companyId || !can(principalOf(req).access, "agent.run.view", task.companyId))
        throw new ForbiddenError();
      const preview = await previewTaskRun(db, env, id, {
        viewerMaxSensitivity: clearance(req, task.companyId),
        requestedTier: q.tier,
        responseDetail: q.detail,
      });
      const canExecute =
        can(principalOf(req).access, "task.execute", task.companyId) &&
        departmentAllowed(principalOf(req).access, task.companyId, task.departmentId);
      return { data: { ...preview, canExecute } };
    });

    app.post("/tasks/:id/runs", async (req, reply) => {
      const { id } = idParam.parse(req.params);
      const body = startTaskRunSchema.parse(req.body ?? {});
      const task = await visibleTask(req, id);
      const access = principalOf(req).access;
      if (
        !task.companyId ||
        !can(access, "task.execute", task.companyId) ||
        !departmentAllowed(access, task.companyId, task.departmentId)
      )
        throw await deny(req, "Denied task execution", {
          resourceType: "task",
          resourceId: id,
          companyId: task.companyId,
        });
      const result = await startTaskRun(db, env, id, body, actorFrom(req), {
        viewerMaxSensitivity: clearance(req, task.companyId),
      });
      if (result.status === "approval_required") return reply.status(202).send({ data: result });
      if (result.status === "started") await bus.enqueue(result.runId);
      const run = await getRunDetail(db, result.runId, {
        scope: scopeFor(req, "agent.run.view"),
        viewer: viewer(req),
      });
      return reply
        .status(result.status === "started" ? 201 : 200)
        .send({ data: { status: result.status, run } });
    });

    app.get("/tasks/:id/runs", async (req) => {
      const { id } = idParam.parse(req.params);
      const task = await visibleTask(req, id);
      if (!task.companyId || !can(principalOf(req).access, "agent.run.view", task.companyId))
        throw new ForbiddenError();
      return {
        data: await listRuns(db, {
          taskId: id,
          scope: scopeFor(req, "agent.run.view"),
          viewer: viewer(req),
        }),
      };
    });

    /* ---------- runs ---------- */

    app.get("/runs", async (req) => {
      const q = z
        .object({
          company: z.string().max(64).optional(),
          active: z.enum(["true", "false"]).optional(),
          limit: z.coerce.number().int().min(1).max(100).optional(),
        })
        .parse(req.query);
      const { company, scope } = await companyScope(req, q.company, "agent.run.view");
      return {
        data: await listRuns(db, {
          companyId: company?.id,
          activeOnly: q.active === "true",
          scope,
          viewer: viewer(req),
          limit: q.limit ?? 20,
        }),
      };
    });

    app.get("/runs/:id", async (req) => {
      const { id } = idParam.parse(req.params);
      await visibleRun(req, id);
      return {
        data: await getRunDetail(db, id, {
          scope: scopeFor(req, "agent.run.view"),
          viewer: viewer(req),
        }),
      };
    });

    /** Server-sent events: snapshot first, then live events/chunks until the run ends. */
    app.get("/runs/:id/stream", async (req, reply: FastifyReply) => {
      const { id } = idParam.parse(req.params);
      await visibleRun(req, id);
      const snapshot = await getRunDetail(db, id, {
        scope: scopeFor(req, "agent.run.view"),
        viewer: viewer(req),
      });
      reply.hijack();
      const res = reply.raw;
      res.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no",
      });
      const send = (m: RunStreamMessage) => res.write(`data: ${JSON.stringify(m)}\n\n`);
      send({ kind: "snapshot", run: snapshot });
      let closed = false;
      let unsubscribe: (() => Promise<void>) | null = null;
      const heartbeat = setInterval(() => res.write(": keep-alive\n\n"), 15_000);
      const close = async () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        await unsubscribe?.();
        res.end();
      };
      req.raw.on("close", () => void close());
      if (FINAL_RUN_STATUSES.includes(snapshot.status)) return close();
      unsubscribe = await bus.subscribe(id, (m) => {
        if (closed) return;
        send(m);
        if (m.kind === "status" && FINAL_RUN_STATUSES.includes(m.status)) {
          // Send the final state (result, usage, cost) and finish.
          void getRunDetail(db, id, { scope: scopeFor(req, "agent.run.view"), viewer: viewer(req) })
            .then((run) => send({ kind: "snapshot", run }))
            .finally(() => void close());
        }
      });
    });

    app.post("/runs/:id/cancel", async (req) => {
      const { id } = idParam.parse(req.params);
      const { companyId, conversationUserId } = await visibleRun(req, id);
      const isOwner = conversationUserId === principalOf(req).user.id;
      if (!can(principalOf(req).access, "agent.run.stop", companyId) && !isOwner)
        throw await deny(req, "Denied stopping an agent run", {
          resourceType: "agent_run",
          resourceId: id,
          companyId,
        });
      const r = await requestRunCancel(db, id, actorFrom(req));
      if (r.notifyWorker) await bus.requestCancel(id);
      return {
        data: await getRunDetail(db, id, {
          scope: scopeFor(req, "agent.run.view"),
          viewer: viewer(req),
        }),
      };
    });

    app.post("/runs/:id/feedback", async (req) => {
      const { id } = idParam.parse(req.params);
      const body = runFeedbackSchema.parse(req.body);
      await visibleRun(req, id);
      await setRunFeedback(db, id, body, actorFrom(req));
      return {
        data: await getRunDetail(db, id, {
          scope: scopeFor(req, "agent.run.view"),
          viewer: viewer(req),
        }),
      };
    });

    app.get("/agents/:id/runs", async (req) => {
      const { id } = idParam.parse(req.params);
      await visibleAgent(req, id);
      return {
        data: await listRuns(db, {
          agentId: id,
          scope: scopeFor(req, "agent.run.view"),
          viewer: viewer(req),
          limit: 20,
        }),
      };
    });

    app.put("/agents/:id/provider-settings", async (req) => {
      const { id } = idParam.parse(req.params);
      const body = agentProviderSettingsSchema.parse(req.body);
      const agent = await visibleAgent(req, id);
      const access = principalOf(req).access;
      const allowed =
        can(access, "agent.edit", null) ||
        (agent.scope !== "global" &&
          agent.companies.length > 0 &&
          agent.companies.every((c) => can(access, "agent.edit", c.id)));
      if (!allowed)
        throw await deny(req, "Denied agent provider settings change", {
          resourceType: "agent",
          resourceId: id,
        });
      await setAgentProviderSettings(db, id, body, actorFrom(req));
      return { data: await visibleAgent(req, id) };
    });

    app.get("/agents/:id/performance", async (req) => {
      const { id } = idParam.parse(req.params);
      await visibleAgent(req, id);
      if (!holdsAnywhere(principalOf(req).access, "agent.run.view")) throw new ForbiddenError();
      return { data: await agentPerformance(db, id) };
    });

    /* ---------- chat ---------- */

    app.post("/conversations/:id/messages", async (req, reply) => {
      const { id } = idParam.parse(req.params);
      const body = chatSendSchema.parse(req.body);
      const c = await getOwnConversation(db, id, principalOf(req).user.id);
      const access = principalOf(req).access;
      if (!can(access, "agent.chat", c.companyId))
        throw await deny(req, "Denied agent chat", {
          resourceType: "conversation",
          resourceId: id,
          companyId: c.companyId,
        });
      // The agent must still be visible to the person in this company.
      await visibleAgent(req, c.agentId);
      const { runId, existing } = await startChatRun(db, env, id, body.content, actorFrom(req), {
        viewerMaxSensitivity: clearance(req, c.companyId),
        idempotencyKey: body.idempotencyKey,
      });
      if (!existing) await bus.enqueue(runId);
      return reply
        .status(201)
        .send({ data: { runId, messages: await listConversationMessages(db, id) } });
    });

    app.get("/conversations/:id/active-run", async (req) => {
      const { id } = idParam.parse(req.params);
      await getOwnConversation(db, id, principalOf(req).user.id);
      return { data: { runId: await activeConversationRun(db, id) } };
    });
  };
