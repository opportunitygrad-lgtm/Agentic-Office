/**
 * AI Business OS — database schema (Drizzle ORM, PostgreSQL 16).
 * See docs/DATA_MODEL.md for the entity overview and design rationale.
 */
import { relations, sql } from "drizzle-orm";
import {
  boolean,
  check,
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
} from "@aibos/shared";

/* ---------- enums (sourced from @aibos/shared) ---------- */

export const providerType = pgEnum("provider_type", PROVIDER_TYPES);
export const companyStatus = pgEnum("company_status", COMPANY_STATUSES);
export const agentStatus = pgEnum("agent_status", AGENT_STATUSES);
export const agentScope = pgEnum("agent_scope", AGENT_SCOPES);
export const autonomyLevel = pgEnum("autonomy_level", AUTONOMY_LEVELS);
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
  defaultAutonomy: autonomyLevel("default_autonomy").notNull(),
  responsibilities: textList("responsibilities"),
  defaultTools: textList("default_tools"),
  prohibitedActions: textList("prohibited_actions"),
  approvalRequirements: textList("approval_requirements"),
  capabilities: textList("capabilities"),
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
    autonomyLevel: autonomyLevel("autonomy_level").notNull().default("suggest"),
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
    /** Future: FK to users (Stage 02). Free-text actor reference until then. */
    decidedBy: text("decided_by"),
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
    actorUser: text("actor_user"),
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
