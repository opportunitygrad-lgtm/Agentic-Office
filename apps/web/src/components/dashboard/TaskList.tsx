import Link from "next/link";
import { CornerDownRight, ListChecks } from "lucide-react";
import { formatUsd, titleCase, type TaskDTO } from "@aibos/shared";
import { EmptyState, ProgressBar, StatusPill, TASK_STATUS_META, cn } from "@aibos/ui";
import { relativeTime } from "@/lib/format";
import { CompanyChip } from "../common/CompanyChip";

const PRIORITY: Record<string, string> = {
  urgent: "text-rose-600 dark:text-rose-400",
  high: "text-amber-700 dark:text-amber-400",
  normal: "text-fg-faint",
  low: "text-fg-faint",
};

export function TaskRow({ task, depth = 0 }: { task: TaskDTO; depth?: number }) {
  const meta = TASK_STATUS_META[task.status];
  return (
    <div
      className="grid grid-cols-1 gap-x-4 gap-y-2 px-4 py-3 sm:px-5 lg:grid-cols-[minmax(0,2.4fr)_minmax(0,1.1fr)_minmax(120px,1fr)_92px] lg:items-center"
      style={depth ? { paddingLeft: `calc(${depth * 20}px + 1.25rem)` } : undefined}
    >
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          {task.parentTaskId && (
            <CornerDownRight className="size-3.5 shrink-0 text-fg-faint" aria-label="Subtask" />
          )}
          <Link
            href={`/tasks/item/${task.id}`}
            className="focus-ring truncate rounded text-[13.5px] font-medium hover:underline"
          >
            {task.title}
          </Link>
          {task.childCount > 0 && (
            <span
              className="shrink-0 rounded bg-surface-3 px-1 text-[10.5px] text-fg-muted"
              title={`${task.childCount} subtask(s)`}
            >
              +{task.childCount}
            </span>
          )}
        </div>
        <p className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 text-[11.5px] text-fg-faint">
          <span className={cn("font-medium", PRIORITY[task.priority])}>
            {titleCase(task.priority)}
          </span>
          <span>· {titleCase(task.type)}</span>
          {task.currentAction && task.status !== "completed" && (
            <span className="truncate">· {task.currentAction}</span>
          )}
          {task.error && (
            <span className="truncate text-rose-600 dark:text-rose-400">· {task.error}</span>
          )}
          {task.resultSummary && <span className="truncate">· {task.resultSummary}</span>}
        </p>
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 lg:block">
        <CompanyChip company={task.company} />
        <p className="truncate text-[12px] text-fg-muted lg:mt-0.5">
          {task.assignedAgent?.name ?? "Unassigned"}
        </p>
      </div>
      <div className="flex items-center gap-2.5">
        <StatusPill tone={meta.tone} label={meta.label} pulse={meta.pulse} className="shrink-0" />
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <ProgressBar
            value={task.progress}
            tone={meta.tone}
            animated={task.status === "running"}
            label={`${task.title} progress`}
          />
          <span className="num w-8 shrink-0 text-right text-[11px] text-fg-muted">
            {task.progress}%
          </span>
        </div>
      </div>
      <div className="flex items-center justify-between text-[11.5px] lg:block lg:text-right">
        <p className="num text-fg-muted" title="Actual / estimated AI cost">
          {task.actualCost != null ? formatUsd(task.actualCost) : "—"}
          {task.estimatedCost != null && (
            <span className="text-fg-faint"> / {formatUsd(task.estimatedCost)}</span>
          )}
        </p>
        <p className="text-fg-faint" suppressHydrationWarning>
          {relativeTime(task.updatedAt)}
        </p>
      </div>
    </div>
  );
}

export function TaskList({
  tasks,
  emptyTitle = "No tasks here",
  hierarchical,
}: {
  tasks: TaskDTO[];
  emptyTitle?: string;
  hierarchical?: boolean;
}) {
  if (!tasks.length) {
    return (
      <EmptyState
        icon={<ListChecks className="size-5" />}
        title={emptyTitle}
        description="Tasks created by people or agents appear here with live progress."
        className="m-4"
      />
    );
  }
  let rows: { task: TaskDTO; depth: number }[] = tasks.map((t) => ({ task: t, depth: 0 }));
  if (hierarchical) {
    const ids = new Set(tasks.map((t) => t.id));
    const children = new Map<string, TaskDTO[]>();
    for (const t of tasks) {
      if (t.parentTaskId && ids.has(t.parentTaskId)) {
        children.set(t.parentTaskId, [...(children.get(t.parentTaskId) ?? []), t]);
      }
    }
    rows = [];
    const walk = (t: TaskDTO, depth: number) => {
      rows.push({ task: t, depth });
      for (const c of children.get(t.id) ?? []) walk(c, depth + 1);
    };
    for (const t of tasks) if (!t.parentTaskId || !ids.has(t.parentTaskId)) walk(t, 0);
  }
  return (
    <div>
      <div
        className="hidden grid-cols-[minmax(0,2.4fr)_minmax(0,1.1fr)_minmax(120px,1fr)_92px] gap-x-4 border-b border-line px-5 py-2 text-[11px] font-medium text-fg-faint lg:grid"
        aria-hidden="true"
      >
        <span>Task</span>
        <span>Company · Agent</span>
        <span>Status · Progress</span>
        <span className="text-right">Cost · Updated</span>
      </div>
      <ul className="divide-y divide-line/70">
        {rows.map(({ task, depth }) => (
          <li key={task.id}>
            <TaskRow task={task} depth={depth} />
          </li>
        ))}
      </ul>
    </div>
  );
}
