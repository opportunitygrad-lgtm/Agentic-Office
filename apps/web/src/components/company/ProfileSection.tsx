"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import type { ProfileSection as SectionKey } from "@aibos/shared";
import { Button, Panel, cn } from "@aibos/ui";
import { TagInput, TextArea, TextField } from "../wizard/fields";
import { clientApi } from "@/lib/client-api";

export type FieldKind = "text" | "textarea" | "list" | "url" | "email";

export interface ProfileField {
  key: string;
  label: string;
  kind: FieldKind;
  hint?: string;
  required?: boolean;
  wide?: boolean;
  /** Restrictive content (prohibitions) is highlighted in read mode. */
  tone?: "restrict";
}

/** Exact key sets of each section — they mirror the API's strict section schemas. */
export const SECTION_FIELDS: Record<SectionKey, ProfileField[]> = {
  identity: [
    { key: "name", label: "Company name", kind: "text", required: true },
    { key: "legalName", label: "Legal name", kind: "text" },
    { key: "tradingName", label: "Trading name", kind: "text" },
    { key: "industry", label: "Industry", kind: "text", required: true },
    { key: "website", label: "Website", kind: "url" },
    { key: "description", label: "Description", kind: "textarea", wide: true },
    {
      key: "primaryCountry",
      label: "Headquarters / primary country",
      kind: "text",
      hint: "ISO code, e.g. IE",
      required: true,
    },
    { key: "countriesServed", label: "Countries served", kind: "list", hint: "ISO codes" },
    { key: "timezone", label: "Timezone", kind: "text", required: true },
    { key: "defaultCurrency", label: "Currency", kind: "text", required: true },
    { key: "contactEmail", label: "Contact email", kind: "email" },
    { key: "contactPhone", label: "Contact phone", kind: "text" },
    { key: "contactAddress", label: "Address", kind: "textarea", wide: true },
    { key: "registrationNumber", label: "Registration number", kind: "text" },
    { key: "taxIdentifier", label: "Tax identifier", kind: "text" },
  ],
  business: [
    { key: "products", label: "Products", kind: "list" },
    { key: "productsServices", label: "Services", kind: "list" },
    { key: "targetAudiences", label: "Target audiences", kind: "list" },
    { key: "targetMarkets", label: "Target markets", kind: "list" },
    { key: "revenueModel", label: "Revenue model", kind: "textarea", wide: true },
    { key: "primaryObjective", label: "Primary business objective", kind: "textarea", wide: true },
    { key: "secondaryObjectives", label: "Secondary objectives", kind: "list", wide: true },
    { key: "salesChannels", label: "Sales channels", kind: "list" },
    { key: "marketingChannels", label: "Marketing channels", kind: "list" },
  ],
  brand: [
    { key: "brandPositioning", label: "Positioning", kind: "textarea", wide: true },
    { key: "brandPersonality", label: "Personality", kind: "text" },
    { key: "brandVoice", label: "Voice", kind: "text" },
    { key: "brandTone", label: "Tone", kind: "text" },
    { key: "visualGuidance", label: "Visual guidance", kind: "textarea" },
    { key: "approvedPhrases", label: "Approved phrases", kind: "list" },
    { key: "prohibitedPhrases", label: "Prohibited phrases", kind: "list", tone: "restrict" },
    { key: "claimsAllowed", label: "Claims allowed", kind: "list" },
    { key: "claimsRequiringEvidence", label: "Claims requiring evidence", kind: "list" },
    { key: "prohibitedClaims", label: "Prohibited claims", kind: "list", tone: "restrict" },
    { key: "competitorNotes", label: "Competitor / reference notes", kind: "textarea", wide: true },
  ],
  compliance: [
    { key: "jurisdictions", label: "Relevant jurisdictions", kind: "list" },
    { key: "regulators", label: "Regulators", kind: "list" },
    { key: "legalDisclaimers", label: "Legal disclaimers", kind: "list", wide: true },
    {
      key: "dataHandlingRules",
      label: "Data handling rules",
      kind: "list",
      wide: true,
      tone: "restrict",
    },
    {
      key: "companyRules",
      label: "General company rules",
      kind: "list",
      wide: true,
      tone: "restrict",
    },
    { key: "complianceNotes", label: "Compliance notes", kind: "textarea", wide: true },
  ],
};

type Values = Record<string, string | string[] | null>;

function pick(section: SectionKey, source: Record<string, unknown>): Values {
  return Object.fromEntries(
    SECTION_FIELDS[section].map((f) => {
      const v = source[f.key];
      return [
        f.key,
        f.kind === "list"
          ? ((v as string[] | undefined) ?? [])
          : ((v as string | null | undefined) ?? ""),
      ];
    }),
  );
}

