/**
 * ─────────────────────────────────────────────────────────────────────────
 *  DEVELOPMENT SEED DATA ONLY — Stage 03 company knowledge & rules.
 *  Known high-level information only: no invented statistics, approvals,
 *  testimonials, partnerships or prices. Everything is stored with
 *  origin = 'dev_seed', is editable in the UI, and is reset by `pnpm db:seed`.
 * ─────────────────────────────────────────────────────────────────────────
 */
import type {
  AiPolicyInput,
  BrandRuleCategory,
  CommercialRuleCategory,
  CommercialRuleEffect,
  ComplianceEffect,
  KnowledgeSourceType,
  KnowledgeStatus,
  KnowledgeType,
  RuleChannel,
  RulePeriod,
  RuleSeverity,
  SensitivityLevel,
  VerificationStatus,
} from "@aibos/shared";

const EPT = "euro-pilot-training";
const PA = "pilotsassist";
const OG = "opportunitygrad";

/** Structured profile fields applied to the dev-seed companies. */
export const SEED_PROFILES: Record<string, Record<string, unknown>> = {
  [EPT]: {
    industry: "European Pilot Training / Aviation Education",
    description: "Premium European-focused pilot training brand.",
    brandPositioning: "Premium European-focused pilot training brand.",
    brandPersonality: "Premium, European, credible, modern, aviation-focused, aspirational",
    brandVoice: "Confident and precise; aspirational without hype",
    brandTone: "Premium, European, credible, modern, aviation-focused, aspirational",
    primaryObjective:
      "Develop suitable European flight-school partnerships and convert qualified students into training enrolments.",
    targetAudiences: [
      "Indian pilot-training candidates",
      "Asian pilot-training candidates",
      "Middle Eastern pilot-training candidates",
      "International pilot-training candidates",
    ],
    salesChannels: ["Direct enquiries"],
    marketingChannels: ["Website", "Social media"],
    prohibitedPhrases: ["cheap", "budget agency", "discount education agency"],
    claimsRequiringEvidence: ["Any statement about a flight school's approvals or accreditation"],
    companyRules: ["Do not position as a cheap education agency"],
    dataHandlingRules: ["Student documents stay within Euro Pilot Training systems"],
  },
  [PA]: {
    industry: "Aviation Services / Pilot Training",
    website: "https://pilotsassist.com",
    description: "Aviation services and pilot training.",
    brandPositioning: "Premium global aviation career/service partner.",
    brandPersonality: "Premium, knowledgeable, dependable",
    productsServices: [
      "Airplane pilot training",
      "Helicopter pilot training",
      "Type ratings",
      "Ground schooling",
      "Training finance facilitation",
      "Corporate pilot training",
      "Aircraft sales",
      "Aircraft spares",
      "Charters",
      "Aviation-related services",
    ],
    products: ["Aircraft", "Aircraft spares"],
    claimsRequiringEvidence: ["Regulatory approvals", "Student outcomes", "Partnerships"],
    companyRules: [
      "Never invent regulatory approvals, testimonials, student outcomes, partnerships or statistics",
    ],
  },
  [OG]: {
    industry: "International Education / Overseas Education Consultancy",
    description: "International education and overseas education consultancy.",
    productsServices: [
      "International university counselling",
      "Applications",
      "Admissions support",
      "Visa assistance",
      "Document processing",
      "Education-loan facilitation",
      "Student recruitment",
    ],
    primaryObjective:
      "Generate qualified enquiries and enrolments rather than cheap unqualified leads.",
    marketingChannels: ["Meta (Facebook / Instagram)", "Website"],
    prohibitedPhrases: ["guaranteed admission", "guaranteed visa"],
    claimsRequiringEvidence: ["Any named university relationship"],
    companyRules: [
      "Never promise admission or visa outcomes",
      "Do not invent university partnerships",
    ],
  },
};

