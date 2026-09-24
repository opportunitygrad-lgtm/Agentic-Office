"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Globe, Lock, Plus } from "lucide-react";
import {
  BRAND_RULE_CATEGORIES,
  COMMERCIAL_RULE_CATEGORIES,
  COMMERCIAL_RULE_EFFECTS,
  COMPLIANCE_EFFECTS,
  RULE_CHANNELS,
  RULE_PERIODS,
  RULE_SEVERITIES,
  titleCase,
  type RuleDTO,
  type RuleKind,
} from "@aibos/shared";
import { ruleDetail } from "@aibos/context-core";
import { Button, EmptyState, Panel, cn } from "@aibos/ui";
import { Dialog } from "../common/Dialog";
import { SeverityBadge } from "../knowledge/badges";
import { SelectField, Switch, TextArea, TextField } from "../wizard/fields";
import { clientApi } from "@/lib/client-api";

const APPROVAL_PERMISSIONS = [
  "",
  "approval.decide",
  "approval.external_send",
  "approval.financial",
  "approval.high_risk",
  "approval.deployment",
];

const o = (values: readonly string[]) =>
  values.map((v) => ({ value: v, label: v ? titleCase(v) : "None" }));

const KIND_META: Record<RuleKind, { title: string; description: string; empty: string }> = {
  brand: {
    title: "Brand rules",
    description: "Voice, tone, positioning and claims. CRITICAL rules are always in agent context.",
    empty: "No brand rules yet.",
  },
  commercial: {
    title: "Commercial rules",
    description:
      "Pricing, discounts, payments and budget limits — queryable by future execution controllers.",
    empty: "No commercial rules yet.",
  },
  compliance: {
    title: "Compliance rules",
    description: "IF company AND action THEN require approval, prohibit, or add a disclosure.",
    empty: "No compliance rules yet.",
  },
};

type Draft = Record<string, string | number | boolean | null>;

function blank(kind: RuleKind): Draft {
  const base = { title: "", description: "", severity: "required", active: true };
  if (kind === "brand") return { ...base, category: "voice", channel: "all" };
  if (kind === "commercial")
    return {
      ...base,
      category: "pricing",
      appliesTo: "",
      effect: "info",
      limitAmount: null,
      currency: null,
      period: null,
      requiredPermission: null,
    };
  return {
    ...base,
    action: "*",
    jurisdiction: null,
    effect: "info",
    disclosureText: null,
    requiredPermission: null,
  };
}

function fromRule(r: RuleDTO): Draft {
  const {
    id: _i,
    kind: _k,
    companyId: _c,
    status: _s,
    createdBy: _cb,
    approvedBy: _ab,
    approvedAt: _aa,
    updatedAt: _u,
    origin: _o,
    ...rest
  } = r;
  return rest as unknown as Draft;
}

