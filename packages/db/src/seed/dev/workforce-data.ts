/**
 * ─────────────────────────────────────────────────────────────────────────
 *  DEVELOPMENT SEED DATA ONLY — Stage 04 workforce: company specialist role
 *  templates, teams, task requirements, delegation history, a handoff and a
 *  temporary worker. Editable in the UI; reset by `pnpm db:seed`.
 * ─────────────────────────────────────────────────────────────────────────
 */
import { TEMPLATE_CAPABILITIES, TEMPLATE_ROLES } from "@aibos/agent-core";
import type { AgentCapability, AgentRole, AgentTemplateKey } from "@aibos/shared";

const EPT = "euro-pilot-training";
const PA = "pilotsassist";
const OG = "opportunitygrad";

function specialise(
  base: AgentTemplateKey,
  roleName: string,
  mission: string,
  extra: { checks?: string[]; never?: string[]; workflow?: string[]; primary?: string[] } = {},
): AgentRole {
  const r = JSON.parse(JSON.stringify(TEMPLATE_ROLES[base])) as AgentRole;
  r.identity = { roleName, mission };
  if (extra.primary) r.responsibilities.primary = extra.primary;
  r.behaviours.workflow = [...(extra.workflow ?? []), ...r.behaviours.workflow];
  r.behaviours.requiredChecks = [...r.behaviours.requiredChecks, ...(extra.checks ?? [])];
  r.prohibited.actions = [...r.prohibited.actions, ...(extra.never ?? [])];
  return r;
}

export interface SeedRoleTemplate {
  key: string;
  company: string;
  base: AgentTemplateKey;
  name: string;
  department: string;
  capabilities?: AgentCapability[];
  role: AgentRole;
  /** Seed agent keys that use this template. */
  agents: string[];
}

const PREMIUM =
  "Keep premium, European, aviation-focused positioning — never cheap education-agency language";
const NO_INVENT =
  "Never invent regulatory approvals, testimonials, student outcomes, partnerships or statistics";

