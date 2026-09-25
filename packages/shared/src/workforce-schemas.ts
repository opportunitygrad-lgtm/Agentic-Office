import { z } from "zod";
import { AGENT_TEMPLATE_KEYS, PROVIDER_TYPES, TASK_PRIORITIES, TASK_TYPES } from "./enums";
import { uuidSchema } from "./schemas";
import { AGENT_CAPABILITIES, AGENT_MESSAGE_TYPES, HANDOFF_TYPES } from "./workforce";

const line = (max = 300) => z.string().trim().min(1).max(max);
const lines = (maxItems = 20, max = 300) => z.array(line(max)).max(maxItems);
const slugRef = z
  .string()
  .trim()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .max(64);

/* ---------- permanent agent role (structured instructions) ---------- */

export const agentRoleSchema = z.strictObject({
  identity: z.strictObject({
    roleName: line(120),
    mission: line(1000),
  }),
  responsibilities: z.strictObject({
    primary: lines(),
    secondary: lines(),
  }),
  behaviours: z.strictObject({
    workflow: lines(),
    requiredChecks: lines(),
    requiredContext: lines(),
  }),
  prohibited: z.strictObject({
    actions: lines(),
    belongsElsewhere: lines(),
    dataNotAccessed: lines(),
  }),
  delegation: z.strictObject({
    mayDelegate: z.boolean(),
    /** Template keys this role may delegate to (empty = any eligible agent). */
    allowedDelegates: z.array(z.enum(AGENT_TEMPLATE_KEYS)).max(17),
    /** Department slugs this role may delegate to (empty = any). */
    allowedDepartments: z.array(slugRef).max(20),
    maxDepth: z.number().int().min(0).max(5),
    conditions: lines(),
  }),
  handoff: z.strictObject({
    destinations: z
      .array(
        z.strictObject({
          department: slugRef,
          when: line(300),
          requiredFields: lines(12, 120),
          stopAfterHandoff: z.boolean(),
          continueMonitoring: z.boolean(),
        }),
      )
      .max(10),
  }),
  research: z.strictObject({
    /** null = no role-specific limit (company/global limits still apply). */
    maxSearches: z.number().int().min(0).max(500).nullable(),
    maxRetries: z.number().int().min(0).max(5),
    deepResearch: z.enum(["never", "approval", "allowed"]),
    stopCondition: z.string().trim().max(500),
  }),
  cost: z.strictObject({
    maxTaskBudget: z.number().min(0).max(10_000).nullable(),
    providerPreference: z.array(z.enum(PROVIDER_TYPES)).max(4),
    escalationThreshold: z.number().min(0).max(10_000).nullable(),
  }),
  completion: z.strictObject({
    definitionOfDone: lines(),
    stopConditions: lines(),
    resultFormat: z.string().trim().max(1000),
  }),
  /** Agent permissions this role expects to use (checked against authority — authority wins). */
  expectedTools: z.array(z.string().regex(/^(tool|action)\.[a-z_.]+$/)).max(30),
  /** Optional additive free text (lowest priority within the role). */
  freeText: z.string().trim().max(4000),
});
export type AgentRole = z.infer<typeof agentRoleSchema>;

export const saveAgentRoleSchema = z.strictObject({
  role: agentRoleSchema,
  changeSummary: line(500),
});

export const roleTemplateUpdateSchema = z.strictObject({
  name: line(120).optional(),
  capabilities: z.array(z.enum(AGENT_CAPABILITIES)).max(26).optional(),
  role: agentRoleSchema.optional(),
});

/* ---------- workforce structure ---------- */

export const workforcePolicySchema = z.strictObject({
  globalActiveAgentLimit: z.number().int().min(1).max(200),
  maxDelegationDepth: z.number().int().min(0).max(10),
  highCostTaskThresholdUsd: z.number().min(0).max(10_000),
  tempAgentMaxExpiryHours: z
    .number()
    .int()
    .min(1)
    .max(24 * 90),
  tempAgentApprovalBudgetUsd: z.number().min(0).max(10_000),
  maxActiveTempAgentsPerCompany: z.number().int().min(0).max(200),
});
export type WorkforcePolicyInput = z.infer<typeof workforcePolicySchema>;

