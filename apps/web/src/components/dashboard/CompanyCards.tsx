import Link from "next/link";
import { ArrowUpRight, Plus } from "lucide-react";
import type { CompanySummaryDTO } from "@aibos/shared";
import { formatUsd } from "@aibos/shared";
import { Monogram, cn } from "@aibos/ui";
import { pct } from "@/lib/format";

function Stat({ label, value, sub }: { label: string; value: number | string; sub?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-fg-faint">{label}</dt>
      <dd className="num mt-0.5 text-[15px] font-semibold leading-none">
        {value}
        {sub && <span className="ml-0.5 text-[11.5px] font-normal text-fg-faint">{sub}</span>}
      </dd>
    </div>
  );
}

export function CompanyCards({
  companies,
  selected,
}: {
  companies: CompanySummaryDTO[];
  selected: string | null;
}) {
  return (
    <section aria-labelledby="companies-heading">
      <h2 id="companies-heading" className="sr-only">
        Companies
      </h2>
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {companies.map((c) => {
          const spend = pct(c.stats.spendTodayUsd, c.dailyAiBudget);
          const isSelected = selected === c.slug;
          return (
            <li key={c.id}>
              <Link
                href={isSelected ? "/" : `/?company=${c.slug}`}
                aria-current={isSelected ? "true" : undefined}
                aria-label={`${c.name}${isSelected ? " (selected — show all companies)" : " — focus command centre"}`}
                className={cn(
                  "focus-ring group relative flex h-full flex-col overflow-hidden rounded-2xl border bg-surface p-4 shadow-panel transition-all hover:-translate-y-px hover:border-line-strong",
                  isSelected ? "border-transparent ring-2 ring-accent" : "border-line",
                )}
              >
                <span
                  aria-hidden="true"
                  className="absolute inset-x-0 top-0 h-[3px]"
                  style={{ background: c.accentColor ?? "var(--accent)" }}
                />
                <div className="flex items-start gap-3">
                  <Monogram name={c.name} color={c.accentColor} size="lg" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14.5px] font-semibold tracking-tight">{c.name}</p>
                    <p className="truncate text-[12px] text-fg-muted">
                      {c.industry ?? "—"} · {c.primaryCountry ?? "—"}
                    </p>
                  </div>
                  <ArrowUpRight
                    className="size-4 text-fg-faint opacity-0 transition-opacity group-hover:opacity-100"
                    aria-hidden="true"
                  />
                </div>
                <dl className="mt-4 grid grid-cols-3 gap-2">
                  <Stat label="Agents" value={c.stats.workingAgents} sub={`/${c.stats.agents}`} />
                  <Stat label="Open tasks" value={c.stats.openTasks} />
                  <Stat label="Approvals" value={c.stats.pendingApprovals} />
                </dl>
                <div className="mt-4">
                  <div className="flex items-baseline justify-between text-[11.5px]">
                    <span className="text-fg-faint">AI spend today</span>
                    <span className="num text-fg-muted">
                      <span className="font-medium text-fg">
                        {formatUsd(c.stats.spendTodayUsd)}
                      </span>{" "}
                      / {formatUsd(c.dailyAiBudget, { compact: true })}
                    </span>
                  </div>
                  <div
                    className="mt-1.5 h-1 overflow-hidden rounded-full bg-surface-3"
                    role="img"
                    aria-label={`${spend}% of daily AI budget used`}
                  >
                    <div
                      className={cn(
                        "h-full rounded-full",
                        spend >= 80 ? "bg-amber-500" : "bg-accent",
                      )}
                      style={{ width: `${spend}%` }}
                    />
                  </div>
                </div>
              </Link>
            </li>
          );
        })}
        <li>
          <Link
            href="/companies/new"
            className="focus-ring group flex h-full min-h-[172px] flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-line-strong bg-transparent p-4 text-center transition-colors hover:border-accent hover:bg-accent-soft/40"
          >
            <span className="grid size-10 place-items-center rounded-xl bg-surface text-accent shadow-panel ring-1 ring-line transition-transform group-hover:scale-105">
              <Plus className="size-5" aria-hidden="true" />
            </span>
            <span className="text-[14px] font-semibold">Add company</span>
            <span className="max-w-[200px] text-[12px] text-fg-muted">
              Onboard a new business — identity, brand, budgets and agents.
            </span>
          </Link>
        </li>
      </ul>
    </section>
  );
}
