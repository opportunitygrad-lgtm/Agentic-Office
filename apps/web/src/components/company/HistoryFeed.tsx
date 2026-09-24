import {
  BookCheck,
  Building2,
  Gavel,
  KeyRound,
  Palette,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import type { AuditEventDTO } from "@aibos/shared";
import { EmptyState, Panel } from "@aibos/ui";
import { relativeTime } from "@/lib/format";

const ICON: [string, LucideIcon, string][] = [
  ["company.ai_policy", Sparkles, "AI policy"],
  ["company.", Building2, "Profile"],
  ["brand_rule.", Palette, "Brand rule"],
  ["commercial_rule.", Gavel, "Commercial rule"],
  ["compliance_rule.", Gavel, "Compliance rule"],
  ["knowledge_access.", KeyRound, "Agent access"],
  ["knowledge.", BookCheck, "Knowledge"],
];

function meta(action: string): { icon: LucideIcon; label: string } {
  const hit = ICON.find(([prefix]) => action.startsWith(prefix));
  return hit ? { icon: hit[1], label: hit[2] } : { icon: Building2, label: "Change" };
}

/** Company-specific operational history — a curated view of the audit log. */
export function HistoryFeed({ events }: { events: AuditEventDTO[] }) {
  return (
    <Panel title="Company history" eyebrow="Profile, rules, knowledge and AI policy changes">
      {events.length === 0 ? (
        <EmptyState title="No changes recorded yet" />
      ) : (
        <ol className="relative space-y-4 border-l border-line pl-5" data-testid="company-history">
          {events.map((e) => {
            const m = meta(e.action);
            const fields = Array.isArray(e.metadata.changedFields)
              ? (e.metadata.changedFields as string[])
              : [];
            return (
              <li key={e.id} className="relative">
                <span className="absolute -left-[29px] top-0.5 grid size-5 place-items-center rounded-full bg-surface ring-1 ring-line">
                  <m.icon className="size-3 text-fg-muted" aria-hidden="true" />
                </span>
                <p className="text-[13px]">
                  <span className="mr-1.5 rounded bg-surface-2 px-1.5 py-0.5 text-[10.5px] font-medium uppercase tracking-wide text-fg-muted">
                    {m.label}
                  </span>
                  {e.description}
                </p>
                {fields.length > 0 && (
                  <p className="mt-1 text-[11.5px] text-fg-faint">Changed: {fields.join(", ")}</p>
                )}
                <p className="mt-0.5 text-[11.5px] text-fg-faint" suppressHydrationWarning>
                  {e.actorType === "service"
                    ? `SERVICE: ${e.actorUser ?? e.actorServiceId}`
                    : (e.actorUser ?? e.actorType)}{" "}
                  · {relativeTime(e.occurredAt)}
                </p>
              </li>
            );
          })}
        </ol>
      )}
    </Panel>
  );
}