export const SEED_AI_POLICIES: Record<string, Omit<AiPolicyInput, "defaultProvider">> = {
  [EPT]: {
    allowedProviders: ["CLAUDE", "OPENAI", "GROK", "LOCAL"],
    defaultResearchLimit: 25,
    deepResearchPolicy: "approval_required",
    externalActionPolicy: "approval_required",
    browserPolicy: "approval_required",
    autoSendPolicy: "disabled",
    // EPT keeps expired items visible but clearly marked STALE.
    staleKnowledgePolicy: "mark_stale",
    customRules: ["Cite the knowledge item id for every factual statement about a flight school"],
  },
  [PA]: {
    allowedProviders: ["CLAUDE", "OPENAI", "LOCAL"],
    defaultResearchLimit: 15,
    deepResearchPolicy: "approval_required",
    externalActionPolicy: "approval_required",
    browserPolicy: "disabled",
    autoSendPolicy: "disabled",
    staleKnowledgePolicy: "exclude",
    customRules: [],
  },
  [OG]: {
    allowedProviders: ["CLAUDE", "OPENAI", "GROK", "LOCAL"],
    defaultResearchLimit: 20,
    deepResearchPolicy: "approval_required",
    externalActionPolicy: "approval_required",
    browserPolicy: "approval_required",
    autoSendPolicy: "disabled",
    staleKnowledgePolicy: "exclude",
    customRules: ["Optimise for qualified enquiries, not lead volume"],
  },
};

export interface SeedKnowledge {
  key: string;
  /** null = GLOBAL. */
  company: string | null;
  title: string;
  summary?: string;
  content: string;
  type: KnowledgeType;
  tags: string[];
  department?: string;
  sourceType: KnowledgeSourceType;
  sourceReference?: string;
  status: KnowledgeStatus;
  verification: VerificationStatus;
  confidence?: "low" | "medium" | "high";
  sensitivity?: SensitivityLevel;
  usableAsUnverified?: boolean;
  conflictKey?: string;
  /** Days relative to now (negative = past). */
  expiresInDays?: number;
  reviewInDays?: number;
  verifiedDaysAgo?: number;
}

