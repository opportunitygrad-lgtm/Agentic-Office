/**
 * Stage 05 execution vocabulary, schemas and API shapes: model tiers, agent
 * runs, run events, structured execution results, provider status and costs.
 */
import { z } from "zod";
import type { CompanyRef } from "./dto";
import type { ProviderType } from "./enums";
import type { ConversationMessageDTO } from "./workforce-dto";

/* ---------- vocabularies ---------- */

export const MODEL_TIERS = ["standard", "premium", "auto"] as const;
export type ModelTier = (typeof MODEL_TIERS)[number];
export const MODEL_TIER_LABELS: Record<ModelTier, string> = {
  standard: "Standard",
  premium: "Premium",
  auto: "Auto",
};

export const EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"] as const;
export type EffortLevel = (typeof EFFORT_LEVELS)[number];

/** Expected output detail → maximum output tokens (see RESPONSE_DETAIL_TOKENS). */
export const RESPONSE_DETAILS = ["short", "normal", "detailed", "custom"] as const;
export type ResponseDetail = (typeof RESPONSE_DETAILS)[number];
export const RESPONSE_DETAIL_TOKENS: Record<Exclude<ResponseDetail, "custom">, number> = {
  short: 1_500,
  normal: 4_000,
  detailed: 12_000,
};
/** Ceiling for "custom" and any explicit override. */
export const MAX_OUTPUT_TOKENS_CEILING = 32_000;

export const AGENT_RUN_STATUSES = [
  "queued",
  "preparing",
  "routing",
  "running",
  "streaming",
  "waiting",
  "completed",
  "failed",
  "cancel_requested",
  "cancelled",
  "needs_review",
] as const;
export type AgentRunStatus = (typeof AGENT_RUN_STATUSES)[number];
export const ACTIVE_RUN_STATUSES: readonly AgentRunStatus[] = [
  "queued",
  "preparing",
  "routing",
  "running",
  "streaming",
  "waiting",
  "cancel_requested",
];
export const FINAL_RUN_STATUSES: readonly AgentRunStatus[] = [
  "completed",
  "failed",
  "cancelled",
  "needs_review",
];

export const RUN_EXECUTION_TYPES = ["task", "chat", "connection_test", "review"] as const;
export type RunExecutionType = (typeof RUN_EXECUTION_TYPES)[number];

export const RUN_EVENT_TYPES = [
  "RUN_CREATED",
  "TASK_CLAIMED",
  "CONTEXT_BUILDING",
  "CONTEXT_READY",
  "INSTRUCTIONS_COMPILED",
  "PROVIDER_ROUTED",
  "PROVIDER_REQUEST_STARTED",
  "PROVIDER_STREAM_STARTED",
  "OUTPUT_CHUNK",
  "PROVIDER_RESPONSE_RECEIVED",
  "PROVIDER_RETRY",
  "USAGE_RECORDED",
  "RESULT_VALIDATED",
  "TASK_COMPLETED",
  "CANCEL_REQUESTED",
  "RUN_CANCELLED",
  "RUN_FAILED",
  "RUN_NEEDS_REVIEW",
  // Stage 06: second-opinion review runs
  "REVIEW_COMPLETED",
] as const;
export type RunEventType = (typeof RUN_EVENT_TYPES)[number];

/** Observable system phases shown to people — never model reasoning. */
export const RUN_PHASE_LABELS: Partial<Record<RunEventType, string>> = {
  RUN_CREATED: "Queued",
  TASK_CLAIMED: "Task claimed",
  CONTEXT_BUILDING: "Analysing context",
  CONTEXT_READY: "Context ready",
  INSTRUCTIONS_COMPILED: "Instructions compiled",
  PROVIDER_ROUTED: "Provider selected",
  PROVIDER_REQUEST_STARTED: "Preparing response",
  PROVIDER_STREAM_STARTED: "Generating result",
  PROVIDER_RESPONSE_RECEIVED: "Response received",
  PROVIDER_RETRY: "Retrying after a transient provider error",
  USAGE_RECORDED: "Usage recorded",
  RESULT_VALIDATED: "Result validated",
  TASK_COMPLETED: "Task completed",
  REVIEW_COMPLETED: "Review completed",
  CANCEL_REQUESTED: "Stop requested",
  RUN_CANCELLED: "Stopped",
  RUN_FAILED: "Failed",
  RUN_NEEDS_REVIEW: "Needs review",
};

