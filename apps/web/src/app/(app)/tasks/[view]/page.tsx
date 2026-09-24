import Link from "next/link";
import { notFound } from "next/navigation";
import type { TaskDTO, TaskStatus } from "@aibos/shared";
import { Panel, cn } from "@aibos/ui";
import { PageError } from "@/components/common/PageError";
import { PageHeader } from "@/components/common/PageHeader";
import { TaskList } from "@/components/dashboard/TaskList";
import { apiGet, companyParam, type SearchParams } from "@/lib/api";
import { withCompany } from "@/lib/format";

const VIEWS: Record<string, { label: string; statuses: TaskStatus[]; description: string }> = {
  active: {
    label: "Active",
    statuses: ["running", "waiting", "needs_approval", "assigned", "paused"],
    description: "Work in progress, including tasks waiting on people or systems.",
  },
  queue: {
    label: "Queue",
    statuses: ["queued"],
    description: "Tasks waiting for an agent with capacity.",
  },
  completed: {
    label: "Completed",
    statuses: ["completed"],
    description: "Finished work with result summaries.",
  },
  failed: {
    label: "Failed",
    statuses: ["failed", "cancelled"],
    description: "Tasks that errored or were cancelled — review before retrying.",
  },
};

export default async function TasksPage({
  params,
  searchParams,
}: {
  params: Promise<{ view: string }>;
  searchParams: SearchParams;
}) {
  const { view } = await params;
  const cfg = VIEWS[view];
  if (!cfg) notFound();
  const company = await companyParam(searchParams);
  let tasks: TaskDTO[];
  try {
    tasks = (
      await apiGet<{ data: TaskDTO[] }>("/v1/tasks", { company, status: cfg.statuses.join(",") })
    ).data;
  } catch (e) {
    return <PageError error={e} />;
  }
  return (
    <div className="mx-auto max-w-[1680px]">
      <PageHeader
        eyebrow="Tasks"
        title={`${cfg.label} tasks`}
        description={cfg.description}
        devData={tasks.some((t) => t.origin === "dev_seed")}
      />
      <nav
        aria-label="Task views"
        className="mb-4 flex flex-wrap gap-1 rounded-xl border border-line bg-surface p-1 sm:inline-flex"
      >
        {Object.entries(VIEWS).map(([key, v]) => (
          <Link
            key={key}
            href={withCompany(`/tasks/${key}`, company)}
            aria-current={key === view ? "page" : undefined}
            className={cn(
              "focus-ring rounded-lg px-3 py-1.5 text-[13px] font-medium",
              key === view ? "bg-surface-3 text-fg" : "text-fg-muted hover:text-fg",
            )}
          >
            {v.label}
          </Link>
        ))}
      </nav>
      <Panel title={`${tasks.length} task${tasks.length === 1 ? "" : "s"}`} bodyClassName="p-0">
        <TaskList tasks={tasks} hierarchical emptyTitle={`No ${cfg.label.toLowerCase()} tasks`} />
      </Panel>
    </div>
  );
}