export const SEED_ROLE_TEMPLATES: SeedRoleTemplate[] = [
  /* Euro Pilot Training */
  {
    key: "ept-flight-school-research",
    company: EPT,
    base: "research",
    name: "Flight School Research",
    department: "research",
    agents: ["ept-research"],
    role: specialise(
      "research",
      "Flight School Research",
      "Find and verify suitable European flight schools for partnership.",
      {
        workflow: ["Partnership-first: research only schools that could become partners"],
        checks: ["Verify every approval against the official register"],
      },
    ),
  },
  {
    key: "ept-easa-intelligence",
    company: EPT,
    base: "research",
    name: "EASA Training Intelligence",
    department: "research",
    agents: [],
    role: specialise(
      "research",
      "EASA Training Intelligence",
      "Track EASA training rules and pathways relevant to candidates.",
      { never: ["Present regulatory interpretation as legal advice"] },
    ),
  },
  {
    key: "ept-partnerships",
    company: EPT,
    base: "partnership_manager",
    name: "Partnerships",
    department: "partnerships",
    agents: ["ept-partnerships"],
    role: specialise(
      "partnership_manager",
      "EPT Partnerships",
      "Develop suitable European flight-school partnerships.",
      {
        workflow: ["Research first (Research), outreach drafts second (Communications)"],
        never: [PREMIUM],
      },
    ),
  },
  {
    key: "ept-marketing",
    company: EPT,
    base: "marketing_manager",
    name: "EPT Marketing",
    department: "marketing",
    agents: ["ept-marketing"],
    role: specialise(
      "marketing_manager",
      "EPT Marketing",
      "Attract qualified international pilot-training candidates.",
      { never: [PREMIUM] },
    ),
  },
  {
    key: "ept-sales",
    company: EPT,
    base: "sales_cro",
    name: "EPT Sales / CRO",
    department: "sales",
    agents: ["ept-sales"],
    role: specialise(
      "sales_cro",
      "EPT Sales / CRO",
      "Convert qualified candidates into training enrolments.",
      { never: ["Quote fees not in approved, current pricing knowledge"] },
    ),
  },
  {
    key: "ept-grok-social",
    company: EPT,
    base: "social_media",
    name: "Grok Social Intelligence",
    department: "marketing",
    capabilities: ["research.social", "social.content"],
    agents: ["ept-grok"],
    role: specialise(
      "social_media",
      "Grok Social Intelligence",
      "Summarise social signals about pilot training for Marketing.",
      { never: ["Post publicly"] },
    ),
  },
  /* PilotsAssist */
  {
    key: "pa-aviation-research",
    company: PA,
    base: "research",
    name: "Aviation Research",
    department: "research",
    agents: ["pa-research"],
    role: specialise(
      "research",
      "Aviation Research",
      "Research aviation training and services markets for PilotsAssist.",
      { never: [NO_INVENT] },
    ),
  },
  {
    key: "pa-training-partnerships",
    company: PA,
    base: "partnership_manager",
    name: "Training Partnerships",
    department: "partnerships",
    agents: ["pa-partnerships"],
    role: specialise(
      "partnership_manager",
      "Training Partnerships",
      "Build training partnerships for PilotsAssist services.",
      { never: [NO_INVENT] },
    ),
  },
  {
    key: "pa-type-rating-research",
    company: PA,
    base: "research",
    name: "Type Rating Research",
    department: "research",
    agents: [],
    role: specialise(
      "research",
      "Type Rating Research",
      "Research type-rating providers and requirements.",
      { never: [NO_INVENT] },
    ),
  },
  {
    key: "pa-website-seo",
    company: PA,
    base: "seo",
    name: "Website / SEO",
    department: "website",
    agents: ["pa-web-seo"],
    role: specialise(
      "seo",
      "PilotsAssist Website / SEO",
      "Keep pilotsassist.com accurate, fast and discoverable.",
      { never: [NO_INVENT] },
    ),
  },
  {
    key: "pa-marketing",
    company: PA,
    base: "marketing_manager",
    name: "PilotsAssist Marketing",
    department: "marketing",
    agents: ["pa-marketing"],
    role: specialise(
      "marketing_manager",
      "PilotsAssist Marketing",
      "Grow qualified demand for PilotsAssist services.",
      { never: [NO_INVENT] },
    ),
  },
  {
    key: "pa-sales",
    company: PA,
    base: "sales_cro",
    name: "PilotsAssist Sales",
    department: "sales",
    agents: [],
    role: specialise("sales_cro", "PilotsAssist Sales", "Convert qualified aviation enquiries.", {
      never: [NO_INVENT, "Promise finance approval"],
    }),
  },
  /* Opportunitygrad */
  {
    key: "og-university-research",
    company: OG,
    base: "research",
    name: "University Research",
    department: "research",
    agents: ["og-research"],
    role: specialise(
      "research",
      "University Research",
      "Research universities and programmes for applicants.",
      { never: ["Invent university partnerships"] },
    ),
  },
  {
    key: "og-university-partnerships",
    company: OG,
    base: "partnership_manager",
    name: "University Partnerships",
    department: "partnerships",
    agents: [],
    role: specialise(
      "partnership_manager",
      "University Partnerships",
      "Develop genuine university relationships.",
      { never: ["Invent university partnerships"] },
    ),
  },
  {
    key: "og-meta-ads",
    company: OG,
    base: "meta_ads",
    name: "Meta Ads",
    department: "marketing",
    agents: ["og-marketing-meta"],
    role: specialise(
      "meta_ads",
      "Opportunitygrad Meta Ads",
      "Win qualified enquiries on Meta within the ₹100 automatic budget rule.",
      {
        checks: ["Check the Meta budget increase limit before proposing any increase"],
        never: ["Optimise for cheap unqualified leads"],
      },
    ),
  },
  {
    key: "og-lead-quality",
    company: OG,
    base: "lead_qualification",
    name: "Lead Quality",
    department: "sales",
    agents: [],
    role: specialise(
      "lead_qualification",
      "Lead Quality",
      "Keep enquiry quality high — qualified leads over cheap leads.",
    ),
  },
  {
    key: "og-admissions",
    company: OG,
    base: "custom",
    name: "Admissions",
    department: "admissions",
    capabilities: ["admissions.process", "data.update"],
    agents: ["og-admissions"],
    role: specialise(
      "custom",
      "Admissions",
      "Move applicants through applications and admissions accurately.",
      {
        primary: ["Application tracking", "Document checks", "Admissions updates"],
        never: ["Promise admission or visa outcomes"],
      },
    ),
  },
  {
    key: "og-sales-counselling",
    company: OG,
    base: "sales_cro",
    name: "Sales / Counselling",
    department: "sales",
    agents: ["og-sales"],
    role: specialise(
      "sales_cro",
      "Sales / Counselling",
      "Counsel students honestly toward suitable programmes.",
      { never: ["Promise admission or visa outcomes"] },
    ),
  },
  {
    key: "og-funnel-optimisation",
    company: OG,
    base: "analytics",
    name: "Funnel Optimisation",
    department: "analytics",
    agents: [],
    role: specialise(
      "analytics",
      "Funnel Optimisation",
      "Find where qualified enquiries are lost and why.",
    ),
  },
];

