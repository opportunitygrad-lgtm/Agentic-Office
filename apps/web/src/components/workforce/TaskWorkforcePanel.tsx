"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Pause, Play, Send, UserPlus, X } from "lucide-react";
import {
  CAPABILITY_LABELS,
  DELEGATION_OUTCOME_LABELS,
  formatUsd,
  titleCase,
  type CandidateCheck,
  type DelegationDecisionDTO,
  type HandoffDTO,
  type HandoffType,
  type TaskDetailDTO,
} from "@aibos/shared";
import { Button, EmptyState, Panel, Skeleton, StatusPill, cn, type Tone } from "@aibos/ui";
import { clientApi } from "@/lib/client-api";
import { formatDateTime } from "@/lib/format";
import { Dialog } from "../common/Dialog";
import { SelectField, TagInput, TextArea, TextField } from "../wizard/fields";

const CHECK_LABELS: Record<CandidateCheck["check"], string> = {
  company: "Company",
  status: "Status",
  circular: "No loop",
  delegation_scope: "Allowed",
  capability: "Capability",
  permission: "Permission",
  capacity: "Capacity",
  department_capacity: "Dept. capacity",
  budget: "Budget",
};

const OUTCOME_TONE: Record<DelegationDecisionDTO["outcome"], Tone> = {
  handle_self: "live",
  delegate_to_agent: "info",
  delegate_to_team: "info",
  create_temporary_worker: "approval",
  require_human_review: "attention",
  blocked: "danger",
};

const HANDOFF_TONE: Record<HandoffDTO["status"], Tone> = {
  pending: "attention",
  accepted: "live",
  rejected: "danger",
  completed: "done",
  cancelled: "idle",
};

function Mark({ ok, label }: { ok: boolean; label: string }) {
  return ok ? (
    <Check
      className="mx-auto size-4 text-emerald-600 dark:text-emerald-400"
      aria-label={`${label}: passed`}
    />
  ) : (
    <X
      className="mx-auto size-4 text-rose-600 dark:text-rose-400"
      aria-label={`${label}: failed`}
    />
  );
}

