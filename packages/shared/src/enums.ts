/**
 * Canonical enumerations shared by the database, API, worker and UI.
 * The database pgEnums are generated from these tuples, so this file is the
 * single source of truth for every status/type vocabulary in the system.
 */

export const PROVIDER_TYPES = ["CLAUDE", "OPENAI", "GROK", "LOCAL"] as const;
export type ProviderType = (typeof PROVIDER_TYPES)[number];

export const PROVIDER_LABELS: Record<ProviderType, string> = {
  CLAUDE: "Claude",
  OPENAI: "OpenAI",
  GROK: "Grok",
  LOCAL: "Local logic",
};

export const PROVIDER_CAPABILITIES = [
  "reasoning",
  "coding",
  "web_research",
  "x_research",
  "computer_use",
  "vision",
  "document_analysis",
  "email_drafting",
] as const;
export type ProviderCapability = (typeof PROVIDER_CAPABILITIES)[number];

export const COMPANY_STATUSES = ["active", "inactive"] as const;
export type CompanyStatus = (typeof COMPANY_STATUSES)[number];

export const AGENT_STATUSES = [
  "sleeping",
  "queued",
  "working",
  "waiting",
  "blocked",
  "needs_approval",
  "paused",
  "failed",
  "completed",
  "offline",
  /* Stage 04: temporary-agent terminal states. "failed" is displayed as ERROR. */
  "expired",
  "terminated",
] as const;
export type AgentStatus = (typeof AGENT_STATUSES)[number];

export const AGENT_SCOPES = ["global", "company"] as const;
export type AgentScope = (typeof AGENT_SCOPES)[number];

/**
 * Formal agent autonomy ladder (Stage 02). Even the highest level remains
 * subject to permissions, cost policies, company rules and audit.
 */
export const AUTONOMY_LEVELS = [
  "disabled",
  "observe",
  "limited_operator",
  "approval_gated",
  "trusted_automation",
] as const;
export type AutonomyLevel = (typeof AUTONOMY_LEVELS)[number];

export const AUTONOMY_LABELS: Record<AutonomyLevel, string> = {
  disabled: "L0 · Disabled",
  observe: "L1 · Observe",
  limited_operator: "L2 · Limited operator",
  approval_gated: "L3 · Approval-gated",
  trusted_automation: "L4 · Trusted automation",
};

