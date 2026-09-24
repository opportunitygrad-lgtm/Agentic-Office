import Link from "next/link";
import type { AgentStatus, WorkforceCounts } from "@aibos/shared";
import { AGENT_STATUS_META, Panel, StatusDot, TONE_CLASSES, cn } from "@aibos/ui";

const TILES: { key: AgentStatus | "active"; label: string }[] = [
  { key: "active", label: "Active" },
  { key: "working", label: "Working" },
  { key: "waiting", label: "Waiting" },
  { key: "sleeping", label: "Sleeping" },
  { key: "blocked", label: "Blocked" },
  { key: "needs_approval", label: "Approval" },
];

const BAR_ORDER: AgentStatus[] = [
  "working",
  "needs_approval",
  "waiting",
  "queued",
  "blocked",
  "failed",
  "paused",
  "sleeping",
  "offline",
  "completed",
];

export function activeCount(w: WorkforceCounts): number {
  return w.working + w.waiting + w.needs_approval + w.queued + w.blocked;
}

export function WorkforceOverview({
  workforce,
  company,
}: {
  workforce: WorkforceCounts;
  company?: string;
}) {
  const active = activeCount(workforce);
  const segments = BAR_ORDER.filter((s) => workforce[s] > 0);
  const href = (status?: string) => {
    const p = new URLSearchParams();
    if (company) p.set("company", company);
    if (status) p.set("status", status);
    const qs = p.toString();
    return `/workforce/agents${qs ? `?${qs}` : ""}`;
  };
  return (
    <Panel
      id="workforce"
      title="Workforce"
      eyebrow="AI agents"
      actions={
        <Link
          href={href()}
          className="focus-ring rounded-md text-[12.5px] font-medium text-accent hover:underline"
        >
          Registry
        </Link>
      }
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="leading-none">
          <span className="num text-[34px] font-semibold tracking-tight">{workforce.total}</span>
          <span className="ml-2 text-[13px] text-fg-muted">agents · {active} active now</span>
        </p>
      </div>
      <div
        className="mt-4 flex h-2.5 w-full gap-[2px] overflow-hidden rounded-full bg-surface-3"
        role="img"
        aria-label={segments
          .map((s) => `${AGENT_STATUS_META[s].label}: ${workforce[s]}`)
          .join(", ")}
      >
        {segments.map((s) => (
          <div
            key={s}
            title={`${AGENT_STATUS_META[s].label}: ${workforce[s]}`}
            className={cn(
              "h-full first:rounded-l-full last:rounded-r-full",
              TONE_CLASSES[AGENT_STATUS_META[s].tone].bar,
            )}
            style={{ width: `${(workforce[s] / Math.max(1, workforce.total)) * 100}%` }}
          />
        ))}
      </div>
      <ul className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
        {TILES.map((t) => {
          const count = t.key === "active" ? active : workforce[t.key];
          const meta = t.key === "active" ? null : AGENT_STATUS_META[t.key];
          return (
            <li key={t.key}>
              <Link
                href={href(t.key === "active" ? undefined : t.key)}
                className={cn(
                  "focus-ring block rounded-xl border border-line bg-surface-2/60 px-3 py-2.5 transition-colors hover:border-line-strong hover:bg-surface-2",
                  count === 0 && "opacity-60",
                )}
              >
                <span className="flex items-center gap-1.5 text-[11.5px] text-fg-muted">
                  {meta ? (
                    <StatusDot tone={meta.tone} pulse={meta.pulse && count > 0} />
                  ) : (
                    <StatusDot tone="info" />
                  )}
                  {t.label}
                </span>
                <span className="num mt-1 block text-[20px] font-semibold leading-none">
                  {count}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}