export const departmentUpdateSchema = z.strictObject({
  mission: z.string().trim().max(1000).nullable().optional(),
  description: z.string().trim().max(1000).nullable().optional(),
  managerAgentId: uuidSchema.nullable().optional(),
  humanManagerUserId: uuidSchema.nullable().optional(),
  defaultProvider: z.enum(PROVIDER_TYPES).nullable().optional(),
  concurrencyLimit: z.number().int().min(1).max(100).nullable().optional(),
  dailyBudgetUsd: z.number().min(0).max(10_000).nullable().optional(),
  active: z.boolean().optional(),
  instructions: lines(30, 500).optional(),
  allowedTaskTypes: z.array(z.enum(TASK_TYPES)).max(12).optional(),
  handoffDestinations: z.array(slugRef).max(20).optional(),
});

const teamFields = {
  name: line(120),
  description: z.string().trim().max(1000).nullable().default(null),
  purpose: z.string().trim().max(1000).nullable().default(null),
  departmentId: uuidSchema.nullable().default(null),
  leaderAgentId: uuidSchema.nullable().default(null),
  concurrencyLimit: z.number().int().min(1).max(100).default(3),
  defaultTaskTypes: z.array(z.enum(TASK_TYPES)).max(12).default([]),
  active: z.boolean().default(true),
  isTemporary: z.boolean().default(false),
  expiresAt: z.coerce.date().nullable().default(null),
};

export const createTeamSchema = z.strictObject({
  /** null = GLOBAL team (needs global team.manage). */
  companyId: uuidSchema.nullable(),
  ...teamFields,
  memberIds: z.array(uuidSchema).max(50).default([]),
});
export type CreateTeamInput = z.input<typeof createTeamSchema>;

export const updateTeamSchema = z
  .strictObject({
    name: line(120),
    description: z.string().trim().max(1000).nullable(),
    purpose: z.string().trim().max(1000).nullable(),
    departmentId: uuidSchema.nullable(),
    leaderAgentId: uuidSchema.nullable(),
    concurrencyLimit: z.number().int().min(1).max(100),
    defaultTaskTypes: z.array(z.enum(TASK_TYPES)).max(12),
    active: z.boolean(),
    expiresAt: z.coerce.date().nullable(),
  })
  .partial();

export const teamMembersSchema = z.strictObject({ memberIds: z.array(uuidSchema).max(50) });

export const agentHierarchySchema = z.strictObject({
  reportsToAgentId: uuidSchema.nullable(),
  escalationAgentId: uuidSchema.nullable(),
  fallbackManagerId: uuidSchema.nullable(),
});

export const agentCapabilitiesSchema = z.strictObject({
  capabilities: z.array(z.enum(AGENT_CAPABILITIES)).max(26),
});

/* ---------- tasks ---------- */

export const taskRequirementsSchema = z.strictObject({
  requiredCapabilities: z.array(z.enum(AGENT_CAPABILITIES)).max(10).default([]),
  preferredDepartmentId: uuidSchema.nullable().default(null),
  preferredAgentId: uuidSchema.nullable().default(null),
  preferredTeamId: uuidSchema.nullable().default(null),
  providerPreference: z.enum(PROVIDER_TYPES).nullable().default(null),
  maxBudget: z.number().min(0).max(10_000).nullable().default(null),
  maxConcurrency: z.number().int().min(1).max(50).nullable().default(null),
  delegationAllowed: z.boolean().default(true),
  parallelAllowed: z.boolean().default(false),
  externalActionAllowed: z.boolean().default(false),
  approvalRequirements: z.array(z.string().trim().max(60)).max(10).default([]),
  resultSchema: z.string().trim().max(2000).nullable().default(null),
  stoppingCondition: z.string().trim().max(500).nullable().default(null),
  expectedOutcome: z.string().trim().max(500).nullable().default(null),
  /** Entity the task is about (e.g. "school:lisbon-aviation") — used for duplicate detection. */
  targetEntity: z.string().trim().toLowerCase().max(200).nullable().default(null),
  /** Rough number of items to process (e.g. 200 schools) — used for temporary-worker decisions. */
  workItems: z.number().int().min(0).max(100_000).nullable().default(null),
});
export type TaskRequirementsInput = z.input<typeof taskRequirementsSchema>;

export const createWorkforceTaskSchema = z.strictObject({
  companyId: uuidSchema,
  title: line(300),
  description: z.string().trim().max(8000).nullable().default(null),
  type: z.enum(TASK_TYPES).default("custom"),
  priority: z.enum(TASK_PRIORITIES).default("normal"),
  dueAt: z.coerce.date().nullable().default(null),
  parentTaskId: uuidSchema.nullable().default(null),
  requirements: taskRequirementsSchema.default(taskRequirementsSchema.parse({})),
  /** What to do when a duplicate exists: reuse (default), or create anyway after review. */
  onDuplicate: z.enum(["reuse", "create"]).default("reuse"),
});
export type CreateWorkforceTaskInput = z.input<typeof createWorkforceTaskSchema>;

