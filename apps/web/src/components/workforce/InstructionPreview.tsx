"use client";

import { useEffect, useState } from "react";
import { Lock, Scale } from "lucide-react";
import {
  INSTRUCTION_LAYER_LABELS,
  formatUsd,
  type CompiledAgentInstructionPack,
  type InstructionRuleDTO,
} from "@aibos/shared";
import { Button, EmptyState, Panel, Skeleton, cn } from "@aibos/ui";
import { clientApi } from "@/lib/client-api";

const selectCls =
  "focus-ring h-9 rounded-lg border border-line bg-surface px-2.5 text-[13px] text-fg hover:border-line-strong";

function RuleRow({ rule }: { rule: InstructionRuleDTO }) {
  const folded = !!rule.duplicateOf;
  const rejected = !!rule.rejected;
  return (
    <li
      className={cn(
        "rounded-lg border border-line/70 px-3 py-2",
        (folded || rejected) && "bg-surface-2/60 opacity-75",
      )}
    >
      <p
        className={cn(
          "text-[12.5px] leading-relaxed",
          rejected && "line-through decoration-rose-500/70",
        )}
      >
        {rule.locked && <Lock className="mr-1 inline size-3 text-fg-faint" aria-label="Locked" />}
        {rule.text}
      </p>
      <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-fg-faint">
        <span>Source: {rule.source}</span>
        <span>Why included: {rule.reason}</span>
        <span>{rule.category}</span>
        {folded && (
          <span className="font-medium text-fg-muted">Duplicate — kept at higher priority</span>
        )}
        {rejected && (
          <span className="font-medium text-rose-600 dark:text-rose-400">
            Rejected: {rule.rejected}
          </span>
        )}
      </p>
    </li>
  );
}

/**
 * Shows the compiled, provider-neutral instruction pack: each layer in
 * priority order with its source and why every rule is included.
 * Nothing is sent to an AI provider.
 */
