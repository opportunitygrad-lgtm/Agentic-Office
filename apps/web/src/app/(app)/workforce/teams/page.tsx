import Link from "next/link";
import { Users } from "lucide-react";
import {
  PROVIDER_LABELS,
  formatUsd,
  titleCase,
  type AgentDTO,
  type DepartmentDetailDTO,
  type MeDTO,
  type TeamDTO,
} from "@aibos/shared";
import { AGENT_STATUS_META, EmptyState, MockBadge, Monogram, Panel, StatusDot } from "@aibos/ui";
import { PageError } from "@/components/common/PageError";
import { PageHeader } from "@/components/common/PageHeader";
import { CreateTeamButton, EditDepartmentButton } from "@/components/workforce/TeamDialogs";
import { apiGet, companyParam, type SearchParams } from "@/lib/api";

export const metadata = { title: "Teams & departments" };

export default async function TeamsPage({ searchParams }: { searchParams: SearchParams }) {
  const company = await companyParam(searchParams);
  let departments: DepartmentDetailDTO[];
  let teams: TeamDTO[];
  let agents: AgentDTO[];
  let me: MeDTO;
  try {
    [departments, teams, agents, me] = await Promise.all([
      apiGet<{ data: DepartmentDetailDTO[] }>("/v1/workforce/departments", { company }).then(
        (r) => r.data,
      ),
      apiGet<{ data: TeamDTO[] }>("/v1/teams", { company }).then((r) => r.data),
      apiGet<{ data: AgentDTO[] }>("/v1/agents", { company }).then((r) => r.data),
      apiGet<MeDTO>("/v1/auth/me"),
    ]);
  } catch (e) {
    return <PageError error={e} />;
  }
  const live = agents.filter((a) => a.status !== "terminated" && a.status !== "expired");
  return (
    <div className="mx-auto max-w-[1680px]">
      <PageHeader
        eyebrow="AI Workforce"
        title="Teams & departments"
        description="Teams group agents around a purpose inside one company; departments organise agents by function. Global departments are shared by every company."
        devData={teams.some((t) => t.origin === "dev_seed")}
        actions={
          <CreateTeamButton
            companies={me.accessibleCompanies.map((c) => ({ id: c.id, name: c.name }))}
            agents={live}
            departments={departments}
          />
        }
      />

      <section aria-labelledby="teams-heading" className="mb-8">
        <h2 id="teams-heading" className="mb-3 text-[16px] font-semibold tracking-tight">
          Teams
        </h2>
        {teams.length === 0 ? (
          <EmptyState
            icon={<Users className="size-5" />}
            title="No teams yet"
            description="Create a team to group agents around a shared purpose."
          />
        ) : (
          <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {teams.map((t) => (
              <li key={t.id}>
                <Link
                  href={`/workforce/teams/${t.id}`}
                  className="focus-ring block h-full rounded-2xl"
                >
                  <Panel
                    className="h-full transition-colors hover:border-line-strong"
                    bodyClassName="p-5"
                  >
                    <div className="flex items-start gap-3">
                      {t.company ? (
                        <Monogram name={t.company.name} color={t.company.accentColor} />
                      ) : (
                        <Monogram name="Global" />
                      )}
                      <div className="min-w-0 flex-1">
                        <h3 className="truncate text-[15px] font-semibold tracking-tight">
                          {t.name}
                        </h3>
                        <p className="text-[12px] text-fg-muted">
                          {t.company?.name ?? "Global team"}
                          {t.department && ` · ${t.department.name}`}
                        </p>
                      </div>
                      {!t.active && (
                        <span className="rounded bg-surface-2 px-1.5 text-[11px] text-fg-muted">
                          Inactive
                        </span>
                      )}
                      {t.origin === "dev_seed" && <MockBadge label="Seed" />}
                    </div>
                    {t.purpose && (
                      <p className="mt-2 line-clamp-2 text-[12.5px] text-fg-muted">{t.purpose}</p>
                    )}
                    <dl className="mt-3 grid grid-cols-3 gap-2 border-t border-line/70 pt-3 text-[12px]">
                      <div>
                        <dt className="text-fg-faint">Members</dt>
                        <dd className="num font-semibold">{t.memberCount}</dd>
                      </div>
                      <div>
                        <dt className="text-fg-faint">Active tasks</dt>
                        <dd className="num font-semibold">
                          {t.activeTasks}/{t.concurrencyLimit}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-fg-faint">Leader</dt>
                        <dd className="truncate font-medium">{t.leader?.name ?? "—"}</dd>
                      </div>
                    </dl>
                    {t.defaultTaskTypes.length > 0 && (
                      <p className="mt-2 text-[11.5px] text-fg-faint">
                        Handles: {t.defaultTaskTypes.map(titleCase).join(", ")}
                      </p>
                    )}
                  </Panel>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="departments-heading">
        <h2 id="departments-heading" className="mb-3 text-[16px] font-semibold tracking-tight">
          Departments
        </h2>
        <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {departments.map((d) => {
            const members = live.filter((a) => a.department?.id === d.id);
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
                      <h3 className="text-[15px] font-semibold tracking-tight">{d.name}</h3>
                      <p className="truncate text-[12px] text-fg-muted">
                        {d.mission ?? d.description}
                      </p>
                    </div>
                    <EditDepartmentButton department={d} agents={live} />
                  </div>
                  <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-[12px]">
                    <div>
                      <dt className="text-fg-faint">Scope</dt>
                      <dd className="font-medium">{d.company ? d.company.name : "Global"}</dd>
                    </div>
                    <div>
                      <dt className="text-fg-faint">Manager</dt>
                      <dd className="truncate font-medium">
                        {d.managerAgent?.name ?? d.humanManager?.name ?? "—"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-fg-faint">Concurrency</dt>
                      <dd className="num font-medium">
                        {d.activeTasks}/{d.concurrencyLimit ?? "∞"} active
                      </dd>
                    </div>
                    <div>
                      <dt className="text-fg-faint">Budget · provider</dt>
                      <dd className="font-medium">
                        {d.dailyBudgetUsd != null
                          ? `${formatUsd(d.dailyBudgetUsd)}/day`
                          : "Company"}{" "}
                        · {d.defaultProvider ? PROVIDER_LABELS[d.defaultProvider] : "Default"}
                      </dd>
                    </div>
                  </dl>
                  {!d.active && (
                    <p className="mt-2 text-[11.5px] font-medium text-amber-600">
                      Inactive — receives no new work
                    </p>
                  )}
                  {d.handoffDestinations.length > 0 && (
                    <p className="mt-2 text-[11.5px] text-fg-faint">
                      Hands off to: {d.handoffDestinations.join(", ")}
                    </p>
                  )}
                  {members.length > 0 ? (
                    <ul className="mt-3 space-y-1.5 border-t border-line/70 pt-3">
                      {members.map((a) => (
                        <li key={a.id} className="flex items-center gap-2 text-[12.5px]">
                          <StatusDot
                            tone={AGENT_STATUS_META[a.status].tone}
                            pulse={AGENT_STATUS_META[a.status].pulse}
                          />
                          <Link
                            href={`/workforce/agents/${a.id}`}
                            className="flex-1 truncate hover:underline"
                          >
                            {a.name}
                          </Link>
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
      </section>
    </div>
  );
}