export const SEED_KNOWLEDGE: SeedKnowledge[] = [
  /* ---- GLOBAL ---- */
  {
    key: "global-isolation",
    company: null,
    title: "Company data isolation",
    summary:
      "Never use or disclose one company's information in work for another company, even when the same people own both.",
    content:
      "AI Business OS runs several companies. Each company's knowledge, customers, pricing and plans are private to that company. Agents must never use, compare or disclose one company's information in work for another company unless management explicitly authorises a cross-company task.",
    type: "policy",
    tags: ["security", "isolation"],
    sourceType: "management_entry",
    status: "approved",
    verification: "management_confirmed",
    confidence: "high",
    verifiedDaysAgo: 3,
  },
  {
    key: "global-source-of-truth",
    company: null,
    title: "AI output is not a source of truth",
    summary:
      "Model-generated information is a draft until a human verifies and approves it. Cite approved knowledge; label anything unverified.",
    content:
      "The database holds authoritative company state. Anything an AI model produces — research, summaries, inferences — is DRAFT or UNVERIFIED until a human verifies and approves it. When answering, rely on approved knowledge and clearly label unverified information.",
    type: "policy",
    tags: ["ai", "governance"],
    sourceType: "management_entry",
    status: "approved",
    verification: "management_confirmed",
    confidence: "high",
    verifiedDaysAgo: 3,
  },

  /* ---- EURO PILOT TRAINING ---- */
  {
    key: "ept-overview",
    company: EPT,
    title: "What Euro Pilot Training does",
    summary:
      "Premium European-focused pilot training brand serving Indian, Asian, Middle Eastern and international pilot-training candidates.",
    content:
      "Euro Pilot Training is a premium European-focused pilot training brand. Its primary audience is Indian, Asian, Middle Eastern and international pilot-training candidates. The objective is to develop suitable European flight-school partnerships and convert qualified students into training enrolments.",
    type: "company_fact",
    tags: ["overview", "positioning"],
    sourceType: "management_entry",
    status: "approved",
    verification: "management_confirmed",
    confidence: "high",
    verifiedDaysAgo: 5,
  },
  {
    key: "ept-partnership-policy",
    company: EPT,
    title: "Flight-school partnership approach",
    summary:
      "Only pursue partnerships with suitable European flight schools; verify every approval claim before it is used.",
    content:
      "Partnership outreach targets suitable European flight schools. Any statement about a school's approvals, accreditation or capacity must be verified against an official source before it is used in communication. Partnership terms are negotiated by management — agents prepare drafts only.",
    type: "partnership",
    tags: ["partners", "partnership", "email"],
    department: "partnerships",
    sourceType: "management_entry",
    status: "approved",
    verification: "management_confirmed",
    confidence: "high",
    verifiedDaysAgo: 10,
  },
  {
    key: "ept-enquiry-standards",
    company: EPT,
    title: "Enquiry reply standards",
    summary:
      "Reply in a premium, credible tone; qualify the candidate; never quote fees that are not in approved pricing knowledge.",
    content:
      "Replies to training enquiries must be premium, credible and aspirational. Qualify the candidate (goals, background, timeline) before recommending a pathway. Never quote fees or dates unless they come from approved, current pricing knowledge. Drafts are reviewed by a human before sending.",
    type: "communication_rule",
    tags: ["email", "enquiries", "communication"],
    department: "communications",
    sourceType: "management_entry",
    status: "approved",
    verification: "management_confirmed",
    confidence: "high",
    verifiedDaysAgo: 12,
  },
  {
    key: "ept-fee-guidance",
    company: EPT,
    title: "Training fee guidance (expired placeholder)",
    summary: "Placeholder: confirm current fees with management before quoting any figure.",
    content:
      "DEVELOPMENT SEED PLACEHOLDER — no real fees are recorded. This item has passed its expiry date to demonstrate stale-knowledge handling: agents must not present it as current.",
    type: "pricing",
    tags: ["pricing", "enquiries"],
    sourceType: "management_entry",
    status: "approved",
    verification: "verified",
    confidence: "low",
    conflictKey: "pricing:training-fees",
    expiresInDays: -2,
    verifiedDaysAgo: 120,
  },
  {
    key: "ept-school-research",
    company: EPT,
    title: "Candidate European flight schools — research notes",
    summary: "Unverified research notes awaiting verification against official registers.",
    content:
      "Research in progress: candidate European flight schools are being collected for partnership review. Nothing here is verified; every approval claim must be checked against the official register before use.",
    type: "market_research",
    tags: ["research", "partners"],
    department: "research",
    sourceType: "claude_research",
    status: "review",
    verification: "unverified",
    confidence: "low",
    usableAsUnverified: true,
  },
  {
    key: "ept-banking",
    company: EPT,
    title: "Banking and payment details",
    summary: "RESTRICTED — held by finance; never included in marketing or communication context.",
    content:
      "DEVELOPMENT SEED PLACEHOLDER — no real banking details are stored. Payment details are provided by the finance team on request only.",
    type: "financial",
    tags: ["finance", "banking"],
    sourceType: "management_entry",
    status: "approved",
    verification: "management_confirmed",
    sensitivity: "restricted",
    verifiedDaysAgo: 30,
  },
  {
    key: "ept-brand-draft",
    company: EPT,
    title: "Social media voice notes (draft)",
    content: "Draft guidance for social posts — not yet approved, so agents do not receive it.",
    type: "brand_rule",
    tags: ["social", "brand"],
    sourceType: "management_entry",
    status: "draft",
    verification: "unverified",
  },

  /* ---- PILOTSASSIST ---- */
  {
    key: "pa-overview",
    company: PA,
    title: "What PilotsAssist does",
    summary:
      "Aviation services and pilot training (pilotsassist.com): training, type ratings, finance facilitation, aircraft sales, spares and charters.",
    content:
      "PilotsAssist (pilotsassist.com) is a premium global aviation career and service partner. Services include airplane pilot training, helicopter pilot training, type ratings, ground schooling, training finance facilitation, corporate pilot training, aircraft sales, aircraft spares, charters and other aviation-related services.",
    type: "company_fact",
    tags: ["overview", "services"],
    sourceType: "company_website",
    sourceReference: "pilotsassist.com",
    status: "approved",
    verification: "management_confirmed",
    confidence: "high",
    verifiedDaysAgo: 7,
  },
  {
    key: "pa-claims-policy",
    company: PA,
    title: "Claims policy",
    summary:
      "Never invent regulatory approvals, testimonials, student outcomes, partnerships or statistics.",
    content:
      "PilotsAssist communication must never invent regulatory approvals, testimonials, student outcomes, partnerships or statistics. If a claim cannot be supported by approved knowledge, leave it out.",
    type: "policy",
    tags: ["claims", "marketing", "compliance"],
    sourceType: "management_entry",
    status: "approved",
    verification: "management_confirmed",
    confidence: "high",
    verifiedDaysAgo: 7,
  },
  {
    key: "pa-finance-guidance",
    company: PA,
    title: "Describing training finance facilitation",
    summary: "Describe finance as facilitation; never promise approval or rates.",
    content:
      "Training finance is described as facilitation. Never promise that finance will be approved and never quote rates unless they come from approved knowledge.",
    type: "customer_guidance",
    tags: ["finance", "sales", "enquiries"],
    sourceType: "management_entry",
    status: "approved",
    verification: "management_confirmed",
    confidence: "high",
    sensitivity: "confidential",
    verifiedDaysAgo: 20,
  },

  /* ---- OPPORTUNITYGRAD ---- */
  {
    key: "og-overview",
    company: OG,
    title: "What Opportunitygrad does",
    summary:
      "Overseas education consultancy: counselling, applications, admissions, visas, documents, education loans and student recruitment.",
    content:
      "Opportunitygrad is an international education / overseas education consultancy. Services include international university counselling, applications, admissions support, visa assistance, document processing, education-loan facilitation and student recruitment.",
    type: "company_fact",
    tags: ["overview", "services"],
    sourceType: "management_entry",
    status: "approved",
    verification: "management_confirmed",
    confidence: "high",
    verifiedDaysAgo: 4,
  },
  {
    key: "og-marketing-objective",
    company: OG,
    title: "Marketing objective: qualified enquiries",
    summary: "Optimise for qualified enquiries and enrolments, not cheap unqualified leads.",
    content:
      "Opportunitygrad marketing aims for qualified enquiries and enrolments rather than cheap unqualified leads. Judge campaigns on lead quality and enrolment potential, not cost per lead alone.",
    type: "marketing",
    tags: ["marketing", "advertising", "meta"],
    department: "marketing",
    sourceType: "management_entry",
    status: "approved",
    verification: "management_confirmed",
    confidence: "high",
    verifiedDaysAgo: 4,
  },
  {
    key: "og-no-partnerships",
    company: OG,
    title: "University relationships",
    summary:
      "Do not invent university partnerships; only name institutions from approved knowledge.",
    content:
      "Never state or imply a partnership with a university unless it is recorded in approved knowledge. Never promise admission or visa outcomes.",
    type: "policy",
    tags: ["claims", "marketing", "compliance"],
    sourceType: "management_entry",
    status: "approved",
    verification: "management_confirmed",
    confidence: "high",
    verifiedDaysAgo: 4,
  },
  {
    key: "og-response-a",
    company: OG,
    title: "Enquiry response time (DEV SEED EXAMPLE A)",
    content:
      "Development seed example for conflict detection: respond to new enquiries within one business day.",
    type: "sop",
    tags: ["enquiries", "sales"],
    sourceType: "management_entry",
    status: "approved",
    verification: "verified",
    conflictKey: "sop:enquiry-response-time",
    verifiedDaysAgo: 9,
  },
  {
    key: "og-response-b",
    company: OG,
    title: "Enquiry response time (DEV SEED EXAMPLE B)",
    content:
      "Development seed example for conflict detection: respond to new enquiries within two business days.",
    type: "sop",
    tags: ["enquiries", "sales"],
    sourceType: "import",
    sourceReference: "Legacy operations handbook (dev seed)",
    status: "approved",
    verification: "partially_verified",
    conflictKey: "sop:enquiry-response-time",
    reviewInDays: -5,
    verifiedDaysAgo: 200,
  },
];

