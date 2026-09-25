/**
 * Internal service identities — non-human, non-agent principals that act
 * on the system (webhooks, monitors, workers). Audit records show
 * "SERVICE: Email Monitor" instead of attributing actions to a person.
 */
export interface ServiceIdentityDefinition {
  key: string;
  name: string;
  description: string;
}

export const SERVICE_IDENTITIES: readonly ServiceIdentityDefinition[] = [
  { key: "worker", name: "Worker", description: "Background queue worker" },
  { key: "agent-worker", name: "Agent Worker", description: "Executes AI agent runs (Stage 05)" },
  { key: "scheduler", name: "Scheduler", description: "Scheduled jobs and follow-ups" },
  {
    key: "email-monitor",
    name: "Email Monitor",
    description: "Outlook webhook and mailbox sync (Stage 15)",
  },
  { key: "meta-webhook", name: "Meta Webhook", description: "Meta platform webhooks (Stage 20)" },
  {
    key: "website-monitor",
    name: "Website Monitor",
    description: "Uptime and performance monitoring (Stage 24)",
  },
  {
    key: "browser-worker",
    name: "Browser Worker",
    description: "Controlled browser sessions (Stage 29)",
  },
  { key: "bootstrap-cli", name: "Bootstrap CLI", description: "First administrator bootstrap" },
  {
    key: "dev-seed",
    name: "Development Seed",
    description: "Development seed loader (never in production)",
  },
];
