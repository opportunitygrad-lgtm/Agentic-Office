import { and, desc, eq, gte, inArray, isNull, lte, or, sql, type SQL } from "drizzle-orm";
import { evaluateBudget, type BudgetLimit } from "@aibos/delegation-core";
import {
  buildChatInput,
  buildReviewInput,
  buildTaskInput,
  DEFAULT_SUBSCRIPTION_LIMITS,
  maxOutputTokensFor,
  recentHistory,
  type ProviderInput,
  type SubscriptionLimits,
} from "@aibos/execution-core";
import {
  estimateCost,
  modelLabel,
  priceModelFor,
  routeExecution,
  type ModelPrice,
  type ProviderModelConfig,
  type ProviderRegistry,
} from "@aibos/provider-core";
import {
  ACTIVE_RUN_STATUSES,
  PROVIDER_LABELS,
  PROVIDER_TYPES,
  SENSITIVITY_LEVELS,
  sensitivityRank,
  startTaskRunSchema,
  type AgentCapability,
  type AgentContextPack,
  type AgentExecutionResult,
  type BillingMode,
  type BudgetCheckDTO,
  type BudgetDecision,
  type CompiledAgentInstructionPack,
  type ModelTier,
  type ProviderSelectionMode,
  type ProviderType,
  type ResponseDetail,
  type RouteDecisionDTO,
  type RunPreviewDTO,
  type SecondOpinionMode,
  type SensitivityLevel,
  type StartTaskRunInput,
} from "@aibos/shared";
import type { Database } from "../client";
import { ConflictError, ForbiddenError, NotFoundError } from "../errors";
import {
  agentCompanyAssignments,
  agentRunReviews,
  agentRuns,
  agents,
  aiModelPrices,
  aiProviderSettings,
  aiUsageRecords,
  approvals,
  companies,
  companyAiPolicies,
  conversationMessages,
  conversations,
  tasks,
  type Agent,
  type AgentRun,
  type Company,
  type Task,
} from "../schema";
import { compileInstructionsFor } from "./agent-roles";
import { recordAuditEvent } from "./audit";
import { buildContextPack } from "./context";
import { startOfUtcDay, startOfUtcMonth, actorAuditFields, type Actor } from "./util";
import { getWorkforcePolicy, refreshAgentStates } from "./workforce";

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Db = Database | Tx;

/** Runtime inputs the API and worker share (never credentials). */
export interface ExecutionEnv {
  registry: ProviderRegistry;
  timeoutMs: number;
  historyLimit: number;
  /** Operational limits for subscription-billed runs (defaults when omitted). */
  subscriptionLimits?: SubscriptionLimits;
}

const BLOCKING_AGENT_STATES = ["paused", "offline", "failed", "expired", "terminated"];
const LEASE_SECONDS = 300;

/* ---------- prices & provider settings ---------- */

export async function currentPrice(
  db: Db,
  provider: ProviderType,
  model: string,
  at = new Date(),
): Promise<ModelPrice | null> {
  const [row] = await db
    .select()
    .from(aiModelPrices)
    .where(
      and(
        eq(aiModelPrices.provider, provider),
        eq(aiModelPrices.model, model),
        lte(aiModelPrices.effectiveFrom, at),
      ),
    )
    .orderBy(desc(aiModelPrices.effectiveFrom))
    .limit(1);
  return row
    ? {
        provider: row.provider,
        model: row.model,
        inputPerMTok: row.inputPerMTok,
        outputPerMTok: row.outputPerMTok,
        cacheWritePerMTok: row.cacheWritePerMTok,
        cacheReadPerMTok: row.cacheReadPerMTok,
        currency: "USD",
        effectiveFrom: row.effectiveFrom.toISOString(),
        source: row.source,
      }
    : null;
}

/** Model configuration: provider settings override environment defaults. */
export async function effectiveModels(
  db: Db,
  registry: ProviderRegistry,
): Promise<Partial<Record<ProviderType, ProviderModelConfig>>> {
  const rows = await db.select().from(aiProviderSettings);
  const out: Partial<Record<ProviderType, ProviderModelConfig>> = {};
  for (const [provider, base] of Object.entries(registry.models) as [
    ProviderType,
    ProviderModelConfig,
  ][]) {
    const s = rows.find((r) => r.provider === provider);
    out[provider] = {
      standardModel: s?.standardModel ?? base.standardModel,
      premiumModel: s?.premiumModel ?? base.premiumModel,
      standardEffort: s?.standardEffort ?? base.standardEffort,
      premiumEffort: s?.premiumEffort ?? base.premiumEffort,
    };
  }
  return out;
}

/** CLI-transported providers have no credential the OS can inspect: health comes from
 * explicit Test Connection (local CLI checks) and real run outcomes, not a stored key. */
const CLI_TRANSPORTS = new Set(["claude_code_cli", "codex_cli"]);

const UNAVAILABLE_REASON: Partial<Record<ProviderType, Record<string, string>>> = {
  CLAUDE: {
    not_installed: "Claude Code is not installed on this machine",
    login_required: "Claude Code login required — open Terminal and run: claude login",
    login_expired: "Claude login expired — run in Terminal: claude login",
    misconfigured: "Claude Code is misconfigured — see Settings → AI Providers",
    rate_limited: "Claude Pro usage limit reached — no API fallback is used",
    auth_error: "Provider authentication failed",
    unavailable: "Provider unavailable",
  },
  OPENAI: {
    not_installed: "OpenAI Codex CLI is not installed on this machine",
    login_required: "OpenAI Codex login required — open Terminal and run: codex",
    login_expired: "ChatGPT login expired — open Terminal and run: codex",
    misconfigured: "OpenAI Codex is misconfigured — see Settings → AI Providers",
    rate_limited: "ChatGPT plan usage limit reached — no API fallback is used",
    auth_error: "Provider authentication failed",
    unavailable: "Provider unavailable",
  },
};

async function providerAvailability(db: Db, registry: ProviderRegistry) {
  const settings = await db.select().from(aiProviderSettings);
  return PROVIDER_TYPES.map((provider) => {
    const p = registry.get(provider);
    const s = settings.find((x) => x.provider === provider);
    const state = s?.healthState ?? null;
    const limit = s?.rateLimit as { resetsAt?: string | null } | null | undefined;
    const limited =
      state === "rate_limited" && (!limit?.resetsAt || Date.parse(limit.resetsAt) > Date.now());
    const blockedState =
      !!state &&
      ([
        "auth_error",
        "unavailable",
        "not_installed",
        "login_required",
        "login_expired",
        "misconfigured",
      ].includes(state) ||
        limited);
    const reason = !p.available()
      ? CLI_TRANSPORTS.has(p.transport)
        ? `${PROVIDER_LABELS[provider]} is not ready — see Settings → AI Providers`
        : `${provider} is not connected`
      : !(s?.enabled ?? true)
        ? `${provider} is disabled in Settings → AI Providers`
        : blockedState
          ? (UNAVAILABLE_REASON[provider]?.[state!] ?? `${provider} is unavailable`)
          : null;
    return {
      provider,
      available: p.available() && (s?.enabled ?? true) && !blockedState,
      isMock: p.isMock,
      reasoning: p.capabilities().includes("reasoning"),
      transport: p.transport,
      billingMode: p.billingMode,
      unavailableReason: reason,
    };
  });
}

