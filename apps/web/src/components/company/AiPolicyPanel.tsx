"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Lock, Pencil, Trash2 } from "lucide-react";
import {
  AI_POLICY_MODES,
  AI_POLICY_MODE_LABELS,
  PROVIDER_LABELS,
  PROVIDER_TYPES,
  SENSITIVITY_READ_PERMISSION,
  titleCase,
  type AgentDTO,
  type AiPolicyMode,
  type CompanyAiPolicyDTO,
  type KnowledgeAccessPolicyDTO,
  type ProviderType,
} from "@aibos/shared";
import { Button, Panel, cn } from "@aibos/ui";
import { SelectField, TagInput, TextField } from "../wizard/fields";

/** Providers without a live adapter yet (Stage 05): shown, never presented as usable. */
const NOT_CONNECTED: string[] = ["OPENAI", "GROK"];
import { SensitivityBadge } from "../knowledge/badges";
import { hasPermission, useMe } from "../shell/SessionContext";
import { clientApi } from "@/lib/client-api";

const MODE_ROWS: {
  key: "deepResearchPolicy" | "externalActionPolicy" | "browserPolicy" | "autoSendPolicy";
  label: string;
  hint: string;
}[] = [
  { key: "deepResearchPolicy", label: "Deep research", hint: "Long, expensive research runs" },
  {
    key: "externalActionPolicy",
    label: "External actions",
    hint: "Anything that leaves the company",
  },
  { key: "browserPolicy", label: "Browser use", hint: "Controlled browser sessions" },
  { key: "autoSendPolicy", label: "Email auto-send", hint: "Sending without per-message approval" },
];

const MODE_TONE: Record<AiPolicyMode, string> = {
  disabled: "bg-surface-2 text-fg-muted ring-line",
  approval_required: "bg-violet-500/10 text-violet-700 ring-violet-600/20 dark:text-violet-300",
  allowed: "bg-emerald-500/10 text-emerald-700 ring-emerald-600/20 dark:text-emerald-300",
};

