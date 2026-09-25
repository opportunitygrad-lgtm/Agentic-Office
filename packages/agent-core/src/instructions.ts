import {
  INSTRUCTION_LAYERS,
  INSTRUCTION_LAYER_LABELS,
  type AgentRole,
  type CompiledAgentInstructionPack,
  type InstructionConflictDTO,
  type InstructionLayerKey,
  type InstructionRuleDTO,
  type ProviderType,
} from "@aibos/shared";
import { GLOBAL_DEFAULTS, GLOBAL_OPERATING_POLICY, PLATFORM_SAFETY_RULES } from "./policy";

/**
 * Deterministic instruction compiler. Produces a provider-neutral
 * `CompiledAgentInstructionPack` from the instruction stack:
 *
 *   1 platform safety → 2 global policy → 3 company rules / AI policy →
 *   4 department → 5 role template → 6 agent role → 7 task → 8 task notes
 *
 * Lower layers ADD rules; they can never remove or loosen higher ones:
 *  - limits combine by "stricter wins" (min searches/retries/budget, weakest
 *    deep-research / delegation mode);
 *  - duplicates of higher rules are folded into the higher rule;
 *  - lower-layer text that tries to override/ignore rules is rejected;
 *  - the permission engine (authority) always beats instructions.
 * No AI provider is called.
 */

export const INSTRUCTION_PACK_VERSION = "instr-1";

type Mode = "disabled" | "approval_required" | "allowed";

export interface InstructionSources {
  now: Date;
  agent: {
    id: string;
    name: string;
    templateKey: string;
    companyId: string;
    companyName: string;
    departmentName: string | null;
    reportsTo: string | null;
    autonomyLevel: string;
    maxExternalSearches: number;
    maxRetries: number;
    perTaskBudget: number;
    providers: ProviderType[];
  };
  company: {
    aiPolicy: {
      deepResearchPolicy: Mode;
      externalActionPolicy: Mode;
      browserPolicy: Mode;
      autoSendPolicy: Mode;
      defaultResearchLimit: number;
      allowedProviders: ProviderType[];
      customRules: string[];
    };
    companyRules: string[];
    prohibitedClaims: string[];
    criticalRules: { id: string; title: string; description: string }[];
  };
  department: { name: string; mission: string | null; instructions: string[] } | null;
  template: { key: string; name: string; role: AgentRole; companySpecific: boolean };
  agentRole: { role: AgentRole; version: number } | null;
  task: {
    id: string;
    title: string;
    description: string | null;
    stoppingCondition: string | null;
    resultSchema: string | null;
    expectedOutcome: string | null;
    maxBudget: number | null;
    externalActionAllowed: boolean;
    notes: string[];
  } | null;
  authority: { permission: string; decision: "allow" | "require_approval" | "deny" }[];
  context: { contextVersion: string; approxTokens: number; includedKnowledgeIds: string[] } | null;
  maxDelegationDepth: number;
}

const PRIORITY = Object.fromEntries(INSTRUCTION_LAYERS.map((l, i) => [l, i + 1])) as Record<
  InstructionLayerKey,
  number
>;

/** Lower-layer text that tries to switch off higher rules is never accepted. */
const OVERRIDE_PATTERN =
  /\b(ignore|override|disregard|bypass|skip|circumvent)\b[^.]{0,60}\b(policy|policies|rules?|approvals?|permissions?|instructions?|limits?|safety)\b/i;

