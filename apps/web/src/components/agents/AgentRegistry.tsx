"use client";

import { useMemo, useState } from "react";
import { Bot, Search } from "lucide-react";
import {
  AGENT_STATUSES,
  AUTONOMY_LABELS,
  APPROVAL_TYPE_LABELS,
  PROVIDER_LABELS,
  formatUsd,
  titleCase,
  type AgentDTO,
  type AgentStatus,
  type ApprovalType,
  type ProviderType,
} from "@aibos/shared";
import { AGENT_STATUS_META, EmptyState, MockBadge, StatusDot, StatusPill, cn } from "@aibos/ui";
import { AgentCompanies, ProviderTag } from "../dashboard/AgentCard";
import { Dialog } from "../common/Dialog";

export interface AgentFilterState {
  q: string;
  status: AgentStatus | "all";
  department: string;
  provider: ProviderType | "all";
}

export function filterAgents(agents: AgentDTO[], f: AgentFilterState): AgentDTO[] {
  const q = f.q.trim().toLowerCase();
  return agents.filter(
    (a) =>
      (f.status === "all" || a.status === f.status) &&
      (f.department === "all" || a.department?.slug === f.department) &&
      (f.provider === "all" || a.primaryProvider === f.provider) &&
      (!q ||
        a.name.toLowerCase().includes(q) ||
        (a.description ?? "").toLowerCase().includes(q) ||
        a.companies.some((c) => c.name.toLowerCase().includes(q))),
  );
}

const selectCls =
  "focus-ring h-9 rounded-lg border border-line bg-surface px-2.5 text-[13px] text-fg hover:border-line-strong";

