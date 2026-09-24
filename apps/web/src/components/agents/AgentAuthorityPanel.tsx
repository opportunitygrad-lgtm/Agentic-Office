"use client";

import { useEffect, useState } from "react";
import { Check, Loader2, ShieldCheck, ShieldX, X } from "lucide-react";
import { AUTONOMY_DEFINITIONS } from "@aibos/access-core";
import {
  APPROVAL_TYPE_LABELS,
  AUTONOMY_LEVELS,
  formatUsd,
  type AgentAuthorityDTO,
  type AgentAuthorityItem,
  type ApprovalType,
  type AutonomyLevel,
  type GrantEffectValue,
} from "@aibos/shared";
import { Button, Skeleton, cn } from "@aibos/ui";

const DECISION_STYLE: Record<
  AgentAuthorityItem["decision"],
  { label: string; className: string; icon: "check" | "arrow" | "x" }
> = {
  allow: {
    label: "✓",
    className: "bg-emerald-500/10 text-emerald-700 ring-emerald-600/20 dark:text-emerald-300",
    icon: "check",
  },
  require_approval: {
    label: "→ APPROVAL",
    className: "bg-violet-500/10 text-violet-700 ring-violet-600/20 dark:text-violet-300",
    icon: "arrow",
  },
  deny: { label: "✗", className: "bg-surface-2 text-fg-faint ring-line", icon: "x" },
};

function DecisionChip({ item }: { item: AgentAuthorityItem }) {
  const style = DECISION_STYLE[item.decision];
  return (
    <span
      title={`${item.label}: ${item.reason}`}
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11px] font-semibold ring-1 ring-inset",
        style.className,
      )}
      data-testid={`authority-${item.permission}`}
    >
      <span className="tracking-wide">{item.verb}</span>
      <span
        aria-label={
          item.decision === "allow"
            ? "allowed"
            : item.decision === "deny"
              ? "not allowed"
              : "requires approval"
        }
      >
        {style.label}
      </span>
    </span>
  );
}

const EFFECT_OPTIONS: { value: GrantEffectValue | "none"; label: string }[] = [
  { value: "allow", label: "Allow" },
  { value: "require_approval", label: "Approval" },
  { value: "deny", label: "Deny" },
  { value: "none", label: "Not granted" },
];

