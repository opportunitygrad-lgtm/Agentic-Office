import type { AgentTemplateKey } from "@aibos/shared";

export type TemplateGrantEffect = "allow" | "require_approval" | "deny";

/** Baseline granted to every agent: safe reads, destructive actions denied. */
const BASE: Record<string, TemplateGrantEffect> = {
  "tool.web.search": "allow",
  "tool.files.read": "allow",
  "action.destructive": "deny",
};

/**
 * Default agent permission grants per template (company-independent).
 * Autonomy level and approval gates still apply on top — see
 * `evaluateAgentPermission` in @aibos/access-core.
 */
export const TEMPLATE_GRANTS: Record<AgentTemplateKey, Record<string, TemplateGrantEffect>> = {
  company_manager: {
    ...BASE,
    "tool.email.read": "allow",
    "tool.google_sheets.read": "allow",
    "tool.meta.read": "allow",
    "tool.files.write": "allow",
    "action.external_send": "require_approval",
  },
  research: {
    ...BASE,
    "tool.browser.use": "allow",
    "tool.google_sheets.read": "allow",
    "tool.google_sheets.write": "allow",
    "action.deep_research": "require_approval",
  },
  sales_cro: {
    ...BASE,
    "tool.google_sheets.read": "allow",
    "tool.google_sheets.write": "allow",
    "tool.email.read": "allow",
    "tool.email.draft": "allow",
  },
  email_communications: {
    ...BASE,
    "tool.email.read": "allow",
    "tool.email.draft": "allow",
    "tool.email.send": "require_approval",
    "action.external_send": "require_approval",
  },
  marketing_manager: {
    ...BASE,
    "tool.meta.read": "allow",
    "tool.google_sheets.read": "allow",
    "tool.meta.write": "require_approval",
  },
  meta_ads: {
    ...BASE,
    "tool.meta.read": "allow",
    "tool.meta.write": "require_approval",
    "action.financial_change": "require_approval",
    "tool.google_sheets.write": "allow",
  },
  social_media: { ...BASE, "tool.browser.use": "allow", "action.publish": "require_approval" },
  technical_cto: {
    ...BASE,
    "tool.wordpress.read": "allow",
    "tool.browser.use": "allow",
    "action.deploy": "require_approval",
  },
  software_development: { ...BASE, "tool.files.write": "allow", "action.deploy": "deny" },
  analytics: {
    ...BASE,
    "tool.google_sheets.read": "allow",
    "tool.google_sheets.write": "allow",
    "tool.meta.read": "allow",
  },
  finance_cost_controller: {
    ...BASE,
    "tool.google_sheets.read": "allow",
    "action.financial_change": "deny",
  },
  legal_commercial_review: { ...BASE },
  seo: {
    ...BASE,
    "tool.wordpress.read": "allow",
    "tool.wordpress.write": "require_approval",
    "tool.browser.use": "allow",
  },
  website_performance: { ...BASE, "tool.browser.use": "allow", "tool.wordpress.read": "allow" },
  lead_qualification: {
    ...BASE,
    "tool.google_sheets.read": "allow",
    "tool.google_sheets.write": "allow",
    "tool.email.read": "allow",
    "tool.email.draft": "allow",
  },
  partnership_manager: {
    ...BASE,
    "tool.email.read": "allow",
    "tool.email.draft": "allow",
    "tool.email.send": "require_approval",
    "tool.browser.use": "allow",
  },
  custom: { ...BASE },
};
