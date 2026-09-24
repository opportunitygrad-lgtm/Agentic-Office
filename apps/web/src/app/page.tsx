import type { DashboardSummaryDTO, LiveSessionDTO } from "@aibos/shared";
import { ApiOffline } from "@/components/common/ApiOffline";
import { CommandCentreView } from "@/components/dashboard/CommandCentreView";
import { apiGet, companyParam, type SearchParams } from "@/lib/api";

async function load(company?: string) {
  try {
    const [summary, live] = await Promise.all([
      apiGet<DashboardSummaryDTO>("/v1/dashboard/summary", { company }),
      apiGet<{ data: LiveSessionDTO[] }>("/v1/live-sessions", { company }),
    ]);
    return { summary, sessions: live.data, error: null };
  } catch (err) {
    return {
      summary: null,
      sessions: [],
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

export default async function CommandCentrePage({ searchParams }: { searchParams: SearchParams }) {
  const { summary, sessions, error } = await load(await companyParam(searchParams));
  if (!summary) return <ApiOffline detail={error ?? undefined} />;
  return <CommandCentreView summary={summary} sessions={sessions} />;
}
