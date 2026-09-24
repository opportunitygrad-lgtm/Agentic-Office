import { and, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import {
  createTaskSchema,
  type CreateTaskInput,
  type TaskDTO,
  type TaskStatus,
} from "@aibos/shared";
import type { Database } from "../client";
import { NotFoundError } from "../errors";
import { agents, companies, tasks, type Task } from "../schema";
import { recordAuditEvent } from "./audit";
import {
  FULL_SCOPE,
  actorAuditFields,
  departmentVisible,
  iso,
  scopeWhere,
  type AccessScope,
  type Actor,
} from "./util";

export interface TaskFilters {
  companyId?: string | null;
  statuses?: TaskStatus[];
  agentId?: string;
  rootTaskId?: string;
  ids?: string[];
  limit?: number;
  scope?: AccessScope;
}

const STATUS_ORDER = sql`case ${tasks.status}
  when 'needs_approval' then 0 when 'running' then 1 when 'waiting' then 2 when 'assigned' then 3
  when 'queued' then 4 when 'paused' then 5 when 'failed' then 6 when 'completed' then 7 else 8 end`;

export async function listTasks(db: Database, filters: TaskFilters = {}): Promise<TaskDTO[]> {
  const where: SQL[] = [];
  if (filters.companyId) where.push(eq(tasks.companyId, filters.companyId));
  if (filters.statuses?.length) where.push(inArray(tasks.status, filters.statuses));
  if (filters.agentId) where.push(eq(tasks.assignedAgentId, filters.agentId));
  if (filters.rootTaskId) where.push(eq(tasks.rootTaskId, filters.rootTaskId));
  if (filters.ids?.length) where.push(inArray(tasks.id, filters.ids));
  const scope = filters.scope ?? FULL_SCOPE;
  const scoped = scopeWhere(tasks.companyId, scope);
  if (scoped) where.push(scoped);

  const childCount = sql<number>`(select count(*)::int from ${tasks} as c where c.parent_task_id = ${tasks.id})`;
  const rows = await db
    .select({
      t: tasks,
      company: {
        id: companies.id,
        name: companies.name,
        slug: companies.slug,
        accentColor: companies.accentColor,
      },
      agentName: agents.name,
      agentDepartmentId: agents.departmentId,
      childCount,
    })
    .from(tasks)
    .leftJoin(companies, eq(companies.id, tasks.companyId))
    .leftJoin(agents, eq(agents.id, tasks.assignedAgentId))
    .where(where.length ? and(...where) : undefined)
    .orderBy(STATUS_ORDER, tasks.depth, desc(tasks.updatedAt))
    .limit(filters.limit ?? 100);

  return rows
    .filter((r) => departmentVisible(scope, r.t.companyId, r.agentDepartmentId))
    .map(({ t, company, agentName, childCount: children }) => ({
      id: t.id,
      company: company?.id ? company : null,
      title: t.title,
      description: t.description,
      type: t.type,
      priority: t.priority,
      status: t.status,
      assignedAgent:
        t.assignedAgentId && agentName ? { id: t.assignedAgentId, name: agentName } : null,
      createdByKind: t.createdByKind,
      createdByRef: t.createdByRef,
      parentTaskId: t.parentTaskId,
      rootTaskId: t.rootTaskId,
      childCount: children,
      requiredProvider: t.requiredProvider,
      estimatedCost: t.estimatedCost,
      actualCost: t.actualCost,
      progress: t.progress,
      currentAction: t.currentAction,
      currentTool: t.currentTool,
      requiresApproval: t.requiresApproval,
      dueAt: iso(t.dueAt),
      startedAt: iso(t.startedAt),
      completedAt: iso(t.completedAt),
      error: t.error,
      resultSummary: t.resultSummary,
      origin: t.origin,
      createdAt: t.createdAt.toISOString(),
      updatedAt: t.updatedAt.toISOString(),
    }));
}

/**
 * Creates a task. Subtasks inherit company and root from their parent so a
 * Manager → Research → Verification → Email chain stays fully traceable.
 */
export async function createTask(
  db: Database,
  input: CreateTaskInput,
  actor: Actor,
  opts: { origin?: "live" | "dev_seed"; extra?: Partial<Task> } = {},
): Promise<Task> {
  const data = createTaskSchema.parse(input);
  const origin = opts.origin ?? "live";

  return db.transaction(async (tx) => {
    let rootTaskId: string;
    let depth = 0;
    let companyId = data.companyId ?? null;
    const id = randomUUID();

    if (data.parentTaskId) {
      const [parent] = await tx.select().from(tasks).where(eq(tasks.id, data.parentTaskId));
      if (!parent) throw new NotFoundError("Parent task", data.parentTaskId);
      rootTaskId = parent.rootTaskId ?? parent.id;
      depth = parent.depth + 1;
      companyId ??= parent.companyId;
    } else {
      rootTaskId = id;
    }

    const [task] = await tx
      .insert(tasks)
      .values({
        id,
        companyId,
        title: data.title,
        description: data.description,
        type: data.type,
        priority: data.priority,
        status: data.status,
        assignedAgentId: data.assignedAgentId,
        createdByKind: data.createdByKind,
        createdByRef: data.createdByRef ?? actor.ref,
        parentTaskId: data.parentTaskId,
        rootTaskId,
        depth,
        requiredProvider: data.requiredProvider,
        estimatedCost: data.estimatedCost,
        requiresApproval: data.requiresApproval,
        progress: data.progress,
        dueAt: data.dueAt,
        origin,
        ...opts.extra,
      })
      .returning();
    if (!task) throw new Error("Task insert failed");

    await recordAuditEvent(
      tx,
      {
        companyId: companyId ?? undefined,
        taskId: task.id,
        agentId: task.assignedAgentId ?? undefined,
        ...actorAuditFields(actor),
        resourceType: "task",
        resourceId: task.id,
        action: data.parentTaskId ? "task.subtask_created" : "task.created",
        description: `Task "${task.title}" created`,
        metadata: { parentTaskId: data.parentTaskId ?? null, rootTaskId, depth, actor: actor.ref },
      },
      origin,
    );
    return task;
  });
}

/** Returns an entire task tree (root + all descendants), ordered by depth. */
export async function getTaskTree(
  db: Database,
  rootTaskId: string,
  scope?: AccessScope,
): Promise<TaskDTO[]> {
  const list = await listTasks(db, { rootTaskId, limit: 500, scope });
  return list.sort((a, b) => (a.parentTaskId ? 1 : 0) - (b.parentTaskId ? 1 : 0));
}

/** Raw task row (callers apply authorization). */
export async function getTaskRecord(db: Database, id: string): Promise<Task | null> {
  const [row] = await db.select().from(tasks).where(eq(tasks.id, id));
  return row ?? null;
}
