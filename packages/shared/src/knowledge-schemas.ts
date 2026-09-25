import { z } from "zod";
import { PROVIDER_TYPES } from "./enums";
import {
  AI_POLICY_MODES,
  BRAND_RULE_CATEGORIES,
  COMMERCIAL_RULE_CATEGORIES,
  COMMERCIAL_RULE_EFFECTS,
  COMPLIANCE_EFFECTS,
  CONFIDENCE_LEVELS,
  CONTEXT_BUDGETS,
  FRESHNESS_STATES,
  KNOWLEDGE_SCOPES,
  KNOWLEDGE_SOURCE_TYPES,
  KNOWLEDGE_STATUSES,
  KNOWLEDGE_TYPES,
  RULE_ACTION_PATTERN,
  RULE_CHANNELS,
  RULE_PERIODS,
  RULE_SEVERITIES,
  SENSITIVITY_LEVELS,
  STALE_KNOWLEDGE_POLICIES,
  VERIFICATION_STATUSES,
  isAiSource,
} from "./knowledge";
import { countrySchema, uuidSchema, websiteSchema } from "./schemas";

const text = (max: number) => z.string().trim().max(max);
const requiredText = (label: string, max = 200) =>
  z.string().trim().min(1, `${label} is required`).max(max);
const list = (maxItems = 50, maxLen = 300) =>
  z.array(z.string().trim().min(1).max(maxLen)).max(maxItems);
/** Optional nullable text: "" clears the field. */
const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .transform((v) => (v ? v : null));
const optDate = z.coerce.date().nullable();
const tagSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(40)
  .regex(/^[a-z0-9][a-z0-9 _-]*$/, "Tags use letters, numbers, spaces, - and _");
const actionKey = z
  .string()
  .trim()
  .max(80)
  .regex(RULE_ACTION_PATTERN, "Use a namespaced action such as meta.budget_increase, or *");
const conflictKey = z
  .string()
  .trim()
  .toLowerCase()
  .max(120)
  .regex(/^[a-z0-9_.:-]+$/, "Use lowercase letters, numbers and . _ : -");

/* ---------- company profile sections (strict: unknown keys are rejected) ---------- */

export const profileIdentitySchema = z.strictObject({
  name: requiredText("Company name", 120),
  legalName: optText(200),
  tradingName: optText(200),
  website: websiteSchema.nullable().or(z.literal("").transform(() => null)),
  industry: requiredText("Industry", 120),
  description: optText(4000),
  primaryCountry: countrySchema,
  countriesServed: z.array(countrySchema).max(250),
  timezone: z.string().trim().min(1).max(64),
  defaultCurrency: z
    .string()
    .trim()
    .regex(/^[A-Z]{3}$/, "Currency must be a 3-letter ISO code"),
  contactEmail: z
    .email("Enter a valid email")
    .max(200)
    .nullable()
    .or(z.literal("").transform(() => null)),
  contactPhone: optText(60),
  contactAddress: optText(500),
  registrationNumber: optText(120),
  taxIdentifier: optText(120),
});

export const profileBusinessSchema = z.strictObject({
  products: list(),
  productsServices: list(),
  targetAudiences: list(),
  targetMarkets: list(),
  revenueModel: optText(1000),
  primaryObjective: optText(500),
  secondaryObjectives: list(20, 500),
  salesChannels: list(),
  marketingChannels: list(),
});

export const profileBrandSchema = z.strictObject({
  brandPositioning: optText(2000),
  brandPersonality: optText(1000),
  brandVoice: optText(1000),
  brandTone: optText(500),
  visualGuidance: optText(2000),
  approvedPhrases: list(),
  prohibitedPhrases: list(),
  claimsAllowed: list(),
  claimsRequiringEvidence: list(),
  prohibitedClaims: list(),
  competitorNotes: optText(4000),
});

export const profileComplianceSchema = z.strictObject({
  jurisdictions: list(),
  regulators: list(),
  legalDisclaimers: list(20, 1000),
  dataHandlingRules: list(20, 1000),
  companyRules: list(),
  complianceNotes: optText(4000),
});

