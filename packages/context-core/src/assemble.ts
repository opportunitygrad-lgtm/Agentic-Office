import { getAgentPermission } from "@aibos/access-core";
import {
  AI_POLICY_MODE_LABELS,
  AUTONOMY_LABELS,
  CONTEXT_BUDGET_CHARS,
  CONTEXT_VERSION,
  KNOWLEDGE_SOURCE_LABELS,
  knowledgeFreshness,
  knowledgePrecedence,
  sensitivityRank,
  type AgentContextPack,
  type ContextExclusion,
  type ContextKnowledgeEntry,
  type ContextRuleEntry,
  type ExclusionReason,
  type InclusionReason,
  type TaskType,
} from "@aibos/shared";
import { RELEVANCE_THRESHOLD, keywords, scoreKnowledge, type RelevanceSignals } from "./relevance";
import {
  actionDomain,
  agentChannels,
  agentDomains,
  agentMaxSensitivity,
  isRestrictiveRule,
  ruleDetail,
} from "./rules";
import {
  estimateTokens,
  renderContextPack,
  renderKnowledge,
  renderLine,
  renderRule,
} from "./render";
import type { ContextRequest, ContextSources, KnowledgeCandidate, RuleCandidate } from "./types";

export class ContextIsolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContextIsolationError";
  }
}

/** Budget priorities: lower is kept first. Mandatory content is never dropped. */
export const PRIORITY = {
  mandatory: 0,
  companyDetail: 30,
  requiredRule: 35,
  linkedKnowledge: 40,
  agentLinkedKnowledge: 41,
  verifiedKnowledge: 50,
  otherKnowledge: 60,
  unverified: 70,
  infoRule: 80,
} as const;

const SNIPPET_CHARS = { small: 280, standard: 600, large: 1500 } as const;

const EXPECTED_OUTPUT: Record<TaskType, string> = {
  management: "A decision-ready summary with recommended next actions and owners.",
  research: "Structured findings, each with its source and verification status.",
  verification: "A verification result per claim: confirmed / not confirmed, with evidence.",
  email: "A draft email for human review. Do not send.",
  marketing: "A marketing proposal that follows the brand and claims rules.",
  advertising: "A campaign proposal or change request; spending needs approval.",
  analysis: "An analysis with the data used and the conclusions drawn.",
  technical: "A technical plan or change set with risks and rollback notes.",
  website: "Proposed website changes for review before publishing.",
  sales: "A qualified next step for the lead, within pricing and discount rules.",
  review: "A review verdict with issues ranked by severity.",
  custom: "The requested output, citing the knowledge used.",
};

function snippetOf(item: KnowledgeCandidate, max: number): string {
  const base = (item.summary?.trim() || item.content.trim()).replace(/\s+/g, " ");
  return base.length > max ? `${base.slice(0, max - 1).trimEnd()}…` : base;
}

interface Droppable {
  priority: number;
  score: number;
  chars: number;
  commit: () => void;
  drop: () => void;
}

/**
 * Builds an Agent Context Pack — deterministic, provider-independent.
 *
 * Isolation: only knowledge/rules of `request.companyId` or explicitly GLOBAL
 * scope can enter the pack. Anything else (even if linked to the task) is
 * blocked and reported without revealing its title.
 */
