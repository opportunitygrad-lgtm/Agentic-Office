"use client";

import { useEffect, useState, type ReactNode } from "react";
import { History, RotateCcw, Save } from "lucide-react";
import {
  AGENT_TEMPLATE_KEYS,
  PROVIDER_LABELS,
  type AgentRole,
  type AgentRoleDTO,
  type AgentTemplateKey,
  type ProviderType,
} from "@aibos/shared";
import { Button, EmptyState, Panel, Skeleton, cn } from "@aibos/ui";
import { clientApi } from "@/lib/client-api";
import { formatDateTime } from "@/lib/format";
import { SelectField, Switch, TagInput, TextArea, TextField } from "../wizard/fields";

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function Group({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <fieldset className="space-y-3 border-b border-line/70 px-4 py-4 last:border-0 sm:px-5">
      <legend className="sr-only">{title}</legend>
      <div>
        <h3 className="text-[13.5px] font-semibold tracking-tight">{title}</h3>
        {hint && <p className="text-[12px] text-fg-muted">{hint}</p>}
      </div>
      {children}
    </fieldset>
  );
}

const numOrNull = (v: string) => (v.trim() === "" ? null : Number(v));

/**
 * Structured editor for an agent's permanent role. Never raw JSON: every
 * section is a form group. Saving creates a new version (history is kept).
 */