/**
 * How a logical provider is reached. CLAUDE defaults to the owner's local,
 * subscription-authenticated Claude Code CLI; the Anthropic API transport is
 * optional and only used when deliberately configured (CLAUDE_TRANSPORT).
 */
export const PROVIDER_TRANSPORTS = [
  "claude_code_cli",
  "anthropic_api",
  // Stage 06: OpenAI via the official Codex CLI (ChatGPT subscription login, default)
  // or, only when deliberately configured, the optional Anthropic-style API transport.
  "codex_cli",
  "openai_api",
  "local",
  "none",
] as const;
export type ProviderTransport = (typeof PROVIDER_TRANSPORTS)[number];
export const TRANSPORT_LABELS: Record<ProviderTransport, string> = {
  claude_code_cli: "Local Claude Code",
  anthropic_api: "Anthropic API",
  codex_cli: "Local Codex CLI",
  openai_api: "OpenAI API",
  local: "Local logic",
  none: "Not connected",
};
export const AUTH_MODES = ["subscription_login", "api_key", "none"] as const;
export type AuthMode = (typeof AUTH_MODES)[number];
/** SUBSCRIPTION usage is included in the owner's plan and never counts as API spend. */
export const BILLING_MODES = ["subscription", "api", "none"] as const;
export type BillingMode = (typeof BILLING_MODES)[number];
export const API_EQUIVALENT_LABEL = "NOT BILLED — ESTIMATED API EQUIVALENT";

/**
 * Stage 06: what a run is FOR. PRIMARY is ordinary task/chat execution.
 * SECOND_OPINION is an independent review of another (PRIMARY) run's
 * completed result by a different provider. QUALITY_REVIEW and
 * FUTURE_TOOL_RUN are reserved for later stages.
 */
export const RUN_PURPOSES = [
  "primary",
  "second_opinion",
  "quality_review",
  "future_tool_run",
] as const;
export type RunPurpose = (typeof RUN_PURPOSES)[number];

/**
 * Company-level control over second-opinion review: OFF (never offered),
 * MANUAL (a permitted person can ask for one), POLICY_REQUIRED (certain task
 * types should be reviewed before being treated as done — enforcement is a
 * later stage), HIGH_VALUE_ONLY (offered above a cost/complexity threshold).
 * Never enabled globally by default; review is never automatic.
 */
export const SECOND_OPINION_MODES = [
  "off",
  "manual",
  "policy_required",
  "high_value_only",
] as const;
export type SecondOpinionMode = (typeof SECOND_OPINION_MODES)[number];

/** How a company resolves its "primary" AI provider. */
export const PROVIDER_SELECTION_MODES = ["fixed", "auto"] as const;
export type ProviderSelectionMode = (typeof PROVIDER_SELECTION_MODES)[number];

export const PROVIDER_HEALTH_STATES = [
  "not_configured",
  "available",
  "degraded",
  "rate_limited",
  "auth_error",
  "unavailable",
  // CLI subscription transports (Claude Code Stage 05A, Codex Stage 06)
  "not_installed",
  "login_required",
  "login_expired",
  "misconfigured",
] as const;
export type ProviderHealthState = (typeof PROVIDER_HEALTH_STATES)[number];

/** Normalised provider error codes (never raw vendor messages in logic). */
export const PROVIDER_ERROR_CODES = [
  "PROVIDER_NOT_CONFIGURED",
  "AUTH_ERROR",
  "PERMISSION_ERROR",
  "INVALID_REQUEST",
  "NOT_FOUND",
  "RATE_LIMITED",
  "OVERLOADED",
  "SERVER_ERROR",
  "NETWORK_ERROR",
  "TIMEOUT",
  "CANCELLED",
  "REFUSED",
  "OUTPUT_TRUNCATED",
  "INVALID_OUTPUT",
  "BUDGET_BLOCKED",
  // Claude Code subscription transport (Stage 05A)
  "NOT_INSTALLED",
  "LOGIN_REQUIRED",
  "LOGIN_EXPIRED",
  "SUBSCRIPTION_LIMIT_REACHED",
  "MODEL_UNAVAILABLE",
  "MISCONFIGURED",
  "API_BILLING_REFUSED",
  "UNKNOWN",
] as const;
export type ProviderErrorCode = (typeof PROVIDER_ERROR_CODES)[number];

/* ---------- structured execution result ---------- */

export const EXECUTION_RESULT_STATUSES = ["completed", "needs_human", "blocked"] as const;
export const EXECUTION_CONFIDENCE = ["low", "medium", "high"] as const;

