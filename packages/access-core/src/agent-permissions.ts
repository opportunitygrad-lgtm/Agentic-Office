import type { ApprovalType, AutonomyLevel } from "@aibos/shared";

/**
 * AGENT permission catalogue — a separate principal type from humans.
 * `tool.*` govern which tools an agent may operate; `action.*` govern
 * categories of consequential actions regardless of tool.
 */
export type AgentPermissionRisk = "low" | "medium" | "high";

export interface AgentPermissionDefinition {
  key: string;
  /** Grouping used by the authority UI (e.g. "Email"). */
  group: string;
  /** Short verb shown in the UI (READ, DRAFT, SEND...). */
  verb: string;
  label: string;
  risk: AgentPermissionRisk;
  kind: "tool" | "action";
  /** Approval raised when this permission needs a human decision. */
  approvalType: ApprovalType | null;
}

const d = (
  key: string,
  group: string,
  verb: string,
  label: string,
  risk: AgentPermissionRisk,
  approvalType: ApprovalType | null = null,
): AgentPermissionDefinition => ({
  key,
  group,
  verb,
  label,
  risk,
  kind: key.startsWith("tool.") ? "tool" : "action",
  approvalType,
});

export const AGENT_PERMISSIONS: readonly AgentPermissionDefinition[] = [
  d("tool.web.search", "Web", "SEARCH", "Search the web", "low"),
  d(
    "tool.browser.use",
    "Browser",
    "USE",
    "Operate a controlled browser",
    "medium",
    "browser_action",
  ),
  d("tool.email.read", "Email", "READ", "Read mailboxes", "low"),
  d("tool.email.draft", "Email", "DRAFT", "Create email drafts", "medium"),
  d("tool.email.send", "Email", "SEND", "Send email", "high", "email_send"),
  d("tool.google_sheets.read", "Google Sheets", "READ", "Read spreadsheets", "low"),
  d("tool.google_sheets.write", "Google Sheets", "WRITE", "Write spreadsheets", "medium"),
  d("tool.meta.read", "Meta", "READ", "Read Meta ads data", "low"),
  d("tool.meta.write", "Meta", "EDIT", "Modify Meta campaigns", "high", "ad_budget_increase"),
  d("tool.wordpress.read", "WordPress", "READ", "Read website content", "low"),
  d(
    "tool.wordpress.write",
    "WordPress",
    "WRITE",
    "Change website content",
    "high",
    "website_deployment",
  ),
  d("tool.files.read", "Files", "READ", "Read files", "low"),
  d("tool.files.write", "Files", "WRITE", "Write files", "medium"),
  d(
    "action.external_send",
    "Actions",
    "EXTERNAL SEND",
    "Send anything outside the company",
    "high",
    "email_send",
  ),
  d(
    "action.financial_change",
    "Actions",
    "FINANCIAL",
    "Spend money or change budgets",
    "high",
    "financial_action",
  ),
  d(
    "action.publish",
    "Actions",
    "PUBLISH",
    "Publish content publicly",
    "high",
    "website_deployment",
  ),
  d("action.deploy", "Actions", "DEPLOY", "Deploy code or sites", "high", "code_deployment"),
  d(
    "action.destructive",
    "Actions",
    "DESTRUCTIVE",
    "Delete or irreversibly change data",
    "high",
    "destructive_action",
  ),
  d(
    "action.deep_research",
    "Actions",
    "DEEP RESEARCH",
    "Run long, costly research",
    "medium",
    "deep_research",
  ),
];

export const AGENT_PERMISSION_KEYS: ReadonlySet<string> = new Set(
  AGENT_PERMISSIONS.map((x) => x.key),
);

export function getAgentPermission(key: string): AgentPermissionDefinition | undefined {
  return AGENT_PERMISSIONS.find((x) => x.key === key);
}

export const GRANT_EFFECTS = ["allow", "require_approval", "deny"] as const;
export type GrantEffect = (typeof GRANT_EFFECTS)[number];

/* ---------- autonomy ---------- */

export interface AutonomyDefinition {
  level: AutonomyLevel;
  rank: 0 | 1 | 2 | 3 | 4;
  name: string;
  summary: string;
}

