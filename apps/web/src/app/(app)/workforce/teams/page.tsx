import type { AgentDTO, DepartmentDTO } from "@aibos/shared";
import { AGENT_STATUS_META, Panel, StatusDot } from "@aibos/ui";
import { PageError } from "@/components/common/PageError";
import { PageHeader } from "@/components/common/PageHeader";
import { apiGet, companyParam, type SearchParams } from "@/lib/api";

export const metadata = { title: "Teams & departments" };

export default async function TeamsPage({ searchParams }: { searchParams: SearchParams }) {
  const company = await companyParam(searchParams);
  let departments: DepartmentDTO[];
  let agents: AgentDTO[];
  try {
    [departments, agents] = await Promise.all([
      apiGet<{ data: DepartmentDTO[] }>("/v1/departments", { company }).then((r) => r.data),
      apiGet<{ data: AgentDTO[] }>("/v1/agents", { company }).then((r) => r.data),
    ]);
  } catch (e) {
    return <PageError error={e} />;
  }
  return (
    <div className="mx-auto max-w-[1680px]">
      <PageHeader
        eyebrow="AI Workforce"
        title="Teams & departments"
        description="Departments organise agents. Global departments are shared by every company; company-specific departments can be added per business."
      />
      <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {departments.map((d) => {
          const members = agents.filter((a) => a.department?.id === d.id);
          return (
            <li key={d.id}>
              <Panel className="h-full" bodyClassName="p-5">
                <div className="flex items-center gap-3">
                  <span
                    className="size-9 shrink-0 rounded-xl"
                    style={{
                      background: `linear-gradient(135deg, ${d.color ?? "#64748b"}, ${d.color ?? "#64748b"}99)`,
                    }}
                    aria-hidden="true"
                  />
                  <div className="min-w-0 flex-1">
                    <h2 className="text-[15px] font-semibold tracking-tight">{d.name}</h2>
                    <p className="truncate text-[12px] text-fg-muted">{d.description}</p>
                  </div>
                  <span className="num text-[20px] font-semibold">{members.length}</span>
                </div>
                <p className="mt-2 text-[11px] text-fg-faint">
                  {d.companyId ? "Company department" : "Global department"}
                </p>
                {members.length > 0 ? (
                  <ul className="mt-3 space-y-1.5 border-t border-line/70 pt-3">
                    {members.map((a) => (
                      <li key={a.id} className="flex items-center gap-2 text-[12.5px]">
                        <StatusDot
                          tone={AGENT_STATUS_META[a.status].tone}
                          pulse={AGENT_STATUS_META[a.status].pulse}
                        />
                        <span className="flex-1 truncate">{a.name}</span>
                        <span className="text-[11px] text-fg-faint">
                          {AGENT_STATUS_META[a.status].label}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-3 border-t border-line/70 pt-3 text-[12.5px] text-fg-faint">
                    No agents in this scope.
                  </p>
                )}
              </Panel>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
