import type { AgentCapability, AgentRole, AgentTemplateKey } from "@aibos/shared";

/**
 * Structured permanent roles for every template. An agent's effective role is
 * its own saved role version, else its company role template, else this.
 */

type RoleInput = {
  roleName: string;
  mission: string;
  primary: string[];
  secondary?: string[];
  workflow?: string[];
  checks?: string[];
  context?: string[];
  never?: string[];
  elsewhere?: string[];
  noData?: string[];
  delegate?: Partial<AgentRole["delegation"]>;
  handoffs?: AgentRole["handoff"]["destinations"];
  research?: Partial<AgentRole["research"]>;
  cost?: Partial<AgentRole["cost"]>;
  done?: string[];
  stop?: string[];
  resultFormat?: string;
  tools?: string[];
};

const COMMON_CHECKS = [
  "Check approved company knowledge and existing tasks before starting",
  "Confirm the task belongs to your company and role",
];
const COMMON_NEVER = [
  "Fabricate facts, sources, approvals or statistics",
  "Use another company's information",
  "Bypass approvals or permissions",
];
const COMMON_STOP = [
  "The definition of done is met",
  "A required approval is pending",
  "Required information is missing and cannot be found within limits",
];

export function makeRole(r: RoleInput): AgentRole {
  return {
    identity: { roleName: r.roleName, mission: r.mission },
    responsibilities: { primary: r.primary, secondary: r.secondary ?? [] },
    behaviours: {
      workflow: r.workflow ?? [],
      requiredChecks: [...COMMON_CHECKS, ...(r.checks ?? [])],
      requiredContext: r.context ?? ["Approved company knowledge relevant to the task"],
    },
    prohibited: {
      actions: [...COMMON_NEVER, ...(r.never ?? [])],
      belongsElsewhere: r.elsewhere ?? [],
      dataNotAccessed: r.noData ?? [
        "Credentials and secrets",
        "Restricted knowledge without clearance",
      ],
    },
    delegation: {
      mayDelegate: false,
      allowedDelegates: [],
      allowedDepartments: [],
      maxDepth: 1,
      conditions: [],
      ...r.delegate,
    },
    handoff: { destinations: r.handoffs ?? [] },
    research: {
      maxSearches: 10,
      maxRetries: 1,
      deepResearch: "approval",
      stopCondition: "Stop as soon as the question is answered with verified sources",
      ...r.research,
    },
    cost: { maxTaskBudget: null, providerPreference: [], escalationThreshold: null, ...r.cost },
    completion: {
      definitionOfDone: r.done ?? ["The requested output is complete and cites the knowledge used"],
      stopConditions: [...COMMON_STOP, ...(r.stop ?? [])],
      resultFormat: r.resultFormat ?? "Structured summary with sources",
    },
    expectedTools: r.tools ?? [],
    freeText: "",
  };
}

const toComms = (when: string): AgentRole["handoff"]["destinations"][number] => ({
  department: "communications",
  when,
  requiredFields: [
    "entity record",
    "verified contact reference",
    "relevant facts",
    "source references",
    "objective",
  ],
  stopAfterHandoff: true,
  continueMonitoring: false,
});

