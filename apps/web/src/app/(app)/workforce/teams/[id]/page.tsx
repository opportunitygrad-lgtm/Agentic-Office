import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { titleCase, type AgentDTO, type TeamDetailDTO } from "@aibos/shared";
import {
  AGENT_STATUS_META,
  MockBadge,
  Monogram,
  Panel,
  StatusPill,
  TASK_STATUS_META,
  TONE_CLASSES,
  cn,
} from "@aibos/ui";
import { PageError } from "@/components/common/PageError";
import { ManageTeamButton } from "@/components/workforce/TeamDialogs";
import { apiGet } from "@/lib/api";
import { formatDateTime } from "@/lib/format";

export const metadata = { title: "Team" };

export default async function TeamDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let team: TeamDetailDTO;
  try {
    team = (await apiGet<{ data: TeamDetailDTO }>(`/v1/teams/${id}`)).data;
  } catch (e) {
    return <PageError error={e} />;
  }
  const agents = team.viewerCanManage
    ? (
        await apiGet<{ data: AgentDTO[] }>("/v1/agents", { company: team.company?.slug }).catch(
          () => ({ data: [] as AgentDTO[] }),
        )
      ).data
    : [];
  return (
    <div className="mx-auto max-w-[1680px]">
      <Link
        href="/workforce/teams"
        className="focus-ring mb-3 inline-flex items-center gap-1 rounded text-[12.5px] text-fg-muted hover:text-fg"
      >
        <ArrowLeft className="size-3.5" aria-hidden="true" /> Teams & departments
      </Link>
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <Monogram
            name={team.company?.name ?? "Global"}
            color={team.company?.accentColor}
            size="lg"
          />
          <div className="min-w-0">
            <p className="eyebrow">
              Team · {team.company?.name ?? "Global"}
              {team.department && ` · ${team.department.name}`}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-[22px] font-semibold tracking-tight">{team.name}</h1>
              <StatusPill
                tone={team.active ? "live" : "idle"}
                label={team.active ? "Active" : "Inactive"}
              />
              {team.isTemporary && <StatusPill tone="info" label="Temporary team" />}
              {team.origin === "dev_seed" && <MockBadge label="Dev seed team" />}
            </div>
            {team.purpose && <p className="mt-0.5 text-[13px] text-fg-muted">{team.purpose}</p>}
          </div>
        </div>
        {team.viewerCanManage && (
          <ManageTeamButton
            teamId={team.id}
            companyId={team.company?.id ?? null}
            agents={agents}
            members={team.members.map((m) => m.id)}
            leaderId={team.leader?.id ?? null}
            active={team.active}
          />
        )}
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-5">
          <Panel
            title="Members & workload"
            eyebrow={`${team.members.length} members · ${team.activeTasks}/${team.concurrencyLimit} team tasks active`}
          >
            {team.members.length === 0 ? (
              <p className="text-[12.5px] text-fg-muted">No members.</p>
            ) : (
              <ul className="divide-y divide-line/70">
                {team.members.map((m) => {
                  const meta = AGENT_STATUS_META[m.status];
                  const load = Math.min(1, m.workload.load);
                  return (
                    <li
                      key={m.id}
                      className="grid grid-cols-1 gap-2 py-2.5 sm:grid-cols-[minmax(0,1fr)_120px_160px] sm:items-center"
                    >
                      <span className="min-w-0">
                        <Link
                          href={`/workforce/agents/${m.id}`}
                          className="block truncate text-[13px] font-semibold hover:underline"
                        >
                          {m.name}
                          {m.isLeader && (
                            <span className="ml-1.5 rounded bg-accent-soft px-1 text-[10.5px] font-medium text-accent">
                              Leader
                            </span>
                          )}
                        </Link>
                        <span className="text-[11.5px] text-fg-faint">
                          {titleCase(m.templateKey)}
                          {m.isTemporary && " · Temporary"}
                        </span>
                      </span>
                      <StatusPill tone={meta.tone} label={meta.label} pulse={meta.pulse} />
                      <span className="flex items-center gap-2" title="Active tasks / capacity">
                        <span
                          className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3"
                          aria-hidden="true"
                        >
                          <span
                            className={cn(
                              "block h-full rounded-full",
                              TONE_CLASSES[load >= 1 ? "attention" : "live"].bar,
                            )}
                            style={{ width: `${load * 100}%` }}
                          />
                        </span>
                        <span className="num text-[11.5px] text-fg-muted">
                          {m.workload.active}/{m.workload.capacity} · {m.workload.queued} queued
                        </span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>
          <Panel title="Team tasks">
            {team.tasks.length === 0 ? (
              <p className="text-[12.5px] text-fg-muted">No tasks delegated to this team yet.</p>
            ) : (
              <ul className="divide-y divide-line/70">
                {team.tasks.map((t) => {
                  const meta = TASK_STATUS_META[t.status];
                  return (
                    <li key={t.id} className="flex items-center gap-3 py-2">
                      <Link
                        href={`/tasks/item/${t.id}`}
                        className="min-w-0 flex-1 truncate text-[13px] hover:underline"
                      >
                        {t.title}
                      </Link>
                      <StatusPill tone={meta.tone} label={meta.label} />
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>
        </div>
        <div className="space-y-5">
          <Panel title="Operating rules">
            <dl className="space-y-2 text-[12.5px]">
              <div>
                <dt className="text-fg-faint">Leader</dt>
                <dd className="font-medium">{team.leader?.name ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-fg-faint">Concurrency</dt>
                <dd className="font-medium">{team.concurrencyLimit} tasks at once</dd>
              </div>
              <div>
                <dt className="text-fg-faint">Default task types</dt>
                <dd className="font-medium">
                  {team.defaultTaskTypes.map(titleCase).join(", ") || "Any"}
                </dd>
              </div>
              <div>
                <dt className="text-fg-faint">Handoff destinations</dt>
                <dd className="font-medium">{team.handoffDestinations.join(", ") || "—"}</dd>
              </div>
              {team.expiresAt && (
                <div>
                  <dt className="text-fg-faint">Expires</dt>
                  <dd className="font-medium">{formatDateTime(team.expiresAt)}</dd>
                </div>
              )}
            </dl>
          </Panel>
          <Panel title="Recent activity">
            {team.activity.length === 0 ? (
              <p className="text-[12.5px] text-fg-muted">No recorded changes.</p>
            ) : (
              <ol className="space-y-2">
                {team.activity.map((a) => (
                  <li key={a.id} className="text-[12.5px]">
                    <p>{a.description}</p>
                    <p className="text-[11px] text-fg-faint">
                      {a.actor ?? "System"} · {formatDateTime(a.occurredAt)}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}
