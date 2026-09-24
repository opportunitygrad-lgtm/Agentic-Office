/**
 * ─────────────────────────────────────────────────────────────────────────
 *  DEVELOPMENT SEED DATA ONLY
 *  Every row created from this file is stored with origin = 'dev_seed' and is
 *  deleted/recreated by `pnpm db:seed`. None of it represents real activity.
 * ─────────────────────────────────────────────────────────────────────────
 */
import type {
  AgentStatus,
  AgentTemplateKey,
  ApprovalType,
  CreateCompanyInput,
  ProviderType,
  RiskLevel,
  TaskPriority,
  TaskStatus,
  TaskType,
} from "@aibos/shared";

export const SEED_COMPANIES: (CreateCompanyInput & { slug: string })[] = [
  {
    name: "Euro Pilot Training",
    slug: "euro-pilot-training",
    legalName: "Euro Pilot Training Ltd",
    industry: "Aviation training",
    website: "https://europilottraining.com",
    accentColor: "#2563eb",
    primaryCountry: "IE",
    countriesServed: ["IE", "GB", "ES", "PT", "PL", "DE", "FR"],
    timezone: "Europe/Dublin",
    defaultCurrency: "EUR",
    productsServices: [
      "Integrated ATPL placement",
      "Modular pilot training guidance",
      "Flight school matching",
    ],
    targetAudiences: ["Aspiring airline pilots", "Career changers", "Parents of student pilots"],
    targetMarkets: ["Ireland", "United Kingdom", "EU"],
    primaryObjective: "Become the trusted route into EASA pilot training across Europe",
    revenueObjective: "Grow qualified student placements quarter on quarter",
    description: "Helps aspiring pilots choose and enrol with approved European flight schools.",
    brandPositioning: "Independent, expert guidance for serious pilot candidates",
    brandTone: "Professional, precise, encouraging",
    companyRules: [
      "Only reference EASA-approved training organisations",
      "Never guarantee airline employment",
    ],
    prohibitedClaims: ["Guaranteed airline job", "Cheapest training in Europe"],
    competitorNotes: "Monitor large integrated academies and comparison sites.",
    complianceNotes: "Advertising must follow consumer protection rules on training outcomes.",
    defaultProvider: "CLAUDE",
    dailyAiBudget: 25,
    monthlyAiBudget: 500,
    concurrencyLimit: 4,
  },
  {
    name: "PilotsAssist",
    slug: "pilotsassist",
    legalName: "PilotsAssist Ltd",
    industry: "Aviation services",
    website: "https://pilotsassist.com",
    accentColor: "#0d9488",
    primaryCountry: "GB",
    countriesServed: ["GB", "IE", "AE"],
    timezone: "Europe/London",
    defaultCurrency: "GBP",
    productsServices: [
      "Pilot career support",
      "Type rating guidance",
      "Training partner referrals",
    ],
    targetAudiences: ["Licensed pilots", "Low-hours commercial pilots"],
    targetMarkets: ["United Kingdom", "Middle East"],
    primaryObjective: "Support licensed pilots from licence to first airline job",
    revenueObjective: "Increase partner referral revenue",
    description: "Career and training support platform for licensed pilots.",
    brandPositioning: "The pilot's practical career partner",
    brandTone: "Supportive, knowledgeable, direct",
    companyRules: ["Disclose referral relationships"],
    prohibitedClaims: ["Guaranteed type rating funding"],
    defaultProvider: "CLAUDE",
    dailyAiBudget: 10,
    monthlyAiBudget: 200,
    concurrencyLimit: 2,
  },
  {
    name: "Opportunitygrad",
    slug: "opportunitygrad",
    legalName: "Opportunitygrad Ltd",
    industry: "International education",
    website: "https://opportunitygrad.com",
    accentColor: "#7c3aed",
    primaryCountry: "GB",
    countriesServed: ["GB", "IE", "IN", "NG", "PK"],
    timezone: "Europe/London",
    defaultCurrency: "GBP",
    productsServices: [
      "University admissions counselling",
      "Scholarship guidance",
      "Application support",
    ],
    targetAudiences: ["International students", "Postgraduate applicants"],
    targetMarkets: ["India", "Nigeria", "Pakistan"],
    primaryObjective:
      "Place international students on the right UK and Irish university programmes",
    revenueObjective: "Grow autumn intake enrolments",
    description: "International student recruitment and admissions counselling.",
    brandPositioning: "Honest, personal admissions guidance",
    brandTone: "Warm, clear, trustworthy",
    companyRules: ["Never promise admission or visa outcomes"],
    prohibitedClaims: ["Guaranteed admission", "Guaranteed visa"],
    complianceNotes: "Follow agent quality framework and university partner guidelines.",
    defaultProvider: "CLAUDE",
    dailyAiBudget: 20,
    monthlyAiBudget: 400,
    concurrencyLimit: 3,
  },
];

