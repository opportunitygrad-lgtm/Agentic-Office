import Link from "next/link";
import { Globe2 } from "lucide-react";
import { PROVIDER_LABELS, type AgentDTO } from "@aibos/shared";
import { AGENT_STATUS_META, ProgressBar, StatusPill, TASK_STATUS_META, cn } from "@aibos/ui";
import { PROVIDER_SERIES } from "./UsagePanel";

export function ProviderTag({ provider }: { provider: AgentDTO["primaryProvider"] }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-surface-2 px-1.5 py-0.5 text-[11px] font-medium text-fg-muted ring-1 ring-inset ring-line">
      <span
        className="size-1.5 rounded-full"
        style={{ background: `var(${PROVIDER_SERIES[provider]})` }}
        aria-hidden="true"
      />
      {PROVIDER_LABELS[provider]}
    </span>
  );
}

export function AgentCompanies({ agent }: { agent: AgentDTO }) {
  if (agent.scope === "global") {
    return (
      <span className="inline-flex items-center gap-1 text-[11.5px] text-fg-muted">
        <Globe2 className="size-3.5 text-fg-faint" aria-hidden="true" /> Global
        {agent.companies.length > 0 && (
          <span className="text-fg-faint">· {agent.companies.length} cos</span>
        )}
      </span>
    );
  }
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 text-[11.5px] text-fg-muted">
      <span className="flex -space-x-1" aria-hidden="true">
        {agent.companies.slice(0, 3).map((c) => (
          <span
            key={c.id}
            className="size-2.5 rounded-full ring-2 ring-surface"
            style={{ background: c.accentColor ?? "#64748b" }}
          />
        ))}
      </span>
      <span className="truncate">
        {agent.companies.map((c) => c.name).join(", ") || "Unassigned"}
      </span>
    </span>
  );
}

export function AgentCard({ agent, href }: { agent: AgentDTO; href?: string }) {
  const meta = AGENT_STATUS_META[agent.status];
  const task = agent.currentTask;
  const busy = agent.status !== "sleeping" && agent.status !== "offline";
  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-[11px] font-semibold uppercase tracking-[0.06em] text-fg-faint">
            {agent.department?.name ?? "Unassigned"}
          </p>
          <p className="truncate text-[14px] font-semibold tracking-tight">{agent.name}</p>
        </div>
        <StatusPill tone={meta.tone} label={meta.label} pulse={meta.pulse} />
      </div>
      <div className="mt-3 min-h-[44px]">
        {task && busy ? (
          <>
            <p className="line-clamp-2 text-[12.5px] leading-snug">
              <span className="text-fg-faint">Task: </span>
              {task.title}
            </p>
            <div className="mt-2 flex items-center gap-2">
              <ProgressBar
                value={task.progress}
                tone={TASK_STATUS_META[task.status].tone}
                animated={task.status === "running"}
                label={`${task.title} progress`}
              />
              <span className="num w-8 shrink-0 text-right text-[11px] text-fg-muted">
                {task.progress}%
              </span>
            </div>
          </>
        ) : (
          <p className="text-[12.5px] text-fg-faint">
            {agent.status === "sleeping" ? "Idle — wakes on assignment" : "No active task"}
          </p>
        )}
      </div>
      <div className="mt-3 flex items-center justify-between gap-2 border-t border-line/70 pt-2.5">
        <AgentCompanies agent={agent} />
        <ProviderTag provider={agent.primaryProvider} />
      </div>
    </>
  );
  const cls = cn(
    "block h-full rounded-xl border border-line bg-surface p-3.5 transition-colors",
    busy ? "shadow-panel" : "bg-surface-2/40",
    href && "focus-ring hover:border-line-strong",
  );
  return href ? (
    <Link href={href} className={cls}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}
