/**
 * Stage 03 vocabularies: company knowledge, rules and context assembly.
 * Like enums.ts, these tuples are the single source of truth — the database
 * pgEnums, API schemas and UI labels are all derived from them.
 */

/* ---------- knowledge ---------- */

export const KNOWLEDGE_TYPES = [
  "company_fact",
  "service",
  "product",
  "pricing",
  "policy",
  "brand_rule",
  "faq",
  "sop",
  "compliance",
  "legal",
  "financial",
  "sales",
  "marketing",
  "technical",
  "website",
  "partnership",
  "contact",
  "provider",
  "competitor",
  "market_research",
  "customer_guidance",
  "email_template",
  "communication_rule",
  "document",
  "custom",
] as const;
export type KnowledgeType = (typeof KNOWLEDGE_TYPES)[number];

export const KNOWLEDGE_TYPE_LABELS: Record<KnowledgeType, string> = {
  company_fact: "Company fact",
  service: "Service",
  product: "Product",
  pricing: "Pricing",
  policy: "Policy",
  brand_rule: "Brand rule",
  faq: "FAQ",
  sop: "SOP",
  compliance: "Compliance",
  legal: "Legal",
  financial: "Financial",
  sales: "Sales",
  marketing: "Marketing",
  technical: "Technical",
  website: "Website",
  partnership: "Partnership",
  contact: "Contact",
  provider: "Provider",
  competitor: "Competitor",
  market_research: "Market research",
  customer_guidance: "Customer guidance",
  email_template: "Email template",
  communication_rule: "Communication rule",
  document: "Document",
  custom: "Custom",
};

/** Lifecycle: draft → review → approved → superseded / archived. */
export const KNOWLEDGE_STATUSES = [
  "draft",
  "review",
  "approved",
  "superseded",
  "archived",
] as const;
export type KnowledgeStatus = (typeof KNOWLEDGE_STATUSES)[number];

export const CONFIDENCE_LEVELS = ["low", "medium", "high"] as const;
export type ConfidenceLevel = (typeof CONFIDENCE_LEVELS)[number];

export const VERIFICATION_STATUSES = [
  "unverified",
  "partially_verified",
  "verified",
  "management_confirmed",
] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

export const VERIFICATION_LABELS: Record<VerificationStatus, string> = {
  unverified: "Unverified",
  partially_verified: "Partially verified",
  verified: "Verified",
  management_confirmed: "Management confirmed",
};

/** Provenance — where a knowledge item came from. */
export const KNOWLEDGE_SOURCE_TYPES = [
  "management_entry",
  "company_document",
  "company_website",
  "partner_document",
  "email",
  "google_sheet",
  "web_research",
  "grok_research",
  "claude_research",
  "openai_research",
  "system_generated",
  "import",
  "unknown",
] as const;
export type KnowledgeSourceType = (typeof KNOWLEDGE_SOURCE_TYPES)[number];

export const KNOWLEDGE_SOURCE_LABELS: Record<KnowledgeSourceType, string> = {
  management_entry: "Management entry",
  company_document: "Company document",
  company_website: "Company website",
  partner_document: "Partner document",
  email: "Email",
  google_sheet: "Google Sheet",
  web_research: "Web research",
  grok_research: "Grok research",
  claude_research: "Claude research",
  openai_research: "OpenAI research",
  system_generated: "System generated",
  import: "Import",
  unknown: "Unknown",
};

/**
 * Model/system-produced sources. Such items can never be marked
 * management_confirmed and need explicit human verification before approval.
 */
export const AI_SOURCE_TYPES: readonly KnowledgeSourceType[] = [
  "grok_research",
  "claude_research",
  "openai_research",
  "system_generated",
];

export const isAiSource = (s: KnowledgeSourceType): boolean => AI_SOURCE_TYPES.includes(s);

