import {
  CAPABILITY_PERMISSIONS,
  type AgentCapability,
  type AgentStatus,
  type BudgetDecision,
  type CandidateCheck,
  type CandidateEvaluation,
  type DelegationDecisionDTO,
  type TaskPriority,
  type TaskType,
} from "@aibos/shared";
import { detectDuplicates, type DuplicateCandidateTask } from "./duplicates";

/**
 * Deterministic delegation engine. Never calls an AI provider: every
 * decision is computed from data and explained candidate by candidate.
 */

export type PermissionDecision = "allow" | "require_approval" | "deny";

export interface DelegationAgent {
  agentId: string;
  name: string;
  templateKey: string;
  scope: "global" | "company";
  companyIds: string[];
  departmentId: string | null;
  departmentSlug: string | null;
  teamIds: string[];
  capabilities: AgentCapability[];
  status: AgentStatus;
  isTemporary: boolean;
  expiresAt: Date | null;
  /** Temporary workers only ever work on the task they were created for. */
  boundTaskId?: string | null;
  /** Decision per agent permission for THIS company (from the authority engine). */
  permissions: Record<string, PermissionDecision>;
  workload: { active: number; queued: number; capacity: number };
  perTaskBudget: number;
  dailyBudget: number;
  spentToday: number;
}

export interface DelegationRequester extends DelegationAgent {
  delegation: {
    mayDelegate: boolean;
    allowedDelegates: string[];
    allowedDepartments: string[];
    maxDepth: number;
  };
  maySpawnTemporary: boolean;
}

export interface DelegationTask {
  id: string | null;
  companyId: string;
  title: string;
  type: TaskType;
  priority: TaskPriority;
  requiredCapabilities: AgentCapability[];
  preferredDepartmentId: string | null;
  preferredAgentId: string | null;
  preferredTeamId: string | null;
  maxBudget: number | null;
  estimatedCost: number | null;
  delegationAllowed: boolean;
  parallelAllowed: boolean;
  externalActionAllowed: boolean;
  requiresApproval: boolean;
  delegationDepth: number;
  targetEntity: string | null;
  departmentId: string | null;
  workItems: number | null;
}

export interface DelegationTeam {
  id: string;
  name: string;
  companyId: string | null;
  departmentId: string | null;
  leaderAgentId: string | null;
  memberIds: string[];
  concurrencyLimit: number;
  activeTasks: number;
  active: boolean;
}

export interface DelegationRequest {
  now: Date;
  requester: DelegationRequester;
  task: DelegationTask;
  candidates: DelegationAgent[];
  teams: DelegationTeam[];
  concurrency: {
    global: { active: number; limit: number };
    company: { active: number; limit: number };
    departments: Record<string, { active: number; limit: number | null }>;
  };
  budget: {
    companyDailyRemaining: number;
    departmentRemaining: Record<string, number | null>;
    highCostThresholdUsd: number;
    tempAgentApprovalBudgetUsd: number;
  };
  /** Agents already in this task's delegation chain (circular-delegation guard). */
  chain: string[];
  maxDepth: number;
  openTasks: DuplicateCandidateTask[];
  /** Ids to ignore for duplicate detection (the task itself and its tree). */
  relatedTaskIds: string[];
  policy: { tempWorkerMinItems: number; activeTempAgents: number; maxTempAgents: number };
}

const UNAVAILABLE: AgentStatus[] = ["paused", "offline", "failed", "expired", "terminated"];

/** Agent permissions a task needs, from its capabilities and external-action flag. */
export function requiredPermissionsFor(
  task: Pick<DelegationTask, "requiredCapabilities" | "externalActionAllowed">,
): string[] {
  const perms = new Set<string>();
  for (const c of task.requiredCapabilities)
    for (const p of CAPABILITY_PERMISSIONS[c] ?? []) perms.add(p);
  if (task.externalActionAllowed) perms.add("action.external_send");
  return [...perms].sort();
}

function serves(a: Pick<DelegationAgent, "scope" | "companyIds">, companyId: string) {
  return a.scope === "global" || a.companyIds.includes(companyId);
}

