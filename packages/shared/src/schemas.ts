import { z } from "zod";
import {
  AGENT_SCOPES,
  AGENT_STATUSES,
  AGENT_TEMPLATE_KEYS,
  APPROVAL_TYPES,
  AUDIT_OUTCOMES,
  AUTONOMY_LEVELS,
  ACTOR_KINDS,
  ACTOR_TYPES,
  PROVIDER_TYPES,
  RISK_LEVELS,
  TASK_PRIORITIES,
  TASK_STATUSES,
  TASK_TYPES,
} from "./enums";

/** Hard ceilings that protect against fat-finger budgets. Raise deliberately. */
export const LIMITS = {
  maxDailyBudgetUsd: 10_000,
  maxMonthlyBudgetUsd: 250_000,
  maxConcurrency: 50,
  maxListItems: 50,
} as const;

const trimmed = (max: number) => z.string().trim().max(max);
const requiredText = (label: string, max = 200) =>
  z.string().trim().min(1, `${label} is required`).max(max);
const stringList = (maxItems = 50, maxLen = 300) =>
  z.array(z.string().trim().min(1).max(maxLen)).max(maxItems).default([]);

export const slugSchema = z
  .string()
  .trim()
  .min(2)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug must be lowercase letters, numbers and hyphens");

export const uuidSchema = z.uuid();

/** ISO-4217 currency (e.g. EUR, GBP, USD). */
export const currencySchema = z
  .string()
  .trim()
  .regex(/^[A-Z]{3}$/, "Currency must be a 3-letter ISO code");

/** ISO-3166 alpha-2 country (e.g. IE, GB, US). */
export const countrySchema = z
  .string()
  .trim()
  .regex(/^[A-Z]{2}$/, "Country must be a 2-letter ISO code");

