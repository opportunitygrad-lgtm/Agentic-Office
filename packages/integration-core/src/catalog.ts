import type { IntegrationKind } from "@aibos/shared";

export type IntegrationCategory =
  | "communication"
  | "data"
  | "advertising"
  | "social"
  | "analytics"
  | "website"
  | "browser"
  | "ai"
  | "crm"
  | "automation";

export type AuthMethod = "oauth2" | "api_key" | "app_password" | "none" | "webhook_secret";

/**
 * Static integration definition. Per-company *instances* live in the
 * `integrations` table and reference a definition by `kind`.
 */
export interface IntegrationDefinition {
  kind: IntegrationKind;
  name: string;
  vendor: string;
  category: IntegrationCategory;
  description: string;
  authMethod: AuthMethod;
  /** Names of environment variables the live adapter will need (never values). */
  requiredSecrets: string[];
  capabilities: string[];
  /** Build ledger stage that activates the live adapter. */
  plannedStage: number;
  /** Whether it can be assigned per company (vs. platform-wide only). */
  perCompany: boolean;
}

export const INTEGRATION_CATALOG: readonly IntegrationDefinition[] = [
  {
    kind: "microsoft_outlook",
    name: "Microsoft Outlook",
    vendor: "Microsoft Graph",
    category: "communication",
    description: "Mailboxes, drafts, sending and calendar via Microsoft Graph.",
    authMethod: "oauth2",
    requiredSecrets: ["MICROSOFT_CLIENT_ID", "MICROSOFT_CLIENT_SECRET", "MICROSOFT_TENANT_ID"],
    capabilities: ["mail.read", "mail.draft", "mail.send", "calendar.read"],
    plannedStage: 14,
    perCompany: true,
  },
  {
    kind: "google_sheets",
    name: "Google Sheets",
    vendor: "Google",
    category: "data",
    description: "Read and update lead lists, trackers and reports.",
    authMethod: "oauth2",
    requiredSecrets: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
    capabilities: ["sheets.read", "sheets.write"],
    plannedStage: 12,
    perCompany: true,
  },
  {
    kind: "google_drive",
    name: "Google Drive",
    vendor: "Google",
    category: "data",
    description: "Documents and knowledge files for company context.",
    authMethod: "oauth2",
    requiredSecrets: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
    capabilities: ["drive.read", "drive.write"],
    plannedStage: 12,
    perCompany: true,
  },
  {
    kind: "meta",
    name: "Meta Marketing API",
    vendor: "Meta",
    category: "advertising",
    description: "Campaigns, ad sets, ads, insights and the Ad Library.",
    authMethod: "oauth2",
    requiredSecrets: ["META_APP_ID", "META_APP_SECRET"],
    capabilities: ["ads.read", "ads.write", "insights.read", "ad_library.read"],
    plannedStage: 19,
    perCompany: true,
  },
  {
    kind: "facebook",
    name: "Facebook Pages",
    vendor: "Meta",
    category: "social",
    description: "Page posts, comments and messaging.",
    authMethod: "oauth2",
    requiredSecrets: ["META_APP_ID", "META_APP_SECRET"],
    capabilities: ["page.read", "page.publish"],
    plannedStage: 19,
    perCompany: true,
  },
  {
    kind: "instagram",
    name: "Instagram",
    vendor: "Meta",
    category: "social",
    description: "Business account content and insights.",
    authMethod: "oauth2",
    requiredSecrets: ["META_APP_ID", "META_APP_SECRET"],
    capabilities: ["media.read", "media.publish", "insights.read"],
    plannedStage: 19,
    perCompany: true,
  },
  {
    kind: "google_analytics",
    name: "Google Analytics 4",
    vendor: "Google",
    category: "analytics",
    description: "Traffic, conversions and funnel reporting.",
    authMethod: "oauth2",
    requiredSecrets: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
    capabilities: ["reports.read"],
    plannedStage: 25,
    perCompany: true,
  },
  {
    kind: "google_search_console",
    name: "Google Search Console",
    vendor: "Google",
    category: "analytics",
    description: "Search performance, indexing and coverage.",
    authMethod: "oauth2",
    requiredSecrets: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
    capabilities: ["search.read", "index.read"],
    plannedStage: 26,
    perCompany: true,
  },
  {
    kind: "wordpress",
    name: "WordPress",
    vendor: "WordPress",
    category: "website",
    description: "Pages, posts and plugin state via REST API.",
    authMethod: "app_password",
    requiredSecrets: ["WORDPRESS_<COMPANY>_URL", "WORDPRESS_<COMPANY>_APP_PASSWORD"],
    capabilities: ["content.read", "content.write"],
    plannedStage: 27,
    perCompany: true,
  },
  {
    kind: "website_monitoring",
    name: "Website Monitoring",
    vendor: "Internal",
    category: "website",
    description: "Uptime, performance and journey checks.",
    authMethod: "none",
    requiredSecrets: [],
    capabilities: ["uptime.check", "performance.audit"],
    plannedStage: 24,
    perCompany: true,
  },
  {
    kind: "playwright_browser",
    name: "Browser Workers",
    vendor: "Playwright",
    category: "browser",
    description: "Controlled browser sessions with live view and human takeover.",
    authMethod: "none",
    requiredSecrets: [],
    capabilities: ["browser.navigate", "browser.interact", "browser.screenshot"],
    plannedStage: 29,
    perCompany: false,
  },
  {
    kind: "grok_x_search",
    name: "Grok X Search",
    vendor: "xAI",
    category: "ai",
    description: "Real-time X (Twitter) search and social intelligence.",
    authMethod: "api_key",
    requiredSecrets: ["XAI_API_KEY"],
    capabilities: ["x.search"],
    plannedStage: 9,
    perCompany: false,
  },
  {
    kind: "claude",
    name: "Claude",
    vendor: "Anthropic",
    category: "ai",
    description: "Primary reasoning, drafting and computer-use provider.",
    authMethod: "api_key",
    requiredSecrets: ["ANTHROPIC_API_KEY"],
    capabilities: ["reasoning", "coding", "computer_use", "vision"],
    plannedStage: 7,
    perCompany: false,
  },
  {
    kind: "openai",
    name: "OpenAI",
    vendor: "OpenAI",
    category: "ai",
    description: "Secondary reasoning, analysis and drafting provider.",
    authMethod: "api_key",
    requiredSecrets: ["OPENAI_API_KEY"],
    capabilities: ["reasoning", "coding", "vision"],
    plannedStage: 8,
    perCompany: false,
  },
  {
    kind: "crm",
    name: "CRM",
    vendor: "TBD",
    category: "crm",
    description: "Lead and pipeline system of record (internal or external).",
    authMethod: "api_key",
    requiredSecrets: ["CRM_API_KEY"],
    capabilities: ["leads.read", "leads.write"],
    plannedStage: 13,
    perCompany: true,
  },
  {
    kind: "webhooks",
    name: "Webhooks",
    vendor: "Internal",
    category: "automation",
    description: "Inbound/outbound signed webhooks for external systems.",
    authMethod: "webhook_secret",
    requiredSecrets: ["WEBHOOK_SIGNING_SECRET"],
    capabilities: ["webhook.receive", "webhook.send"],
    plannedStage: 36,
    perCompany: true,
  },
];

const byKind = new Map(INTEGRATION_CATALOG.map((d) => [d.kind, d]));

export function getIntegrationDefinition(kind: IntegrationKind): IntegrationDefinition {
  const d = byKind.get(kind);
  if (!d) throw new Error(`Unknown integration: ${kind}`);
  return d;
}
