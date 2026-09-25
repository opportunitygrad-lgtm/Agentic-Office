import Link from "next/link";
import type { OrgChartDTO } from "@aibos/shared";
import { PageError } from "@/components/common/PageError";
import { PageHeader } from "@/components/common/PageHeader";
import { OrgChart } from "@/components/workforce/OrgChart";
import { apiGet, companyParam, type SearchParams } from "@/lib/api";

export const metadata = { title: "Organisation chart" };

export default async function OrganisationPage({ searchParams }: { searchParams: SearchParams }) {
  const company = await companyParam(searchParams);
  let chart: OrgChartDTO;
  try {
    chart = (await apiGet<{ data: OrgChartDTO }>("/v1/workforce/org", { company })).data;
  } catch (e) {
    return <PageError error={e} />;
  }
  return (
    <div className="mx-auto max-w-[1680px]">
      <PageHeader
        eyebrow="AI Workforce"
        title="Organisation chart"
        description="Group manager → company managers → departments → teams and specialists → temporary workers. Status and workload are derived from real task assignments."
        actions={
          <Link
            href="/workforce/teams"
            className="focus-ring inline-flex h-9 items-center rounded-lg px-3 text-sm font-medium ring-1 ring-inset ring-line hover:bg-surface-2"
          >
            Teams & departments
          </Link>
        }
      />
      <OrgChart chart={chart} />
    </div>
  );
}
