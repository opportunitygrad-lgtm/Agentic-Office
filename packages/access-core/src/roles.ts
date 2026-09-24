import { HUMAN_PERMISSIONS } from "./human-permissions";

export interface SystemRoleDefinition {
  key: string;
  name: string;
  description: string;
  /** global roles may be granted through a company-less (all companies) membership. */
  scope: "global" | "company";
  /** Code-owned permission set; system roles are read-only in the UI. */
  permissions: string[];
  isSystem: boolean;
  rank: number;
}

const ALL = HUMAN_PERMISSIONS.map((x) => x.key);
const VIEW = ALL.filter((k) => k.endsWith(".view"));
const without = (list: string[], remove: string[]) => list.filter((k) => !remove.includes(k));
const COMPANY_SCOPED = HUMAN_PERMISSIONS.filter((x) => x.scope === "company").map((x) => x.key);

export const SYSTEM_ROLES: readonly SystemRoleDefinition[] = [
  {
    key: "platform_owner",
    name: "Platform Owner",
    description: "Highest authority. Administers the complete AI Business OS across every company.",
    scope: "global",
    permissions: ALL,
    isSystem: true,
    rank: 100,
  },
  {
    key: "group_admin",
    name: "Group Admin / Management",
    description:
      "Operates across authorised companies: companies, people, agents, approvals and costs.",
    scope: "global",
    permissions: without(ALL, ["system.manage", "security.manage"]),
    isSystem: true,
    rank: 90,
  },
  {
    key: "company_owner",
    name: "Company Owner",
    description:
      "Full control over an assigned company, including people, integrations and budgets.",
    scope: "company",
    permissions: COMPANY_SCOPED,
    isSystem: true,
    rank: 80,
  },
  {
    key: "company_manager",
    name: "Company Manager",
    description: "Operational management of a company: agents, tasks and routine approvals.",
    scope: "company",
    permissions: [
      ...VIEW.filter((k) => k !== "audit.view"),
      "audit.view",
      "company.edit",
      "user.invite",
      "agent.create",
      "agent.edit",
      "agent.activate",
      "agent.pause",
      "agent.stop",
      "task.create",
      "task.assign",
      "task.pause",
      "task.cancel",
      "approval.decide",
      "approval.external_send",
      "email.draft",
      "marketing.manage",
      "website.edit",
    ],
    isSystem: true,
    rank: 60,
  },
  {
    key: "department_manager",
    name: "Department Manager",
    description: "Manages assigned departmental areas (e.g. Marketing) within a company.",
    scope: "company",
    permissions: [
      "company.view",
      "agent.view",
      "agent.pause",
      "task.view",
      "task.create",
      "task.assign",
      "task.pause",
      "approval.view",
      "approval.decide",
      "email.view",
      "email.draft",
      "marketing.view",
      "marketing.manage",
      "meta.view",
      "meta.create",
      "meta.edit",
      "meta.pause",
      "website.view",
      "cost.view",
    ],
    isSystem: true,
    rank: 50,
  },
  {
    key: "staff",
    name: "Staff",
    description: "Standard operational access: view work, create tasks and draft.",
    scope: "company",
    permissions: [
      "company.view",
      "agent.view",
      "task.view",
      "task.create",
      "approval.view",
      "email.view",
      "email.draft",
      "marketing.view",
      "meta.view",
      "website.view",
      "integration.view",
      "cost.view",
    ],
    isSystem: true,
    rank: 30,
  },
  {
    key: "viewer",
    name: "Viewer",
    description: "Read-only access to company operations.",
    scope: "company",
    permissions: without(VIEW, ["user.view", "audit.view"]),
    isSystem: true,
    rank: 10,
  },
  {
    key: "custom",
    name: "Custom",
    description: "Editable starting point for a custom permission composition.",
    scope: "company",
    permissions: ["company.view"],
    isSystem: false,
    rank: 0,
  },
];

export function getSystemRole(key: string): SystemRoleDefinition | undefined {
  return SYSTEM_ROLES.find((r) => r.key === key);
}
