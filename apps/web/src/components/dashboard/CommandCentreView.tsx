import Link from "next/link";
import { ArrowRight, Plus } from "lucide-react";
import type { DashboardSummaryDTO, LiveSessionDTO, ManagerStatsDTO } from "@aibos/shared";
import { EmptyState, MockBadge, Panel } from "@aibos/ui";
import { withCompany } from "@/lib/format";
import { PageHeader } from "../common/PageHeader";
import { IfCan } from "../shell/IfCan";
import { LiveSessionSwitcher } from "../live/LiveSessionSwitcher";
import { ActivityStream } from "./ActivityStream";
import { AgentCard } from "./AgentCard";
import { ApprovalList } from "./ApprovalList";
import { CompanyCards } from "./CompanyCards";
import { TaskList } from "./TaskList";
import { UsagePanel } from "./UsagePanel";
import { WorkforceOverview } from "./WorkforceOverview";
import { ManagerStatsPanel } from "../workforce/ManagerStatsPanel";
import { ActiveRuns } from "../execution/ActiveRuns";

function PanelLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="focus-ring inline-flex items-center gap-1 rounded-md text-[12.5px] font-medium text-accent hover:underline"
    >
      {children} <ArrowRight className="size-3.5" aria-hidden="true" />
    </Link>
  );
}

export function CommandCentreView({
  summary,
  sessions,
  managerStats,
}: {
  summary: DashboardSummaryDTO;
  sessions: LiveSessionDTO[];
  managerStats?: ManagerStatsDTO | null;
}) {
  const scope = summary.scope;
  const slug = scope?.slug;
  const featuredAgents = summary.agents.slice(0, 6);
  const openTasks = summary.tasks.length;

  return (
    <div className="mx-auto max-w-[1680px]">
      <PageHeader
        eyebrow={
          scope ? (
            <>
              <span
                className="size-2 rounded-[3px]"
                style={{ background: scope.accentColor ?? "var(--accent)" }}
                aria-hidden="true"
              />
              {scope.name}
            </>
          ) : (
            "Group overview"
          )
        }
        title="Command Centre"
        description={
          scope
            ? `Operations for ${scope.name} — agents, tasks, approvals and spend in one view.`
            : `${summary.companies.length} companies · ${summary.workforce.total} agents · ${openTasks} open tasks · ${summary.approvals.length} approvals waiting`
        }
        devData={summary.containsDevSeedData}
        actions={
          <>
            <Link
              href={withCompany("/tasks/active", slug)}
              className="focus-ring inline-flex h-9 items-center rounded-lg px-3 text-sm font-medium text-fg ring-1 ring-inset ring-line hover:bg-surface-2"
            >
              View tasks
            </Link>
            <IfCan permission="company.create">
              <Link
                href="/companies/new"
                className="focus-ring inline-flex h-9 items-center gap-1.5 rounded-lg bg-accent px-3.5 text-sm font-medium text-white shadow-sm hover:bg-accent-strong"
              >
                <Plus className="size-4" aria-hidden="true" /> Add company
              </Link>
            </IfCan>
          </>
        }
      />

      <CompanyCards companies={summary.companies} selected={slug ?? null} />

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-12 xl:items-start">
        <div className="min-w-0 space-y-4 xl:col-span-8">
          <WorkforceOverview workforce={summary.workforce} company={slug} />
          {managerStats && <ManagerStatsPanel stats={managerStats} />}
          <Panel
            id="agent-runs"
            title="Live agent runs"
            eyebrow="Real execution"
            actions={<PanelLink href={withCompany("/live", slug)}>Live view</PanelLink>}
          >
            <ActiveRuns company={slug ?? undefined} />
          </Panel>
          <Panel
            id="active-agents"
            title="Active agents"
            eyebrow="Workforce"
            actions={
              <PanelLink href={withCompany("/workforce/agents", slug)}>All agents</PanelLink>
            }
          >
            {featuredAgents.length ? (
              <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-3">
                {featuredAgents.map((a) => (
                  <li key={a.id}>
                    <AgentCard
                      agent={a}
                      href={withCompany(`/workforce/agents?focus=${a.id}`, slug)}
                    />
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState
                title="No agents yet"
                description="Add agents from templates in the Agent Registry."
              />
            )}
          </Panel>
        </div>
        <div className="min-w-0 space-y-4 xl:col-span-4">
          <Panel
            id="approval-centre"
            title="Approval centre"
            eyebrow={`${summary.approvals.length} pending`}
            actions={<PanelLink href="/approvals">Open</PanelLink>}
          >
            <ApprovalList approvals={summary.approvals.slice(0, 3)} />
          </Panel>
          <UsagePanel usage={summary.usage} />
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-12 xl:items-start">
        <Panel
          id="live-view"
          className="xl:col-span-8"
          title="Live agent view"
          eyebrow="Sessions"
          actions={
            <>
              <MockBadge label="Mock" />
              <PanelLink href={withCompany("/live", slug)}>All sessions</PanelLink>
            </>
          }
        >
          <LiveSessionSwitcher sessions={sessions} />
        </Panel>
        <Panel
          id="activity"
          className="xl:col-span-4"
          title="Activity stream"
          eyebrow="Audit trail"
          actions={<PanelLink href={withCompany("/audit", slug)}>Audit log</PanelLink>}
          bodyClassName="max-h-[640px] overflow-y-auto p-4 sm:p-5"
        >
          <ActivityStream events={summary.activity} compact />
        </Panel>
      </div>

      <Panel
        id="current-tasks"
        className="mt-4"
        title="Current tasks"
        eyebrow={`${openTasks} open or failed`}
        actions={<PanelLink href={withCompany("/tasks/active", slug)}>Task board</PanelLink>}
        bodyClassName="p-0"
      >
        <TaskList tasks={summary.tasks} hierarchical emptyTitle="No open tasks" />
      </Panel>
    </div>
  );
}
