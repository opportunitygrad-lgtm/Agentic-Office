"use client";

import { useState } from "react";
import { FileText, Globe, PenLine, Search, SlidersHorizontal } from "lucide-react";
import {
  AI_SOURCE_TYPES,
  SENSITIVITY_LEVELS,
  titleCase,
  type KnowledgeItemDTO,
  type KnowledgeSourceType,
  type SensitivityLevel,
} from "@aibos/shared";
import { Button, cn } from "@aibos/ui";
import { SelectField, Switch, TagInput, TextArea, TextField } from "../wizard/fields";
import { clientApi } from "@/lib/client-api";
import {
  CONFIDENCE_OPTIONS,
  SOURCE_OPTIONS,
  TYPE_OPTIONS,
  VERIFICATION_OPTIONS,
  fromDateInput,
  toDateInput,
} from "./labels";

type SourceMode = "manual" | "url" | "document" | "research" | "custom";

const MODES: {
  key: SourceMode;
  label: string;
  icon: typeof PenLine;
  source: KnowledgeSourceType;
  hint: string;
}[] = [
  {
    key: "manual",
    label: "Manual entry",
    icon: PenLine,
    source: "management_entry",
    hint: "Typed in by management or staff.",
  },
  {
    key: "url",
    label: "URL reference",
    icon: Globe,
    source: "company_website",
    hint: "A web page. The URL is stored as provenance; nothing is scraped.",
  },
  {
    key: "document",
    label: "Document reference",
    icon: FileText,
    source: "company_document",
    hint: "Reference metadata only — files are not uploaded or parsed yet.",
  },
  {
    key: "research",
    label: "Research",
    icon: Search,
    source: "web_research",
    hint: "Research findings. Enters as UNVERIFIED until a human verifies it.",
  },
  {
    key: "custom",
    label: "Custom source",
    icon: SlidersHorizontal,
    source: "unknown",
    hint: "Pick any provenance type.",
  },
];

const MODE_SOURCES: Record<SourceMode, KnowledgeSourceType[]> = {
  manual: ["management_entry"],
  url: ["company_website", "partner_document", "web_research"],
  document: ["company_document", "partner_document", "google_sheet", "email", "import"],
  research: ["web_research", "claude_research", "openai_research", "grok_research"],
  custom: SOURCE_OPTIONS.map((o) => o.value),
};

function modeFor(source: KnowledgeSourceType): SourceMode {
  if (source === "management_entry") return "manual";
  if (["claude_research", "openai_research", "grok_research", "web_research"].includes(source))
    return "research";
  if (source === "company_website") return "url";
  if (["company_document", "partner_document", "google_sheet", "email", "import"].includes(source))
    return "document";
  return "custom";
}

interface FormState {
  title: string;
  summary: string;
  content: string;
  type: string;
  category: string;
  tags: string[];
  departmentId: string;
  sourceType: KnowledgeSourceType;
  sourceReference: string;
  sourceUrl: string;
  sourceFileRef: string;
  sourceOwner: string;
  provenanceNotes: string;
  confidence: string;
  verificationStatus: string;
  sensitivity: SensitivityLevel;
  usableAsUnverified: boolean;
  effectiveAt: string;
  reviewAt: string;
  expiresAt: string;
  conflictKey: string;
}

function initial(item?: KnowledgeItemDTO): FormState {
  return {
    title: item?.title ?? "",
    summary: item?.summary ?? "",
    content: item?.content ?? "",
    type: item?.type ?? "company_fact",
    category: item?.category ?? "",
    tags: item?.tags ?? [],
    departmentId: item?.department?.id ?? "",
    sourceType: item?.sourceType ?? "management_entry",
    sourceReference: item?.sourceReference ?? "",
    sourceUrl: item?.sourceUrl ?? "",
    sourceFileRef: item?.sourceFileRef ?? "",
    sourceOwner: item?.sourceOwner ?? "",
    provenanceNotes: item?.provenanceNotes ?? "",
    confidence: item?.confidence ?? "medium",
    verificationStatus: item?.verificationStatus ?? "unverified",
    sensitivity: item?.sensitivity ?? "internal",
    usableAsUnverified: item?.usableAsUnverified ?? false,
    effectiveAt: toDateInput(item?.effectiveAt),
    reviewAt: toDateInput(item?.reviewAt),
    expiresAt: toDateInput(item?.expiresAt),
    conflictKey: item?.conflictKey ?? "",
  };
}

function payload(s: FormState) {
  return {
    title: s.title,
    summary: s.summary || null,
    content: s.content,
    type: s.type,
    category: s.category || null,
    tags: s.tags.map((t) => t.toLowerCase()),
    departmentId: s.departmentId || null,
    sourceType: s.sourceType,
    sourceReference: s.sourceReference || null,
    sourceUrl: s.sourceUrl || null,
    sourceFileRef: s.sourceFileRef || null,
    sourceOwner: s.sourceOwner || null,
    provenanceNotes: s.provenanceNotes || null,
    confidence: s.confidence,
    verificationStatus: s.verificationStatus,
    sensitivity: s.sensitivity,
    usableAsUnverified: s.usableAsUnverified,
    effectiveAt: fromDateInput(s.effectiveAt),
    reviewAt: fromDateInput(s.reviewAt),
    expiresAt: fromDateInput(s.expiresAt),
    conflictKey: s.conflictKey || null,
  };
}

