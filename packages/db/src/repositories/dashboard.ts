import { sql } from "drizzle-orm";
import {
  AGENT_STATUSES,
  OPEN_TASK_STATUSES,
  type AgentDTO,
  type AlertDTO,
  type DashboardSummaryDTO,
  type WorkforceCounts,
} from "@aibos/shared";
import type { Database } from "../client";
import { agents, approvals, auditEvents, tasks } from "../schema";
import { listAgents } from "./agents";
import { listApprovals } from "./approvals";
import { listAuditEvents } from "./audit";
import { listCompanySummaries, resolveCompany, toCompanyRef } from "./companies";
import { listTasks } from "./tasks";
import { usageSummary } from "./usage";

const ACTIVE_ORDER: Record<string, number> = {
  working: 0,
  needs_approval: 1,
  waiting: 2,
  blocked: 3,
  queued: 4,
  failed: 5,
  paused: 6,
  sleeping: 7,
  completed: 8,
  offline: 9,
};

export function countWorkforce(list: Pick<AgentDTO, "status">[]): WorkforceCounts {
  const counts = Object.fromEntries(AGENT_STATUSES.map((s) => [s, 0])) as WorkforceCounts;
  counts.total = list.length;
  for (const a of list) counts[a.status] += 1;
  return counts;
}

/** Everything the Command Centre needs in one round-trip. */
export async function dashboardSummary(
  db: Database,
  companyRef?: string | null,
): Promise<DashboardSummaryDTO> {
  const scope = await resolveCompany(db, companyRef);
  const companyId = scope?.id ?? null;

  const [companies, agentList, taskList, approvalList, activity, usage, seedCheck] =
    await Promise.all([
      listCompanySummaries(db),
      listAgents(db, { companyId }),
      listTasks(db, { companyId, statuses: [...OPEN_TASK_STATUSES, "failed"], limit: 50 }),
      listApprovals(db, { companyId, status: "pending", limit: 20 }),
      listAuditEvents(db, { companyId, limit: 30 }),
      usageSummary(db, companyId),
      db.execute<{ seeded: boolean }>(sql`select (
      exists(select 1 from ${agents} where ${agents.origin} = 'dev_seed') or
      exists(select 1 from ${tasks} where ${tasks.origin} = 'dev_seed') or
      exists(select 1 from ${approvals} where ${approvals.origin} = 'dev_seed') or
      exists(select 1 from ${auditEvents} where ${auditEvents.origin} = 'dev_seed')
    ) as seeded`),
    ]);

  const sortedAgents = [...agentList].sort(
    (a, b) => (ACTIVE_ORDER[a.status] ?? 9) - (ACTIVE_ORDER[b.status] ?? 9),
  );

  const alerts: AlertDTO[] = [];
  for (const a of agentList.filter((x) => x.status === "blocked" || x.status === "failed")) {
    alerts.push({
      id: `agent-${a.id}`,
      severity: a.status === "failed" ? "critical" : "warning",
      title: `${a.name} is ${a.status}`,
      detail: a.currentTask?.title ?? "No active task",
      href: `/workforce/agents?focus=${a.id}`,
      company: a.companies[0] ?? null,
    });
  }
  for (const t of taskList.filter((x) => x.status === "failed")) {
    alerts.push({
      id: `task-${t.id}`,
      severity: "critical",
      title: `Task failed: ${t.title}`,
      detail: t.error ?? "Unknown error",
      href: "/tasks/failed",
      company: t.company,
    });
  }
  for (const ap of approvalList.filter(
    (x) => x.riskLevel === "high" || x.riskLevel === "critical",
  )) {
    alerts.push({
      id: `approval-${ap.id}`,
      severity: "warning",
      title: `${ap.riskLevel === "critical" ? "Critical" : "High-risk"} approval waiting`,
      detail: ap.requestedAction,
      href: "/approvals",
      company: ap.company,
    });
  }
  if (usage.dailyBudgetUsd > 0 && usage.todayUsd >= usage.dailyBudgetUsd * 0.8) {
    alerts.push({
      id: "budget-daily",
      severity: usage.todayUsd >= usage.dailyBudgetUsd ? "critical" : "warning",
      title: "Daily AI budget above 80%",
      detail: `${usage.todayUsd.toFixed(2)} of ${usage.dailyBudgetUsd.toFixed(2)} USD used today`,
      href: "/analytics",
      company: null,
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    scope: scope ? toCompanyRef(scope) : null,
    companies,
    workforce: countWorkforce(agentList),
    agents: sortedAgents,
    tasks: taskList,
    approvals: approvalList,
    activity,
    usage,
    alerts,
    containsDevSeedData: Boolean(seedCheck[0]?.seeded),
  };
}