/**
 * What an agent returns for a task. Proposals (handoffs, knowledge drafts,
 * next actions) are recommendations only — the application decides.
 */
export const agentExecutionResultSchema = z.strictObject({
  status: z.enum(EXECUTION_RESULT_STATUSES),
  summary: z.string().max(2_000),
  response: z.string().max(60_000),
  keyFindings: z.array(z.string().max(1_000)).max(20),
  proposedNextActions: z.array(z.string().max(1_000)).max(10),
  proposedHandoffs: z
    .array(
      z.strictObject({
        department: z.string().max(64),
        objective: z.string().max(500),
        reason: z.string().max(500),
      }),
    )
    .max(5),
  proposedKnowledgeDrafts: z
    .array(
      z.strictObject({
        title: z.string().max(300),
        summary: z.string().max(1_000),
        content: z.string().max(8_000),
      }),
    )
    .max(5),
  warnings: z.array(z.string().max(1_000)).max(10),
  confidence: z.enum(EXECUTION_CONFIDENCE),
});
export type AgentExecutionResult = z.infer<typeof agentExecutionResultSchema>;

/**
 * JSON Schema sent to the provider's structured-output feature. Kept by hand
 * (supported keywords only: objects with additionalProperties:false, enums,
 * arrays) and mirrored by `agentExecutionResultSchema`, which validates every
 * response before persistence.
 */
export const AGENT_EXECUTION_RESULT_JSON_SCHEMA = (() => {
  const str = { type: "string" };
  const strList = { type: "array", items: str };
  const obj = (properties: Record<string, unknown>) => ({
    type: "object",
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  });
  return obj({
    status: { type: "string", enum: [...EXECUTION_RESULT_STATUSES] },
    summary: str,
    response: str,
    keyFindings: strList,
    proposedNextActions: strList,
    proposedHandoffs: {
      type: "array",
      items: obj({ department: str, objective: str, reason: str }),
    },
    proposedKnowledgeDrafts: {
      type: "array",
      items: obj({ title: str, summary: str, content: str }),
    },
    warnings: strList,
    confidence: { type: "string", enum: [...EXECUTION_CONFIDENCE] },
  });
})();

/**
 * Independent critique of another provider's completed result (Stage 06:
 * second-opinion engine). Deliberately has NO "winner"/ranking field — the
 * purpose is neutral critique, never "Claude wins" / "OpenAI wins". This is
 * AI-generated analysis, not company truth: it can propose corrections or
 * further research but never alters approved knowledge, policy or financial
 * rules, sends anything externally, or approves another AI result.
 */
export const providerReviewSchema = z.strictObject({
  agreementPoints: z.array(z.string().max(1_000)).max(20),
  disagreementPoints: z.array(z.string().max(1_000)).max(20),
  possibleErrors: z.array(z.string().max(1_000)).max(20),
  missingConsiderations: z.array(z.string().max(1_000)).max(20),
  unsupportedClaims: z.array(z.string().max(1_000)).max(20),
  risks: z.array(z.string().max(1_000)).max(20),
  suggestedCorrections: z.array(z.string().max(1_000)).max(20),
  confidence: z.enum(EXECUTION_CONFIDENCE),
  overallReviewSummary: z.string().max(3_000),
});
export type ProviderReview = z.infer<typeof providerReviewSchema>;

export const PROVIDER_REVIEW_JSON_SCHEMA = (() => {
  const strList = { type: "array", items: { type: "string" } };
  return {
    type: "object",
    properties: {
      agreementPoints: strList,
      disagreementPoints: strList,
      possibleErrors: strList,
      missingConsiderations: strList,
      unsupportedClaims: strList,
      risks: strList,
      suggestedCorrections: strList,
      confidence: { type: "string", enum: [...EXECUTION_CONFIDENCE] },
      overallReviewSummary: { type: "string" },
    },
    required: [
      "agreementPoints",
      "disagreementPoints",
      "possibleErrors",
      "missingConsiderations",
      "unsupportedClaims",
      "risks",
      "suggestedCorrections",
      "confidence",
      "overallReviewSummary",
    ],
    additionalProperties: false,
  };
})();

/* ---------- API inputs ---------- */

export const startTaskRunSchema = z.strictObject({
  /** Explicit tier override for this run (premium still needs company permission). */
  modelTier: z.enum(MODEL_TIERS).optional(),
  responseDetail: z.enum(RESPONSE_DETAILS).optional(),
  /**
   * Stage 06: explicit provider choice for this run (still bound by company
   * policy and availability — never a bypass). Omit to use the normal
   * agent/company routing.
   */
  provider: z.enum(["CLAUDE", "OPENAI", "GROK", "LOCAL"]).optional(),
  /** Client idempotency key: repeated clicks with the same key return the same run. */
  idempotencyKey: z.string().trim().min(8).max(100).optional(),
});
export type StartTaskRunInput = z.input<typeof startTaskRunSchema>;

