import Link from "next/link";
import type { ReactNode } from "react";
import { Building2, Users } from "lucide-react";
import { AUTONOMY_LABELS, titleCase, type OrgAgentNode, type OrgChartDTO } from "@aibos/shared";
import { AGENT_STATUS_META, Monogram, StatusDot, TONE_CLASSES, cn } from "@aibos/ui";

/** One agent card: status, role, autonomy and live workload (derived from tasks). */
export function OrgNode({ node, leader }: { node: OrgAgentNode; leader?: boolean }) {
  const meta = AGENT_STATUS_META[node.status];
  const load = Math.min(1, node.workload.load);
  return (
    <Link
      href={`/workforce/agents/${node.id}`}
      data-testid="org-node"
      className={cn(
        "focus-ring group block min-w-0 rounded-xl border bg-surface px-3 py-2 shadow-sm transition-colors hover:border-line-strong",
        leader ? "border-accent/50" : "border-line",
        node.isTemporary && "border-dashed",
      )}
    >
      <span className="flex items-center gap-2">
        <StatusDot tone={meta.tone} pulse={meta.pulse} />
        <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold group-hover:underline">
          {node.name}
        </span>
        {leader && (
          <span className="rounded bg-accent-soft px-1 text-[10px] font-medium text-accent">
            Lead
          </span>
        )}
      </span>
      <span className="mt-0.5 block truncate text-[11px] text-fg-faint">
        {meta.label} · {titleCase(node.templateKey)} · {AUTONOMY_LABELS[node.autonomyLevel]}
        {node.isTemporary && " · Temporary"}
      </span>
      <span
        className="mt-1.5 flex items-center gap-2"
        title={`${node.workload.active} active of ${node.workload.capacity}`}
      >
        <span className="h-1 flex-1 overflow-hidden rounded-full bg-surface-3" aria-hidden="true">
          <span
            className={cn(
              "block h-full rounded-full",
              TONE_CLASSES[load >= 1 ? "attention" : "live"].bar,
            )}
            style={{ width: `${load * 100}%` }}
          />
        </span>
        <span className="num text-[10.5px] text-fg-faint">
          {node.workload.active}/{node.workload.capacity}
        </span>
      </span>
      {node.currentTask && (
        <span className="mt-1 block truncate text-[11px] text-fg-muted">{node.currentTask}</span>
      )}
    </Link>
  );
}

/** Vertical branch with drawn connector lines between a parent and its children. */
function Branch({ children, label }: { children: ReactNode[]; label?: string }) {
  if (!children.length) return null;
  return (
    <ul
      aria-label={label}
      className="relative ml-3 mt-2 space-y-2 border-l border-line-strong/70 pl-4"
    >
      {children.map((c, i) => (
        <li
          key={i}
          className="relative before:absolute before:-left-4 before:top-5 before:h-px before:w-4 before:bg-line-strong/70"
        >
          {c}
        </li>
      ))}
    </ul>
  );
}

/** An agent with any temporary workers it created drawn beneath it. */
function WithWorkers({
  node,
  workers,
  leader,
}: {
  node: OrgAgentNode;
  workers: OrgAgentNode[];
  leader?: boolean;
}) {
  const mine = workers.filter((w) => w.reportsToId === node.id);
  return (
    <div>
      <OrgNode node={node} leader={leader} />
      <Branch label={`${node.name} temporary workers`}>
        {mine.map((w) => (
          <OrgNode key={w.id} node={w} />
        ))}
      </Branch>
    </div>
  );
}

export function OrgChart({ chart }: { chart: OrgChartDTO }) {
  const everyone = [
    ...chart.group,
    ...chart.companies.flatMap((c) => [
      ...c.managers,
      ...c.departments.flatMap((d) => [...d.agents, ...d.teams.flatMap((t) => t.members)]),
    ]),
  ];
  const ids = new Set(everyone.map((n) => n.id));
  const workers = everyone.filter((n) => n.isTemporary && n.reportsToId && ids.has(n.reportsToId));
  const isNested = (n: OrgAgentNode) => workers.includes(n);
  return (
    <div className="space-y-5">
      {chart.group.length > 0 && (
        <section
          aria-label="Group level"
          className="rounded-2xl border border-line bg-surface-2/40 p-4"
        >
          <p className="eyebrow mb-2">Group level · global agents</p>
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {chart.group.map((n) => (
              <li key={n.id}>
                <OrgNode node={n} leader={n.templateKey === "company_manager"} />
              </li>
            ))}
          </ul>
        </section>
      )}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2 2xl:grid-cols-3">
        {chart.companies.map(({ company, managers, departments }) => (
          <section
            key={company.id}
            aria-label={company.name}
            className="relative min-w-0 rounded-2xl border border-line bg-surface p-4 shadow-panel"
          >
            {chart.group.length > 0 && (
              <span
                aria-hidden="true"
                className="absolute -top-5 left-8 hidden h-5 w-px bg-line-strong/70 xl:block"
              />
            )}
            <header className="mb-3 flex items-center gap-2.5">
              <Monogram name={company.name} color={company.accentColor} />
              <h2 className="text-[15px] font-semibold tracking-tight">{company.name}</h2>
              <Building2 className="ml-auto size-4 text-fg-faint" aria-hidden="true" />
            </header>
            {managers.length ? (
              managers.map((m) => (
                <div key={m.id}>
                  <OrgNode node={m} leader />
                  <Branch label={`${m.name} reports`}>
                    {departments.map((d) => {
                      const deptAgents = d.agents.filter((a) => !isNested(a));
                      return (
                        <div key={d.department.id}>
                          <p className="flex items-center gap-1.5 pt-1 text-[12px] font-semibold">
                            <span
                              className="size-2.5 rounded-[3px]"
                              style={{ background: d.department.color ?? "#64748b" }}
                              aria-hidden="true"
                            />
                            {d.department.name}
                          </p>
                          <Branch label={`${d.department.name} department`}>
                            {[
                              ...d.teams.map((t) => (
                                <div
                                  key={t.id}
                                  className="rounded-xl border border-line bg-surface-2/50 p-2.5"
                                >
                                  <Link
                                    href={`/workforce/teams/${t.id}`}
                                    className="focus-ring mb-1.5 flex items-center gap-1.5 rounded text-[12px] font-semibold hover:underline"
                                  >
                                    <Users className="size-3.5 text-fg-faint" aria-hidden="true" />{" "}
                                    {t.name}
                                  </Link>
                                  <ul className="space-y-1.5">
                                    {t.members
                                      .filter((n) => !isNested(n))
                                      .map((n) => (
                                        <li key={n.id}>
                                          <WithWorkers
                                            node={n}
                                            workers={workers}
                                            leader={n.id === t.leaderId}
                                          />
                                        </li>
                                      ))}
                                  </ul>
                                </div>
                              )),
                              ...deptAgents.map((n) => (
                                <WithWorkers key={n.id} node={n} workers={workers} />
                              )),
                            ]}
                          </Branch>
                        </div>
                      );
                    })}
                  </Branch>
                </div>
              ))
            ) : (
              <p className="text-[12.5px] text-fg-muted">No company manager assigned.</p>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