/* ---------- company AI policy ---------- */

/**
 * `registry` is optional so callers that only need static policy (e.g. the
 * Settings UI) can omit it; AUTO provider selection resolves to CLAUDE unless
 * unavailable, then OPENAI, then falls back to the stored default — a
 * deterministic tie-break, never an AI or workload-based choice.
 */
export async function companyProviderPolicy(
  db: Db,
  companyId: string,
  registry?: ProviderRegistry,
) {
  const [p] = await db
    .select()
    .from(companyAiPolicies)
    .where(eq(companyAiPolicies.companyId, companyId));
  const [c] = await db
    .select({ defaultProvider: companies.defaultProvider })
    .from(companies)
    .where(eq(companies.id, companyId));
  const providerSelection = (p?.providerSelection ?? "fixed") as ProviderSelectionMode;
  const storedDefault = (c?.defaultProvider ?? "CLAUDE") as ProviderType | null;
  let preferredProvider = storedDefault;
  if (providerSelection === "auto" && registry) {
    preferredProvider = registry.get("CLAUDE").available()
      ? "CLAUDE"
      : registry.get("OPENAI").available()
        ? "OPENAI"
        : storedDefault;
  }
  return {
    allowedProviders: (p?.allowedProviders ?? [
      "CLAUDE",
      "OPENAI",
      "GROK",
      "LOCAL",
    ]) as ProviderType[],
    preferredProvider,
    providerSelection,
    defaultModelTier: (p?.defaultModelTier ?? "standard") as ModelTier,
    premiumAllowed: p?.premiumAllowed ?? false,
    fallbackAllowed: p?.fallbackAllowed ?? false,
    maxResponseDetail: (p?.maxResponseDetail ?? "detailed") as ResponseDetail,
    reviewMode: (p?.reviewMode ?? "manual") as SecondOpinionMode,
    reviewProvider: (p?.reviewProvider ?? null) as ProviderType | null,
    reviewTaskTypes: p?.reviewTaskTypes ?? [],
    highValueThresholdUsd: p?.highValueThresholdUsd ?? null,
    maxReviewsPerTask: p?.maxReviewsPerTask ?? 1,
  };
}

/* ---------- sensitivity cap ---------- */

/** Clearance of a person for one company, from their permissions. */
export function viewerClearance(can: (permission: string) => boolean): SensitivityLevel {
  if (can("knowledge.restricted.read")) return "restricted";
  if (can("knowledge.confidential.read")) return "confidential";
  return "internal";
}

/** Caps a context pack to min(agent clearance, person clearance). */
export function capContextForViewer(
  pack: AgentContextPack,
  viewerMax: SensitivityLevel,
): { pack: AgentContextPack; removed: number } {
  const ok = (s: SensitivityLevel) => sensitivityRank(s) <= sensitivityRank(viewerMax);
  const knowledge = pack.knowledge.filter((k) => ok(k.sensitivity));
  const unverified = pack.unverified.filter((k) => ok(k.sensitivity));
  const removed =
    pack.knowledge.length + pack.unverified.length - knowledge.length - unverified.length;
  return { pack: { ...pack, knowledge, unverified }, removed };
}

const asSensitivity = (v: string): SensitivityLevel =>
  (SENSITIVITY_LEVELS as readonly string[]).includes(v) ? (v as SensitivityLevel) : "internal";

/* ---------- planning ---------- */

export interface RunPlan {
  kind: "task" | "chat" | "review";
  company: Company;
  agent: Agent;
  task: Task | null;
  conversationId: string | null;
  instructions: CompiledAgentInstructionPack;
  context: AgentContextPack;
  input: ProviderInput;
  route: RouteDecisionDTO;
  detail: ResponseDetail;
  maxOutputTokens: number;
  contextSummary: {
    knowledgeItems: number;
    criticalRules: number;
    approxTokens: number;
    handoffs: number;
    removedForViewer: number;
    historyDropped?: number;
  };
  problems: string[];
  /** Set only for kind "review": the primary run this run independently critiques. */
  reviewedRunId?: string | null;
}

async function agentServes(db: Db, agent: Agent, companyId: string): Promise<boolean> {
  if (agent.scope === "global") return true;
  const [a] = await db
    .select()
    .from(agentCompanyAssignments)
    .where(
      and(
        eq(agentCompanyAssignments.agentId, agent.id),
        eq(agentCompanyAssignments.companyId, companyId),
      ),
    );
  return !!a;
}

async function routeFor(
  db: Db,
  env: ExecutionEnv,
  args: {
    company: Company;
    agent: Agent;
    task: Task | null;
    requestedTier?: ModelTier | null;
    requestedProvider?: ProviderType | null;
    approxInputTokens: number;
    maxOutputTokens: number;
  },
): Promise<RouteDecisionDTO> {
  const policy = await companyProviderPolicy(db, args.company.id, env.registry);
  const [providers, models] = await Promise.all([
    providerAvailability(db, env.registry),
    effectiveModels(db, env.registry),
  ]);
  const prices = new Map<string, ModelPrice | null>();
  for (const [p, m] of Object.entries(models) as [ProviderType, ProviderModelConfig][])
    for (const model of [m.standardModel, m.premiumModel]) {
      prices.set(`${p}:${model}`, await currentPrice(db, p, model));
      // Subscription aliases (sonnet/opus) are compared against their API price
      // for the NOT BILLED estimate only.
      const priced = priceModelFor(model);
      if (priced !== model) prices.set(`${p}:${priced}`, await currentPrice(db, p, priced));
    }
  return routeExecution({
    company: policy,
    agent: {
      primaryProvider: args.agent.primaryProvider,
      fallbackProvider: args.agent.fallbackProvider,
      preferredModelTier: args.agent.preferredModelTier,
      defaultEffort: args.agent.defaultEffort,
    },
    task: args.task
      ? {
          providerRequirement: args.task.providerPreference,
          modelTier: args.task.modelTier,
          highComplexity: args.task.highComplexity,
          requiredCapabilities: args.task.requiredCapabilities as AgentCapability[],
        }
      : null,
    requestedTier: args.requestedTier ?? null,
    requestedProvider: args.requestedProvider ?? null,
    providers,
    models,
    price: (p, m) => prices.get(`${p}:${m}`) ?? null,
    estimate: { inputTokens: args.approxInputTokens, maxOutputTokens: args.maxOutputTokens },
  });
}

function summarise(context: AgentContextPack, removed: number, approxTokens: number) {
  return {
    knowledgeItems: context.knowledge.length + context.unverified.length,
    criticalRules: [
      ...context.rules.compliance,
      ...context.rules.commercial,
      ...context.rules.brand,
    ].filter((r) => r.severity === "critical").length,
    approxTokens,
    handoffs: context.handoffs?.length ?? 0,
    removedForViewer: removed,
  };
}

/**
 * Builds everything a task run needs, re-verifying company isolation:
 * the task must belong to a company the assigned agent serves. Soft problems
 * (e.g. agent paused) are returned; isolation violations throw.
 */
