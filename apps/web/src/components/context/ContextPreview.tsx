"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Ban,
  Bot,
  Building2,
  CheckCircle2,
  ClipboardList,
  Code2,
  EyeOff,
  FileWarning,
  Gavel,
  Lock,
  ShieldCheck,
  Timer,
  type LucideIcon,
} from "lucide-react";
import { renderContextPack } from "@aibos/context-core";
import {
  KNOWLEDGE_TYPE_LABELS,
  type AgentContextPack,
  type ContextBudget,
  type ContextExclusion,
  type ContextKnowledgeEntry,
  type ContextRuleEntry,
  type TaskDTO,
} from "@aibos/shared";
import { Skeleton, cn } from "@aibos/ui";
import { clientApi } from "@/lib/client-api";
import {
  FreshnessBadge,
  SensitivityBadge,
  SeverityBadge,
  SourceTag,
  VerificationBadge,
} from "../knowledge/badges";
import { EXCLUSION_LABELS, INCLUSION_LABELS, shortDate } from "../knowledge/labels";

const BUDGETS: { value: Exclude<ContextBudget, "custom">; label: string }[] = [
  { value: "small", label: "Small" },
  { value: "standard", label: "Standard" },
  { value: "large", label: "Large" },
];

function Card({
  title,
  icon: Icon,
  count,
  children,
  className,
  tone,
}: {
  title: string;
  icon: LucideIcon;
  count?: number;
  children: React.ReactNode;
  className?: string;
  tone?: "warn" | "danger";
}) {
  return (
    <section
      aria-label={title}
      className={cn(
        "min-w-0 rounded-2xl border bg-surface shadow-panel",
        tone === "warn"
          ? "border-amber-500/30"
          : tone === "danger"
            ? "border-rose-500/30"
            : "border-line",
        className,
      )}
    >
      <header className="flex items-center justify-between gap-2 border-b border-line/70 px-4 py-2.5">
        <h3 className="flex items-center gap-2 text-[11.5px] font-semibold uppercase tracking-wider text-fg-muted">
          <Icon className="size-3.5" aria-hidden="true" />
          {title}
        </h3>
        {count !== undefined && (
          <span className="num rounded-md bg-surface-2 px-1.5 text-[11px] text-fg-muted">
            {count}
          </span>
        )}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

function Reasons({ reasons, details }: { reasons: string[]; details?: string[] }) {
  return (
    <div className="mt-2">
      <p className="text-[10.5px] font-medium uppercase tracking-wide text-fg-faint">
        Included because
      </p>
      <ul className="mt-1 flex flex-wrap gap-1" title={details?.join("\n")}>
        {reasons.map((r) => (
          <li
            key={r}
            className="rounded-md bg-accent-soft px-1.5 py-0.5 text-[11px] font-medium text-accent"
          >
            {INCLUSION_LABELS[r as keyof typeof INCLUSION_LABELS] ?? r}
          </li>
        ))}
      </ul>
    </div>
  );
}

function RuleItem({ r }: { r: ContextRuleEntry }) {
  return (
    <li className="rounded-xl border border-line p-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <SeverityBadge value={r.severity} />
        <span className="text-[11px] uppercase tracking-wide text-fg-faint">{r.kind}</span>
        {r.mandatory && (
          <span
            className="inline-flex items-center gap-1 text-[11px] text-fg-muted"
            title="Never dropped to save context"
          >
            <Lock className="size-3" aria-hidden="true" /> Always included
          </span>
        )}
        {r.global && (
          <span className="rounded bg-sky-500/10 px-1.5 text-[10.5px] font-medium text-sky-700 dark:text-sky-300">
            Global
          </span>
        )}
      </div>
      <p className="mt-1 text-[13px] font-medium">{r.title}</p>
      <p className="text-[12.5px] text-fg-muted">{r.description}</p>
      {r.detail && <p className="mt-1 font-mono text-[11px] text-fg-muted">{r.detail}</p>}
      <Reasons reasons={r.reasons} />
    </li>
  );
}

function KnowledgeItem({ k }: { k: ContextKnowledgeEntry }) {
  return (
    <li
      className={cn(
        "rounded-xl border p-3",
        k.section === "unverified" ? "border-amber-500/40 bg-amber-500/5" : "border-line",
      )}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <span
          className="num rounded-md bg-surface-2 px-1.5 py-0.5 text-[11px] font-semibold ring-1 ring-inset ring-line"
          title="Knowledge precedence (1 = highest)"
        >
          P{k.precedenceTier}
        </span>
        <span className="text-[11px] text-fg-faint">{KNOWLEDGE_TYPE_LABELS[k.type]}</span>
        {k.global && (
          <span className="rounded bg-sky-500/10 px-1.5 text-[10.5px] font-medium text-sky-700 dark:text-sky-300">
            Global
          </span>
        )}
        {k.redacted && (
          <span className="inline-flex items-center gap-1 rounded bg-surface-2 px-1.5 text-[10.5px] text-fg-muted">
            <EyeOff className="size-3" aria-hidden="true" /> Hidden from you
          </span>
        )}
      </div>
      <p className="mt-1 text-[13px] font-medium">{k.title}</p>
      <p className="mt-0.5 text-[12.5px] text-fg-muted">{k.snippet}</p>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <SourceTag source={k.sourceType} />
        <VerificationBadge value={k.verificationStatus} />
        {k.freshness !== "current" && <FreshnessBadge value={k.freshness} />}
        <SensitivityBadge value={k.sensitivity} compact />
        {k.lastVerifiedAt && (
          <span className="text-[11px] text-fg-faint">verified {shortDate(k.lastVerifiedAt)}</span>
        )}
      </div>
      {k.warnings.length > 0 && (
        <ul className="mt-2 space-y-0.5">
          {k.warnings.map((w) => (
            <li
              key={w}
              className="flex items-start gap-1.5 text-[11.5px] font-medium text-amber-700 dark:text-amber-300"
            >
              <AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
              {w}
            </li>
          ))}
        </ul>
      )}
      <Reasons reasons={k.reasons} details={k.reasonDetails} />
    </li>
  );
}

function ExcludedList({ items }: { items: ContextExclusion[] }) {
  const groups = useMemo(() => {
    const m = new Map<string, ContextExclusion[]>();
    for (const e of items) m.set(e.reason, [...(m.get(e.reason) ?? []), e]);
    return [...m.entries()];
  }, [items]);
  if (!items.length) return <p className="text-[12.5px] text-fg-faint">Nothing excluded.</p>;
  return (
    <ul className="space-y-3">
      {groups.map(([reason, list]) => (
        <li key={reason}>
          <p className="flex items-center gap-2 text-[12px] font-semibold">
            {EXCLUSION_LABELS[reason as keyof typeof EXCLUSION_LABELS] ?? reason}
            <span className="num rounded bg-surface-2 px-1 text-[10.5px] text-fg-muted">
              {list.length}
            </span>
          </p>
          <ul className="mt-1 space-y-0.5">
            {list.slice(0, 8).map((e) => (
              <li key={e.id} className="truncate text-[12px] text-fg-muted" title={e.detail}>
                {e.title ?? (
                  <span className="italic text-fg-faint">
                    {e.reason === "other_company"
                      ? "Another company's item (hidden)"
                      : "Hidden item"}
                  </span>
                )}
              </li>
            ))}
            {list.length > 8 && (
              <li className="text-[11.5px] text-fg-faint">+{list.length - 8} more</li>
            )}
          </ul>
        </li>
      ))}
    </ul>
  );
}

export interface PreviewTarget {
  /** Agent preview (company + optional task). */
  agentId?: string;
  /** Task preview (company from the task; agent optional override). */
  taskId?: string;
}

export function ContextPreview({
  target,
  companies,
  defaultCompany,
  tasks,
}: {
  target: PreviewTarget;
  /** Companies the viewer may preview (agent mode). */
  companies?: { slug: string; name: string }[];
  defaultCompany?: string;
  /** Candidate tasks for the agent (agent mode). */
  tasks?: TaskDTO[];
}) {
  const [company, setCompany] = useState(defaultCompany ?? companies?.[0]?.slug ?? "");
  const [taskId, setTaskId] = useState("");
  const [budget, setBudget] = useState<Exclude<ContextBudget, "custom">>("standard");
  const [raw, setRaw] = useState(false);
  const [state, setState] = useState<{
    key: string;
    pack?: AgentContextPack;
    redacted?: number;
    error?: string;
  } | null>(null);

  const path = target.taskId
    ? `/v1/tasks/${target.taskId}/context`
    : `/v1/agents/${target.agentId}/context`;
  const params = useMemo(
    () =>
      target.taskId
        ? { budget, agent: target.agentId }
        : { budget, company: company || undefined, task: taskId || undefined },
    [target, budget, company, taskId],
  );
  const key = `${path}?${JSON.stringify(params)}`;

  useEffect(() => {
    let active = true;
    void clientApi<{ data: AgentContextPack; redactedForViewer: number }>(path, { params }).then(
      (res) => {
        if (!active) return;
        setState(
          res.ok
            ? { key, pack: res.data.data, redacted: res.data.redactedForViewer }
            : { key, error: res.message },
        );
      },
    );
    return () => {
      active = false;
    };
  }, [key, path, params]);

  const loading = !state || state.key !== key;
  const pack = state?.pack;
  const companyTasks = (tasks ?? []).filter((t) => t.company?.slug === company);
  const stale = pack
    ? [...pack.knowledge, ...pack.unverified].filter(
        (k) => k.freshness === "expired" || k.freshness === "review_due",
      )
    : [];
  const usage = pack
    ? Math.min(100, Math.round((pack.metadata.approxChars / pack.metadata.budgetChars) * 100))
    : 0;
  const rules = pack
    ? [...pack.rules.compliance, ...pack.rules.commercial, ...pack.rules.brand]
    : [];

  return (
    <div className="space-y-4" data-testid="context-preview">
      <div className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4 shadow-panel lg:flex-row lg:items-end">
        {!target.taskId && companies && (
          <label className="min-w-0 flex-1 text-[12.5px] font-medium">
            Company
            <select
              value={company}
              onChange={(e) => {
                setCompany(e.target.value);
                setTaskId("");
              }}
              className="focus-ring mt-1 block h-9 w-full rounded-lg border border-line bg-surface px-2 text-[13px] font-normal"
            >
              {companies.map((c) => (
                <option key={c.slug} value={c.slug}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {!target.taskId && (
          <label className="min-w-0 flex-[2] text-[12.5px] font-medium">
            Task
            <select
              value={taskId}
              onChange={(e) => setTaskId(e.target.value)}
              className="focus-ring mt-1 block h-9 w-full rounded-lg border border-line bg-surface px-2 text-[13px] font-normal"
            >
              <option value="">No task — standing context only</option>
              {companyTasks.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
            </select>
          </label>
        )}
        <div>
          <p className="text-[12.5px] font-medium">Context budget</p>
          <div
            className="mt-1 inline-flex rounded-lg border border-line p-0.5"
            role="radiogroup"
            aria-label="Context budget"
          >
            {BUDGETS.map((b) => (
              <button
                key={b.value}
                type="button"
                role="radio"
                aria-checked={budget === b.value}
                onClick={() => setBudget(b.value)}
                className={cn(
                  "focus-ring rounded-md px-3 py-1.5 text-[12.5px] font-medium",
                  budget === b.value ? "bg-surface-3 text-fg" : "text-fg-muted hover:text-fg",
                )}
              >
                {b.label}
              </button>
            ))}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setRaw((v) => !v)}
          aria-pressed={raw}
          className="focus-ring inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-[12.5px] font-medium ring-1 ring-inset ring-line hover:bg-surface-2"
        >
          <Code2 className="size-4" aria-hidden="true" /> {raw ? "Visual view" : "Provider text"}
        </button>
      </div>

      {state?.error && !loading ? (
        <p
          role="alert"
          className="rounded-2xl border border-line bg-surface p-6 text-[13px] text-fg-muted"
        >
          {state.error}
        </p>
      ) : !pack ? (
        <div
          className="grid grid-cols-1 gap-4 lg:grid-cols-3"
          aria-busy="true"
          aria-label="Assembling context"
        >
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-40 rounded-2xl" />
          ))}
        </div>
      ) : (
        <div className={cn("space-y-4", loading && "opacity-60")} aria-busy={loading}>
          {/* size & metadata */}
          <div className="rounded-2xl border border-line bg-surface p-4 shadow-panel">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="text-[11.5px] text-fg-faint">Estimated context size</p>
                <p className="num text-[22px] font-semibold leading-tight">
                  ~{pack.metadata.approxTokens.toLocaleString()} tokens
                  <span className="ml-2 text-[13px] font-normal text-fg-muted">
                    {pack.metadata.approxChars.toLocaleString()} /{" "}
                    {pack.metadata.budgetChars.toLocaleString()} chars
                  </span>
                </p>
              </div>
              <dl className="flex flex-wrap gap-x-5 gap-y-1 text-[12px]">
                {(
                  [
                    ["Knowledge included", pack.metadata.includedKnowledgeIds.length],
                    ["Excluded", pack.metadata.excludedCount],
                    ["Stale", pack.metadata.staleCount],
                    ["Dropped for budget", pack.metadata.droppedForBudget],
                    ["Cross-company blocked", pack.metadata.blockedCrossCompany],
                  ] as const
                ).map(([k, v]) => (
                  <div key={k}>
                    <dt className="text-fg-faint">{k}</dt>
                    <dd className="num font-semibold">{v}</dd>
                  </div>
                ))}
              </dl>
            </div>
            <div
              className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-3"
              role="meter"
              aria-label="Context budget used"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={usage}
            >
              <div
                className={cn(
                  "h-full rounded-full",
                  pack.metadata.overBudget
                    ? "bg-rose-500"
                    : usage > 85
                      ? "bg-amber-500"
                      : "bg-accent",
                )}
                style={{ width: `${usage}%` }}
              />
            </div>
            <p className="mt-2 text-[11.5px] text-fg-faint">
              Generated {new Date(pack.metadata.generatedAt).toLocaleString("en-GB")} ·{" "}
              {pack.metadata.contextVersion} · deterministic assembly (no AI)
              {!!state?.redacted && ` · ${state.redacted} item(s) hidden from you by sensitivity`}
            </p>
            {pack.warnings.length > 0 && (
              <ul className="mt-3 space-y-1">
                {pack.warnings.map((w) => (
                  <li
                    key={w}
                    className="flex items-start gap-1.5 text-[12.5px] font-medium text-amber-700 dark:text-amber-300"
                  >
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                    {w}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {raw ? (
            <pre
              className="max-h-[70vh] overflow-auto whitespace-pre-wrap rounded-2xl border border-line bg-surface-2 p-4 font-mono text-[12px] leading-relaxed"
              aria-label="Provider text"
            >
              {renderContextPack(pack)}
            </pre>
          ) : (
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
              <Card title="Agent" icon={Bot}>
                <p className="text-[14px] font-semibold">{pack.agent.name}</p>
                <dl className="mt-2 grid grid-cols-2 gap-2 text-[12px]">
                  <div>
                    <dt className="text-fg-faint">Autonomy</dt>
                    <dd className="font-medium">{pack.agent.autonomyLabel}</dd>
                  </div>
                  <div>
                    <dt className="text-fg-faint">Department</dt>
                    <dd className="font-medium">{pack.agent.department ?? "—"}</dd>
                  </div>
                  <div className="col-span-2">
                    <dt className="text-fg-faint">Reports to</dt>
                    <dd className="font-medium">{pack.agent.reportsTo ?? "—"}</dd>
                  </div>
                </dl>
              </Card>
              <Card title="Company" icon={Building2}>
                <dl className="space-y-1.5 text-[12.5px]">
                  {pack.company.lines.slice(0, 6).map((l) => (
                    <div key={l.label}>
                      <dt className="text-[11px] text-fg-faint">{l.label}</dt>
                      <dd>{l.value}</dd>
                    </div>
                  ))}
                </dl>
                <p className="mt-2 text-[11.5px] text-fg-faint">
                  {pack.company.lines.length} core line(s)
                  {pack.company.extended.length > 0 &&
                    ` · business detail ${pack.company.extendedIncluded ? "included" : "omitted for budget"}`}
                </p>
              </Card>
              <Card title="Task" icon={ClipboardList}>
                {pack.task ? (
                  <>
                    <p className="text-[13.5px] font-semibold">{pack.task.title}</p>
                    {pack.task.objective && (
                      <p className="mt-1 text-[12.5px] text-fg-muted">{pack.task.objective}</p>
                    )}
                    <p className="mt-2 text-[11.5px] text-fg-faint">
                      {pack.task.type} · {pack.task.priority} priority
                      {pack.task.parent ? ` · parent: ${pack.task.parent.title}` : ""}
                    </p>
                    <p className="mt-2 rounded-lg bg-surface-2 px-2.5 py-1.5 text-[12px]">
                      <span className="font-medium">Expected output:</span>{" "}
                      {pack.task.expectedOutput}
                    </p>
                  </>
                ) : (
                  <p className="text-[12.5px] text-fg-faint">
                    No task selected — standing context only.
                  </p>
                )}
              </Card>

              <Card title="Rules" icon={Gavel} count={rules.length} className="xl:col-span-2">
                {rules.length ? (
                  <ul className="grid grid-cols-1 gap-2 md:grid-cols-2">
                    {rules.map((r) => (
                      <RuleItem key={r.id} r={r} />
                    ))}
                  </ul>
                ) : (
                  <p className="text-[12.5px] text-fg-faint">No binding rules apply.</p>
                )}
                {pack.rules.aiPolicy.length > 0 && (
                  <dl className="mt-3 grid grid-cols-1 gap-x-4 gap-y-1 border-t border-line/70 pt-3 text-[12px] sm:grid-cols-2">
                    {pack.rules.aiPolicy.map((l, i) => (
                      <div key={`${l.label}-${i}`} className="flex justify-between gap-2">
                        <dt className="text-fg-faint">{l.label}</dt>
                        <dd className="text-right font-medium">{l.value}</dd>
                      </div>
                    ))}
                  </dl>
                )}
              </Card>
              <Card title="Permissions" icon={ShieldCheck}>
                <p className="text-[11px] font-medium uppercase tracking-wide text-fg-faint">
                  Allowed
                </p>
                <ul className="mt-1 flex flex-wrap gap-1">
                  {pack.agent.allowed.map((p) => (
                    <li
                      key={p}
                      className="rounded-md bg-emerald-500/10 px-1.5 py-0.5 font-mono text-[10.5px] text-emerald-700 dark:text-emerald-300"
                    >
                      ✓ {p}
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-[11px] font-medium uppercase tracking-wide text-fg-faint">
                  Needs approval
                </p>
                <ul className="mt-1 flex flex-wrap gap-1">
                  {pack.agent.approvalRequired.length ? (
                    pack.agent.approvalRequired.map((p) => (
                      <li
                        key={p}
                        className="rounded-md bg-violet-500/10 px-1.5 py-0.5 font-mono text-[10.5px] text-violet-700 dark:text-violet-300"
                      >
                        → {p}
                      </li>
                    ))
                  ) : (
                    <li className="text-[12px] text-fg-faint">None</li>
                  )}
                </ul>
                <p className="mt-3 text-[11px] text-fg-faint">
                  {pack.agent.denied.length} permission(s) denied
                </p>
              </Card>

              <Card
                title="Knowledge included"
                icon={CheckCircle2}
                count={pack.knowledge.length}
                className="xl:col-span-2"
              >
                {pack.knowledge.length ? (
                  <ul className="grid grid-cols-1 gap-2 md:grid-cols-2">
                    {pack.knowledge.map((k) => (
                      <KnowledgeItem key={k.id} k={k} />
                    ))}
                  </ul>
                ) : (
                  <p className="text-[12.5px] text-fg-faint">
                    No approved knowledge is relevant yet.
                  </p>
                )}
                {pack.unverified.length > 0 && (
                  <>
                    <p className="mb-2 mt-4 flex items-center gap-1.5 text-[12px] font-semibold text-amber-700 dark:text-amber-300">
                      <FileWarning className="size-3.5" aria-hidden="true" /> Unverified context
                      (clearly labelled, not authoritative)
                    </p>
                    <ul className="grid grid-cols-1 gap-2 md:grid-cols-2">
                      {pack.unverified.map((k) => (
                        <KnowledgeItem key={k.id} k={k} />
                      ))}
                    </ul>
                  </>
                )}
              </Card>
              <div className="space-y-4">
                <Card title="Knowledge excluded" icon={EyeOff} count={pack.excluded.length}>
                  <ExcludedList items={pack.excluded} />
                </Card>
                <Card
                  title="Stale items"
                  icon={Timer}
                  count={stale.length}
                  tone={stale.length ? "warn" : undefined}
                >
                  {stale.length ? (
                    <ul className="space-y-1">
                      {stale.map((k) => (
                        <li
                          key={k.id}
                          className="flex items-center justify-between gap-2 text-[12px]"
                        >
                          <span className="truncate">{k.title}</span>
                          <FreshnessBadge value={k.freshness} />
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-[12.5px] text-fg-faint">Everything included is current.</p>
                  )}
                  {pack.excluded.some((e) => e.reason === "expired") && (
                    <p className="mt-2 text-[11.5px] text-fg-faint">
                      {pack.excluded.filter((e) => e.reason === "expired").length} expired item(s)
                      excluded by company policy.
                    </p>
                  )}
                </Card>
              </div>

              <Card
                title="Prohibited actions"
                icon={Ban}
                count={pack.prohibitedActions.length}
                tone="danger"
                className="xl:col-span-2"
              >
                <ul className="space-y-1.5">
                  {pack.prohibitedActions.map((p, i) => (
                    <li
                      key={`${p.action}-${i}`}
                      className="flex flex-col gap-0.5 text-[12.5px] sm:flex-row sm:justify-between sm:gap-3"
                    >
                      <span className="font-medium">{p.action}</span>
                      <span className="shrink-0 text-[11.5px] text-fg-faint">{p.source}</span>
                    </li>
                  ))}
                </ul>
              </Card>
              <Card
                title="Approval requirements"
                icon={Gavel}
                count={pack.requiredApprovals.length}
              >
                <ul className="space-y-2">
                  {pack.requiredApprovals.map((a, i) => (
                    <li key={`${a.action}-${i}`} className="text-[12.5px]">
                      <p className="font-medium">{a.action}</p>
                      <p className="text-[11.5px] text-fg-muted">{a.requirement}</p>
                      <p className="text-[11px] text-fg-faint">{a.source}</p>
                    </li>
                  ))}
                </ul>
              </Card>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
