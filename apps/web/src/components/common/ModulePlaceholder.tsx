import { CheckCircle2, Construction } from "lucide-react";
import { Panel, Skeleton } from "@aibos/ui";
import { PageHeader } from "./PageHeader";

export interface ModuleDefinition {
  title: string;
  eyebrow: string;
  stage: number;
  summary: string;
  capabilities: string[];
  dependsOn: string[];
}

export const MODULES: Record<string, ModuleDefinition> = {
  leads: {
    title: "Leads",
    eyebrow: "Operations",
    stage: 13,
    summary:
      "Unified lead pipeline across companies with scoring, enrichment, routing and Google Sheets sync.",
    capabilities: [
      "Lead inbox per company",
      "Qualification scoring",
      "Sheet ↔ CRM synchronisation",
      "Routing to agents and humans",
    ],
    dependsOn: ["Google Sheets (S12)", "Task orchestration (S06)"],
  },
  email: {
    title: "Email",
    eyebrow: "Operations",
    stage: 14,
    summary:
      "Mailbox monitoring, triage, drafting in brand tone and rule-based autonomy with approvals.",
    capabilities: [
      "Outlook / Microsoft Graph mailboxes",
      "Triage & classification",
      "Drafts with approval",
      "Follow-up engine",
    ],
    dependsOn: ["Microsoft Graph (S14)", "Approval engine (S33)"],
  },
  marketing: {
    title: "Marketing",
    eyebrow: "Operations",
    stage: 20,
    summary: "Campaign calendar, channel performance and content workflows for every company.",
    capabilities: [
      "Campaign planning",
      "Channel performance",
      "Content briefs",
      "Social listening via Grok",
    ],
    dependsOn: ["Meta connection (S19)", "GA4 (S25)"],
  },
  advertising: {
    title: "Advertising Intelligence",
    eyebrow: "Operations",
    stage: 21,
    summary:
      "Meta performance monitoring and Ad Library competitive intelligence with guarded execution.",
    capabilities: [
      "Campaign monitoring",
      "Ad Library intelligence",
      "Creative fatigue alerts",
      "Budget change approvals",
    ],
    dependsOn: ["Meta monitoring (S20)", "Meta execution rules (S23)"],
  },
  websites: {
    title: "Websites",
    eyebrow: "Operations",
    stage: 24,
    summary: "Uptime, performance, forms and SEO health for every company website.",
    capabilities: [
      "Uptime & Core Web Vitals",
      "Journey & form testing",
      "WordPress changes with approval",
      "Search Console insights",
    ],
    dependsOn: ["Website monitoring (S24)", "WordPress (S27)"],
  },
  research: {
    title: "Research",
    eyebrow: "Operations",
    stage: 36,
    summary:
      "Research workspace: briefs, sources, verification trails and reusable company knowledge.",
    capabilities: [
      "Research briefs",
      "Source citations",
      "Verification subtasks",
      "Knowledge base write-back",
    ],
    dependsOn: ["Task orchestration (S06)", "AI router (S10)"],
  },
  analytics: {
    title: "Analytics",
    eyebrow: "System",
    stage: 25,
    summary: "Cross-company KPIs, attribution and AI cost analytics.",
    capabilities: ["KPI dashboards", "Attribution", "AI cost analytics", "Anomaly alerts"],
    dependsOn: ["GA4 (S25)", "Cost Governor (S11)"],
  },
};

export function ModulePlaceholder({ id }: { id: keyof typeof MODULES }) {
  const m = MODULES[id]!;
  return (
    <div className="mx-auto max-w-[1180px]">
      <PageHeader eyebrow={m.eyebrow} title={m.title} description={m.summary} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Panel title="Module preview" eyebrow="Planned layout" className="relative overflow-hidden">
          <div className="pointer-events-none select-none space-y-3 opacity-80" aria-hidden="true">
            <div className="grid grid-cols-3 gap-3">
              {[0, 1, 2].map((i) => (
                <div key={i} className="rounded-xl border border-line p-3">
                  <Skeleton className="h-2.5 w-16" />
                  <Skeleton className="mt-2 h-5 w-12" />
                </div>
              ))}
            </div>
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="flex items-center gap-3 rounded-xl border border-line p-3">
                <Skeleton className="size-8 rounded-lg" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-2.5 w-2/5" />
                  <Skeleton className="h-2 w-3/5" />
                </div>
                <Skeleton className="h-5 w-16 rounded-full" />
              </div>
            ))}
          </div>
          <div className="absolute inset-0 grid place-items-center bg-gradient-to-t from-surface via-surface/70 to-transparent">
            <div className="rounded-2xl border border-line bg-surface px-5 py-4 text-center shadow-lg">
              <Construction className="mx-auto size-5 text-amber-500" aria-hidden="true" />
              <p className="mt-1.5 text-[13.5px] font-semibold">
                Arrives in Stage {String(m.stage).padStart(2, "0")}
              </p>
              <p className="text-[12px] text-fg-muted">See docs/BUILD_LEDGER.md</p>
            </div>
          </div>
        </Panel>
        <div className="space-y-4">
          <Panel title="Capabilities">
            <ul className="space-y-2">
              {m.capabilities.map((c) => (
                <li key={c} className="flex gap-2 text-[13px]">
                  <CheckCircle2
                    className="mt-0.5 size-4 shrink-0 text-fg-faint"
                    aria-hidden="true"
                  />
                  {c}
                </li>
              ))}
            </ul>
          </Panel>
          <Panel title="Depends on">
            <ul className="flex flex-wrap gap-1.5">
              {m.dependsOn.map((d) => (
                <li
                  key={d}
                  className="rounded-md bg-surface-2 px-2 py-0.5 text-[12px] ring-1 ring-inset ring-line"
                >
                  {d}
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </div>
    </div>
  );
}