function evaluate(
  a: DelegationAgent,
  req: DelegationRequest,
  requiredPerms: string[],
  estimate: number,
): CandidateEvaluation {
  const t = req.task;
  const checks: CandidateCheck[] = [];
  const add = (check: CandidateCheck["check"], passed: boolean, detail: string) =>
    checks.push({ check, passed, detail });

  add(
    "company",
    serves(a, t.companyId),
    serves(a, t.companyId) ? "Serves the company" : "Agent does not serve company",
  );
  const expired = a.isTemporary && a.expiresAt !== null && a.expiresAt <= req.now;
  const otherTask = a.isTemporary && !!a.boundTaskId && a.boundTaskId !== t.id;
  const available = !UNAVAILABLE.includes(a.status) && !expired && !otherTask;
  add(
    "status",
    available,
    available
      ? `Status ${a.status}`
      : otherTask
        ? "Temporary worker is bound to another task"
        : `Agent is ${expired ? "expired" : a.status}`,
  );
  const circular = req.chain.includes(a.agentId);
  add(
    "circular",
    !circular,
    circular
      ? "Already in this task's delegation chain (circular delegation)"
      : "Not in delegation chain",
  );
  const scope = req.requester.delegation;
  const inScope =
    (!scope.allowedDepartments.length ||
      (a.departmentSlug !== null && scope.allowedDepartments.includes(a.departmentSlug))) &&
    (!scope.allowedDelegates.length || scope.allowedDelegates.includes(a.templateKey));
  add(
    "delegation_scope",
    inScope,
    inScope
      ? "Within the requester's delegation scope"
      : "Outside the requester's allowed departments/delegates",
  );
  const missingCaps = t.requiredCapabilities.filter((c) => !a.capabilities.includes(c));
  add(
    "capability",
    missingCaps.length === 0,
    missingCaps.length
      ? `Capability mismatch (missing ${missingCaps.join(", ")})`
      : t.requiredCapabilities.length
        ? "Has every required capability"
        : "No specific capability required",
  );
  const denied = requiredPerms.filter((p) => (a.permissions[p] ?? "deny") === "deny");
  const gated = requiredPerms.filter((p) => a.permissions[p] === "require_approval");
  add(
    "permission",
    denied.length === 0,
    denied.length
      ? `Missing permission ${denied.join(", ")}`
      : gated.length
        ? `Permitted with approval (${gated.join(", ")})`
        : "Has the required permissions",
  );
  const free = a.workload.capacity - a.workload.active;
  add(
    "capacity",
    free > 0,
    free > 0 ? `${free} of ${a.workload.capacity} slot(s) free` : "At concurrency limit",
  );
  const dept = a.departmentId ? req.concurrency.departments[a.departmentId] : undefined;
  const deptOk = !dept || dept.limit === null || dept.active < dept.limit;
  add(
    "department_capacity",
    deptOk,
    deptOk ? "Department has capacity" : "Department at concurrency limit",
  );
  const overTask = estimate > a.perTaskBudget;
  const overDay = a.spentToday + estimate > a.dailyBudget;
  add(
    "budget",
    !overTask && !overDay,
    overTask
      ? `Estimate $${estimate} exceeds per-task budget $${a.perTaskBudget}`
      : overDay
        ? `Would exceed daily budget $${a.dailyBudget}`
        : "Within agent budget",
  );

  const eligible = checks.every((c) => c.passed);
  let score = 0;
  const scoreReasons: string[] = [];
  if (eligible) {
    const bump = (n: number, why: string) => {
      score += n;
      scoreReasons.push(`${n > 0 ? "+" : ""}${n} ${why}`);
    };
    if (t.preferredAgentId === a.agentId) bump(50, "preferred agent");
    if (t.preferredDepartmentId && t.preferredDepartmentId === a.departmentId)
      bump(20, "preferred department");
    if (t.preferredTeamId && a.teamIds.includes(t.preferredTeamId)) bump(15, "preferred team");
    if (t.requiredCapabilities.length) {
      bump(20, "required capability match");
      const extras = a.capabilities.length - t.requiredCapabilities.length;
      bump(Math.max(0, 10 - extras), "specialist focus");
    }
    bump(Math.max(0, free) * 5, "available capacity");
    bump(-a.workload.queued * 2, "queued work");
    if (!a.isTemporary) bump(5, "permanent agent");
    if (a.scope === "company") bump(3, "company specialist");
  }
  return {
    agentId: a.agentId,
    name: a.name,
    templateKey: a.templateKey,
    department: a.departmentSlug,
    isTemporary: a.isTemporary,
    checks,
    eligible,
    score,
    scoreReasons,
    rejectedReason: eligible ? null : checks.find((c) => !c.passed)!.detail,
    approvalGates: gated,
  };
}