export interface SeedAgent {
  key: string;
  name: string;
  template: AgentTemplateKey;
  department: string;
  status: AgentStatus;
  /** null = global scope. */
  company: string | null;
  /** Extra company assignments (multi-company agents). */
  alsoServes?: string[];
  provider?: ProviderType;
  reportsTo?: string;
}

const EPT = "euro-pilot-training";
const PA = "pilotsassist";
const OG = "opportunitygrad";
const ALL = [EPT, PA, OG];

export const SEED_AGENTS: SeedAgent[] = [
  // GLOBAL
  {
    key: "group-manager",
    name: "Group Manager",
    template: "company_manager",
    department: "management",
    status: "working",
    company: null,
    alsoServes: ALL,
    provider: "CLAUDE",
  },
  {
    key: "revenue-cro",
    name: "Revenue / CRO",
    template: "sales_cro",
    department: "revenue",
    status: "sleeping",
    company: null,
    reportsTo: "group-manager",
  },
  {
    key: "email-comms",
    name: "Email & Communications",
    template: "email_communications",
    department: "communications",
    status: "working",
    company: null,
    alsoServes: ALL,
    reportsTo: "group-manager",
  },
  {
    key: "technical-cto",
    name: "Technical / CTO",
    template: "technical_cto",
    department: "technical",
    status: "sleeping",
    company: null,
    reportsTo: "group-manager",
  },
  {
    key: "analytics-cost",
    name: "Analytics / Cost Controller",
    template: "finance_cost_controller",
    department: "analytics",
    status: "sleeping",
    company: null,
    reportsTo: "group-manager",
  },
  // EURO PILOT TRAINING
  {
    key: "ept-research",
    name: "EPT Flight School Research",
    template: "research",
    department: "research",
    status: "working",
    company: EPT,
    reportsTo: "group-manager",
  },
  {
    key: "ept-partnerships",
    name: "EPT Partnerships",
    template: "partnership_manager",
    department: "partnerships",
    status: "sleeping",
    company: EPT,
    reportsTo: "group-manager",
  },
  {
    key: "ept-marketing",
    name: "EPT Marketing",
    template: "marketing_manager",
    department: "marketing",
    status: "sleeping",
    company: EPT,
    reportsTo: "group-manager",
  },
  {
    key: "ept-sales",
    name: "EPT Sales / CRO",
    template: "sales_cro",
    department: "sales",
    status: "sleeping",
    company: EPT,
    reportsTo: "group-manager",
  },
  {
    key: "ept-grok",
    name: "EPT Grok Social Intelligence",
    template: "social_media",
    department: "marketing",
    status: "sleeping",
    company: EPT,
    provider: "GROK",
    reportsTo: "ept-marketing",
  },
  // PILOTSASSIST
  {
    key: "pa-research",
    name: "PilotsAssist Aviation Research",
    template: "research",
    department: "research",
    status: "sleeping",
    company: PA,
    reportsTo: "group-manager",
  },
  {
    key: "pa-partnerships",
    name: "PilotsAssist Training Partnerships",
    template: "partnership_manager",
    department: "partnerships",
    status: "sleeping",
    company: PA,
    reportsTo: "group-manager",
  },
  {
    key: "pa-marketing",
    name: "PilotsAssist Marketing",
    template: "marketing_manager",
    department: "marketing",
    status: "sleeping",
    company: PA,
    reportsTo: "group-manager",
  },
  {
    key: "pa-web-seo",
    name: "PilotsAssist Website / SEO",
    template: "seo",
    department: "marketing",
    status: "sleeping",
    company: PA,
    reportsTo: "pa-marketing",
  },
  // OPPORTUNITYGRAD
  {
    key: "og-research",
    name: "Opportunitygrad University Research",
    template: "research",
    department: "research",
    status: "sleeping",
    company: OG,
    reportsTo: "group-manager",
  },
  {
    key: "og-marketing-meta",
    name: "Opportunitygrad Marketing / Meta",
    template: "meta_ads",
    department: "marketing",
    status: "working",
    company: OG,
    reportsTo: "group-manager",
  },
  {
    key: "og-sales",
    name: "Opportunitygrad Sales / Counselling",
    template: "sales_cro",
    department: "sales",
    status: "sleeping",
    company: OG,
    reportsTo: "group-manager",
  },
  {
    key: "og-admissions",
    name: "Opportunitygrad Admissions",
    template: "custom",
    department: "sales",
    status: "sleeping",
    company: OG,
    reportsTo: "og-sales",
  },
];

