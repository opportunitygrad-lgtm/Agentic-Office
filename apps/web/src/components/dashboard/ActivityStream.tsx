import {
  BadgeCheck,
  Bot,
  Building2,
  Cpu,
  Gauge,
  Globe,
  ListChecks,
  Mail,
  Sheet,
  Wallet,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { PROVIDER_LABELS, type AuditEventDTO } from "@aibos/shared";
import { EmptyState, MockBadge, cn } from "@aibos/ui";
import { clockTime, relativeTime } from "@/lib/format";
import { CompanyChip } from "../common/CompanyChip";

const ICONS: Record<string, LucideIcon> = {
  email: Mail,
  browser: Globe,
  provider: Cpu,
  approval: BadgeCheck,
  task: ListChecks,
  budget: Wallet,
  google_sheets: Sheet,
  website: Gauge,
  company: Building2,
  agent: Bot,
};

export function ActivityStream({
  events,
  compact,
}: {
  events: AuditEventDTO[];
  compact?: boolean;
}) {
  if (!events.length) {
    return (
      <EmptyState
        icon={<Zap className="size-5" />}
        title="No activity yet"
        description="Every agent and human action will appear here and in the audit log."
      />
    );
  }
  return (
    <ol className="relative">
      {events.map((e, i) => {
        const Icon = ICONS[e.action.split(".")[0] ?? ""] ?? Zap;
        const failed = e.outcome === "failure";
        return (
          <li key={e.id} className="relative flex gap-3 pb-4 last:pb-0">
            {i < events.length - 1 && (
              <span
                className="absolute left-[13px] top-7 h-[calc(100%-22px)] w-px bg-line"
                aria-hidden="true"
              />
            )}
            <span
              className={cn(
                "relative z-[1] grid size-[27px] shrink-0 place-items-center rounded-full ring-4 ring-surface",
                failed
                  ? "bg-rose-500/12 text-rose-600 dark:text-rose-400"
                  : "bg-surface-3 text-fg-muted",
              )}
              aria-hidden="true"
            >
              <Icon className="size-3.5" />
            </span>
            <div className="min-w-0 flex-1 pt-0.5">
              <div className="flex items-baseline justify-between gap-2">
                <p
                  className={cn(
                    "text-[12.5px] leading-snug",
                    failed ? "text-rose-700 dark:text-rose-300" : "text-fg",
                  )}
                >
                  {e.description}
                </p>
                <time
                  dateTime={e.occurredAt}
                  className="num shrink-0 font-mono text-[10.5px] text-fg-faint"
                  title={relativeTime(e.occurredAt)}
                  suppressHydrationWarning
                >
                  {clockTime(e.occurredAt)}
                </time>
              </div>
              <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[11.5px] text-fg-faint">
                {e.company && <CompanyChip company={e.company} />}
                {e.agent && <span className="truncate">{e.agent.name}</span>}
                {!compact && <code className="font-mono text-[10.5px]">{e.action}</code>}
                {e.provider && <span>· {PROVIDER_LABELS[e.provider]}</span>}
                {e.origin === "dev_seed" && !compact && <MockBadge label="seed" />}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
