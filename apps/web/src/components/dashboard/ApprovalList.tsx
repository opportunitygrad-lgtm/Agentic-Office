import { ArrowRight, BadgeCheck, Check, X } from "lucide-react";
import { APPROVAL_TYPE_LABELS, type ApprovalDTO } from "@aibos/shared";
import { APPROVAL_STATUS_META, Button, EmptyState, RISK_META, StatusPill } from "@aibos/ui";
import { relativeTime } from "@/lib/format";
import { CompanyChip } from "../common/CompanyChip";

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function Diff({
  before,
  after,
}: {
  before: Record<string, unknown>;
  after: Record<string, unknown>;
}) {
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(
    (k) => before[k] !== after[k],
  );
  if (!keys.length) return null;
  return (
    <dl className="mt-2.5 space-y-1 rounded-lg bg-surface-2 px-2.5 py-2 font-mono text-[11.5px]">
      {keys.map((k) => (
        <div key={k} className="flex flex-wrap items-center gap-1.5">
          <dt className="text-fg-faint">{k}</dt>
          <dd className="flex items-center gap-1.5">
            <span className="rounded bg-rose-500/10 px-1 text-rose-700 line-through decoration-rose-500/50 dark:text-rose-300">
              {formatValue(before[k])}
            </span>
            <ArrowRight className="size-3 text-fg-faint" aria-label="changes to" />
            <span className="rounded bg-emerald-500/10 px-1 text-emerald-700 dark:text-emerald-300">
              {formatValue(after[k])}
            </span>
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function ApprovalCard({ approval }: { approval: ApprovalDTO }) {
  const risk = RISK_META[approval.riskLevel];
  return (
    <article
      className="rounded-xl border border-line bg-surface p-3.5"
      aria-label={approval.requestedAction}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <StatusPill tone={risk.tone} label={risk.label} />
        <span className="text-[11.5px] font-medium text-fg-muted">
          {APPROVAL_TYPE_LABELS[approval.type]}
        </span>
        {approval.status !== "pending" && (
          <StatusPill
            tone={APPROVAL_STATUS_META[approval.status].tone}
            label={APPROVAL_STATUS_META[approval.status].label}
          />
        )}
        <span className="ml-auto text-[11px] text-fg-faint" suppressHydrationWarning>
          {relativeTime(approval.requestedAt)}
        </span>
      </div>
      <h3 className="mt-2 text-[13.5px] font-semibold leading-snug">{approval.requestedAction}</h3>
      {approval.explanation && (
        <p className="mt-1 line-clamp-2 text-[12.5px] text-fg-muted">{approval.explanation}</p>
      )}
      {approval.beforeState && approval.afterState && (
        <Diff before={approval.beforeState} after={approval.afterState} />
      )}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2 text-[12px] text-fg-muted">
          <CompanyChip company={approval.company} />
          {approval.agent && (
            <span className="truncate text-fg-faint">· {approval.agent.name}</span>
          )}
        </div>
        {approval.status === "pending" && (
          <div
            className="flex gap-1.5"
            title="Approval decisions are enabled in Stage 33 (Approval engine)"
          >
            <Button
              size="sm"
              variant="secondary"
              icon={<X className="size-3.5" />}
              disabled
              aria-disabled="true"
            >
              Reject
            </Button>
            <Button
              size="sm"
              variant="primary"
              icon={<Check className="size-3.5" />}
              disabled
              aria-disabled="true"
            >
              Approve
            </Button>
          </div>
        )}
      </div>
    </article>
  );
}

export function ApprovalList({ approvals }: { approvals: ApprovalDTO[] }) {
  if (!approvals.length) {
    return (
      <EmptyState
        icon={<BadgeCheck className="size-5" />}
        title="Nothing waiting for you"
        description="Agents will request approval here before sensitive actions."
      />
    );
  }
  return (
    <ul className="space-y-2.5">
      {approvals.map((a) => (
        <li key={a.id}>
          <ApprovalCard approval={a} />
        </li>
      ))}
    </ul>
  );
}
