/**
 * Stage 03 API shapes: company profile, knowledge library, rules and
 * Agent Context Packs. JSON-serialised (dates are ISO strings).
 */
import type {
  AutonomyLevel,
  DataOrigin,
  ProviderType,
  TaskPriority,
  TaskStatus,
  TaskType,
} from "./enums";
import type { AuditEventDTO, CompanyDTO, CompanyRef } from "./dto";
import type {
  AiPolicyMode,
  BrandRuleCategory,
  CommercialRuleCategory,
  CommercialRuleEffect,
  ComplianceEffect,
  ConfidenceLevel,
  ContextBudget,
  FreshnessState,
  KnowledgeScope,
  KnowledgeSourceType,
  KnowledgeStatus,
  KnowledgeType,
  RuleChannel,
  RuleKind,
  RulePeriod,
  RuleSeverity,
  RuleStatus,
  SensitivityLevel,
  StaleKnowledgePolicy,
  VerificationStatus,
} from "./knowledge";

export interface PersonRef {
  id: string;
  name: string;
}

/* ---------- company profile ---------- */

export interface CompanyProfileFields {
  tradingName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  contactAddress: string | null;
  registrationNumber: string | null;
  taxIdentifier: string | null;
  products: string[];
  revenueModel: string | null;
  secondaryObjectives: string[];
  salesChannels: string[];
  marketingChannels: string[];
  brandPersonality: string | null;
  brandVoice: string | null;
  visualGuidance: string | null;
  approvedPhrases: string[];
  prohibitedPhrases: string[];
  claimsAllowed: string[];
  claimsRequiringEvidence: string[];
  jurisdictions: string[];
  regulators: string[];
  legalDisclaimers: string[];
  dataHandlingRules: string[];
}

export interface CompanyAiPolicyDTO {
  defaultProvider: ProviderType;
  allowedProviders: ProviderType[];
  defaultResearchLimit: number;
  deepResearchPolicy: AiPolicyMode;
  externalActionPolicy: AiPolicyMode;
  browserPolicy: AiPolicyMode;
  autoSendPolicy: AiPolicyMode;
  staleKnowledgePolicy: StaleKnowledgePolicy;
  customRules: string[];
  updatedAt: string | null;
}

export interface CompanyProfileDTO {
  company: CompanyDTO & CompanyProfileFields;
  aiPolicy: CompanyAiPolicyDTO;
  stats: {
    knowledge: Record<KnowledgeStatus, number>;
    stale: number;
    conflicts: number;
    rules: { brand: number; commercial: number; compliance: number; critical: number };
  };
  viewer: {
    canEdit: boolean;
    canManagePolicy: boolean;
    canApprovePolicy: boolean;
    canManageSettings: boolean;
    canCreateKnowledge: boolean;
    canApproveKnowledge: boolean;
    canManageAgentAccess: boolean;
    canPreviewContext: boolean;
  };
}

/* ---------- knowledge ---------- */

export interface KnowledgeItemDTO {
  id: string;
  company: CompanyRef | null;
  scope: KnowledgeScope;
  department: { id: string; name: string } | null;
  title: string;
  summary: string | null;
  content: string;
  type: KnowledgeType;
  category: string | null;
  tags: string[];
  sourceType: KnowledgeSourceType;
  sourceReference: string | null;
  sourceUrl: string | null;
  sourceFileRef: string | null;
  sourceOwner: string | null;
  provenanceNotes: string | null;
  confidence: ConfidenceLevel;
  verificationStatus: VerificationStatus;
  status: KnowledgeStatus;
  sensitivity: SensitivityLevel;
  usableAsUnverified: boolean;
  effectiveAt: string | null;
  reviewAt: string | null;
  expiresAt: string | null;
  lastVerifiedAt: string | null;
  freshness: FreshnessState;
  precedence: { tier: number; label: string };
  version: number;
  lineageId: string;
  supersedesId: string | null;
  supersededById: string | null;
  conflictKey: string | null;
  createdBy: PersonRef | null;
  updatedBy: PersonRef | null;
  approvedBy: PersonRef | null;
  approvedAt: string | null;
  submittedAt: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  origin: DataOrigin;
  /** Ids of approved items that potentially conflict with this one. */
  conflictsWith: string[];
}

