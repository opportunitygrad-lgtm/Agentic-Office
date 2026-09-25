import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import {
  AUTONOMY_LABELS,
  formatUsd,
  titleCase,
  type AgentDTO,
  type AgentKnowledgeProfileDTO,
  type MeDTO,
  type TaskDTO,
} from "@aibos/shared";
import { AGENT_STATUS_META, MockBadge, Panel, StatusPill, cn } from "@aibos/ui";
import { AgentAuthorityPanel } from "@/components/agents/AgentAuthorityPanel";
import { PageError } from "@/components/common/PageError";
import { Unauthorised } from "@/components/common/Unauthorised";
import { ContextPreview } from "@/components/context/ContextPreview";
import { KnowledgeProfilePanel } from "@/components/context/KnowledgeProfilePanel";
import { AgentChatShell } from "@/components/workforce/AgentChatShell";
import { AgentStructurePanel } from "@/components/workforce/AgentStructurePanel";
import { InstructionPreview } from "@/components/workforce/InstructionPreview";
import { RoleEditor } from "@/components/workforce/RoleEditor";
import { apiGet, apiTry, type SearchParams } from "@/lib/api";
import { formatDateTime } from "@/lib/format";

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "role", label: "Role & Instructions" },
  { key: "instructions", label: "Instruction Preview" },
  { key: "context", label: "Context" },
  { key: "chat", label: "Chat" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

export const metadata = { title: "Agent detail" };

const can = (me: MeDTO, permission: string, companyId: string) =>
  me.globalPermissions.includes(permission) ||
  (me.companyPermissions[companyId]?.includes(permission) ?? false);

export default async function AgentDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: SearchParams;
}) {
  const { id } = await params;
  const sp = await searchParams;
  let agent: AgentDTO;
  let me: MeDTO;
  try {
    [agent, me] = await Promise.all([
      apiGet<{ data: AgentDTO }>(`/v1/agents/${id}`).then((r) => r.data),
      apiGet<MeDTO>("/v1/auth/me"),
    ]);
  } catch (e) {
    return <PageError error={e} />;
  }
  const [profile, tasks] = await Promise.all([
    apiTry<{ data: AgentKnowledgeProfileDTO }>(`/v1/agents/${id}/knowledge-profile`),
    apiTry<{ data: TaskDTO[] }>("/v1/tasks", { limit: "200" }),
  ]);
  const serving = agent.scope === "global" ? me.accessibleCompanies : agent.companies;
  const previewable = serving
    .filter((c) => can(me, "context.preview", c.id))
    .map((c) => ({ slug: c.slug, name: c.name }));
  const requested = typeof sp.company === "string" ? sp.company : undefined;
  const tab: TabKey = TABS.some((t) => t.key === sp.tab) ? (sp.tab as TabKey) : "overview";
  const meta = AGENT_STATUS_META[agent.status];
  const canAll = (permission: string) =>
    me.globalPermissions.includes(permission) ||
    (agent.scope !== "global" &&
      agent.companies.length > 0 &&
      agent.companies.every((c) => can(me, permission, c.id)));
  const canEdit = canAll("agent.edit");
  const roleCompanies = serving
    .filter((c) => can(me, "agent.role.view", c.id))
    .map((c) => ({ slug: c.slug, name: c.name }));
  const chatCompanies = serving
    .filter((c) => can(me, "conversation.create", c.id))
    .map((c) => ({ id: c.id, name: c.name }));
  const taskOptions = (tasks?.data ?? [])
    .filter((t) => t.company)
    .map((t) => ({ id: t.id, title: t.title, companySlug: t.company!.slug }));

  return (
    <div className="mx-auto max-w-[1680px]">
      <Link
        href="/workforce/agents"
        className="focus-ring mb-3 inline-flex items-center gap-1 rounded text-[12.5px] text-fg-muted hover:text-fg"
      >
        <ArrowLeft className="size-3.5" aria-hidden="true" /> Agent registry
      </Link>
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="eyebrow">AI Workforce · {titleCase(agent.templateKey)}</p>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-[22px] font-semibold tracking-tight">{agent.name}</h1>
            <StatusPill tone={meta.tone} label={meta.label} pulse={meta.pulse} />
            {agent.origin === "dev_seed" && <MockBadge label="Dev seed agent" />}
          </div>
          <p className="mt-0.5 text-[13px] text-fg-muted">
            {agent.department?.name ?? "No department"} · {AUTONOMY_LABELS[agent.autonomyLevel]} ·{" "}
            {agent.scope === "global"
              ? "Global agent"
              : agent.companies.map((c) => c.name).join(", ")}
          </p>
        </div>
      </div>

      <nav
        aria-label="Agent sections"
        className="mb-5 flex gap-1 overflow-x-auto border-b border-line"
      >
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/workforce/agents/${agent.id}?tab=${t.key}${requested ? `&company=${requested}` : ""}`}
            aria-current={tab === t.key ? "page" : undefined}
            className={cn(
              "focus-ring -mb-px whitespace-nowrap border-b-2 px-3 py-2 text-[13px] font-medium",
              tab === t.key
                ? "border-accent text-fg"
                : "border-transparent text-fg-muted hover:text-fg",
            )}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {tab === "overview" && (
        <div className="grid grid-cols-1 gap-5 2xl:grid-cols-[minmax(0,1fr)_400px]">
          <div className="min-w-0 space-y-5">
            <Panel title="Workload" eyebrow="Derived from assigned tasks">
              <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  ["Active", agent.workload.active],
                  ["Queued", agent.workload.queued],
                  ["Capacity", agent.workload.capacity],
                  ["Completed (7d)", agent.workload.completedRecent],
                ].map(([k, v]) => (
                  <div key={String(k)} className="rounded-xl border border-line p-3">
                    <dt className="text-[11px] text-fg-faint">{k}</dt>
                    <dd className="num text-[18px] font-semibold">{v}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-3 text-[12.5px] text-fg-muted">
                {agent.currentTask ? (
                  <>
                    Current task:{" "}
                    <Link
                      className="font-medium text-fg hover:underline"
                      href={`/tasks/item/${agent.currentTask.id}`}
                    >
                      {agent.currentTask.title}
                    </Link>
                  </>
                ) : (
                  "No current task."
                )}
                {" · "}Teams: {agent.teams.map((t) => t.name).join(", ") || "none"}
                {" · "}Per-task budget {formatUsd(agent.perTaskBudget)}
              </p>
              {agent.isTemporary && (
                <p className="mt-2 rounded-lg bg-surface-2 px-3 py-2 text-[12.5px] text-fg-muted">
                  Temporary worker under {agent.parentAgent?.name ?? "—"} ·{" "}
                  {agent.purpose ?? "No purpose recorded"} · expires{" "}
                  {formatDateTime(agent.expiresAt)}
                </p>
              )}
            </Panel>
            <Panel title="Hierarchy & capabilities">
              <AgentStructurePanel
                agent={agent}
                canEditHierarchy={canEdit && !agent.isTemporary}
                canEditCapabilities={canAll("agent.role.manage") && !agent.isTemporary}
              />
            </Panel>
          </div>
          <div className="space-y-5">
            <Panel title="Access & Authority">
              <AgentAuthorityPanel agentId={agent.id} />
            </Panel>
            {profile && (
              <KnowledgeProfilePanel agentId={agent.id} profile={profile.data} canEdit={canEdit} />
            )}
          </div>
        </div>
      )}

      {tab === "role" && <RoleEditor agentId={agent.id} />}

      {tab === "instructions" && (
        <section aria-labelledby="instructions-heading">
          <h2 id="instructions-heading" className="mb-1 text-[16px] font-semibold tracking-tight">
            Instruction preview
          </h2>
          <p className="mb-3 text-[13px] text-fg-muted">
            The compiled instruction stack, highest priority first. Lower layers never override
            higher ones; permissions and company policy win every conflict. No AI provider is
            called.
          </p>
          <InstructionPreview agentId={agent.id} companies={roleCompanies} tasks={taskOptions} />
        </section>
      )}

      {tab === "context" && (
        <section aria-labelledby="context-heading" className="min-w-0">
          <h2 id="context-heading" className="mb-1 text-[16px] font-semibold tracking-tight">
            Context preview
          </h2>
          <p className="mb-3 text-[13px] text-fg-muted">
            What this agent would know if it ran now — assembled deterministically from approved
            company knowledge, rules, handoffs and its permissions.
          </p>
          {previewable.length ? (
            <ContextPreview
              target={{ agentId: agent.id }}
              companies={previewable}
              defaultCompany={previewable.find((c) => c.slug === requested)?.slug}
              tasks={(tasks?.data ?? []).filter((t) => t.company)}
            />
          ) : (
            <Unauthorised
              title="No context preview access"
              message="You need the Preview agent context permission for a company this agent serves."
            />
          )}
        </section>
      )}

      {tab === "chat" && <AgentChatShell agentId={agent.id} companies={chatCompanies} />}
    </div>
  );
}