export function decideDelegation(req: DelegationRequest): DelegationDecisionDTO {
  const t = req.task;
  const r = req.requester;
  const explanation: string[] = [];
  const requiredPerms = requiredPermissionsFor(t);
  const estimate = t.estimatedCost ?? t.maxBudget ?? 0;

  /* budget */
  const budgetReasons: string[] = [];
  let budget: BudgetDecision = "allowed";
  if (t.maxBudget !== null && estimate > t.maxBudget) {
    budget = "blocked";
    budgetReasons.push(`Estimate $${estimate} exceeds the task budget $${t.maxBudget}`);
  }
  if (estimate > req.budget.companyDailyRemaining) {
    budget = "blocked";
    budgetReasons.push(
      `Estimate $${estimate} exceeds the company's remaining daily budget $${req.budget.companyDailyRemaining.toFixed(2)}`,
    );
  }
  const deptRemaining = t.departmentId ? req.budget.departmentRemaining[t.departmentId] : null;
  if (deptRemaining !== null && deptRemaining !== undefined && estimate > deptRemaining) {
    budget = "blocked";
    budgetReasons.push(
      `Estimate $${estimate} exceeds the department's remaining budget $${deptRemaining}`,
    );
  }
  if (budget === "allowed" && estimate > req.budget.highCostThresholdUsd) {
    budget = "requires_approval";
    budgetReasons.push(
      `High-cost task: $${estimate} is above the $${req.budget.highCostThresholdUsd} approval threshold`,
    );
  }
  if (!budgetReasons.length)
    budgetReasons.push(`Estimate $${estimate} within task, agent and company budgets`);
  const approvalRequired =
    budget === "requires_approval" || t.requiresApproval || t.externalActionAllowed;

  const duplicate = detectDuplicates(
    {
      id: t.id,
      companyId: t.companyId,
      title: t.title,
      type: t.type,
      targetEntity: t.targetEntity,
      departmentId: t.departmentId,
      ignoreIds: req.relatedTaskIds,
    },
    req.openTasks,
  );

  const base: Pick<
    DelegationDecisionDTO,
    | "requester"
    | "budget"
    | "approvalRequired"
    | "queued"
    | "duplicate"
    | "requiredCapabilities"
    | "requiredPermissions"
    | "temporaryWorker"
  > = {
    requester: { id: r.agentId, name: r.name },
    budget: { decision: budget, estimateUsd: estimate, reasons: budgetReasons },
    approvalRequired,
    queued: false,
    duplicate,
    requiredCapabilities: t.requiredCapabilities,
    requiredPermissions: requiredPerms,
    temporaryWorker: null,
  };

  const candidates = req.candidates
    .filter((a) => a.agentId !== r.agentId)
    .map((a) => evaluate(a, req, requiredPerms, estimate))
    .sort(
      (a, b) =>
        Number(b.eligible) - Number(a.eligible) ||
        b.score - a.score ||
        a.name.localeCompare(b.name),
    );
  const self = evaluate(r, { ...req, chain: [] }, requiredPerms, estimate);
  const selfCapable = self.eligible;
  const eligible = candidates.filter((c) => c.eligible);

  const teams = req.teams
    .filter((tm) => tm.active && (tm.companyId === null || tm.companyId === t.companyId))
    .map((tm) => {
      const members = eligible.filter((c) => tm.memberIds.includes(c.agentId)).length;
      const hasRoom = tm.activeTasks < tm.concurrencyLimit;
      return {
        id: tm.id,
        name: tm.name,
        eligibleMembers: members,
        available: members > 0 && hasRoom,
        reason: !hasRoom
          ? "Team at concurrency limit"
          : members
            ? `${members} eligible member(s)`
            : "No eligible members",
      };
    });

  const done = (
    d: Omit<DelegationDecisionDTO, keyof typeof base | "candidates" | "teams" | "explanation"> &
      Partial<typeof base>,
  ): DelegationDecisionDTO => ({
    ...base,
    ...d,
    candidates,
    teams,
    explanation,
  });

  /* 0. hard stops */
  if (!serves(r, t.companyId)) {
    explanation.push("BLOCKED: the requesting agent does not serve this company.");
    return done({ outcome: "blocked", target: null });
  }
  if (duplicate.level === "exact_duplicate") {
    const m = duplicate.matches[0]!;
    explanation.push(
      `BLOCKED: exact duplicate of active task "${m.title}" — reuse or attach to it instead of starting new work.`,
    );
    return done({ outcome: "blocked", target: null });
  }
  if (budget === "blocked") {
    explanation.push(`BLOCKED: ${budgetReasons.join("; ")}.`);
    return done({ outcome: "blocked", target: null });
  }
  if (duplicate.level === "likely_duplicate")
    explanation.push(
      `WARNING: likely duplicate of "${duplicate.matches[0]!.title}" — review before starting.`,
    );

  const g = req.concurrency.global;
  const co = req.concurrency.company;
  const queued = g.active >= g.limit || co.active >= co.limit;
  if (queued)
    explanation.push(
      g.active >= g.limit
        ? `QUEUED: global active-agent limit reached (${g.active}/${g.limit}); the task waits for capacity.`
        : `QUEUED: company concurrency limit reached (${co.active}/${co.limit}).`,
    );

  const depthLeft = Math.min(req.maxDepth, r.delegation.maxDepth) - t.delegationDepth;
  const canDelegate = t.delegationAllowed && r.delegation.mayDelegate && depthLeft > 0;
  if (!t.delegationAllowed) explanation.push("Delegation is not allowed for this task.");
  else if (!r.delegation.mayDelegate) explanation.push(`${r.name}'s role does not delegate.`);
  else if (depthLeft <= 0)
    explanation.push(
      `Delegation depth limit reached (${t.delegationDepth}/${Math.min(req.maxDepth, r.delegation.maxDepth)}).`,
    );

  const coordinator = r.capabilities.includes("management.coordinate");

  /* 1. handle self when capable and delegation adds nothing */
  if (selfCapable && (!canDelegate || !coordinator || eligible.length === 0)) {
    explanation.push(
      `HANDLE SELF: ${r.name} has the required capabilities, permissions and capacity${coordinator ? " and no specialist is needed" : ""} — routine work is not delegated.`,
    );
    return done({
      outcome: "handle_self",
      target: { kind: "self", id: r.agentId, name: r.name },
      queued,
    });
  }

  if (!canDelegate) {
    explanation.push(
      `REQUIRE HUMAN REVIEW: ${r.name} cannot complete the task (${self.rejectedReason ?? "not eligible"}) and may not delegate it.`,
    );
    return done({ outcome: "require_human_review", target: null, queued });
  }

  /* 2. team delegation for parallel / team-targeted work */
  const bigJob = t.parallelAllowed && (t.workItems ?? 0) >= req.policy.tempWorkerMinItems;
  const preferredTeam = teams.find((tm) => tm.id === t.preferredTeamId);
  const teamTarget = preferredTeam?.available
    ? preferredTeam
    : bigJob
      ? teams.find((tm) => tm.available && tm.eligibleMembers >= 2)
      : undefined;
  if (teamTarget) {
    explanation.push(
      `DELEGATE TO TEAM: ${teamTarget.name} (${teamTarget.reason})${preferredTeam ? " — preferred team" : " — parallel work across members"}.`,
    );
    return done({
      outcome: "delegate_to_team",
      target: { kind: "team", id: teamTarget.id, name: teamTarget.name },
      queued,
    });
  }

  /* 3. specialist delegation */
  const best = eligible[0];
  if (best) {
    explanation.push(
      `DELEGATE → ${best.name}: ${best.scoreReasons
        .filter((s) => !s.startsWith("-"))
        .map((s) => s.replace(/^\+\d+ /, ""))
        .join(", ")}.`,
    );
    for (const c of candidates.filter((x) => !x.eligible).slice(0, 5))
      explanation.push(`REJECTED ${c.name}: ${c.rejectedReason}.`);
    return done({
      outcome: "delegate_to_agent",
      target: { kind: "agent", id: best.agentId, name: best.name },
      queued,
      approvalRequired: approvalRequired || best.approvalGates.length > 0,
    });
  }

  /* 4. temporary worker when no permanent agent is eligible */
  const tempGrant = r.permissions["action.create_temp_worker"] ?? "deny";
  const mayCreateTemp =
    tempGrant !== "deny" &&
    (!r.isTemporary || r.maySpawnTemporary) &&
    req.policy.activeTempAgents < req.policy.maxTempAgents;
  if (
    mayCreateTemp &&
    (bigJob ||
      t.requiredCapabilities.every(
        (c) => r.capabilities.includes(c) || req.candidates.some((a) => a.capabilities.includes(c)),
      ))
  ) {
    const perms = requiredPerms.filter((p) => (r.permissions[p] ?? "deny") !== "deny");
    const budgetUsd = Math.min(estimate || r.perTaskBudget, r.perTaskBudget);
    const needsApproval =
      tempGrant === "require_approval" || budgetUsd > req.budget.tempAgentApprovalBudgetUsd;
    explanation.push(
      `CREATE TEMPORARY WORKER: no permanent agent is eligible (${candidates[0]?.rejectedReason ?? "no candidates"}); a task-bound worker inherits ${r.name}'s company and limits${needsApproval ? " — approval required" : ""}.`,
    );
    return done({
      outcome: "create_temporary_worker",
      target: { kind: "temporary", id: null, name: `${r.name} temporary worker` },
      queued,
      approvalRequired: approvalRequired || needsApproval,
      temporaryWorker: {
        capabilities: t.requiredCapabilities,
        permissions: perms,
        budgetUsd,
        expiresInHours: 72,
      },
    });
  }

  if (selfCapable) {
    explanation.push(
      `HANDLE SELF: no eligible specialist; ${r.name} can complete it within limits.`,
    );
    return done({
      outcome: "handle_self",
      target: { kind: "self", id: r.agentId, name: r.name },
      queued,
    });
  }
  for (const c of candidates.slice(0, 5))
    explanation.push(`REJECTED ${c.name}: ${c.rejectedReason}.`);
  explanation.push("REQUIRE HUMAN REVIEW: no eligible agent, team or temporary worker.");
  return done({ outcome: "require_human_review", target: null, queued });
}
