"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Play, Sparkles } from "lucide-react";
import {
  PROVIDER_LABELS,
  formatUsd,
  type AgentRunDetailDTO,
  type AgentRunDTO,
  type ModelTier,
  type ResponseDetail,
  type RunPreviewDTO,
} from "@aibos/shared";
import { Button, EmptyState, MockBadge, Panel, Skeleton, StatusPill, cn } from "@aibos/ui";
import { clientApi } from "@/lib/client-api";
import { formatDateTime } from "@/lib/format";
import { Dialog } from "../common/Dialog";
import { LiveRunPanel, RUN_STATUS_META, isActiveRun, stopRun } from "./LiveRun";
import { useRunStream } from "./useRunStream";

type Preview = RunPreviewDTO & { canExecute: boolean };
const selectCls = "focus-ring h-9 rounded-lg border border-line bg-surface px-2.5 text-[13px]";

function RunDialog({
  runId,
  onClose,
  onChange,
}: {
  runId: string;
  onClose: () => void;
  onChange: () => void;
}) {
  const { run, output } = useRunStream(runId, { onFinal: onChange });
  const [override, setOverride] = useState<AgentRunDetailDTO | null>(null);
  const shown = override ?? run;
  return (
    <Dialog
      open
      onClose={onClose}
      title={shown ? `Run #${shown.number}` : "Run"}
      description={shown ? `${shown.modelLabel} · ${formatDateTime(shown.createdAt)}` : undefined}
      className="w-[min(1100px,calc(100vw-2rem))]"
    >
      <div className="overflow-y-auto p-5">
        {shown ? (
          <LiveRunPanel
            run={shown}
            output={output}
            onStop={() => void stopRun(shown.id)}
            onChange={setOverride}
          />
        ) : (
          <Skeleton className="h-64" />
        )}
      </div>
    </Dialog>
  );
}

/**
 * RUN WITH AGENT: provider preview (model, effort, estimated tokens and cost),
 * the live run, and the run history. The run executes in the worker.
 */