export function AgentAuthorityPanel({ agentId }: { agentId: string }) {
  const [data, setData] = useState<AgentAuthorityDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [level, setLevel] = useState<AutonomyLevel | null>(null);

  const [version, setVersion] = useState(0);

  useEffect(() => {
    let active = true;
    fetch(`/api/v1/agents/${agentId}/authority`, { cache: "no-store" })
      .then(async (res) => {
        if (!active) return;
        if (!res.ok) {
          setError(
            res.status === 403 || res.status === 404
              ? "You don't have access to this agent's authority."
              : "Could not load authority.",
          );
          return;
        }
        const body = (await res.json()) as { data: AgentAuthorityDTO };
        if (!active) return;
        setData(body.data);
        setLevel(body.data.autonomyLevel);
      })
      .catch(() => {
        if (active) setError("Could not load authority.");
      });
    return () => {
      active = false;
    };
  }, [agentId, version]);

  async function send(url: string, body: unknown) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(url, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        setError(json?.error?.message ?? "Change rejected");
      }
      setVersion((v) => v + 1);
    } finally {
      setSaving(false);
    }
  }

  if (error && !data) return <p className="text-[12.5px] text-fg-faint">{error}</p>;
  if (!data) {
    return (
      <div className="space-y-2" aria-busy="true" aria-label="Loading authority">
        <Skeleton className="h-10" />
        <Skeleton className="h-24" />
      </div>
    );
  }
  const current = AUTONOMY_DEFINITIONS.find((d) => d.level === data.autonomyLevel)!;

  return (
    <div className="space-y-5" data-testid="authority-panel">
      {/* autonomy ladder */}
      <div>
        <div className="flex items-center justify-between gap-2">
          <p className="text-[12px] text-fg-faint">Autonomy level</p>
          {data.viewerCanManage ? (
            <span className="text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
              You can change this
            </span>
          ) : (
            <span className="text-[11px] text-fg-faint">Read-only</span>
          )}
        </div>
        <ol className="mt-2 grid grid-cols-5 gap-1" aria-label="Autonomy ladder">
          {AUTONOMY_DEFINITIONS.map((d) => (
            <li
              key={d.level}
              aria-current={d.level === data.autonomyLevel ? "step" : undefined}
              className={cn(
                "rounded-md px-1.5 py-1.5 text-center text-[10.5px] font-semibold",
                d.rank <= current.rank && current.rank > 0
                  ? "bg-accent text-white"
                  : "bg-surface-3 text-fg-faint",
                d.level === data.autonomyLevel &&
                  "ring-2 ring-accent ring-offset-2 ring-offset-surface",
              )}
            >
              L{d.rank}
            </li>
          ))}
        </ol>
        <p className="mt-2 text-[13px] font-semibold">
          L{current.rank} · {current.name}
        </p>
        <p className="text-[12px] text-fg-muted">{current.summary}</p>
        {data.viewerCanManage && (
          <div className="mt-2 flex items-center gap-2">
            <label className="sr-only" htmlFor={`autonomy-${agentId}`}>
              Change autonomy level
            </label>
            <select
              id={`autonomy-${agentId}`}
              value={level ?? data.autonomyLevel}
              onChange={(e) => setLevel(e.target.value as AutonomyLevel)}
              className="focus-ring h-8 rounded-lg border border-line bg-surface px-2 text-[12.5px]"
            >
              {AUTONOMY_LEVELS.map((l) => {
                const d = AUTONOMY_DEFINITIONS.find((x) => x.level === l)!;
                return (
                  <option key={l} value={l}>
                    L{d.rank} · {d.name}
                  </option>
                );
              })}
            </select>
            <Button
              size="sm"
              variant="primary"
              disabled={saving || level === data.autonomyLevel}
              onClick={() => send(`/api/v1/agents/${agentId}/autonomy`, { autonomyLevel: level })}
            >
              {saving && <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />} Save
            </Button>
          </div>
        )}
      </div>

      {/* tools & actions */}
      <div>
        <p className="mb-2 text-[12px] text-fg-faint">Tools & actions</p>
        <ul className="divide-y divide-line/70 rounded-xl border border-line">
          {data.groups.map((g) => (
            <li key={g.group} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2">
              <span className="w-24 shrink-0 text-[12.5px] font-semibold">{g.group}</span>
              <span className="flex flex-1 flex-wrap gap-1.5">
                {g.items.map((item) =>
                  data.viewerCanManage ? (
                    <span key={item.permission} className="inline-flex items-center gap-1">
                      <DecisionChip item={item} />
                      <select
                        aria-label={`${item.label} grant`}
                        value={item.grant ?? "none"}
                        disabled={saving}
                        onChange={(e) =>
                          send(`/api/v1/agents/${agentId}/permissions`, {
                            companyId: null,
                            grants: [
                              {
                                permission: item.permission,
                                effect: e.target.value === "none" ? null : e.target.value,
                              },
                            ],
                          })
                        }
                        className="h-6 rounded border border-line bg-surface px-1 text-[10.5px] text-fg-muted"
                      >
                        {EFFECT_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </span>
                  ) : (
                    <DecisionChip key={item.permission} item={item} />
                  ),
                )}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-1.5 flex flex-wrap gap-x-3 text-[11px] text-fg-faint">
          <span className="inline-flex items-center gap-1">
            <Check className="size-3" aria-hidden="true" /> allowed
          </span>
          <span>→ APPROVAL needs a human</span>
          <span className="inline-flex items-center gap-1">
            <X className="size-3" aria-hidden="true" /> not allowed
          </span>
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <p className="mb-1.5 flex items-center gap-1.5 text-[12px] text-fg-faint">
            <ShieldCheck className="size-3.5" aria-hidden="true" /> Approval gates
          </p>
          <ul className="flex flex-wrap gap-1.5">
            {data.approvalGates.length ? (
              data.approvalGates.map((g) => (
                <li
                  key={g}
                  className="rounded-md bg-violet-500/10 px-2 py-0.5 text-[11.5px] font-medium text-violet-700 dark:text-violet-300"
                >
                  {APPROVAL_TYPE_LABELS[g as ApprovalType] ?? g}
                </li>
              ))
            ) : (
              <li className="text-[12px] text-fg-faint">None</li>
            )}
          </ul>
        </div>
        <div>
          <p className="mb-1.5 flex items-center gap-1.5 text-[12px] text-fg-faint">
            <ShieldX className="size-3.5" aria-hidden="true" /> Forbidden actions
          </p>
          <ul className="space-y-0.5 text-[12px] text-fg-muted">
            {data.prohibitedActions.map((p) => (
              <li key={p}>· {p}</li>
            ))}
          </ul>
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {[
          ["Per task", formatUsd(data.limits.perTaskBudget)],
          ["Per day", formatUsd(data.limits.dailyBudget)],
          ["Searches", String(data.limits.maxExternalSearches)],
          ["Retries", String(data.limits.maxRetries)],
          ["Concurrency", String(data.limits.concurrencyLimit)],
        ].map(([k, v]) => (
          <div key={k} className="rounded-lg bg-surface-2 px-2.5 py-2">
            <dt className="text-[10.5px] text-fg-faint">{k}</dt>
            <dd className="num text-[13px] font-semibold">{v}</dd>
          </div>
        ))}
      </dl>
      {error && (
        <p role="alert" className="text-[12px] font-medium text-rose-600 dark:text-rose-400">
          {error}
        </p>
      )}
    </div>
  );
}