export async function planTaskRun(
  db: Db,
  env: ExecutionEnv,
  taskId: string,
  opts: {
    viewerMaxSensitivity: SensitivityLevel;
    requestedTier?: ModelTier | null;
    responseDetail?: ResponseDetail | null;
    requestedProvider?: ProviderType | null;
  },
): Promise<RunPlan> {
  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId));
  if (!task) throw new NotFoundError("Task", taskId);
  if (!task.companyId)
    throw new ConflictError(
      "Group-level tasks span companies and cannot run with one company context",
    );
  if (!task.assignedAgentId) throw new ConflictError("Assign an agent before running this task");
  const [company] = await db.select().from(companies).where(eq(companies.id, task.companyId));
  const [agent] = await db.select().from(agents).where(eq(agents.id, task.assignedAgentId));
  if (!company || !agent) throw new NotFoundError("Task", taskId);
  if (!(await agentServes(db, agent, company.id)))
    throw new ForbiddenError("The assigned agent does not serve this company");
  const problems: string[] = [];
  if (["completed", "cancelled", "failed"].includes(task.status))
    problems.push(`Task is ${task.status}`);
  if (BLOCKING_AGENT_STATES.includes(agent.status)) problems.push(`Agent is ${agent.status}`);
  if (agent.autonomyLevel === "disabled") problems.push("Agent autonomy is disabled");

  const policy = await companyProviderPolicy(db, company.id, env.registry);
  const { detail, maxOutputTokens } = maxOutputTokensFor(
    opts.responseDetail ?? task.responseDetail,
    policy.maxResponseDetail,
  );
  const instructions = await compileInstructionsFor(db, {
    agentId: agent.id,
    companyId: company.id,
    taskId: task.id,
  });
  const raw = await buildContextPack(db, {
    companyId: company.id,
    agentId: agent.id,
    taskId: task.id,
  });
  const { pack: context, removed } = capContextForViewer(raw, opts.viewerMaxSensitivity);
  const input = buildTaskInput(instructions, context, {
    title: task.title,
    description: task.description,
  });
  const route = await routeFor(db, env, {
    company,
    agent,
    task,
    requestedTier: opts.requestedTier,
    requestedProvider: opts.requestedProvider,
    approxInputTokens: input.approxInputTokens,
    maxOutputTokens,
  });
  return {
    kind: "task",
    company,
    agent,
    task,
    conversationId: null,
    instructions,
    context,
    input,
    route,
    detail,
    maxOutputTokens,
    contextSummary: summarise(context, removed, input.approxInputTokens),
    problems,
  };
}

export async function planChatRun(
  db: Db,
  env: ExecutionEnv,
  conversationId: string,
  message: string,
  opts: {
    viewerMaxSensitivity: SensitivityLevel;
    excludeMessageId?: string | null;
    requestedProvider?: ProviderType | null;
  },
): Promise<RunPlan> {
  const [c] = await db.select().from(conversations).where(eq(conversations.id, conversationId));
  if (!c) throw new NotFoundError("Conversation", conversationId);
  const [company] = await db.select().from(companies).where(eq(companies.id, c.companyId));
  const [agent] = await db.select().from(agents).where(eq(agents.id, c.agentId));
  if (!company || !agent) throw new NotFoundError("Conversation", conversationId);
  if (!(await agentServes(db, agent, company.id)))
    throw new ForbiddenError("The agent does not serve this company");
  let task: Task | null = null;
  if (c.taskId) {
    const [t] = await db.select().from(tasks).where(eq(tasks.id, c.taskId));
    if (t && t.companyId !== company.id)
      throw new ForbiddenError("The conversation task belongs to another company");
    task = t ?? null;
  }
  const problems: string[] = [];
  if (BLOCKING_AGENT_STATES.includes(agent.status)) problems.push(`Agent is ${agent.status}`);
  if (agent.autonomyLevel === "disabled") problems.push("Agent autonomy is disabled");
  const policy = await companyProviderPolicy(db, company.id, env.registry);
  const { detail, maxOutputTokens } = maxOutputTokensFor("normal", policy.maxResponseDetail);
  const instructions = await compileInstructionsFor(db, {
    agentId: agent.id,
    companyId: company.id,
    taskId: task?.id ?? null,
  });
  const raw = await buildContextPack(db, {
    companyId: company.id,
    agentId: agent.id,
    taskId: task?.id ?? null,
  });
  const { pack: context, removed } = capContextForViewer(raw, opts.viewerMaxSensitivity);
  const rows = await db
    .select({
      id: conversationMessages.id,
      role: conversationMessages.role,
      content: conversationMessages.content,
    })
    .from(conversationMessages)
    .where(eq(conversationMessages.conversationId, conversationId))
    .orderBy(conversationMessages.createdAt);
  const prior = rows.filter(
    (r) => r.id !== opts.excludeMessageId && (r.role === "human" || r.role === "agent"),
  ) as { role: "human" | "agent"; content: string }[];
  const { kept, dropped } = recentHistory(prior, env.historyLimit);
  const input = buildChatInput(instructions, context, kept, message);
  const route = await routeFor(db, env, {
    company,
    agent,
    task: null,
    requestedProvider: opts.requestedProvider,
    approxInputTokens: input.approxInputTokens,
    maxOutputTokens,
  });
  return {
    kind: "chat",
    company,
    agent,
    task,
    conversationId,
    instructions,
    context,
    input,
    route,
    detail,
    maxOutputTokens,
    contextSummary: {
      ...summarise(context, removed, input.approxInputTokens),
      historyDropped: dropped,
    },
    problems,
  };
}

/* ---------- second-opinion review planning ---------- */

interface ReviewCandidate {
  reviewedRun: AgentRun;
  task: Task;
  company: Company;
  agent: Agent;
}

/** Loads and validates the run a second opinion would review — never the reverse. */
async function loadReviewCandidate(db: Db, reviewedRunId: string): Promise<ReviewCandidate> {
  const [run] = await db.select().from(agentRuns).where(eq(agentRuns.id, reviewedRunId));
  if (!run) throw new NotFoundError("Run", reviewedRunId);
  if (run.runPurpose !== "primary")
    throw new ConflictError("Only a primary run can be reviewed — a review is not itself reviewable");
  if (run.status !== "completed") throw new ConflictError("Only a completed run can be reviewed");
  if (run.executionType !== "task")
    throw new ConflictError("A second opinion is available for task runs only");
  if (!run.companyId || !run.agentId || !run.taskId)
    throw new ConflictError("This run cannot be reviewed (missing company, agent or task)");
  const [company] = await db.select().from(companies).where(eq(companies.id, run.companyId));
  const [agent] = await db.select().from(agents).where(eq(agents.id, run.agentId));
  const [task] = await db.select().from(tasks).where(eq(tasks.id, run.taskId));
  if (!company || !agent || !task) throw new NotFoundError("Run", reviewedRunId);
  return { reviewedRun: run, task, company, agent };
}

/**
 * Builds an independent second-opinion review run. Bypasses routeExecution's
 * provider-selection entirely: the reviewer provider is explicitly chosen by
 * the caller (never automatic), and the route is built directly from
 * effectiveModels()/currentPrice() the same way routeExecution would, minus
 * the candidate-selection steps that do not apply to an explicit choice.
 * Re-verifies isolation independently of the original run's plan.
 */
