import Link from "next/link";
import { Plus } from "lucide-react";
import { PROVIDER_LABELS, formatUsd, type CompanySummaryDTO } from "@aibos/shared";
import { Monogram, Panel, StatusPill } from "@aibos/ui";
import { ApiOffline } from "@/components/common/ApiOffline";
import { PageHeader } from "@/components/common/PageHeader";
import { apiGet } from "@/lib/api";

export const metadata = { title: "Companies" };

export default async function CompaniesPage() {
  let companies: CompanySummaryDTO[];
  try {
    companies = (await apiGet<{ data: CompanySummaryDTO[] }>("/v1/companies", { stats: "true" }))
      .data;
  } catch (e) {
    return <ApiOffline detail={e instanceof Error ? e.message : undefined} />;
  }
  return (
    <div className="mx-auto max-w-[1680px]">
      <PageHeader
        eyebrow="Organisation"
        title="Companies"
        description="Every business the operating system runs. Agents, tasks, budgets and integrations are scoped per company."
        actions={
          <Link
            href="/companies/new"
            className="focus-ring inline-flex h-9 items-center gap-1.5 rounded-lg bg-accent px-3.5 text-sm font-medium text-white hover:bg-accent-strong"
          >
            <Plus className="size-4" aria-hidden="true" /> Add company
          </Link>
        }
      />
      <ul className="grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-3">
        {companies.map((c) => (
          <li key={c.id}>
            <Panel className="h-full" bodyClassName="p-5">
              <div className="flex items-start gap-3">
                <Monogram name={c.name} color={c.accentColor} size="lg" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-[16px] font-semibold tracking-tight">{c.name}</h2>
                    <StatusPill
                      tone={c.status === "active" ? "live" : "neutral"}
                      label={c.status === "active" ? "Active" : "Inactive"}
                    />
                  </div>
                  <p className="text-[12.5px] text-fg-muted">
                    {c.legalName ?? c.name} · {c.industry}
                  </p>
                </div>
              </div>
              {c.description && <p className="mt-3 text-[13px] text-fg-muted">{c.description}</p>}
              <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-[12.5px] sm:grid-cols-4">
                {[
                  ["Country", c.primaryCountry ?? "—"],
                  ["Timezone", c.timezone],
                  ["Currency", c.defaultCurrency],
                  ["Default AI", PROVIDER_LABELS[c.defaultProvider]],
                  ["Daily budget", formatUsd(c.dailyAiBudget, { compact: true })],
                  ["Monthly budget", formatUsd(c.monthlyAiBudget, { compact: true })],
                  ["Concurrency", String(c.concurrencyLimit)],
                  ["Agents", `${c.stats.workingAgents} working / ${c.stats.agents}`],
                ].map(([k, v]) => (
                  <div key={k} className="min-w-0">
                    <dt className="text-[11px] text-fg-faint">{k}</dt>
                    <dd className="truncate font-medium">{v}</dd>
                  </div>
                ))}
              </dl>
              {c.targetMarkets.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {c.targetMarkets.map((m) => (
                    <span
                      key={m}
                      className="rounded-md bg-surface-2 px-2 py-0.5 text-[11.5px] text-fg-muted ring-1 ring-inset ring-line"
                    >
                      {m}
                    </span>
                  ))}
                </div>
              )}
              <div className="mt-5 flex flex-wrap gap-2 border-t border-line/70 pt-4">
                <Link
                  href={`/?company=${c.slug}`}
                  className="focus-ring inline-flex h-8 items-center rounded-lg bg-surface-2 px-3 text-[13px] font-medium ring-1 ring-inset ring-line hover:bg-surface-3"
                >
                  Open command centre
                </Link>
                <Link
                  href={`/workforce/agents?company=${c.slug}`}
                  className="focus-ring inline-flex h-8 items-center rounded-lg px-3 text-[13px] font-medium text-fg-muted hover:bg-surface-2 hover:text-fg"
                >
                  Agents
                </Link>
                <Link
                  href={`/tasks/active?company=${c.slug}`}
                  className="focus-ring inline-flex h-8 items-center rounded-lg px-3 text-[13px] font-medium text-fg-muted hover:bg-surface-2 hover:text-fg"
                >
                  Tasks
                </Link>
              </div>
            </Panel>
          </li>
        ))}
      </ul>
    </div>
  );
}
