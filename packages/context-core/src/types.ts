import type { AgentKnowledgeProfile } from "@aibos/agent-core";
import type {
  AiPolicyMode,
  AutonomyLevel,
  BrandRuleCategory,
  CommercialRuleCategory,
  CommercialRuleEffect,
  ComplianceEffect,
  ConfidenceLevel,
  ContextBudget,
  KnowledgeScope,
  KnowledgeSourceType,
  KnowledgeStatus,
  KnowledgeType,
  RuleChannel,
  RulePeriod,
  RuleSeverity,
  RuleStatus,
  SensitivityLevel,
  StaleKnowledgePolicy,
  TaskPriority,
  TaskStatus,
  TaskType,
  VerificationStatus,
} from "@aibos/shared";

/** What the caller wants a pack for. */
export interface ContextRequest {
  companyId: string;
  agentId: string;
  taskId?: string | null;
  /** Requested provider capability (e.g. email_drafting); a relevance hint only. */
  capability?: string | null;
  budget?: ContextBudget;
  /** Character budget when budget = custom. */
  maxChars?: number;
  /** Knowledge types the caller explicitly wants. */
  categories?: KnowledgeType[];
  explicitKnowledgeIds?: string[];
  /** Allow clearly-labelled UNVERIFIED research. Defaults to the task's own flag. */
  allowUnverified?: boolean;
}

export interface KnowledgeCandidate {
  id: string;
  companyId: string | null;
  scope: KnowledgeScope;
  departmentId: string | null;
  title: string;
  summary: string | null;
  content: string;
  type: KnowledgeType;
  category: string | null;
  tags: string[];
  sourceType: KnowledgeSourceType;
  sourceReference: string | null;
  confidence: ConfidenceLevel;
  verificationStatus: VerificationStatus;
  status: KnowledgeStatus;
  sensitivity: SensitivityLevel;
  usableAsUnverified: boolean;
  effectiveAt: Date | null;
  reviewAt: Date | null;
  expiresAt: Date | null;
  lastVerifiedAt: Date | null;
  conflictKey: string | null;
  lineageId: string;
  updatedAt: Date;
}

interface RuleCandidateBase {
  id: string;
  /** null = global rule. */
  companyId: string | null;
  title: string;
  description: string;
  severity: RuleSeverity;
  active: boolean;
  status: RuleStatus;
}

export interface BrandRuleCandidate extends RuleCandidateBase {
  kind: "brand";
  category: BrandRuleCategory;
  channel: RuleChannel;
}

export interface CommercialRuleCandidate extends RuleCandidateBase {
  kind: "commercial";
  category: CommercialRuleCategory;
  appliesTo: string;
  effect: CommercialRuleEffect;
  limitAmount: number | null;
  currency: string | null;
  period: RulePeriod | null;
  requiredPermission: string | null;
}

export interface ComplianceRuleCandidate extends RuleCandidateBase {
  kind: "compliance";
  action: string;
  jurisdiction: string | null;
  effect: ComplianceEffect;
  disclosureText: string | null;
  requiredPermission: string | null;
}

export type RuleCandidate = BrandRuleCandidate | CommercialRuleCandidate | ComplianceRuleCandidate;

export interface AgentAuthoritySnapshot {
  permission: string;
  label: string;
  decision: "allow" | "require_approval" | "deny";
  /** Explicit grant effect (deny grants are listed as prohibitions). */
  grant: "allow" | "require_approval" | "deny" | null;
  approvalType: string | null;
}

export interface CompanySnapshot {
  id: string;
  name: string;
  /** Always-included identity lines (label → value). */
  core: { label: string; value: string }[];
  /** Business/positioning detail — droppable under tight budgets. */
  extended: { label: string; value: string }[];
}

export interface AiPolicySnapshot {
  staleKnowledgePolicy: StaleKnowledgePolicy;
  deepResearchPolicy: AiPolicyMode;
  externalActionPolicy: AiPolicyMode;
  browserPolicy: AiPolicyMode;
  autoSendPolicy: AiPolicyMode;
  allowedProviders: string[];
  defaultResearchLimit: number;
  customRules: string[];
}

export interface AccessPolicySnapshot {
  agentId: string | null;
  departmentId: string | null;
  maxSensitivity: SensitivityLevel;
}

export interface ContextSources {
  now: Date;
  company: CompanySnapshot;
  aiPolicy: AiPolicySnapshot;
  agent: {
    id: string;
    name: string;
    templateKey: string;
    departmentId: string | null;
    departmentName: string | null;
    reportsTo: string | null;
    autonomyLevel: AutonomyLevel;
    prohibitedActions: string[];
    authority: AgentAuthoritySnapshot[];
    maxSearches: number;
  };
  profile: AgentKnowledgeProfile;
  task: {
    id: string;
    companyId: string | null;
    title: string;
    description: string | null;
    type: TaskType;
    priority: TaskPriority;
    status: TaskStatus;
    parent: { id: string; title: string } | null;
    root: { id: string; title: string } | null;
    allowUnverifiedContext: boolean;
  } | null;
  knowledge: KnowledgeCandidate[];
  links: { knowledgeId: string; target: "task" | "agent" }[];
  accessPolicies: AccessPolicySnapshot[];
  rules: RuleCandidate[];
}
