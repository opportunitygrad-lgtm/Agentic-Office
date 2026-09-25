"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Bot,
  CheckCircle2,
  CircleDot,
  FileText,
  MessageSquare,
  ScrollText,
  Square,
  ThumbsDown,
  ThumbsUp,
} from "lucide-react";
import {
  ACTIVE_RUN_STATUSES,
  PROVIDER_LABELS,
  formatUsd,
  titleCase,
  type AgentExecutionResult,
  type AgentRunDetailDTO,
  type AgentRunDTO,
  type AgentRunStatus,
} from "@aibos/shared";
import { Button, MockBadge, StatusPill, cn, type Tone } from "@aibos/ui";
import { clientApi } from "@/lib/client-api";
import { clockTime } from "@/lib/format";

export const RUN_STATUS_META: Record<
  AgentRunStatus,
  { label: string; tone: Tone; pulse?: boolean }
> = {
  queued: { label: "Queued", tone: "idle" },
  preparing: { label: "Preparing", tone: "info", pulse: true },
  routing: { label: "Routing", tone: "info", pulse: true },
  running: { label: "Running", tone: "live", pulse: true },
  streaming: { label: "Running", tone: "live", pulse: true },
  waiting: { label: "Waiting", tone: "attention" },
  completed: { label: "Completed", tone: "done" },
  failed: { label: "Failed", tone: "danger" },
  cancel_requested: { label: "Stopping", tone: "attention", pulse: true },
  cancelled: { label: "Stopped", tone: "neutral" },
  needs_review: { label: "Needs review", tone: "attention" },
};

export const isActiveRun = (s: AgentRunStatus) => ACTIVE_RUN_STATUSES.includes(s);