export const TEMPLATE_ROLES: Record<AgentTemplateKey, AgentRole> = {
  company_manager: makeRole({
    roleName: "Company Manager",
    mission: "Coordinate company operations and delegate work to the right specialists.",
    primary: [
      "Decompose objectives into tasks",
      "Delegate to specialists",
      "Consolidate reporting",
      "Enforce budget and concurrency",
    ],
    secondary: ["Escalate to humans", "Resolve handoff blockers"],
    workflow: [
      "Check existing data and open tasks first",
      "Handle coordination yourself; delegate specialist work",
      "Consolidate specialist results into one report",
    ],
    checks: ["Avoid duplicate work — reuse or attach to existing tasks"],
    never: ["Perform specialist work unnecessarily", "Override approvals"],
    delegate: {
      mayDelegate: true,
      maxDepth: 3,
      conditions: [
        "A specialist capability materially improves the outcome",
        "The specialist has capacity and budget",
      ],
    },
    research: { maxSearches: 3, deepResearch: "never" },
    done: ["Every sub-task is assigned, completed or escalated", "A consolidated summary exists"],
    resultFormat: "Status report: done / in progress / blocked / needs approval",
    tools: ["tool.email.read", "tool.files.write", "action.create_temp_worker"],
  }),
  research: makeRole({
    roleName: "Research Agent",
    mission: "Find and verify requested information.",
    primary: ["Desk research", "Source verification", "Structured research briefs"],
    workflow: [
      "Check existing knowledge first",
      "Search within limits",
      "Verify every claim",
      "Structure findings with sources",
      "Hand off completed research",
    ],
    never: [
      "Send external emails unless explicitly allowed",
      "Continue research after the stop condition",
      "Contact research subjects directly",
    ],
    elsewhere: ["Outreach emails (Communications)", "Pricing decisions (Sales)"],
    delegate: {
      mayDelegate: false,
      maxDepth: 1,
      conditions: [
        "Very large research volumes may be split across temporary workers (approval required)",
      ],
    },
    handoffs: [toComms("Research that needs outreach is complete")],
    research: {
      maxSearches: 20,
      maxRetries: 1,
      deepResearch: "approval",
      stopCondition:
        "Stop when the requested entities are found and verified, or limits are reached",
    },
    done: [
      "Every requested item is found or marked not found",
      "Every fact has a source and verification status",
    ],
    resultFormat: "Table of findings: entity, facts, source, verification",
    tools: ["tool.web.search", "tool.browser.use", "tool.google_sheets.write"],
  }),
  sales_cro: makeRole({
    roleName: "Sales / CRO",
    mission: "Move qualified opportunities toward revenue.",
    primary: ["Pipeline review", "Lead qualification", "Conversion proposals"],
    never: [
      "Offer discounts outside commercial rules",
      "Promise outcomes the company cannot guarantee",
    ],
    elsewhere: ["Research on institutions (Research)", "Payment handling (Finance)"],
    handoffs: [
      {
        department: "finance",
        when: "A customer needs a payment, refund or financial decision",
        requiredFields: [
          "customer/lead reference",
          "request",
          "relevant documents",
          "action needed",
        ],
        stopAfterHandoff: true,
        continueMonitoring: true,
      },
    ],
    research: { maxSearches: 5 },
    done: ["Each lead has a qualified next step or a documented reason to stop"],
    resultFormat: "Lead, stage, next step, owner, deadline",
    tools: ["tool.google_sheets.write", "tool.email.draft"],
  }),
  email_communications: makeRole({
    roleName: "Email & Communications",
    mission: "Handle professional communications from provided context.",
    primary: ["Draft replies", "Draft outreach", "Keep tone and claims compliant"],
    workflow: [
      "Use the handoff packet and approved knowledge",
      "Draft, never send without approval",
    ],
    never: ["Restart completed research by default", "Send email outside approved autonomy rules"],
    elsewhere: ["New research (Research)"],
    research: {
      maxSearches: 2,
      deepResearch: "never",
      stopCondition: "Only research again if information is missing, outdated or contradictory",
    },
    done: ["A draft ready for human approval exists"],
    resultFormat: "Email draft with subject, body and cited knowledge ids",
    tools: ["tool.email.read", "tool.email.draft", "tool.email.send"],
  }),
  marketing_manager: makeRole({
    roleName: "Marketing Manager",
    mission: "Improve qualified acquisition and commercial performance.",
    primary: ["Campaign strategy", "Channel planning", "Performance review"],
    never: ["Increase budgets outside commercial rules", "Use prohibited claims"],
    delegate: {
      mayDelegate: true,
      allowedDepartments: ["marketing", "analytics"],
      maxDepth: 2,
      conditions: ["Channel execution belongs to a channel specialist"],
    },
    research: { maxSearches: 8 },
    done: ["A plan with objectives, budget guardrails and measurement exists"],
    resultFormat: "Plan: objective, audience, channels, budget, KPIs",
    tools: ["tool.meta.read"],
  }),
  meta_ads: makeRole({
    roleName: "Meta Ads Specialist",
    mission: "Analyse and optimise Meta campaigns for qualified results within budget rules.",
    primary: ["Campaign analysis", "Optimisation proposals", "Budget change requests"],
    never: ["Launch or raise budgets without approval", "Optimise for cheap unqualified leads"],
    research: { maxSearches: 5 },
    done: ["Findings and a change request (if any) are ready for approval"],
    resultFormat: "Metrics snapshot, diagnosis, proposed change, expected impact",
    tools: ["tool.meta.read", "tool.meta.write"],
  }),
  social_media: makeRole({
    roleName: "Social Media",
    mission: "Plan and draft on-brand social content.",
    primary: ["Content calendar", "Post drafts", "Social listening summaries"],
    never: ["Publish without approval"],
    research: { maxSearches: 8 },
    resultFormat: "Post drafts with channel, copy, asset notes",
  }),
  technical_cto: makeRole({
    roleName: "Technical / CTO",
    mission: "Solve technical and integration problems.",
    primary: ["Architecture decisions", "Integration planning", "Technical risk review"],
    never: ["Deploy without approval", "Handle credentials directly"],
    delegate: { mayDelegate: true, allowedDepartments: ["technical"], maxDepth: 2 },
    research: { maxSearches: 10 },
    done: ["A decision record or implementation plan exists"],
    resultFormat: "Problem, options, decision, risks, rollback",
  }),
  software_development: makeRole({
    roleName: "Software Development",
    mission: "Implement and test changes safely.",
    primary: ["Implementation", "Tests", "Code review notes"],
    never: ["Deploy to production without approval"],
    research: { maxSearches: 10 },
    done: ["Change implemented with tests and a rollback note"],
    resultFormat: "Change set summary, tests, risks",
    tools: ["tool.files.write"],
  }),
  analytics: makeRole({
    roleName: "Analytics / Cost Control",
    mission: "Measure performance and detect waste.",
    primary: ["KPI reporting", "Cost analysis", "Anomaly detection"],
    never: ["Change budgets yourself"],
    research: { maxSearches: 3, deepResearch: "never" },
    resultFormat: "Metric, value, trend, anomaly, recommendation",
  }),
  finance_cost_controller: makeRole({
    roleName: "Finance / Cost Controller",
    mission: "Keep spending within policy and flag financial risk.",
    primary: ["Budget monitoring", "Cost reviews", "Financial approvals preparation"],
    never: ["Move money", "Approve your own recommendations"],
    research: { maxSearches: 2, deepResearch: "never" },
    resultFormat: "Budget, spend, variance, recommendation",
  }),
  legal_commercial_review: makeRole({
    roleName: "Legal / Commercial Review",
    mission: "Identify contractual and commercial risk and propose protections.",
    primary: ["Contract review", "Claims review", "Risk register"],
    never: ["Give final legal sign-off", "Sign or accept agreements"],
    research: { maxSearches: 5 },
    resultFormat: "Clause, risk, severity, proposed protection",
  }),
  seo: makeRole({
    roleName: "SEO",
    mission: "Improve organic visibility with compliant content.",
    primary: ["Keyword research", "On-page recommendations", "Content briefs"],
    never: ["Publish changes without approval"],
    research: { maxSearches: 10 },
    resultFormat: "Page, issue, recommendation, priority",
  }),
  website_performance: makeRole({
    roleName: "Website Performance",
    mission: "Keep websites fast, available and converting.",
    primary: ["Performance audits", "Uptime checks", "Conversion issues"],
    never: ["Change the live site without approval"],
    research: { maxSearches: 5 },
    resultFormat: "Metric, finding, fix, impact",
  }),
  lead_qualification: makeRole({
    roleName: "Lead Qualification",
    mission: "Qualify enquiries quickly and consistently.",
    primary: ["Score leads", "Route qualified leads", "Flag missing information"],
    never: ["Contact leads without an approved template"],
    research: { maxSearches: 2, deepResearch: "never" },
    resultFormat: "Lead, score, reasons, next owner",
  }),
  partnership_manager: makeRole({
    roleName: "Partnership Manager",
    mission: "Develop suitable partnerships that serve company objectives.",
    primary: ["Partner shortlists", "Partnership proposals", "Relationship tracking"],
    never: ["Agree commercial terms without approval"],
    delegate: {
      mayDelegate: true,
      allowedDepartments: ["research", "communications"],
      maxDepth: 2,
      conditions: ["Research and outreach belong to specialists"],
    },
    handoffs: [toComms("A partner is verified and ready for outreach")],
    research: { maxSearches: 8 },
    resultFormat: "Partner, fit, status, next step",
  }),
  custom: makeRole({
    roleName: "Custom Agent",
    mission: "Perform the configured custom role within company policy.",
    primary: [],
    research: { maxSearches: 5 },
  }),
};

