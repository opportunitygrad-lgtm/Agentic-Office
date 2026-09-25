import type { DashboardSummaryDTO, LiveSessionDTO, ManagerStatsDTO } from "@aibos/shared";
import { PageError } from "@/components/common/PageError";
import { CommandCentreView } from "@/components/dashboard/CommandCentreView";
import { apiGet, apiTry, companyParam, type SearchParams } from "@/lib/api";

async function load(company?: string) {
  try {
    const [summary, live, manager] = await Promise.all([
      apiGet<DashboardSummaryDTO>("/v1/dashboard/summary", { company }),
      apiGet<{ data: LiveSessionDTO[] }>("/v1/live-sessions", { company }),
      apiTry<{ data: ManagerStatsDTO }>("/v1/workforce/manager-stats", { company }),
    ]);
    return { summary, sessions: live.data, manager: manager?.data ?? null, error: null };
  } catch (error) {
    return { summary: null, sessions: [], manager: null, error };
  }
}

export default async function CommandCentrePage({ searchParams }: { searchParams: SearchParams }) {
  const { summary, sessions, manager, error } = await load(await companyParam(searchParams));
  if (!summary) return <PageError error={error} />;
  return <CommandCentreView summary={summary} sessions={sessions} managerStats={manager} />;
}