/** Research-style sources (verified research ranks below official company data). */
export const RESEARCH_SOURCE_TYPES: readonly KnowledgeSourceType[] = [
  "web_research",
  "grok_research",
  "claude_research",
  "openai_research",
];

export const SENSITIVITY_LEVELS = ["public", "internal", "confidential", "restricted"] as const;
export type SensitivityLevel = (typeof SENSITIVITY_LEVELS)[number];

export const sensitivityRank = (s: SensitivityLevel): number => SENSITIVITY_LEVELS.indexOf(s);

/** Human permission needed to read knowledge at a sensitivity (null = knowledge.view suffices). */
export const SENSITIVITY_READ_PERMISSION: Record<SensitivityLevel, string | null> = {
  public: null,
  internal: null,
  confidential: "knowledge.confidential.read",
  restricted: "knowledge.restricted.read",
};

export const KNOWLEDGE_SCOPES = ["company", "global"] as const;
export type KnowledgeScope = (typeof KNOWLEDGE_SCOPES)[number];

export const KNOWLEDGE_LINK_TARGETS = ["task", "agent"] as const;
export type KnowledgeLinkTarget = (typeof KNOWLEDGE_LINK_TARGETS)[number];

/** Derived (never stored) freshness of a knowledge item at a point in time. */
export const FRESHNESS_STATES = ["current", "review_due", "expired", "not_yet_effective"] as const;
export type FreshnessState = (typeof FRESHNESS_STATES)[number];

export function knowledgeFreshness(
  item: {
    effectiveAt: Date | string | null;
    reviewAt: Date | string | null;
    expiresAt: Date | string | null;
  },
  now: Date = new Date(),
): FreshnessState {
  const t = now.getTime();
  const at = (v: Date | string | null) => (v === null ? null : new Date(v).getTime());
  const expires = at(item.expiresAt);
  if (expires !== null && expires <= t) return "expired";
  const effective = at(item.effectiveAt);
  if (effective !== null && effective > t) return "not_yet_effective";
  const review = at(item.reviewAt);
  if (review !== null && review <= t) return "review_due";
  return "current";
}

/* ---------- knowledge precedence ---------- */

export const PRECEDENCE_TIERS = [
  { tier: 1, label: "Management-approved rule or policy" },
  { tier: 2, label: "Approved company profile" },
  { tier: 3, label: "Approved official company document/data" },
  { tier: 4, label: "Approved operating procedure" },
  { tier: 5, label: "Verified company research" },
  { tier: 6, label: "Verified external information" },
  { tier: 7, label: "Unverified research" },
  { tier: 8, label: "Agent/model inference" },
] as const;

const RULE_TYPES: readonly KnowledgeType[] = [
  "policy",
  "brand_rule",
  "communication_rule",
  "compliance",
  "legal",
];
const OFFICIAL_SOURCES: readonly KnowledgeSourceType[] = [
  "management_entry",
  "company_document",
  "company_website",
  "google_sheet",
  "import",
];

/**
 * Deterministic precedence tier (1 = highest authority). Inferences stay at
 * tier 8 until a human verifies them; nothing becomes authoritative silently.
 */
export function knowledgePrecedence(item: {
  type: KnowledgeType;
  sourceType: KnowledgeSourceType;
  status: KnowledgeStatus;
  verificationStatus: VerificationStatus;
}): { tier: number; label: string } {
  const approved = item.status === "approved";
  const verified =
    item.verificationStatus === "verified" || item.verificationStatus === "management_confirmed";
  const pick = (tier: number) => PRECEDENCE_TIERS[tier - 1]!;
  if (isAiSource(item.sourceType) && !verified)
    return pick(item.sourceType === "system_generated" ? 8 : 7);
  if (!approved) return pick(RESEARCH_SOURCE_TYPES.includes(item.sourceType) ? 7 : 8);
  if (item.sourceType === "management_entry" && RULE_TYPES.includes(item.type)) return pick(1);
  if (item.type === "sop" && OFFICIAL_SOURCES.includes(item.sourceType)) return pick(4);
  if (OFFICIAL_SOURCES.includes(item.sourceType)) return pick(3);
  if (
    verified &&
    (RESEARCH_SOURCE_TYPES.includes(item.sourceType) || item.sourceType === "system_generated")
  )
    return pick(5);
  if (verified) return pick(6);
  return pick(7);
}