export interface SeedTask {
  key: string;
  company: string | null;
  title: string;
  description?: string;
  type: TaskType;
  priority: TaskPriority;
  status: TaskStatus;
  agent: string | null;
  parent?: string;
  progress: number;
  currentAction?: string;
  currentTool?: string;
  requiresApproval?: boolean;
  estimatedCost?: number;
  actualCost?: number;
  startedMinutesAgo?: number;
  completedMinutesAgo?: number;
  dueInHours?: number;
  error?: string;
  resultSummary?: string;
}

export const SEED_TASKS: SeedTask[] = [
  {
    key: "daily-ops",
    company: null,
    title: "Review today's operations",
    description: "Morning review of all companies: open tasks, approvals, spend and blockers.",
    type: "management",
    priority: "high",
    status: "running",
    agent: "group-manager",
    progress: 64,
    currentAction: "Reviewing today's operations",
    currentTool: "task_router",
    startedMinutesAgo: 38,
    estimatedCost: 0.9,
    actualCost: 0.52,
  },
  // EPT hierarchy: Manager → Research → Verification → Email
  {
    key: "ept-shortlist",
    company: EPT,
    title: "Build EASA flight school partner shortlist",
    description: "Produce a verified shortlist of European ATOs suitable for partnership outreach.",
    type: "management",
    priority: "high",
    status: "running",
    agent: "group-manager",
    progress: 48,
    currentAction: "Coordinating research and verification",
    currentTool: "task_router",
    startedMinutesAgo: 240,
    dueInHours: 52,
    estimatedCost: 6.5,
    actualCost: 2.1,
  },
  {
    key: "ept-research",
    company: EPT,
    parent: "ept-shortlist",
    title: "Research European EASA flight schools",
    type: "research",
    priority: "high",
    status: "running",
    agent: "ept-research",
    progress: 72,
    currentAction: "Extracting fleet and course data from ATO websites",
    currentTool: "browser",
    startedMinutesAgo: 190,
    estimatedCost: 3.8,
    actualCost: 1.74,
  },
  {
    key: "ept-verify",
    company: EPT,
    parent: "ept-research",
    title: "Verify ATO approvals against EASA register",
    type: "verification",
    priority: "normal",
    status: "queued",
    agent: "ept-research",
    progress: 0,
    estimatedCost: 0.8,
  },
  {
    key: "ept-email",
    company: EPT,
    parent: "ept-verify",
    title: "Draft partnership introduction emails",
    type: "email",
    priority: "normal",
    status: "queued",
    agent: "email-comms",
    progress: 0,
    estimatedCost: 0.6,
  },
  {
    key: "ept-review-email",
    company: EPT,
    title: "Review partnership email",
    description: "Partnership introduction for 12 shortlisted schools awaiting human approval.",
    type: "review",
    priority: "high",
    status: "needs_approval",
    agent: "email-comms",
    progress: 90,
    currentAction: "Awaiting approval to send",
    currentTool: "outlook",
    requiresApproval: true,
    startedMinutesAgo: 70,
    estimatedCost: 0.4,
    actualCost: 0.31,
  },
  // Opportunitygrad
  {
    key: "og-meta-review",
    company: OG,
    title: "Review Meta campaign performance",
    description:
      "Weekly review of autumn intake campaigns: CPL, lead quality and creative fatigue.",
    type: "advertising",
    priority: "high",
    status: "running",
    agent: "og-marketing-meta",
    progress: 45,
    currentAction: "Comparing cost per lead across ad sets",
    currentTool: "meta",
    startedMinutesAgo: 55,
    estimatedCost: 1.6,
    actualCost: 0.66,
  },
  {
    key: "og-lead-sync",
    company: OG,
    title: "Sync counselling leads to Google Sheet",
    type: "sales",
    priority: "normal",
    status: "failed",
    agent: "og-sales",
    progress: 10,
    error: "Google Sheets integration not configured (arrives in Stage 12)",
    startedMinutesAgo: 120,
    estimatedCost: 0.1,
    actualCost: 0.01,
  },
  // PilotsAssist
  {
    key: "pa-mobile-audit",
    company: PA,
    title: "Website mobile performance audit",
    description: "Audit Core Web Vitals on mobile for key landing pages.",
    type: "website",
    priority: "normal",
    status: "waiting",
    agent: "pa-web-seo",
    progress: 30,
    currentAction: "Waiting for PageSpeed run to finish",
    currentTool: "website_monitoring",
    startedMinutesAgo: 95,
    estimatedCost: 0.5,
    actualCost: 0.12,
  },
  // Global email
  {
    key: "email-reply",
    company: EPT,
    title: "Prepare reply to integrated ATPL enquiry",
    type: "email",
    priority: "normal",
    status: "running",
    agent: "email-comms",
    progress: 58,
    currentAction: "Preparing reply",
    currentTool: "outlook",
    startedMinutesAgo: 12,
    estimatedCost: 0.2,
    actualCost: 0.08,
  },
  // History
  {
    key: "cost-report",
    company: null,
    title: "Weekly AI cost report",
    type: "analysis",
    priority: "low",
    status: "completed",
    agent: "analytics-cost",
    progress: 100,
    startedMinutesAgo: 1500,
    completedMinutesAgo: 1470,
    resultSummary: "Spend 12% under plan; Claude 71% of total.",
    estimatedCost: 0.3,
    actualCost: 0.22,
  },
  {
    key: "og-uni-research",
    company: OG,
    title: "Shortlist UK universities with January intake",
    type: "research",
    priority: "normal",
    status: "completed",
    agent: "og-research",
    progress: 100,
    startedMinutesAgo: 2900,
    completedMinutesAgo: 2700,
    resultSummary: "27 programmes across 14 universities shortlisted.",
    estimatedCost: 2.4,
    actualCost: 2.05,
  },
  {
    key: "pa-partner-queue",
    company: PA,
    title: "Map type-rating training partners in the UAE",
    type: "research",
    priority: "low",
    status: "queued",
    agent: "pa-partnerships",
    progress: 0,
    dueInHours: 120,
    estimatedCost: 1.2,
  },
];