export interface KnowledgeVersionDTO {
  id: string;
  version: number;
  status: KnowledgeStatus;
  title: string;
  createdBy: PersonRef | null;
  approvedBy: PersonRef | null;
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeLinkDTO {
  id: string;
  target: "task" | "agent";
  targetId: string;
  label: string;
  note: string | null;
  createdAt: string;
}

export interface KnowledgeDetailDTO {
  item: KnowledgeItemDTO;
  versions: KnowledgeVersionDTO[];
  links: KnowledgeLinkDTO[];
  history: AuditEventDTO[];
  conflicts: KnowledgeItemDTO[];
  viewer: { canEdit: boolean; canApprove: boolean; canArchive: boolean };
}

export interface KnowledgeConflictDTO {
  conflictKey: string;
  items: KnowledgeItemDTO[];
}

export interface KnowledgeListDTO {
  data: KnowledgeItemDTO[];
  facets: {
    tags: string[];
    categories: string[];
    total: number;
    stale: number;
    conflicts: number;
    hiddenBySensitivity: number;
  };
}

/* ---------- rules ---------- */

interface RuleBase {
  id: string;
  kind: RuleKind;
  companyId: string | null;
  title: string;
  description: string;
  severity: RuleSeverity;
  active: boolean;
  status: RuleStatus;
  createdBy: PersonRef | null;
  approvedBy: PersonRef | null;
  approvedAt: string | null;
  updatedAt: string;
  origin: DataOrigin;
}

export interface BrandRuleDTO extends RuleBase {
  kind: "brand";
  category: BrandRuleCategory;
  channel: RuleChannel;
}

export interface CommercialRuleDTO extends RuleBase {
  kind: "commercial";
  category: CommercialRuleCategory;
  appliesTo: string;
  effect: CommercialRuleEffect;
  limitAmount: number | null;
  currency: string | null;
  period: RulePeriod | null;
  requiredPermission: string | null;
}

export interface ComplianceRuleDTO extends RuleBase {
  kind: "compliance";
  action: string;
  jurisdiction: string | null;
  effect: ComplianceEffect;
  disclosureText: string | null;
  requiredPermission: string | null;
}

export type RuleDTO = BrandRuleDTO | CommercialRuleDTO | ComplianceRuleDTO;

export interface CompanyRulesDTO {
  brand: BrandRuleDTO[];
  commercial: CommercialRuleDTO[];
  compliance: ComplianceRuleDTO[];
}

export interface KnowledgeAccessPolicyDTO {
  id: string;
  companyId: string;
  agent: PersonRef | null;
  department: { id: string; name: string } | null;
  maxSensitivity: SensitivityLevel;
  note: string | null;
  createdAt: string;
}

export interface AgentKnowledgeProfileDTO {
  agentId: string;
  templateKey: string;
  /** Effective profile (template defaults merged with agent overrides). */
  effective: {
    requiredTypes: KnowledgeType[];
    preferredTags: string[];
    brandCategories: BrandRuleCategory[];
    commercialCategories: CommercialRuleCategory[];
  };
  template: AgentKnowledgeProfileDTO["effective"];
  override: AgentKnowledgeProfileDTO["effective"] | null;
}

/* ---------- context pack ---------- */

/** Why something was included — deterministic, never AI-generated. */
export type InclusionReason =
  | "critical_rule"
  | "restriction"
  | "task_link"
  | "agent_link"
  | "explicit_request"
  | "required_by_agent"
  | "requested_category"
  | "matching_department"
  | "matching_tag"
  | "task_type"
  | "task_keywords"
  | "company_wide_rule"
  | "global_policy"
  | "agent_channel"
  | "agent_domain"
  | "unverified_allowed"
  | "handoff_link";

export type ExclusionReason =
  | "draft"
  | "in_review"
  | "archived"
  | "superseded"
  | "expired"
  | "not_yet_effective"
  | "sensitivity"
  | "other_company"
  | "budget"
  | "not_relevant"
  | "inactive_rule";

export interface ContextRuleEntry {
  id: string;
  kind: RuleKind;
  title: string;
  description: string;
  severity: RuleSeverity;
  category: string;
  /** Machine-readable constraint summary (limit/effect/disclosure). */
  detail: string | null;
  global: boolean;
  mandatory: boolean;
  reasons: InclusionReason[];
}

export interface ContextKnowledgeEntry {
  id: string;
  title: string;
  type: KnowledgeType;
  source: string;
  sourceType: KnowledgeSourceType;
  verificationStatus: VerificationStatus;
  lastVerifiedAt: string | null;
  snippet: string;
  precedenceTier: number;
  freshness: FreshnessState;
  sensitivity: SensitivityLevel;
  global: boolean;
  /** Section it landed in: authoritative knowledge or clearly-labelled unverified context. */
  section: "knowledge" | "unverified";
  priority: number;
  score: number;
  reasons: InclusionReason[];
  reasonDetails: string[];
  warnings: string[];
  chars: number;
  /** Set only in human previews when the viewer lacks the sensitivity permission. */
  redacted?: boolean;
}

export interface ContextExclusion {
  id: string;
  /** null when revealing the title would leak (other company / redacted). */
  title: string | null;
  kind: "knowledge" | "rule";
  reason: ExclusionReason;
  detail: string;
}

export interface ContextHandoffEntry {
  id: string;
  from: string;
  type: string;
  objective: string;
  summary: string;
  verifiedFacts: string[];
  sourceReferences: string[];
  actionRequired: string;
  doNotResearchAgainUnless: string[];
  knowledgeIds: string[];
  status: string;
}

export interface AgentContextPack {
  version: string;
  request: {
    companyId: string;
    agentId: string;
    taskId: string | null;
    capability: string | null;
    budget: ContextBudget;
    maxChars: number;
    categories: KnowledgeType[];
    explicitKnowledgeIds: string[];
    allowUnverified: boolean;
  };
  agent: {
    id: string;
    name: string;
    templateKey: string;
    department: string | null;
    reportsTo: string | null;
    autonomyLevel: AutonomyLevel;
    autonomyLabel: string;
    allowed: string[];
    approvalRequired: string[];
    denied: string[];
  };
  company: {
    id: string;
    name: string;
    lines: { label: string; value: string }[];
    extended: { label: string; value: string }[];
    extendedIncluded: boolean;
  };
  task: {
    id: string;
    title: string;
    objective: string | null;
    type: TaskType;
    priority: TaskPriority;
    status: TaskStatus;
    parent: { id: string; title: string } | null;
    root: { id: string; title: string } | null;
    expectedOutput: string;
  } | null;
  rules: {
    brand: ContextRuleEntry[];
    commercial: ContextRuleEntry[];
    compliance: ContextRuleEntry[];
    aiPolicy: { label: string; value: string }[];
  };
  knowledge: ContextKnowledgeEntry[];
  unverified: ContextKnowledgeEntry[];
  /** Stage 04: structured handoff packets addressed to this agent for this task (prior work to reuse). */
  handoffs: ContextHandoffEntry[];
  prohibitedActions: { action: string; source: string }[];
  requiredApprovals: { action: string; requirement: string; source: string }[];
  excluded: ContextExclusion[];
  warnings: string[];
  metadata: {
    generatedAt: string;
    contextVersion: string;
    approxChars: number;
    approxTokens: number;
    budgetChars: number;
    overBudget: boolean;
    includedKnowledgeIds: string[];
    excludedCount: number;
    staleCount: number;
    droppedForBudget: number;
    blockedCrossCompany: number;
  };
}