export function AgentRegistry({
  agents,
  initialStatus,
  focusId,
}: {
  agents: AgentDTO[];
  initialStatus?: AgentStatus;
  focusId?: string;
}) {
  const [filters, setFilters] = useState<AgentFilterState>({
    q: "",
    status: initialStatus ?? "all",
    department: "all",
    provider: "all",
  });
  const [selected, setSelected] = useState<AgentDTO | null>(
    () => agents.find((a) => a.id === focusId) ?? null,
  );

  const departments = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of agents) if (a.department) m.set(a.department.slug, a.department.name);
    return [...m.entries()].sort((x, y) => x[1].localeCompare(y[1]));
  }, [agents]);
  const statusCounts = useMemo(() => {
    const c = new Map<AgentStatus, number>();
    for (const a of agents) c.set(a.status, (c.get(a.status) ?? 0) + 1);
    return c;
  }, [agents]);
  const visible = filterAgents(agents, filters);
  const update = (p: Partial<AgentFilterState>) => setFilters((f) => ({ ...f, ...p }));

  return (
    <div className="min-w-0 rounded-2xl border border-line bg-surface shadow-panel">
      <div className="space-y-3 border-b border-line/70 p-4 sm:px-5">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[200px] flex-1">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-faint"
              aria-hidden="true"
            />
            <input
              type="search"
              value={filters.q}
              onChange={(e) => update({ q: e.target.value })}
              placeholder="Search agents, descriptions or companies"
              aria-label="Search agents"
              className="focus-ring h-9 w-full rounded-lg border border-line bg-surface pl-9 pr-3 text-[13px] placeholder:text-fg-faint hover:border-line-strong"
            />
          </div>
          <select
            aria-label="Filter by department"
            className={selectCls}
            value={filters.department}
            onChange={(e) => update({ department: e.target.value })}
          >
            <option value="all">All departments</option>
            {departments.map(([slug, name]) => (
              <option key={slug} value={slug}>
                {name}
              </option>
            ))}
          </select>
          <select
            aria-label="Filter by provider"
            className={selectCls}
            value={filters.provider}
            onChange={(e) => update({ provider: e.target.value as AgentFilterState["provider"] })}
          >
            <option value="all">All providers</option>
            {(Object.keys(PROVIDER_LABELS) as ProviderType[]).map((p) => (
              <option key={p} value={p}>
                {PROVIDER_LABELS[p]}
              </option>
            ))}
          </select>
        </div>
        <div role="group" aria-label="Filter by status" className="flex flex-wrap gap-1.5">
          {(["all", ...AGENT_STATUSES.filter((s) => statusCounts.has(s))] as const).map((s) => {
            const active = filters.status === s;
            const count = s === "all" ? agents.length : (statusCounts.get(s) ?? 0);
            return (
              <button
                key={s}
                type="button"
                aria-pressed={active}
                onClick={() => update({ status: s })}
                className={cn(
                  "focus-ring inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[12px] font-medium transition-colors",
                  active
                    ? "border-accent bg-accent-soft text-accent"
                    : "border-line text-fg-muted hover:border-line-strong hover:text-fg",
                )}
              >
                {s !== "all" && <StatusDot tone={AGENT_STATUS_META[s].tone} />}
                {s === "all" ? "All" : AGENT_STATUS_META[s].label}
                <span className="num text-fg-faint">{count}</span>
              </button>
            );
          })}
        </div>
      </div>

      <p className="sr-only" role="status" aria-live="polite">
        {visible.length} agents shown
      </p>
      {visible.length === 0 ? (
        <EmptyState
          className="m-4"
          icon={<Bot className="size-5" />}
          title="No agents match these filters"
          description="Clear the search or choose another status."
        />
      ) : (
        <>
          <div
            className="hidden grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,1.6fr)_110px] gap-x-4 border-b border-line px-5 py-2 text-[11px] font-medium text-fg-faint lg:grid"
            aria-hidden="true"
          >
            <span>Agent</span>
            <span>Status</span>
            <span>Companies</span>
            <span>Current task</span>
            <span className="text-right">Provider</span>
          </div>
          <ul className="divide-y divide-line/70" aria-label="Agents">
            {visible.map((a) => {
              const meta = AGENT_STATUS_META[a.status];
              return (
                <li key={a.id}>
                  <button
                    type="button"
                    onClick={() => setSelected(a)}
                    className="focus-ring grid w-full grid-cols-1 gap-x-4 gap-y-2 px-4 py-3 text-left transition-colors hover:bg-surface-2/60 sm:px-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,1.6fr)_110px] lg:items-center"
                  >
                    <span className="min-w-0">
                      <span
                        className="block truncate text-[13.5px] font-semibold"
                        data-testid="agent-name"
                      >
                        {a.name}
                      </span>
                      <span className="block truncate text-[11.5px] text-fg-faint">
                        {a.department?.name ?? "Unassigned"} · {AUTONOMY_LABELS[a.autonomyLevel]}
                        {a.isTemporary && " · Temporary"}
                      </span>
                    </span>
                    <span>
                      <StatusPill tone={meta.tone} label={meta.label} pulse={meta.pulse} />
                    </span>
                    <span className="min-w-0">
                      <AgentCompanies agent={a} />
                    </span>
                    <span className="min-w-0 truncate text-[12.5px] text-fg-muted">
                      {a.currentTask?.title ?? "—"}
                    </span>
                    <span className="lg:text-right">
                      <ProviderTag provider={a.primaryProvider} />
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}

      <Dialog
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected?.name ?? "Agent"}
        description={selected?.description ?? undefined}
        side="right"
      >
        {selected && <AgentDetail agent={selected} />}
      </Dialog>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-line/70 px-5 py-4 last:border-0">
      <h3 className="eyebrow mb-2.5">{title}</h3>
      {children}
    </section>
  );
}

function Chips({ items, empty = "None" }: { items: string[]; empty?: string }) {
  if (!items.length) return <p className="text-[12.5px] text-fg-faint">{empty}</p>;
  return (
    <ul className="flex flex-wrap gap-1.5">
      {items.map((i) => (
        <li
          key={i}
          className="rounded-md bg-surface-2 px-2 py-0.5 text-[12px] ring-1 ring-inset ring-line"
        >
          {i}
        </li>
      ))}
    </ul>
  );
}

function AgentDetail({ agent: a }: { agent: AgentDTO }) {
  const meta = AGENT_STATUS_META[a.status];
  const facts: [string, React.ReactNode][] = [
    ["Status", <StatusPill key="s" tone={meta.tone} label={meta.label} pulse={meta.pulse} />],
    ["Template", titleCase(a.templateKey)],
    ["Scope", a.scope === "global" ? "Global (all companies)" : "Company"],
    ["Department", a.department?.name ?? "—"],
    ["Reports to", a.reportsTo?.name ?? "—"],
    ["Lifecycle", a.isTemporary ? "Temporary" : "Permanent"],
    ["Primary provider", PROVIDER_LABELS[a.primaryProvider]],
    ["Fallback", a.fallbackProvider ? PROVIDER_LABELS[a.fallbackProvider] : "—"],
    ["Preferred model", a.preferredModel ?? "Provider default"],
    ["Autonomy", AUTONOMY_LABELS[a.autonomyLevel]],
    ["Per-task budget", formatUsd(a.perTaskBudget)],
    ["Daily budget", formatUsd(a.dailyBudget)],
    ["Max searches", String(a.maxExternalSearches)],
    ["Max retries", String(a.maxRetries)],
    ["Concurrency", `${a.concurrencyLimit} task${a.concurrencyLimit === 1 ? "" : "s"}`],
  ];
  return (
    <div>
      {a.origin === "dev_seed" && (
        <div className="px-5 pt-4">
          <MockBadge label="Development seed agent" />
        </div>
      )}
      <Section title="Configuration">
        <dl className="grid grid-cols-1 gap-x-6 gap-y-2.5 text-[12.5px] sm:grid-cols-2">
          {facts.map(([k, v]) => (
            <div key={k} className="flex items-center justify-between gap-3 sm:block">
              <dt className="text-fg-faint">{k}</dt>
              <dd className="font-medium sm:mt-0.5">{v}</dd>
            </div>
          ))}
        </dl>
      </Section>
      <Section title="Company assignments">
        {a.companies.length ? (
          <ul className="space-y-1.5">
            {a.companies.map((c) => (
              <li key={c.id} className="flex items-center gap-2 text-[13px]">
                <span
                  className="size-2.5 rounded-[3px]"
                  style={{ background: c.accentColor ?? "#64748b" }}
                  aria-hidden="true"
                />
                {c.name}
                {c.isPrimary && (
                  <span className="rounded bg-accent-soft px-1.5 text-[10.5px] font-medium text-accent">
                    Primary
                  </span>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[12.5px] text-fg-faint">
            {a.scope === "global" ? "Serves every company as a global agent." : "Not assigned."}
          </p>
        )}
      </Section>
      <Section title="Responsibilities">
        <Chips items={a.responsibilities} />
      </Section>
      <Section title="Allowed tools">
        <Chips items={a.allowedTools} />
      </Section>
      <Section title="Requires approval for">
        <Chips
          items={a.approvalRequirements.map((t) => APPROVAL_TYPE_LABELS[t as ApprovalType] ?? t)}
        />
      </Section>
      <Section title="Prohibited actions">
        <ul className="list-disc space-y-1 pl-4 text-[12.5px] text-fg-muted">
          {a.prohibitedActions.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      </Section>
      <Section title="Permissions">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <p className="mb-1.5 text-[11.5px] text-fg-faint">Read</p>
            <Chips items={a.readPermissions} />
          </div>
          <div>
            <p className="mb-1.5 text-[11.5px] text-fg-faint">Write</p>
            <Chips items={a.writePermissions} empty="No write access" />
          </div>
        </div>
      </Section>
    </div>
  );
}
