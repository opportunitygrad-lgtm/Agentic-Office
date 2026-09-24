"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import {
  BRAND_RULE_CATEGORIES,
  COMMERCIAL_RULE_CATEGORIES,
  KNOWLEDGE_TYPES,
  KNOWLEDGE_TYPE_LABELS,
  titleCase,
  type AgentKnowledgeProfileDTO,
} from "@aibos/shared";
import { Button, Panel, cn } from "@aibos/ui";
import { TagInput } from "../wizard/fields";
import { clientApi } from "@/lib/client-api";

type Profile = AgentKnowledgeProfileDTO["effective"];
const EMPTY: Profile = {
  requiredTypes: [],
  preferredTags: [],
  brandCategories: [],
  commercialCategories: [],
};

function Toggles<T extends string>({
  label,
  options,
  fixed,
  value,
  onChange,
  format,
}: {
  label: string;
  options: readonly T[];
  fixed: readonly T[];
  value: T[];
  onChange: (v: T[]) => void;
  format: (v: T) => string;
}) {
  return (
    <fieldset>
      <legend className="mb-1.5 text-[12px] font-medium">{label}</legend>
      <div className="flex flex-wrap gap-1">
        {options.map((o) => {
          const inherited = fixed.includes(o);
          const on = inherited || value.includes(o);
          return (
            <button
              key={o}
              type="button"
              aria-pressed={on}
              disabled={inherited}
              title={inherited ? "From the agent template" : undefined}
              onClick={() => onChange(on ? value.filter((x) => x !== o) : [...value, o])}
              className={cn(
                "focus-ring rounded-md px-1.5 py-0.5 text-[11.5px] font-medium ring-1 ring-inset",
                inherited
                  ? "bg-surface-3 text-fg-muted ring-line"
                  : on
                    ? "bg-accent text-white ring-accent"
                    : "text-fg-faint ring-line hover:bg-surface-2",
              )}
            >
              {format(o)}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

function Chips({
  label,
  items,
  format,
}: {
  label: string;
  items: string[];
  format?: (v: string) => string;
}) {
  return (
    <div>
      <p className="text-[11.5px] text-fg-faint">{label}</p>
      {items.length ? (
        <ul className="mt-1 flex flex-wrap gap-1">
          {items.map((i) => (
            <li
              key={i}
              className="rounded-md bg-surface-2 px-1.5 py-0.5 text-[11.5px] ring-1 ring-inset ring-line"
            >
              {format ? format(i) : i}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[12px] text-fg-faint">None</p>
      )}
    </div>
  );
}

/** Default knowledge an agent always needs (template defaults + agent additions). */
export function KnowledgeProfilePanel({
  agentId,
  profile,
  canEdit,
}: {
  agentId: string;
  profile: AgentKnowledgeProfileDTO;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Profile>(profile.override ?? EMPTY);
  const [error, setError] = useState<string | null>(null);

  async function save(value: Profile | null) {
    const res = await clientApi(`/v1/agents/${agentId}/knowledge-profile`, {
      method: "PUT",
      body: { profile: value },
    });
    if (!res.ok) return setError(res.message);
    setEditing(false);
    router.refresh();
  }

  const e = profile.effective;
  const t = profile.template;
  return (
    <Panel
      title="Default knowledge"
      eyebrow="What this agent always needs"
      actions={
        canEdit && !editing ? (
          <Button
            size="sm"
            icon={<Pencil className="size-3.5" aria-hidden="true" />}
            onClick={() => {
              setDraft(profile.override ?? EMPTY);
              setEditing(true);
            }}
          >
            Customise
          </Button>
        ) : null
      }
    >
      {editing ? (
        <div className="space-y-4">
          <p className="text-[12px] text-fg-muted">
            Grey items come from the {titleCase(profile.templateKey)} template; add more for this
            agent.
          </p>
          <Toggles
            label="Required knowledge types"
            options={KNOWLEDGE_TYPES}
            fixed={t.requiredTypes}
            value={draft.requiredTypes}
            onChange={(v) => setDraft({ ...draft, requiredTypes: v })}
            format={(v) => KNOWLEDGE_TYPE_LABELS[v]}
          />
          <TagInput
            label="Preferred tags"
            values={draft.preferredTags}
            onChange={(v) => setDraft({ ...draft, preferredTags: v.map((x) => x.toLowerCase()) })}
          />
          <Toggles
            label="Always-include brand rule categories"
            options={BRAND_RULE_CATEGORIES}
            fixed={t.brandCategories}
            value={draft.brandCategories}
            onChange={(v) => setDraft({ ...draft, brandCategories: v })}
            format={titleCase}
          />
          <Toggles
            label="Always-include commercial rule categories"
            options={COMMERCIAL_RULE_CATEGORIES}
            fixed={t.commercialCategories}
            value={draft.commercialCategories}
            onChange={(v) => setDraft({ ...draft, commercialCategories: v })}
            format={titleCase}
          />
          {error && (
            <p role="alert" className="text-[12.5px] text-rose-600">
              {error}
            </p>
          )}
          <div className="flex flex-wrap justify-end gap-2 border-t border-line pt-3">
            {profile.override && (
              <Button variant="ghost" onClick={() => save(null)}>
                Reset to template
              </Button>
            )}
            <Button variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => save(draft)}>
              Save
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <Chips
            label="Required knowledge types"
            items={e.requiredTypes}
            format={(v) => KNOWLEDGE_TYPE_LABELS[v as keyof typeof KNOWLEDGE_TYPE_LABELS] ?? v}
          />
          <Chips label="Preferred tags" items={e.preferredTags.map((x) => `#${x}`)} />
          <Chips label="Always-include brand rules" items={e.brandCategories} format={titleCase} />
          <Chips
            label="Always-include commercial rules"
            items={e.commercialCategories}
            format={titleCase}
          />
          {profile.override && (
            <p className="text-[11.5px] text-fg-faint">Customised for this agent.</p>
          )}
        </div>
      )}
    </Panel>
  );
}