export interface SeedApproval {
  company: string | null;
  task?: string;
  agent?: string;
  type: ApprovalType;
  requestedAction: string;
  explanation: string;
  riskLevel: RiskLevel;
  proposedChange?: Record<string, unknown>;
  beforeState?: Record<string, unknown>;
  afterState?: Record<string, unknown>;
  minutesAgo: number;
  status?: "pending" | "approved" | "rejected";
}

export const SEED_APPROVALS: SeedApproval[] = [
  {
    company: EPT,
    task: "ept-review-email",
    agent: "email-comms",
    type: "email_send",
    requestedAction: "Send partnership introduction to 12 EASA flight schools",
    explanation:
      "Drafts follow the approved partnership template. Recipients verified against the shortlist.",
    riskLevel: "medium",
    proposedChange: { recipients: 12, template: "partnership-intro-v2" },
    minutesAgo: 22,
  },
  {
    company: OG,
    task: "og-meta-review",
    agent: "og-marketing-meta",
    type: "ad_budget_increase",
    requestedAction: "Raise “UK Masters — Autumn Intake” daily budget £40 → £65",
    explanation: "CPL is 31% below target for 5 consecutive days with stable lead quality.",
    riskLevel: "high",
    beforeState: { dailyBudget: 40, currency: "GBP" },
    afterState: { dailyBudget: 65, currency: "GBP" },
    minutesAgo: 9,
  },
  {
    company: EPT,
    task: "ept-research",
    agent: "ept-research",
    type: "deep_research",
    requestedAction: "Run deep research on EU pilot training funding schemes",
    explanation: "Estimated 40 external searches, ~$4.80. Exceeds the per-task search allowance.",
    riskLevel: "low",
    proposedChange: { estimatedCostUsd: 4.8, searches: 40 },
    minutesAgo: 48,
  },
  {
    company: PA,
    task: "pa-mobile-audit",
    agent: "pa-web-seo",
    type: "website_deployment",
    requestedAction: "Deploy image compression changes to pilotsassist.com",
    explanation: "Expected LCP improvement of ~1.1s on mobile landing pages.",
    riskLevel: "medium",
    minutesAgo: 130,
  },
  {
    company: OG,
    agent: "og-marketing-meta",
    type: "ad_launch",
    requestedAction: "Launch retargeting campaign for incomplete applications",
    explanation: "Approved by management on the previous review cycle.",
    riskLevel: "medium",
    minutesAgo: 1600,
    status: "approved",
  },
];

