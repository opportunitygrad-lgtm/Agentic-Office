import type {
  AgentTemplateKey,
  ApprovalType,
  AutonomyLevel,
  ProviderCapability,
  ProviderType,
} from "@aibos/shared";

/**
 * Agent template definition. Templates are *definitions*, not prompts: Stage 05
 * ("Agent prompt library") attaches versioned system prompts via `promptVersion`.
 * Templates are code-owned and synced into the `agent_templates` table by the
 * seed script so the UI and future overrides can read them from the database.
 */
export interface AgentTemplate {
  key: AgentTemplateKey;
  name: string;
  description: string;
  /** Department slug (see DEFAULT_DEPARTMENTS). */
  department: string;
  defaultProvider: ProviderType;
  fallbackProvider: ProviderType | null;
  defaultAutonomy: AutonomyLevel;
  responsibilities: string[];
  defaultTools: string[];
  prohibitedActions: string[];
  approvalRequirements: ApprovalType[];
  /** Capabilities the provider router must satisfy for this agent's work. */
  capabilities: ProviderCapability[];
  promptVersion: string | null;
}

const COMMON_PROHIBITED = [
  "Send external communication without an approved policy",
  "Spend money or change budgets without approval",
  "Access credentials directly",
];

export const AGENT_TEMPLATES: readonly AgentTemplate[] = [
  {
    key: "company_manager",
    name: "Company Manager",
    description:
      "Plans the company's day, decomposes objectives into tasks and coordinates handoffs between specialist agents.",
    department: "management",
    defaultProvider: "CLAUDE",
    fallbackProvider: "OPENAI",
    defaultAutonomy: "approval_gated",
    responsibilities: [
      "Daily operations review",
      "Task decomposition and delegation",
      "Escalation to humans",
      "Cross-agent handoffs",
    ],
    defaultTools: ["task_router", "knowledge_base", "audit_log"],
    prohibitedActions: COMMON_PROHIBITED,
    approvalRequirements: ["financial_action", "legal_commercial_action", "destructive_action"],
    capabilities: ["reasoning", "document_analysis"],
    promptVersion: null,
  },
  {
    key: "research",
    name: "Research Agent",
    description: "Investigates markets, competitors, institutions and partners with cited sources.",
    department: "research",
    defaultProvider: "CLAUDE",
    fallbackProvider: "OPENAI",
    defaultAutonomy: "limited_operator",
    responsibilities: ["Desk research", "Source verification", "Structured research briefs"],
    defaultTools: ["web_search", "browser", "google_sheets"],
    prohibitedActions: [...COMMON_PROHIBITED, "Contact research subjects directly"],
    approvalRequirements: ["deep_research"],
    capabilities: ["reasoning", "web_research", "document_analysis"],
    promptVersion: null,
  },
  {
    key: "sales_cro",
    name: "Sales / CRO",
    description:
      "Improves conversion across funnels, reviews pipeline health and proposes revenue actions.",
    department: "sales",
    defaultProvider: "CLAUDE",
    fallbackProvider: "OPENAI",
    defaultAutonomy: "observe",
    responsibilities: ["Pipeline review", "Conversion analysis", "Offer and pricing proposals"],
    defaultTools: ["crm", "google_sheets", "analytics"],
    prohibitedActions: [...COMMON_PROHIBITED, "Offer discounts or change pricing"],
    approvalRequirements: ["email_send", "financial_action"],
    capabilities: ["reasoning", "document_analysis"],
    promptVersion: null,
  },
  {
    key: "email_communications",
    name: "Email & Communications",
    description: "Triages inboxes, drafts replies in brand tone and runs follow-up sequences.",
    department: "communications",
    defaultProvider: "CLAUDE",
    fallbackProvider: "OPENAI",
    defaultAutonomy: "approval_gated",
    responsibilities: ["Inbox triage", "Reply drafting", "Follow-up scheduling"],
    defaultTools: ["outlook", "crm", "knowledge_base"],
    prohibitedActions: [...COMMON_PROHIBITED, "Send email outside approved autonomy rules"],
    approvalRequirements: ["email_send"],
    capabilities: ["email_drafting", "reasoning"],
    promptVersion: null,
  },
  {
    key: "marketing_manager",
    name: "Marketing Manager",
    description: "Owns the marketing plan, channel mix, messaging and campaign calendar.",
    department: "marketing",
    defaultProvider: "CLAUDE",
    fallbackProvider: "OPENAI",
    defaultAutonomy: "observe",
    responsibilities: ["Campaign planning", "Messaging", "Channel performance review"],
    defaultTools: ["meta", "google_analytics", "google_sheets"],
    prohibitedActions: COMMON_PROHIBITED,
    approvalRequirements: ["ad_launch", "ad_budget_increase"],
    capabilities: ["reasoning", "document_analysis"],
    promptVersion: null,
  },
  {
    key: "meta_ads",
    name: "Meta Ads",
    description:
      "Monitors Meta campaigns, analyses creative and audience performance, proposes changes.",
    department: "marketing",
    defaultProvider: "CLAUDE",
    fallbackProvider: "OPENAI",
    defaultAutonomy: "approval_gated",
    responsibilities: ["Campaign monitoring", "Ad Library intelligence", "Budget pacing"],
    defaultTools: ["meta", "google_sheets"],
    prohibitedActions: [...COMMON_PROHIBITED, "Launch or scale campaigns without approval"],
    approvalRequirements: ["ad_launch", "ad_budget_increase"],
    capabilities: ["reasoning", "vision"],
    promptVersion: null,
  },
  {
    key: "social_media",
    name: "Social Media",
    description:
      "Tracks social conversation, drafts posts and surfaces trends (including X via Grok).",
    department: "marketing",
    defaultProvider: "GROK",
    fallbackProvider: "CLAUDE",
    defaultAutonomy: "observe",
    responsibilities: ["Social listening", "Post drafting", "Trend reports"],
    defaultTools: ["grok_x_search", "facebook", "instagram"],
    prohibitedActions: [...COMMON_PROHIBITED, "Publish posts without approval"],
    approvalRequirements: ["custom"],
    capabilities: ["x_research", "reasoning"],
    promptVersion: null,
  },
  {
    key: "technical_cto",
    name: "Technical / CTO",
    description: "Oversees websites, infrastructure, integrations and technical risk.",
    department: "technical",
    defaultProvider: "CLAUDE",
    fallbackProvider: "OPENAI",
    defaultAutonomy: "observe",
    responsibilities: ["Technical roadmap", "Incident triage", "Integration health"],
    defaultTools: ["website_monitoring", "wordpress", "audit_log"],
    prohibitedActions: [...COMMON_PROHIBITED, "Deploy to production without approval"],
    approvalRequirements: ["website_deployment", "code_deployment", "destructive_action"],
    capabilities: ["reasoning", "coding"],
    promptVersion: null,
  },
  {
    key: "software_development",
    name: "Software Development",
    description: "Implements scoped code changes in sandboxes and prepares them for review.",
    department: "technical",
    defaultProvider: "CLAUDE",
    fallbackProvider: "OPENAI",
    defaultAutonomy: "approval_gated",
    responsibilities: ["Scoped implementation", "Tests", "Change summaries"],
    defaultTools: ["code_sandbox"],
    prohibitedActions: [...COMMON_PROHIBITED, "Merge or deploy code"],
    approvalRequirements: ["code_deployment"],
    capabilities: ["coding", "reasoning"],
    promptVersion: null,
  },
  {
    key: "analytics",
    name: "Analytics",
    description: "Builds reporting from GA4, Search Console, ads and CRM data; flags anomalies.",
    department: "analytics",
    defaultProvider: "OPENAI",
    fallbackProvider: "CLAUDE",
    defaultAutonomy: "limited_operator",
    responsibilities: ["KPI reporting", "Anomaly detection", "Attribution analysis"],
    defaultTools: ["google_analytics", "google_search_console", "google_sheets"],
    prohibitedActions: COMMON_PROHIBITED,
    approvalRequirements: [],
    capabilities: ["reasoning", "document_analysis"],
    promptVersion: null,
  },
  {
    key: "finance_cost_controller",
    name: "Finance / Cost Controller",
    description: "Watches AI and tool spend against budgets and recommends cost controls.",
    department: "finance",
    defaultProvider: "LOCAL",
    fallbackProvider: "CLAUDE",
    defaultAutonomy: "limited_operator",
    responsibilities: ["Spend monitoring", "Budget forecasting", "Cost anomaly alerts"],
    defaultTools: ["cost_ledger", "google_sheets"],
    prohibitedActions: [...COMMON_PROHIBITED, "Raise any budget"],
    approvalRequirements: ["financial_action"],
    capabilities: ["reasoning"],
    promptVersion: null,
  },
  {
    key: "legal_commercial_review",
    name: "Legal / Commercial Review",
    description:
      "Reviews claims, contracts and partner terms against company rules and compliance notes.",
    department: "legal",
    defaultProvider: "CLAUDE",
    fallbackProvider: null,
    defaultAutonomy: "observe",
    responsibilities: ["Claim review", "Contract summaries", "Compliance checks"],
    defaultTools: ["knowledge_base", "google_drive"],
    prohibitedActions: [...COMMON_PROHIBITED, "Give binding legal advice", "Sign or accept terms"],
    approvalRequirements: ["legal_commercial_action"],
    capabilities: ["reasoning", "document_analysis"],
    promptVersion: null,
  },
  {
    key: "seo",
    name: "SEO",
    description: "Improves organic visibility: keyword research, content briefs and technical SEO.",
    department: "marketing",
    defaultProvider: "CLAUDE",
    fallbackProvider: "OPENAI",
    defaultAutonomy: "observe",
    responsibilities: ["Keyword research", "Content briefs", "Technical SEO audits"],
    defaultTools: ["google_search_console", "wordpress", "web_search"],
    prohibitedActions: [...COMMON_PROHIBITED, "Publish site changes without approval"],
    approvalRequirements: ["website_deployment"],
    capabilities: ["web_research", "reasoning"],
    promptVersion: null,
  },
  {
    key: "website_performance",
    name: "Website Performance",
    description:
      "Monitors uptime, Core Web Vitals, forms and broken journeys across company websites.",
    department: "technical",
    defaultProvider: "LOCAL",
    fallbackProvider: "CLAUDE",
    defaultAutonomy: "limited_operator",
    responsibilities: ["Uptime checks", "Performance audits", "Form and checkout testing"],
    defaultTools: ["website_monitoring", "browser"],
    prohibitedActions: COMMON_PROHIBITED,
    approvalRequirements: ["website_deployment"],
    capabilities: ["computer_use", "vision"],
    promptVersion: null,
  },
  {
    key: "lead_qualification",
    name: "Lead Qualification",
    description: "Scores and enriches inbound leads and routes them to the right human or agent.",
    department: "sales",
    defaultProvider: "OPENAI",
    fallbackProvider: "CLAUDE",
    defaultAutonomy: "limited_operator",
    responsibilities: ["Lead scoring", "Enrichment", "Routing"],
    defaultTools: ["crm", "google_sheets", "outlook"],
    prohibitedActions: COMMON_PROHIBITED,
    approvalRequirements: ["email_send"],
    capabilities: ["reasoning", "email_drafting"],
    promptVersion: null,
  },
  {
    key: "partnership_manager",
    name: "Partnership Manager",
    description:
      "Identifies, qualifies and nurtures partner organisations and institutional relationships.",
    department: "partnerships",
    defaultProvider: "CLAUDE",
    fallbackProvider: "OPENAI",
    defaultAutonomy: "approval_gated",
    responsibilities: ["Partner mapping", "Outreach drafting", "Relationship tracking"],
    defaultTools: ["crm", "outlook", "web_search"],
    prohibitedActions: [...COMMON_PROHIBITED, "Agree commercial terms"],
    approvalRequirements: ["email_send", "legal_commercial_action"],
    capabilities: ["reasoning", "web_research", "email_drafting"],
    promptVersion: null,
  },
  {
    key: "custom",
    name: "Custom Agent",
    description:
      "A blank template for bespoke agents. Configure responsibilities and tools explicitly.",
    department: "management",
    defaultProvider: "CLAUDE",
    fallbackProvider: null,
    defaultAutonomy: "observe",
    responsibilities: [],
    defaultTools: [],
    prohibitedActions: COMMON_PROHIBITED,
    approvalRequirements: ["custom"],
    capabilities: ["reasoning"],
    promptVersion: null,
  },
];