export function assembleContextPack(
  request: ContextRequest,
  src: ContextSources,
): AgentContextPack {
  const companyId = request.companyId;
  if (src.company.id !== companyId)
    throw new ContextIsolationError("Company snapshot does not match the request");
  if (src.agent.id !== request.agentId)
    throw new ContextIsolationError("Agent snapshot does not match the request");
  if (src.task && src.task.companyId !== companyId)
    throw new ContextIsolationError("Task belongs to a different company");

  const budget = request.budget ?? "standard";
  const maxChars =
    budget === "custom"
      ? Math.max(1_000, request.maxChars ?? CONTEXT_BUDGET_CHARS.standard)
      : CONTEXT_BUDGET_CHARS[budget];
  const snippetMax =
    SNIPPET_CHARS[
      budget === "custom"
        ? maxChars >= 30_000
          ? "large"
          : maxChars >= 12_000
            ? "standard"
            : "small"
        : budget
    ];
  const allowUnverified = request.allowUnverified ?? src.task?.allowUnverifiedContext ?? false;
  const staleExcluded = src.aiPolicy.staleKnowledgePolicy === "exclude";
  const now = src.now;

  const excluded: ContextExclusion[] = [];
  const warnings: string[] = [];
  let blockedCrossCompany = 0;
  let droppedForBudget = 0;
  let staleCount = 0;

  /* ---------- agent authority ---------- */
  const authority = src.agent.authority;
  const allowed = authority.filter((a) => a.decision === "allow").map((a) => a.permission);
  const approvalRequired = authority
    .filter((a) => a.decision === "require_approval")
    .map((a) => a.permission);
  const denied = authority.filter((a) => a.decision === "deny").map((a) => a.permission);
  const domains = agentDomains(authority, src.task?.type ?? null);
  const channels = agentChannels(domains);

  const prohibitedActions: AgentContextPack["prohibitedActions"] = [];
  const requiredApprovals: AgentContextPack["requiredApprovals"] = [];
  for (const a of authority) {
    if (a.grant === "deny")
      prohibitedActions.push({
        action: `${a.label} (${a.permission})`,
        source: "Agent permission: explicit deny",
      });
    if (a.decision === "require_approval")
      requiredApprovals.push({
        action: `${a.label} (${a.permission})`,
        requirement: `Human approval${a.approvalType ? ` — ${a.approvalType}` : ""}`,
        source: "Agent authority",
      });
  }
  const notGranted = authority.filter((a) => a.decision === "deny" && a.grant !== "deny");
  if (notGranted.length)
    prohibitedActions.push({
      action: `Not permitted: ${notGranted.map((a) => a.permission).join(", ")}`,
      source: "Agent permissions (default deny)",
    });
  for (const p of src.agent.prohibitedActions)
    prohibitedActions.push({ action: p, source: "Agent configuration" });

  const policy = src.aiPolicy;
  const policyModes: [string, typeof policy.deepResearchPolicy][] = [
    ["Deep research", policy.deepResearchPolicy],
    ["External actions", policy.externalActionPolicy],
    ["Browser use", policy.browserPolicy],
    ["Email auto-send", policy.autoSendPolicy],
  ];
  for (const [label, mode] of policyModes) {
    if (mode === "disabled")
      prohibitedActions.push({ action: label, source: "Company AI policy: disabled" });
    if (mode === "approval_required")
      requiredApprovals.push({
        action: label,
        requirement: "Human approval",
        source: "Company AI policy",
      });
  }
  const aiPolicyLines = [
    ...policyModes.map(([label, mode]) => ({ label, value: AI_POLICY_MODE_LABELS[mode] })),
    { label: "Allowed providers", value: policy.allowedProviders.join(", ") },
    {
      label: "Research limit",
      value: `${Math.min(policy.defaultResearchLimit, src.agent.maxSearches)} external searches per task`,
    },
    ...policy.customRules.map((r) => ({ label: "Company AI rule", value: r })),
  ];

  /* ---------- rules ---------- */
  const brand: ContextRuleEntry[] = [];
  const commercial: ContextRuleEntry[] = [];
  const compliance: ContextRuleEntry[] = [];
  const droppables: Droppable[] = [];
  const target = (r: RuleCandidate) =>
    r.kind === "brand" ? brand : r.kind === "commercial" ? commercial : compliance;

  for (const r of src.rules) {
    if (r.companyId !== null && r.companyId !== companyId) {
      blockedCrossCompany++;
      excluded.push({
        id: r.id,
        title: null,
        kind: "rule",
        reason: "other_company",
        detail: "Belongs to another company",
      });
      continue;
    }
    if (!r.active || r.status !== "approved") {
      excluded.push({
        id: r.id,
        title: r.title,
        kind: "rule",
        reason: "inactive_rule",
        detail: !r.active ? "Rule is inactive" : `Rule is ${r.status}`,
      });
      continue;
    }
    const reasons: InclusionReason[] = [];
    if (r.severity === "critical") reasons.push("critical_rule");
    if (r.kind === "brand") {
      if (src.profile.brandCategories.includes(r.category)) reasons.push("required_by_agent");
      if (r.channel !== "all" && channels.has(r.channel)) reasons.push("agent_channel");
    } else if (r.kind === "commercial") {
      if (src.profile.commercialCategories.includes(r.category)) reasons.push("required_by_agent");
      if (domains.has(actionDomain(r.appliesTo))) reasons.push("agent_domain");
    } else {
      if (r.action === "*") reasons.push("company_wide_rule");
      else if (domains.has(actionDomain(r.action))) reasons.push("agent_domain");
    }
    if (r.companyId === null && !reasons.includes("critical_rule") && reasons.length)
      reasons.push("global_policy");
    if (!reasons.length) {
      excluded.push({
        id: r.id,
        title: r.title,
        kind: "rule",
        reason: "not_relevant",
        detail: "Not relevant to this agent or task",
      });
      continue;
    }
    const mandatory = r.severity === "critical" || isRestrictiveRule(r);
    if (mandatory && !reasons.includes("critical_rule")) reasons.unshift("restriction");
    const entry: ContextRuleEntry = {
      id: r.id,
      kind: r.kind,
      title: r.title,
      description: r.description,
      severity: r.severity,
      category: r.kind === "compliance" ? r.action : r.category,
      detail: ruleDetail(r),
      global: r.companyId === null,
      mandatory,
      reasons,
    };
    if (r.kind === "commercial" && (r.effect === "require_approval" || r.effect === "limit"))
      requiredApprovals.push({
        action: r.appliesTo,
        requirement: entry.detail ?? "Human approval",
        source: `Commercial rule: ${r.title}`,
      });
    if (r.kind === "compliance" && r.effect === "require_approval")
      requiredApprovals.push({
        action: r.action,
        requirement: entry.detail ?? "Human approval",
        source: `Compliance rule: ${r.title}`,
      });
    if ((r.kind === "commercial" || r.kind === "compliance") && r.effect === "prohibit")
      prohibitedActions.push({
        action: r.kind === "commercial" ? r.appliesTo : r.action,
        source: `${r.kind === "commercial" ? "Commercial" : "Compliance"} rule: ${r.title}`,
      });

    if (mandatory) {
      target(r).push(entry);
      continue;
    }
    droppables.push({
      priority: r.severity === "required" ? PRIORITY.requiredRule : PRIORITY.infoRule,
      score: 0,
      chars: renderRule(entry).length,
      commit: () => target(r).push(entry),
      drop: () => {
        droppedForBudget++;
        excluded.push({
          id: r.id,
          title: r.title,
          kind: "rule",
          reason: "budget",
          detail: "Dropped to fit the context budget",
        });
      },
    });
  }

  /* ---------- knowledge ---------- */
  const taskLinked = new Set(
    src.links.filter((l) => l.target === "task").map((l) => l.knowledgeId),
  );
  const agentLinked = new Set(
    src.links.filter((l) => l.target === "agent").map((l) => l.knowledgeId),
  );
  const signals: RelevanceSignals = {
    profile: src.profile,
    agentDepartmentId: src.agent.departmentId,
    taskType: src.task?.type ?? null,
    taskKeywords: keywords(
      [src.task?.title, src.task?.description, request.capability?.replace(/_/g, " ")]
        .filter(Boolean)
        .join(" "),
    ),
    requestedCategories: request.categories ?? [],
    taskLinked,
    agentLinked,
    explicitIds: new Set(request.explicitKnowledgeIds ?? []),
  };
  const maxSensitivity = agentMaxSensitivity(src.agent, src.accessPolicies);
  const knowledge: ContextKnowledgeEntry[] = [];
  const unverified: ContextKnowledgeEntry[] = [];

  const STATUS_EXCLUSION: Partial<Record<string, ExclusionReason>> = {
    draft: "draft",
    review: "in_review",
    archived: "archived",
    superseded: "superseded",
  };

  for (const item of src.knowledge) {
    const isGlobal = item.scope === "global" && item.companyId === null;
    if (!isGlobal && item.companyId !== companyId) {
      blockedCrossCompany++;
      excluded.push({
        id: item.id,
        title: null,
        kind: "knowledge",
        reason: "other_company",
        detail: "Belongs to another company — never shared",
      });
      continue;
    }
    const exclude = (reason: ExclusionReason, detail: string, title: string | null = item.title) =>
      excluded.push({ id: item.id, title, kind: "knowledge", reason, detail });

    const researchDraft =
      (item.status === "draft" || item.status === "review") && item.usableAsUnverified;
    if (item.status !== "approved" && !(researchDraft && allowUnverified)) {
      const reason = STATUS_EXCLUSION[item.status] ?? "draft";
      exclude(
        reason,
        researchDraft
          ? "Unverified research is not allowed for this task"
          : `Knowledge is ${item.status}, not approved`,
      );
      continue;
    }
    const freshness = knowledgeFreshness(item, now);
    if (freshness === "not_yet_effective") {
      exclude("not_yet_effective", "Not yet effective");
      continue;
    }
    if (freshness === "expired" && staleExcluded) {
      exclude("expired", "Expired — excluded by company stale-knowledge policy");
      continue;
    }
    if (sensitivityRank(item.sensitivity) > sensitivityRank(maxSensitivity)) {
      exclude(
        "sensitivity",
        `${item.sensitivity.toUpperCase()} knowledge — agent has no access policy for it`,
      );
      continue;
    }
    const rel = scoreKnowledge(item, signals);
    if (!rel.explicit && rel.score < RELEVANCE_THRESHOLD) {
      exclude("not_relevant", "Not relevant to this agent or task");
      continue;
    }
    const itemWarnings: string[] = [];
    if (freshness === "expired") {
      staleCount++;
      itemWarnings.push("STALE — expired, do not present as current");
    }
    if (freshness === "review_due") {
      staleCount++;
      itemWarnings.push("Review overdue");
    }
    const isUnverified = item.status !== "approved";
    if (isUnverified) {
      rel.reasons.push("unverified_allowed");
      itemWarnings.push("UNVERIFIED — not an approved company fact");
    }
    const precedence = knowledgePrecedence(item);
    const verified =
      item.verificationStatus === "verified" || item.verificationStatus === "management_confirmed";
    const priority = isUnverified
      ? PRIORITY.unverified
      : rel.reasons.includes("task_link") || rel.reasons.includes("explicit_request")
        ? PRIORITY.linkedKnowledge
        : rel.reasons.includes("agent_link")
          ? PRIORITY.agentLinkedKnowledge
          : verified && freshness === "current"
            ? PRIORITY.verifiedKnowledge
            : PRIORITY.otherKnowledge;

    const entry: ContextKnowledgeEntry = {
      id: item.id,
      title: item.title,
      type: item.type,
      source: item.sourceReference ?? KNOWLEDGE_SOURCE_LABELS[item.sourceType],
      sourceType: item.sourceType,
      verificationStatus: item.verificationStatus,
      lastVerifiedAt: item.lastVerifiedAt?.toISOString() ?? null,
      snippet: snippetOf(item, snippetMax),
      precedenceTier: precedence.tier,
      freshness,
      sensitivity: item.sensitivity,
      global: isGlobal,
      section: isUnverified ? "unverified" : "knowledge",
      priority,
      score: rel.score,
      reasons: rel.reasons,
      reasonDetails: rel.details,
      warnings: itemWarnings,
      chars: 0,
    };
    entry.chars = renderKnowledge(entry).length;
    droppables.push({
      priority,
      // Higher authority (lower tier) and fresher items win ties.
      score: rel.score * 10 - precedence.tier + item.updatedAt.getTime() / 1e13,
      chars: entry.chars,
      commit: () => (isUnverified ? unverified : knowledge).push(entry),
      drop: () => {
        droppedForBudget++;
        exclude("budget", "Dropped to fit the context budget (lower priority)");
      },
    });
  }

  /* ---------- task & company ---------- */
  const t = src.task;
  const task: AgentContextPack["task"] = t
    ? {
        id: t.id,
        title: t.title,
        objective: t.description,
        type: t.type,
        priority: t.priority,
        status: t.status,
        parent: t.parent,
        root: t.root,
        expectedOutput: EXPECTED_OUTPUT[t.type],
      }
    : null;

  const pack: AgentContextPack = {
    version: CONTEXT_VERSION,
    request: {
      companyId,
      agentId: request.agentId,
      taskId: t?.id ?? null,
      capability: request.capability ?? null,
      budget,
      maxChars,
      categories: request.categories ?? [],
      explicitKnowledgeIds: request.explicitKnowledgeIds ?? [],
      allowUnverified,
    },
    agent: {
      id: src.agent.id,
      name: src.agent.name,
      templateKey: src.agent.templateKey,
      department: src.agent.departmentName,
      reportsTo: src.agent.reportsTo,
      autonomyLevel: src.agent.autonomyLevel,
      autonomyLabel: AUTONOMY_LABELS[src.agent.autonomyLevel],
      allowed,
      approvalRequired,
      denied,
    },
    company: {
      id: src.company.id,
      name: src.company.name,
      lines: src.company.core,
      extended: src.company.extended,
      extendedIncluded: false,
    },
    task,
    rules: { brand, commercial, compliance, aiPolicy: aiPolicyLines },
    knowledge,
    unverified,
    prohibitedActions,
    requiredApprovals,
    excluded,
    warnings,
    metadata: {
      generatedAt: now.toISOString(),
      contextVersion: CONTEXT_VERSION,
      approxChars: 0,
      approxTokens: 0,
      budgetChars: maxChars,
      overBudget: false,
      includedKnowledgeIds: [],
      excludedCount: 0,
      staleCount: 0,
      droppedForBudget: 0,
      blockedCrossCompany: 0,
    },
  };

  if (src.company.extended.length)
    droppables.push({
      priority: PRIORITY.companyDetail,
      score: 0,
      chars: src.company.extended.reduce((n, l) => n + renderLine(l.label, l.value).length, 0),
      commit: () => (pack.company.extendedIncluded = true),
      drop: () => {
        droppedForBudget++;
        warnings.push("Company business detail omitted to fit the context budget.");
      },
    });

  /* ---------- budget: mandatory first, then droppables by priority ---------- */
  let used = renderContextPack(pack).length;
  if (used > maxChars) {
    pack.metadata.overBudget = true;
    warnings.push(
      "Mandatory rules, permissions and task exceed the budget; nothing mandatory was dropped.",
    );
  }
  droppables.sort((a, b) => a.priority - b.priority || b.score - a.score);
  let full = false;
  for (const d of droppables) {
    // Stop adding once a higher-priority item did not fit: lower priorities are dropped first.
    if (!full && used + d.chars <= maxChars) {
      d.commit();
      used += d.chars;
    } else {
      full = true;
      d.drop();
    }
  }

  /* ---------- conflicts among included knowledge ---------- */
  const byKey = new Map<string, ContextKnowledgeEntry[]>();
  const conflictKeyOf = new Map(src.knowledge.map((k) => [k.id, k] as const));
  for (const e of [...knowledge, ...unverified]) {
    const src2 = conflictKeyOf.get(e.id);
    if (!src2?.conflictKey) continue;
    byKey.set(src2.conflictKey, [...(byKey.get(src2.conflictKey) ?? []), e]);
  }
  for (const [key, list] of byKey) {
    const lineages = new Set(list.map((e) => conflictKeyOf.get(e.id)!.lineageId));
    if (lineages.size < 2) continue;
    for (const e of list) e.warnings.push(`POTENTIAL CONFLICT (${key}) — escalate to a human`);
    warnings.push(
      `Potential conflict on "${key}" between ${list.length} items — do not choose; ask a human.`,
    );
  }

  const rendered = renderContextPack(pack);
  pack.metadata = {
    ...pack.metadata,
    approxChars: rendered.length,
    approxTokens: estimateTokens(rendered.length),
    overBudget: pack.metadata.overBudget || rendered.length > maxChars,
    includedKnowledgeIds: [...knowledge, ...unverified].map((k) => k.id),
    excludedCount: excluded.length,
    staleCount,
    droppedForBudget,
    blockedCrossCompany,
  };
  return pack;
}

/** Convenience for the UI / docs: the agent permission label for a key. */
export const permissionLabel = (key: string): string => getAgentPermission(key)?.label ?? key;
