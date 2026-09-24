import type { SensitivityLevel, TaskType } from "@aibos/shared";
import { sensitivityRank } from "@aibos/shared";
import type {
  AccessPolicySnapshot,
  AgentAuthoritySnapshot,
  CommercialRuleCandidate,
  ComplianceRuleCandidate,
  RuleCandidate,
} from "./types";

/**
 * Does a rule's action pattern cover an action?
 * `*` matches everything, `meta.*` matches every `meta.` action, otherwise exact.
 */
export function actionMatches(pattern: string, action: string): boolean {
  if (pattern === "*") return true;
  if (pattern.endsWith(".*")) return action.startsWith(pattern.slice(0, -1));
  return pattern === action;
}

/** First segment of an action key (`meta.budget_increase` → `meta`). */
export const actionDomain = (action: string): string => action.split(".")[0] ?? action;

/** Agent tool/action permission → business domains it touches. */
const PERMISSION_DOMAINS: Record<string, string[]> = {
  "tool.web.search": ["research"],
  "tool.browser.use": ["browser", "research"],
  "tool.email.read": ["email"],
  "tool.email.draft": ["email"],
  "tool.email.send": ["email", "external"],
  "tool.google_sheets.read": ["data"],
  "tool.google_sheets.write": ["data"],
  "tool.meta.read": ["meta", "advertising"],
  "tool.meta.write": ["meta", "advertising", "finance"],
  "tool.wordpress.read": ["website"],
  "tool.wordpress.write": ["website"],
  "tool.files.read": ["data"],
  "tool.files.write": ["data"],
  "action.external_send": ["email", "external"],
  "action.financial_change": ["finance", "pricing", "meta"],
  "action.publish": ["website", "social", "advertising"],
  "action.deploy": ["website", "technical"],
  "action.destructive": [],
  "action.deep_research": ["research"],
};

const TASK_DOMAINS: Record<TaskType, string[]> = {
  management: ["finance", "pricing"],
  research: ["research"],
  verification: ["research"],
  email: ["email", "external", "pricing"],
  marketing: ["advertising", "social", "meta"],
  advertising: ["advertising", "meta", "finance"],
  analysis: ["data"],
  technical: ["technical", "website"],
  website: ["website"],
  sales: ["sales", "pricing", "email"],
  review: [],
  custom: [],
};

/** Domains an agent can act in (allowed or approval-gated permissions) plus the task's. */
export function agentDomains(
  authority: readonly AgentAuthoritySnapshot[],
  taskType: TaskType | null,
): Set<string> {
  const out = new Set<string>();
  for (const a of authority) {
    if (a.decision === "deny") continue;
    for (const d of PERMISSION_DOMAINS[a.permission] ?? []) out.add(d);
  }
  if (taskType) for (const d of TASK_DOMAINS[taskType]) out.add(d);
  return out;
}

/** Brand-rule channels relevant to an agent's domains. */
export function agentChannels(domains: ReadonlySet<string>): Set<string> {
  const out = new Set<string>();
  if (domains.has("email") || domains.has("external")) out.add("email");
  if (domains.has("advertising") || domains.has("meta")) out.add("advertising");
  if (domains.has("social") || domains.has("advertising")) out.add("social_media");
  if (domains.has("website")) out.add("website");
  if (domains.has("sales")) out.add("sales");
  return out;
}

/**
 * Highest sensitivity an agent may read in a company. Default: PUBLIC and
 * INTERNAL. CONFIDENTIAL/RESTRICTED need an explicit policy for the agent,
 * its department, or the whole company.
 */
export function agentMaxSensitivity(
  agent: { id: string; departmentId: string | null },
  policies: readonly AccessPolicySnapshot[],
): SensitivityLevel {
  let max: SensitivityLevel = "internal";
  for (const p of policies) {
    const applies =
      p.agentId === agent.id ||
      (p.agentId === null && p.departmentId !== null && p.departmentId === agent.departmentId) ||
      (p.agentId === null && p.departmentId === null);
    if (applies && sensitivityRank(p.maxSensitivity) > sensitivityRank(max)) max = p.maxSensitivity;
  }
  return max;
}

const money = (amount: number, currency: string | null) =>
  `${currency ?? ""} ${amount.toLocaleString("en-GB")}`.trim();

