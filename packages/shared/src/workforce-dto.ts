/**
 * Stage 04 API shapes: roles & instruction packs, teams, organisation chart,
 * delegation decisions, handoffs, messages and conversations.
 */
import type {
  AgentStatus,
  AutonomyLevel,
  ProviderType,
  TaskPriority,
  TaskStatus,
  TaskType,
} from "./enums";
import type { CompanyRef, TaskDTO } from "./dto";
import type { PersonRef } from "./knowledge-dto";
import type { AgentRole } from "./workforce-schemas";
import type {
  AgentCapability,
  AgentMessageType,
  BudgetDecision,
  ConversationStatus,
  DelegationOutcome,
  DuplicateLevel,
  HandoffStatus,
  HandoffType,
  InstructionLayerKey,
} from "./workforce";

/* ---------- roles & instructions ---------- */

export interface AgentRoleVersionDTO {
  id: string;
  version: number;
  changeSummary: string;
  material: boolean;
  createdBy: PersonRef | null;
  approvedBy: PersonRef | null;
  effectiveFrom: string;
  createdAt: string;
  isCurrent: boolean;
}

export interface AgentRoleDTO {
  agentId: string;
  /** "template" until someone saves an agent-specific role. */
  source: "template" | "agent";
  role: AgentRole;
  templateRole: AgentRole;
  roleTemplate: { id: string | null; key: string; name: string; companySpecific: boolean };
  currentVersion: AgentRoleVersionDTO | null;
  versions: AgentRoleVersionDTO[];
  capabilities: AgentCapability[];
  viewerCanManage: boolean;
}

export interface RoleTemplateDTO {
  id: string;
  key: string;
  name: string;
  company: CompanyRef | null;
  baseTemplateKey: string;
  departmentSlug: string;
  capabilities: AgentCapability[];
  role: AgentRole;
  agentCount: number;
  updatedAt: string;
  origin: "live" | "dev_seed";
}

export interface InstructionRuleDTO {
  id: string;
  layer: InstructionLayerKey;
  priority: number;
  category: string;
  text: string;
  source: string;
  /** Deterministic reason the rule is in the stack. */
  reason: string;
  locked: boolean;
  /** Set when this rule duplicates a higher-priority rule and was folded into it. */
  duplicateOf?: string;
  /** Set when a higher-priority rule rejected this one. */
  rejected?: string;
}

export interface InstructionConflictDTO {
  id: string;
  category: string;
  requested: { layer: InstructionLayerKey; text: string };
  winner: { layer: InstructionLayerKey | "authority"; text: string };
  resolution: string;
}

export interface CompiledAgentInstructionPack {
  version: string;
  agentId: string;
  companyId: string;
  taskId: string | null;
  layers: {
    layer: InstructionLayerKey;
    label: string;
    priority: number;
    rules: InstructionRuleDTO[];
  }[];
  conflicts: InstructionConflictDTO[];
  effective: {
    maxSearches: number;
    maxRetries: number;
    maxTaskBudgetUsd: number;
    deepResearch: "never" | "approval" | "allowed";
    externalActions: "disabled" | "approval_required" | "allowed";
    mayDelegate: boolean;
    maxDelegationDepth: number;
    allowedTools: string[];
    approvalTools: string[];
    deniedTools: string[];
    providerPreference: ProviderType[];
    stopConditions: string[];
    definitionOfDone: string[];
    resultFormat: string;
  };
  context: { contextVersion: string; approxTokens: number; includedKnowledgeIds: string[] } | null;
  /** Concise, deduplicated provider-neutral text (no provider message format). */
  text: string;
  metadata: {
    generatedAt: string;
    ruleCount: number;
    duplicatesRemoved: number;
    rejectedCount: number;
    approxChars: number;
    roleVersion: number | null;
  };
}

/* ---------- workforce structure ---------- */

export interface WorkforcePolicyDTO {
  globalActiveAgentLimit: number;
  maxDelegationDepth: number;
  highCostTaskThresholdUsd: number;
  tempAgentMaxExpiryHours: number;
  tempAgentApprovalBudgetUsd: number;
  maxActiveTempAgentsPerCompany: number;
  updatedAt: string | null;
}

