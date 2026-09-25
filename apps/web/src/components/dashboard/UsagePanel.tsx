import { PROVIDER_LABELS, formatUsd, type UsageSummaryDTO } from "@aibos/shared";
import { MockBadge, Panel, ProgressRing, Sparkline, cn } from "@aibos/ui";
import { pct } from "@/lib/format";

/** Fixed provider → categorical slot mapping (colour follows the entity, never rank). */
export const PROVIDER_SERIES: Record<string, string> = {
  CLAUDE: "--series-1",
  OPENAI: "--series-2",
  GROK: "--series-3",
  LOCAL: "--series-4",
};

function dayLabel(offsetFromToday: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - offsetFromToday);
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", timeZone: "UTC" });
}

export function UsagePanel({ usage }: { usage: UsageSummaryDTO }) {
  const todayPct = pct(usage.todayUsd, usage.dailyBudgetUsd);
  const monthPct = pct(usage.monthUsd, usage.monthlyBudgetUsd);
  const days = usage.providers[0]?.trend.length ?? 0;
  const totals = Array.from({ length: days }, (_, i) =>
    usage.providers.reduce((s, p) => s + (p.trend[i] ?? 0), 0),
  );
  const maxDay = Math.max(...totals, 0.01);

  return (
    <Panel
      id="ai-usage"
      title="AI usage"
      eyebrow="Cost governor"
      actions={
        usage.providers.some((p) => p.isMock && p.monthUsd > 0) ? (
          <MockBadge label="Includes mock data" />
        ) : undefined
      }
      bodyClassName="p-4 sm:p-5 space-y-5"
    >
      <div className="flex items-center gap-4">
        <ProgressRing
          value={todayPct}
          size={76}
          stroke={7}
          label={`${todayPct}% of daily budget used`}
          colorClass={todayPct >= 80 ? "text-amber-500" : "text-accent"}
        >
          <span className="num text-[15px] font-semibold">{todayPct}%</span>
        </ProgressRing>
        <div className="min-w-0 flex-1 space-y-2.5">
          <div>
            <p className="text-[11.5px] text-fg-faint">Today</p>
            <p className="num text-[20px] font-semibold leading-tight">
              {formatUsd(usage.todayUsd)}
              <span className="ml-1 text-[12px] font-normal text-fg-faint">
                / {formatUsd(usage.dailyBudgetUsd, { compact: true })}
              </span>
            </p>
          </div>
          <div>
            <div className="flex justify-between text-[11.5px]">
              <span className="text-fg-faint">Month to date</span>
              <span className="num text-fg-muted">
                {formatUsd(usage.monthUsd, { compact: true })} /{" "}
                {formatUsd(usage.monthlyBudgetUsd, { compact: true })}
              </span>
            </div>
            <div
              className="mt-1 h-1 overflow-hidden rounded-full bg-surface-3"
              role="img"
              aria-label={`${monthPct}% of monthly budget used`}
            >
              <div
                className={cn("h-full rounded-full", monthPct >= 80 ? "bg-amber-500" : "bg-accent")}
                style={{ width: `${monthPct}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      <figure>
        <figcaption className="mb-2 flex items-center justify-between text-[11.5px] text-fg-faint">
          <span>Daily spend · last {days} days</span>
          <span className="num">peak {formatUsd(maxDay, { compact: true })}</span>
        </figcaption>
        <div
          className="flex h-24 items-end gap-[3px]"
          role="group"
          aria-label="Daily AI spend by provider"
        >
          {totals.map((total, i) => {
            const label = dayLabel(days - 1 - i);
            const detail = usage.providers
              .filter((p) => (p.trend[i] ?? 0) > 0)
              .map((p) => `${PROVIDER_LABELS[p.provider]} ${formatUsd(p.trend[i] ?? 0)}`)
              .join(", ");
            return (
              <div
                key={i}
                tabIndex={0}
                aria-label={`${label}: ${formatUsd(total)}${detail ? ` — ${detail}` : ""}`}
                className="focus-ring group relative flex h-full flex-1 flex-col justify-end rounded-sm outline-none"
              >
                <div
                  className="flex flex-col-reverse gap-[2px]"
                  style={{ height: `${(total / maxDay) * 100}%` }}
                >
                  {usage.providers.map((p) => {
                    const v = p.trend[i] ?? 0;
                    if (v <= 0) return null;
                    return (
                      <div
                        key={p.provider}
                        className="w-full first:rounded-b-[2px] last:rounded-t-[4px]"
                        style={{
                          height: `${(v / total) * 100}%`,
                          minHeight: 2,
                          background: `var(${PROVIDER_SERIES[p.provider]})`,
                        }}
                      />
                    );
                  })}
                </div>
                <div
                  role="tooltip"
                  className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 hidden w-max -translate-x-1/2 rounded-lg border border-line bg-surface px-2.5 py-2 text-[11.5px] shadow-lg group-hover:block group-focus-visible:block"
                >
                  <p className="font-medium text-fg">{label}</p>
                  <p className="num text-fg-muted">{formatUsd(total)} total</p>
                </div>
              </div>
            );
          })}
        </div>
      </figure>

      {(() => {
        const c = usage.providers.find((p) => p.provider === "CLAUDE");
        if (!c) return null;
        return (
          <dl
            className="grid grid-cols-3 gap-2 rounded-xl border border-line bg-surface-2/40 p-3 text-[11.5px]"
            data-testid="claude-usage"
          >
            <div>
              <dt className="text-fg-faint">Claude calls today</dt>
              <dd className="num font-semibold">{c.callsToday}</dd>
            </div>
            <div>
              <dt className="text-fg-faint">Input / output (month)</dt>
              <dd className="num font-semibold">
                {c.inputTokens.toLocaleString()} / {c.outputTokens.toLocaleString()}
              </dd>
            </div>
            <div>
              <dt className="text-fg-faint">Cache reads (month)</dt>
              <dd className="num font-semibold">{c.cacheReadTokens.toLocaleString()}</dd>
            </div>
            <div>
              <dt className="text-fg-faint">Spend today</dt>
              <dd className="num font-semibold">{formatUsd(c.todayUsd)}</dd>
            </div>
            <div>
              <dt className="text-fg-faint">Spend month</dt>
              <dd className="num font-semibold">{formatUsd(c.monthUsd)}</dd>
            </div>
            <div>
              <dt className="text-fg-faint">Average run cost</dt>
              <dd className="num font-semibold">
                {c.averageCallUsd !== null ? formatUsd(c.averageCallUsd) : "—"}
              </dd>
            </div>
            <p className="col-span-3 text-fg-faint">
              Real Claude usage only. Real spend today across providers:{" "}
              {formatUsd(usage.liveTodayUsd)}.
            </p>
          </dl>
        );
      })()}

      <table className="w-full text-[12.5px]">
        <caption className="sr-only">Spend by provider</caption>
        <thead>
          <tr className="text-left text-[11px] text-fg-faint">
            <th scope="col" className="pb-1.5 font-medium">
              Provider
            </th>
            <th scope="col" className="hidden pb-1.5 font-medium sm:table-cell">
              14d
            </th>
            <th scope="col" className="pb-1.5 text-right font-medium">
              Today
            </th>
            <th scope="col" className="pb-1.5 text-right font-medium">
              Month
            </th>
          </tr>
        </thead>
        <tbody>
          {usage.providers.map((p) => (
            <tr key={p.provider} className="border-t border-line/70">
              <th scope="row" className="py-2 text-left font-medium">
                <span className="flex items-center gap-2">
                  <span
                    className="size-2.5 rounded-[3px]"
                    style={{ background: `var(${PROVIDER_SERIES[p.provider]})` }}
                    aria-hidden="true"
                  />
                  {PROVIDER_LABELS[p.provider]}
                  <span
                    className={cn(
                      "rounded px-1 text-[10px] font-medium",
                      p.isMock
                        ? "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300"
                        : "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300",
                    )}
                  >
                    {p.isMock ? "MOCK" : "REAL"}
                  </span>
                </span>
              </th>
              <td className="hidden py-1 sm:table-cell">
                <Sparkline
                  values={p.trend}
                  width={72}
                  height={20}
                  colorVar={PROVIDER_SERIES[p.provider]}
                  label={`${PROVIDER_LABELS[p.provider]} 14-day spend trend`}
                />
              </td>
              <td className="num py-2 text-right">{formatUsd(p.todayUsd)}</td>
              <td className="num py-2 text-right text-fg-muted">
                {formatUsd(p.monthUsd, { compact: p.monthUsd >= 100 })}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}
