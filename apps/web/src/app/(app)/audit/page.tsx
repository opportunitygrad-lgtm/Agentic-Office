import { PROVIDER_LABELS, type AuditEventDTO } from "@aibos/shared";
import { MockBadge, Panel, StatusPill } from "@aibos/ui";
import { PageError } from "@/components/common/PageError";
import { CompanyChip } from "@/components/common/CompanyChip";
import { PageHeader } from "@/components/common/PageHeader";
import { apiGet, companyParam, type SearchParams } from "@/lib/api";

export const metadata = { title: "Audit log" };

export default async function AuditPage({ searchParams }: { searchParams: SearchParams }) {
  const company = await companyParam(searchParams);
  let events: AuditEventDTO[];
  try {
    events = (
      await apiGet<{ data: AuditEventDTO[] }>("/v1/audit-events", { company, limit: "200" })
    ).data;
  } catch (e) {
    return <PageError error={e} />;
  }
  return (
    <div className="mx-auto max-w-[1680px]">
      <PageHeader
        eyebrow="Governance"
        title="Audit log"
        description="Append-only record of meaningful actions by people, agents and the system — who, what, where, with which tool or provider, and the outcome."
        devData={events.some((e) => e.origin === "dev_seed")}
      />
      <Panel title={`${events.length} events`} eyebrow="Newest first" bodyClassName="p-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-left text-[12.5px]">
            <caption className="sr-only">Audit events</caption>
            <thead className="border-b border-line text-[11px] text-fg-faint">
              <tr>
                <th scope="col" className="px-5 py-2 font-medium">
                  Time
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Action
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Description
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Company
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Actor
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Tool / provider
                </th>
                <th scope="col" className="px-5 py-2 text-right font-medium">
                  Outcome
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/70">
              {events.map((e) => (
                <tr key={e.id} className="align-top hover:bg-surface-2/50">
                  <td className="num whitespace-nowrap px-5 py-2.5 font-mono text-[11.5px] text-fg-muted">
                    {new Date(e.occurredAt).toLocaleString("en-GB", {
                      day: "2-digit",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                    })}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5">
                    <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] ring-1 ring-inset ring-line">
                      {e.action}
                    </code>
                  </td>
                  <td className="px-3 py-2.5">
                    {e.description}
                    {e.error && (
                      <p className="mt-0.5 text-[11.5px] text-rose-600 dark:text-rose-400">
                        {e.error}
                      </p>
                    )}
                    {e.origin === "dev_seed" && <MockBadge label="seed" className="ml-2" />}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5">
                    <CompanyChip company={e.company} />
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-fg-muted">
                    {e.agent?.name ?? e.actorUser ?? "system"}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-fg-muted">
                    {[e.tool, e.provider ? PROVIDER_LABELS[e.provider] : null]
                      .filter(Boolean)
                      .join(" · ") || "—"}
                  </td>
                  <td className="px-5 py-2.5 text-right">
                    <StatusPill
                      tone={e.outcome === "success" ? "done" : "danger"}
                      label={e.outcome === "success" ? "Success" : "Failure"}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