export const PROFILE_SECTIONS = ["identity", "business", "brand", "compliance"] as const;
export type ProfileSection = (typeof PROFILE_SECTIONS)[number];

export const profileSectionSchemas = {
  identity: profileIdentitySchema,
  business: profileBusinessSchema,
  brand: profileBrandSchema,
  compliance: profileComplianceSchema,
} as const;

/** Required human permission per profile section (compliance is a policy area). */
export const PROFILE_SECTION_PERMISSION: Record<ProfileSection, string> = {
  identity: "company.edit",
  business: "company.edit",
  brand: "company.edit",
  compliance: "policy.manage",
};

export const aiPolicySchema = z
  .strictObject({
    defaultProvider: z.enum(PROVIDER_TYPES),
    allowedProviders: z.array(z.enum(PROVIDER_TYPES)).min(1, "Allow at least one provider").max(4),
    defaultResearchLimit: z.number().int().min(0).max(500),
    deepResearchPolicy: z.enum(AI_POLICY_MODES),
    externalActionPolicy: z.enum(AI_POLICY_MODES),
    browserPolicy: z.enum(AI_POLICY_MODES),
    autoSendPolicy: z.enum(AI_POLICY_MODES),
    staleKnowledgePolicy: z.enum(STALE_KNOWLEDGE_POLICIES),
    customRules: list(30, 500),
    /** Stage 05 provider policy (optional so older clients keep working; no defaults on edit). */
    defaultModelTier: z.enum(["standard", "premium", "auto"]).optional(),
    premiumAllowed: z.boolean().optional(),
    maxResponseDetail: z.enum(["short", "normal", "detailed", "custom"]).optional(),
    fallbackAllowed: z.boolean().optional(),
  })
  .refine((v) => v.allowedProviders.includes(v.defaultProvider), {
    message: "The default provider must be one of the allowed providers",
    path: ["defaultProvider"],
  });
export type AiPolicyInput = z.input<typeof aiPolicySchema>;

/* ---------- knowledge ---------- */

const knowledgeFields = {
  title: requiredText("Title", 200),
  summary: optText(1000),
  content: requiredText("Content", 20_000),
  type: z.enum(KNOWLEDGE_TYPES),
  category: optText(80),
  tags: z.array(tagSchema).max(20),
  departmentId: uuidSchema.nullable(),
  sourceType: z.enum(KNOWLEDGE_SOURCE_TYPES),
  sourceReference: optText(300),
  sourceUrl: websiteSchema.nullable().or(z.literal("").transform(() => null)),
  sourceFileRef: optText(300),
  sourceOwner: optText(200),
  provenanceNotes: optText(2000),
  confidence: z.enum(CONFIDENCE_LEVELS),
  verificationStatus: z.enum(VERIFICATION_STATUSES),
  sensitivity: z.enum(SENSITIVITY_LEVELS),
  usableAsUnverified: z.boolean(),
  effectiveAt: optDate,
  reviewAt: optDate,
  expiresAt: optDate,
  lastVerifiedAt: optDate,
  conflictKey: conflictKey.nullable().or(z.literal("").transform(() => null)),
};

/** Creation defaults (Zod 4 applies defaults even to optional keys, so edits use none). */
const knowledgeCreateFields = {
  ...knowledgeFields,
  summary: knowledgeFields.summary.default(null),
  category: knowledgeFields.category.default(null),
  tags: knowledgeFields.tags.default([]),
  departmentId: knowledgeFields.departmentId.default(null),
  sourceReference: knowledgeFields.sourceReference.default(null),
  sourceUrl: knowledgeFields.sourceUrl.default(null),
  sourceFileRef: knowledgeFields.sourceFileRef.default(null),
  sourceOwner: knowledgeFields.sourceOwner.default(null),
  provenanceNotes: knowledgeFields.provenanceNotes.default(null),
  confidence: knowledgeFields.confidence.default("medium"),
  verificationStatus: knowledgeFields.verificationStatus.default("unverified"),
  sensitivity: knowledgeFields.sensitivity.default("internal"),
  usableAsUnverified: knowledgeFields.usableAsUnverified.default(false),
  effectiveAt: optDate.default(null),
  reviewAt: optDate.default(null),
  expiresAt: optDate.default(null),
  lastVerifiedAt: optDate.default(null),
  conflictKey: knowledgeFields.conflictKey.default(null),
};