export async function planReviewRun(
  db: Db,
  env: ExecutionEnv,
  reviewedRunId: string,
  reviewerProvider: ProviderType,
  opts: { viewerMaxSensitivity: SensitivityLevel },
): Promise<RunPlan> {
  const { reviewedRun, task, company, agent } = await loadReviewCandidate(db, reviewedRunId);
  if (reviewerProvider === reviewedRun.provider)
    throw new ConflictError(
      "A provider cannot review its own result — choose a different reviewer",
    );
  const result = reviewedRun.result as AgentExecutionResult | null;
  if (!result) throw new ConflictError("The original run has no structured result to review");
  if (!(await agentServes(db, agent, company.id)))
    throw new ForbiddenError("The assigned agent does not serve this company");

  // Never let a review see more than the original run was allowed to see.
  const originalViewer = asSensitivity(reviewedRun.viewerMaxSensitivity);
  const viewerMaxSensitivity =
    sensitivityRank(originalViewer) <= sensitivityRank(opts.viewerMaxSensitivity)
      ? originalViewer
      : opts.viewerMaxSensitivity;

  const policy = await companyProviderPolicy(db, company.id, env.registry);
  if (!policy.allowedProviders.includes(reviewerProvider))
    throw new ConflictError(`${reviewerProvider} is not permitted by company policy`);

  const instructions = await compileInstructionsFor(db, {
    agentId: agent.id,
    companyId: company.id,
    taskId: task.id,
  });
  const raw = await buildContextPack(db, {
    companyId: company.id,
    agentId: agent.id,
    taskId: task.id,
  });
  const { pack: context, removed } = capContextForViewer(raw, viewerMaxSensitivity);
  const input = buildReviewInput(
    context,
    { title: task.title, description: task.description },
    { summary: result.summary, response: result.response },
  );

  const { detail, maxOutputTokens } = maxOutputTokensFor(
    reviewedRun.responseDetail,
    policy.maxResponseDetail,
  );
  const [providers, models] = await Promise.all([
    providerAvailability(db, env.registry),
    effectiveModels(db, env.registry),
  ]);
  const info = providers.find((p) => p.provider === reviewerProvider);
  if (!info || !info.available)
    throw new ConflictError(info?.unavailableReason ?? `${reviewerProvider} is not available`);
  const m = models[reviewerProvider];
  if (!m) throw new ConflictError(`No model configuration for ${reviewerProvider}`);
  const model = m.standardModel;
  const effort = m.standardEffort;
  const price = await currentPrice(
    db,
    reviewerProvider,
    info.billingMode === "subscription" ? priceModelFor(model) : model,
  );
  if (!price && info.billingMode === "api")
    throw new ConflictError(`No price configured for ${model} — cost cannot be controlled`);
  const est = estimateCost(price, {
    provider: reviewerProvider,
    model,
    inputTokens: input.approxInputTokens,
    maxOutputTokens,
  });
  const route: RouteDecisionDTO = {
    provider: reviewerProvider,
    model,
    modelLabel: modelLabel(model),
    effort,
    tier: "standard",
    reasons: [`${reviewerProvider}: explicitly selected as independent reviewer`],
    estimatedInputTokens: est.inputTokens,
    estimatedOutputTokens: est.outputTokens,
    estimatedCostUsd: info.billingMode === "subscription" ? 0 : est.costUsd,
    fallbackProvider: null,
    approvalRequired: false,
    blockedReason: null,
    isMock: info.isMock,
    transport: info.transport,
    billingMode: info.billingMode,
    apiEquivalentUsd: info.billingMode === "subscription" && price ? est.costUsd : null,
  };
  return {
    kind: "review",
    company,
    agent,
    task,
    conversationId: null,
    instructions,
    context,
    input,
    route,
    detail,
    maxOutputTokens,
    contextSummary: summarise(context, removed, input.approxInputTokens),
    problems: [],
    reviewedRunId,
  };
}

/* ---------- budget preflight ---------- */

async function spentSince(
  db: Db,
  where: ReturnType<typeof and>,
  since: Date | null,
): Promise<number> {
  const [r] = await db
    .select({ n: sql<number>`coalesce(sum(${aiUsageRecords.actualCost}), 0)::float8` })
    .from(aiUsageRecords)
    .where(
      and(
        eq(aiUsageRecords.origin, "live"),
        where,
        since ? gte(aiUsageRecords.occurredAt, since) : undefined,
      ),
    );
  return r?.n ?? 0;
}

async function reservedFor(db: Db, where: ReturnType<typeof and>): Promise<number> {
  const [r] = await db
    .select({ n: sql<number>`coalesce(sum(${agentRuns.reservedCost}), 0)::float8` })
    .from(agentRuns)
    .where(and(eq(agentRuns.reservationStatus, "active"), where));
  return r?.n ?? 0;
}

/**
 * Pre-flight budget check before any provider call: task, agent (per task and
 * daily), company (daily, monthly), provider daily and the global daily
 * ceiling — each net of live spend AND active reservations, so concurrent
 * runs cannot consume the same remaining budget. Mock usage never counts.
 */
export async function budgetPreflight(
  db: Db,
  args: {
    company: Company;
    agent: Agent;
    task: Task | null;
    provider: ProviderType;
    estimateUsd: number;
    /** Subscription runs use operational limits instead of dollar budgets. */
    billingMode?: BillingMode;
    inputTokens?: number;
    subscription?: SubscriptionLimits;
    now?: Date;
  },
): Promise<{ decision: BudgetDecision; checks: BudgetCheckDTO[]; reasons: string[] }> {
  const now = args.now ?? new Date();
  const day = startOfUtcDay(now);
  if (args.billingMode === "subscription")
    return subscriptionPreflight(
      db,
      { ...args, day },
      args.subscription ?? DEFAULT_SUBSCRIPTION_LIMITS,
    );
  const month = startOfUtcMonth(now);
  const policy = await getWorkforcePolicy(db);
  const [settings] = await db
    .select()
    .from(aiProviderSettings)
    .where(eq(aiProviderSettings.provider, args.provider));
  const checks: BudgetCheckDTO[] = [];
  const add = async (
    scope: BudgetCheckDTO["scope"],
    limit: number | null,
    spent: () => Promise<number>,
    reserved: () => Promise<number>,
  ) => {
    if (limit === null || limit === undefined) return;
    const s = await spent();
    const r = await reserved();
    const remaining = Math.max(0, Math.round((limit - s - r) * 1e6) / 1e6);
    checks.push({
      scope,
      limitUsd: limit,
      spentUsd: s,
      reservedUsd: r,
      remainingUsd: remaining,
      passed: args.estimateUsd <= remaining,
    });
  };
  const zero = async () => 0;
  if (args.task)
    await add(
      "task",
      args.task.maxBudget,
      () => spentSince(db, eq(aiUsageRecords.taskId, args.task!.id), null),
      () => reservedFor(db, eq(agentRuns.taskId, args.task!.id)),
    );
  await add("agent_task", args.agent.perTaskBudget, zero, zero);
  await add(
    "agent_daily",
    args.agent.dailyBudget,
    () => spentSince(db, eq(aiUsageRecords.agentId, args.agent.id), day),
    () => reservedFor(db, eq(agentRuns.agentId, args.agent.id)),
  );
  await add(
    "company_daily",
    args.company.dailyAiBudget,
    () => spentSince(db, eq(aiUsageRecords.companyId, args.company.id), day),
    () => reservedFor(db, eq(agentRuns.companyId, args.company.id)),
  );
  await add(
    "company_monthly",
    args.company.monthlyAiBudget,
    () => spentSince(db, eq(aiUsageRecords.companyId, args.company.id), month),
    () => reservedFor(db, eq(agentRuns.companyId, args.company.id)),
  );
  await add(
    "provider_daily",
    settings?.dailyBudgetUsd ?? null,
    () => spentSince(db, eq(aiUsageRecords.provider, args.provider), day),
    () => reservedFor(db, eq(agentRuns.provider, args.provider)),
  );
  await add(
    "global_daily",
    policy.globalDailyAiBudgetUsd,
    () => spentSince(db, sql`true`, day),
    () => reservedFor(db, sql`true`),
  );
  const LABEL: Record<BudgetCheckDTO["scope"], string> = {
    task: "the task's remaining budget",
    agent_task: "the agent's per-task budget",
    agent_daily: "the agent's remaining daily budget",
    company_daily: "the company's remaining daily AI budget",
    company_monthly: "the company's remaining monthly AI budget",
    provider_daily: "the provider's remaining daily budget",
    global_daily: "the platform's remaining daily AI budget",
    subscription_task_runs: "the task's subscription runs today",
    subscription_agent_daily_runs: "the agent's subscription runs today",
    subscription_input_size: "the subscription request-size limit",
  };
  const limits: BudgetLimit[] = checks.map((c) => ({
    label: LABEL[c.scope],
    remainingUsd: c.remainingUsd,
    fixed: true,
  }));
  const { decision, reasons } = evaluateBudget(
    args.estimateUsd,
    limits,
    policy.highCostTaskThresholdUsd,
  );
  if (!reasons.length)
    reasons.push(
      `Estimate $${args.estimateUsd} within task, agent, company, provider and platform budgets`,
    );
  return { decision, checks, reasons };
}

