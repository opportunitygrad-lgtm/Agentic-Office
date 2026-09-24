import {
  APPROVAL_TYPE_LABELS,
  AUTONOMY_LABELS,
  PROVIDER_LABELS,
  titleCase,
  type AgentTemplateDTO,
  type ApprovalType,
} from "@aibos/shared";
import { Panel } from "@aibos/ui";
import { PageError } from "@/components/common/PageError";
import { PageHeader } from "@/components/common/PageHeader";
import { apiGet } from "@/lib/api";

export const metadata = { title: "Agent templates" };

export default async function TemplatesPage() {
  let templates: AgentTemplateDTO[];
  try {
    templates = (await apiGet<{ data: AgentTemplateDTO[] }>("/v1/agent-templates")).data;
  } catch (e) {
    return <PageError error={e} />;
  }
  return (
    <div className="mx-auto max-w-[1680px]">
      <PageHeader
        eyebrow="AI Workforce"
        title="Agent templates"
        description={`${templates.length} reusable definitions. Prompts are attached per template in Stage 05 (prompt library); these define role, tools, guardrails and routing defaults.`}
      />
      <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3">
        {templates.map((t) => (
          <li key={t.key}>
            <Panel className="h-full" bodyClassName="p-5 flex h-full flex-col">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="eyebrow">{titleCase(t.department)}</p>
                  <h2 className="mt-0.5 text-[15px] font-semibold tracking-tight">{t.name}</h2>
                </div>
                <span className="rounded-md bg-surface-2 px-1.5 py-0.5 font-mono text-[10.5px] text-fg-faint ring-1 ring-inset ring-line">
                  {t.promptVersion ?? "prompt: S05"}
                </span>
              </div>
              <p className="mt-2 text-[13px] text-fg-muted">{t.description}</p>
              <dl className="mt-4 grid grid-cols-2 gap-3 text-[12px]">
                <div>
                  <dt className="text-fg-faint">Routing</dt>
                  <dd className="font-medium">
                    {PROVIDER_LABELS[t.defaultProvider]}
                    {t.fallbackProvider && (
                      <span className="text-fg-faint">
                        {" "}
                        → {PROVIDER_LABELS[t.fallbackProvider]}
                      </span>
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-fg-faint">Default autonomy</dt>
                  <dd className="font-medium">{AUTONOMY_LABELS[t.defaultAutonomy]}</dd>
                </div>
              </dl>
              <div className="mt-4 space-y-3 text-[12px]">
                {[
                  ["Responsibilities", t.responsibilities],
                  ["Tools", t.defaultTools],
                  [
                    "Approval gates",
                    t.approvalRequirements.map((a) => APPROVAL_TYPE_LABELS[a as ApprovalType] ?? a),
                  ],
                ].map(([label, items]) => (
                  <div key={label as string}>
                    <p className="mb-1 text-fg-faint">{label as string}</p>
                    <div className="flex flex-wrap gap-1">
                      {(items as string[]).length ? (
                        (items as string[]).map((i) => (
                          <span
                            key={i}
                            className="rounded-md bg-surface-2 px-1.5 py-0.5 ring-1 ring-inset ring-line"
                          >
                            {i}
                          </span>
                        ))
                      ) : (
                        <span className="text-fg-faint">—</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </Panel>
          </li>
        ))}
      </ul>
    </div>
  );
}