export const chatSendSchema = z.strictObject({
  content: z.string().trim().min(1).max(4_000),
  /** Stage 06: reply with a specific provider when the agent/company allow choosing. */
  provider: z.enum(["CLAUDE", "OPENAI", "GROK", "LOCAL"]).optional(),
  idempotencyKey: z.string().trim().min(8).max(100).optional(),
});

export const runFeedbackSchema = z.strictObject({
  rating: z.enum(["useful", "not_useful"]),
  note: z.string().trim().max(1_000).optional(),
});

export const providerSettingsSchema = z.strictObject({
  enabled: z.boolean().optional(),
  standardModel: z.string().trim().min(3).max(100).optional(),
  premiumModel: z.string().trim().min(3).max(100).optional(),
  standardEffort: z.enum(EFFORT_LEVELS).optional(),
  premiumEffort: z.enum(EFFORT_LEVELS).optional(),
  dailyBudgetUsd: z.number().min(0).max(100_000).nullable().optional(),
});

export const agentProviderSettingsSchema = z.strictObject({
  primaryProvider: z.enum(["CLAUDE", "OPENAI", "GROK", "LOCAL"]),
  fallbackProvider: z.enum(["CLAUDE", "OPENAI", "GROK", "LOCAL"]).nullable(),
  preferredModelTier: z.enum(MODEL_TIERS),
  defaultEffort: z.enum(EFFORT_LEVELS).nullable(),
  /** Stage 06: who reviews this agent's results by default when a review is requested. */
  preferredReviewerProvider: z.enum(["CLAUDE", "OPENAI", "GROK", "LOCAL"]).nullable(),
});

/* ---------- second-opinion review (Stage 06) ---------- */

export const requestReviewSchema = z.strictObject({
  reviewerProvider: z.enum(["CLAUDE", "OPENAI", "GROK", "LOCAL"]).optional(),
  /** Explicit re-review even though one already exists for this reviewer. */
  force: z.boolean().optional(),
});
export type RequestReviewInput = z.input<typeof requestReviewSchema>;

/* ---------- DTOs ---------- */

export interface RouteDecisionDTO {
  provider: ProviderType | null;
  model: string | null;
  modelLabel: string | null;
  effort: EffortLevel | null;
  tier: Exclude<ModelTier, "auto"> | null;
  reasons: string[];
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  estimatedCostUsd: number;
  fallbackProvider: ProviderType | null;
  approvalRequired: boolean;
  blockedReason: string | null;
  isMock: boolean;
  transport: ProviderTransport;
  billingMode: BillingMode;
  /** Subscription runs: analytical API-equivalent estimate, never real spend. */
  apiEquivalentUsd: number | null;
}

export interface BudgetCheckDTO {
  scope:
    | "task"
    | "agent_task"
    | "agent_daily"
    | "company_daily"
    | "company_monthly"
    | "provider_daily"
    | "global_daily"
    // Subscription (Claude Code) operational limits
    | "subscription_task_runs"
    | "subscription_agent_daily_runs"
    | "subscription_input_size";
  /** Unit of limit/spent/remaining (defaults to USD for API-billed runs). */
  unit?: "usd" | "runs" | "tokens";
  limitUsd: number | null;
  spentUsd: number;
  reservedUsd: number;
  remainingUsd: number | null;
  passed: boolean;
}

export interface RunPreviewDTO {
  eligible: boolean;
  reasons: string[];
  agent: { id: string; name: string } | null;
  company: CompanyRef | null;
  route: RouteDecisionDTO;
  budget: {
    decision: "allowed" | "requires_approval" | "blocked";
    checks: BudgetCheckDTO[];
    reasons: string[];
  };
  context: {
    contextVersion: string;
    approxTokens: number;
    knowledgeItems: number;
    criticalRules: number;
  } | null;
  instructions: { version: string; ruleCount: number; roleVersion: number | null } | null;
  activeRunId: string | null;
  approval: { id: string; status: string } | null;
}

export interface AgentRunUsageDTO {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}