/**
 * Subscription (Claude Code) preflight: bounded by runs per task and per agent
 * per day and by request size — never by dollars, never "requires approval",
 * and it never switches the run to API billing.
 */
async function subscriptionPreflight(
  db: Db,
  args: { agent: Agent; task: Task | null; inputTokens?: number; day: Date },
  limits: SubscriptionLimits,
): Promise<{ decision: BudgetDecision; checks: BudgetCheckDTO[]; reasons: string[] }> {
  const count = async (where: SQL) => {
    const [r] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(agentRuns)
      .where(
        and(
          where,
          eq(agentRuns.billingMode, "subscription"),
          gte(agentRuns.createdAt, args.day),
          sql`${agentRuns.status} <> 'cancelled' or ${agentRuns.providerCallStartedAt} is not null`,
        ),
      );
    return r?.n ?? 0;
  };
  const checks: BudgetCheckDTO[] = [];
  const reasons: string[] = [];
  const push = (
    scope: BudgetCheckDTO["scope"],
    unit: "runs" | "tokens",
    limit: number,
    used: number,
    next: number,
    why: string,
  ) => {
    const passed = used + next <= limit;
    checks.push({
      scope,
      unit,
      limitUsd: limit,
      spentUsd: used,
      reservedUsd: 0,
      remainingUsd: Math.max(0, limit - used),
      passed,
    });
    if (!passed) reasons.push(why);
  };
  if (args.task)
    push(
      "subscription_task_runs",
      "runs",
      limits.maxRunsPerTaskPerDay,
      await count(eq(agentRuns.taskId, args.task.id)),
      1,
      `This task reached its limit of ${limits.maxRunsPerTaskPerDay} Claude subscription runs today`,
    );
  push(
    "subscription_agent_daily_runs",
    "runs",
    limits.maxRunsPerAgentPerDay,
    await count(eq(agentRuns.agentId, args.agent.id)),
    1,
    `${args.agent.name} reached its limit of ${limits.maxRunsPerAgentPerDay} Claude subscription runs today`,
  );
  push(
    "subscription_input_size",
    "tokens",
    limits.maxInputTokens,
    0,
    args.inputTokens ?? 0,
    `The request (~${args.inputTokens ?? 0} tokens) exceeds the ${limits.maxInputTokens}-token limit for subscription runs`,
  );
  if (!reasons.length)
    reasons.push(
      "Within Claude subscription limits (runs per task/agent, request size) — no API spend",
    );
  return {
    decision: reasons.length && checks.some((c) => !c.passed) ? "blocked" : "allowed",
    checks,
    reasons,
  };
}

/** An approved (≤24h old) or pending approval for running this task. */
async function runApproval(db: Db, taskId: string) {
  const rows = await db
    .select()
    .from(approvals)
    .where(
      and(
        eq(approvals.taskId, taskId),
        eq(approvals.type, "custom"),
        sql`${approvals.proposedChange}->>'kind' = 'ai_run'`,
        or(
          eq(approvals.status, "pending"),
          and(
            eq(approvals.status, "approved"),
            gte(approvals.decidedAt, new Date(Date.now() - 86_400_000)),
          ),
        ),
      ),
    )
    .orderBy(desc(approvals.createdAt));
  return {
    approved: rows.find((r) => r.status === "approved") ?? null,
    pending: rows.find((r) => r.status === "pending") ?? null,
  };
}

/* ---------- preview ---------- */

export async function activeRunFor(
  db: Db,
  where: { taskId?: string; conversationId?: string },
): Promise<string | null> {
  const [r] = await db
    .select({ id: agentRuns.id })
    .from(agentRuns)
    .where(
      and(
        where.taskId
          ? eq(agentRuns.taskId, where.taskId)
          : eq(agentRuns.conversationId, where.conversationId!),
        inArray(agentRuns.status, [...ACTIVE_RUN_STATUSES]),
      ),
    );
  return r?.id ?? null;
}

export async function previewTaskRun(
  db: Database,
  env: ExecutionEnv,
  taskId: string,
  opts: {
    viewerMaxSensitivity: SensitivityLevel;
    requestedTier?: ModelTier | null;
    responseDetail?: ResponseDetail | null;
    requestedProvider?: ProviderType | null;
  },
): Promise<RunPreviewDTO> {
  const plan = await planTaskRun(db, env, taskId, opts).catch((e: unknown) => e as Error);
  const empty = { decision: "blocked" as const, checks: [], reasons: [] as string[] };
  if (plan instanceof Error) {
    if (plan instanceof ForbiddenError || plan instanceof NotFoundError) throw plan;
    return {
      eligible: false,
      reasons: [plan.message],
      agent: null,
      company: null,
      route: routeBlocked(plan.message),
      budget: empty,
      context: null,
      instructions: null,
      activeRunId: await activeRunFor(db, { taskId }),
      approval: null,
    };
  }
  const reasons = [...plan.problems];
  if (plan.route.blockedReason) reasons.push(plan.route.blockedReason);
  const budget = plan.route.provider
    ? await budgetPreflight(db, {
        company: plan.company,
        agent: plan.agent,
        task: plan.task,
        provider: plan.route.provider,
        estimateUsd: plan.route.estimatedCostUsd,
        billingMode: plan.route.billingMode,
        inputTokens: plan.route.estimatedInputTokens,
        subscription: env.subscriptionLimits,
      })
    : empty;
  const { approved, pending } = await runApproval(db, taskId);
  if (budget.decision === "blocked") reasons.push(...budget.reasons);
  const activeRunId = await activeRunFor(db, { taskId });
  if (activeRunId) reasons.push("This task already has an active run");
  const approvalRequired = budget.decision === "requires_approval" && !approved;
  return {
    eligible: reasons.length === 0,
    reasons,
    agent: { id: plan.agent.id, name: plan.agent.name },
    company: {
      id: plan.company.id,
      name: plan.company.name,
      slug: plan.company.slug,
      accentColor: plan.company.accentColor,
    },
    route: { ...plan.route, approvalRequired },
    budget,
    context: {
      contextVersion: plan.context.version,
      approxTokens: plan.contextSummary.approxTokens,
      knowledgeItems: plan.contextSummary.knowledgeItems,
      criticalRules: plan.contextSummary.criticalRules,
    },
    instructions: {
      version: plan.instructions.version,
      ruleCount: plan.instructions.metadata.ruleCount,
      roleVersion: plan.instructions.metadata.roleVersion,
    },
    activeRunId,
    approval:
      (approved ?? pending)
        ? { id: (approved ?? pending)!.id, status: (approved ?? pending)!.status }
        : null,
  };
}