export const delegateTaskSchema = z.strictObject({
  /** Accept the engine's recommendation, or choose an explicit target (override). */
  targetAgentId: uuidSchema.optional(),
  targetTeamId: uuidSchema.optional(),
  requestingAgentId: uuidSchema.optional(),
  reason: z.string().trim().max(500).optional(),
});

export const assignTaskSchema = z.strictObject({
  agentId: uuidSchema,
  reason: z.string().trim().max(500).optional(),
});

/* ---------- temporary agents ---------- */

export const temporaryAgentSchema = z.strictObject({
  parentAgentId: uuidSchema,
  companyId: uuidSchema,
  taskId: uuidSchema,
  name: line(120),
  purpose: line(500),
  capabilities: z.array(z.enum(AGENT_CAPABILITIES)).min(1).max(10),
  /** Agent permissions requested for the worker (never more than the parent can delegate). */
  permissions: z.array(z.string().regex(/^(tool|action)\.[a-z_.]+$/)).max(20),
  expiresInHours: z
    .number()
    .int()
    .min(1)
    .max(24 * 90),
  budgetUsd: z.number().min(0).max(1_000),
  concurrencyLimit: z.number().int().min(1).max(5).default(1),
  /** Only when explicitly permitted may a temporary worker create further workers. */
  maySpawnTemporary: z.boolean().default(false),
});
export type TemporaryAgentInput = z.input<typeof temporaryAgentSchema>;

/* ---------- handoffs, messages, conversations ---------- */

export const createHandoffSchema = z
  .strictObject({
    taskId: uuidSchema,
    sourceAgentId: uuidSchema,
    toAgentId: uuidSchema.nullable().default(null),
    toTeamId: uuidSchema.nullable().default(null),
    toDepartmentId: uuidSchema.nullable().default(null),
    type: z.enum(HANDOFF_TYPES).default("work_transfer"),
    objective: line(500),
    summary: line(4000),
    verifiedFacts: lines(30, 1000).default([]),
    sourceReferences: lines(30, 500).default([]),
    /** Knowledge items carried as evidence (checked for company + sensitivity). */
    knowledgeIds: z.array(uuidSchema).max(30).default([]),
    /** Reference to contact data (e.g. a CRM/lead id) — never the data itself. */
    contactReference: z.string().trim().max(300).nullable().default(null),
    actionRequired: line(1000),
    priority: z.enum(TASK_PRIORITIES).default("normal"),
    deadline: z.coerce.date().nullable().default(null),
    doNotResearchAgainUnless: lines(10, 300).default([]),
  })
  .refine((v) => [v.toAgentId, v.toTeamId, v.toDepartmentId].filter(Boolean).length === 1, {
    message: "Hand off to exactly one agent, team or department",
    path: ["toAgentId"],
  });
export type CreateHandoffInput = z.input<typeof createHandoffSchema>;

export const HANDOFF_ACTIONS = ["accept", "reject", "complete", "cancel"] as const;
export type HandoffAction = (typeof HANDOFF_ACTIONS)[number];

export const handoffActionSchema = z.strictObject({ note: z.string().trim().max(1000).optional() });

export const createAgentMessageSchema = z
  .strictObject({
    recipientAgentId: uuidSchema.nullable().default(null),
    recipientTeamId: uuidSchema.nullable().default(null),
    taskId: uuidSchema.nullable().default(null),
    type: z.enum(AGENT_MESSAGE_TYPES).default("task_instruction"),
    content: line(4000),
    payload: z.record(z.string(), z.unknown()).default({}),
  })
  .refine((v) => Boolean(v.recipientAgentId) !== Boolean(v.recipientTeamId), {
    message: "Address exactly one agent or team",
    path: ["recipientAgentId"],
  });

export const createConversationSchema = z.strictObject({
  agentId: uuidSchema,
  companyId: uuidSchema,
  taskId: uuidSchema.nullable().default(null),
  title: z.string().trim().max(200).nullable().default(null),
});

export const conversationMessageSchema = z.strictObject({ content: line(4000) });

export const instructionPreviewQuery = z.object({
  company: z.string().trim().max(64).optional(),
  task: uuidSchema.optional(),
});