export interface SeedEvent {
  minutesAgo: number;
  company: string | null;
  agent?: string;
  task?: string;
  action: string;
  description: string;
  tool?: string;
  provider?: ProviderType;
  outcome?: "success" | "failure";
  error?: string;
}

export const SEED_EVENTS: SeedEvent[] = [
  {
    minutesAgo: 1,
    company: EPT,
    agent: "email-comms",
    task: "email-reply",
    action: "email.drafted",
    description: "Drafted reply to integrated ATPL enquiry",
    tool: "outlook",
    provider: "CLAUDE",
  },
  {
    minutesAgo: 3,
    company: EPT,
    agent: "ept-research",
    task: "ept-research",
    action: "browser.page_read",
    description: "Extracted course data from 3 ATO websites",
    tool: "browser",
  },
  {
    minutesAgo: 6,
    company: OG,
    agent: "og-marketing-meta",
    task: "og-meta-review",
    action: "provider.called",
    description: "Claude analysed ad set performance (mock)",
    provider: "CLAUDE",
  },
  {
    minutesAgo: 9,
    company: OG,
    agent: "og-marketing-meta",
    task: "og-meta-review",
    action: "approval.requested",
    description: "Requested daily budget increase for UK Masters campaign",
  },
  {
    minutesAgo: 14,
    company: null,
    agent: "group-manager",
    task: "daily-ops",
    action: "task.started",
    description: "Started daily operations review",
  },
  {
    minutesAgo: 22,
    company: EPT,
    agent: "email-comms",
    task: "ept-review-email",
    action: "approval.requested",
    description: "Requested approval to send partnership introductions",
  },
  {
    minutesAgo: 31,
    company: EPT,
    agent: "ept-grok",
    action: "provider.called",
    description: "Grok scanned X for pilot training sentiment (mock)",
    provider: "GROK",
  },
  {
    minutesAgo: 44,
    company: PA,
    agent: "pa-web-seo",
    task: "pa-mobile-audit",
    action: "website.audit_started",
    description: "Started mobile performance audit on 6 pages",
    tool: "website_monitoring",
  },
  {
    minutesAgo: 58,
    company: OG,
    agent: "og-sales",
    task: "og-lead-sync",
    action: "google_sheets.update_failed",
    description: "Lead sync failed — integration not configured",
    tool: "google_sheets",
    outcome: "failure",
    error: "Integration not configured",
  },
  {
    minutesAgo: 75,
    company: EPT,
    agent: "group-manager",
    task: "ept-verify",
    action: "task.subtask_created",
    description: "Created verification subtask for ATO approvals",
  },
  {
    minutesAgo: 110,
    company: null,
    agent: "analytics-cost",
    action: "budget.checked",
    description: "Checked spend against daily budgets — all within limits",
    tool: "cost_ledger",
    provider: "LOCAL",
  },
  {
    minutesAgo: 190,
    company: EPT,
    agent: "ept-research",
    task: "ept-research",
    action: "task.started",
    description: "Started European EASA flight school research",
  },
  {
    minutesAgo: 1600,
    company: OG,
    action: "approval.granted",
    description: "Retargeting campaign launch approved (dev user)",
  },
];