export const timezoneSchema = z
  .string()
  .trim()
  .min(1, "Timezone is required")
  .refine((tz) => {
    try {
      new Intl.DateTimeFormat("en-GB", { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }, "Unknown IANA timezone");

export const websiteSchema = z
  .string()
  .trim()
  .max(300)
  .refine((v) => {
    try {
      const u = new URL(v);
      return u.protocol === "https:" || u.protocol === "http:";
    } catch {
      return false;
    }
  }, "Website must be a valid http(s) URL");

/** Budgets are expressed in USD because provider billing is USD-denominated. */
export const dailyBudgetSchema = z
  .number({ error: "Daily budget must be a number" })
  .finite()
  .min(0, "Budget cannot be negative")
  .max(LIMITS.maxDailyBudgetUsd, `Daily budget cannot exceed ${LIMITS.maxDailyBudgetUsd} USD`);

export const monthlyBudgetSchema = z
  .number({ error: "Monthly budget must be a number" })
  .finite()
  .min(0, "Budget cannot be negative")
  .max(
    LIMITS.maxMonthlyBudgetUsd,
    `Monthly budget cannot exceed ${LIMITS.maxMonthlyBudgetUsd} USD`,
  );

export const concurrencySchema = z
  .number({ error: "Concurrency must be a number" })
  .int("Concurrency must be a whole number")
  .min(1, "Concurrency must be at least 1")
  .max(LIMITS.maxConcurrency, `Concurrency cannot exceed ${LIMITS.maxConcurrency}`);

/**
 * Structured, versioned company settings (stored as JSONB). New settings are
 * added here with defaults so older rows remain valid without migrations.
 */
export const companySettingsSchema = z
  .object({
    version: z.literal(1).default(1),
    approvals: z
      .object({
        highCostTasks: z.boolean().default(true),
        deepResearch: z.boolean().default(true),
      })
      .default({ highCostTasks: true, deepResearch: true }),
  })
  .loose();
export type CompanySettings = z.infer<typeof companySettingsSchema>;

export const companyIdentitySchema = z.object({
  name: requiredText("Company name", 120),
  legalName: trimmed(200).optional(),
  website: websiteSchema.optional(),
  industry: requiredText("Industry", 120),
  primaryCountry: countrySchema,
  timezone: timezoneSchema,
  defaultCurrency: currencySchema,
});

export const companyBusinessSchema = z.object({
  productsServices: stringList(),
  targetAudiences: stringList(),
  targetMarkets: stringList(),
  countriesServed: z.array(countrySchema).max(250).default([]),
  primaryObjective: trimmed(500).optional(),
  revenueObjective: trimmed(500).optional(),
  description: trimmed(4000).optional(),
});

export const companyBrandSchema = z.object({
  brandPositioning: trimmed(2000).optional(),
  brandTone: trimmed(500).optional(),
  companyRules: stringList(),
  prohibitedClaims: stringList(),
  competitorNotes: trimmed(4000).optional(),
  complianceNotes: trimmed(4000).optional(),
});

export const companyAiSchema = z
  .object({
    defaultProvider: z.enum(PROVIDER_TYPES).default("CLAUDE"),
    dailyAiBudget: dailyBudgetSchema,
    monthlyAiBudget: monthlyBudgetSchema,
    concurrencyLimit: concurrencySchema,
    requireApprovalHighCost: z.boolean().default(true),
    requireApprovalDeepResearch: z.boolean().default(true),
  })
  .refine((v) => v.monthlyAiBudget >= v.dailyAiBudget, {
    message: "Monthly budget must be at least the daily budget",
    path: ["monthlyAiBudget"],
  });

export const createCompanySchema = z
  .object({
    slug: slugSchema.optional(),
    accentColor: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .optional(),
    logoUrl: trimmed(500).optional(),
    initialAgents: z.array(z.enum(AGENT_TEMPLATE_KEYS)).max(20).default([]),
  })
  .and(companyIdentitySchema)
  .and(companyBusinessSchema)
  .and(companyBrandSchema)
  .and(companyAiSchema);
export type CreateCompanyInput = z.input<typeof createCompanySchema>;
export type CreateCompany = z.output<typeof createCompanySchema>;

export const createAgentSchema = z.object({
  name: requiredText("Agent name", 120),
  slug: slugSchema.optional(),
  description: trimmed(2000).optional(),
  templateKey: z.enum(AGENT_TEMPLATE_KEYS),
  scope: z.enum(AGENT_SCOPES).default("company"),
  status: z.enum(AGENT_STATUSES).default("sleeping"),
  departmentId: uuidSchema.optional(),
  reportsToAgentId: uuidSchema.optional(),
  companyIds: z.array(uuidSchema).max(100).default([]),
  primaryProvider: z.enum(PROVIDER_TYPES).default("CLAUDE"),
  fallbackProvider: z.enum(PROVIDER_TYPES).optional(),
  preferredModel: trimmed(120).optional(),
  autonomyLevel: z.enum(AUTONOMY_LEVELS).default("observe"),
  isTemporary: z.boolean().default(false),
  perTaskBudget: dailyBudgetSchema.default(2),
  dailyBudget: dailyBudgetSchema.default(10),
  maxExternalSearches: z.number().int().min(0).max(500).default(20),
  maxRetries: z.number().int().min(0).max(10).default(2),
  concurrencyLimit: concurrencySchema.default(1),
});
export type CreateAgentInput = z.input<typeof createAgentSchema>;

export const createTaskSchema = z.object({
  companyId: uuidSchema.optional(),
  title: requiredText("Task title", 300),
  description: trimmed(8000).optional(),
  type: z.enum(TASK_TYPES).default("custom"),
  priority: z.enum(TASK_PRIORITIES).default("normal"),
  status: z.enum(TASK_STATUSES).default("queued"),
  assignedAgentId: uuidSchema.optional(),
  parentTaskId: uuidSchema.optional(),
  createdByKind: z.enum(ACTOR_KINDS).default("human"),
  createdByRef: trimmed(200).optional(),
  requiredProvider: z.enum(PROVIDER_TYPES).optional(),
  estimatedCost: z.number().min(0).max(LIMITS.maxDailyBudgetUsd).optional(),
  requiresApproval: z.boolean().default(false),
  progress: z.number().int().min(0).max(100).default(0),
  dueAt: z.coerce.date().optional(),
});
export type CreateTaskInput = z.input<typeof createTaskSchema>;

export const createApprovalSchema = z.object({
  companyId: uuidSchema.optional(),
  taskId: uuidSchema.optional(),
  agentId: uuidSchema.optional(),
  type: z.enum(APPROVAL_TYPES),
  requestedAction: requiredText("Requested action", 500),
  explanation: trimmed(4000).optional(),
  riskLevel: z.enum(RISK_LEVELS).default("medium"),
  proposedChange: z.record(z.string(), z.unknown()).optional(),
  beforeState: z.record(z.string(), z.unknown()).optional(),
  afterState: z.record(z.string(), z.unknown()).optional(),
  expiresAt: z.coerce.date().optional(),
});
export type CreateApprovalInput = z.input<typeof createApprovalSchema>;

export const createAuditEventSchema = z.object({
  actorType: z.enum(ACTOR_TYPES).default("system"),
  actorUserId: uuidSchema.optional(),
  actorServiceId: trimmed(80).optional(),
  resourceType: trimmed(80).optional(),
  resourceId: trimmed(200).optional(),
  companyId: uuidSchema.optional(),
  agentId: uuidSchema.optional(),
  taskId: uuidSchema.optional(),
  actorUser: trimmed(200).optional(),
  action: z
    .string()
    .trim()
    .regex(/^[a-z_]+(\.[a-z_]+)+$/, "Action must be namespaced, e.g. company.created"),
  tool: trimmed(120).optional(),
  provider: z.enum(PROVIDER_TYPES).optional(),
  description: requiredText("Description", 2000),
  metadata: z.record(z.string(), z.unknown()).default({}),
  before: z.record(z.string(), z.unknown()).optional(),
  after: z.record(z.string(), z.unknown()).optional(),
  outcome: z.enum(AUDIT_OUTCOMES).default("success"),
  error: trimmed(4000).optional(),
  ipAddress: trimmed(64).optional(),
  sessionId: trimmed(200).optional(),
  userAgent: trimmed(500).optional(),
  requestId: trimmed(200).optional(),
});
export type CreateAuditEventInput = z.input<typeof createAuditEventSchema>;

export const setAgentCompaniesSchema = z.object({
  companyIds: z.array(uuidSchema).max(100),
  primaryCompanyId: uuidSchema.optional(),
});

/* ---------- query schemas ---------- */

export const companyScopeQuery = z.object({
  /** Company slug or id. Omitted / "all" = global view. */
  company: z.string().trim().max(64).optional(),
});

export const listAgentsQuery = companyScopeQuery.extend({
  status: z.enum(AGENT_STATUSES).optional(),
  department: z.string().trim().max(64).optional(),
  provider: z.enum(PROVIDER_TYPES).optional(),
  q: z.string().trim().max(120).optional(),
});

export const listTasksQuery = companyScopeQuery.extend({
  status: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v.split(",").filter(Boolean) : undefined))
    .pipe(z.array(z.enum(TASK_STATUSES)).optional()),
  agent: uuidSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

export const listApprovalsQuery = companyScopeQuery.extend({
  status: z.enum(["pending", "approved", "rejected", "expired", "cancelled"]).optional(),
});

export const listAuditQuery = companyScopeQuery.extend({
  limit: z.coerce.number().int().min(1).max(500).default(100),
});