/** Delegation preview, assignment actions, delegation history and handoffs for one task. */
export function TaskWorkforcePanel({ taskId }: { taskId: string }) {
  const router = useRouter();
  const [detail, setDetail] = useState<TaskDetailDTO | null>(null);
  const [decision, setDecision] = useState<DelegationDecisionDTO | null>(null);
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const [handoffs, setHandoffs] = useState<HandoffDTO[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [target, setTarget] = useState("");
  const [reason, setReason] = useState("");
  const [handoffOpen, setHandoffOpen] = useState(false);
  const [tempOpen, setTempOpen] = useState(false);

  const [version, setVersion] = useState(0);
  const load = () => setVersion((v) => v + 1);

  useEffect(() => {
    let live = true;
    void Promise.all([
      clientApi<{ data: TaskDetailDTO }>(`/v1/tasks/${taskId}/detail`),
      clientApi<{ data: DelegationDecisionDTO }>(`/v1/tasks/${taskId}/delegation`),
      clientApi<{ data: HandoffDTO[] }>("/v1/handoffs", { params: { task: taskId } }),
    ]).then(([d, p, h]) => {
      if (!live) return;
      if (d.ok) setDetail(d.data.data);
      else setError(d.message);
      if (p.ok) {
        setDecision(p.data.data);
        setDecisionError(null);
      } else setDecisionError(p.message);
      if (h.ok) setHandoffs(h.data.data);
    });
    return () => {
      live = false;
    };
  }, [taskId, version]);

  async function act(path: string, body: unknown, done: string) {
    setBusy(true);
    setNotice(null);
    const r = await clientApi(path, { method: "POST", body });
    setBusy(false);
    if (!r.ok) return setNotice(r.message);
    setNotice(done);
    setReason("");
    load();
    router.refresh();
  }

  if (error) return <EmptyState title="Workforce details unavailable" description={error} />;
  if (!detail) return <Skeleton className="h-64" />;
  const v = detail.viewer;
  const req = detail.requirements;
  const finished = ["completed", "cancelled", "failed"].includes(detail.status);
  const selected = decision?.candidates.find((c) => c.agentId === target);

  return (
    <div className="space-y-5">
      <Panel
        title="Requirements"
        eyebrow={`Delegation depth ${detail.delegationDepth}${detail.delegatedFrom ? ` · from ${detail.delegatedFrom.name}` : ""}`}
      >
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[12.5px] md:grid-cols-4">
          <div className="col-span-2">
            <dt className="text-fg-faint">Required capabilities</dt>
            <dd className="font-medium">
              {req.requiredCapabilities.map((c) => CAPABILITY_LABELS[c]).join(", ") || "Any"}
            </dd>
          </div>
          <div>
            <dt className="text-fg-faint">Max budget</dt>
            <dd className="font-medium">
              {req.maxBudget != null ? formatUsd(req.maxBudget) : "Agent default"}
            </dd>
          </div>
          <div>
            <dt className="text-fg-faint">Team / department</dt>
            <dd className="font-medium">{detail.team?.name ?? detail.department?.name ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-fg-faint">Delegation</dt>
            <dd className="font-medium">
              {req.delegationAllowed ? "Allowed" : "Not allowed"}
              {req.parallelAllowed ? " · parallel" : ""}
            </dd>
          </div>
          <div>
            <dt className="text-fg-faint">External actions</dt>
            <dd className="font-medium">
              {req.externalActionAllowed ? "Allowed (approval rules apply)" : "None"}
            </dd>
          </div>
          <div>
            <dt className="text-fg-faint">Stop when</dt>
            <dd className="font-medium">{req.stoppingCondition ?? "Role default"}</dd>
          </div>
          <div>
            <dt className="text-fg-faint">Expected outcome</dt>
            <dd className="font-medium">{req.expectedOutcome ?? "—"}</dd>
          </div>
          {detail.claim && (
            <div className="col-span-2">
              <dt className="text-fg-faint">Claimed</dt>
              <dd className="font-medium">
                {detail.claim.agentName} · lease until {formatDateTime(detail.claim.leaseExpiresAt)}
              </dd>
            </div>
          )}
        </dl>
      </Panel>

      <Panel
        title="Delegation preview"
        eyebrow="Deterministic — no AI is called"
        actions={
          decision && (
            <StatusPill
              tone={OUTCOME_TONE[decision.outcome]}
              label={DELEGATION_OUTCOME_LABELS[decision.outcome]}
            />
          )
        }
      >
        {decisionError ? (
          <p className="text-[12.5px] text-fg-muted">{decisionError}</p>
        ) : !decision ? (
          <Skeleton className="h-40" />
        ) : (
          <div className="space-y-4">
            <div
              className="rounded-xl border border-line bg-surface-2/50 p-3.5"
              data-testid="delegation-recommendation"
            >
              <p className="text-[13.5px] font-semibold">
                Recommendation: {DELEGATION_OUTCOME_LABELS[decision.outcome]}
                {decision.target && ` → ${decision.target.name}`}
              </p>
              <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-[12.5px] text-fg-muted">
                {decision.explanation.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
              <p className="mt-2 text-[12px] text-fg-faint">
                Requester: {decision.requester?.name ?? "—"} · Budget{" "}
                {decision.budget.decision.replace("_", " ")} (
                {formatUsd(decision.budget.estimateUsd)})
                {decision.approvalRequired && " · approval required"}
                {decision.queued && " · will queue (concurrency limit)"}
                {decision.duplicate.level !== "no_duplicate" &&
                  ` · ${titleCase(decision.duplicate.level)}`}
              </p>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-[12.5px]">
                <caption className="sr-only">Candidate checks</caption>
                <thead>
                  <tr className="border-b border-line text-[11px] text-fg-faint">
                    <th scope="col" className="py-1.5 text-left font-medium">
                      Candidate
                    </th>
                    {Object.entries(CHECK_LABELS).map(([k, l]) => (
                      <th key={k} scope="col" className="px-1 py-1.5 text-center font-medium">
                        {l}
                      </th>
                    ))}
                    <th scope="col" className="py-1.5 text-right font-medium">
                      Score
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {decision.candidates.map((c) => (
                    <tr
                      key={c.agentId}
                      className={cn(
                        "border-b border-line/60",
                        decision.target?.id === c.agentId && "bg-accent-soft/50",
                      )}
                    >
                      <th scope="row" className="py-2 pr-2 text-left font-normal">
                        <span className="block font-semibold">
                          {c.name}
                          {c.isTemporary && (
                            <span className="ml-1 text-[11px] font-normal text-fg-faint">
                              (temporary)
                            </span>
                          )}
                        </span>
                        <span
                          className={cn(
                            "text-[11px]",
                            c.eligible ? "text-emerald-700 dark:text-emerald-400" : "text-fg-muted",
                          )}
                        >
                          {c.eligible ? c.scoreReasons.join(", ") || "Eligible" : c.rejectedReason}
                        </span>
                      </th>
                      {(Object.keys(CHECK_LABELS) as CandidateCheck["check"][]).map((k) => {
                        const check = c.checks.find((x) => x.check === k);
                        return (
                          <td key={k} className="px-1 text-center" title={check?.detail}>
                            {check ? (
                              <Mark ok={check.passed} label={CHECK_LABELS[k]} />
                            ) : (
                              <span className="text-fg-faint">–</span>
                            )}
                          </td>
                        );
                      })}
                      <td className="num text-right">{c.eligible ? c.score : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Panel>

      {!finished && (v.canDelegate || v.canAssign || v.canPause) && (
        <Panel title="Assignment">
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {v.canDelegate &&
                decision &&
                decision.target &&
                ["delegate_to_agent", "delegate_to_team", "handle_self"].includes(
                  decision.outcome,
                ) && (
                  <Button
                    variant="primary"
                    disabled={busy}
                    icon={<Check className="size-4" aria-hidden="true" />}
                    onClick={() =>
                      void act(`/v1/tasks/${taskId}/delegate`, {}, "Recommendation accepted.")
                    }
                  >
                    Accept recommendation
                  </Button>
                )}
              {v.canCreateTemporary && decision?.outcome === "create_temporary_worker" && (
                <Button
                  variant="primary"
                  icon={<UserPlus className="size-4" aria-hidden="true" />}
                  onClick={() => setTempOpen(true)}
                >
                  Create temporary worker
                </Button>
              )}
              {v.canPause &&
                (detail.status === "paused" ? (
                  <Button
                    disabled={busy}
                    icon={<Play className="size-4" aria-hidden="true" />}
                    onClick={() => void act(`/v1/tasks/${taskId}/resume`, {}, "Task resumed.")}
                  >
                    Resume
                  </Button>
                ) : (
                  <Button
                    disabled={busy}
                    icon={<Pause className="size-4" aria-hidden="true" />}
                    onClick={() => void act(`/v1/tasks/${taskId}/pause`, {}, "Task paused.")}
                  >
                    Pause
                  </Button>
                ))}
              {v.canManageHandoffs && (
                <Button
                  icon={<Send className="size-4" aria-hidden="true" />}
                  onClick={() => setHandoffOpen(true)}
                >
                  Create handoff
                </Button>
              )}
            </div>
            {(v.canAssign || v.canDelegate) && decision && (
              <div className="grid grid-cols-1 gap-2 rounded-xl border border-line p-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end">
                <SelectField
                  label={detail.assignedAgent ? "Reassign to" : "Assign to"}
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                  options={[
                    { value: "", label: "Choose an agent" },
                    ...decision.candidates
                      .filter(
                        (c) =>
                          !c.checks.some(
                            (x) =>
                              !x.passed &&
                              ["company", "status", "circular", "permission"].includes(x.check),
                          ),
                      )
                      .map((c) => ({
                        value: c.agentId,
                        label: `${c.name}${c.eligible ? "" : " — override"}`,
                      })),
                  ]}
                />
                <TextField
                  label={
                    selected && !selected.eligible
                      ? "Reason (required for override)"
                      : "Reason (optional)"
                  }
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Why this agent?"
                />
                <Button
                  disabled={busy || !target || (!!selected && !selected.eligible && !reason.trim())}
                  onClick={() =>
                    void (v.canDelegate
                      ? act(
                          `/v1/tasks/${taskId}/delegate`,
                          { targetAgentId: target, reason: reason || undefined },
                          "Task delegated.",
                        )
                      : act(
                          `/v1/tasks/${taskId}/assign`,
                          { agentId: target, reason: reason || undefined },
                          "Task assigned.",
                        ))
                  }
                >
                  {detail.assignedAgent ? "Reassign" : "Assign"}
                </Button>
              </div>
            )}
            {notice && (
              <p role="status" className="text-[12.5px] text-fg-muted">
                {notice}
              </p>
            )}
          </div>
        </Panel>
      )}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Panel title="Delegation history">
          {detail.delegations.length === 0 ? (
            <p className="text-[12.5px] text-fg-muted">No delegation decisions recorded.</p>
          ) : (
            <ol className="space-y-2">
              {detail.delegations.map((d) => (
                <li key={d.id} className="rounded-lg border border-line/70 p-2.5 text-[12.5px]">
                  <p className="font-medium">
                    {DELEGATION_OUTCOME_LABELS[d.outcome]}
                    {d.to && ` → ${d.to.name}`}
                    {d.override && (
                      <span className="ml-1.5 rounded bg-amber-100 px-1 text-[10.5px] text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
                        Override
                      </span>
                    )}
                  </p>
                  <p className="text-[11.5px] text-fg-muted">
                    {d.from ? `From ${d.from.name}` : "By a person"}
                    {d.decidedBy && ` · ${d.decidedBy}`} · {formatDateTime(d.createdAt)}
                  </p>
                  {d.reason && <p className="mt-0.5 text-[12px]">Reason: {d.reason}</p>}
                </li>
              ))}
            </ol>
          )}
        </Panel>
        <Panel title="Handoffs">
          {handoffs.length === 0 ? (
            <p className="text-[12.5px] text-fg-muted">No handoffs for this task.</p>
          ) : (
            <ul className="space-y-2">
              {handoffs.map((h) => (
                <li
                  key={h.id}
                  className="rounded-lg border border-line/70 p-2.5 text-[12.5px]"
                  data-testid="handoff"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="min-w-0 truncate font-medium">
                      {h.from.name} → {h.to.name}
                    </p>
                    <StatusPill tone={HANDOFF_TONE[h.status]} label={titleCase(h.status)} />
                  </div>
                  <p className="mt-0.5 text-fg-muted">{h.summary}</p>
                  <p className="mt-0.5 text-[11.5px] text-fg-faint">
                    {titleCase(h.type)} · Action: {h.actionRequired}
                    {h.knowledge.length > 0 &&
                      ` · ${h.knowledge.length} evidence item${h.knowledge.length === 1 ? "" : "s"}`}
                    {h.knowledge.some((k) => k.redacted) && " (some restricted)"}
                  </p>
                  {v.canManageHandoffs && (h.status === "pending" || h.status === "accepted") && (
                    <div className="mt-2 flex gap-1.5">
                      {h.status === "pending" && (
                        <>
                          <Button
                            size="sm"
                            onClick={() =>
                              void act(`/v1/handoffs/${h.id}/accept`, {}, "Handoff accepted.")
                            }
                          >
                            Accept
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              void act(`/v1/handoffs/${h.id}/reject`, {}, "Handoff rejected.")
                            }
                          >
                            Reject
                          </Button>
                        </>
                      )}
                      {h.status === "accepted" && (
                        <Button
                          size="sm"
                          onClick={() =>
                            void act(`/v1/handoffs/${h.id}/complete`, {}, "Handoff completed.")
                          }
                        >
                          Mark complete
                        </Button>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      {handoffOpen && decision && (
        <HandoffDialog
          taskId={taskId}
          agents={decision.candidates.map((c) => ({ id: c.agentId, name: c.name }))}
          defaultSource={detail.assignedAgent?.id ?? ""}
          onClose={() => setHandoffOpen(false)}
          onDone={() => {
            setHandoffOpen(false);
            load();
          }}
        />
      )}
      {tempOpen && decision?.temporaryWorker && detail.company && (
        <TempWorkerDialog
          task={{ id: taskId, companyId: detail.company.id, title: detail.title }}
          parents={decision.candidates
            .filter((c) => !c.isTemporary)
            .map((c) => ({ id: c.agentId, name: c.name }))}
          suggestion={decision.temporaryWorker}
          onClose={() => setTempOpen(false)}
          onDone={(msg) => {
            setTempOpen(false);
            setNotice(msg);
            load();
          }}
        />
      )}
    </div>
  );
}

function HandoffDialog({
  taskId,
  agents,
  defaultSource,
  onClose,
  onDone,
}: {
  taskId: string;
  agents: { id: string; name: string }[];
  defaultSource: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [source, setSource] = useState(defaultSource);
  const [dest, setDest] = useState("");
  const [type, setType] = useState<HandoffType>("research_result");
  const [objective, setObjective] = useState("");
  const [summary, setSummary] = useState("");
  const [facts, setFacts] = useState<string[]>([]);
  const [action, setAction] = useState("");
  const [noRepeat, setNoRepeat] = useState<string[]>([
    "A contact is missing",
    "Information is outdated",
  ]);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const r = await clientApi("/v1/handoffs", {
      method: "POST",
      body: {
        taskId,
        sourceAgentId: source,
        toAgentId: dest,
        type,
        objective,
        summary,
        verifiedFacts: facts,
        actionRequired: action,
        doNotResearchAgainUnless: noRepeat,
      },
    });
    if (!r.ok)
      return setError(r.issues?.[0] ? `${r.issues[0].path}: ${r.issues[0].message}` : r.message);
    onDone();
  }

  const options = [
    { value: "", label: "Choose an agent" },
    ...agents.map((a) => ({ value: a.id, label: a.name })),
  ];
  return (
    <Dialog
      open
      onClose={onClose}
      title="Create handoff"
      description="The destination builds its own context; only this summary, verified facts and permitted evidence are passed on."
    >
      <form
        className="space-y-3 overflow-y-auto p-5"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <SelectField
            label="From agent"
            value={source}
            onChange={(e) => setSource(e.target.value)}
            options={options}
          />
          <SelectField
            label="To agent"
            value={dest}
            onChange={(e) => setDest(e.target.value)}
            options={options}
          />
        </div>
        <SelectField
          label="Type"
          value={type}
          onChange={(e) => setType(e.target.value as HandoffType)}
          options={[
            "research_result",
            "work_transfer",
            "review_request",
            "escalation",
            "information",
          ].map((t) => ({ value: t, label: titleCase(t) }))}
        />
        <TextField
          label="Objective"
          required
          value={objective}
          onChange={(e) => setObjective(e.target.value)}
        />
        <TextArea
          label="Summary"
          required
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
        />
        <TagInput label="Verified facts" values={facts} onChange={setFacts} />
        <TextField
          label="Action required"
          required
          value={action}
          onChange={(e) => setAction(e.target.value)}
        />
        <TagInput label="Do not research again unless" values={noRepeat} onChange={setNoRepeat} />
        {error && (
          <p role="alert" className="text-[12.5px] text-rose-600">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button
            type="submit"
            variant="primary"
            disabled={!source || !dest || !objective || !summary || !action}
          >
            Create handoff
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function TempWorkerDialog({
  task,
  parents,
  suggestion,
  onClose,
  onDone,
}: {
  task: { id: string; companyId: string; title: string };
  parents: { id: string; name: string }[];
  suggestion: NonNullable<DelegationDecisionDTO["temporaryWorker"]>;
  onClose: () => void;
  onDone: (msg: string) => void;
}) {
  const [parent, setParent] = useState(parents[0]?.id ?? "");
  const [name, setName] = useState(`${task.title.slice(0, 60)} worker`);
  const [purpose, setPurpose] = useState(task.title);
  const [hours, setHours] = useState(String(suggestion.expiresInHours));
  const [budget, setBudget] = useState(String(suggestion.budgetUsd));
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const r = await clientApi<{ data: { status?: string } }>("/v1/agents/temporary", {
      method: "POST",
      body: {
        parentAgentId: parent,
        companyId: task.companyId,
        taskId: task.id,
        name,
        purpose,
        capabilities: suggestion.capabilities,
        permissions: suggestion.permissions,
        expiresInHours: Number(hours),
        budgetUsd: Number(budget),
      },
    });
    if (!r.ok) return setError(r.message);
    onDone(
      r.data.data.status === "approval_required"
        ? "Approval requested for the temporary worker."
        : "Temporary worker created.",
    );
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Create temporary worker"
      description="Bound to this task and company; inherits the parent's prohibitions; never more permission than the parent can delegate; expires automatically."
    >
      <form
        className="space-y-3 overflow-y-auto p-5"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <SelectField
          label="Parent agent"
          value={parent}
          onChange={(e) => setParent(e.target.value)}
          options={parents.map((p) => ({ value: p.id, label: p.name }))}
        />
        <TextField label="Name" required value={name} onChange={(e) => setName(e.target.value)} />
        <TextField
          label="Purpose"
          required
          value={purpose}
          onChange={(e) => setPurpose(e.target.value)}
        />
        <div className="grid grid-cols-2 gap-3">
          <TextField
            label="Expires in (hours)"
            type="number"
            min={1}
            value={hours}
            onChange={(e) => setHours(e.target.value)}
          />
          <TextField
            label="Budget (USD)"
            type="number"
            min={0}
            step="0.1"
            value={budget}
            onChange={(e) => setBudget(e.target.value)}
          />
        </div>
        <p className="text-[12px] text-fg-muted">
          Capabilities: {suggestion.capabilities.map((c) => CAPABILITY_LABELS[c]).join(", ")} ·
          Permissions: {suggestion.permissions.join(", ") || "none"}
        </p>
        {error && (
          <p role="alert" className="text-[12.5px] text-rose-600">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={!parent || !name}>
            Create worker
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