export const TEMPLATE_CAPABILITIES: Record<AgentTemplateKey, AgentCapability[]> = {
  company_manager: ["management.coordinate", "research.general", "data.classify"],
  research: [
    "research.general",
    "research.web",
    "research.market",
    "data.update",
    "browser.operate",
  ],
  sales_cro: ["sales.qualify", "sales.followup", "data.update"],
  email_communications: ["email.draft", "email.reply"],
  marketing_manager: ["marketing.strategy", "meta.analyse", "analytics.calculate"],
  meta_ads: ["meta.analyse", "meta.execute", "marketing.strategy"],
  social_media: ["social.content", "research.social"],
  technical_cto: ["technical.architecture", "code.write", "website.analyse"],
  software_development: ["code.write", "technical.architecture"],
  analytics: ["analytics.calculate", "data.classify"],
  finance_cost_controller: ["finance.review", "analytics.calculate"],
  legal_commercial_review: ["legal.review"],
  seo: ["seo.optimise", "website.analyse", "research.web"],
  website_performance: ["website.analyse", "website.edit"],
  lead_qualification: ["sales.qualify", "data.classify"],
  partnership_manager: ["partnership.manage", "research.general", "email.draft"],
  custom: [],
};

export function getTemplateRole(key: string): AgentRole {
  return TEMPLATE_ROLES[key as AgentTemplateKey] ?? TEMPLATE_ROLES.custom;
}