/**
 * Add / edit knowledge. Creation always produces a DRAFT; editing an approved
 * item materially creates a new draft version on the server.
 */
export function KnowledgeForm({
  companyId,
  item,
  departments,
  allowedSensitivity,
  onDone,
  onCancel,
}: {
  companyId: string | null;
  item?: KnowledgeItemDTO;
  departments: { id: string; name: string }[];
  allowedSensitivity: SensitivityLevel[];
  onDone: (item: KnowledgeItemDTO, newVersion: boolean) => void;
  onCancel: () => void;
}) {
  const [s, setS] = useState<FormState>(() => initial(item));
  const [mode, setMode] = useState<SourceMode>(() => modeFor(s.sourceType));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setS((prev) => ({ ...prev, [k]: v }));
  const aiSource = AI_SOURCE_TYPES.includes(s.sourceType);

  function pickMode(m: SourceMode) {
    setMode(m);
    const source = MODES.find((x) => x.key === m)!.source;
    setS((prev) => ({
      ...prev,
      sourceType: MODE_SOURCES[m].includes(prev.sourceType) ? prev.sourceType : source,
      ...(m === "research" ? { verificationStatus: "unverified", confidence: "low" } : {}),
    }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setErrors({});
    setMessage(null);
    const body = payload(s);
    let res;
    if (item) {
      const before = payload(initial(item)) as Record<string, unknown>;
      const changed = Object.fromEntries(
        Object.entries(body).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(before[k])),
      );
      if (!Object.keys(changed).length) {
        setSaving(false);
        onCancel();
        return;
      }
      res = await clientApi<{ data: KnowledgeItemDTO; newVersion: boolean }>(
        `/v1/knowledge/${item.id}`,
        {
          method: "PATCH",
          body: changed,
        },
      );
    } else {
      res = await clientApi<{ data: KnowledgeItemDTO; newVersion?: boolean }>("/v1/knowledge", {
        method: "POST",
        body: { ...body, scope: companyId ? "company" : "global", companyId },
      });
    }
    setSaving(false);
    if (!res.ok) {
      setMessage(res.message);
      setErrors(Object.fromEntries((res.issues ?? []).map((i) => [i.path, i.message])));
      return;
    }
    onDone(res.data.data, Boolean(res.data.newVersion));
  }

  const modeInfo = MODES.find((m) => m.key === mode)!;
  return (
    <form
      onSubmit={submit}
      className="space-y-5 p-5"
      noValidate
      aria-label={item ? "Edit knowledge" : "Add knowledge"}
    >
      <fieldset>
        <legend className="mb-2 text-[12.5px] font-medium">Where does this come from?</legend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5" role="radiogroup">
          {MODES.map((m) => (
            <button
              key={m.key}
              type="button"
              role="radio"
              aria-checked={mode === m.key}
              onClick={() => pickMode(m.key)}
              className={cn(
                "focus-ring flex flex-col items-start gap-1 rounded-xl border p-2.5 text-left text-[12px] transition-colors",
                mode === m.key
                  ? "border-accent bg-accent-soft/60 text-fg"
                  : "border-line text-fg-muted hover:border-line-strong",
              )}
            >
              <m.icon className="size-4" aria-hidden="true" />
              <span className="font-medium">{m.label}</span>
            </button>
          ))}
        </div>
        <p className="mt-2 text-[12px] text-fg-faint">{modeInfo.hint}</p>
      </fieldset>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <TextField
          label="Title"
          required
          value={s.title}
          error={errors.title}
          onChange={(e) => set("title", e.target.value)}
          className="sm:col-span-2"
        />
        <TextArea
          label="Summary"
          hint="One or two sentences — used as the agent snippet."
          value={s.summary}
          error={errors.summary}
          onChange={(e) => set("summary", e.target.value)}
          className="sm:col-span-2"
        />
        <TextArea
          label="Content"
          required
          rows={6}
          value={s.content}
          error={errors.content}
          onChange={(e) => set("content", e.target.value)}
          className="sm:col-span-2"
        />
        <SelectField
          label="Type"
          value={s.type}
          options={TYPE_OPTIONS}
          onChange={(e) => set("type", e.target.value)}
        />
        <TextField
          label="Category"
          value={s.category}
          error={errors.category}
          onChange={(e) => set("category", e.target.value)}
        />
        <TagInput
          label="Tags"
          values={s.tags}
          onChange={(v) => set("tags", v)}
          error={errors.tags}
          className="sm:col-span-2"
        />
        {companyId && (
          <SelectField
            label="Department"
            value={s.departmentId}
            options={[
              { value: "", label: "Company-wide" },
              ...departments.map((d) => ({ value: d.id, label: d.name })),
            ]}
            onChange={(e) => set("departmentId", e.target.value)}
          />
        )}
        <SelectField
          label="Source type"
          value={s.sourceType}
          options={SOURCE_OPTIONS.filter((o) => MODE_SOURCES[mode].includes(o.value))}
          onChange={(e) => set("sourceType", e.target.value as KnowledgeSourceType)}
        />
        {(mode === "url" || mode === "research" || mode === "custom") && (
          <TextField
            label="Source URL"
            type="url"
            value={s.sourceUrl}
            error={errors.sourceUrl}
            onChange={(e) => set("sourceUrl", e.target.value)}
            placeholder="https://"
          />
        )}
        {(mode === "document" || mode === "custom") && (
          <TextField
            label="File / document reference"
            hint="Metadata only in this stage."
            value={s.sourceFileRef}
            onChange={(e) => set("sourceFileRef", e.target.value)}
          />
        )}
        <TextField
          label="Source reference"
          hint="Document title, page, message id…"
          value={s.sourceReference}
          onChange={(e) => set("sourceReference", e.target.value)}
        />
        <TextField
          label="Source owner"
          value={s.sourceOwner}
          onChange={(e) => set("sourceOwner", e.target.value)}
        />
        <TextArea
          label="Provenance notes"
          value={s.provenanceNotes}
          onChange={(e) => set("provenanceNotes", e.target.value)}
          className="sm:col-span-2"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 rounded-xl border border-line bg-surface-2/40 p-4 sm:grid-cols-3">
        <SelectField
          label="Confidence"
          value={s.confidence}
          options={CONFIDENCE_OPTIONS}
          onChange={(e) => set("confidence", e.target.value)}
        />
        <SelectField
          label="Verification"
          value={s.verificationStatus}
          error={errors.verificationStatus}
          options={VERIFICATION_OPTIONS.filter(
            (o) => !(aiSource && o.value === "management_confirmed"),
          )}
          onChange={(e) => set("verificationStatus", e.target.value)}
        />
        <div>
          <p className="mb-1.5 text-[12.5px] font-medium">Sensitivity</p>
          <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Sensitivity">
            {SENSITIVITY_LEVELS.map((lvl) => (
              <button
                key={lvl}
                type="button"
                role="radio"
                aria-checked={s.sensitivity === lvl}
                disabled={!allowedSensitivity.includes(lvl)}
                onClick={() => set("sensitivity", lvl)}
                className={cn(
                  "focus-ring rounded-md px-2 py-1 text-[12px] font-medium ring-1 ring-inset disabled:opacity-40",
                  s.sensitivity === lvl
                    ? "bg-accent text-white ring-accent"
                    : "ring-line hover:bg-surface-2",
                )}
              >
                {titleCase(lvl)}
              </button>
            ))}
          </div>
        </div>
        <TextField
          label="Effective from"
          type="date"
          value={s.effectiveAt}
          onChange={(e) => set("effectiveAt", e.target.value)}
        />
        <TextField
          label="Review by"
          type="date"
          value={s.reviewAt}
          onChange={(e) => set("reviewAt", e.target.value)}
        />
        <TextField
          label="Expires"
          type="date"
          value={s.expiresAt}
          error={errors.expiresAt}
          onChange={(e) => set("expiresAt", e.target.value)}
        />
        <TextField
          label="Conflict key"
          hint="Items sharing a key are checked for conflicts, e.g. pricing:atpl-fee"
          value={s.conflictKey}
          error={errors.conflictKey}
          onChange={(e) => set("conflictKey", e.target.value)}
          className="sm:col-span-3"
        />
        {mode === "research" && (
          <div className="sm:col-span-3">
            <Switch
              label="Usable as UNVERIFIED context"
              description="Tasks that allow it may see this research, clearly labelled as unverified, before approval."
              checked={s.usableAsUnverified}
              onChange={(v) => set("usableAsUnverified", v)}
            />
          </div>
        )}
      </div>

      {item?.status === "approved" && (
        <p className="rounded-lg bg-violet-500/10 px-3 py-2 text-[12.5px] text-violet-700 dark:text-violet-300">
          This item is approved. Changes to its content, source or validity create a new draft
          version; the current version stays in force until the new one is approved.
        </p>
      )}
      {message && (
        <p
          role="alert"
          className="rounded-lg bg-rose-500/10 px-3 py-2 text-[12.5px] text-rose-700 dark:text-rose-300"
        >
          {message}
        </p>
      )}
      <div className="flex justify-end gap-2 border-t border-line pt-4">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="primary" type="submit" disabled={saving}>
          {saving ? "Saving…" : item ? "Save changes" : "Create draft"}
        </Button>
      </div>
    </form>
  );
}
