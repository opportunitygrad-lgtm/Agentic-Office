import { titleCase, type IntegrationDTO, type IntegrationStatus } from "@aibos/shared";
import { Panel, StatusPill, type Tone } from "@aibos/ui";
import { PageError } from "@/components/common/PageError";
import { PageHeader } from "@/components/common/PageHeader";
import { apiGet, companyParam, type SearchParams } from "@/lib/api";

export const metadata = { title: "Integrations" };

const STATUS: Record<IntegrationStatus, { label: string; tone: Tone }> = {
  not_configured: { label: "Not configured", tone: "idle" },
  pending_auth: { label: "Awaiting auth", tone: "attention" },
  connected: { label: "Connected", tone: "live" },
  degraded: { label: "Degraded", tone: "attention" },
  error: { label: "Error", tone: "danger" },
  disabled: { label: "Disabled", tone: "neutral" },
};

export default async function IntegrationsPage({ searchParams }: { searchParams: SearchParams }) {
  const company = await companyParam(searchParams);
  let rows: IntegrationDTO[];
  try {
    rows = (await apiGet<{ data: IntegrationDTO[] }>("/v1/integrations", { company })).data;
  } catch (e) {
    return <PageError error={e} />;
  }
  const byKind = new Map<string, IntegrationDTO[]>();
  for (const r of rows) byKind.set(r.kind, [...(byKind.get(r.kind) ?? []), r]);
  const groups = [...byKind.values()].sort(
    (a, b) => (a[0]!.plannedStage ?? 99) - (b[0]!.plannedStage ?? 99),
  );

  return (
    <div className="mx-auto max-w-[1680px]">
      <PageHeader
        eyebrow="System"
        title="Integrations"
        description="Every external system the OS will operate through. All adapters are placeholders in Stage 01: no credentials are stored and no live connections are made."
      />
      <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3">
        {groups.map((items) => {
          const def = items[0]!;
          return (
            <li key={def.kind}>
              <Panel className="h-full" bodyClassName="p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="eyebrow">{titleCase(def.category)}</p>
                    <h2 className="mt-0.5 text-[15px] font-semibold tracking-tight">{def.name}</h2>
                  </div>
                  {def.plannedStage && (
                    <span className="shrink-0 rounded-md bg-surface-2 px-1.5 py-0.5 font-mono text-[10.5px] text-fg-muted ring-1 ring-inset ring-line">
                      Stage {String(def.plannedStage).padStart(2, "0")}
                    </span>
                  )}
                </div>
                <p className="mt-1.5 text-[12.5px] text-fg-muted">{def.description}</p>
                <div className="mt-3 flex flex-wrap gap-1">
                  {def.capabilities.map((c) => (
                    <code
                      key={c}
                      className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[10.5px] text-fg-muted ring-1 ring-inset ring-line"
                    >
                      {c}
                    </code>
                  ))}
                </div>
                <ul className="mt-4 space-y-1.5 border-t border-line/70 pt-3">
                  {items.map((i) => (
                    <li
                      key={i.id}
                      className="flex items-center justify-between gap-2 text-[12.5px]"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <span
                          className="size-2 shrink-0 rounded-[3px]"
                          style={{ background: i.company?.accentColor ?? "var(--fg-faint)" }}
                          aria-hidden="true"
                        />
                        <span className="truncate">{i.company?.name ?? "Platform-wide"}</span>
                      </span>
                      <StatusPill tone={STATUS[i.status].tone} label={STATUS[i.status].label} />
                    </li>
                  ))}
                </ul>
              </Panel>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
