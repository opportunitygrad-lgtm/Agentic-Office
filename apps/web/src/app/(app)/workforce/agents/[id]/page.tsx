import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import {
  AUTONOMY_LABELS,
  titleCase,
  type AgentDTO,
  type AgentKnowledgeProfileDTO,
  type MeDTO,
  type TaskDTO,
} from "@aibos/shared";
import { AGENT_STATUS_META, MockBadge, Panel, StatusPill } from "@aibos/ui";
import { AgentAuthorityPanel } from "@/components/agents/AgentAuthorityPanel";
import { PageError } from "@/components/common/PageError";
import { Unauthorised } from "@/components/common/Unauthorised";
import { ContextPreview } from "@/components/context/ContextPreview";
import { KnowledgeProfilePanel } from "@/components/context/KnowledgeProfilePanel";
import { apiGet, apiTry, type SearchParams } from "@/lib/api";

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
  const meta = AGENT_STATUS_META[agent.status];
  const canEdit =
    me.globalPermissions.includes("agent.edit") ||
    (agent.scope !== "global" &&
      agent.companies.length > 0 &&
      agent.companies.every((c) => can(me, "agent.edit", c.id)));

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

      <div className="grid grid-cols-1 gap-5 2xl:grid-cols-[minmax(0,1fr)_400px]">
        <section aria-labelledby="context-heading" className="min-w-0">
          <h2 id="context-heading" className="mb-1 text-[16px] font-semibold tracking-tight">
            Context preview
          </h2>
          <p className="mb-3 text-[13px] text-fg-muted">
            What this agent would know if it ran now — assembled deterministically from approved
            company knowledge, rules and its permissions.
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
        <div className="space-y-5">
          <Panel title="Access & Authority">
            <AgentAuthorityPanel agentId={agent.id} />
          </Panel>
          {profile && (
            <KnowledgeProfilePanel agentId={agent.id} profile={profile.data} canEdit={canEdit} />
          )}
        </div>
      </div>
    </div>
  );
}
