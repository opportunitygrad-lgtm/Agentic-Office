import type { ManagerStatsDTO } from "@aibos/shared";
import { Panel } from "@aibos/ui";

/** Manager dashboard: how work was routed over the last 30 days (from recorded decisions). */
export function ManagerStatsPanel({ stats }: { stats: ManagerStatsDTO }) {
  const items: [string, number | string][] = [
    ["Tasks received", stats.tasksReceived],
    ["Handled directly", stats.handledDirectly],
    ["Delegated", stats.delegated],
    ["Waiting approvals", stats.waitingApprovals],
    ["Duplicates avoided", stats.duplicatesAvoided],
    ["Temporary workers", stats.temporaryAgentsActive],
    ["Handoffs pending", stats.handoffsPending],
    ["Concurrency", `${stats.concurrency.active}/${stats.concurrency.limit}`],
  ];
  return (
    <Panel
      id="manager-stats"
      title={stats.manager ? `${stats.manager.name}` : "Manager overview"}
      eyebrow="Delegation · last 30 days"
    >
      <dl className="grid grid-cols-2 gap-2.5 sm:grid-cols-4" data-testid="manager-stats">
        {items.map(([k, v]) => (
          <div key={k} className="rounded-xl border border-line/80 bg-surface-2/40 px-3 py-2">
            <dt className="text-[11px] text-fg-faint">{k}</dt>
            <dd className="num text-[18px] font-semibold">{v}</dd>
          </div>
        ))}
      </dl>
      {stats.concurrency.active > stats.concurrency.limit && (
        <p className="mt-2 text-[12px] text-amber-700 dark:text-amber-300">
          More agents are active than the concurrency limit allows — new work will queue until
          capacity frees up.
        </p>
      )}
    </Panel>
  );
}