export interface OperatingPolicyRuleDTO {
  id: string;
  layer: "platform" | "global";
  category: string;
  text: string;
  locked: boolean;
}

export interface DepartmentDetailDTO {
  id: string;
  name: string;
  slug: string;
  company: CompanyRef | null;
  description: string | null;
  mission: string | null;
  color: string | null;
  managerAgent: { id: string; name: string } | null;
  humanManager: PersonRef | null;
  defaultProvider: ProviderType | null;
  concurrencyLimit: number | null;
  dailyBudgetUsd: number | null;
  active: boolean;
  instructions: string[];
  allowedTaskTypes: TaskType[];
  handoffDestinations: string[];
  agentCount: number;
  activeTasks: number;
}

export interface TeamMemberDTO {
  id: string;
  name: string;
  status: AgentStatus;
  templateKey: string;
  isLeader: boolean;
  isTemporary: boolean;
  workload: AgentWorkloadDTO;
}

export interface TeamDTO {
  id: string;
  name: string;
  slug: string;
  company: CompanyRef | null;
  department: { id: string; name: string; slug: string } | null;
  description: string | null;
  purpose: string | null;
  leader: { id: string; name: string } | null;
  concurrencyLimit: number;
  defaultTaskTypes: TaskType[];
  active: boolean;
  isTemporary: boolean;
  expiresAt: string | null;
  memberCount: number;
  activeTasks: number;
  origin: "live" | "dev_seed";
}

export interface TeamDetailDTO extends TeamDTO {
  members: TeamMemberDTO[];
  tasks: TaskDTO[];
  handoffDestinations: string[];
  activity: { id: string; description: string; occurredAt: string; actor: string | null }[];
  viewerCanManage: boolean;
}

export interface AgentWorkloadDTO {
  active: number;
  queued: number;
  completedRecent: number;
  capacity: number;
  /** active / capacity, 0..1+ */
  load: number;
}

export interface OrgAgentNode {
  id: string;
  name: string;
  templateKey: string;
  status: AgentStatus;
  autonomyLevel: AutonomyLevel;
  isTemporary: boolean;
  reportsToId: string | null;
  workload: AgentWorkloadDTO;
  currentTask: string | null;
}

export interface OrgChartDTO {
  /** Group-level managers and global agents (no single company). */
  group: OrgAgentNode[];
  companies: {
    company: CompanyRef;
    managers: OrgAgentNode[];
    departments: {
      department: { id: string; name: string; slug: string; color: string | null };
      teams: { id: string; name: string; leaderId: string | null; members: OrgAgentNode[] }[];
      agents: OrgAgentNode[];
    }[];
  }[];
}

/* ---------- tasks & delegation ---------- */

export interface TaskRequirementsDTO {
  requiredCapabilities: AgentCapability[];
  preferredDepartment: { id: string; name: string } | null;
  preferredAgent: { id: string; name: string } | null;
  preferredTeam: { id: string; name: string } | null;
  providerPreference: ProviderType | null;
  maxBudget: number | null;
  maxConcurrency: number | null;
  delegationAllowed: boolean;
  parallelAllowed: boolean;
  externalActionAllowed: boolean;
  approvalRequirements: string[];
  resultSchema: string | null;
  stoppingCondition: string | null;
  expectedOutcome: string | null;
  targetEntity: string | null;
  workItems: number | null;
}

export interface TaskDetailDTO extends TaskDTO {
  requirements: TaskRequirementsDTO;
  department: { id: string; name: string } | null;
  team: { id: string; name: string } | null;
  delegationDepth: number;
  delegatedFrom: { id: string; name: string } | null;
  claim: {
    agentId: string;
    agentName: string;
    claimedAt: string;
    leaseExpiresAt: string | null;
  } | null;
  delegations: {
    id: string;
    outcome: DelegationOutcome;
    from: { id: string; name: string } | null;
    to: { id: string; name: string; kind: "agent" | "team" } | null;
    override: boolean;
    reason: string | null;
    decidedBy: string | null;
    createdAt: string;
  }[];
  viewer: {
    canAssign: boolean;
    canDelegate: boolean;
    canPause: boolean;
    canManageHandoffs: boolean;
    canCreateTemporary: boolean;
  };
}

