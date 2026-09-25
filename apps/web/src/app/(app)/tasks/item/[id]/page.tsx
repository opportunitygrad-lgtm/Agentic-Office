import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { titleCase, type MeDTO, type TaskDTO } from "@aibos/shared";
import { Panel, ProgressBar, StatusPill, TASK_STATUS_META } from "@aibos/ui";
import { CompanyChip } from "@/components/common/CompanyChip";
import { PageError } from "@/components/common/PageError";
import { Unauthorised } from "@/components/common/Unauthorised";
import { ContextPreview } from "@/components/context/ContextPreview";
import { TaskList } from "@/components/dashboard/TaskList";
import { TaskWorkforcePanel } from "@/components/workforce/TaskWorkforcePanel";
import { TaskRunPanel } from "@/components/execution/TaskRunPanel";
import { apiGet, apiTry } from "@/lib/api";

export const metadata = { title: "Task detail" };

export default async function TaskDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let task: TaskDTO;
  let me: MeDTO;
  try {
    [task, me] = await Promise.all([
      apiGet<{ data: TaskDTO }>(`/v1/tasks/${id}`).then((r) => r.data),
      apiGet<MeDTO>("/v1/auth/me"),
    ]);
  } catch (e) {
    return <PageError error={e} />;
  }
  const tree = (await apiTry<{ data: TaskDTO[] }>(`/v1/tasks/${task.rootTaskId ?? task.id}/tree`))
    ?.data ?? [task];
  const meta = TASK_STATUS_META[task.status];
  const companyId = task.company?.id;
  const canPreview =
    !!companyId &&
    (me.globalPermissions.includes("context.preview") ||
      (me.companyPermissions[companyId]?.includes("context.preview") ?? false));

  return (
    <div className="mx-auto max-w-[1680px]">
      <Link
        href="/tasks/active"
        className="focus-ring mb-3 inline-flex items-center gap-1 rounded text-[12.5px] text-fg-muted hover:text-fg"
      >
        <ArrowLeft className="size-3.5" aria-hidden="true" /> Tasks
      </Link>
      <div className="mb-5">
        <p className="eyebrow">Task · {titleCase(task.type)}</p>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-[22px] font-semibold tracking-tight">{task.title}</h1>
          <StatusPill tone={meta.tone} label={meta.label} pulse={meta.pulse} />
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-3 text-[13px] text-fg-muted">
          <CompanyChip company={task.company} />
          <span>
            {task.assignedAgent ? `Assigned to ${task.assignedAgent.name}` : "Unassigned"}
          </span>
          <span className="flex w-40 items-center gap-2">
            <ProgressBar value={task.progress} tone={meta.tone} label="Progress" />
            <span className="num text-[11.5px]">{task.progress}%</span>
          </span>
        </div>
        {task.description && <p className="mt-2 max-w-3xl text-[13.5px]">{task.description}</p>}
      </div>
      {tree.length > 1 && (
        <Panel title="Task hierarchy" className="mb-5" bodyClassName="p-0">
          <TaskList tasks={tree} hierarchical emptyTitle="No related tasks" />
        </Panel>
      )}
      {task.company && (
        <section aria-labelledby="run-heading" className="mb-6">
          <h2 id="run-heading" className="mb-3 text-[16px] font-semibold tracking-tight">
            Agent execution
          </h2>
          <TaskRunPanel taskId={task.id} />
        </section>
      )}
      {task.company && (
        <section aria-labelledby="workforce-heading" className="mb-6">
          <h2 id="workforce-heading" className="mb-3 text-[16px] font-semibold tracking-tight">
            Delegation & assignment
          </h2>
          <TaskWorkforcePanel taskId={task.id} />
        </section>
      )}
      <h2 className="mb-1 text-[16px] font-semibold tracking-tight">Agent context</h2>
      <p className="mb-3 text-[13px] text-fg-muted">
        Exactly what the assigned agent would receive for this task — nothing more.
      </p>
      {!task.company ? (
        <Unauthorised
          title="No single company context"
          message="Group-level tasks span companies, so there is no company context pack."
        />
      ) : !task.assignedAgent ? (
        <Unauthorised title="No agent assigned" message="Assign an agent to preview its context." />
      ) : canPreview ? (
        <ContextPreview target={{ taskId: task.id }} />
      ) : (
        <Unauthorised
          title="No context preview access"
          message="You need the Preview agent context permission for this company."
        />
      )}
    </div>
  );
}