/** Human-readable, deterministic summary of what a rule enforces. */
export function ruleDetail(rule: RuleCandidate): string | null {
  if (rule.kind === "brand") return rule.channel === "all" ? null : `Channel: ${rule.channel}`;
  if (rule.kind === "commercial") {
    const per = rule.period && rule.period !== "per_action" ? ` per ${rule.period}` : " per action";
    const who = rule.requiredPermission ? ` (${rule.requiredPermission})` : "";
    const limit = rule.limitAmount !== null ? money(rule.limitAmount, rule.currency) : null;
    switch (rule.effect) {
      case "limit":
        return `${rule.appliesTo}: up to ${limit}${per} automatically; above that requires human approval${who}`;
      case "require_approval":
        return `${rule.appliesTo}: requires human approval${limit ? ` above ${limit}${per}` : ""}${who}`;
      case "prohibit":
        return `${rule.appliesTo}: prohibited`;
      default:
        return limit ? `${rule.appliesTo}: ${limit}${per}` : `Applies to ${rule.appliesTo}`;
    }
  }
  const scope = rule.jurisdiction ? ` [${rule.jurisdiction}]` : "";
  switch (rule.effect) {
    case "prohibit":
      return `IF ${rule.action}${scope} THEN prohibited`;
    case "require_approval":
      return `IF ${rule.action}${scope} THEN human approval${rule.requiredPermission ? ` (${rule.requiredPermission})` : ""}`;
    case "require_disclosure":
      return `IF ${rule.action}${scope} THEN include disclosure: “${rule.disclosureText ?? ""}”`;
    default:
      return `Applies to ${rule.action}${scope}`;
  }
}

export const isRestrictiveRule = (rule: RuleCandidate): boolean =>
  (rule.kind === "commercial" && rule.effect !== "info") ||
  (rule.kind === "compliance" && rule.effect !== "info");

/* ---------- execution-time evaluation (for future execution controllers) ---------- */

export interface CompanyActionQuery {
  companyId: string;
  /** Namespaced action, e.g. `meta.budget_increase`. */
  action: string;
  /** Amount of this action (e.g. budget increase), if monetary. */
  amount?: number;
  currency?: string;
  /** Amount already used in the rule's period (caller computes from its ledger). */
  periodTotal?: number;
}

export interface CompanyActionDecision {
  decision: "allow" | "require_approval" | "prohibit";
  requiredPermissions: string[];
  disclosures: string[];
  matchedRuleIds: string[];
  reasons: string[];
}

/**
 * Evaluates active, approved commercial + compliance rules for an action.
 * Generic IF company AND action THEN effect — no policy language. Unknown
 * currencies on a limit are treated conservatively (approval required).
 */
export function evaluateCompanyAction(
  rules: readonly RuleCandidate[],
  q: CompanyActionQuery,
): CompanyActionDecision {
  const out: CompanyActionDecision = {
    decision: "allow",
    requiredPermissions: [],
    disclosures: [],
    matchedRuleIds: [],
    reasons: [],
  };
  const escalate = (to: "require_approval" | "prohibit") => {
    if (out.decision === "prohibit") return;
    if (to === "prohibit" || out.decision === "allow") out.decision = to;
  };
  const addPermission = (p: string | null) => {
    if (p && !out.requiredPermissions.includes(p)) out.requiredPermissions.push(p);
  };

  const applicable = rules.filter(
    (r): r is CommercialRuleCandidate | ComplianceRuleCandidate =>
      r.kind !== "brand" &&
      r.active &&
      r.status === "approved" &&
      (r.companyId === null || r.companyId === q.companyId) &&
      actionMatches(r.kind === "commercial" ? r.appliesTo : r.action, q.action),
  );

  for (const r of applicable) {
    if (r.kind === "commercial") {
      if (r.effect === "info") continue;
      if (r.effect === "prohibit") {
        escalate("prohibit");
        out.reasons.push(`${r.title}: prohibited`);
      } else if (r.limitAmount === null) {
        if (r.effect === "require_approval") {
          escalate("require_approval");
          addPermission(r.requiredPermission);
          out.reasons.push(`${r.title}: approval required`);
        } else continue;
      } else {
        const sameCurrency = !r.currency || !q.currency || r.currency === q.currency;
        const total = (q.periodTotal ?? 0) + (q.amount ?? 0);
        if (!sameCurrency || q.amount === undefined) {
          escalate("require_approval");
          addPermission(r.requiredPermission);
          out.reasons.push(`${r.title}: cannot verify amount against limit — approval required`);
        } else if (total > r.limitAmount) {
          escalate("require_approval");
          addPermission(r.requiredPermission);
          out.reasons.push(
            `${r.title}: ${money(total, q.currency ?? r.currency)} exceeds ${money(r.limitAmount, r.currency)}`,
          );
        } else continue;
      }
    } else {
      if (r.effect === "info") continue;
      if (r.effect === "prohibit") {
        escalate("prohibit");
        out.reasons.push(`${r.title}: prohibited`);
      } else if (r.effect === "require_approval") {
        escalate("require_approval");
        addPermission(r.requiredPermission);
        out.reasons.push(`${r.title}: approval required`);
      } else if (r.disclosureText) {
        out.disclosures.push(r.disclosureText);
        out.reasons.push(`${r.title}: disclosure required`);
      }
    }
    out.matchedRuleIds.push(r.id);
  }
  return out;
}