export interface SeedRule {
  company: string | null;
  kind: "brand" | "commercial" | "compliance";
  title: string;
  description: string;
  severity: RuleSeverity;
  status?: "draft" | "approved";
  // brand
  category?: BrandRuleCategory | CommercialRuleCategory;
  channel?: RuleChannel;
  // commercial
  appliesTo?: string;
  effect?: CommercialRuleEffect | ComplianceEffect;
  limitAmount?: number;
  currency?: string;
  period?: RulePeriod;
  requiredPermission?: string;
  // compliance
  action?: string;
  disclosureText?: string;
}

export const SEED_RULES: SeedRule[] = [
  {
    company: null,
    kind: "compliance",
    title: "No cross-company disclosure",
    description:
      "Information from one company must never be used or disclosed in work for another company.",
    severity: "critical",
    action: "*",
    effect: "info",
  },
  {
    company: EPT,
    kind: "brand",
    title: "Premium aviation presentation",
    description:
      "Present Euro Pilot Training as premium, European, credible, modern, aviation-focused and aspirational. Do not use cheap, generic education-agency positioning.",
    severity: "critical",
    category: "positioning",
  },
  {
    company: EPT,
    kind: "brand",
    title: "Email voice",
    description: "Confident, precise and personal; no hype, no pressure tactics.",
    severity: "required",
    category: "email",
    channel: "email",
  },
  {
    company: EPT,
    kind: "compliance",
    title: "Partner communication needs approval",
    description:
      "Outbound emails to flight schools or candidates require human approval before sending.",
    severity: "required",
    action: "email.send",
    effect: "require_approval",
    requiredPermission: "approval.external_send",
  },
  {
    company: PA,
    kind: "brand",
    title: "No invented claims",
    description:
      "Never invent regulatory approvals, testimonials, student outcomes, partnerships or statistics.",
    severity: "critical",
    category: "claims",
  },
  {
    company: PA,
    kind: "compliance",
    title: "Finance facilitation disclosure",
    description:
      "Any message that mentions training finance must include the facilitation disclosure.",
    severity: "required",
    action: "email.*",
    effect: "require_disclosure",
    disclosureText: "Finance is facilitated through third parties and approval is not guaranteed.",
  },
  {
    company: OG,
    kind: "commercial",
    title: "Meta budget increase limit",
    description:
      "Automatic campaign/ad-set budget increases must not exceed ₹100 within the configured policy period without appropriate management approval.",
    severity: "critical",
    category: "advertising_budget",
    appliesTo: "meta.budget_increase",
    effect: "limit",
    limitAmount: 100,
    currency: "INR",
    period: "day",
    requiredPermission: "approval.financial",
  },
  {
    company: OG,
    kind: "brand",
    title: "No outcome guarantees",
    description:
      "Never promise admission or visa outcomes and never invent university partnerships.",
    severity: "critical",
    category: "claims",
  },
  {
    company: OG,
    kind: "brand",
    title: "Advertising tone",
    description: "Warm, clear and trustworthy; speak to serious applicants, not bargain hunters.",
    severity: "required",
    category: "advertising",
    channel: "advertising",
  },
  {
    company: OG,
    kind: "commercial",
    title: "Discount authority (draft)",
    description: "Only management may offer fee discounts.",
    severity: "required",
    status: "draft",
    category: "discount",
    appliesTo: "sales.discount",
    effect: "require_approval",
    requiredPermission: "approval.financial",
  },
];

/** Explicit knowledge links (knowledge key → task or agent key). */
export const SEED_LINKS: { knowledge: string; task?: string; agent?: string }[] = [
  { knowledge: "ept-partnership-policy", task: "ept-email" },
  { knowledge: "ept-enquiry-standards", task: "email-reply" },
  { knowledge: "og-marketing-objective", agent: "og-marketing-meta" },
];

/** Tasks allowed to use clearly-labelled UNVERIFIED research. */
export const SEED_UNVERIFIED_TASKS = ["ept-research"];