export function useElapsed(
  run: Pick<AgentRunDTO, "createdAt" | "startedAt" | "completedAt" | "status"> | null,
): string {
  const [now, setNow] = useState(() => Date.now());
  const active = !!run && isActiveRun(run.status);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  if (!run) return "00:00";
  const start = Date.parse(run.startedAt ?? run.createdAt);
  const end = run.completedAt ? Date.parse(run.completedAt) : now;
  const s = Math.max(0, Math.round((end - start) / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

function ProviderBadge({
  run,
}: {
  run: Pick<AgentRunDTO, "provider" | "modelLabel" | "effort" | "isMock">;
}) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-md bg-surface-2 px-2 py-0.5 text-[11.5px] font-medium ring-1 ring-inset ring-line"
      data-testid="provider-badge"
    >
      {PROVIDER_LABELS[run.provider]} · {run.modelLabel.replace(" (mock)", "")}
      {run.effort && <span className="text-fg-faint">· {run.effort} effort</span>}
      {run.isMock && (
        <span className="rounded bg-amber-100 px-1 text-[10px] text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
          MOCK
        </span>
      )}
    </span>
  );
}

export async function stopRun(runId: string) {
  return clientApi<{ data: AgentRunDetailDTO }>(`/v1/runs/${runId}/cancel`, {
    method: "POST",
    body: {},
  });
}

/** Compact real-state card for dashboards and the Live view. */
export function LiveRunMini({
  run,
  output,
  onStop,
}: {
  run: AgentRunDTO;
  output?: string;
  onStop?: () => void;
}) {
  const meta = RUN_STATUS_META[run.status];
  const elapsed = useElapsed(run);
  const ctx = run.contextSummary;
  return (
    <article
      className="rounded-2xl border border-line bg-surface p-4 shadow-panel"
      data-testid="live-run-mini"
    >
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="eyebrow truncate">
            {PROVIDER_LABELS[run.provider]} — {run.agent?.name ?? "Agent"}
          </p>
          <p className="truncate text-[13px] font-semibold">
            {run.task?.title ?? (run.executionType === "chat" ? "Agent chat reply" : "Run")}
          </p>
        </div>
        <StatusPill tone={meta.tone} label={meta.label} pulse={meta.pulse} />
      </header>
      <p className="mt-1 text-[12.5px] text-fg-muted">{run.phase}…</p>
      {ctx && (
        <ul className="mt-2 grid grid-cols-2 gap-x-3 text-[11.5px] text-fg-muted">
          <li>✓ {run.company?.name ?? "Company"}</li>
          <li>✓ {run.task ? "Task" : "Conversation"}</li>
          <li>✓ {ctx.criticalRules} critical rules</li>
          <li>✓ {ctx.knowledgeItems} knowledge items</li>
        </ul>
      )}
      {output !== undefined && output.length > 0 && (
        <p className="mt-2 line-clamp-2 rounded-lg bg-surface-2 px-2 py-1 font-mono text-[11px] text-fg-muted">
          {output.slice(-240)}
        </p>
      )}
      <dl className="mt-2 grid grid-cols-3 gap-2 text-[11.5px]">
        <div>
          <dt className="text-fg-faint">Provider</dt>
          <dd className="truncate font-medium">{run.modelLabel.replace(" (mock)", "")}</dd>
        </div>
        <div>
          <dt className="text-fg-faint">Elapsed</dt>
          <dd className="num font-medium">{elapsed}</dd>
        </div>
        <div>
          <dt className="text-fg-faint">{run.actualCostUsd !== null ? "Actual" : "Estimated"}</dt>
          <dd className="num font-medium">
            {formatUsd(run.actualCostUsd ?? run.estimatedCostUsd)}
          </dd>
        </div>
      </dl>
      <div className="mt-3 flex items-center gap-2">
        {run.isMock && <MockBadge label="Mock provider" />}
        {run.viewer.canStop && isActiveRun(run.status) && onStop && (
          <Button
            size="sm"
            variant="danger"
            className="ml-auto"
            icon={<Square className="size-3.5" aria-hidden="true" />}
            onClick={onStop}
          >
            Stop
          </Button>
        )}
      </div>
    </article>
  );
}

export function RunResultView({ result }: { result: AgentExecutionResult }) {
  return (
    <div className="space-y-3 text-[13px]" data-testid="run-result">
      <p className="flex flex-wrap items-center gap-2">
        <StatusPill
          tone={result.status === "completed" ? "done" : "attention"}
          label={titleCase(result.status)}
        />
        <span className="text-[12px] text-fg-muted">Confidence: {result.confidence}</span>
      </p>
      <p className="font-medium">{result.summary}</p>
      <div className="whitespace-pre-wrap rounded-xl border border-line bg-surface-2/40 p-3 leading-relaxed">
        {result.response}
      </div>
      {[
        ["Key findings", result.keyFindings],
        ["Proposed next actions (not executed)", result.proposedNextActions],
        ["Warnings", result.warnings],
      ].map(([title, list]) =>
        (list as string[]).length ? (
          <section key={title as string}>
            <h4 className="eyebrow mb-1">{title as string}</h4>
            <ul className="list-disc space-y-0.5 pl-4">
              {(list as string[]).map((x, i) => (
                <li key={i}>{x}</li>
              ))}
            </ul>
          </section>
        ) : null,
      )}
      {result.proposedHandoffs.length > 0 && (
        <section>
          <h4 className="eyebrow mb-1">
            Proposed handoffs — require delegation checks before anything happens
          </h4>
          <ul className="space-y-1">
            {result.proposedHandoffs.map((h, i) => (
              <li key={i} className="rounded-lg border border-line/70 px-2.5 py-1.5">
                <span className="font-medium">{h.department}</span>: {h.objective}{" "}
                <span className="text-fg-muted">— {h.reason}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {result.proposedKnowledgeDrafts.length > 0 && (
        <section>
          <h4 className="eyebrow mb-1">Knowledge drafts proposed (stored as DRAFT, unverified)</h4>
          <ul className="list-disc pl-4">
            {result.proposedKnowledgeDrafts.map((d, i) => (
              <li key={i}>{d.title}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Feedback({
  run,
  onChange,
}: {
  run: AgentRunDTO;
  onChange: (r: AgentRunDetailDTO) => void;
}) {
  const [note, setNote] = useState("");
  const send = async (rating: "useful" | "not_useful") => {
    const r = await clientApi<{ data: AgentRunDetailDTO }>(`/v1/runs/${run.id}/feedback`, {
      method: "POST",
      body: { rating, ...(note ? { note } : {}) },
    });
    if (r.ok) onChange(r.data.data);
  };
  if (!run.viewer.canFeedback) return null;
  return (
    <div
      className="flex flex-wrap items-center gap-2 border-t border-line/70 pt-3"
      role="group"
      aria-label="Feedback"
    >
      <span className="text-[12px] text-fg-muted">Was this useful?</span>
      <Button
        size="sm"
        variant={run.feedback?.rating === "useful" ? "primary" : "secondary"}
        icon={<ThumbsUp className="size-3.5" aria-hidden="true" />}
        onClick={() => void send("useful")}
        aria-pressed={run.feedback?.rating === "useful"}
      >
        Useful
      </Button>
      <Button
        size="sm"
        variant={run.feedback?.rating === "not_useful" ? "primary" : "secondary"}
        icon={<ThumbsDown className="size-3.5" aria-hidden="true" />}
        onClick={() => void send("not_useful")}
        aria-pressed={run.feedback?.rating === "not_useful"}
      >
        Not useful
      </Button>
      <label className="sr-only" htmlFor={`fb-${run.id}`}>
        Feedback note
      </label>
      <input
        id={`fb-${run.id}`}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Optional note"
        className="focus-ring h-8 min-w-0 flex-1 rounded-lg border border-line bg-surface px-2 text-[12.5px]"
      />
    </div>
  );
}

/**
 * Full live view for a text (non-browser) agent run: state, costs, streamed
 * response and the observable event timeline. No fake browser screen.
 */
export function LiveRunPanel({
  run,
  output,
  onStop,
  onChange,
}: {
  run: AgentRunDetailDTO;
  output: string;
  onStop?: () => void;
  onChange?: (r: AgentRunDetailDTO) => void;
}) {
  const meta = RUN_STATUS_META[run.status];
  const elapsed = useElapsed(run);
  const active = isActiveRun(run.status);
  const facts: [string, React.ReactNode][] = [
    ["Agent", run.agent?.name ?? "—"],
    ["Company", run.company?.name ?? "—"],
    ["Task", run.task?.title ?? (run.executionType === "chat" ? "Chat reply" : "—")],
    ["Provider", <ProviderBadge key="p" run={run} />],
    ["Status", <StatusPill key="s" tone={meta.tone} label={meta.label} pulse={meta.pulse} />],
    ["Phase", run.phase],
    ["Started", run.startedAt ? clockTime(run.startedAt) : "—"],
    [
      "Elapsed",
      <span key="e" className="num">
        {elapsed}
      </span>,
    ],
    ["Estimated cost", formatUsd(run.estimatedCostUsd)],
    [
      "Actual cost",
      run.actualCostUsd !== null
        ? `${formatUsd(run.actualCostUsd)}${run.isMock ? " (mock)" : ""}`
        : "—",
    ],
  ];
  return (
    <div className="space-y-4" data-testid="live-run-panel">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[12.5px] md:grid-cols-5">
        {facts.map(([k, v]) => (
          <div key={k} className="min-w-0">
            <dt className="text-fg-faint">{k}</dt>
            <dd className="truncate font-medium">{v}</dd>
          </div>
        ))}
      </dl>
      <div className="flex flex-wrap gap-2">
        {active && run.viewer.canStop && onStop && (
          <Button
            variant="danger"
            size="sm"
            icon={<Square className="size-3.5" aria-hidden="true" />}
            onClick={onStop}
          >
            Stop run
          </Button>
        )}
        {run.agent && (
          <Link
            href={`/workforce/agents/${run.agent.id}?tab=chat`}
            className="focus-ring inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[13px] ring-1 ring-inset ring-line hover:bg-surface-2"
          >
            <MessageSquare className="size-3.5" aria-hidden="true" /> Message agent
          </Link>
        )}
        {run.task && (
          <Link
            href={`/tasks/item/${run.task.id}`}
            className="focus-ring inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[13px] ring-1 ring-inset ring-line hover:bg-surface-2"
          >
            <FileText className="size-3.5" aria-hidden="true" /> View task
          </Link>
        )}
        {run.agent && (
          <>
            <Link
              href={`/workforce/agents/${run.agent.id}?tab=context${run.company ? `&company=${run.company.slug}` : ""}`}
              className="focus-ring inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[13px] ring-1 ring-inset ring-line hover:bg-surface-2"
            >
              <Bot className="size-3.5" aria-hidden="true" /> View context
            </Link>
            <Link
              href={`/workforce/agents/${run.agent.id}?tab=instructions`}
              className="focus-ring inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[13px] ring-1 ring-inset ring-line hover:bg-surface-2"
            >
              <ScrollText className="size-3.5" aria-hidden="true" /> View instructions
            </Link>
          </>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <section
          aria-label="Agent response"
          className="min-w-0 rounded-xl border border-line bg-surface p-3"
        >
          <h3 className="eyebrow mb-2">{active ? "Streaming response" : "Response"}</h3>
          {run.status === "completed" && run.result ? (
            <RunResultView result={run.result} />
          ) : output ? (
            <pre
              className="max-h-[420px] overflow-auto whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed"
              aria-live="polite"
              data-testid="run-output"
            >
              {output}
              {active && <span className="animate-pulse">▍</span>}
            </pre>
          ) : (
            <p className="text-[12.5px] text-fg-muted">{active ? `${run.phase}…` : "No output."}</p>
          )}
          {run.status === "completed" && !run.result && output && (
            <pre className="whitespace-pre-wrap text-[12.5px]">{output}</pre>
          )}
          {(run.status === "failed" || run.status === "needs_review") && (
            <p
              role="alert"
              className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-[12.5px] text-rose-800 dark:bg-rose-500/10 dark:text-rose-300"
              data-testid="run-error"
            >
              {run.errorCode}: {run.errorMessage}
            </p>
          )}
          {run.status === "completed" && onChange && (
            <div className="mt-3">
              <Feedback run={run} onChange={onChange} />
            </div>
          )}
        </section>
        <section
          aria-label="Event timeline"
          className="rounded-xl border border-line bg-surface p-3"
        >
          <h3 className="eyebrow mb-2">Event timeline</h3>
          <ol className="space-y-1.5" data-testid="run-timeline">
            {run.events.map((e) => (
              <li key={e.id} className="flex gap-2 text-[12px]">
                {e.type.includes("FAILED") || e.type === "RUN_CANCELLED" ? (
                  <CircleDot
                    className="mt-0.5 size-3.5 shrink-0 text-rose-500"
                    aria-hidden="true"
                  />
                ) : (
                  <CheckCircle2
                    className="mt-0.5 size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400"
                    aria-hidden="true"
                  />
                )}
                <span className="min-w-0">
                  <span className="font-medium">{e.label}</span>
                  {e.detail && <span className="block truncate text-fg-muted">{e.detail}</span>}
                </span>
                <span className="num ml-auto shrink-0 text-fg-faint">
                  {clockTime(e.occurredAt)}
                </span>
              </li>
            ))}
          </ol>
          {run.usage && (
            <dl
              className={cn(
                "mt-3 grid grid-cols-2 gap-1 border-t border-line/70 pt-2 text-[11.5px]",
              )}
              data-testid="run-usage"
            >
              <dt className="text-fg-faint">Input</dt>
              <dd className="num text-right">{run.usage.inputTokens.toLocaleString()}</dd>
              <dt className="text-fg-faint">Output</dt>
              <dd className="num text-right">{run.usage.outputTokens.toLocaleString()}</dd>
              <dt className="text-fg-faint">Cache write</dt>
              <dd className="num text-right">{run.usage.cacheCreationTokens.toLocaleString()}</dd>
              <dt className="text-fg-faint">Cache read</dt>
              <dd className="num text-right">{run.usage.cacheReadTokens.toLocaleString()}</dd>
              <dt className="text-fg-faint">Latency</dt>
              <dd className="num text-right">
                {run.latencyMs !== null ? `${(run.latencyMs / 1000).toFixed(1)}s` : "—"}
              </dd>
            </dl>
          )}
        </section>
      </div>
    </div>
  );
}
