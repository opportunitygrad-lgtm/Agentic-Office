"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  EFFORT_LEVELS,
  PROVIDER_LABELS,
  PROVIDER_TYPES,
  formatUsd,
  type AgentDTO,
  type AgentPerformanceDTO,
  type AgentRunDTO,
  type ProviderType,
} from "@aibos/shared";
import { Button, StatusPill } from "@aibos/ui";
import { clientApi } from "@/lib/client-api";
import { relativeTime } from "@/lib/format";
import { RUN_STATUS_META } from "./LiveRun";

const selectCls = "focus-ring h-9 w-full rounded-lg border border-line bg-surface px-2 text-[13px]";

/**
 * Provider preferences (bounded by company policy — the API rejects a
 * provider or premium tier a served company prohibits) and observable run
 * performance. No invented quality scores.
 */
export function AgentProviderPanel({ agent, canEdit }: { agent: AgentDTO; canEdit: boolean }) {
  const router = useRouter();
  const [form, setForm] = useState({
    primaryProvider: agent.primaryProvider,
    fallbackProvider: agent.fallbackProvider ?? "",
    preferredModelTier: agent.preferredModelTier,
    defaultEffort: agent.defaultEffort ?? "",
    preferredReviewerProvider: agent.preferredReviewerProvider ?? "",
  });
  const [perf, setPerf] = useState<AgentPerformanceDTO | null>(null);
  const [runs, setRuns] = useState<AgentRunDTO[]>([]);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void Promise.all([
      clientApi<{ data: AgentPerformanceDTO }>(`/v1/agents/${agent.id}/performance`),
      clientApi<{ data: AgentRunDTO[] }>(`/v1/agents/${agent.id}/runs`),
    ]).then(([p, r]) => {
      if (!live) return;
      if (p.ok) setPerf(p.data.data);
      if (r.ok) setRuns(r.data.data.slice(0, 5));
    });
    return () => {
      live = false;
    };
  }, [agent.id]);

  async function save() {
    const r = await clientApi(`/v1/agents/${agent.id}/provider-settings`, {
      method: "PUT",
      body: {
        primaryProvider: form.primaryProvider,
        fallbackProvider: form.fallbackProvider || null,
        preferredModelTier: form.preferredModelTier,
        defaultEffort: form.defaultEffort || null,
        preferredReviewerProvider: form.preferredReviewerProvider || null,
      },
    });
    setMsg(r.ok ? "Saved." : r.message);
    if (r.ok) router.refresh();
  }

  return (
    <div className="space-y-4 text-[12.5px]">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <label className="text-[12px] text-fg-muted">
          Primary provider
          <select
            className={selectCls}
            disabled={!canEdit}
            value={form.primaryProvider}
            onChange={(e) => setForm({ ...form, primaryProvider: e.target.value as ProviderType })}
          >
            {PROVIDER_TYPES.map((p) => (
              <option key={p} value={p}>
                {PROVIDER_LABELS[p]}
              </option>
            ))}
          </select>
        </label>
        <label className="text-[12px] text-fg-muted">
          Fallback provider
          <select
            className={selectCls}
            disabled={!canEdit}
            value={form.fallbackProvider}
            onChange={(e) =>
              setForm({ ...form, fallbackProvider: e.target.value as ProviderType | "" })
            }
          >
            <option value="">None</option>
            {PROVIDER_TYPES.map((p) => (
              <option key={p} value={p}>
                {PROVIDER_LABELS[p]}
              </option>
            ))}
          </select>
        </label>
        <label className="text-[12px] text-fg-muted">
          Preferred model tier
          <select
            className={selectCls}
            disabled={!canEdit}
            value={form.preferredModelTier}
            onChange={(e) =>
              setForm({
                ...form,
                preferredModelTier: e.target.value as AgentDTO["preferredModelTier"],
              })
            }
          >
            <option value="standard">Standard</option>
            <option value="auto">Auto</option>
            <option value="premium">Premium</option>
          </select>
        </label>
        <label className="text-[12px] text-fg-muted">
          Default effort
          <select
            className={selectCls}
            disabled={!canEdit}
            value={form.defaultEffort}
            onChange={(e) =>
              setForm({ ...form, defaultEffort: e.target.value as typeof form.defaultEffort })
            }
          >
            <option value="">Provider default</option>
            {EFFORT_LEVELS.map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </select>
        </label>
        <label className="text-[12px] text-fg-muted">
          Preferred reviewer (second opinion)
          <select
            className={selectCls}
            disabled={!canEdit}
            value={form.preferredReviewerProvider}
            onChange={(e) =>
              setForm({
                ...form,
                preferredReviewerProvider: e.target.value as ProviderType | "",
              })
            }
          >
            <option value="">No preference</option>
            {PROVIDER_TYPES.filter((p) => p !== form.primaryProvider).map((p) => (
              <option key={p} value={p}>
                {PROVIDER_LABELS[p]}
              </option>
            ))}
          </select>
        </label>
      </div>
      {canEdit && (
        <Button size="sm" onClick={() => void save()}>
          Save provider settings
        </Button>
      )}
      {msg && (
        <p role="status" className="text-fg-muted">
          {msg}
        </p>
      )}
      {perf && (
        <dl
          className="grid grid-cols-2 gap-2 border-t border-line/70 pt-3 sm:grid-cols-4"
          data-testid="agent-performance"
        >
          <div>
            <dt className="text-fg-faint">Runs completed</dt>
            <dd className="num font-semibold">{perf.runsCompleted}</dd>
          </div>
          <div>
            <dt className="text-fg-faint">Runs failed</dt>
            <dd className="num font-semibold">{perf.runsFailed}</dd>
          </div>
          <div>
            <dt className="text-fg-faint">Average latency</dt>
            <dd className="num font-semibold">
              {perf.averageLatencyMs !== null
                ? `${(perf.averageLatencyMs / 1000).toFixed(1)}s`
                : "—"}
            </dd>
          </div>
          <div>
            <dt className="text-fg-faint">Average cost</dt>
            <dd className="num font-semibold">
              {perf.averageCostUsd !== null ? formatUsd(perf.averageCostUsd) : "—"}
            </dd>
          </div>
        </dl>
      )}
      {runs.length > 0 && (
        <ul className="space-y-1 border-t border-line/70 pt-3">
          {runs.map((r) => (
            <li key={r.id} className="flex items-center gap-2">
              <StatusPill
                tone={RUN_STATUS_META[r.status].tone}
                label={RUN_STATUS_META[r.status].label}
              />
              <span className="min-w-0 flex-1 truncate">{r.task?.title ?? "Chat reply"}</span>
              <span className="text-fg-faint">{relativeTime(r.createdAt)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
