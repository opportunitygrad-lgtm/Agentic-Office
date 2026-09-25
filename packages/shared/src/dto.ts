/**
 * API response shapes (JSON-serialised: dates are ISO strings, money is number USD).
 * The web app consumes these types; the API produces them.
 */
import type { AgentCapability } from "./workforce";
import type {
  ActorType,
  MembershipStatus,
  RoleScope,
  UserStatus,
  GrantEffectValue,
  AgentScope,
  AgentStatus,
  AgentTemplateKey,
  ApprovalStatus,
  ApprovalType,
  AuditOutcome,
  AuthState,
  AutonomyLevel,
  CompanyStatus,
  DataOrigin,
  IntegrationKind,
  IntegrationStatus,
  ProviderType,
  RiskLevel,
  TaskPriority,
  TaskStatus,
  TaskType,
} from "./enums";

export interface CompanyRef {
  id: string;
  name: string;
  slug: string;
  accentColor: string | null;
}

export interface CompanyDTO extends CompanyRef {
  legalName: string | null;
  industry: string | null;
  description: string | null;
  website: string | null;
  logoUrl: string | null;
  primaryCountry: string | null;
  countriesServed: string[];
  timezone: string;
  defaultCurrency: string;
  targetAudiences: string[];
  targetMarkets: string[];
  productsServices: string[];
  businessObjectives: string[];
  primaryObjective: string | null;
  revenueObjective: string | null;
  brandPositioning: string | null;
  brandTone: string | null;
  companyRules: string[];
  prohibitedClaims: string[];
  competitorNotes: string | null;
  complianceNotes: string | null;
  defaultProvider: ProviderType;
  monthlyAiBudget: number;
  dailyAiBudget: number;
  concurrencyLimit: number;
  status: CompanyStatus;
  settings: Record<string, unknown>;
  origin: DataOrigin;
  createdAt: string;
  updatedAt: string;
}

export interface CompanySummaryDTO extends CompanyDTO {
  stats: {
    agents: number;
    workingAgents: number;
    openTasks: number;
    pendingApprovals: number;
    spendTodayUsd: number;
    spendMonthUsd: number;
  };
}

export interface DepartmentDTO {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  companyId: string | null;
  color: string | null;
  agentCount: number;
}

export interface AgentDTO {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  templateKey: AgentTemplateKey;
  scope: AgentScope;
  status: AgentStatus;
  department: { id: string; name: string; slug: string } | null;
  reportsTo: { id: string; name: string } | null;
  companies: (CompanyRef & { isPrimary: boolean })[];
  primaryProvider: ProviderType;
  fallbackProvider: ProviderType | null;
  preferredModel: string | null;
  autonomyLevel: AutonomyLevel;
  responsibilities: string[];
  prohibitedActions: string[];
  allowedTools: string[];
  readPermissions: string[];
  writePermissions: string[];
  approvalRequirements: string[];
  perTaskBudget: number;
  dailyBudget: number;
  maxExternalSearches: number;
  maxRetries: number;
  concurrencyLimit: number;
  isTemporary: boolean;
  currentTask: { id: string; title: string; progress: number; status: TaskStatus } | null;
  /* Stage 04 workforce model */
  capabilities: AgentCapability[];
  teams: { id: string; name: string }[];
  workload: {
    active: number;
    queued: number;
    completedRecent: number;
    capacity: number;
    load: number;
  };
  escalationAgent: { id: string; name: string } | null;
  fallbackManager: { id: string; name: string } | null;
  parentAgent: { id: string; name: string } | null;
  purpose: string | null;
  expiresAt: string | null;
  boundTaskId: string | null;
  maySpawnTemporary: boolean;
  roleVersion: number | null;
  /** Stage 05 provider preferences. */
  preferredModelTier: "standard" | "premium" | "auto";
  defaultEffort: "low" | "medium" | "high" | "xhigh" | "max" | null;
  lastActiveAt: string | null;
  origin: DataOrigin;
  createdAt: string;
  updatedAt: string;
}

