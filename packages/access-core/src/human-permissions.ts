/**
 * HUMAN permission catalogue. Humans and agents are separate principals with
 * separate catalogues (see agent-permissions.ts). Authorisation decisions are
 * always made on permission keys — never on role names.
 */

export interface PermissionDefinition {
  key: string;
  category: string;
  label: string;
  description: string;
  /** Scope at which the permission is meaningful. */
  scope: "company" | "global";
  /** Sensitive permissions are highlighted in the UI and audited when granted. */
  sensitive?: boolean;
}

const p = (
  key: string,
  label: string,
  description: string,
  opts: { scope?: "company" | "global"; sensitive?: boolean } = {},
): Omit<PermissionDefinition, "category"> => ({
  key,
  label,
  description,
  scope: opts.scope ?? "company",
  sensitive: opts.sensitive,
});

const CATEGORIES: { category: string; permissions: Omit<PermissionDefinition, "category">[] }[] = [
  {
    category: "Companies",
    permissions: [
      p("company.view", "View company", "See the company, its dashboard and profile."),
      p("company.create", "Create companies", "Onboard new companies into the OS.", {
        scope: "global",
        sensitive: true,
      }),
      p("company.edit", "Edit company", "Change company profile and brand information."),
      p("company.archive", "Archive company", "Deactivate a company.", { sensitive: true }),
      p(
        "company.settings.manage",
        "Manage company settings",
        "Budgets, approval toggles and structured settings.",
        { sensitive: true },
      ),
    ],
  },
  {
    category: "Users",
    permissions: [
      p("user.view", "View users", "See users and their memberships."),
      p("user.invite", "Invite users", "Invite people into the company.", { sensitive: true }),
      p("user.edit", "Edit users", "Change user profile details."),
      p("user.disable", "Disable users", "Suspend or disable accounts and revoke their sessions.", {
        sensitive: true,
      }),
      p("user.role.assign", "Assign roles", "Grant and change roles and memberships.", {
        sensitive: true,
      }),
    ],
  },
  {
    category: "AI agents",
    permissions: [
      p("agent.view", "View agents", "See agents, their status and current work."),
      p("agent.create", "Create agents", "Create agents from templates."),
      p("agent.edit", "Edit agents", "Change agent configuration and assignments."),
      p("agent.activate", "Activate agents", "Wake or activate agents."),
      p("agent.pause", "Pause agents", "Pause an agent's work."),
      p("agent.stop", "Stop agents", "Stop an agent's current task."),
      p("agent.delete", "Delete agents", "Retire agents permanently.", { sensitive: true }),
      p(
        "agent.permissions.manage",
        "Manage agent authority",
        "Change agent autonomy levels and tool/action permissions.",
        { sensitive: true },
      ),
    ],
  },
  {
    category: "Tasks",
    permissions: [
      p("task.view", "View tasks", "See tasks and their progress."),
      p("task.create", "Create tasks", "Create tasks for agents."),
      p("task.assign", "Assign tasks", "Assign or reassign tasks."),
      p("task.pause", "Pause tasks", "Pause running tasks."),
      p("task.cancel", "Cancel tasks", "Cancel tasks."),
    ],
  },
  {
    category: "Approvals",
    permissions: [
      p("approval.view", "View approvals", "See approval requests."),
      p("approval.decide", "Decide routine approvals", "Approve or reject routine requests."),
      p(
        "approval.high_risk",
        "Decide high-risk approvals",
        "Required for high/critical risk requests.",
        { sensitive: true },
      ),
      p(
        "approval.financial",
        "Decide financial approvals",
        "Spend, ad budgets and financial actions.",
        { sensitive: true },
      ),
      p(
        "approval.external_send",
        "Approve external sends",
        "Emails and other outbound communication.",
      ),
      p("approval.deployment", "Approve deployments", "Website and code deployments.", {
        sensitive: true,
      }),
    ],
  },
  {
    category: "Knowledge & rules",
    permissions: [
      p("knowledge.view", "View knowledge", "See the company knowledge library and rules."),
      p("knowledge.create", "Create knowledge", "Add draft knowledge items."),
      p("knowledge.edit", "Edit knowledge", "Edit drafts, submit for review and link knowledge."),
      p(
        "knowledge.approve",
        "Approve knowledge",
        "Approve, reject or supersede authoritative company knowledge.",
        { sensitive: true },
      ),
      p("knowledge.archive", "Archive knowledge", "Retire knowledge items."),
      p(
        "knowledge.global.manage",
        "Manage global knowledge",
        "Create and approve GLOBAL knowledge shared by every company.",
        { scope: "global", sensitive: true },
      ),
      p(
        "knowledge.confidential.read",
        "Read confidential knowledge",
        "See knowledge classified CONFIDENTIAL.",
        { sensitive: true },
      ),
      p(
        "knowledge.restricted.read",
        "Read restricted knowledge",
        "See knowledge classified RESTRICTED (e.g. banking details).",
        { sensitive: true },
      ),
      p(
        "policy.manage",
        "Manage company rules",
        "Create and edit brand, commercial and compliance rules.",
        {
          sensitive: true,
        },
      ),
      p("policy.approve", "Approve company rules", "Approve rules so they bind agents.", {
        sensitive: true,
      }),
      p("context.preview", "Preview agent context", "See what an agent would know for a task."),
    ],
  },
  {
    category: "Email",
    permissions: [
      p("email.view", "View email", "See monitored mailboxes and drafts."),
      p("email.draft", "Draft email", "Create and edit drafts."),
      p("email.send", "Send email", "Send email directly.", { sensitive: true }),
      p("email.auto_send.manage", "Manage auto-send rules", "Configure email autonomy rules.", {
        sensitive: true,
      }),
    ],
  },
  {
    category: "Marketing",
    permissions: [
      p("marketing.view", "View marketing", "See marketing plans and performance."),
      p("marketing.manage", "Manage marketing", "Change marketing plans and content."),
    ],
  },
  {
    category: "Meta Ads",
    permissions: [
      p("meta.view", "View Meta", "See campaigns, ad sets and insights."),
      p("meta.create", "Create campaigns", "Create draft campaigns."),
      p("meta.edit", "Edit campaigns", "Modify campaigns, audiences and creatives."),
      p("meta.pause", "Pause campaigns", "Pause campaigns or ads."),
      p("meta.launch", "Launch campaigns", "Launch campaigns (spends money).", { sensitive: true }),
      p("meta.budget.manage", "Manage ad budgets", "Change campaign budgets.", { sensitive: true }),
    ],
  },
  {
    category: "Websites",
    permissions: [
      p("website.view", "View websites", "See monitoring and content."),
      p("website.edit", "Edit websites", "Change website content drafts."),
      p("website.publish", "Publish websites", "Publish changes live.", { sensitive: true }),
    ],
  },
  {
    category: "Integrations",
    permissions: [
      p("integration.view", "View integrations", "See integration status."),
      p("integration.connect", "Connect integrations", "Authorise new connections.", {
        sensitive: true,
      }),
      p("integration.disconnect", "Disconnect integrations", "Remove connections.", {
        sensitive: true,
      }),
      p("integration.configure", "Configure integrations", "Change integration settings."),
    ],
  },
  {
    category: "Costs",
    permissions: [
      p("cost.view", "View costs", "See AI usage and spend."),
      p("cost.policy.manage", "Manage cost policies", "Change budgets and cost policies.", {
        sensitive: true,
      }),
    ],
  },
  {
    category: "Audit",
    permissions: [
      p("audit.view", "View audit log", "See the audit trail for accessible companies."),
    ],
  },
  {
    category: "System",
    permissions: [
      p("system.manage", "Manage system", "Platform-wide configuration.", {
        scope: "global",
        sensitive: true,
      }),
      p(
        "security.manage",
        "Manage security",
        "Roles, global access, sessions and security settings.",
        { scope: "global", sensitive: true },
      ),
    ],
  },
];

export const HUMAN_PERMISSIONS: readonly PermissionDefinition[] = CATEGORIES.flatMap((c) =>
  c.permissions.map((perm) => ({ ...perm, category: c.category })),
);

export const HUMAN_PERMISSION_CATEGORIES: readonly string[] = CATEGORIES.map((c) => c.category);

export const HUMAN_PERMISSION_KEYS: ReadonlySet<string> = new Set(
  HUMAN_PERMISSIONS.map((x) => x.key),
);

export type HumanPermission = string;

export function isHumanPermission(key: string): boolean {
  return HUMAN_PERMISSION_KEYS.has(key);
}
