import type { LucideIcon } from "lucide-react";
import {
  BadgeCheck,
  BarChart3,
  Blocks,
  Bot,
  Building2,
  FileSearch,
  Globe,
  LayoutDashboard,
  ListChecks,
  Mail,
  Megaphone,
  MonitorPlay,
  ScrollText,
  Settings,
  Target,
  Telescope,
} from "lucide-react";

export interface NavItem {
  label: string;
  href: string;
  icon?: LucideIcon;
  /** Build ledger stage for placeholder modules. */
  stage?: number;
  badge?: "approvals";
  /** UI visibility hint — the API enforces access regardless. */
  permission?: string;
  children?: NavItem[];
}

export interface NavGroup {
  label?: string;
  items: NavItem[];
}

export const NAV: NavGroup[] = [
  {
    items: [{ label: "Command Centre", href: "/", icon: LayoutDashboard }],
  },
  {
    label: "Organisation",
    items: [
      {
        label: "Companies",
        href: "/companies",
        icon: Building2,
        permission: "company.view",
        children: [
          { label: "All Companies", href: "/companies" },
          { label: "Add Company", href: "/companies/new", permission: "company.create" },
        ],
      },
      {
        label: "AI Workforce",
        href: "/workforce/agents",
        icon: Bot,
        permission: "agent.view",
        children: [
          { label: "Agents", href: "/workforce/agents" },
          { label: "Agent Templates", href: "/workforce/templates" },
          { label: "Teams / Departments", href: "/workforce/teams" },
        ],
      },
      {
        label: "Tasks",
        href: "/tasks/active",
        icon: ListChecks,
        permission: "task.view",
        children: [
          { label: "Active", href: "/tasks/active" },
          { label: "Queue", href: "/tasks/queue" },
          { label: "Completed", href: "/tasks/completed" },
          { label: "Failed", href: "/tasks/failed" },
        ],
      },
      { label: "Live Sessions", href: "/live", icon: MonitorPlay, permission: "agent.view" },
      {
        label: "Approvals",
        href: "/approvals",
        icon: BadgeCheck,
        badge: "approvals",
        permission: "approval.view",
      },
    ],
  },
  {
    label: "Operations",
    items: [
      { label: "Leads", href: "/leads", icon: Target, stage: 13 },
      { label: "Email", href: "/email", icon: Mail, stage: 14, permission: "email.view" },
      {
        label: "Marketing",
        href: "/marketing",
        icon: Megaphone,
        stage: 20,
        permission: "marketing.view",
      },
      {
        label: "Advertising Intelligence",
        href: "/advertising",
        icon: Telescope,
        stage: 21,
        permission: "meta.view",
      },
      { label: "Websites", href: "/websites", icon: Globe, stage: 24, permission: "website.view" },
      { label: "Research", href: "/research", icon: FileSearch, stage: 36 },
    ],
  },
  {
    label: "System",
    items: [
      {
        label: "Integrations",
        href: "/integrations",
        icon: Blocks,
        permission: "integration.view",
      },
      {
        label: "Analytics",
        href: "/analytics",
        icon: BarChart3,
        stage: 25,
        permission: "cost.view",
      },
      { label: "Audit Log", href: "/audit", icon: ScrollText, permission: "audit.view" },
      {
        label: "Settings",
        href: "/settings",
        icon: Settings,
        children: [
          { label: "General", href: "/settings" },
          { label: "Users & Access", href: "/settings/users", permission: "user.view" },
          { label: "Roles & Permissions", href: "/settings/roles", permission: "user.view" },
        ],
      },
    ],
  },
];

export function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}