export interface AgentTemplateDTO {
  key: AgentTemplateKey;
  name: string;
  description: string;
  department: string;
  defaultProvider: ProviderType;
  fallbackProvider: ProviderType | null;
  defaultAutonomy: AutonomyLevel;
  responsibilities: string[];
  defaultTools: string[];
  prohibitedActions: string[];
  approvalRequirements: string[];
  capabilities: string[];
  promptVersion: string | null;
}

export interface TaskDTO {
  id: string;
  company: CompanyRef | null;
  title: string;
  description: string | null;
  type: TaskType;
  priority: TaskPriority;
  status: TaskStatus;
  assignedAgent: { id: string; name: string } | null;
  createdByKind: string;
  createdByRef: string | null;
  parentTaskId: string | null;
  rootTaskId: string | null;
  childCount: number;
  requiredProvider: ProviderType | null;
  estimatedCost: number | null;
  actualCost: number | null;
  progress: number;
  currentAction: string | null;
  currentTool: string | null;
  requiresApproval: boolean;
  dueAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  error: string | null;
  resultSummary: string | null;
  origin: DataOrigin;
  createdAt: string;
  updatedAt: string;
}

export interface ApprovalDTO {
  id: string;
  company: CompanyRef | null;
  task: { id: string; title: string } | null;
  agent: { id: string; name: string } | null;
  type: ApprovalType;
  requestedAction: string;
  explanation: string | null;
  riskLevel: RiskLevel;
  proposedChange: Record<string, unknown> | null;
  beforeState: Record<string, unknown> | null;
  afterState: Record<string, unknown> | null;
  status: ApprovalStatus;
  /** Human permissions required to decide this approval. */
  requiredPermissions: string[];
  /** Computed per viewer by the API: may the current user decide it? */
  viewerCanDecide?: boolean;
  viewerMissingPermissions?: string[];
  requestedAt: string;
  expiresAt: string | null;
  decidedBy: string | null;
  decidedByUserId: string | null;
  decisionNotes: string | null;
  decidedAt: string | null;
  origin: DataOrigin;
}

export interface AuditEventDTO {
  id: string;
  occurredAt: string;
  company: CompanyRef | null;
  agent: { id: string; name: string } | null;
  taskId: string | null;
  actorType: ActorType;
  actorUser: string | null;
  actorUserId: string | null;
  actorServiceId: string | null;
  resourceType: string | null;
  resourceId: string | null;
  action: string;
  tool: string | null;
  provider: ProviderType | null;
  description: string;
  metadata: Record<string, unknown>;
  outcome: AuditOutcome;
  error: string | null;
  origin: DataOrigin;
}

export interface IntegrationDTO {
  id: string;
  kind: IntegrationKind;
  name: string;
  category: string;
  description: string;
  company: CompanyRef | null;
  status: IntegrationStatus;
  authState: AuthState;
  capabilities: string[];
  lastHealthCheckAt: string | null;
  lastSuccessfulSyncAt: string | null;
  lastError: string | null;
  plannedStage: number | null;
}

export interface ProviderUsageDTO {
  provider: ProviderType;
  /** Stage 05: CLAUDE shows real (live) usage only; others remain labelled mock data. */
  isMock: boolean;
  todayUsd: number;
  monthUsd: number;
  calls: number;
  callsToday: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  averageCallUsd: number | null;
  /** How the live provider is billed. "subscription" rows never count as spend. */
  billingMode: "subscription" | "api" | "none";
  /** Subscription runs today / this month (Claude Code). */
  subscriptionRunsToday: number;
  subscriptionRunsMonth: number;
  /** NOT BILLED — analytical API-equivalent estimate for subscription runs this month. */
  apiEquivalentMonthUsd: number;
  /** 14 daily spend points, oldest → newest. */
  trend: number[];
}

export interface UsageSummaryDTO {
  /** True while all usage rows are development mock data. */
  isMock: boolean;
  currency: "USD";
  dailyBudgetUsd: number;
  monthlyBudgetUsd: number;
  todayUsd: number;
  monthUsd: number;
  /** Real (live) spend only — never mixed with mock rows. */
  liveTodayUsd: number;
  liveMonthUsd: number;
  providers: ProviderUsageDTO[];
}