export function AiPolicyPanel({
  companySlug,
  policy,
  canEdit,
}: {
  companySlug: string;
  policy: CompanyAiPolicyDTO;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [p, setP] = useState(policy);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    setMessage(null);
    const { updatedAt: _u, ...body } = p;
    const res = await clientApi(`/v1/companies/${companySlug}/ai-policy`, { method: "PUT", body });
    setSaving(false);
    if (!res.ok) return setMessage(res.issues?.map((i) => i.message).join("; ") || res.message);
    setEditing(false);
    router.refresh();
  }

  return (
    <Panel
      title="AI operations policy"
      eyebrow="Company-wide AI rules"
      actions={
        canEdit && !editing ? (
          <Button
            size="sm"
            icon={<Pencil className="size-3.5" aria-hidden="true" />}
            onClick={() => {
              setP(policy);
              setEditing(true);
            }}
          >
            Edit
          </Button>
        ) : null
      }
    >
      <div className="space-y-5">
        <div>
          <p className="mb-2 text-[12px] text-fg-faint">Providers</p>
          {editing ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <SelectField
                label="Preferred provider"
                value={p.defaultProvider}
                options={PROVIDER_TYPES.map((v) => ({
                  value: v,
                  label: `${PROVIDER_LABELS[v]}${NOT_CONNECTED.includes(v) ? " (not connected)" : ""}`,
                }))}
                onChange={(e) => setP({ ...p, defaultProvider: e.target.value as ProviderType })}
              />
              <fieldset>
                <legend className="mb-1.5 text-[12.5px] font-medium">Allowed providers</legend>
                <div className="flex flex-wrap gap-1.5">
                  {PROVIDER_TYPES.map((v) => {
                    const on = p.allowedProviders.includes(v);
                    return (
                      <button
                        key={v}
                        type="button"
                        aria-pressed={on}
                        onClick={() =>
                          setP({
                            ...p,
                            allowedProviders: on
                              ? p.allowedProviders.filter((x) => x !== v)
                              : [...p.allowedProviders, v],
                          })
                        }
                        className={cn(
                          "focus-ring rounded-lg px-2.5 py-1.5 text-[12.5px] font-medium ring-1 ring-inset",
                          on ? "bg-accent text-white ring-accent" : "ring-line hover:bg-surface-2",
                        )}
                      >
                        {PROVIDER_LABELS[v]}
                        {NOT_CONNECTED.includes(v) && (
                          <span className="ml-1 opacity-70">(not connected)</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </fieldset>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-1.5 text-[12.5px]">
              {policy.allowedProviders.map((v) => (
                <span
                  key={v}
                  className={cn(
                    "rounded-md px-2 py-0.5 ring-1 ring-inset",
                    v === policy.defaultProvider
                      ? "bg-accent-soft font-semibold text-accent ring-accent/20"
                      : "bg-surface-2 ring-line",
                  )}
                >
                  {PROVIDER_LABELS[v]}
                  {v === policy.defaultProvider && " · preferred"}
                </span>
              ))}
            </div>
          )}
        </div>

        <div data-testid="model-policy">
          <p className="mb-2 text-[12px] text-fg-faint">Model policy</p>
          {editing ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <SelectField
                label="Default model tier"
                value={p.defaultModelTier}
                options={[
                  { value: "standard", label: "Standard (Claude Sonnet)" },
                  { value: "auto", label: "Auto (premium only for high-complexity tasks)" },
                  { value: "premium", label: "Premium (Claude Opus, if your plan includes it)" },
                ]}
                onChange={(e) =>
                  setP({ ...p, defaultModelTier: e.target.value as typeof p.defaultModelTier })
                }
              />
              <SelectField
                label="Maximum response detail"
                value={p.maxResponseDetail}
                options={[
                  { value: "short", label: "Short" },
                  { value: "normal", label: "Normal" },
                  { value: "detailed", label: "Detailed" },
                  { value: "custom", label: "Custom" },
                ]}
                onChange={(e) =>
                  setP({ ...p, maxResponseDetail: e.target.value as typeof p.maxResponseDetail })
                }
              />
              <label className="flex items-center gap-2 text-[12.5px]">
                <input
                  type="checkbox"
                  checked={p.premiumAllowed}
                  onChange={(e) => setP({ ...p, premiumAllowed: e.target.checked })}
                />
                Premium model allowed
              </label>
              <label className="flex items-center gap-2 text-[12.5px]">
                <input
                  type="checkbox"
                  checked={p.fallbackAllowed}
                  onChange={(e) => setP({ ...p, fallbackAllowed: e.target.checked })}
                />
                Allow fallback to the agent&apos;s fallback provider
              </label>
            </div>
          ) : (
            <dl className="grid grid-cols-2 gap-2 text-[12.5px] sm:grid-cols-4">
              <div>
                <dt className="text-fg-faint">Default tier</dt>
                <dd className="font-medium capitalize">{policy.defaultModelTier}</dd>
              </div>
              <div>
                <dt className="text-fg-faint">Premium allowed</dt>
                <dd className="font-medium">{policy.premiumAllowed ? "Yes" : "No"}</dd>
              </div>
              <div>
                <dt className="text-fg-faint">Max response detail</dt>
                <dd className="font-medium capitalize">{policy.maxResponseDetail}</dd>
              </div>
              <div>
                <dt className="text-fg-faint">Provider fallback</dt>
                <dd className="font-medium">
                  {policy.fallbackAllowed ? "Allowed" : "Not allowed"}
                </dd>
              </div>
            </dl>
          )}
        </div>

        <div>
          <p className="mb-2 text-[12px] text-fg-faint">Action policies</p>
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {MODE_ROWS.map((row) => (
              <li key={row.key} className="rounded-xl border border-line p-3">
                <p className="text-[13px] font-medium">{row.label}</p>
                <p className="text-[11.5px] text-fg-faint">{row.hint}</p>
                {editing ? (
                  <div
                    className="mt-2 flex flex-wrap gap-1"
                    role="radiogroup"
                    aria-label={row.label}
                  >
                    {AI_POLICY_MODES.map((m) => (
                      <button
                        key={m}
                        type="button"
                        role="radio"
                        aria-checked={p[row.key] === m}
                        onClick={() => setP({ ...p, [row.key]: m })}
                        className={cn(
                          "focus-ring rounded-md px-2 py-1 text-[11.5px] font-medium ring-1 ring-inset",
                          p[row.key] === m
                            ? MODE_TONE[m]
                            : "ring-line text-fg-faint hover:bg-surface-2",
                        )}
                      >
                        {AI_POLICY_MODE_LABELS[m]}
                      </button>
                    ))}
                  </div>
                ) : (
                  <span
                    className={cn(
                      "mt-2 inline-flex rounded-md px-2 py-0.5 text-[11.5px] font-medium ring-1 ring-inset",
                      MODE_TONE[policy[row.key]],
                    )}
                  >
                    {AI_POLICY_MODE_LABELS[policy[row.key]]}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {editing ? (
            <>
              <TextField
                label="Default research limit"
                hint="External searches per task (the agent's own limit also applies)"
                type="number"
                min={0}
                max={500}
                value={String(p.defaultResearchLimit)}
                onChange={(e) => setP({ ...p, defaultResearchLimit: Number(e.target.value) })}
              />
              <SelectField
                label="Expired knowledge"
                value={p.staleKnowledgePolicy}
                options={[
                  { value: "exclude", label: "Exclude from agent context" },
                  { value: "mark_stale", label: "Include, clearly marked STALE" },
                ]}
                onChange={(e) =>
                  setP({
                    ...p,
                    staleKnowledgePolicy: e.target
                      .value as CompanyAiPolicyDTO["staleKnowledgePolicy"],
                  })
                }
              />
              <TagInput
                label="Company-specific AI rules"
                values={p.customRules}
                onChange={(v) => setP({ ...p, customRules: v })}
                className="sm:col-span-2"
              />
            </>
          ) : (
            <>
              <div>
                <p className="text-[12px] text-fg-faint">Default research limit</p>
                <p className="num text-[15px] font-semibold">
                  {policy.defaultResearchLimit} searches / task
                </p>
              </div>
              <div>
                <p className="text-[12px] text-fg-faint">Expired knowledge</p>
                <p className="text-[13px] font-medium">
                  {policy.staleKnowledgePolicy === "exclude"
                    ? "Excluded from context"
                    : "Included, marked STALE"}
                </p>
              </div>
              <div className="sm:col-span-2">
                <p className="text-[12px] text-fg-faint">Company-specific AI rules</p>
                {policy.customRules.length ? (
                  <ul className="mt-1 list-disc space-y-1 pl-4 text-[13px]">
                    {policy.customRules.map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-[13px] text-fg-faint">None</p>
                )}
              </div>
            </>
          )}
        </div>

        {message && (
          <p
            role="alert"
            className="rounded-lg bg-rose-500/10 px-3 py-2 text-[12.5px] text-rose-700 dark:text-rose-300"
          >
            {message}
          </p>
        )}
        {editing && (
          <div className="flex justify-end gap-2 border-t border-line pt-4">
            <Button variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={save} disabled={saving}>
              {saving ? "Saving…" : "Save policy"}
            </Button>
          </div>
        )}
      </div>
    </Panel>
  );
}

export function KnowledgeAccessPanel({
  companySlug,
  policies,
  agents,
  departments,
  canManage,
  companyId,
}: {
  companySlug: string;
  companyId: string;
  policies: KnowledgeAccessPolicyDTO[];
  agents: AgentDTO[];
  departments: { id: string; name: string }[];
  canManage: boolean;
}) {
  const router = useRouter();
  const me = useMe();
  // Never above the viewer's own clearance (the API enforces the same rule).
  const grantable = (["confidential", "restricted"] as const).filter((s) =>
    hasPermission(me, SENSITIVITY_READ_PERMISSION[s]!, companyId),
  );
  const [target, setTarget] = useState("");
  const [level, setLevel] = useState<"confidential" | "restricted">(grantable[0] ?? "confidential");
  const [message, setMessage] = useState<string | null>(null);

  async function add() {
    const [kind, id] = target.split(":");
    const res = await clientApi(`/v1/companies/${companySlug}/knowledge-access`, {
      method: "POST",
      body: {
        agentId: kind === "agent" ? id : null,
        departmentId: kind === "department" ? id : null,
        maxSensitivity: level,
      },
    });
    setMessage(res.ok ? null : res.message);
    if (res.ok) {
      setTarget("");
      router.refresh();
    }
  }

  async function remove(id: string) {
    const res = await clientApi(`/v1/companies/${companySlug}/knowledge-access/${id}`, {
      method: "DELETE",
    });
    setMessage(res.ok ? null : res.message);
    if (res.ok) router.refresh();
  }

  return (
    <Panel title="Agent knowledge access" eyebrow="Sensitivity clearance">
      <p className="text-[12.5px] text-fg-muted">
        By default company agents read <strong>PUBLIC</strong> and <strong>INTERNAL</strong>{" "}
        approved knowledge. CONFIDENTIAL and RESTRICTED knowledge needs an explicit grant here.
      </p>
      <ul className="mt-3 space-y-1.5">
        {policies.length === 0 && (
          <li className="text-[12.5px] text-fg-faint">No elevated access granted.</li>
        )}
        {policies.map((p) => (
          <li
            key={p.id}
            className="flex items-center justify-between gap-2 rounded-lg border border-line px-3 py-2 text-[12.5px]"
          >
            <span className="flex min-w-0 items-center gap-2">
              <Lock className="size-3.5 shrink-0 text-fg-faint" aria-hidden="true" />
              <span className="truncate font-medium">
                {p.agent?.name ??
                  (p.department ? `${p.department.name} department` : "All company agents")}
              </span>
              <SensitivityBadge value={p.maxSensitivity} />
            </span>
            {canManage && (
              <button
                type="button"
                onClick={() => remove(p.id)}
                aria-label={`Revoke access for ${p.agent?.name ?? p.department?.name ?? "all agents"}`}
                className="focus-ring rounded p-1 text-fg-faint hover:text-rose-600"
              >
                <Trash2 className="size-3.5" />
              </button>
            )}
          </li>
        ))}
      </ul>
      {canManage && grantable.length > 0 && (
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <select
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            aria-label="Grant access to"
            className="focus-ring h-9 min-w-0 flex-1 rounded-lg border border-line bg-surface px-2 text-[13px]"
          >
            <option value="">Grant access to…</option>
            <option value="company:">All company agents</option>
            <optgroup label="Departments">
              {departments.map((d) => (
                <option key={d.id} value={`department:${d.id}`}>
                  {d.name}
                </option>
              ))}
            </optgroup>
            <optgroup label="Agents">
              {agents.map((a) => (
                <option key={a.id} value={`agent:${a.id}`}>
                  {a.name}
                </option>
              ))}
            </optgroup>
          </select>
          <select
            value={level}
            onChange={(e) => setLevel(e.target.value as typeof level)}
            aria-label="Maximum sensitivity"
            className="focus-ring h-9 rounded-lg border border-line bg-surface px-2 text-[13px]"
          >
            {grantable.map((g) => (
              <option key={g} value={g}>
                Up to {titleCase(g)}
              </option>
            ))}
          </select>
          <Button onClick={add} disabled={!target}>
            Grant
          </Button>
        </div>
      )}
      {message && (
        <p role="alert" className="mt-2 text-[12.5px] text-rose-600">
          {message}
        </p>
      )}
    </Panel>
  );
}