export interface AgentRunDTO {
  id: string;
  number: number;
  executionType: RunExecutionType;
  status: AgentRunStatus;
  /** PRIMARY (ordinary) or SECOND_OPINION (an independent review of another run). */
  purpose: RunPurpose;
  /** Set only when purpose is SECOND_OPINION: the run being reviewed. */
  reviewedRunId: string | null;
  company: CompanyRef | null;
  task: { id: string; title: string } | null;
  agent: { id: string; name: string } | null;
  conversationId: string | null;
  provider: ProviderType;
  model: string;
  modelLabel: string;
  effort: EffortLevel | null;
  tier: Exclude<ModelTier, "auto">;
  responseDetail: ResponseDetail;
  maxOutputTokens: number;
  isMock: boolean;
  startedBy: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  errorCode: ProviderErrorCode | null;
  errorMessage: string | null;
  contextVersion: string | null;
  instructionVersion: string | null;
  contextSummary: {
    knowledgeItems: number;
    criticalRules: number;
    approxTokens: number;
    handoffs: number;
  } | null;
  providerRequestId: string | null;
  outputText: string;
  result: AgentExecutionResult | null;
  usage: AgentRunUsageDTO | null;
  estimatedCostUsd: number;
  /** Real API spend; null for subscription runs (N/A — included in the plan). */
  actualCostUsd: number | null;
  transport: ProviderTransport;
  billingMode: BillingMode;
  apiEquivalentUsd: number | null;
  latencyMs: number | null;
  stopReason: string | null;
  retryCount: number;
  phase: string;
  feedback: { rating: "useful" | "not_useful"; note: string | null; by: string | null } | null;
  proposals: { handoffs: number; knowledgeDrafts: number };
  viewer: { canStop: boolean; canFeedback: boolean; canRequestReview: boolean };
}

export interface AgentRunEventDTO {
  id: string;
  seq: number;
  type: RunEventType;
  label: string;
  detail: string | null;
  data: Record<string, unknown>;
  occurredAt: string;
}

export interface AgentRunDetailDTO extends AgentRunDTO {
  events: AgentRunEventDTO[];
  /** Populated only on a SECOND_OPINION run once completed. */
  review: ProviderReview | null;
}

/** One independently-requested critique of a completed run's result. */
export interface ProviderReviewDTO {
  id: string;
  reviewedRunId: string;
  /** The review's own run (carries status, streaming, cost/usage, cancellation). */
  reviewRun: AgentRunDTO;
  reviewerProvider: ProviderType;
  reviewerModel: string | null;
  requestedBy: string | null;
  requestedAt: string;
  review: ProviderReview | null;
}

/** Server-sent run stream message. */
export type RunStreamMessage =
  | { kind: "snapshot"; run: AgentRunDetailDTO }
  | { kind: "event"; event: AgentRunEventDTO }
  | { kind: "chunk"; text: string }
  | { kind: "status"; status: AgentRunStatus; phase: string };

export interface ProviderStatusDTO {
  provider: ProviderType;
  label: string;
  connected: boolean;
  isMock: boolean;
  state: ProviderHealthState;
  detail: string | null;
  transport: ProviderTransport;
  authMode: AuthMode;
  billingMode: BillingMode;
  /** Claude Code CLI facts from `claude --version` / `claude auth status` (never credentials). */
  cli: {
    binary: string;
    version: string | null;
    authMethod: string | null;
    subscriptionType: string | null;
    maxConcurrency: number;
  } | null;
  /** null = not yet known (no premium run attempted). */
  premiumAvailable: boolean | null;
  rateLimit: { status: string; resetsAt: string | null; type: string | null } | null;
  runsToday: number;
  enabled: boolean;
  standardModel: string | null;
  premiumModel: string | null;
  standardEffort: EffortLevel | null;
  premiumEffort: EffortLevel | null;
  dailyBudgetUsd: number | null;
  lastHealthCheckAt: string | null;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastErrorCode: string | null;
  callsToday: number;
  spendTodayUsd: number;
  prices: {
    model: string;
    inputPerMTok: number;
    outputPerMTok: number;
    cacheWritePerMTok: number;
    cacheReadPerMTok: number;
    effectiveFrom: string;
    source: string | null;
  }[];
}

export interface AgentPerformanceDTO {
  agentId: string;
  runsCompleted: number;
  runsFailed: number;
  averageLatencyMs: number | null;
  averageCostUsd: number | null;
  averageOutputTokens: number | null;
  feedbackUseful: number;
  feedbackNotUseful: number;
}

export interface ChatSendResultDTO {
  runId: string;
  messages: ConversationMessageDTO[];
}