/** Mock daily spend profile per provider (USD, whole group, before company split). */
export const SEED_USAGE_PROFILE: Record<ProviderType, { daily: number; model: string }> = {
  CLAUDE: { daily: 14, model: "mock-claude" },
  OPENAI: { daily: 4.5, model: "mock-openai" },
  GROK: { daily: 1.8, model: "mock-grok" },
  LOCAL: { daily: 0, model: "local-rules" },
};

export const SEED_COMPANY_SPLIT: Record<string, number> = { [EPT]: 0.46, [PA]: 0.18, [OG]: 0.36 };

/**
 * ─────────────────────────────────────────────────────────────────────────
 *  DEVELOPMENT SEED ACCOUNTS — NEVER USE IN PRODUCTION
 *  Loaded only by `pnpm db:seed`, which refuses to run when
 *  NODE_ENV=production. Documented in docs/DEVELOPMENT.md.
 * ─────────────────────────────────────────────────────────────────────────
 */
export const DEV_SEED_PASSWORD = "aibos-dev-only-password";

export interface SeedUser {
  email: string;
  firstName: string;
  lastName: string;
  status?: "active" | "disabled";
  memberships: { company: string | null; role: string; departments?: string[] }[];
}

export const SEED_USERS: SeedUser[] = [
  {
    email: "owner@aibos.example",
    firstName: "Platform",
    lastName: "Owner",
    memberships: [{ company: null, role: "platform_owner" }],
  },
  {
    email: "group.admin@aibos.example",
    firstName: "Group",
    lastName: "Admin",
    memberships: [
      { company: EPT, role: "group_admin" },
      { company: OG, role: "group_admin" },
    ],
  },
  {
    email: "ept.manager@aibos.example",
    firstName: "EPT",
    lastName: "Manager",
    memberships: [{ company: EPT, role: "company_manager" }],
  },
  {
    email: "pa.manager@aibos.example",
    firstName: "PilotsAssist",
    lastName: "Manager",
    memberships: [{ company: PA, role: "company_manager" }],
  },
  {
    email: "og.marketing@aibos.example",
    firstName: "Opportunitygrad",
    lastName: "Marketing",
    memberships: [{ company: OG, role: "department_manager", departments: ["marketing"] }],
  },
  {
    email: "disabled@aibos.example",
    firstName: "Disabled",
    lastName: "Account",
    status: "disabled",
    memberships: [{ company: EPT, role: "staff" }],
  },
];