function knowledgeRefinements<
  T extends z.ZodType<{
    sourceType: (typeof KNOWLEDGE_SOURCE_TYPES)[number];
    verificationStatus?: (typeof VERIFICATION_STATUSES)[number];
    effectiveAt?: Date | null;
    expiresAt?: Date | null;
  }>,
>(schema: T) {
  return schema
    .refine((v) => !(isAiSource(v.sourceType) && v.verificationStatus === "management_confirmed"), {
      message: "AI or system generated information cannot be management confirmed",
      path: ["verificationStatus"],
    })
    .refine((v) => !(v.effectiveAt && v.expiresAt && v.expiresAt <= v.effectiveAt), {
      message: "Expiry must be after the effective date",
      path: ["expiresAt"],
    });
}

export const createKnowledgeSchema = knowledgeRefinements(
  z
    .strictObject({
      scope: z.enum(KNOWLEDGE_SCOPES).default("company"),
      companyId: uuidSchema.nullable().default(null),
      ...knowledgeCreateFields,
    })
    .refine((v) => (v.scope === "global" ? v.companyId === null : v.companyId !== null), {
      message: "Company knowledge needs a company; global knowledge must not have one",
      path: ["companyId"],
    }),
);
export type CreateKnowledgeInput = z.input<typeof createKnowledgeSchema>;

/** Edits. Scope/company can never change after creation. */
export const updateKnowledgeSchema = z
  .strictObject(
    Object.fromEntries(
      Object.entries(knowledgeFields).map(([k, v]) => [k, (v as z.ZodType).optional()]),
    ) as { [K in keyof typeof knowledgeFields]: z.ZodOptional<(typeof knowledgeFields)[K]> },
  )
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to update" });
export type UpdateKnowledgeInput = z.input<typeof updateKnowledgeSchema>;

/** Fields whose change on an APPROVED item creates a new version instead of overwriting. */
export const MATERIAL_KNOWLEDGE_FIELDS = [
  "title",
  "summary",
  "content",
  "type",
  "sourceType",
  "sourceReference",
  "sourceUrl",
  "sourceFileRef",
  "sensitivity",
  "effectiveAt",
  "expiresAt",
  "conflictKey",
  "departmentId",
] as const;

export const knowledgeApproveSchema = z.strictObject({
  verificationStatus: z.enum(VERIFICATION_STATUSES).optional(),
  notes: text(1000).optional(),
});

export const knowledgeNotesSchema = z.strictObject({ notes: text(1000).optional() });

export const knowledgeSupersedeSchema = z.strictObject({
  replacementId: uuidSchema.optional(),
  notes: text(1000).optional(),
});

export const knowledgeLinkSchema = z
  .strictObject({
    taskId: uuidSchema.optional(),
    agentId: uuidSchema.optional(),
    note: text(300).optional(),
  })
  .refine((v) => Boolean(v.taskId) !== Boolean(v.agentId), {
    message: "Link exactly one task or agent",
  });

const csv = <T extends readonly [string, ...string[]]>(values: T) =>
  z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v.split(",").filter(Boolean) : undefined))
    .pipe(z.array(z.enum(values)).optional());

export const listKnowledgeQuery = z.object({
  company: z.string().trim().max(64).optional(),
  scope: z.enum([...KNOWLEDGE_SCOPES, "all"]).default("all"),
  q: z.string().trim().max(200).optional(),
  type: csv(KNOWLEDGE_TYPES),
  status: csv(KNOWLEDGE_STATUSES),
  confidence: csv(CONFIDENCE_LEVELS),
  verification: csv(VERIFICATION_STATUSES),
  source: csv(KNOWLEDGE_SOURCE_TYPES),
  sensitivity: csv(SENSITIVITY_LEVELS),
  freshness: csv(FRESHNESS_STATES),
  tag: z.string().trim().toLowerCase().max(40).optional(),
  category: z.string().trim().max(80).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});
