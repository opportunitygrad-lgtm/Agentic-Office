/**
 * AI Business OS — database schema (Drizzle ORM, PostgreSQL 16).
 * See docs/DATA_MODEL.md for the entity overview and design rationale.
 */
import { relations, sql } from "drizzle-orm";
import {
  boolean,
  check,
  customType,
  index,
  inet,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import {
  ACTOR_KINDS,
  ACTOR_TYPES,
  AUTH_TOKEN_TYPES,
  GRANT_EFFECT_VALUES,
  MEMBERSHIP_STATUSES,
  ROLE_SCOPES,
  USER_STATUSES,
  AGENT_SCOPES,
  AGENT_STATUSES,
  APPROVAL_STATUSES,
  APPROVAL_TYPES,
  AUDIT_OUTCOMES,
  AUTH_STATES,
  AUTONOMY_LEVELS,
  BUDGET_ACTIONS,
  BUDGET_SCOPES,
  COMPANY_STATUSES,
  DATA_ORIGINS,
  INTEGRATION_KINDS,
  INTEGRATION_STATUSES,
  PROVIDER_TYPES,
  RISK_LEVELS,
  TASK_PRIORITIES,
  TASK_STATUSES,
  TASK_TYPES,
  AI_POLICY_MODES,
  BRAND_RULE_CATEGORIES,
  COMMERCIAL_RULE_CATEGORIES,
  COMMERCIAL_RULE_EFFECTS,
  COMPLIANCE_EFFECTS,
  CONFIDENCE_LEVELS,
  KNOWLEDGE_LINK_TARGETS,
  KNOWLEDGE_SCOPES,
  KNOWLEDGE_SOURCE_TYPES,
  KNOWLEDGE_STATUSES,
  KNOWLEDGE_TYPES,
  RULE_CHANNELS,
  RULE_PERIODS,
  RULE_SEVERITIES,
  RULE_STATUSES,
  SENSITIVITY_LEVELS,
  STALE_KNOWLEDGE_POLICIES,
  VERIFICATION_STATUSES,
  AGENT_MESSAGE_TYPES,
  CONVERSATION_STATUSES,
  DELEGATION_OUTCOMES,
  HANDOFF_STATUSES,
  HANDOFF_TYPES,
  AGENT_RUN_STATUSES,
  EFFORT_LEVELS,
  MODEL_TIERS,
  PROVIDER_HEALTH_STATES,
  RESPONSE_DETAILS,
  RUN_EXECUTION_TYPES,
  PROVIDER_SELECTION_MODES,
  SECOND_OPINION_MODES,
  RUN_PURPOSES,
} from "@aibos/shared";

/* ---------- enums (sourced from @aibos/shared) ---------- */

export const providerType = pgEnum("provider_type", PROVIDER_TYPES);
export const companyStatus = pgEnum("company_status", COMPANY_STATUSES);
export const agentStatus = pgEnum("agent_status", AGENT_STATUSES);
export const agentScope = pgEnum("agent_scope", AGENT_SCOPES);
export const agentAutonomy = pgEnum("agent_autonomy", AUTONOMY_LEVELS);
export const userStatus = pgEnum("user_status", USER_STATUSES);
export const membershipStatus = pgEnum("membership_status", MEMBERSHIP_STATUSES);
export const roleScope = pgEnum("role_scope", ROLE_SCOPES);
export const actorType = pgEnum("actor_type", ACTOR_TYPES);
export const authTokenType = pgEnum("auth_token_type", AUTH_TOKEN_TYPES);
export const grantEffect = pgEnum("grant_effect", GRANT_EFFECT_VALUES);
export const taskStatus = pgEnum("task_status", TASK_STATUSES);
export const taskPriority = pgEnum("task_priority", TASK_PRIORITIES);
export const taskType = pgEnum("task_type", TASK_TYPES);
export const actorKind = pgEnum("actor_kind", ACTOR_KINDS);
export const approvalType = pgEnum("approval_type", APPROVAL_TYPES);
export const approvalStatus = pgEnum("approval_status", APPROVAL_STATUSES);
export const riskLevel = pgEnum("risk_level", RISK_LEVELS);
export const auditOutcome = pgEnum("audit_outcome", AUDIT_OUTCOMES);
export const integrationKind = pgEnum("integration_kind", INTEGRATION_KINDS);
export const integrationStatus = pgEnum("integration_status", INTEGRATION_STATUSES);
export const authState = pgEnum("auth_state", AUTH_STATES);
export const budgetScope = pgEnum("budget_scope", BUDGET_SCOPES);
export const budgetAction = pgEnum("budget_action", BUDGET_ACTIONS);
export const dataOrigin = pgEnum("data_origin", DATA_ORIGINS);
export const knowledgeType = pgEnum("knowledge_type", KNOWLEDGE_TYPES);
export const knowledgeStatus = pgEnum("knowledge_status", KNOWLEDGE_STATUSES);
export const confidenceLevel = pgEnum("confidence_level", CONFIDENCE_LEVELS);
export const verificationStatus = pgEnum("verification_status", VERIFICATION_STATUSES);
export const knowledgeSourceType = pgEnum("knowledge_source_type", KNOWLEDGE_SOURCE_TYPES);
export const sensitivityLevel = pgEnum("sensitivity_level", SENSITIVITY_LEVELS);
export const knowledgeScope = pgEnum("knowledge_scope", KNOWLEDGE_SCOPES);
export const knowledgeLinkTarget = pgEnum("knowledge_link_target", KNOWLEDGE_LINK_TARGETS);
export const ruleStatus = pgEnum("rule_status", RULE_STATUSES);
export const ruleSeverity = pgEnum("rule_severity", RULE_SEVERITIES);
export const brandRuleCategory = pgEnum("brand_rule_category", BRAND_RULE_CATEGORIES);
export const ruleChannel = pgEnum("rule_channel", RULE_CHANNELS);
export const commercialRuleCategory = pgEnum(
  "commercial_rule_category",
  COMMERCIAL_RULE_CATEGORIES,
);
export const commercialRuleEffect = pgEnum("commercial_rule_effect", COMMERCIAL_RULE_EFFECTS);
export const rulePeriod = pgEnum("rule_period", RULE_PERIODS);
export const complianceEffect = pgEnum("compliance_effect", COMPLIANCE_EFFECTS);
export const aiPolicyMode = pgEnum("ai_policy_mode", AI_POLICY_MODES);
export const staleKnowledgePolicy = pgEnum("stale_knowledge_policy", STALE_KNOWLEDGE_POLICIES);
export const delegationOutcome = pgEnum("delegation_outcome", DELEGATION_OUTCOMES);
export const handoffStatus = pgEnum("handoff_status", HANDOFF_STATUSES);
export const handoffType = pgEnum("handoff_type", HANDOFF_TYPES);
export const agentMessageType = pgEnum("agent_message_type", AGENT_MESSAGE_TYPES);
export const conversationStatus = pgEnum("conversation_status", CONVERSATION_STATUSES);
export const modelTier = pgEnum("model_tier", MODEL_TIERS);
export const effortLevel = pgEnum("effort_level", EFFORT_LEVELS);
export const responseDetail = pgEnum("response_detail", RESPONSE_DETAILS);
export const agentRunStatus = pgEnum("agent_run_status", AGENT_RUN_STATUSES);
export const runExecutionType = pgEnum("run_execution_type", RUN_EXECUTION_TYPES);
export const providerHealthState = pgEnum("provider_health_state", PROVIDER_HEALTH_STATES);
export const providerSelectionMode = pgEnum("provider_selection_mode", PROVIDER_SELECTION_MODES);
export const secondOpinionMode = pgEnum("second_opinion_mode", SECOND_OPINION_MODES);
export const runPurpose = pgEnum("run_purpose", RUN_PURPOSES);

/* ---------- shared column helpers ---------- */

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
const origin = () => dataOrigin("origin").notNull().default("live");
/** Money in USD. numeric avoids float drift; mapped to number in TS. */
const usd = (name: string) => numeric(name, { precision: 14, scale: 6, mode: "number" });
const textList = (name: string) =>
  text(name)
    .array()
    .notNull()
    .default(sql`'{}'::text[]`);

/* ---------- companies ---------- */

export const companies = pgTable(
  "companies",
  {
    id: id(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    legalName: text("legal_name"),
    industry: text("industry"),
    description: text("description"),
    website: text("website"),
    logoUrl: text("logo_url"),
    accentColor: text("accent_color"),
    primaryCountry: text("primary_country"),
    countriesServed: textList("countries_served"),
    timezone: text("timezone").notNull().default("UTC"),
    defaultCurrency: text("default_currency").notNull().default("EUR"),
    targetAudiences: textList("target_audiences"),
    targetMarkets: textList("target_markets"),
    productsServices: textList("products_services"),
    businessObjectives: textList("business_objectives"),
    primaryObjective: text("primary_objective"),
    revenueObjective: text("revenue_objective"),
    brandPositioning: text("brand_positioning"),
    brandTone: text("brand_tone"),
    companyRules: textList("company_rules"),
    prohibitedClaims: textList("prohibited_claims"),
    competitorNotes: text("competitor_notes"),
    complianceNotes: text("compliance_notes"),
    /* Stage 03 structured profile (identity / business / brand / compliance) */
    tradingName: text("trading_name"),
    contactEmail: text("contact_email"),
    contactPhone: text("contact_phone"),
    contactAddress: text("contact_address"),
    registrationNumber: text("registration_number"),
    taxIdentifier: text("tax_identifier"),
    products: textList("products"),
    revenueModel: text("revenue_model"),
    secondaryObjectives: textList("secondary_objectives"),
    salesChannels: textList("sales_channels"),
    marketingChannels: textList("marketing_channels"),
    brandPersonality: text("brand_personality"),
    brandVoice: text("brand_voice"),
    visualGuidance: text("visual_guidance"),
    approvedPhrases: textList("approved_phrases"),
    prohibitedPhrases: textList("prohibited_phrases"),
    claimsAllowed: textList("claims_allowed"),
    claimsRequiringEvidence: textList("claims_requiring_evidence"),
    jurisdictions: textList("jurisdictions"),
    regulators: textList("regulators"),
    legalDisclaimers: textList("legal_disclaimers"),
    dataHandlingRules: textList("data_handling_rules"),
    defaultProvider: providerType("default_provider").notNull().default("CLAUDE"),
    monthlyAiBudget: usd("monthly_ai_budget").notNull().default(0),
    dailyAiBudget: usd("daily_ai_budget").notNull().default(0),
    concurrencyLimit: integer("concurrency_limit").notNull().default(2),
    status: companyStatus("status").notNull().default("active"),
    /** Versioned, Zod-validated structured settings (companySettingsSchema). */
    settings: jsonb("settings").$type<Record<string, unknown>>().notNull().default({}),
    origin: origin(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("companies_slug_uq").on(t.slug),
    check("companies_budget_nonneg", sql`${t.dailyAiBudget} >= 0 AND ${t.monthlyAiBudget} >= 0`),
    check("companies_concurrency_range", sql`${t.concurrencyLimit} BETWEEN 1 AND 50`),
  ],
);

/* ---------- departments / teams ---------- */

export const departments = pgTable(
  "departments",
  {
    id: id(),
    /** NULL = global department shared by all companies. */
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description"),
    color: text("color"),
    /* Stage 04 department model */
    mission: text("mission"),
    managerAgentId: uuid("manager_agent_id").references((): AnyPgColumn => agents.id, {
      onDelete: "set null",
    }),
    humanManagerUserId: uuid("human_manager_user_id").references((): AnyPgColumn => users.id, {
      onDelete: "set null",
    }),
    defaultProvider: providerType("default_provider"),
    concurrencyLimit: integer("concurrency_limit"),
    dailyBudgetUsd: usd("daily_budget_usd"),
    active: boolean("active").notNull().default(true),
    instructions: textList("instructions"),
    allowedTaskTypes: textList("allowed_task_types"),
    handoffDestinations: textList("handoff_destinations"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [unique("departments_company_slug_uq").on(t.companyId, t.slug).nullsNotDistinct()],
);

/* ---------- agent templates ---------- */

export const agentTemplates = pgTable("agent_templates", {
  key: text("key").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  departmentSlug: text("department_slug").notNull(),
  defaultProvider: providerType("default_provider").notNull(),
  fallbackProvider: providerType("fallback_provider"),
  defaultAutonomy: agentAutonomy("autonomy").notNull().default("observe"),
  responsibilities: textList("responsibilities"),
  defaultTools: textList("default_tools"),
  prohibitedActions: textList("prohibited_actions"),
  approvalRequirements: textList("approval_requirements"),
  capabilities: textList("capabilities"),
  /** Stage 04 agent capabilities (what the role is good at; not permissions). */
  agentCapabilities: textList("agent_capabilities"),
  /** Future (Stage 05): pointer to a versioned prompt in the prompt library. */
  promptVersion: text("prompt_version"),
  definition: jsonb("definition").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/* ---------- agents ---------- */

export const agents = pgTable(
  "agents",
  {
    id: id(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description"),
    templateKey: text("template_key")
      .notNull()
      .references(() => agentTemplates.key),
    scope: agentScope("scope").notNull().default("company"),
    status: agentStatus("status").notNull().default("sleeping"),
    departmentId: uuid("department_id").references(() => departments.id, { onDelete: "set null" }),
    reportsToAgentId: uuid("reports_to_agent_id").references((): AnyPgColumn => agents.id, {
      onDelete: "set null",
    }),
    primaryProvider: providerType("primary_provider").notNull().default("CLAUDE"),
    fallbackProvider: providerType("fallback_provider"),
    preferredModel: text("preferred_model"),
    /** Stage 05: default model tier and effort (bounded by company policy). */
    preferredModelTier: modelTier("preferred_model_tier").notNull().default("standard"),
    defaultEffort: effortLevel("default_effort"),
    /** Stage 06: who reviews this agent's results when a second opinion is requested. */
    preferredReviewerProvider: providerType("preferred_reviewer_provider"),
    autonomyLevel: agentAutonomy("autonomy").notNull().default("observe"),
    systemInstructions: text("system_instructions"),
    responsibilities: textList("responsibilities"),
    prohibitedActions: textList("prohibited_actions"),
    allowedTools: textList("allowed_tools"),
    readPermissions: textList("read_permissions"),
    writePermissions: textList("write_permissions"),
    /** Approval types this agent must request before acting. */
    approvalRequirements: textList("approval_requirements"),
    perTaskBudget: usd("per_task_budget").notNull().default(2),
    dailyBudget: usd("daily_budget").notNull().default(10),
    maxExternalSearches: integer("max_external_searches").notNull().default(20),
    maxRetries: integer("max_retries").notNull().default(2),
    concurrencyLimit: integer("concurrency_limit").notNull().default(1),
    isTemporary: boolean("is_temporary").notNull().default(false),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    lastActiveAt: timestamp("last_active_at", { withTimezone: true }),
    /* Stage 04 workforce model */
    capabilities: textList("capabilities"),
    escalationAgentId: uuid("escalation_agent_id").references((): AnyPgColumn => agents.id, {
      onDelete: "set null",
    }),
    fallbackManagerId: uuid("fallback_manager_id").references((): AnyPgColumn => agents.id, {
      onDelete: "set null",
    }),
    roleTemplateId: uuid("role_template_id").references((): AnyPgColumn => roleTemplates.id, {
      onDelete: "set null",
    }),
    /** Temporary workers: the agent that owns them and the task they are bound to. */
    parentAgentId: uuid("parent_agent_id").references((): AnyPgColumn => agents.id, {
      onDelete: "set null",
    }),
    boundTaskId: uuid("bound_task_id").references((): AnyPgColumn => tasks.id, {
      onDelete: "set null",
    }),
    purpose: text("purpose"),
    maySpawnTemporary: boolean("may_spawn_temporary").notNull().default(false),
    terminatedAt: timestamp("terminated_at", { withTimezone: true }),
    origin: origin(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("agents_slug_uq").on(t.slug),
    index("agents_status_idx").on(t.status),
    check("agents_concurrency_range", sql`${t.concurrencyLimit} BETWEEN 1 AND 50`),
    check("agents_budget_nonneg", sql`${t.perTaskBudget} >= 0 AND ${t.dailyBudget} >= 0`),
  ],
);

/** Many-to-many: an agent may serve one, several or (with scope=global) all companies. */
export const agentCompanyAssignments = pgTable(
  "agent_company_assignments",
  {
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    isPrimary: boolean("is_primary").notNull().default(false),
    role: text("role"),
    assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.agentId, t.companyId] }),
    index("aca_company_idx").on(t.companyId),
  ],
);

/* ---------- tasks ---------- */

export const tasks = pgTable(
  "tasks",
  {
    id: id(),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    type: taskType("type").notNull().default("custom"),
    priority: taskPriority("priority").notNull().default("normal"),
    status: taskStatus("status").notNull().default("queued"),
    assignedAgentId: uuid("assigned_agent_id").references(() => agents.id, {
      onDelete: "set null",
    }),
    createdByKind: actorKind("created_by_kind").notNull().default("human"),
    createdByRef: text("created_by_ref"),
    parentTaskId: uuid("parent_task_id").references((): AnyPgColumn => tasks.id, {
      onDelete: "cascade",
    }),
    /** Top of the hierarchy; equals id for root tasks. Enables whole-tree queries. */
    rootTaskId: uuid("root_task_id").references((): AnyPgColumn => tasks.id, {
      onDelete: "cascade",
    }),
    depth: integer("depth").notNull().default(0),
    requiredProvider: providerType("required_provider"),
    estimatedCost: usd("estimated_cost"),
    actualCost: usd("actual_cost"),
    progress: integer("progress").notNull().default(0),
    currentAction: text("current_action"),
    currentTool: text("current_tool"),
    requiresApproval: boolean("requires_approval").notNull().default(false),
    /** Stage 03: the task may use clearly-labelled UNVERIFIED research as context. */
    allowUnverifiedContext: boolean("allow_unverified_context").notNull().default(false),
    /* Stage 04: requirements, routing, delegation and claiming */
    requiredCapabilities: textList("required_capabilities"),
    preferredDepartmentId: uuid("preferred_department_id").references(() => departments.id, {
      onDelete: "set null",
    }),
    preferredAgentId: uuid("preferred_agent_id").references((): AnyPgColumn => agents.id, {
      onDelete: "set null",
    }),
    preferredTeamId: uuid("preferred_team_id").references((): AnyPgColumn => teams.id, {
      onDelete: "set null",
    }),
    providerPreference: providerType("provider_preference"),
    /** Stage 05: model tier (null = agent/company default), output detail and AUTO complexity signal. */
    modelTier: modelTier("model_tier"),
    responseDetail: responseDetail("response_detail").notNull().default("normal"),
    highComplexity: boolean("high_complexity").notNull().default(false),
    maxBudget: usd("max_budget"),
    maxConcurrency: integer("max_concurrency"),
    delegationAllowed: boolean("delegation_allowed").notNull().default(true),
    parallelAllowed: boolean("parallel_allowed").notNull().default(false),
    externalActionAllowed: boolean("external_action_allowed").notNull().default(false),
    approvalRequirements: textList("approval_requirements"),
    resultSchema: text("result_schema"),
    stoppingCondition: text("stopping_condition"),
    expectedOutcome: text("expected_outcome"),
    targetEntity: text("target_entity"),
    workItems: integer("work_items"),
    normalizedObjective: text("normalized_objective"),
    departmentId: uuid("department_id").references(() => departments.id, { onDelete: "set null" }),
    teamId: uuid("team_id").references((): AnyPgColumn => teams.id, { onDelete: "set null" }),
    delegationDepth: integer("delegation_depth").notNull().default(0),
    delegatedFromAgentId: uuid("delegated_from_agent_id").references((): AnyPgColumn => agents.id, {
      onDelete: "set null",
    }),
    claimedByAgentId: uuid("claimed_by_agent_id").references((): AnyPgColumn => agents.id, {
      onDelete: "set null",
    }),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    dueAt: timestamp("due_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    error: text("error"),
    resultSummary: text("result_summary"),
    origin: origin(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("tasks_company_status_idx").on(t.companyId, t.status),
    index("tasks_agent_idx").on(t.assignedAgentId),
    index("tasks_parent_idx").on(t.parentTaskId),
    index("tasks_root_idx").on(t.rootTaskId),
    index("tasks_objective_idx").on(t.companyId, t.normalizedObjective),
    index("tasks_claim_idx").on(t.claimedByAgentId),
    check("tasks_progress_range", sql`${t.progress} BETWEEN 0 AND 100`),
  ],
);

/* ---------- approvals ---------- */

export const approvals = pgTable(
  "approvals",
  {
    id: id(),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }),
    taskId: uuid("task_id").references(() => tasks.id, { onDelete: "set null" }),
    agentId: uuid("agent_id").references(() => agents.id, { onDelete: "set null" }),
    type: approvalType("type").notNull(),
    requestedAction: text("requested_action").notNull(),
    explanation: text("explanation"),
    riskLevel: riskLevel("risk_level").notNull().default("medium"),
    proposedChange: jsonb("proposed_change").$type<Record<string, unknown>>(),
    beforeState: jsonb("before_state").$type<Record<string, unknown>>(),
    afterState: jsonb("after_state").$type<Record<string, unknown>>(),
    status: approvalStatus("status").notNull().default("pending"),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    /** Human permissions required to decide (computed from approval_requirements). */
    requiredPermissions: textList("required_permissions"),
    /** Display label of the decider (email); decidedByUserId is authoritative. */
    decidedBy: text("decided_by"),
    decidedByUserId: uuid("decided_by_user_id").references((): AnyPgColumn => users.id, {
      onDelete: "set null",
    }),
    decisionNotes: text("decision_notes"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    origin: origin(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("approvals_status_idx").on(t.status, t.requestedAt)],
);

/* ---------- audit log (append-only) ---------- */

export const auditEvents = pgTable(
  "audit_events",
  {
    id: id(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "set null" }),
    agentId: uuid("agent_id").references(() => agents.id, { onDelete: "set null" }),
    taskId: uuid("task_id").references(() => tasks.id, { onDelete: "set null" }),
    /** Principal type: human | agent | service | system | anonymous. */
    actorType: actorType("actor_type").notNull().default("system"),
    /** Display label (email / service name). IDs below are authoritative. */
    actorUser: text("actor_user"),
    actorUserId: uuid("actor_user_id").references((): AnyPgColumn => users.id, {
      onDelete: "set null",
    }),
    actorServiceId: text("actor_service_id").references((): AnyPgColumn => serviceIdentities.key),
    resourceType: text("resource_type"),
    resourceId: text("resource_id"),
    /** Namespaced verb, e.g. company.created, email.sent, meta.campaign_paused. */
    action: text("action").notNull(),
    tool: text("tool"),
    provider: providerType("provider"),
    description: text("description").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    before: jsonb("before").$type<Record<string, unknown>>(),
    after: jsonb("after").$type<Record<string, unknown>>(),
    outcome: auditOutcome("outcome").notNull().default("success"),
    error: text("error"),
    ipAddress: inet("ip_address"),
    sessionId: text("session_id"),
    userAgent: text("user_agent"),
    requestId: text("request_id"),
    origin: origin(),
  },
  (t) => [
    index("audit_occurred_idx").on(t.occurredAt),
    index("audit_company_idx").on(t.companyId, t.occurredAt),
    index("audit_action_idx").on(t.action),
    index("audit_actor_user_idx").on(t.actorUserId, t.occurredAt),
  ],
);

/* ---------- integrations ---------- */

export const integrations = pgTable(
  "integrations",
  {
    id: id(),
    kind: integrationKind("kind").notNull(),
    /** NULL = platform-wide integration. */
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    status: integrationStatus("status").notNull().default("not_configured"),
    authState: authState("auth_state").notNull().default("none"),
    capabilities: textList("capabilities"),
    /** Non-secret configuration only (account ids, sheet ids, domains...). */
    config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
    /** Opaque pointer into a future secret store. NEVER a credential value. */
    credentialRef: text("credential_ref"),
    lastHealthCheckAt: timestamp("last_health_check_at", { withTimezone: true }),
    lastSuccessfulSyncAt: timestamp("last_successful_sync_at", { withTimezone: true }),
    lastError: text("last_error"),
    lastErrorAt: timestamp("last_error_at", { withTimezone: true }),
    origin: origin(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [unique("integrations_kind_company_uq").on(t.kind, t.companyId).nullsNotDistinct()],
);

/* ---------- cost governor ---------- */

/** Immutable ledger: one row per provider/tool call. */
export const aiUsageRecords = pgTable(
  "ai_usage_records",
  {
    id: id(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    provider: providerType("provider").notNull(),
    model: text("model").notNull(),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "set null" }),
    agentId: uuid("agent_id").references(() => agents.id, { onDelete: "set null" }),
    taskId: uuid("task_id").references(() => tasks.id, { onDelete: "set null" }),
    requestId: text("request_id"),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    cachedTokens: integer("cached_tokens").notNull().default(0),
    /** Stage 05: prompt-cache accounting and run reference. */
    cacheCreationTokens: integer("cache_creation_tokens").notNull().default(0),
    cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
    runId: uuid("run_id"),
    /** Price in force when the call ran (never recomputed). */
    priceSnapshot: jsonb("price_snapshot"),
    /**
     * Stage 05A: how the call was made and billed. `subscription` rows (Claude
     * Code on the owner's plan) always have actual_cost 0 and never count as
     * API spend; `api_equivalent_cost` is an analytical, NOT BILLED estimate.
     */
    transport: text("transport"),
    billingMode: text("billing_mode").notNull().default("api"),
    apiEquivalentCost: usd("api_equivalent_cost"),
    /** Subscription rate-limit state reported with the call (status, type, reset). */
    rateLimit: jsonb("rate_limit"),
    toolCost: usd("tool_cost").notNull().default(0),
    providerCost: usd("provider_cost").notNull().default(0),
    estimatedCost: usd("estimated_cost").notNull().default(0),
    actualCost: usd("actual_cost").notNull().default(0),
    origin: origin(),
  },
  (t) => [
    index("usage_occurred_idx").on(t.occurredAt),
    index("usage_company_idx").on(t.companyId, t.occurredAt),
    index("usage_provider_idx").on(t.provider, t.occurredAt),
    // Subscription usage can never become API spend.
    check(
      "usage_billing_mode",
      sql`${t.billingMode} in ('subscription','api','none') and (${t.billingMode} <> 'subscription' or (${t.actualCost} = 0 and ${t.providerCost} = 0))`,
    ),
  ],
);

export const budgetPolicies = pgTable(
  "budget_policies",
  {
    id: id(),
    name: text("name").notNull(),
    scope: budgetScope("scope").notNull(),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id").references(() => agents.id, { onDelete: "cascade" }),
    taskId: uuid("task_id").references(() => tasks.id, { onDelete: "cascade" }),
    provider: providerType("provider"),
    limitUsd: usd("limit_usd").notNull(),
    /** Percentage of the limit at which a warning is raised. */
    warnAtPercent: integer("warn_at_percent").notNull().default(80),
    actionOnExceed: budgetAction("action_on_exceed").notNull().default("require_approval"),
    isActive: boolean("is_active").notNull().default(true),
    origin: origin(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("budget_limit_nonneg", sql`${t.limitUsd} >= 0`),
    check("budget_warn_range", sql`${t.warnAtPercent} BETWEEN 1 AND 100`),
  ],
);

/* ---------- humans, sessions & access (Stage 02) ---------- */

export const users = pgTable(
  "users",
  {
    id: id(),
    email: text("email").notNull(),
    /** Lower-cased, trimmed; the uniqueness key. */
    emailNormalized: text("email_normalized").notNull(),
    firstName: text("first_name"),
    lastName: text("last_name"),
    displayName: text("display_name"),
    avatarUrl: text("avatar_url"),
    /** argon2id PHC string. NULL until an invitation is accepted. Never returned by the API. */
    passwordHash: text("password_hash"),
    status: userStatus("status").notNull().default("invited"),
    timezone: text("timezone"),
    locale: text("locale"),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    passwordChangedAt: timestamp("password_changed_at", { withTimezone: true }),
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
    origin: origin(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("users_email_normalized_uq").on(t.emailNormalized)],
);

/**
 * Server-side sessions. `id` is SHA-256(token) — the raw token only ever
 * exists in the HttpOnly cookie, so a database leak cannot hijack sessions.
 */
export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    /** Sliding expiry (idle timeout). */
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    /** Hard cap regardless of activity. */
    absoluteExpiresAt: timestamp("absolute_expires_at", { withTimezone: true }).notNull(),
    ipAddress: inet("ip_address"),
    userAgent: text("user_agent"),
    /** Future MFA / WebAuthn: authentication strength of this session. */
    authLevel: text("auth_level").notNull().default("password"),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedReason: text("revoked_reason"),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

/** Single-use, expiring tokens (password reset, invitation). Stored hashed. */
export const authTokens = pgTable(
  "auth_tokens",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: authTokenType("type").notNull(),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdByUserId: uuid("created_by_user_id").references((): AnyPgColumn => users.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("auth_tokens_hash_uq").on(t.tokenHash),
    index("auth_tokens_user_idx").on(t.userId, t.type),
  ],
);

export const permissions = pgTable("permissions", {
  key: text("key").primaryKey(),
  category: text("category").notNull(),
  label: text("label").notNull(),
  description: text("description").notNull(),
  scope: roleScope("scope").notNull().default("company"),
  sensitive: boolean("sensitive").notNull().default(false),
});

export const roles = pgTable(
  "roles",
  {
    id: id(),
    key: text("key").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    scope: roleScope("scope").notNull().default("company"),
    /** Company-specific custom role; NULL = available everywhere. */
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }),
    /** System roles are code-owned: permissions are synced and read-only. */
    isSystem: boolean("is_system").notNull().default(false),
    rank: integer("rank").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("roles_key_uq").on(t.key)],
);

export const rolePermissions = pgTable(
  "role_permissions",
  {
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    permissionKey: text("permission_key")
      .notNull()
      .references(() => permissions.key, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.roleId, t.permissionKey] })],
);

/**
 * Human ↔ company membership with one role. company_id NULL = global
 * membership that applies to every company (platform owner, group admin).
 */
export const companyMemberships = pgTable(
  "company_memberships",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }),
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id),
    status: membershipStatus("status").notNull().default("invited"),
    joinedAt: timestamp("joined_at", { withTimezone: true }),
    invitedByUserId: uuid("invited_by_user_id").references((): AnyPgColumn => users.id, {
      onDelete: "set null",
    }),
    origin: origin(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("memberships_user_company_uq").on(t.userId, t.companyId).nullsNotDistinct(),
    index("memberships_company_idx").on(t.companyId),
  ],
);

/** Optional department restriction: a membership with rows here only covers those departments. */
export const membershipDepartments = pgTable(
  "membership_departments",
  {
    membershipId: uuid("membership_id")
      .notNull()
      .references(() => companyMemberships.id, { onDelete: "cascade" }),
    departmentId: uuid("department_id")
      .notNull()
      .references(() => departments.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.membershipId, t.departmentId] })],
);

/** Data-driven approval authority: which human permission decides which approval. */
export const approvalRequirements = pgTable(
  "approval_requirements",
  {
    id: id(),
    /** Approval type or "*" for every type. */
    approvalType: text("approval_type").notNull(),
    minRiskLevel: riskLevel("min_risk_level"),
    requiredPermission: text("required_permission")
      .notNull()
      .references(() => permissions.key),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [
    unique("approval_req_uq")
      .on(t.approvalType, t.minRiskLevel, t.requiredPermission, t.companyId)
      .nullsNotDistinct(),
  ],
);

/* ---------- agent authority (Stage 02) ---------- */

/** Agent tool/action grants; company_id NULL = every company the agent serves. */
export const agentPermissionGrants = pgTable(
  "agent_permission_grants",
  {
    id: id(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }),
    permission: text("permission").notNull(),
    effect: grantEffect("effect").notNull(),
    /** Future constraints (amount caps, domains...). */
    constraints: jsonb("constraints").$type<Record<string, unknown>>().notNull().default({}),
    createdByUserId: uuid("created_by_user_id").references((): AnyPgColumn => users.id, {
      onDelete: "set null",
    }),
    origin: origin(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [unique("agent_grants_uq").on(t.agentId, t.companyId, t.permission).nullsNotDistinct()],
);

/* ---------- internal service identities (Stage 02) ---------- */

export const serviceIdentities = pgTable("service_identities", {
  key: text("key").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: createdAt(),
});

/* ---------- company knowledge & rules (Stage 03) ---------- */

const tsvector = customType<{ data: string }>({ dataType: () => "tsvector" });

/** 1:1 AI operations policy per company. */
export const companyAiPolicies = pgTable("company_ai_policies", {
  companyId: uuid("company_id")
    .primaryKey()
    .references(() => companies.id, { onDelete: "cascade" }),
  allowedProviders: providerType("allowed_providers")
    .array()
    .notNull()
    .default(sql`'{CLAUDE,OPENAI,GROK,LOCAL}'::provider_type[]`),
  defaultResearchLimit: integer("default_research_limit").notNull().default(20),
  deepResearchPolicy: aiPolicyMode("deep_research_policy").notNull().default("approval_required"),
  externalActionPolicy: aiPolicyMode("external_action_policy")
    .notNull()
    .default("approval_required"),
  browserPolicy: aiPolicyMode("browser_policy").notNull().default("approval_required"),
  autoSendPolicy: aiPolicyMode("auto_send_policy").notNull().default("disabled"),
  staleKnowledgePolicy: staleKnowledgePolicy("stale_knowledge_policy").notNull().default("exclude"),
  customRules: textList("custom_rules"),
  /** Stage 05 provider policy (the preferred provider is companies.default_provider). */
  defaultModelTier: modelTier("default_model_tier").notNull().default("standard"),
  premiumAllowed: boolean("premium_allowed").notNull().default(false),
  maxResponseDetail: responseDetail("max_response_detail").notNull().default("detailed"),
  fallbackAllowed: boolean("fallback_allowed").notNull().default(false),
  /**
   * Stage 06: "fixed" always uses companies.default_provider; "auto" lets the
   * router pick the first available real provider (CLAUDE, then OPENAI).
   */
  providerSelection: providerSelectionMode("provider_selection").notNull().default("fixed"),
  /** Second-opinion review policy — never enabled globally by default. */
  reviewMode: secondOpinionMode("review_mode").notNull().default("manual"),
  reviewProvider: providerType("review_provider"),
  reviewTaskTypes: textList("review_task_types"),
  highValueThresholdUsd: usd("high_value_threshold_usd"),
  maxReviewsPerTask: integer("max_reviews_per_task").notNull().default(1),
  updatedByUserId: uuid("updated_by_user_id").references((): AnyPgColumn => users.id, {
    onDelete: "set null",
  }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/**
 * Knowledge library. Each version is a row; versions of one fact share
 * `lineage_id`. At most one APPROVED and one open (draft/review) version per
 * lineage. `company_id` NULL ⇔ scope GLOBAL.
 */
export const knowledgeItems = pgTable(
  "knowledge_items",
  {
    id: id(),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }),
    scope: knowledgeScope("scope").notNull().default("company"),
    departmentId: uuid("department_id").references(() => departments.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    summary: text("summary"),
    content: text("content").notNull(),
    type: knowledgeType("type").notNull(),
    category: text("category"),
    tags: textList("tags"),
    sourceType: knowledgeSourceType("source_type").notNull().default("unknown"),
    sourceReference: text("source_reference"),
    sourceUrl: text("source_url"),
    /** Reference to a future file record — metadata only, nothing is parsed. */
    sourceFileRef: text("source_file_ref"),
    sourceOwner: text("source_owner"),
    provenanceNotes: text("provenance_notes"),
    confidence: confidenceLevel("confidence").notNull().default("medium"),
    verificationStatus: verificationStatus("verification_status").notNull().default("unverified"),
    status: knowledgeStatus("status").notNull().default("draft"),
    sensitivity: sensitivityLevel("sensitivity").notNull().default("internal"),
    /** Research that a task may use as clearly-labelled UNVERIFIED context. */
    usableAsUnverified: boolean("usable_as_unverified").notNull().default(false),
    effectiveAt: timestamp("effective_at", { withTimezone: true }),
    reviewAt: timestamp("review_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    lastVerifiedAt: timestamp("last_verified_at", { withTimezone: true }),
    /** Subject key used for simple conflict detection (e.g. fee:integrated-atpl). */
    conflictKey: text("conflict_key"),
    version: integer("version").notNull().default(1),
    lineageId: uuid("lineage_id").notNull(),
    supersedesId: uuid("supersedes_id").references((): AnyPgColumn => knowledgeItems.id, {
      onDelete: "set null",
    }),
    supersededById: uuid("superseded_by_id").references((): AnyPgColumn => knowledgeItems.id, {
      onDelete: "set null",
    }),
    createdByUserId: uuid("created_by_user_id").references((): AnyPgColumn => users.id, {
      onDelete: "set null",
    }),
    updatedByUserId: uuid("updated_by_user_id").references((): AnyPgColumn => users.id, {
      onDelete: "set null",
    }),
    approvedByUserId: uuid("approved_by_user_id").references((): AnyPgColumn => users.id, {
      onDelete: "set null",
    }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    searchVector: tsvector("search_vector").generatedAlwaysAs(
      sql`setweight(to_tsvector('english', coalesce(title, '')), 'A') || setweight(to_tsvector('english', aibos_tags_text(tags)), 'A') || setweight(to_tsvector('english', coalesce(summary, '')), 'B') || setweight(to_tsvector('english', coalesce(content, '')), 'C')`,
    ),
    origin: origin(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("knowledge_company_status_idx").on(t.companyId, t.status),
    index("knowledge_lineage_idx").on(t.lineageId),
    index("knowledge_search_idx").using("gin", t.searchVector),
    uniqueIndex("knowledge_lineage_approved_uq")
      .on(t.lineageId)
      .where(sql`status = 'approved'`),
    uniqueIndex("knowledge_lineage_open_uq")
      .on(t.lineageId)
      .where(sql`status in ('draft', 'review')`),
    check("knowledge_scope_company", sql`(${t.scope} = 'global') = (${t.companyId} is null)`),
    check(
      "knowledge_ai_not_management_confirmed",
      sql`not (${t.sourceType} in ('grok_research','claude_research','openai_research','system_generated') and ${t.verificationStatus} = 'management_confirmed')`,
    ),
  ],
);

/** Explicit links: knowledge an agent or task must see. */
export const knowledgeLinks = pgTable(
  "knowledge_links",
  {
    id: id(),
    knowledgeId: uuid("knowledge_id")
      .notNull()
      .references(() => knowledgeItems.id, { onDelete: "cascade" }),
    target: knowledgeLinkTarget("target").notNull(),
    taskId: uuid("task_id").references(() => tasks.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id").references(() => agents.id, { onDelete: "cascade" }),
    note: text("note"),
    createdByUserId: uuid("created_by_user_id").references((): AnyPgColumn => users.id, {
      onDelete: "set null",
    }),
    origin: origin(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("knowledge_links_uq").on(t.knowledgeId, t.taskId, t.agentId).nullsNotDistinct(),
    index("knowledge_links_task_idx").on(t.taskId),
    index("knowledge_links_agent_idx").on(t.agentId),
    check(
      "knowledge_links_target",
      sql`(${t.target} = 'task' and ${t.taskId} is not null and ${t.agentId} is null) or (${t.target} = 'agent' and ${t.agentId} is not null and ${t.taskId} is null)`,
    ),
  ],
);

const ruleColumns = () => ({
  id: id(),
  /** NULL = global rule (applies to every company). */
  companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description").notNull(),
  severity: ruleSeverity("severity").notNull().default("required"),
  active: boolean("active").notNull().default(true),
  status: ruleStatus("status").notNull().default("draft"),
  createdByUserId: uuid("created_by_user_id").references((): AnyPgColumn => users.id, {
    onDelete: "set null",
  }),
  updatedByUserId: uuid("updated_by_user_id").references((): AnyPgColumn => users.id, {
    onDelete: "set null",
  }),
  approvedByUserId: uuid("approved_by_user_id").references((): AnyPgColumn => users.id, {
    onDelete: "set null",
  }),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  origin: origin(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const brandRules = pgTable(
  "brand_rules",
  {
    ...ruleColumns(),
    category: brandRuleCategory("category").notNull(),
    channel: ruleChannel("channel").notNull().default("all"),
  },
  (t) => [index("brand_rules_company_idx").on(t.companyId)],
);

/** Queryable commercial constraints (pricing, discounts, ad budgets...). */
export const commercialRules = pgTable(
  "commercial_rules",
  {
    ...ruleColumns(),
    category: commercialRuleCategory("category").notNull(),
    /** Action key the rule governs, e.g. meta.budget_increase. */
    appliesTo: text("applies_to").notNull(),
    effect: commercialRuleEffect("effect").notNull().default("info"),
    limitAmount: numeric("limit_amount", { precision: 18, scale: 2, mode: "number" }),
    currency: text("currency"),
    period: rulePeriod("period"),
    requiredPermission: text("required_permission"),
  },
  (t) => [
    index("commercial_rules_company_idx").on(t.companyId, t.appliesTo),
    check("commercial_limit_nonneg", sql`${t.limitAmount} is null or ${t.limitAmount} >= 0`),
  ],
);

/** IF company AND action THEN require approval / prohibit / disclose. */
export const complianceRules = pgTable(
  "compliance_rules",
  {
    ...ruleColumns(),
    action: text("action").notNull(),
    jurisdiction: text("jurisdiction"),
    effect: complianceEffect("effect").notNull().default("info"),
    disclosureText: text("disclosure_text"),
    requiredPermission: text("required_permission"),
  },
  (t) => [index("compliance_rules_company_idx").on(t.companyId, t.action)],
);

/**
 * Agent access to CONFIDENTIAL / RESTRICTED knowledge. Default (no rows):
 * PUBLIC + INTERNAL only. A row applies to one agent, a department, or the
 * whole company (both NULL).
 */
export const knowledgeAccessPolicies = pgTable(
  "knowledge_access_policies",
  {
    id: id(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id").references(() => agents.id, { onDelete: "cascade" }),
    departmentId: uuid("department_id").references(() => departments.id, { onDelete: "cascade" }),
    maxSensitivity: sensitivityLevel("max_sensitivity").notNull(),
    note: text("note"),
    createdByUserId: uuid("created_by_user_id").references((): AnyPgColumn => users.id, {
      onDelete: "set null",
    }),
    origin: origin(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("knowledge_access_uq").on(t.companyId, t.agentId, t.departmentId).nullsNotDistinct(),
  ],
);

/** Per-agent overrides of the template knowledge profile. */
export const agentKnowledgeProfiles = pgTable("agent_knowledge_profiles", {
  agentId: uuid("agent_id")
    .primaryKey()
    .references(() => agents.id, { onDelete: "cascade" }),
  requiredTypes: knowledgeType("required_types")
    .array()
    .notNull()
    .default(sql`'{}'`),
  preferredTags: textList("preferred_tags"),
  brandCategories: brandRuleCategory("brand_categories")
    .array()
    .notNull()
    .default(sql`'{}'`),
  commercialCategories: commercialRuleCategory("commercial_categories")
    .array()
    .notNull()
    .default(sql`'{}'`),
  updatedByUserId: uuid("updated_by_user_id").references((): AnyPgColumn => users.id, {
    onDelete: "set null",
  }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/* ---------- workforce (Stage 04) ---------- */

/** Singleton (id = 1) workforce policy: concurrency, delegation and temp-agent limits. */
export const workforcePolicy = pgTable(
  "workforce_policy",
  {
    id: integer("id").primaryKey().default(1),
    globalActiveAgentLimit: integer("global_active_agent_limit").notNull().default(3),
    /** Stage 05: platform-wide daily AI spend ceiling. */
    globalDailyAiBudgetUsd: usd("global_daily_ai_budget_usd").notNull().default(50),
    maxDelegationDepth: integer("max_delegation_depth").notNull().default(3),
    highCostTaskThresholdUsd: usd("high_cost_task_threshold_usd").notNull().default(5),
    tempAgentMaxExpiryHours: integer("temp_agent_max_expiry_hours").notNull().default(168),
    tempAgentApprovalBudgetUsd: usd("temp_agent_approval_budget_usd").notNull().default(2),
    maxActiveTempAgentsPerCompany: integer("max_active_temp_agents_per_company")
      .notNull()
      .default(10),
    updatedByUserId: uuid("updated_by_user_id").references((): AnyPgColumn => users.id, {
      onDelete: "set null",
    }),
    updatedAt: updatedAt(),
  },
  (t) => [check("workforce_policy_singleton", sql`${t.id} = 1`)],
);

/** Editable role templates (company-specific specialists extend a base template). */
export const roleTemplates = pgTable(
  "role_templates",
  {
    id: id(),
    key: text("key").notNull(),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }),
    baseTemplateKey: text("base_template_key")
      .notNull()
      .references(() => agentTemplates.key),
    name: text("name").notNull(),
    departmentSlug: text("department_slug").notNull(),
    capabilities: textList("capabilities"),
    /** Structured role (agentRoleSchema). */
    role: jsonb("role").$type<Record<string, unknown>>().notNull(),
    updatedByUserId: uuid("updated_by_user_id").references((): AnyPgColumn => users.id, {
      onDelete: "set null",
    }),
    origin: origin(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [unique("role_templates_key_uq").on(t.companyId, t.key).nullsNotDistinct()],
);

/** Versioned permanent agent roles; exactly one current version per agent. */
export const agentRoleVersions = pgTable(
  "agent_role_versions",
  {
    id: id(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    role: jsonb("role").$type<Record<string, unknown>>().notNull(),
    changeSummary: text("change_summary").notNull(),
    material: boolean("material").notNull().default(true),
    isCurrent: boolean("is_current").notNull().default(true),
    effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull().defaultNow(),
    createdByUserId: uuid("created_by_user_id").references((): AnyPgColumn => users.id, {
      onDelete: "set null",
    }),
    approvedByUserId: uuid("approved_by_user_id").references((): AnyPgColumn => users.id, {
      onDelete: "set null",
    }),
    origin: origin(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("agent_role_versions_uq").on(t.agentId, t.version),
    uniqueIndex("agent_role_current_uq")
      .on(t.agentId)
      .where(sql`is_current`),
  ],
);

export const teams = pgTable(
  "teams",
  {
    id: id(),
    /** NULL = GLOBAL team. */
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }),
    departmentId: uuid("department_id").references(() => departments.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description"),
    purpose: text("purpose"),
    leaderAgentId: uuid("leader_agent_id").references((): AnyPgColumn => agents.id, {
      onDelete: "set null",
    }),
    concurrencyLimit: integer("concurrency_limit").notNull().default(3),
    defaultTaskTypes: textList("default_task_types"),
    active: boolean("active").notNull().default(true),
    isTemporary: boolean("is_temporary").notNull().default(false),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    origin: origin(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("teams_company_slug_uq").on(t.companyId, t.slug).nullsNotDistinct(),
    check("teams_concurrency_range", sql`${t.concurrencyLimit} BETWEEN 1 AND 100`),
  ],
);

export const teamMembers = pgTable(
  "team_members",
  {
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.teamId, t.agentId] }),
    index("team_members_agent_idx").on(t.agentId),
  ],
);

/** Every delegation / assignment decision, with its explanation. */
export const taskDelegations = pgTable(
  "task_delegations",
  {
    id: id(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }),
    fromAgentId: uuid("from_agent_id").references(() => agents.id, { onDelete: "set null" }),
    toAgentId: uuid("to_agent_id").references(() => agents.id, { onDelete: "set null" }),
    toTeamId: uuid("to_team_id").references(() => teams.id, { onDelete: "set null" }),
    outcome: delegationOutcome("outcome").notNull(),
    /** true when a person chose a target other than the recommendation. */
    override: boolean("override").notNull().default(false),
    reason: text("reason"),
    explanation: jsonb("explanation").$type<string[]>().notNull().default([]),
    decidedByUserId: uuid("decided_by_user_id").references((): AnyPgColumn => users.id, {
      onDelete: "set null",
    }),
    origin: origin(),
    createdAt: createdAt(),
  },
  (t) => [
    index("task_delegations_task_idx").on(t.taskId),
    index("task_delegations_company_idx").on(t.companyId, t.createdAt),
  ],
);

export const handoffs = pgTable(
  "handoffs",
  {
    id: id(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    sourceAgentId: uuid("source_agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    toAgentId: uuid("to_agent_id").references(() => agents.id, { onDelete: "cascade" }),
    toTeamId: uuid("to_team_id").references(() => teams.id, { onDelete: "cascade" }),
    toDepartmentId: uuid("to_department_id").references(() => departments.id, {
      onDelete: "cascade",
    }),
    type: handoffType("type").notNull().default("work_transfer"),
    objective: text("objective").notNull(),
    summary: text("summary").notNull(),
    verifiedFacts: textList("verified_facts"),
    sourceReferences: textList("source_references"),
    knowledgeIds: uuid("knowledge_ids")
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    contactReference: text("contact_reference"),
    actionRequired: text("action_required").notNull(),
    priority: taskPriority("priority").notNull().default("normal"),
    deadline: timestamp("deadline", { withTimezone: true }),
    doNotResearchAgainUnless: textList("do_not_research_again_unless"),
    status: handoffStatus("status").notNull().default("pending"),
    note: text("note"),
    createdByUserId: uuid("created_by_user_id").references((): AnyPgColumn => users.id, {
      onDelete: "set null",
    }),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    origin: origin(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("handoffs_task_idx").on(t.taskId),
    index("handoffs_to_agent_idx").on(t.toAgentId, t.status),
    check(
      "handoffs_one_destination",
      sql`num_nonnulls(${t.toAgentId}, ${t.toTeamId}, ${t.toDepartmentId}) = 1`,
    ),
  ],
);

/** Internal agent messages (manager instructions, requests, status, escalations). */
export const agentMessages = pgTable(
  "agent_messages",
  {
    id: id(),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }),
    senderType: actorType("sender_type").notNull(),
    senderAgentId: uuid("sender_agent_id").references(() => agents.id, { onDelete: "set null" }),
    senderUserId: uuid("sender_user_id").references((): AnyPgColumn => users.id, {
      onDelete: "set null",
    }),
    senderServiceId: text("sender_service_id"),
    recipientAgentId: uuid("recipient_agent_id").references(() => agents.id, {
      onDelete: "cascade",
    }),
    recipientTeamId: uuid("recipient_team_id").references(() => teams.id, { onDelete: "cascade" }),
    taskId: uuid("task_id").references(() => tasks.id, { onDelete: "cascade" }),
    type: agentMessageType("type").notNull(),
    content: text("content").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    readAt: timestamp("read_at", { withTimezone: true }),
    origin: origin(),
    createdAt: createdAt(),
  },
  (t) => [
    index("agent_messages_recipient_idx").on(t.recipientAgentId, t.createdAt),
    index("agent_messages_task_idx").on(t.taskId),
    check(
      "agent_messages_one_recipient",
      sql`num_nonnulls(${t.recipientAgentId}, ${t.recipientTeamId}) = 1`,
    ),
  ],
);

/** Direct human ↔ agent conversation (Stage 04 foundation; no AI replies yet). */
export const conversations = pgTable(
  "conversations",
  {
    id: id(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references((): AnyPgColumn => users.id, { onDelete: "cascade" }),
    taskId: uuid("task_id").references(() => tasks.id, { onDelete: "set null" }),
    title: text("title"),
    status: conversationStatus("status").notNull().default("open"),
    origin: origin(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("conversations_user_idx").on(t.userId, t.agentId)],
);

export const conversationMessages = pgTable(
  "conversation_messages",
  {
    id: id(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    authorUserId: uuid("author_user_id").references((): AnyPgColumn => users.id, {
      onDelete: "set null",
    }),
    content: text("content").notNull(),
    /** Stage 05: the agent run that produced (or answers) this message. */
    runId: uuid("run_id").references((): AnyPgColumn => agentRuns.id, { onDelete: "set null" }),
    provider: providerType("provider"),
    model: text("model"),
    createdAt: createdAt(),
  },
  (t) => [
    index("conversation_messages_idx").on(t.conversationId, t.createdAt),
    check("conversation_messages_role", sql`${t.role} in ('human', 'agent', 'system')`),
  ],
);

/* ---------- AI execution (Stage 05) ---------- */

/** Dated model prices (USD per million tokens). Runs keep a snapshot of the row used. */
export const aiModelPrices = pgTable(
  "ai_model_prices",
  {
    id: id(),
    provider: providerType("provider").notNull(),
    model: text("model").notNull(),
    effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull(),
    inputPerMTok: usd("input_per_mtok").notNull(),
    outputPerMTok: usd("output_per_mtok").notNull(),
    cacheWritePerMTok: usd("cache_write_per_mtok").notNull(),
    cacheReadPerMTok: usd("cache_read_per_mtok").notNull(),
    currency: text("currency").notNull().default("USD"),
    source: text("source"),
    createdAt: createdAt(),
  },
  (t) => [
    unique("ai_model_prices_uq").on(t.provider, t.model, t.effectiveFrom),
    check(
      "ai_model_prices_nonneg",
      sql`${t.inputPerMTok} >= 0 AND ${t.outputPerMTok} >= 0 AND ${t.cacheWritePerMTok} >= 0 AND ${t.cacheReadPerMTok} >= 0`,
    ),
  ],
);

/** Per-provider settings and observed health (never credentials). */
export const aiProviderSettings = pgTable("ai_provider_settings", {
  provider: providerType("provider").primaryKey(),
  enabled: boolean("enabled").notNull().default(true),
  standardModel: text("standard_model"),
  premiumModel: text("premium_model"),
  standardEffort: effortLevel("standard_effort"),
  premiumEffort: effortLevel("premium_effort"),
  dailyBudgetUsd: usd("daily_budget_usd"),
  healthState: providerHealthState("health_state").notNull().default("not_configured"),
  healthDetail: text("health_detail"),
  lastHealthCheckAt: timestamp("last_health_check_at", { withTimezone: true }),
  lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
  lastErrorAt: timestamp("last_error_at", { withTimezone: true }),
  lastErrorCode: text("last_error_code"),
  consecutiveFailures: integer("consecutive_failures").notNull().default(0),
  /** Stage 05A: premium model availability on the subscription (null = unknown). */
  premiumAvailable: boolean("premium_available"),
  /** Last subscription rate-limit state (status, type, resetsAt). */
  rateLimit: jsonb("rate_limit"),
  /** Claude Code CLI facts (version, auth method, plan) — never credentials. */
  cliInfo: jsonb("cli_info"),
  updatedByUserId: uuid("updated_by_user_id").references((): AnyPgColumn => users.id, {
    onDelete: "set null",
  }),
  updatedAt: updatedAt(),
});

/**
 * One agent execution (task run, chat reply or connection test). Final
 * provider output is stored here — separate from task description, context
 * and instructions — so results from different providers can be compared.
 */
export const agentRuns = pgTable(
  "agent_runs",
  {
    id: id(),
    number: integer("number").notNull().default(1),
    executionType: runExecutionType("execution_type").notNull(),
    status: agentRunStatus("status").notNull().default("queued"),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }),
    taskId: uuid("task_id").references((): AnyPgColumn => tasks.id, { onDelete: "set null" }),
    agentId: uuid("agent_id").references((): AnyPgColumn => agents.id, { onDelete: "set null" }),
    conversationId: uuid("conversation_id").references((): AnyPgColumn => conversations.id, {
      onDelete: "set null",
    }),
    /** Stage 06: PRIMARY (ordinary) vs SECOND_OPINION (independent review of another run). */
    runPurpose: runPurpose("run_purpose").notNull().default("primary"),
    /** Set only when run_purpose = 'second_opinion': the run being reviewed. */
    reviewedRunId: uuid("reviewed_run_id").references((): AnyPgColumn => agentRuns.id, {
      onDelete: "cascade",
    }),
    provider: providerType("provider").notNull(),
    model: text("model").notNull(),
    effort: effortLevel("effort"),
    tier: modelTier("tier").notNull().default("standard"),
    responseDetail: responseDetail("response_detail").notNull().default("normal"),
    maxOutputTokens: integer("max_output_tokens").notNull(),
    timeoutMs: integer("timeout_ms").notNull(),
    maxRetries: integer("max_retries").notNull().default(1),
    retryCount: integer("retry_count").notNull().default(0),
    isMock: boolean("is_mock").notNull().default(false),
    startedByUserId: uuid("started_by_user_id").references((): AnyPgColumn => users.id, {
      onDelete: "set null",
    }),
    idempotencyKey: text("idempotency_key"),
    /** Knowledge clearance of the person who started the run: context is capped to it. */
    viewerMaxSensitivity: text("viewer_max_sensitivity").notNull().default("internal"),
    routeReasons: textList("route_reasons"),
    contextVersion: text("context_version"),
    instructionVersion: text("instruction_version"),
    contextSummary: jsonb("context_summary"),
    providerRequestId: text("provider_request_id"),
    providerCallStartedAt: timestamp("provider_call_started_at", { withTimezone: true }),
    responseSavedAt: timestamp("response_saved_at", { withTimezone: true }),
    outputText: text("output_text").notNull().default(""),
    result: jsonb("result"),
    stopReason: text("stop_reason"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    cacheCreationTokens: integer("cache_creation_tokens"),
    cacheReadTokens: integer("cache_read_tokens"),
    estimatedCost: usd("estimated_cost").notNull().default(0),
    /** Lightweight cost reservation: held while active, then settled or released. */
    reservedCost: usd("reserved_cost").notNull().default(0),
    reservationStatus: text("reservation_status").notNull().default("none"),
    actualCost: usd("actual_cost"),
    priceSnapshot: jsonb("price_snapshot"),
    /** Stage 05A transport/billing. Subscription runs keep actual_cost NULL (N/A). */
    transport: text("transport").notNull().default("anthropic_api"),
    billingMode: text("billing_mode").notNull().default("api"),
    apiEquivalentCost: usd("api_equivalent_cost"),
    latencyMs: integer("latency_ms"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    approvalId: uuid("approval_id"),
    createdAt: createdAt(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    cancelRequestedAt: timestamp("cancel_requested_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    origin: origin(),
  },
  (t) => [
    index("agent_runs_task_idx").on(t.taskId, t.createdAt),
    index("agent_runs_agent_idx").on(t.agentId, t.createdAt),
    index("agent_runs_company_idx").on(t.companyId, t.createdAt),
    index("agent_runs_status_idx").on(t.status),
    // Duplicate-run prevention at the database level: one active run per task / conversation.
    uniqueIndex("agent_runs_one_active_task")
      .on(t.taskId)
      .where(
        sql`${t.taskId} is not null and ${t.status} in ('queued','preparing','routing','running','streaming','waiting','cancel_requested')`,
      ),
    uniqueIndex("agent_runs_one_active_conversation")
      .on(t.conversationId)
      .where(
        sql`${t.conversationId} is not null and ${t.status} in ('queued','preparing','routing','running','streaming','waiting','cancel_requested')`,
      ),
    uniqueIndex("agent_runs_idempotency_uq")
      .on(t.idempotencyKey)
      .where(sql`${t.idempotencyKey} is not null`),
    check(
      "agent_runs_reservation",
      sql`${t.reservationStatus} in ('none','active','settled','released')`,
    ),
    check(
      "agent_runs_billing_mode",
      sql`${t.billingMode} in ('subscription','api','none') and (${t.billingMode} <> 'subscription' or (${t.actualCost} is null and ${t.reservedCost} = 0))`,
    ),
    check(
      "agent_runs_purpose",
      sql`${t.runPurpose} <> 'second_opinion' or ${t.reviewedRunId} is not null`,
    ),
    index("agent_runs_reviewed_idx").on(t.reviewedRunId),
  ],
);

/**
 * Stage 06: links a second-opinion review to the run it critiques, for fast
 * dedup ("one active/completed review per run + reviewer provider unless a
 * manual rerun is requested") and future multi-provider comparison. The
 * review's own content (agreements, disagreements, ...) lives on
 * reviewer_run_id's own `agent_runs.result`, never duplicated here.
 */
export const agentRunReviews = pgTable(
  "agent_run_reviews",
  {
    id: id(),
    reviewedRunId: uuid("reviewed_run_id")
      .notNull()
      .references((): AnyPgColumn => agentRuns.id, { onDelete: "cascade" }),
    reviewerRunId: uuid("reviewer_run_id")
      .notNull()
      .unique()
      .references((): AnyPgColumn => agentRuns.id, { onDelete: "cascade" }),
    reviewerProvider: providerType("reviewer_provider").notNull(),
    requestedByUserId: uuid("requested_by_user_id").references((): AnyPgColumn => users.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
  },
  (t) => [
    index("agent_run_reviews_reviewed_idx").on(t.reviewedRunId, t.createdAt),
    index("agent_run_reviews_reviewer_provider_idx").on(t.reviewedRunId, t.reviewerProvider),
  ],
);

/** Observable system events for a run — never model reasoning. */
export const agentRunEvents = pgTable(
  "agent_run_events",
  {
    id: id(),
    runId: uuid("run_id")
      .notNull()
      .references(() => agentRuns.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    type: text("type").notNull(),
    detail: text("detail"),
    data: jsonb("data").notNull().default({}),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("agent_run_events_seq_uq").on(t.runId, t.seq)],
);

/** 👍/👎 feedback on a run (stored for future evaluation; not used automatically). */
export const agentRunFeedback = pgTable(
  "agent_run_feedback",
  {
    id: id(),
    runId: uuid("run_id")
      .notNull()
      .references(() => agentRuns.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references((): AnyPgColumn => users.id, { onDelete: "cascade" }),
    rating: text("rating").notNull(),
    note: text("note"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("agent_run_feedback_uq").on(t.runId, t.userId),
    check("agent_run_feedback_rating", sql`${t.rating} in ('useful','not_useful')`),
  ],
);

/* ---------- relations (for relational queries) ---------- */

export const companiesRelations = relations(companies, ({ many }) => ({
  assignments: many(agentCompanyAssignments),
  tasks: many(tasks),
  departments: many(departments),
}));

export const departmentsRelations = relations(departments, ({ one, many }) => ({
  company: one(companies, { fields: [departments.companyId], references: [companies.id] }),
  agents: many(agents),
}));

export const agentsRelations = relations(agents, ({ one, many }) => ({
  department: one(departments, { fields: [agents.departmentId], references: [departments.id] }),
  reportsTo: one(agents, {
    fields: [agents.reportsToAgentId],
    references: [agents.id],
    relationName: "reporting",
  }),
  assignments: many(agentCompanyAssignments),
  tasks: many(tasks),
}));

export const assignmentsRelations = relations(agentCompanyAssignments, ({ one }) => ({
  agent: one(agents, { fields: [agentCompanyAssignments.agentId], references: [agents.id] }),
  company: one(companies, {
    fields: [agentCompanyAssignments.companyId],
    references: [companies.id],
  }),
}));

export const tasksRelations = relations(tasks, ({ one, many }) => ({
  company: one(companies, { fields: [tasks.companyId], references: [companies.id] }),
  assignedAgent: one(agents, { fields: [tasks.assignedAgentId], references: [agents.id] }),
  parent: one(tasks, {
    fields: [tasks.parentTaskId],
    references: [tasks.id],
    relationName: "hierarchy",
  }),
  children: many(tasks, { relationName: "hierarchy" }),
}));

export type Company = typeof companies.$inferSelect;
export type NewCompany = typeof companies.$inferInsert;
export type Agent = typeof agents.$inferSelect;
export type NewAgent = typeof agents.$inferInsert;
export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;
export type Approval = typeof approvals.$inferSelect;
export type AuditEvent = typeof auditEvents.$inferSelect;
export type Integration = typeof integrations.$inferSelect;
export type Department = typeof departments.$inferSelect;
export type AiUsageRecord = typeof aiUsageRecords.$inferSelect;
export type BudgetPolicy = typeof budgetPolicies.$inferSelect;
export type User = typeof users.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type Role = typeof roles.$inferSelect;
export type CompanyMembership = typeof companyMemberships.$inferSelect;
export type AgentPermissionGrant = typeof agentPermissionGrants.$inferSelect;
export type KnowledgeItem = typeof knowledgeItems.$inferSelect;
export type BrandRule = typeof brandRules.$inferSelect;
export type CommercialRule = typeof commercialRules.$inferSelect;
export type ComplianceRule = typeof complianceRules.$inferSelect;
export type CompanyAiPolicy = typeof companyAiPolicies.$inferSelect;
export type Team = typeof teams.$inferSelect;
export type Handoff = typeof handoffs.$inferSelect;
export type RoleTemplate = typeof roleTemplates.$inferSelect;
export type AgentRoleVersion = typeof agentRoleVersions.$inferSelect;
export type AgentRun = typeof agentRuns.$inferSelect;
export type AiModelPrice = typeof aiModelPrices.$inferSelect;