export type HealthState = "ok" | "degraded" | "down" | "unknown" | "not_configured";

export interface SystemHealthDTO {
  status: HealthState;
  checkedAt: string;
  services: { name: string; status: HealthState; detail?: string }[];
}

export interface AlertDTO {
  id: string;
  severity: "info" | "warning" | "critical";
  title: string;
  detail: string;
  href: string | null;
  company: CompanyRef | null;
}

export type WorkforceCounts = Record<AgentStatus, number> & { total: number };

export interface DashboardSummaryDTO {
  generatedAt: string;
  scope: CompanyRef | null;
  companies: CompanySummaryDTO[];
  workforce: WorkforceCounts;
  agents: AgentDTO[];
  tasks: TaskDTO[];
  approvals: ApprovalDTO[];
  activity: AuditEventDTO[];
  usage: UsageSummaryDTO;
  alerts: AlertDTO[];
  containsDevSeedData: boolean;
}

export interface LiveSessionDTO {
  id: string;
  isMock: true;
  agent: { id: string; name: string; status: AgentStatus };
  company: CompanyRef | null;
  task: { id: string; title: string; progress: number } | null;
  surface: "browser" | "application" | "idle";
  currentUrl: string | null;
  applicationName: string | null;
  currentAction: string | null;
  currentTool: string | null;
  lastFrameAt: string | null;
  control: "agent" | "human";
  timeline: { at: string; label: string; kind: "navigate" | "read" | "write" | "think" | "wait" }[];
}

export interface ApiErrorBody {
  error: { code: string; message: string; issues?: { path: string; message: string }[] };
}

export interface ShellDTO {
  companies: (CompanyRef & { status: CompanyStatus; timezone: string })[];
  pendingApprovals: number;
  alerts: AlertDTO[];
  containsDevSeedData: boolean;
}

/* ---------- identity & access (Stage 02) ---------- */

export interface RoleRef {
  id: string;
  key: string;
  name: string;
  isSystem: boolean;
}

export interface MembershipDTO {
  id: string;
  /** null = global membership (all companies). */
  company: CompanyRef | null;
  role: RoleRef;
  status: MembershipStatus;
  departments: { id: string; name: string }[];
  joinedAt: string | null;
  createdAt: string;
}

/** Public user shape. Never contains password hashes or tokens. */
export interface UserDTO {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  displayName: string;
  avatarUrl: string | null;
  status: UserStatus;
  timezone: string | null;
  locale: string | null;
  isPlatformOwner: boolean;
  lastLoginAt: string | null;
  disabledAt: string | null;
  createdAt: string;
  memberships: MembershipDTO[];
  origin: DataOrigin;
}

export interface MeDTO {
  user: UserDTO;
  session: { expiresAt: string };
  isPlatformOwner: boolean;
  /** Permissions held for every company (global memberships). */
  globalPermissions: string[];
  /** Effective permissions per accessible company (includes global ones). */
  companyPermissions: Record<string, string[]>;
  accessibleCompanies: CompanyRef[];
}

export interface PermissionDTO {
  key: string;
  category: string;
  label: string;
  description: string;
  scope: RoleScope;
  sensitive: boolean;
}

export interface RoleDTO extends RoleRef {
  description: string | null;
  scope: RoleScope;
  companyId: string | null;
  rank: number;
  permissions: string[];
  userCount: number;
}

export interface AgentAuthorityItem {
  permission: string;
  verb: string;
  label: string;
  risk: "low" | "medium" | "high";
  grant: GrantEffectValue | null;
  decision: "allow" | "require_approval" | "deny";
  reason: string;
}

export interface AgentAuthorityDTO {
  agentId: string;
  companyId: string | null;
  autonomyLevel: AutonomyLevel;
  status: AgentStatus;
  companies: CompanyRef[];
  groups: { group: string; items: AgentAuthorityItem[] }[];
  approvalGates: string[];
  prohibitedActions: string[];
  limits: {
    perTaskBudget: number;
    dailyBudget: number;
    maxExternalSearches: number;
    maxRetries: number;
    concurrencyLimit: number;
  };
  viewerCanManage: boolean;
}