export const capabilitiesFor = (t: SeedRoleTemplate): AgentCapability[] =>
  t.capabilities ?? TEMPLATE_CAPABILITIES[t.base];

export const SEED_TEAMS = [
  {
    key: "ept-partnerships-team",
    company: EPT,
    name: "EPT Partnerships Team",
    department: "partnerships",
    leader: "ept-partnerships",
    members: ["ept-partnerships", "ept-research"],
    purpose: "Find, verify and approach suitable European flight schools.",
    taskTypes: ["research", "email"],
  },
  {
    key: "og-growth-team",
    company: OG,
    name: "Opportunitygrad Growth Team",
    department: "marketing",
    leader: "og-marketing-meta",
    members: ["og-marketing-meta", "og-sales"],
    purpose: "Grow qualified enquiries and enrolments.",
    taskTypes: ["marketing", "advertising", "sales"],
  },
  {
    key: "pa-website-team",
    company: PA,
    name: "PilotsAssist Website Team",
    department: "website",
    leader: "pa-web-seo",
    members: ["pa-web-seo"],
    purpose: "Keep pilotsassist.com accurate, fast and converting.",
    taskTypes: ["website", "technical"],
  },
] as const;

/** Requirements for existing seed tasks (keyed by task key). */
export const SEED_TASK_REQUIREMENTS: Record<
  string,
  {
    capabilities: AgentCapability[];
    maxBudget?: number;
    targetEntity?: string;
    stop?: string;
    outcome?: string;
  }
> = {
  "ept-research": {
    capabilities: ["research.web"],
    maxBudget: 2,
    stop: "Stop at 20 verified schools",
    outcome: "A verified shortlist for partnership outreach",
  },
  "ept-verify": { capabilities: ["research.general"], maxBudget: 1 },
  "ept-email": {
    capabilities: ["email.draft"],
    maxBudget: 1,
    outcome: "Partnership conversations with verified schools",
  },
  "email-reply": { capabilities: ["email.reply"], maxBudget: 0.5 },
  "og-meta-review": { capabilities: ["meta.analyse"], maxBudget: 1 },
  "og-lead-sync": { capabilities: ["data.update"], maxBudget: 0.5 },
  "pa-mobile-audit": { capabilities: ["website.analyse"], maxBudget: 1 },
  "og-uni-research": { capabilities: ["research.web"], maxBudget: 3 },
  "pa-partner-queue": { capabilities: ["partnership.manage"], maxBudget: 2 },
};

/** New unassigned tasks that showcase delegation. */
export const SEED_DELEGATION_TASKS = [
  {
    key: "ept-portugal",
    company: EPT,
    title: "Find EASA flight schools in Portugal",
    description: "Identify EASA-approved flight schools in Portugal that could become partners.",
    type: "research" as const,
    capabilities: ["research.web"] as AgentCapability[],
    maxBudget: 2,
    estimatedCost: 1,
  },
  {
    key: "ept-200-schools",
    company: EPT,
    title: "Research 200 flight schools across 10 countries",
    description: "Large partnership research sweep — split by country if approved.",
    type: "research" as const,
    capabilities: ["research.web"] as AgentCapability[],
    maxBudget: 2,
    estimatedCost: 2,
    parallel: true,
    workItems: 200,
  },
];
