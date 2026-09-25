/**
 * Stage 04 vocabularies: agent capabilities, the instruction stack,
 * delegation, handoffs, agent messaging and conversations.
 */

/* ---------- capabilities (what an agent is GOOD AT — not what it may do) ---------- */

export const AGENT_CAPABILITIES = [
  "management.coordinate",
  "research.general",
  "research.web",
  "research.social",
  "research.market",
  "email.draft",
  "email.reply",
  "sales.qualify",
  "sales.followup",
  "marketing.strategy",
  "meta.analyse",
  "meta.execute",
  "social.content",
  "seo.optimise",
  "website.analyse",
  "website.edit",
  "technical.architecture",
  "code.write",
  "legal.review",
  "finance.review",
  "data.classify",
  "data.update",
  "analytics.calculate",
  "browser.operate",
  "partnership.manage",
  "admissions.process",
] as const;
export type AgentCapability = (typeof AGENT_CAPABILITIES)[number];

export const CAPABILITY_LABELS: Record<AgentCapability, string> = {
  "management.coordinate": "Coordinate & delegate",
  "research.general": "General research",
  "research.web": "Web research",
  "research.social": "Social research",
  "research.market": "Market research",
  "email.draft": "Draft email",
  "email.reply": "Reply to email",
  "sales.qualify": "Qualify leads",
  "sales.followup": "Sales follow-up",
  "marketing.strategy": "Marketing strategy",
  "meta.analyse": "Analyse Meta ads",
  "meta.execute": "Execute Meta changes",
  "social.content": "Social content",
  "seo.optimise": "SEO",
  "website.analyse": "Analyse websites",
  "website.edit": "Edit websites",
  "technical.architecture": "Technical architecture",
  "code.write": "Write code",
  "legal.review": "Legal review",
  "finance.review": "Finance review",
  "data.classify": "Classify data",
  "data.update": "Update data",
  "analytics.calculate": "Analytics",
  "browser.operate": "Operate a browser",
  "partnership.manage": "Manage partnerships",
  "admissions.process": "Process admissions",
};

/**
 * Agent tool/action permissions a capability needs when actually exercised.
 * Capabilities never grant anything: the permission engine stays authoritative.
 */
export const CAPABILITY_PERMISSIONS: Partial<Record<AgentCapability, string[]>> = {
  "research.web": ["tool.web.search"],
  "research.social": ["tool.web.search"],
  "research.market": ["tool.web.search"],
  "email.draft": ["tool.email.draft"],
  "email.reply": ["tool.email.read", "tool.email.draft"],
  "meta.analyse": ["tool.meta.read"],
  "meta.execute": ["tool.meta.write"],
  "website.analyse": ["tool.wordpress.read"],
  "website.edit": ["tool.wordpress.write"],
  "code.write": ["tool.files.write"],
  "data.classify": ["tool.google_sheets.read"],
  "data.update": ["tool.google_sheets.write"],
  "browser.operate": ["tool.browser.use"],
};

/* ---------- instruction stack ---------- */

/** Highest priority first. Lower layers can add, never override. */
export const INSTRUCTION_LAYERS = [
  "platform",
  "global",
  "company",
  "department",
  "template",
  "agent",
  "task",
  "task_note",
] as const;
export type InstructionLayerKey = (typeof INSTRUCTION_LAYERS)[number];

export const INSTRUCTION_LAYER_LABELS: Record<InstructionLayerKey, string> = {
  platform: "Platform safety",
  global: "Global operating policy",
  company: "Company rules & AI policy",
  department: "Department rules",
  template: "Role template",
  agent: "Agent-specific role",
  task: "Task instructions",
  task_note: "Temporary task notes",
};

/* ---------- delegation ---------- */

export const DELEGATION_OUTCOMES = [
  "handle_self",
  "delegate_to_agent",
  "delegate_to_team",
  "create_temporary_worker",
  "require_human_review",
  "blocked",
] as const;
export type DelegationOutcome = (typeof DELEGATION_OUTCOMES)[number];

export const DELEGATION_OUTCOME_LABELS: Record<DelegationOutcome, string> = {
  handle_self: "Handle self",
  delegate_to_agent: "Delegate to agent",
  delegate_to_team: "Delegate to team",
  create_temporary_worker: "Create temporary worker",
  require_human_review: "Human review required",
  blocked: "Blocked",
};

export const BUDGET_DECISIONS = ["allowed", "requires_approval", "blocked"] as const;
export type BudgetDecision = (typeof BUDGET_DECISIONS)[number];

export const DUPLICATE_LEVELS = [
  "exact_duplicate",
  "likely_duplicate",
  "related_existing_task",
  "no_duplicate",
] as const;
export type DuplicateLevel = (typeof DUPLICATE_LEVELS)[number];

/* ---------- handoffs, messages, conversations ---------- */

export const HANDOFF_STATUSES = [
  "pending",
  "accepted",
  "rejected",
  "completed",
  "cancelled",
] as const;
export type HandoffStatus = (typeof HANDOFF_STATUSES)[number];

export const HANDOFF_TYPES = [
  "research_result",
  "work_transfer",
  "review_request",
  "escalation",
  "information",
] as const;
export type HandoffType = (typeof HANDOFF_TYPES)[number];

export const AGENT_MESSAGE_TYPES = [
  "task_instruction",
  "handoff",
  "status",
  "question",
  "escalation",
  "approval_notice",
  "system",
] as const;
export type AgentMessageType = (typeof AGENT_MESSAGE_TYPES)[number];

export const CONVERSATION_STATUSES = ["open", "closed"] as const;
export type ConversationStatus = (typeof CONVERSATION_STATUSES)[number];

/** Agent states that count as "active" for concurrency. */
export const ACTIVE_AGENT_STATES = ["working", "waiting", "needs_approval", "blocked"] as const;
/** States set by people or lifecycle, never overwritten by work-derived state. */
export const MANUAL_AGENT_STATES = [
  "paused",
  "offline",
  "failed",
  "expired",
  "terminated",
] as const;