export const TASK_STATUSES = [
  "queued",
  "assigned",
  "running",
  "waiting",
  "needs_approval",
  "paused",
  "completed",
  "failed",
  "cancelled",
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

/** Task statuses considered "open" (not terminal). */
export const OPEN_TASK_STATUSES: readonly TaskStatus[] = [
  "queued",
  "assigned",
  "running",
  "waiting",
  "needs_approval",
  "paused",
];

export const TASK_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const TASK_TYPES = [
  "management",
  "research",
  "verification",
  "email",
  "marketing",
  "advertising",
  "analysis",
  "technical",
  "website",
  "sales",
  "review",
  "custom",
] as const;
export type TaskType = (typeof TASK_TYPES)[number];

export const ACTOR_KINDS = ["human", "agent", "system"] as const;
export type ActorKind = (typeof ACTOR_KINDS)[number];

export const APPROVAL_TYPES = [
  "email_send",
  "ad_launch",
  "ad_budget_increase",
  "financial_action",
  "deep_research",
  "browser_action",
  "website_deployment",
  "code_deployment",
  "legal_commercial_action",
  "destructive_action",
  "custom",
] as const;
export type ApprovalType = (typeof APPROVAL_TYPES)[number];

export const APPROVAL_TYPE_LABELS: Record<ApprovalType, string> = {
  email_send: "Email send",
  ad_launch: "Ad launch",
  ad_budget_increase: "Ad budget increase",
  financial_action: "Financial action",
  deep_research: "Deep research",
  browser_action: "Browser action",
  website_deployment: "Website deployment",
  code_deployment: "Code deployment",
  legal_commercial_action: "Legal / commercial",
  destructive_action: "Destructive action",
  custom: "Custom",
};

export const APPROVAL_STATUSES = [
  "pending",
  "approved",
  "rejected",
  "expired",
  "cancelled",
] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

export const RISK_LEVELS = ["low", "medium", "high", "critical"] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export const AUDIT_OUTCOMES = ["success", "failure"] as const;
export type AuditOutcome = (typeof AUDIT_OUTCOMES)[number];

export const INTEGRATION_KINDS = [
  "microsoft_outlook",
  "google_sheets",
  "google_drive",
  "meta",
  "facebook",
  "instagram",
  "google_analytics",
  "google_search_console",
  "wordpress",
  "website_monitoring",
  "playwright_browser",
  "grok_x_search",
  "claude",
  "openai",
  "crm",
  "webhooks",
] as const;
export type IntegrationKind = (typeof INTEGRATION_KINDS)[number];

export const INTEGRATION_STATUSES = [
  "not_configured",
  "pending_auth",
  "connected",
  "degraded",
  "error",
  "disabled",
] as const;
export type IntegrationStatus = (typeof INTEGRATION_STATUSES)[number];

export const AUTH_STATES = ["none", "pending", "authorized", "expired", "revoked"] as const;
export type AuthState = (typeof AUTH_STATES)[number];

export const BUDGET_SCOPES = [
  "task",
  "agent_day",
  "company_day",
  "company_month",
  "provider_day",
  "global_day",
] as const;
export type BudgetScope = (typeof BUDGET_SCOPES)[number];

export const BUDGET_ACTIONS = ["warn", "require_approval", "block"] as const;
export type BudgetAction = (typeof BUDGET_ACTIONS)[number];

/**
 * Where a row came from. `dev_seed` rows are development/demo data only and
 * are deleted + recreated by `pnpm db:seed`; they must never be treated as
 * real operational history. `live` is the default for everything else.
 */
export const DATA_ORIGINS = ["live", "dev_seed"] as const;
export type DataOrigin = (typeof DATA_ORIGINS)[number];

export const AGENT_TEMPLATE_KEYS = [
  "company_manager",
  "research",
  "sales_cro",
  "email_communications",
  "marketing_manager",
  "meta_ads",
  "social_media",
  "technical_cto",
  "software_development",
  "analytics",
  "finance_cost_controller",
  "legal_commercial_review",
  "seo",
  "website_performance",
  "lead_qualification",
  "partnership_manager",
  "custom",
] as const;
export type AgentTemplateKey = (typeof AGENT_TEMPLATE_KEYS)[number];

/** Templates offered as defaults by the Add Company wizard (Step 5). */
export const ONBOARDING_AGENT_TEMPLATES: readonly AgentTemplateKey[] = [
  "company_manager",
  "research",
  "sales_cro",
  "email_communications",
  "marketing_manager",
  "technical_cto",
  "analytics",
  "legal_commercial_review",
];

/** BullMQ queue names (shared by API producers and the worker). */
export const QUEUE_NAMES = {
  system: "system",
  agentTasks: "agent-tasks",
} as const;

/** Redis key the worker refreshes so the API can report worker health. */
export const WORKER_HEARTBEAT_KEY = "aibos:worker:heartbeat";
export const WORKER_HEARTBEAT_TTL_SECONDS = 45;

/* ---------- humans, sessions, principals (Stage 02) ---------- */

export const USER_STATUSES = ["invited", "active", "suspended", "disabled"] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const MEMBERSHIP_STATUSES = ["invited", "active", "suspended", "revoked"] as const;
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];

export const ROLE_SCOPES = ["global", "company"] as const;
export type RoleScope = (typeof ROLE_SCOPES)[number];

/** Who performed an audited action. Humans, agents and services are distinct principals. */
export const ACTOR_TYPES = ["human", "agent", "service", "system", "anonymous"] as const;
export type ActorType = (typeof ACTOR_TYPES)[number];

export const AUTH_TOKEN_TYPES = ["password_reset", "invitation"] as const;
export type AuthTokenType = (typeof AUTH_TOKEN_TYPES)[number];

export const GRANT_EFFECT_VALUES = ["allow", "require_approval", "deny"] as const;
export type GrantEffectValue = (typeof GRANT_EFFECT_VALUES)[number];

/** Session cookie name shared by API and web. */
export const SESSION_COOKIE = "aibos_session";