export function ProfileSection({
  section,
  title,
  eyebrow,
  companySlug,
  values: source,
  canEdit,
}: {
  section: SectionKey;
  title: string;
  eyebrow?: string;
  companySlug: string;
  values: Record<string, unknown>;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState<Values>(() => pick(section, source));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const fields = SECTION_FIELDS[section];

  async function save() {
    setSaving(true);
    setErrors({});
    setMessage(null);
    const body = Object.fromEntries(
      fields.map((f) => {
        const v = values[f.key];
        if (f.kind === "list") return [f.key, v ?? []];
        if (f.required) return [f.key, v ?? ""];
        return [f.key, v ? v : null];
      }),
    );
    const res = await clientApi(`/v1/companies/${companySlug}/profile/${section}`, {
      method: "PUT",
      body,
    });
    setSaving(false);
    if (!res.ok) {
      setMessage(res.message);
      setErrors(
        Object.fromEntries((res.issues ?? []).map((i) => [i.path.split(".")[0]!, i.message])),
      );
      return;
    }
    setEditing(false);
    setMessage("Saved — change recorded in company history.");
    router.refresh();
  }

  return (
    <Panel
      title={title}
      eyebrow={eyebrow}
      actions={
        canEdit && !editing ? (
          <Button
            size="sm"
            icon={<Pencil className="size-3.5" aria-hidden="true" />}
            onClick={() => {
              setValues(pick(section, source));
              setMessage(null);
              setEditing(true);
            }}
          >
            Edit
          </Button>
        ) : null
      }
    >
      {editing ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
          aria-label={`Edit ${title}`}
          className="space-y-4"
          noValidate
        >
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {fields.map((f) =>
              f.kind === "list" ? (
                <TagInput
                  key={f.key}
                  label={f.label}
                  hint={f.hint}
                  values={(values[f.key] as string[]) ?? []}
                  error={errors[f.key]}
                  onChange={(v) => setValues((s) => ({ ...s, [f.key]: v }))}
                  className={cn(f.wide && "md:col-span-2")}
                />
              ) : f.kind === "textarea" ? (
                <TextArea
                  key={f.key}
                  label={f.label}
                  hint={f.hint}
                  value={(values[f.key] as string) ?? ""}
                  error={errors[f.key]}
                  onChange={(e) => setValues((s) => ({ ...s, [f.key]: e.target.value }))}
                  className={cn(f.wide && "md:col-span-2")}
                />
              ) : (
                <TextField
                  key={f.key}
                  label={f.label}
                  hint={f.hint}
                  required={f.required}
                  type={f.kind === "url" ? "url" : f.kind === "email" ? "email" : "text"}
                  value={(values[f.key] as string) ?? ""}
                  error={errors[f.key]}
                  onChange={(e) => setValues((s) => ({ ...s, [f.key]: e.target.value }))}
                  className={cn(f.wide && "md:col-span-2")}
                />
              ),
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
          <div className="flex justify-end gap-2 border-t border-line pt-4">
            <Button
              variant="ghost"
              onClick={() => {
                setValues(pick(section, source));
                setEditing(false);
                setMessage(null);
              }}
            >
              Cancel
            </Button>
            <Button variant="primary" type="submit" disabled={saving}>
              {saving ? "Saving…" : "Save section"}
            </Button>
          </div>
        </form>
      ) : (
        <>
          {message && (
            <p
              role="status"
              className="mb-3 rounded-lg bg-emerald-500/10 px-3 py-2 text-[12.5px] text-emerald-700 dark:text-emerald-300"
            >
              {message}
            </p>
          )}
          <dl className="grid grid-cols-1 gap-x-6 gap-y-4 md:grid-cols-2">
            {fields.map((f) => {
              const v = source[f.key];
              const empty =
                v === null || v === undefined || v === "" || (Array.isArray(v) && !v.length);
              return (
                <div key={f.key} className={cn("min-w-0", f.wide && "md:col-span-2")}>
                  <dt className="text-[11.5px] text-fg-faint">{f.label}</dt>
                  <dd className="mt-1 text-[13px]">
                    {empty ? (
                      <span className="text-fg-faint">Not set</span>
                    ) : Array.isArray(v) ? (
                      <ul className="flex flex-wrap gap-1.5">
                        {(v as string[]).map((x) => (
                          <li
                            key={x}
                            className={cn(
                              "rounded-md px-2 py-0.5 text-[12px] ring-1 ring-inset",
                              f.tone === "restrict"
                                ? "bg-rose-500/10 text-rose-700 ring-rose-600/20 dark:text-rose-300"
                                : "bg-surface-2 ring-line",
                            )}
                          >
                            {x}
                          </li>
                        ))}
                      </ul>
                    ) : f.kind === "url" ? (
                      <a
                        href={String(v)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-accent hover:underline"
                      >
                        {String(v)}
                      </a>
                    ) : (
                      <span className="whitespace-pre-wrap">{String(v)}</span>
                    )}
                  </dd>
                </div>
              );
            })}
          </dl>
        </>
      )}
    </Panel>
  );
}