export function InstructionPreview({
  agentId,
  companies,
  tasks,
}: {
  agentId: string;
  companies: { slug: string; name: string }[];
  tasks: { id: string; title: string; companySlug: string }[];
}) {
  const [company, setCompany] = useState(companies[0]?.slug ?? "");
  const [task, setTask] = useState("");
  const [state, setState] = useState<{
    key: string;
    pack?: CompiledAgentInstructionPack;
    error?: string;
  } | null>(null);
  const [showText, setShowText] = useState(false);
  const [showFolded, setShowFolded] = useState(false);
  const key = `${company}|${task}`;

  useEffect(() => {
    if (!company) return;
    let live = true;
    void clientApi<{ data: CompiledAgentInstructionPack }>(`/v1/agents/${agentId}/instructions`, {
      params: { company, task: task || undefined },
    }).then((r) => {
      if (live) setState(r.ok ? { key, pack: r.data.data } : { key, error: r.message });
    });
    return () => {
      live = false;
    };
  }, [agentId, company, task, key]);

  const loading = !state || state.key !== key;
  const pack = state?.pack ?? null;
  const error = state?.error ?? null;

  if (!companies.length)
    return (
      <EmptyState
        title="No instruction preview access"
        description="You need the View agent roles permission for a company this agent serves."
      />
    );

  const companyTasks = tasks.filter((t) => t.companySlug === company);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-[12px] text-fg-muted">
          <span className="mb-1 block">Company</span>
          <select
            aria-label="Preview company"
            className={selectCls}
            value={company}
            onChange={(e) => {
              setCompany(e.target.value);
              setTask("");
            }}
          >
            {companies.map((c) => (
              <option key={c.slug} value={c.slug}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="min-w-[220px] flex-1 text-[12px] text-fg-muted">
          <span className="mb-1 block">Task (optional)</span>
          <select
            aria-label="Preview task"
            className={cn(selectCls, "w-full")}
            value={task}
            onChange={(e) => setTask(e.target.value)}
          >
            <option value="">No task — standing instructions</option>
            {companyTasks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}
              </option>
            ))}
          </select>
        </label>
        <Button size="sm" onClick={() => setShowFolded((v) => !v)} aria-pressed={showFolded}>
          {showFolded ? "Hide folded duplicates" : "Show folded duplicates"}
        </Button>
        <Button size="sm" onClick={() => setShowText((v) => !v)} aria-pressed={showText}>
          {showText ? "Show layers" : "Show compiled text"}
        </Button>
      </div>

      {error && <EmptyState title="Preview unavailable" description={error} />}
      {loading && !pack && <Skeleton className="h-64" />}
      {pack && !error && (
        <>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label="Pack summary">
            {[
              ["Rules", pack.metadata.ruleCount],
              ["Duplicates folded", pack.metadata.duplicatesRemoved],
              ["Rejected overrides", pack.metadata.rejectedCount],
              [
                "Role version",
                pack.metadata.roleVersion ? `v${pack.metadata.roleVersion}` : "Template",
              ],
            ].map(([k, v]) => (
              <div key={k} className="rounded-xl border border-line bg-surface p-3">
                <dt className="text-[11px] text-fg-faint">{k}</dt>
                <dd className="num text-[18px] font-semibold">{v}</dd>
              </div>
            ))}
          </dl>

          {showText ? (
            <Panel
              title="Compiled instructions"
              eyebrow={`${pack.version} · ~${pack.metadata.approxChars.toLocaleString()} characters`}
            >
              <pre className="max-h-[560px] overflow-auto whitespace-pre-wrap text-[12px] leading-relaxed">
                {pack.text}
              </pre>
            </Panel>
          ) : (
            <ol className="space-y-3" aria-label="Instruction layers">
              {pack.layers.map((l) => {
                const shown = showFolded ? l.rules : l.rules.filter((r) => !r.duplicateOf);
                const folded = l.rules.length - l.rules.filter((r) => !r.duplicateOf).length;
                return (
                  <li key={l.layer}>
                    <Panel
                      title={`${l.priority}. ${l.label}`}
                      eyebrow={l.priority === 1 ? "Highest priority" : `Priority ${l.priority}`}
                      actions={
                        <span className="num text-[12px] text-fg-faint">
                          {l.rules.length - folded} rules{folded > 0 && ` · ${folded} folded`}
                        </span>
                      }
                      bodyClassName="p-3 sm:p-4"
                    >
                      {shown.length ? (
                        <ul className="space-y-1.5">
                          {shown.map((r) => (
                            <RuleRow key={r.id} rule={r} />
                          ))}
                        </ul>
                      ) : (
                        <p className="text-[12.5px] text-fg-faint">
                          {folded
                            ? `All ${folded} rules duplicate a higher layer and are folded into it.`
                            : "Nothing at this layer."}
                        </p>
                      )}
                    </Panel>
                  </li>
                );
              })}
            </ol>
          )}

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Panel title="Effective limits" eyebrow="Stricter layer wins">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[12.5px]">
                {[
                  ["Max searches", pack.effective.maxSearches],
                  ["Max retries", pack.effective.maxRetries],
                  ["Max task budget", formatUsd(pack.effective.maxTaskBudgetUsd)],
                  ["Deep research", pack.effective.deepResearch],
                  ["External actions", pack.effective.externalActions.replace("_", " ")],
                  [
                    "May delegate",
                    pack.effective.mayDelegate
                      ? `Yes (depth ≤ ${pack.effective.maxDelegationDepth})`
                      : "No",
                  ],
                  ["Tools allowed", pack.effective.allowedTools.length],
                  ["Tools needing approval", pack.effective.approvalTools.length],
                ].map(([k, v]) => (
                  <div key={String(k)}>
                    <dt className="text-fg-faint">{k}</dt>
                    <dd className="font-medium capitalize">{v}</dd>
                  </div>
                ))}
              </dl>
            </Panel>
            <Panel
              title="Resolved conflicts"
              eyebrow="Permissions and company policy win"
              actions={<Scale className="size-4 text-fg-faint" aria-hidden="true" />}
            >
              {pack.conflicts.length ? (
                <ul className="space-y-2">
                  {pack.conflicts.map((c) => (
                    <li key={c.id} className="rounded-lg border border-line/70 p-2.5 text-[12px]">
                      <p className="font-medium">{c.resolution}</p>
                      <p className="mt-0.5 text-fg-muted">
                        {INSTRUCTION_LAYER_LABELS[c.requested.layer]} asked: “{c.requested.text}”
                      </p>
                      <p className="text-fg-muted">
                        Winner (
                        {c.winner.layer === "authority"
                          ? "Permissions"
                          : INSTRUCTION_LAYER_LABELS[c.winner.layer]}
                        ): {c.winner.text}
                      </p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[12.5px] text-fg-muted">No conflicts — every layer agrees.</p>
              )}
            </Panel>
          </div>
          {pack.context && (
            <p className="text-[12px] text-fg-faint">
              Context pack {pack.context.contextVersion} · ~
              {pack.context.approxTokens.toLocaleString()} tokens ·{" "}
              {pack.context.includedKnowledgeIds.length} knowledge items referenced (assembled
              separately by the Context Engine).
            </p>
          )}
        </>
      )}
    </div>
  );
}