function routeBlocked(reason: string): RouteDecisionDTO {
  return {
    provider: null,
    model: null,
    modelLabel: null,
    effort: null,
    tier: null,
    reasons: [reason],
    estimatedInputTokens: 0,
    estimatedOutputTokens: 0,
    estimatedCostUsd: 0,
    fallbackProvider: null,
    approvalRequired: false,
    blockedReason: reason,
    isMock: false,
    transport: "none",
    billingMode: "none",
    apiEquivalentUsd: null,
  };
}

/* ---------- run creation ---------- */

export type StartRunResult =
  | { status: "started"; runId: string }
  | { status: "existing"; runId: string }
  | { status: "approval_required"; approvalId: string; reasons: string[] };

async function nextEventSeq(tx: Db, runId: string): Promise<number> {
  const [r] = await tx.execute<{ n: number }>(
    sql`select coalesce(max(seq), 0)::int + 1 as n from agent_run_events where run_id = ${runId}`,
  );
  return r?.n ?? 1;
}

export async function appendRunEvent(
  tx: Db,
  runId: string,
  type: string,
  detail: string | null = null,
  data: Record<string, unknown> = {},
) {
  const seq = await nextEventSeq(tx, runId);
  await tx.execute(
    sql`insert into agent_run_events (run_id, seq, type, detail, data) values (${runId}, ${seq}, ${type}, ${detail}, ${JSON.stringify(data)}::jsonb)`,
  );
}

async function insertRun(
  tx: Tx,
  plan: RunPlan,
  env: ExecutionEnv,
  actor: Actor,
  extra: {
    idempotencyKey?: string | null;
    viewerMaxSensitivity: SensitivityLevel;
    maxRetries: number;
  },
): Promise<string> {
  const route = plan.route;
  const price = await currentPrice(
    tx,
    route.provider!,
    route.billingMode === "subscription" ? priceModelFor(route.model!) : route.model!,
  );
  const [{ n }] = (await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(agentRuns)
    .where(
      plan.task
        ? eq(agentRuns.taskId, plan.task.id)
        : eq(agentRuns.conversationId, plan.conversationId!),
    )) as [{ n: number }];
  const [run] = await tx
    .insert(agentRuns)
    .values({
      number: n + 1,
      executionType: plan.kind,
      status: "queued",
      companyId: plan.company.id,
      taskId: plan.task && plan.kind !== "chat" ? plan.task.id : null,
      agentId: plan.agent.id,
      runPurpose: plan.reviewedRunId ? "second_opinion" : "primary",
      reviewedRunId: plan.reviewedRunId ?? null,
      conversationId: plan.conversationId,
      provider: route.provider!,
      model: route.model!,
      effort: route.effort,
      tier: route.tier ?? "standard",
      responseDetail: plan.detail,
      maxOutputTokens: plan.maxOutputTokens,
      timeoutMs: env.timeoutMs,
      maxRetries: extra.maxRetries,
      isMock: route.isMock,
      startedByUserId: actor.userId ?? null,
      idempotencyKey: extra.idempotencyKey ?? null,
      viewerMaxSensitivity: extra.viewerMaxSensitivity,
      routeReasons: route.reasons,
      contextVersion: plan.context.version,
      instructionVersion: plan.instructions.version,
      contextSummary: plan.contextSummary,
      estimatedCost: route.estimatedCostUsd,
      // Subscription runs reserve no money (they are never API-billed).
      reservedCost: route.billingMode === "subscription" ? 0 : route.estimatedCostUsd,
      reservationStatus: route.billingMode === "subscription" ? "none" : "active",
      priceSnapshot: price,
      transport: route.transport,
      billingMode:
        route.billingMode === "subscription"
          ? "subscription"
          : route.billingMode === "none"
            ? "none"
            : "api",
      apiEquivalentCost: route.apiEquivalentUsd,
    })
    .returning({ id: agentRuns.id });
  const runId = run!.id;
  await appendRunEvent(tx, runId, "RUN_CREATED", null, {
    estimatedCostUsd: route.estimatedCostUsd,
  });
  await appendRunEvent(
    tx,
    runId,
    "PROVIDER_ROUTED",
    `${route.modelLabel} · ${route.effort ?? "default"} effort`,
    { reasons: route.reasons, provider: route.provider, model: route.model },
  );
  const audit = {
    ...actorAuditFields(actor),
    companyId: plan.company.id,
    agentId: plan.agent.id,
    taskId: plan.task?.id,
    resourceType: "agent_run",
    resourceId: runId,
  };
  await recordAuditEvent(tx, {
    ...audit,
    action: "agent_run.created",
    description: `${plan.kind === "chat" ? "Chat" : plan.kind === "review" ? "Second-opinion review" : "Task"} run created for ${plan.agent.name} (${route.modelLabel}, est $${route.estimatedCostUsd})`,
    metadata: {
      provider: route.provider,
      model: route.model,
      effort: route.effort,
      tier: route.tier,
      isMock: route.isMock,
    },
  });
  await recordAuditEvent(tx, {
    ...audit,
    action: "provider.routed",
    description: `Routed to ${route.provider} ${route.model}`,
    metadata: { reasons: route.reasons },
  });
  return runId;
}

/**
 * Validates and creates a task run, then the caller enqueues it for the
 * worker (the API never calls a provider inline). Duplicate clicks return the
 * existing active run (idempotency key + one-active-run-per-task index).
 */