export const AUTONOMY_DEFINITIONS: readonly AutonomyDefinition[] = [
  { level: "disabled", rank: 0, name: "Disabled", summary: "Agent cannot execute anything." },
  {
    level: "observe",
    rank: 1,
    name: "Observe",
    summary: "Read, analyse and recommend only. No modifications.",
  },
  {
    level: "limited_operator",
    rank: 2,
    name: "Limited operator",
    summary: "May execute specifically permitted low- and medium-risk actions.",
  },
  {
    level: "approval_gated",
    rank: 3,
    name: "Approval-gated operator",
    summary: "Prepares actions; high-risk actions always need human approval.",
  },
  {
    level: "trusted_automation",
    rank: 4,
    name: "Trusted automation",
    summary: "Performs explicitly authorised actions within strict policy limits.",
  },
];

/** Actions that ALWAYS require a human, even under trusted automation. */
export const ALWAYS_APPROVAL: ReadonlySet<string> = new Set([
  "action.financial_change",
  "action.destructive",
]);

/* ---------- evaluation ---------- */

export interface AgentGrant {
  permission: string;
  effect: GrantEffect;
  /** null = applies to every company the agent serves. */
  companyId: string | null;
}

export interface AgentAuthorityInput {
  agent: {
    id: string;
    status: string;
    autonomyLevel: AutonomyLevel;
    scope: "global" | "company";
    companyIds: readonly string[];
    /** Approval types the agent must always request (agents.approval_requirements). */
    approvalRequirements: readonly string[];
  };
  grants: readonly AgentGrant[];
}

export type AgentDecision =
  | { decision: "allow"; reason: string }
  | { decision: "require_approval"; reason: string; approvalType: ApprovalType }
  | { decision: "deny"; reason: string };

const INACTIVE_STATUSES = new Set(["paused", "failed", "offline"]);

/**
 * canAgent — the single evaluation point the future execution controller
 * must call before any tool call or action. Default deny. Cost policies,
 * company rules and the execution controller apply on top (Stages 06, 11).
 */
export function evaluateAgentPermission(
  input: AgentAuthorityInput,
  companyId: string | null,
  permission: string,
): AgentDecision {
  const def = getAgentPermission(permission);
  const { agent } = input;
  if (!def) return { decision: "deny", reason: `Unknown agent permission ${permission}` };
  if (agent.autonomyLevel === "disabled")
    return { decision: "deny", reason: "Agent autonomy is disabled" };
  if (INACTIVE_STATUSES.has(agent.status))
    return { decision: "deny", reason: `Agent is ${agent.status}` };
  if (companyId && agent.scope !== "global" && !agent.companyIds.includes(companyId)) {
    return { decision: "deny", reason: "Agent is not assigned to this company" };
  }

  const grant =
    (companyId
      ? input.grants.find((g) => g.permission === permission && g.companyId === companyId)
      : undefined) ?? input.grants.find((g) => g.permission === permission && g.companyId === null);
  if (!grant) return { decision: "deny", reason: "Not granted" };
  if (grant.effect === "deny") return { decision: "deny", reason: "Explicitly denied" };

  const approvalType: ApprovalType = def.approvalType ?? "custom";
  const approval = (reason: string): AgentDecision => ({
    decision: "require_approval",
    reason,
    approvalType,
  });

  switch (agent.autonomyLevel) {
    case "observe":
      return def.risk === "low"
        ? { decision: "allow", reason: "Read-only access under Observe" }
        : { decision: "deny", reason: "Observe agents cannot modify anything" };
    case "limited_operator":
      if (def.risk === "high")
        return { decision: "deny", reason: "High-risk actions exceed Limited operator autonomy" };
      break;
    case "approval_gated":
      if (def.risk === "high") return approval("High-risk actions are approval-gated");
      break;
    case "trusted_automation":
      if (ALWAYS_APPROVAL.has(permission)) return approval("Always requires human approval");
      break;
  }
  if (grant.effect === "require_approval") return approval("Grant requires approval");
  if (def.approvalType && agent.approvalRequirements.includes(def.approvalType)) {
    return approval(`Agent approval gate: ${def.approvalType}`);
  }
  return { decision: "allow", reason: "Granted" };
}