export type ListKnowledgeQuery = z.output<typeof listKnowledgeQuery>;

/* ---------- rules ---------- */

const ruleCommon = {
  title: requiredText("Title", 200),
  description: requiredText("Description", 4000),
  severity: z.enum(RULE_SEVERITIES).default("required"),
  active: z.boolean().default(true),
};

export const brandRuleSchema = z.strictObject({
  ...ruleCommon,
  category: z.enum(BRAND_RULE_CATEGORIES),
  channel: z.enum(RULE_CHANNELS).default("all"),
});

export const commercialRuleSchema = z
  .strictObject({
    ...ruleCommon,
    category: z.enum(COMMERCIAL_RULE_CATEGORIES),
    appliesTo: actionKey,
    effect: z.enum(COMMERCIAL_RULE_EFFECTS),
    limitAmount: z.number().finite().min(0).max(1e12).nullable().default(null),
    currency: z
      .string()
      .trim()
      .regex(/^[A-Z]{3}$/, "Currency must be a 3-letter ISO code")
      .nullable()
      .default(null),
    period: z.enum(RULE_PERIODS).nullable().default(null),
    requiredPermission: z
      .string()
      .trim()
      .regex(/^[a-z_]+(\.[a-z_]+)+$/)
      .nullable()
      .default(null),
  })
  .refine((v) => v.effect !== "limit" || (v.limitAmount !== null && v.currency !== null), {
    message: "A limit needs an amount and currency",
    path: ["limitAmount"],
  });

export const complianceRuleSchema = z
  .strictObject({
    ...ruleCommon,
    action: actionKey,
    jurisdiction: optText(80).default(null),
    effect: z.enum(COMPLIANCE_EFFECTS),
    disclosureText: optText(2000).default(null),
    requiredPermission: z
      .string()
      .trim()
      .regex(/^[a-z_]+(\.[a-z_]+)+$/)
      .nullable()
      .default(null),
  })
  .refine((v) => v.effect !== "require_disclosure" || !!v.disclosureText, {
    message: "A disclosure rule needs the disclosure text",
    path: ["disclosureText"],
  });

export const RULE_SCHEMAS = {
  brand: brandRuleSchema,
  commercial: commercialRuleSchema,
  compliance: complianceRuleSchema,
} as const;

/** Partial edits: validated against the full schema after merging with the stored rule. */
export const ruleUpdateSchema = z.record(z.string(), z.unknown());

export const RULE_ACTIONS = ["approve", "archive", "restore"] as const;
export type RuleAction = (typeof RULE_ACTIONS)[number];

/* ---------- agent knowledge profile & access policies ---------- */

export const agentKnowledgeProfileSchema = z.strictObject({
  requiredTypes: z.array(z.enum(KNOWLEDGE_TYPES)).max(25),
  preferredTags: z.array(tagSchema).max(30),
  brandCategories: z.array(z.enum(BRAND_RULE_CATEGORIES)).max(13),
  commercialCategories: z.array(z.enum(COMMERCIAL_RULE_CATEGORIES)).max(9),
});
export type AgentKnowledgeProfileInput = z.input<typeof agentKnowledgeProfileSchema>;

export const knowledgeAccessPolicySchema = z.strictObject({
  agentId: uuidSchema.nullable().default(null),
  departmentId: uuidSchema.nullable().default(null),
  maxSensitivity: z.enum(["confidential", "restricted"]),
  note: optText(300).default(null),
});

/* ---------- context ---------- */

export const contextPreviewQuery = z.object({
  company: z.string().trim().max(64).optional(),
  task: uuidSchema.optional(),
  agent: uuidSchema.optional(),
  budget: z.enum(CONTEXT_BUDGETS).default("standard"),
  maxChars: z.coerce.number().int().min(1_000).max(200_000).optional(),
  capability: z.string().trim().max(60).optional(),
  categories: csv(KNOWLEDGE_TYPES),
});