export async function startTaskRun(
  db: Database,
  env: ExecutionEnv,
  taskId: string,
  input: StartTaskRunInput,
  actor: Actor,
  opts: { viewerMaxSensitivity: SensitivityLevel },
): Promise<StartRunResult> {
  const data = startTaskRunSchema.parse(input);
  if (data.idempotencyKey) {
    const [existing] = await db
      .select({ id: agentRuns.id, taskId: agentRuns.taskId })
      .from(agentRuns)
      .where(eq(agentRuns.idempotencyKey, data.idempotencyKey));
    if (existing) {
      if (existing.taskId !== taskId)
        throw new ConflictError("Idempotency key already used for another run");
      return { status: "existing", runId: existing.id };
    }
  }
  const active = await activeRunFor(db, { taskId });
  if (active) return { status: "existing", runId: active };

  const plan = await planTaskRun(db, env, taskId, {
    viewerMaxSensitivity: opts.viewerMaxSensitivity,
    requestedTier: data.modelTier,
    responseDetail: data.responseDetail,
    requestedProvider: data.provider,
  });
  if (plan.problems.length) throw new ConflictError(plan.problems.join("; "));
  if (plan.route.blockedReason || !plan.route.provider)
    throw new ConflictError(plan.route.blockedReason ?? "No provider available");

  const result = await db
    .transaction(async (tx) => {
      // Serialise budget decisions per company so concurrent runs see each other's reservations.
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`ai-budget:${plan.company.id}`}))`,
      );
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('ai-budget:global'))`);
      const again = await activeRunFor(tx, { taskId });
      if (again) return { status: "existing", runId: again } as StartRunResult;
      const budget = await budgetPreflight(tx, {
        company: plan.company,
        agent: plan.agent,
        task: plan.task,
        provider: plan.route.provider!,
        estimateUsd: plan.route.estimatedCostUsd,
        billingMode: plan.route.billingMode,
        inputTokens: plan.route.estimatedInputTokens,
        subscription: env.subscriptionLimits,
      });
      const audit = {
        ...actorAuditFields(actor),
        companyId: plan.company.id,
        agentId: plan.agent.id,
        taskId,
        resourceType: "task",
        resourceId: taskId,
      };
      if (budget.decision === "blocked") {
        await recordAuditEvent(tx, {
          ...audit,
          action: "ai.budget_blocked",
          description: `AI run blocked by budget: ${budget.reasons.join("; ")}`,
          outcome: "failure",
          metadata: { estimateUsd: plan.route.estimatedCostUsd },
        });
        return { status: "blocked", reasons: budget.reasons } as const;
      }
      if (budget.decision === "requires_approval") {
        const { approved, pending } = await runApproval(tx, taskId);
        if (!approved) {
          if (pending)
            return {
              status: "approval_required",
              approvalId: pending.id,
              reasons: budget.reasons,
            } as StartRunResult;
          const [approval] = await tx
            .insert(approvals)
            .values({
              companyId: plan.company.id,
              taskId,
              agentId: plan.agent.id,
              type: "custom",
              requestedAction: `Run "${plan.task!.title}" with ${plan.route.modelLabel} (est $${plan.route.estimatedCostUsd})`,
              explanation: budget.reasons.join("; "),
              riskLevel: "medium",
              proposedChange: {
                kind: "ai_run",
                taskId,
                provider: plan.route.provider,
                model: plan.route.model,
                estimateUsd: plan.route.estimatedCostUsd,
              },
              requiredPermissions: ["approval.decide"],
            })
            .returning({ id: approvals.id });
          await recordAuditEvent(tx, {
            ...audit,
            action: "ai.budget_approval_required",
            description: `AI run needs approval: ${budget.reasons.join("; ")}`,
            metadata: { approvalId: approval!.id },
          });
          return {
            status: "approval_required",
            approvalId: approval!.id,
            reasons: budget.reasons,
          } as StartRunResult;
        }
      }
      // Claim the task with a lease (renewed by the worker while the run is active).
      const held = await tx.execute<{ n: number }>(
        sql`select count(*)::int as n from tasks where claimed_by_agent_id = ${plan.agent.id} and lease_expires_at > now() and id <> ${taskId}`,
      );
      if ((held[0]?.n ?? 0) >= plan.agent.concurrencyLimit)
        throw new ConflictError(`${plan.agent.name} is at its concurrency limit`);
      const claimed = await tx
        .update(tasks)
        .set({
          claimedByAgentId: plan.agent.id,
          claimedAt: new Date(),
          leaseExpiresAt: new Date(Date.now() + LEASE_SECONDS * 1000),
        })
        .where(
          and(
            eq(tasks.id, taskId),
            or(
              isNull(tasks.claimedByAgentId),
              eq(tasks.claimedByAgentId, plan.agent.id),
              sql`${tasks.leaseExpiresAt} < now()`,
            ),
          ),
        )
        .returning({ id: tasks.id });
      if (!claimed.length) throw new ConflictError("The task is claimed by another agent");
      const runId = await insertRun(tx, plan, env, actor, {
        idempotencyKey: data.idempotencyKey,
        viewerMaxSensitivity: opts.viewerMaxSensitivity,
        maxRetries: Math.min(plan.agent.maxRetries, 1),
      });
      await appendRunEvent(tx, runId, "TASK_CLAIMED", `Lease ${LEASE_SECONDS}s`);
      return { status: "started", runId } as StartRunResult;
    })
    .catch(async (e: unknown) => {
      // Lost a race on the one-active-run index → return the winner.
      if ((e as { code?: string }).code === "23505") {
        const winner = await activeRunFor(db, { taskId });
        if (winner) return { status: "existing", runId: winner } as StartRunResult;
      }
      throw e;
    });
  if ("status" in result && result.status === "blocked")
    throw new ConflictError(`Budget blocked: ${result.reasons.join("; ")}`);
  return result as StartRunResult;
}

/** Human message → saved → agent run created (answered by the worker). */
export async function startChatRun(
  db: Database,
  env: ExecutionEnv,
  conversationId: string,
  content: string,
  actor: Actor,
  opts: {
    viewerMaxSensitivity: SensitivityLevel;
    idempotencyKey?: string | null;
    requestedProvider?: ProviderType | null;
  },
): Promise<{ runId: string; existing: boolean }> {
  if (opts.idempotencyKey) {
    const [existing] = await db
      .select({ id: agentRuns.id })
      .from(agentRuns)
      .where(eq(agentRuns.idempotencyKey, opts.idempotencyKey));
    if (existing) return { runId: existing.id, existing: true };
  }
  if (await activeRunFor(db, { conversationId }))
    throw new ConflictError("The agent is still answering the previous message");
  const plan = await planChatRun(db, env, conversationId, content, {
    viewerMaxSensitivity: opts.viewerMaxSensitivity,
    requestedProvider: opts.requestedProvider,
  });
  if (plan.problems.length) throw new ConflictError(plan.problems.join("; "));
  if (plan.route.blockedReason || !plan.route.provider)
    throw new ConflictError(plan.route.blockedReason ?? "No provider available");
  return db
    .transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`ai-budget:${plan.company.id}`}))`,
      );
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('ai-budget:global'))`);
      const budget = await budgetPreflight(tx, {
        company: plan.company,
        agent: plan.agent,
        task: null,
        provider: plan.route.provider!,
        estimateUsd: plan.route.estimatedCostUsd,
        billingMode: plan.route.billingMode,
        inputTokens: plan.route.estimatedInputTokens,
        subscription: env.subscriptionLimits,
      });
      if (budget.decision !== "allowed") {
        await recordAuditEvent(tx, {
          ...actorAuditFields(actor),
          companyId: plan.company.id,
          agentId: plan.agent.id,
          resourceType: "conversation",
          resourceId: conversationId,
          action: "ai.budget_blocked",
          description: `Chat reply blocked by budget: ${budget.reasons.join("; ")}`,
          outcome: "failure",
        });
        throw new ConflictError(
          `Budget ${budget.decision === "blocked" ? "blocked" : "needs approval"}: ${budget.reasons.join("; ")}`,
        );
      }
      const runId = await insertRun(tx, plan, env, actor, {
        idempotencyKey: opts.idempotencyKey,
        viewerMaxSensitivity: opts.viewerMaxSensitivity,
        maxRetries: Math.min(plan.agent.maxRetries, 1),
      });
      await tx.insert(conversationMessages).values({
        conversationId,
        role: "human",
        authorUserId: actor.userId ?? null,
        content,
        runId,
      });
      await tx
        .update(conversations)
        .set({ updatedAt: new Date() })
        .where(eq(conversations.id, conversationId));
      await recordAuditEvent(tx, {
        ...actorAuditFields(actor),
        companyId: plan.company.id,
        agentId: plan.agent.id,
        resourceType: "conversation",
        resourceId: conversationId,
        action: "chat.message_sent",
        description: `Message sent to ${plan.agent.name}`,
        metadata: { runId, chars: content.length },
      });
      return { runId, existing: false };
    })
    .catch((e: unknown) => {
      if ((e as { code?: string }).code === "23505")
        throw new ConflictError("The agent is still answering the previous message");
      throw e;
    });
}