export function TaskRunPanel({ taskId }: { taskId: string }) {
  const router = useRouter();
  const [tier, setTier] = useState<ModelTier | "">("");
  const [detail, setDetail] = useState<ResponseDetail | "">("");
  const [preview, setPreview] = useState<{ key: string; data?: Preview; error?: string } | null>(
    null,
  );
  const [runs, setRuns] = useState<AgentRunDTO[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedbackOverride, setFeedbackOverride] = useState<AgentRunDetailDTO | null>(null);
  const [version, setVersion] = useState(0);
  const key = `${tier}|${detail}|${version}`;

  useEffect(() => {
    let live = true;
    void Promise.all([
      clientApi<{ data: Preview }>(`/v1/tasks/${taskId}/run-preview`, {
        params: { tier: tier || undefined, detail: detail || undefined },
      }),
      clientApi<{ data: AgentRunDTO[] }>(`/v1/tasks/${taskId}/runs`),
    ]).then(([p, r]) => {
      if (!live) return;
      setPreview(p.ok ? { key, data: p.data.data } : { key, error: p.message });
      if (r.ok) {
        setRuns(r.data.data);
        const active = r.data.data.find((x) => isActiveRun(x.status));
        if (active) setActiveId(active.id);
      }
    });
    return () => {
      live = false;
    };
  }, [taskId, tier, detail, key]);

  const refresh = useCallback(() => {
    setVersion((v) => v + 1);
    router.refresh();
  }, [router]);
  const stream = useRunStream(activeId, { onFinal: refresh });

  async function run() {
    setBusy(true);
    setNotice(null);
    const r = await clientApi<{
      data: { status: string; run?: AgentRunDetailDTO; approvalId?: string; reasons?: string[] };
    }>(`/v1/tasks/${taskId}/runs`, {
      method: "POST",
      body: {
        ...(tier ? { modelTier: tier } : {}),
        ...(detail ? { responseDetail: detail } : {}),
        idempotencyKey: `${taskId}-${Date.now()}`,
      },
    });
    setBusy(false);
    if (!r.ok) return setNotice(r.message);
    if (r.data.data.status === "approval_required") {
      setNotice(
        `Approval required before running: ${r.data.data.reasons?.join("; ")}. An approval request was created.`,
      );
      return refresh();
    }
    setActiveId(r.data.data.run!.id);
    refresh();
  }

  const p = preview?.data;
  const loading = !preview || preview.key !== key;
  // Feedback returns the updated run; the stream has closed by then, so show it.
  const live =
    stream.run && feedbackOverride?.id === stream.run.id && !isActiveRun(stream.run.status)
      ? feedbackOverride
      : stream.run;
  return (
    <div className="space-y-5">
      <Panel
        title="Run with agent"
        eyebrow="Reasoning only — no external tools in this stage"
        actions={p?.route.isMock && <MockBadge label="Mock provider" />}
      >
        {preview?.error ? (
          <p className="text-[12.5px] text-fg-muted">{preview.error}</p>
        ) : loading || !p ? (
          <Skeleton className="h-24" />
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-end gap-2">
              <label className="text-[12px] text-fg-muted">
                <span className="mb-1 block">Model tier</span>
                <select
                  aria-label="Model tier"
                  className={selectCls}
                  value={tier}
                  onChange={(e) => setTier(e.target.value as ModelTier | "")}
                >
                  <option value="">Default</option>
                  <option value="standard">Standard</option>
                  <option value="premium">Premium</option>
                  <option value="auto">Auto</option>
                </select>
              </label>
              <label className="text-[12px] text-fg-muted">
                <span className="mb-1 block">Response detail</span>
                <select
                  aria-label="Response detail"
                  className={selectCls}
                  value={detail}
                  onChange={(e) => setDetail(e.target.value as ResponseDetail | "")}
                >
                  <option value="">Task default</option>
                  <option value="short">Short</option>
                  <option value="normal">Normal</option>
                  <option value="detailed">Detailed</option>
                </select>
              </label>
            </div>
            <div
              className={cn(
                "rounded-xl border p-3",
                p.route.tier === "premium"
                  ? "border-amber-300 bg-amber-50/60 dark:border-amber-500/40 dark:bg-amber-500/10"
                  : "border-line bg-surface-2/40",
              )}
              data-testid="provider-preview"
            >
              {p.route.provider ? (
                <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[12.5px] sm:grid-cols-5">
                  <div>
                    <dt className="text-fg-faint">Provider</dt>
                    <dd className="font-semibold">{PROVIDER_LABELS[p.route.provider]}</dd>
                  </div>
                  <div>
                    <dt className="text-fg-faint">Model</dt>
                    <dd className="font-semibold">
                      {p.route.modelLabel}
                      {p.route.tier === "premium" && (
                        <Sparkles
                          className="ml-1 inline size-3.5 text-amber-600"
                          aria-label="Premium"
                        />
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-fg-faint">Effort</dt>
                    <dd className="font-semibold capitalize">{p.route.effort ?? "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-fg-faint">Estimated context</dt>
                    <dd className="num font-semibold">
                      ~{p.route.estimatedInputTokens.toLocaleString()} tokens
                    </dd>
                  </div>
                  <div>
                    <dt className="text-fg-faint">Estimated cost</dt>
                    <dd className="num font-semibold" data-testid="estimated-cost">
                      {p.route.billingMode === "subscription"
                        ? "Included in subscription"
                        : formatUsd(p.route.estimatedCostUsd)}
                    </dd>
                  </div>
                </dl>
              ) : (
                <p className="text-[12.5px] font-medium">{p.route.blockedReason}</p>
              )}
              {p.route.tier === "premium" && (
                <p className="mt-2 text-[12px] text-amber-800 dark:text-amber-300">
                  Premium model — expect roughly double the standard cost.
                </p>
              )}
              {p.context && (
                <p className="mt-2 text-[11.5px] text-fg-muted">
                  Context: {p.context.knowledgeItems} knowledge items · {p.context.criticalRules}{" "}
                  critical rules · instructions {p.instructions?.version} (
                  {p.instructions?.ruleCount} rules) · budget {p.budget.decision.replace("_", " ")}
                </p>
              )}
            </div>
            {!p.eligible && p.reasons.length > 0 && (
              <ul
                className="list-disc space-y-0.5 pl-4 text-[12.5px] text-fg-muted"
                data-testid="run-blockers"
              >
                {p.reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            )}
            {p.route.approvalRequired && (
              <p className="text-[12.5px] text-amber-700 dark:text-amber-300">
                Above the high-cost threshold — running will request approval first.
              </p>
            )}
            {p.canExecute ? (
              <Button
                variant="primary"
                icon={<Play className="size-4" aria-hidden="true" />}
                disabled={busy || !p.eligible || !!(live && isActiveRun(live.status))}
                onClick={() => void run()}
              >
                {busy ? "Starting…" : "Run"}
              </Button>
            ) : (
              <p className="text-[12px] text-fg-faint">
                You need the “Run tasks with AI” permission for this company.
              </p>
            )}
            {notice && (
              <p role="status" className="text-[12.5px] text-fg-muted">
                {notice}
              </p>
            )}
          </div>
        )}
      </Panel>

      {live && (
        <Panel
          title={`Live run #${live.number}`}
          eyebrow={live.status === "completed" ? "Completed" : "Agent live run"}
        >
          <LiveRunPanel
            run={live}
            output={stream.output}
            onStop={() => void stopRun(live.id).then(refresh)}
            onChange={(r) => {
              setFeedbackOverride(r);
              refresh();
            }}
          />
        </Panel>
      )}

      <Panel title="Runs" eyebrow="History — results are never overwritten" bodyClassName="p-0">
        {runs.length === 0 ? (
          <EmptyState
            className="m-4"
            title="No runs yet"
            description="Run the task with its agent to see results here."
          />
        ) : (
          <ul className="divide-y divide-line/70" data-testid="run-history">
            {runs.map((r) => {
              const meta = RUN_STATUS_META[r.status];
              const ms =
                r.latencyMs ??
                (r.completedAt && r.startedAt
                  ? Date.parse(r.completedAt) - Date.parse(r.startedAt)
                  : null);
              return (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => setOpenId(r.id)}
                    className="focus-ring grid w-full grid-cols-[48px_minmax(0,1fr)_auto] items-center gap-3 px-4 py-2.5 text-left text-[13px] hover:bg-surface-2/60 sm:grid-cols-[48px_minmax(0,1.4fr)_120px_90px_80px]"
                  >
                    <span className="num font-semibold">#{r.number}</span>
                    <span className="min-w-0 truncate">
                      {r.modelLabel}
                      {r.isMock && (
                        <span className="ml-1 text-[11px] text-amber-700 dark:text-amber-300">
                          (mock)
                        </span>
                      )}
                    </span>
                    <StatusPill tone={meta.tone} label={meta.label} />
                    <span className="num hidden text-fg-muted sm:block">
                      {r.billingMode === "subscription"
                        ? "Subscription"
                        : r.actualCostUsd !== null
                          ? formatUsd(r.actualCostUsd)
                          : "—"}
                    </span>
                    <span className="num hidden text-fg-muted sm:block">
                      {ms !== null ? `${Math.round(ms / 1000)} sec` : "—"}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
      {openId && <RunDialog runId={openId} onClose={() => setOpenId(null)} onChange={refresh} />}
    </div>
  );
}