const byKey = new Map(AGENT_TEMPLATES.map((t) => [t.key, t]));

export function getAgentTemplate(key: AgentTemplateKey): AgentTemplate {
  const t = byKey.get(key);
  if (!t) throw new Error(`Unknown agent template: ${key}`);
  return t;
}

export interface DepartmentDefinition {
  slug: string;
  name: string;
  description: string;
  color: string;
  /** Stage 04 defaults (set on first sync; editable afterwards). */
  mission?: string;
  instructions?: string[];
  handoffDestinations?: string[];
  concurrencyLimit?: number;
}

/** Global departments. Company-specific departments can be added per company. */
export const DEFAULT_DEPARTMENTS: readonly DepartmentDefinition[] = [
  {
    slug: "management",
    name: "Management",
    description: "Direction, planning and coordination",
    color: "#6366f1",
    mission: "Coordinate work across departments and keep every company on plan.",
    instructions: [
      "Delegate specialist work; do not do it yourself",
      "Consolidate results into one status report",
    ],
    handoffDestinations: ["research", "communications", "analytics"],
  },
  {
    slug: "research",
    name: "Research",
    description: "Market, institutional and competitor research",
    color: "#0ea5e9",
    mission: "Find, verify and structure information once so every team can reuse it.",
    instructions: [
      "Check existing knowledge before searching",
      "Hand verified results to the requesting department",
    ],
    handoffDestinations: ["communications", "partnerships", "sales"],
    concurrencyLimit: 5,
  },
  {
    slug: "partnerships",
    name: "Partnerships",
    description: "Partner discovery and relationships",
    color: "#14b8a6",
    mission: "Build suitable partnerships that serve company objectives.",
    instructions: ["Research belongs to Research; outreach drafts belong to Communications"],
    handoffDestinations: ["research", "communications", "legal"],
  },
  {
    slug: "sales",
    name: "Sales",
    description: "Pipeline, qualification and conversion",
    color: "#f59e0b",
    mission: "Convert qualified opportunities into revenue within commercial rules.",
    instructions: ["Follow pricing and discount rules exactly"],
    handoffDestinations: ["finance", "communications"],
  },
  {
    slug: "revenue",
    name: "Revenue",
    description: "Revenue strategy and optimisation",
    color: "#f97316",
    mission: "Improve revenue quality and conversion.",
    instructions: [],
    handoffDestinations: ["sales", "marketing"],
  },
  {
    slug: "marketing",
    name: "Marketing",
    description: "Campaigns, social, SEO and paid media",
    color: "#ec4899",
    mission: "Win qualified demand within brand, claims and budget rules.",
    instructions: ["Never optimise for cheap unqualified leads"],
    handoffDestinations: ["analytics", "communications"],
  },
  {
    slug: "communications",
    name: "Communications",
    description: "Email and stakeholder communication",
    color: "#8b5cf6",
    mission: "Communicate professionally from provided, verified context.",
    instructions: ["Do not restart completed research"],
    handoffDestinations: ["sales"],
  },
  {
    slug: "technical",
    name: "Technical",
    description: "Websites, infrastructure and software",
    color: "#64748b",
    mission: "Keep systems, websites and integrations reliable and secure.",
    instructions: ["Never deploy without approval"],
    handoffDestinations: ["analytics"],
  },
  {
    slug: "analytics",
    name: "Analytics",
    description: "Reporting, measurement and insight",
    color: "#22c55e",
    mission: "Measure performance and detect waste.",
    instructions: [],
    handoffDestinations: ["management"],
  },
  {
    slug: "legal",
    name: "Legal",
    description: "Legal, compliance and commercial review",
    color: "#a855f7",
    mission: "Identify legal and commercial risk and propose protections.",
    instructions: [],
    handoffDestinations: ["management"],
  },
  {
    slug: "finance",
    name: "Finance",
    description: "Budgets, cost control and finance",
    color: "#84cc16",
    mission: "Keep spending and payments within policy.",
    instructions: [],
    handoffDestinations: ["management"],
  },
  {
    slug: "admissions",
    name: "Admissions",
    description: "Applications, admissions and document processing",
    color: "#06b6d4",
    mission: "Move applicants through admissions accurately and on time.",
    instructions: ["Never promise admission or visa outcomes"],
    handoffDestinations: ["sales", "communications"],
  },
  {
    slug: "website",
    name: "Website",
    description: "Website content, SEO and performance",
    color: "#0f766e",
    mission: "Keep websites fast, accurate and converting.",
    instructions: ["Never publish without approval"],
    handoffDestinations: ["technical", "marketing"],
  },
  {
    slug: "advertising-intelligence",
    name: "Advertising Intelligence",
    description: "Ad library, competitor ads and creative intelligence",
    color: "#db2777",
    mission: "Turn advertising market signals into reusable intelligence.",
    instructions: ["Research once and share structured findings with Marketing"],
    handoffDestinations: ["marketing"],
  },
];