/* ---------- rules ---------- */

export const RULE_STATUSES = ["draft", "approved", "archived"] as const;
export type RuleStatus = (typeof RULE_STATUSES)[number];

export const RULE_SEVERITIES = ["info", "required", "critical"] as const;
export type RuleSeverity = (typeof RULE_SEVERITIES)[number];

export const RULE_KINDS = ["brand", "commercial", "compliance"] as const;
export type RuleKind = (typeof RULE_KINDS)[number];

export const BRAND_RULE_CATEGORIES = [
  "voice",
  "tone",
  "positioning",
  "visual",
  "claims",
  "prohibited_terms",
  "approved_terms",
  "call_to_action",
  "social_media",
  "email",
  "website",
  "advertising",
  "custom",
] as const;
export type BrandRuleCategory = (typeof BRAND_RULE_CATEGORIES)[number];

export const RULE_CHANNELS = [
  "all",
  "email",
  "social_media",
  "website",
  "advertising",
  "sales",
  "support",
  "internal",
] as const;
export type RuleChannel = (typeof RULE_CHANNELS)[number];

export const COMMERCIAL_RULE_CATEGORIES = [
  "pricing",
  "discount",
  "payment",
  "refund",
  "revenue_target",
  "financial_approval",
  "advertising_budget",
  "sales_restriction",
  "custom",
] as const;
export type CommercialRuleCategory = (typeof COMMERCIAL_RULE_CATEGORIES)[number];

/** What a commercial rule does when its action is attempted. */
export const COMMERCIAL_RULE_EFFECTS = ["info", "limit", "require_approval", "prohibit"] as const;
export type CommercialRuleEffect = (typeof COMMERCIAL_RULE_EFFECTS)[number];

export const RULE_PERIODS = ["per_action", "day", "week", "month", "quarter", "year"] as const;
export type RulePeriod = (typeof RULE_PERIODS)[number];

/** IF company AND action THEN effect. */
export const COMPLIANCE_EFFECTS = [
  "info",
  "require_approval",
  "prohibit",
  "require_disclosure",
] as const;
export type ComplianceEffect = (typeof COMPLIANCE_EFFECTS)[number];

/** Namespaced action key a rule applies to, e.g. `meta.budget_increase`, or `*`. */
export const RULE_ACTION_PATTERN = /^(\*|[a-z_]+(\.[a-z_*]+)*)$/;

/* ---------- AI operations policy ---------- */

export const AI_POLICY_MODES = ["disabled", "approval_required", "allowed"] as const;
export type AiPolicyMode = (typeof AI_POLICY_MODES)[number];

export const AI_POLICY_MODE_LABELS: Record<AiPolicyMode, string> = {
  disabled: "Disabled",
  approval_required: "Human approval required",
  allowed: "Allowed within policy",
};

/** How the context engine treats expired knowledge. */
export const STALE_KNOWLEDGE_POLICIES = ["exclude", "mark_stale"] as const;
export type StaleKnowledgePolicy = (typeof STALE_KNOWLEDGE_POLICIES)[number];

/* ---------- context engine ---------- */

export const CONTEXT_BUDGETS = ["small", "standard", "large", "custom"] as const;
export type ContextBudget = (typeof CONTEXT_BUDGETS)[number];

/** Approximate character budgets (≈ 4 characters per token). */
export const CONTEXT_BUDGET_CHARS: Record<Exclude<ContextBudget, "custom">, number> = {
  small: 6_000,
  standard: 16_000,
  large: 40_000,
};

export const CONTEXT_VERSION = "ctx-1";