function RuleForm({
  kind,
  initial,
  canApprove,
  editing,
  onSubmit,
  onCancel,
}: {
  kind: RuleKind;
  initial: Draft;
  canApprove: boolean;
  editing: boolean;
  onSubmit: (d: Draft, approve: boolean) => Promise<string | null>;
  onCancel: () => void;
}) {
  const [d, setD] = useState<Draft>(initial);
  const [approve, setApprove] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const set = (k: string, v: Draft[string]) => setD((p) => ({ ...p, [k]: v }));
  const str = (k: string) => (d[k] as string | null) ?? "";
  const nullable = (v: string) => (v ? v : null);

  return (
    <form
      className="space-y-4 p-5"
      aria-label={`${editing ? "Edit" : "Add"} ${kind} rule`}
      onSubmit={async (e) => {
        e.preventDefault();
        setSaving(true);
        setError(await onSubmit(d, approve));
        setSaving(false);
      }}
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <TextField
          label="Title"
          required
          value={str("title")}
          onChange={(e) => set("title", e.target.value)}
          className="sm:col-span-2"
        />
        <TextArea
          label="Rule"
          required
          value={str("description")}
          onChange={(e) => set("description", e.target.value)}
          className="sm:col-span-2"
        />
        <SelectField
          label="Severity"
          value={str("severity")}
          options={o(RULE_SEVERITIES)}
          onChange={(e) => set("severity", e.target.value)}
        />
        {kind === "brand" && (
          <>
            <SelectField
              label="Category"
              value={str("category")}
              options={o(BRAND_RULE_CATEGORIES)}
              onChange={(e) => set("category", e.target.value)}
            />
            <SelectField
              label="Channel"
              value={str("channel")}
              options={o(RULE_CHANNELS)}
              onChange={(e) => set("channel", e.target.value)}
            />
          </>
        )}
        {kind === "commercial" && (
          <>
            <SelectField
              label="Category"
              value={str("category")}
              options={o(COMMERCIAL_RULE_CATEGORIES)}
              onChange={(e) => set("category", e.target.value)}
            />
            <TextField
              label="Applies to action"
              hint="e.g. meta.budget_increase, sales.discount"
              required
              value={str("appliesTo")}
              onChange={(e) => set("appliesTo", e.target.value)}
            />
            <SelectField
              label="Effect"
              value={str("effect")}
              options={o(COMMERCIAL_RULE_EFFECTS)}
              onChange={(e) => set("effect", e.target.value)}
            />
            <TextField
              label="Limit amount"
              type="number"
              min={0}
              value={
                d.limitAmount === null || d.limitAmount === undefined ? "" : String(d.limitAmount)
              }
              onChange={(e) =>
                set("limitAmount", e.target.value === "" ? null : Number(e.target.value))
              }
            />
            <TextField
              label="Currency"
              hint="ISO code, e.g. INR"
              value={str("currency")}
              onChange={(e) => set("currency", nullable(e.target.value.toUpperCase()))}
            />
            <SelectField
              label="Period"
              value={str("period")}
              options={[{ value: "", label: "None" }, ...o(RULE_PERIODS)]}
              onChange={(e) => set("period", nullable(e.target.value))}
            />
            <SelectField
              label="Approval authority"
              value={str("requiredPermission")}
              options={o(APPROVAL_PERMISSIONS)}
              onChange={(e) => set("requiredPermission", nullable(e.target.value))}
            />
          </>
        )}
        {kind === "compliance" && (
          <>
            <TextField
              label="IF action"
              hint="e.g. email.send, meta.*, or * for all"
              required
              value={str("action")}
              onChange={(e) => set("action", e.target.value)}
            />
            <TextField
              label="Jurisdiction"
              value={str("jurisdiction")}
              onChange={(e) => set("jurisdiction", nullable(e.target.value))}
            />
            <SelectField
              label="THEN"
              value={str("effect")}
              options={o(COMPLIANCE_EFFECTS)}
              onChange={(e) => set("effect", e.target.value)}
            />
            <SelectField
              label="Approval authority"
              value={str("requiredPermission")}
              options={o(APPROVAL_PERMISSIONS)}
              onChange={(e) => set("requiredPermission", nullable(e.target.value))}
            />
            <TextArea
              label="Disclosure text"
              value={str("disclosureText")}
              onChange={(e) => set("disclosureText", nullable(e.target.value))}
              className="sm:col-span-2"
            />
          </>
        )}
      </div>
      <Switch
        label="Active"
        description="Inactive rules never reach agents."
        checked={Boolean(d.active)}
        onChange={(v) => set("active", v)}
      />
      {!editing && canApprove && (
        <Switch
          label="Approve immediately"
          description="Otherwise the rule is saved as a draft for approval."
          checked={approve}
          onChange={setApprove}
        />
      )}
      {error && (
        <p
          role="alert"
          className="rounded-lg bg-rose-500/10 px-3 py-2 text-[12.5px] text-rose-700 dark:text-rose-300"
        >
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2 border-t border-line pt-4">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="primary" type="submit" disabled={saving}>
          {saving ? "Saving…" : editing ? "Save rule" : "Add rule"}
        </Button>
      </div>
    </form>
  );
}

export function RulesPanel({
  kind,
  rules,
  companySlug,
  canManage,
  canApprove,
}: {
  kind: RuleKind;
  rules: RuleDTO[];
  companySlug: string;
  canManage: boolean;
  canApprove: boolean;
}) {
  const router = useRouter();
  const [form, setForm] = useState<{ rule: RuleDTO | null } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const meta = KIND_META[kind];

  async function lifecycle(rule: RuleDTO, action: "approve" | "archive") {
    const res = await clientApi(`/v1/rules/${kind}/${rule.id}/${action}`, {
      method: "POST",
      body: {},
    });
    setNotice(res.ok ? `Rule ${action === "approve" ? "approved" : "archived"}.` : res.message);
    if (res.ok) router.refresh();
  }

  async function submit(d: Draft, approve: boolean): Promise<string | null> {
    const res = form?.rule
      ? await clientApi(`/v1/rules/${kind}/${form.rule.id}`, { method: "PATCH", body: d })
      : await clientApi(`/v1/companies/${companySlug}/rules/${kind}`, {
          method: "POST",
          body: { ...d, approve },
        });
    if (!res.ok)
      return res.issues?.length
        ? res.issues.map((i) => `${i.path}: ${i.message}`).join("; ")
        : res.message;
    setForm(null);
    setNotice(
      form?.rule ? "Rule saved." : approve ? "Rule added and approved." : "Rule added as a draft.",
    );
    router.refresh();
    return null;
  }

  return (
    <Panel
      title={meta.title}
      eyebrow={`${rules.filter((r) => r.status === "approved" && r.active).length} binding`}
      actions={
        canManage ? (
          <Button
            size="sm"
            icon={<Plus className="size-3.5" aria-hidden="true" />}
            onClick={() => setForm({ rule: null })}
          >
            Add rule
          </Button>
        ) : null
      }
      bodyClassName="p-0"
    >
      <p className="border-b border-line/70 px-5 py-2.5 text-[12.5px] text-fg-muted">
        {meta.description}
      </p>
      {notice && (
        <p role="status" className="border-b border-line/70 px-5 py-2 text-[12.5px] text-fg-muted">
          {notice}
        </p>
      )}
      {rules.length === 0 ? (
        <div className="p-5">
          <EmptyState title={meta.empty} />
        </div>
      ) : (
        <ul className="divide-y divide-line/70" data-testid={`rules-${kind}`}>
          {rules.map((r) => {
            const detail = ruleDetail({ ...r, kind } as never);
            const global = r.companyId === null;
            return (
              <li
                key={r.id}
                className={cn(
                  "px-5 py-3.5",
                  (!r.active || r.status !== "approved") && "opacity-80",
                )}
              >
                <div className="flex flex-wrap items-center gap-1.5">
                  <SeverityBadge value={r.severity} />
                  <span className="text-[13.5px] font-semibold">{r.title}</span>
                  {global && (
                    <span className="inline-flex items-center gap-1 rounded-md bg-sky-500/10 px-1.5 py-0.5 text-[11px] font-medium text-sky-700 dark:text-sky-300">
                      <Globe className="size-3" aria-hidden="true" /> Global
                    </span>
                  )}
                  <span
                    className={cn(
                      "rounded-md px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset",
                      r.status === "approved"
                        ? "bg-emerald-500/10 text-emerald-700 ring-emerald-600/20 dark:text-emerald-300"
                        : "bg-surface-2 text-fg-muted ring-line",
                    )}
                  >
                    {r.status === "approved"
                      ? r.active
                        ? "Binding"
                        : "Approved · inactive"
                      : titleCase(r.status)}
                  </span>
                  <span className="rounded-md bg-surface-2 px-1.5 py-0.5 text-[11px] text-fg-muted">
                    {titleCase(r.kind === "compliance" ? r.effect : r.category)}
                  </span>
                </div>
                <p className="mt-1 text-[13px] text-fg-muted">{r.description}</p>
                {detail && (
                  <p className="mt-1.5 inline-flex items-center gap-1.5 rounded-md bg-surface-2 px-2 py-1 font-mono text-[11.5px] text-fg-muted">
                    <Lock className="size-3" aria-hidden="true" />
                    {detail}
                  </p>
                )}
                {!global && canManage && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {r.status === "draft" && canApprove && (
                      <Button size="sm" variant="primary" onClick={() => lifecycle(r, "approve")}>
                        Approve
                      </Button>
                    )}
                    {r.status !== "archived" && (
                      <Button size="sm" variant="ghost" onClick={() => setForm({ rule: r })}>
                        Edit
                      </Button>
                    )}
                    {r.status !== "archived" && (
                      <Button size="sm" variant="ghost" onClick={() => lifecycle(r, "archive")}>
                        Archive
                      </Button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <Dialog
        open={!!form}
        onClose={() => setForm(null)}
        title={form?.rule ? `Edit ${kind} rule` : `Add ${kind} rule`}
        description={
          form?.rule?.status === "approved" && !canApprove
            ? "Editing an approved rule returns it to draft until someone with approval rights re-approves it."
            : undefined
        }
      >
        {form && (
          <RuleForm
            kind={kind}
            initial={form.rule ? fromRule(form.rule) : blank(kind)}
            canApprove={canApprove}
            editing={!!form.rule}
            onSubmit={submit}
            onCancel={() => setForm(null)}
          />
        )}
      </Dialog>
    </Panel>
  );
}