export function RoleEditor({ agentId }: { agentId: string }) {
  const [data, setData] = useState<AgentRoleDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [role, setRole] = useState<AgentRole | null>(null);
  const [summary, setSummary] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void clientApi<{ data: AgentRoleDTO }>(`/v1/agents/${agentId}/role`).then((r) => {
      if (!live) return;
      if (r.ok) {
        setData(r.data.data);
        setRole(clone(r.data.data.role));
      } else setError(r.message);
    });
    return () => {
      live = false;
    };
  }, [agentId]);

  if (error) return <EmptyState title="Role unavailable" description={error} />;
  if (!data || !role)
    return (
      <div className="space-y-3" aria-busy="true">
        <Skeleton className="h-10" />
        <Skeleton className="h-40" />
      </div>
    );

  const readOnly = !data.viewerCanManage;
  const dirty = !same(role, data.role);
  const set = <K extends keyof AgentRole>(key: K, value: AgentRole[K]) =>
    setRole({ ...role, [key]: value });

  async function save() {
    if (!role) return;
    setSaving(true);
    setNotice(null);
    const r = await clientApi<{ data: { version: number; created: boolean; role: AgentRoleDTO } }>(
      `/v1/agents/${agentId}/role`,
      {
        method: "PUT",
        body: { role, changeSummary: summary },
      },
    );
    setSaving(false);
    if (!r.ok) {
      setNotice(r.issues?.[0] ? `${r.issues[0].path}: ${r.issues[0].message}` : r.message);
      return;
    }
    setData(r.data.data.role);
    setRole(clone(r.data.data.role.role));
    setSummary("");
    setNotice(
      r.data.data.created ? `Saved as version ${r.data.data.version}.` : "No changes to save.",
    );
  }

  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
      <Panel
        title="Permanent role"
        eyebrow={`${data.roleTemplate.name}${data.roleTemplate.companySpecific ? " · company template" : " · global template"}`}
        bodyClassName="p-0"
        actions={
          !readOnly && (
            <Button
              size="sm"
              variant="ghost"
              icon={<RotateCcw className="size-3.5" aria-hidden="true" />}
              onClick={() => setRole(clone(data.templateRole))}
              disabled={same(role, data.templateRole)}
            >
              Use template
            </Button>
          )
        }
      >
        {readOnly && (
          <p className="border-b border-line/70 bg-surface-2/60 px-5 py-2 text-[12px] text-fg-muted">
            Read-only — editing roles needs the Manage agent roles permission in every company this
            agent serves.
          </p>
        )}
        <fieldset disabled={readOnly} className="min-w-0">
          <Group title="Identity">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <TextField
                label="Role name"
                value={role.identity.roleName}
                onChange={(e) => set("identity", { ...role.identity, roleName: e.target.value })}
              />
              <TextField
                label="Mission"
                value={role.identity.mission}
                onChange={(e) => set("identity", { ...role.identity, mission: e.target.value })}
              />
            </div>
          </Group>
          <Group title="Responsibilities">
            <TagInput
              label="Primary"
              values={role.responsibilities.primary}
              onChange={(v) => set("responsibilities", { ...role.responsibilities, primary: v })}
            />
            <TagInput
              label="Secondary"
              values={role.responsibilities.secondary}
              onChange={(v) => set("responsibilities", { ...role.responsibilities, secondary: v })}
            />
          </Group>
          <Group title="Required behaviours">
            <TagInput
              label="Workflow"
              values={role.behaviours.workflow}
              onChange={(v) => set("behaviours", { ...role.behaviours, workflow: v })}
            />
            <TagInput
              label="Required checks"
              values={role.behaviours.requiredChecks}
              onChange={(v) => set("behaviours", { ...role.behaviours, requiredChecks: v })}
            />
            <TagInput
              label="Required context"
              values={role.behaviours.requiredContext}
              onChange={(v) => set("behaviours", { ...role.behaviours, requiredContext: v })}
            />
          </Group>
          <Group
            title="Prohibited behaviours"
            hint="Company and platform prohibitions always apply on top of these."
          >
            <TagInput
              label="Never do"
              values={role.prohibited.actions}
              onChange={(v) => set("prohibited", { ...role.prohibited, actions: v })}
            />
            <TagInput
              label="Belongs to another department"
              values={role.prohibited.belongsElsewhere}
              onChange={(v) => set("prohibited", { ...role.prohibited, belongsElsewhere: v })}
            />
            <TagInput
              label="Data not accessed"
              values={role.prohibited.dataNotAccessed}
              onChange={(v) => set("prohibited", { ...role.prohibited, dataNotAccessed: v })}
            />
          </Group>
          <Group
            title="Delegation"
            hint="Delegation is still limited by permissions, company isolation and the platform depth limit."
          >
            <Switch
              label="May delegate"
              checked={role.delegation.mayDelegate}
              onChange={(v) => set("delegation", { ...role.delegation, mayDelegate: v })}
            />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <TagInput
                label="Allowed delegate templates"
                hint={`e.g. ${AGENT_TEMPLATE_KEYS.slice(1, 3).join(", ")}`}
                values={role.delegation.allowedDelegates}
                onChange={(v) =>
                  set("delegation", {
                    ...role.delegation,
                    allowedDelegates: v.filter((k): k is AgentTemplateKey =>
                      (AGENT_TEMPLATE_KEYS as readonly string[]).includes(k),
                    ),
                  })
                }
              />
              <TagInput
                label="Allowed departments"
                hint="Department slugs; empty = any"
                values={role.delegation.allowedDepartments}
                onChange={(v) => set("delegation", { ...role.delegation, allowedDepartments: v })}
              />
            </div>
            <TextField
              label="Maximum delegation depth"
              type="number"
              min={0}
              max={5}
              value={role.delegation.maxDepth}
              onChange={(e) =>
                set("delegation", { ...role.delegation, maxDepth: Number(e.target.value) })
              }
            />
          </Group>
          <Group title="Handoff rules">
            {role.handoff.destinations.length === 0 && (
              <p className="text-[12.5px] text-fg-faint">No standard handoffs.</p>
            )}
            <ul className="space-y-2">
              {role.handoff.destinations.map((d, i) => (
                <li
                  key={i}
                  className="grid grid-cols-1 gap-2 rounded-xl border border-line p-3 sm:grid-cols-[160px_minmax(0,1fr)_auto]"
                >
                  <TextField
                    label="Department"
                    value={d.department}
                    onChange={(e) => {
                      const next = clone(role.handoff.destinations);
                      next[i] = { ...d, department: e.target.value };
                      set("handoff", { destinations: next });
                    }}
                  />
                  <TextField
                    label="When"
                    value={d.when}
                    onChange={(e) => {
                      const next = clone(role.handoff.destinations);
                      next[i] = { ...d, when: e.target.value };
                      set("handoff", { destinations: next });
                    }}
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    className="self-end"
                    onClick={() =>
                      set("handoff", {
                        destinations: role.handoff.destinations.filter((_, j) => j !== i),
                      })
                    }
                  >
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
            <Button
              size="sm"
              onClick={() =>
                set("handoff", {
                  destinations: [
                    ...role.handoff.destinations,
                    {
                      department: "",
                      when: "",
                      requiredFields: [],
                      stopAfterHandoff: true,
                      continueMonitoring: false,
                    },
                  ],
                })
              }
            >
              Add handoff rule
            </Button>
          </Group>
          <Group title="Research limits" hint="Company policy wins when it is stricter.">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <TextField
                label="Max searches"
                type="number"
                min={0}
                placeholder="Company default"
                value={role.research.maxSearches ?? ""}
                onChange={(e) =>
                  set("research", { ...role.research, maxSearches: numOrNull(e.target.value) })
                }
              />
              <TextField
                label="Max retries"
                type="number"
                min={0}
                max={5}
                value={role.research.maxRetries}
                onChange={(e) =>
                  set("research", { ...role.research, maxRetries: Number(e.target.value) })
                }
              />
              <SelectField
                label="Deep research"
                value={role.research.deepResearch}
                onChange={(e) =>
                  set("research", {
                    ...role.research,
                    deepResearch: e.target.value as AgentRole["research"]["deepResearch"],
                  })
                }
                options={[
                  { value: "never", label: "Never" },
                  { value: "approval", label: "With approval" },
                  { value: "allowed", label: "Allowed" },
                ]}
              />
            </div>
            <TextField
              label="Stop condition"
              value={role.research.stopCondition}
              onChange={(e) => set("research", { ...role.research, stopCondition: e.target.value })}
            />
          </Group>
          <Group title="Cost rules">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <TextField
                label="Max task budget (USD)"
                type="number"
                min={0}
                step="0.1"
                placeholder="Agent default"
                value={role.cost.maxTaskBudget ?? ""}
                onChange={(e) =>
                  set("cost", { ...role.cost, maxTaskBudget: numOrNull(e.target.value) })
                }
              />
              <TextField
                label="Escalate above (USD)"
                type="number"
                min={0}
                step="0.1"
                placeholder="None"
                value={role.cost.escalationThreshold ?? ""}
                onChange={(e) =>
                  set("cost", { ...role.cost, escalationThreshold: numOrNull(e.target.value) })
                }
              />
              <SelectField
                label="Preferred provider"
                value={role.cost.providerPreference[0] ?? ""}
                onChange={(e) =>
                  set("cost", {
                    ...role.cost,
                    providerPreference: e.target.value ? [e.target.value as ProviderType] : [],
                  })
                }
                options={[
                  { value: "", label: "Agent default" },
                  ...(Object.keys(PROVIDER_LABELS) as ProviderType[]).map((p) => ({
                    value: p,
                    label: PROVIDER_LABELS[p],
                  })),
                ]}
              />
            </div>
          </Group>
          <Group title="Completion rules">
            <TagInput
              label="Definition of done"
              values={role.completion.definitionOfDone}
              onChange={(v) => set("completion", { ...role.completion, definitionOfDone: v })}
            />
            <TagInput
              label="Stopping conditions"
              values={role.completion.stopConditions}
              onChange={(v) => set("completion", { ...role.completion, stopConditions: v })}
            />
            <TextField
              label="Result format"
              value={role.completion.resultFormat}
              onChange={(e) =>
                set("completion", { ...role.completion, resultFormat: e.target.value })
              }
            />
          </Group>
          <Group
            title="Additional instructions"
            hint="Free text is checked: it can never override company, platform or permission rules."
          >
            <TextArea
              label="Free-text instructions"
              rows={3}
              value={role.freeText}
              onChange={(e) => set("freeText", e.target.value)}
            />
          </Group>
        </fieldset>
        {!readOnly && (
          <div className="sticky bottom-0 flex flex-col gap-2 border-t border-line bg-surface px-4 py-3 sm:flex-row sm:items-end sm:px-5">
            <TextField
              className="flex-1"
              label="Change summary"
              required
              placeholder="What changed and why"
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
            />
            <Button
              variant="primary"
              icon={<Save className="size-4" aria-hidden="true" />}
              disabled={!dirty || !summary.trim() || saving}
              onClick={() => void save()}
            >
              {saving ? "Saving…" : "Save new version"}
            </Button>
          </div>
        )}
        {notice && (
          <p role="status" className="px-5 pb-3 text-[12.5px] text-fg-muted">
            {notice}
          </p>
        )}
      </Panel>
      <Panel
        title="Role history"
        eyebrow={
          data.source === "template" ? "Using template" : `Version ${data.currentVersion?.version}`
        }
        actions={<History className="size-4 text-fg-faint" aria-hidden="true" />}
      >
        {data.versions.length === 0 ? (
          <p className="text-[12.5px] text-fg-muted">
            No agent-specific versions yet — this agent follows its role template.
          </p>
        ) : (
          <ol className="space-y-3" aria-label="Role versions">
            {data.versions.map((v) => (
              <li
                key={v.id}
                className={cn(
                  "rounded-xl border p-3",
                  v.isCurrent ? "border-accent/60 bg-accent-soft/40" : "border-line",
                )}
              >
                <p className="flex items-center justify-between text-[13px] font-semibold">
                  Version {v.version}
                  {v.isCurrent && (
                    <span className="rounded bg-accent px-1.5 text-[10.5px] font-medium text-white">
                      Current
                    </span>
                  )}
                </p>
                <p className="mt-0.5 text-[12.5px]">{v.changeSummary}</p>
                <dl className="mt-1.5 space-y-0.5 text-[11.5px] text-fg-muted">
                  <div>
                    <dt className="inline">Changed by </dt>
                    <dd className="inline">
                      {v.createdBy?.name ?? "System"} · {formatDateTime(v.createdAt)}
                    </dd>
                  </div>
                  <div>
                    <dt className="inline">Approved by </dt>
                    <dd className="inline">{v.approvedBy?.name ?? "—"}</dd>
                  </div>
                  <div>
                    <dt className="inline">Effective from </dt>
                    <dd className="inline">{formatDateTime(v.effectiveFrom)}</dd>
                  </div>
                </dl>
              </li>
            ))}
          </ol>
        )}
      </Panel>
    </div>
  );
}