/* ---------- second-opinion review requests ---------- */

export type RequestReviewResult = { status: "started" | "existing"; runId: string };

/** Existing review rows for a run, most recent first — for dedup and the review-history UI. */
export async function listRunReviews(db: Db, reviewedRunId: string) {
  return db
    .select({
      id: agentRunReviews.id,
      reviewerRunId: agentRunReviews.reviewerRunId,
      reviewerProvider: agentRunReviews.reviewerProvider,
      requestedByUserId: agentRunReviews.requestedByUserId,
      createdAt: agentRunReviews.createdAt,
      reviewerRunStatus: agentRuns.status,
      review: agentRuns.result,
    })
    .from(agentRunReviews)
    .innerJoin(agentRuns, eq(agentRuns.id, agentRunReviews.reviewerRunId))
    .where(eq(agentRunReviews.reviewedRunId, reviewedRunId))
    .orderBy(desc(agentRunReviews.createdAt));
}

/**
 * Requests an independent second opinion. Deduplicated: an in-flight review
 * for the same (run, reviewer provider) is always reused; a completed one is
 * reused unless `force`, so a manual rerun still creates a fresh review while
 * accidental double-clicks never burn subscription usage twice. Never
 * auto-triggers a further review (no recursive review chains).
 */
export async function requestSecondOpinion(
  db: Database,
  env: ExecutionEnv,
  reviewedRunId: string,
  reviewerProvider: ProviderType,
  actor: Actor,
  opts: { viewerMaxSensitivity: SensitivityLevel; force?: boolean },
): Promise<RequestReviewResult> {
  const plan = await planReviewRun(db, env, reviewedRunId, reviewerProvider, opts);
  if (plan.route.blockedReason || !plan.route.provider)
    throw new ConflictError(plan.route.blockedReason ?? "No provider available");

  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`ai-review:${reviewedRunId}:${reviewerProvider}`}))`,
    );
    const existing = await listRunReviews(tx, reviewedRunId);
    const priorForProvider = existing.find((r) => r.reviewerProvider === reviewerProvider);
    if (
      priorForProvider &&
      (ACTIVE_RUN_STATUSES.includes(priorForProvider.reviewerRunStatus) ||
        (priorForProvider.reviewerRunStatus === "completed" && !opts.force))
    )
      return { status: "existing", runId: priorForProvider.reviewerRunId };

    const policy = await companyProviderPolicy(tx, plan.company.id, env.registry);
    if (existing.length >= policy.maxReviewsPerTask)
      throw new ConflictError(
        `This run already has ${existing.length} review(s) — company policy allows ${policy.maxReviewsPerTask}`,
      );

    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`ai-budget:${plan.company.id}`}))`,
    );
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('ai-budget:global'))`);
    const budget = await budgetPreflight(tx, {
      company: plan.company,
      agent: plan.agent,
      task: plan.task,
      provider: reviewerProvider,
      estimateUsd: plan.route.estimatedCostUsd,
      billingMode: plan.route.billingMode,
      inputTokens: plan.route.estimatedInputTokens,
      subscription: env.subscriptionLimits,
    });
    if (budget.decision !== "allowed")
      throw new ConflictError(`Review blocked by budget: ${budget.reasons.join("; ")}`);

    const runId = await insertRun(tx, plan, env, actor, {
      viewerMaxSensitivity: opts.viewerMaxSensitivity,
      maxRetries: Math.min(plan.agent.maxRetries, 1),
    });
    await tx.insert(agentRunReviews).values({
      reviewedRunId,
      reviewerRunId: runId,
      reviewerProvider,
      requestedByUserId: actor.userId ?? null,
    });
    await recordAuditEvent(tx, {
      ...actorAuditFields(actor),
      companyId: plan.company.id,
      agentId: plan.agent.id,
      taskId: plan.task?.id,
      resourceType: "agent_run",
      resourceId: reviewedRunId,
      action: "agent_run.second_opinion_requested",
      description: `Second opinion requested from ${reviewerProvider} for run ${reviewedRunId}`,
      metadata: { reviewerRunId: runId, reviewerProvider },
    });
    return { status: "started", runId };
  });
}

/** Re-plans at execution time (fresh permissions/isolation) — used by the worker. */
export async function planForRun(db: Database, env: ExecutionEnv, runId: string): Promise<RunPlan> {
  const [run] = await db.select().from(agentRuns).where(eq(agentRuns.id, runId));
  if (!run) throw new NotFoundError("Run", runId);
  const viewerMaxSensitivity = asSensitivity(run.viewerMaxSensitivity);
  if (run.runPurpose === "second_opinion") {
    if (!run.reviewedRunId)
      throw new ConflictError("Second-opinion run is missing the run it reviews");
    const plan = await planReviewRun(db, env, run.reviewedRunId, run.provider, {
      viewerMaxSensitivity,
    });
    if (plan.company.id !== run.companyId)
      throw new ForbiddenError("Run company changed since the review was requested");
    return plan;
  }
  if (run.executionType === "task") {
    const plan = await planTaskRun(db, env, run.taskId!, {
      viewerMaxSensitivity,
      requestedTier: run.tier,
      responseDetail: run.responseDetail,
      // Pin the provider actually chosen at creation time (whether by explicit
      // person choice or by preference routing) — re-planning re-verifies it is
      // still allowed/available, but never silently reroutes to a different one.
      requestedProvider: run.provider,
    });
    if (plan.agent.id !== run.agentId || plan.company.id !== run.companyId)
      throw new ForbiddenError("Task assignment changed since the run was created");
    if (plan.problems.length) throw new ConflictError(plan.problems.join("; "));
    return plan;
  }
  const [human] = await db
    .select()
    .from(conversationMessages)
    .where(and(eq(conversationMessages.runId, runId), eq(conversationMessages.role, "human")));
  if (!human) throw new NotFoundError("Message", runId);
  const plan = await planChatRun(db, env, run.conversationId!, human.content, {
    viewerMaxSensitivity,
    excludeMessageId: human.id,
    requestedProvider: run.provider,
  });
  if (plan.company.id !== run.companyId) throw new ForbiddenError("Conversation company changed");
  if (plan.problems.length) throw new ConflictError(plan.problems.join("; "));
  return plan;
}

export { refreshAgentStates as refreshAgentStatesAfterRun };