export interface DuplicateMatch {
  taskId: string;
  title: string;
  status: TaskStatus;
  level: DuplicateLevel;
  similarity: number;
  reasons: string[];
}

export interface DuplicateResult {
  level: DuplicateLevel;
  matches: DuplicateMatch[];
}

export interface CandidateCheck {
  check:
    | "company"
    | "status"
    | "circular"
    | "delegation_scope"
    | "capability"
    | "permission"
    | "capacity"
    | "department_capacity"
    | "budget";
  passed: boolean;
  detail: string;
}

export interface CandidateEvaluation {
  agentId: string;
  name: string;
  templateKey: string;
  department: string | null;
  isTemporary: boolean;
  checks: CandidateCheck[];
  eligible: boolean;
  score: number;
  scoreReasons: string[];
  /** First failing check, phrased for people (e.g. "Agent does not serve company"). */
  rejectedReason: string | null;
  approvalGates: string[];
}

export interface DelegationDecisionDTO {
  outcome: DelegationOutcome;
  requester: { id: string; name: string } | null;
  target: { kind: "agent" | "team" | "self" | "temporary"; id: string | null; name: string } | null;
  budget: { decision: BudgetDecision; estimateUsd: number; reasons: string[] };
  approvalRequired: boolean;
  queued: boolean;
  duplicate: DuplicateResult;
  requiredCapabilities: AgentCapability[];
  requiredPermissions: string[];
  candidates: CandidateEvaluation[];
  teams: {
    id: string;
    name: string;
    eligibleMembers: number;
    available: boolean;
    reason: string;
  }[];
  temporaryWorker: {
    capabilities: AgentCapability[];
    permissions: string[];
    budgetUsd: number;
    expiresInHours: number;
  } | null;
  explanation: string[];
}

/* ---------- handoffs, messages, conversations ---------- */

export interface HandoffDTO {
  id: string;
  company: CompanyRef;
  task: { id: string; title: string };
  from: { id: string; name: string };
  to: { kind: "agent" | "team" | "department"; id: string; name: string };
  type: HandoffType;
  objective: string;
  summary: string;
  verifiedFacts: string[];
  sourceReferences: string[];
  knowledge: { id: string; title: string | null; redacted: boolean }[];
  contactReference: string | null;
  actionRequired: string;
  priority: TaskPriority;
  deadline: string | null;
  doNotResearchAgainUnless: string[];
  status: HandoffStatus;
  createdBy: string | null;
  createdAt: string;
  acceptedAt: string | null;
  completedAt: string | null;
  origin: "live" | "dev_seed";
}

export interface AgentMessageDTO {
  id: string;
  sender: { type: "human" | "agent" | "service" | "system"; id: string | null; name: string };
  recipient: { kind: "agent" | "team"; id: string; name: string };
  taskId: string | null;
  type: AgentMessageType;
  content: string;
  payload: Record<string, unknown>;
  createdAt: string;
  readAt: string | null;
}

export interface ConversationDTO {
  id: string;
  company: CompanyRef;
  agent: { id: string; name: string };
  task: { id: string; title: string } | null;
  title: string | null;
  status: ConversationStatus;
  messageCount: number;
  lastMessageAt: string | null;
  createdAt: string;
}

export interface ConversationMessageDTO {
  id: string;
  role: "human" | "agent" | "system";
  author: string;
  content: string;
  createdAt: string;
}

export interface ManagerStatsDTO {
  manager: { id: string; name: string } | null;
  tasksReceived: number;
  handledDirectly: number;
  delegated: number;
  waitingApprovals: number;
  duplicatesAvoided: number;
  temporaryAgentsActive: number;
  concurrency: { active: number; limit: number };
  handoffsPending: number;
}