/** Prohibitions ("Never: bypass approvals") restate rules; they are not override attempts. */
const NEGATED = /^(never|do not|don't|must not|not your job|never access)\b/i;
const isOverrideAttempt = (text: string) => !NEGATED.test(text) && OVERRIDE_PATTERN.test(text);

const normalise = (t: string) =>
  t
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const DEEP_RANK = { never: 0, approval: 1, allowed: 2 } as const;
const MODE_TO_DEEP: Record<Mode, keyof typeof DEEP_RANK> = {
  disabled: "never",
  approval_required: "approval",
  allowed: "allowed",
};

interface Draft extends Omit<InstructionRuleDTO, "priority" | "id"> {
  /** Settings are summarised in EFFECTIVE LIMITS rather than repeated in the text. */
  setting?: boolean;
}

function roleRules(
  role: AgentRole,
  layer: InstructionLayerKey,
  source: string,
  reason: string,
): Draft[] {
  const out: Draft[] = [];
  const add = (category: string, text: string, setting = false) =>
    out.push({ layer, category, text, source, reason, locked: false, setting });
  add("identity", `Role: ${role.identity.roleName} — ${role.identity.mission}`);
  role.responsibilities.primary.forEach((r) =>
    add("responsibility", `Primary responsibility: ${r}`),
  );
  role.responsibilities.secondary.forEach((r) =>
    add("responsibility", `Secondary responsibility: ${r}`),
  );
  role.behaviours.workflow.forEach((r) => add("workflow", `Workflow: ${r}`));
  role.behaviours.requiredChecks.forEach((r) => add("check", `Always: ${r}`));
  role.behaviours.requiredContext.forEach((r) => add("context", `Required context: ${r}`));
  role.prohibited.actions.forEach((r) => add("prohibited", `Never: ${r}`));
  role.prohibited.belongsElsewhere.forEach((r) => add("prohibited", `Not your job: ${r}`));
  role.prohibited.dataNotAccessed.forEach((r) => add("prohibited", `Never access: ${r}`));
  add(
    "delegation",
    role.delegation.mayDelegate
      ? `May delegate (max depth ${role.delegation.maxDepth}${
          role.delegation.allowedDepartments.length
            ? `; departments: ${role.delegation.allowedDepartments.join(", ")}`
            : ""
        })`
      : "Do not delegate: handle the work yourself or escalate",
    true,
  );
  role.delegation.conditions.forEach((r) => add("delegation", `Delegate when: ${r}`));
  role.handoff.destinations.forEach((h) =>
    add(
      "handoff",
      `Hand off to ${h.department} when ${h.when}; include ${h.requiredFields.join(", ")}${
        h.stopAfterHandoff ? "; stop after handoff" : ""
      }${h.continueMonitoring ? "; keep monitoring" : ""}`,
    ),
  );
  add(
    "research",
    `Research limits: ${role.research.maxSearches ?? "no role limit"} searches, ${role.research.maxRetries} retries, deep research ${role.research.deepResearch}`,
    true,
  );
  if (role.research.stopCondition) add("research", `Research stop: ${role.research.stopCondition}`);
  if (role.cost.maxTaskBudget !== null)
    add("cost", `Task budget cap: $${role.cost.maxTaskBudget}`, true);
  if (role.cost.escalationThreshold !== null)
    add(
      "cost",
      `Escalate to a human when estimated cost exceeds $${role.cost.escalationThreshold}`,
    );
  role.completion.definitionOfDone.forEach((r) => add("completion", `Done when: ${r}`));
  role.completion.stopConditions.forEach((r) => add("completion", `Stop when: ${r}`));
  if (role.completion.resultFormat)
    add("completion", `Result format: ${role.completion.resultFormat}`);
  if (role.freeText) add("free_text", role.freeText);
  return out;
}

export function compileAgentInstructions(src: InstructionSources): CompiledAgentInstructionPack {
  const drafts: Draft[] = [];
  const conflicts: InstructionConflictDTO[] = [];
  const conflict = (c: Omit<InstructionConflictDTO, "id">) =>
    conflicts.push({ ...c, id: `conflict-${conflicts.length + 1}` });

  /* 1–2: locked platform + global policy */
  for (const r of [...PLATFORM_SAFETY_RULES, ...GLOBAL_OPERATING_POLICY])
    drafts.push({
      layer: r.layer,
      category: r.category,
      text: r.text,
      source: r.layer === "platform" ? "Platform safety" : "Global operating policy",
      reason: "Applies to every agent in every company",
      locked: true,
    });

  /* 3: company */
  const c = src.company;
  const companySource = `${src.agent.companyName} company policy`;
  for (const r of c.criticalRules)
    drafts.push({
      layer: "company",
      category: "critical_rule",
      text: `${r.title}: ${r.description}`,
      source: companySource,
      reason: "Critical company rule",
      locked: true,
    });
  for (const r of c.companyRules)
    drafts.push({
      layer: "company",
      category: "rule",
      text: r,
      source: companySource,
      reason: "Company rule",
      locked: false,
    });
  if (c.prohibitedClaims.length)
    drafts.push({
      layer: "company",
      category: "claims",
      text: `Never claim: ${c.prohibitedClaims.join("; ")}`,
      source: companySource,
      reason: "Company prohibited claims",
      locked: true,
    });
  const modeText = (m: Mode) => (m === "approval_required" ? "requires human approval" : m);
  drafts.push(
    {
      layer: "company",
      category: "ai_policy",
      text: `Deep research ${modeText(c.aiPolicy.deepResearchPolicy)}`,
      source: `${src.agent.companyName} AI policy`,
      reason: "Company AI policy",
      locked: true,
      setting: true,
    },
    {
      layer: "company",
      category: "ai_policy",
      text: `External actions ${modeText(c.aiPolicy.externalActionPolicy)}`,
      source: `${src.agent.companyName} AI policy`,
      reason: "Company AI policy",
      locked: true,
      setting: true,
    },
    {
      layer: "company",
      category: "ai_policy",
      text: `Browser use ${modeText(c.aiPolicy.browserPolicy)}; email auto-send ${modeText(c.aiPolicy.autoSendPolicy)}`,
      source: `${src.agent.companyName} AI policy`,
      reason: "Company AI policy",
      locked: true,
    },
    {
      layer: "company",
      category: "research",
      text: `Company research limit: ${c.aiPolicy.defaultResearchLimit} searches per task`,
      source: `${src.agent.companyName} AI policy`,
      reason: "Company AI policy",
      locked: true,
      setting: true,
    },
  );
  for (const r of c.aiPolicy.customRules)
    drafts.push({
      layer: "company",
      category: "ai_rule",
      text: r,
      source: `${src.agent.companyName} AI policy`,
      reason: "Company-specific AI rule",
      locked: false,
    });

  /* 4: department */
  if (src.department) {
    const d = src.department;
    if (d.mission)
      drafts.push({
        layer: "department",
        category: "mission",
        text: `Department mission (${d.name}): ${d.mission}`,
        source: `${d.name} department`,
        reason: "Agent belongs to this department",
        locked: false,
      });
    for (const r of d.instructions)
      drafts.push({
        layer: "department",
        category: "rule",
        text: r,
        source: `${d.name} department`,
        reason: "Department instruction",
        locked: false,
      });
  }

  /* 5–6: template + agent role */
  const tplSource = src.template.companySpecific
    ? `${src.template.name} (company role template)`
    : `${src.template.name} template`;
  drafts.push(...roleRules(src.template.role, "template", tplSource, "Agent's role template"));
  if (src.agentRole)
    drafts.push(
      ...roleRules(
        src.agentRole.role,
        "agent",
        `${src.agent.name} role v${src.agentRole.version}`,
        "Agent-specific role",
      ),
    );

  /* 7–8: task */
  const t = src.task;
  if (t) {
    const add = (layer: InstructionLayerKey, category: string, text: string) =>
      drafts.push({
        layer,
        category,
        text,
        source: `Task "${t.title}"`,
        reason: "Current task",
        locked: false,
      });
    add("task", "objective", `Objective: ${t.title}${t.description ? ` — ${t.description}` : ""}`);
    if (t.expectedOutcome)
      add("task", "outcome", `Expected business outcome: ${t.expectedOutcome}`);
    if (t.stoppingCondition) add("task", "completion", `Stop when: ${t.stoppingCondition}`);
    if (t.resultSchema) add("task", "completion", `Result format: ${t.resultSchema}`);
    for (const n of t.notes) add("task_note", "note", n);
  }

  /* ---------- dedupe + reject overrides (highest layer wins) ---------- */
  drafts.sort((a, b) => PRIORITY[a.layer] - PRIORITY[b.layer]);
  const seen = new Map<string, string>();
  const rules: (InstructionRuleDTO & { setting?: boolean })[] = [];
  let duplicatesRemoved = 0;
  let rejectedCount = 0;
  drafts.forEach((d, i) => {
    const id = `${d.layer}-${i + 1}`;
    const rule: InstructionRuleDTO & { setting?: boolean } = {
      ...d,
      id,
      priority: PRIORITY[d.layer],
    };
    if (PRIORITY[d.layer] > PRIORITY.global && isOverrideAttempt(d.text)) {
      rule.rejected = "Attempts to override higher-priority rules — rejected";
      rejectedCount++;
      conflict({
        category: "override_attempt",
        requested: { layer: d.layer, text: d.text },
        winner: { layer: "platform", text: PLATFORM_SAFETY_RULES[2]!.text },
        resolution:
          "CONFLICT RESOLVED: lower-layer instruction tried to override higher rules; platform safety wins.",
      });
    } else {
      const key = normalise(d.text);
      const prior = seen.get(key);
      if (prior) {
        rule.duplicateOf = prior;
        duplicatesRemoved++;
      } else seen.set(key, id);
    }
    rules.push(rule);
  });

  /* ---------- effective settings: stricter always wins ---------- */
  const tpl = src.template.role;
  const ag = src.agentRole?.role ?? null;

  const searchCandidates: [number, InstructionLayerKey | "authority", string][] = [
    [GLOBAL_DEFAULTS.maxSearchesCeiling, "global", "Global search ceiling"],
    [c.aiPolicy.defaultResearchLimit, "company", "Company research limit"],
    [src.agent.maxExternalSearches, "company", "Agent search budget"],
  ];
  if (tpl.research.maxSearches !== null)
    searchCandidates.push([tpl.research.maxSearches, "template", "Template limit"]);
  const maxSearches = Math.min(...searchCandidates.map((x) => x[0]));
  for (const [role, layer] of [
    [tpl, "template"],
    [ag, "agent"],
  ] as const) {
    if (!role) continue;
    const req = role.research.maxSearches;
    if (req === null || req > maxSearches) {
      const winner = searchCandidates.reduce((a, b) => (b[0] < a[0] ? b : a));
      conflict({
        category: "research_limit",
        requested: { layer, text: req === null ? "No research limit" : `Up to ${req} searches` },
        winner: { layer: winner[1], text: `${winner[2]}: ${winner[0]}` },
        resolution: `CONFLICT RESOLVED: ${layer} role asked for ${req === null ? "no limit" : req}; ${winner[2].toLowerCase()} (${winner[0]}) wins.`,
      });
    }
  }
  const effectiveSearches = Math.min(maxSearches, ag?.research.maxSearches ?? Infinity);

  const retryCaps = [GLOBAL_DEFAULTS.maxRetries, src.agent.maxRetries, tpl.research.maxRetries];
  const maxRetries = Math.min(...retryCaps, ag?.research.maxRetries ?? Infinity);
  for (const [role, layer] of [
    [tpl, "template"],
    [ag, "agent"],
  ] as const)
    if (role && role.research.maxRetries > GLOBAL_DEFAULTS.maxRetries)
      conflict({
        category: "retries",
        requested: { layer, text: `${role.research.maxRetries} retries` },
        winner: { layer: "global", text: "Retry at most once by default." },
        resolution: `CONFLICT RESOLVED: ${layer} role asked for ${role.research.maxRetries} retries; global policy caps retries at ${GLOBAL_DEFAULTS.maxRetries}.`,
      });

  const companyDeep = MODE_TO_DEEP[c.aiPolicy.deepResearchPolicy];
  const deepModes = [
    companyDeep,
    tpl.research.deepResearch,
    ...(ag ? [ag.research.deepResearch] : []),
  ];
  const deepResearch = deepModes.reduce((a, b) => (DEEP_RANK[b] < DEEP_RANK[a] ? b : a));
  for (const [role, layer] of [
    [tpl, "template"],
    [ag, "agent"],
  ] as const)
    if (role && DEEP_RANK[role.research.deepResearch] > DEEP_RANK[companyDeep])
      conflict({
        category: "deep_research",
        requested: { layer, text: `Deep research ${role.research.deepResearch}` },
        winner: {
          layer: "company",
          text: `Deep research ${modeText(c.aiPolicy.deepResearchPolicy)}`,
        },
        resolution: `CONFLICT RESOLVED: company AI policy (${c.aiPolicy.deepResearchPolicy}) wins over the ${layer} role.`,
      });

  const budgetCaps = [src.agent.perTaskBudget];
  if (tpl.cost.maxTaskBudget !== null) budgetCaps.push(tpl.cost.maxTaskBudget);
  if (ag?.cost.maxTaskBudget != null) budgetCaps.push(ag.cost.maxTaskBudget);
  if (t?.maxBudget != null) budgetCaps.push(t.maxBudget);
  const maxTaskBudgetUsd = Math.min(...budgetCaps);
  for (const [value, layer] of [
    [ag?.cost.maxTaskBudget, "agent"],
    [t?.maxBudget, "task"],
  ] as const)
    if (value != null && value > src.agent.perTaskBudget)
      conflict({
        category: "budget",
        requested: { layer, text: `Budget $${value}` },
        winner: { layer: "company", text: `Agent per-task budget $${src.agent.perTaskBudget}` },
        resolution: `CONFLICT RESOLVED: ${layer} asked for $${value}; the agent's per-task budget ($${src.agent.perTaskBudget}) wins.`,
      });

  const decision = new Map(src.authority.map((a) => [a.permission, a.decision]));
  let externalActions: Mode = c.aiPolicy.externalActionPolicy;
  const extAuth = decision.get("action.external_send") ?? "deny";
  if (extAuth === "deny") externalActions = "disabled";
  else if (extAuth === "require_approval" && externalActions === "allowed")
    externalActions = "approval_required";
  if (t && !t.externalActionAllowed) externalActions = "disabled";
  if (
    t?.externalActionAllowed &&
    (c.aiPolicy.externalActionPolicy === "disabled" || extAuth === "deny")
  )
    conflict({
      category: "external_actions",
      requested: { layer: "task", text: "External actions allowed for this task" },
      winner:
        extAuth === "deny"
          ? { layer: "authority", text: "action.external_send DENIED" }
          : { layer: "company", text: "External actions disabled by company AI policy" },
      resolution:
        "CONFLICT RESOLVED: the task cannot enable external actions that authority or company policy forbid.",
    });

  for (const [role, layer] of [
    [tpl, "template"],
    [ag, "agent"],
  ] as const) {
    if (!role) continue;
    for (const tool of role.expectedTools) {
      const d = decision.get(tool) ?? "deny";
      if (d === "deny")
        conflict({
          category: "permission",
          requested: { layer, text: `Role expects to use ${tool}` },
          winner: { layer: "authority", text: `${tool} DENIED` },
          resolution: `CONFLICT RESOLVED: ${layer} instruction requested ${tool}, but authority denies it. Permission wins.`,
        });
    }
  }

  let mayDelegate = tpl.delegation.mayDelegate;
  if (ag && ag.delegation.mayDelegate && !tpl.delegation.mayDelegate)
    conflict({
      category: "delegation",
      requested: { layer: "agent", text: "May delegate" },
      winner: { layer: "template", text: "Do not delegate" },
      resolution:
        "CONFLICT RESOLVED: an agent role cannot loosen its template's delegation policy; change the role template instead.",
    });
  if (ag && !ag.delegation.mayDelegate) mayDelegate = false;
  const maxDelegationDepth = mayDelegate
    ? Math.min(tpl.delegation.maxDepth, ag?.delegation.maxDepth ?? Infinity, src.maxDelegationDepth)
    : 0;

  const allowed = c.aiPolicy.allowedProviders;
  const prefer = (list: ProviderType[]) => list.filter((p) => allowed.includes(p));
  const providerPreference =
    [ag?.cost.providerPreference ?? [], tpl.cost.providerPreference, src.agent.providers]
      .map(prefer)
      .find((l) => l.length) ?? allowed;

  const unique = (xs: string[]) => [...new Map(xs.map((x) => [normalise(x), x])).values()];
  const stopConditions = unique([
    ...tpl.completion.stopConditions,
    ...(ag?.completion.stopConditions ?? []),
    ...(t?.stoppingCondition ? [t.stoppingCondition] : []),
  ]);
  const definitionOfDone = unique([
    ...tpl.completion.definitionOfDone,
    ...(ag?.completion.definitionOfDone ?? []),
  ]);
  const resultFormat =
    t?.resultSchema ?? ag?.completion.resultFormat ?? tpl.completion.resultFormat;

  const allowedTools = src.authority.filter((a) => a.decision === "allow").map((a) => a.permission);
  const approvalTools = src.authority
    .filter((a) => a.decision === "require_approval")
    .map((a) => a.permission);
  const deniedTools = src.authority.filter((a) => a.decision === "deny").map((a) => a.permission);

  /* ---------- concise text ---------- */
  const active = rules.filter((r) => !r.duplicateOf && !r.rejected);
  const sections: string[] = [`# INSTRUCTIONS — ${src.agent.name} (${src.agent.companyName})`];
  for (const layer of INSTRUCTION_LAYERS) {
    const list = active.filter((r) => r.layer === layer && !r.setting);
    if (!list.length) continue;
    const heading =
      layer === "company"
        ? `COMPANY — ${src.agent.companyName}`
        : layer === "department" && src.department
          ? `DEPARTMENT — ${src.department.name}`
          : INSTRUCTION_LAYER_LABELS[layer].toUpperCase();
    sections.push(`## ${heading}\n${list.map((r) => `- ${r.text}`).join("\n")}`);
  }
  sections.push(
    [
      "## EFFECTIVE LIMITS",
      `- Max searches: ${effectiveSearches} · max retries: ${maxRetries} · max task budget: $${maxTaskBudgetUsd}`,
      `- Deep research: ${deepResearch} · external actions: ${externalActions}`,
      `- Delegation: ${mayDelegate ? `allowed (max depth ${maxDelegationDepth})` : "not allowed"}`,
      `- Allowed tools: ${allowedTools.join(", ") || "none"}`,
      `- Needs approval: ${approvalTools.join(", ") || "none"}`,
      `- Providers (preference order): ${providerPreference.join(", ")}`,
      `- Reports to: ${src.agent.reportsTo ?? "—"}`,
    ].join("\n"),
  );
  if (conflicts.length)
    sections.push(`## RESOLVED CONFLICTS\n${conflicts.map((x) => `- ${x.resolution}`).join("\n")}`);
  const text = sections.join("\n\n");

  return {
    version: INSTRUCTION_PACK_VERSION,
    agentId: src.agent.id,
    companyId: src.agent.companyId,
    taskId: t?.id ?? null,
    layers: INSTRUCTION_LAYERS.map((layer) => ({
      layer,
      label: INSTRUCTION_LAYER_LABELS[layer],
      priority: PRIORITY[layer],
      rules: rules.filter((r) => r.layer === layer).map(({ setting: _s, ...r }) => r),
    })),
    conflicts,
    effective: {
      maxSearches: effectiveSearches,
      maxRetries,
      maxTaskBudgetUsd,
      deepResearch,
      externalActions,
      mayDelegate,
      maxDelegationDepth,
      allowedTools,
      approvalTools,
      deniedTools,
      providerPreference,
      stopConditions,
      definitionOfDone,
      resultFormat,
    },
    context: src.context,
    text,
    metadata: {
      generatedAt: src.now.toISOString(),
      ruleCount: active.length,
      duplicatesRemoved,
      rejectedCount,
      approxChars: text.length,
      roleVersion: src.agentRole?.version ?? null,
    },
  };
}
