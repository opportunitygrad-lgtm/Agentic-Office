import Link from "next/link";
import { AGENT_STATUSES, type AgentDTO, type AgentStatus } from "@aibos/shared";
import { AgentRegistry } from "@/components/agents/AgentRegistry";
import { PageError } from "@/components/common/PageError";
import { PageHeader } from "@/components/common/PageHeader";
import { apiGet, companyParam, type SearchParams } from "@/lib/api";

export const metadata = { title: "Agents" };

export default async function AgentsPage({ searchParams }: { searchParams: SearchParams }) {
  const company = await companyParam(searchParams);
  const sp = await searchParams;
  const status =
    typeof sp.status === "string" && (AGENT_STATUSES as readonly string[]).includes(sp.status)
      ? (sp.status as AgentStatus)
      : undefined;
  const focus = typeof sp.focus === "string" ? sp.focus : undefined;
  let agents: AgentDTO[];
  try {
    agents = (await apiGet<{ data: AgentDTO[] }>("/v1/agents", { company })).data;
  } catch (e) {
    return <PageError error={e} />;
  }
  return (
    <div className="mx-auto max-w-[1680px]">
      <PageHeader
        eyebrow="AI Workforce"
        title="Agent Registry"
        description="Every agent, its company assignments, provider routing, autonomy and guardrails. Agents are independent of companies and can serve one, several or all."
        devData={agents.some((a) => a.origin === "dev_seed")}
        actions={
          <Link
            href="/workforce/templates"
            className="focus-ring inline-flex h-9 items-center rounded-lg px-3 text-sm font-medium ring-1 ring-inset ring-line hover:bg-surface-2"
          >
            Agent templates
          </Link>
        }
      />
      <AgentRegistry
        key={`${company ?? "all"}-${status ?? ""}`}
        agents={agents}
        initialStatus={status}
        focusId={focus}
      />
    </div>
  );
}
