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
        children: [
          { label: "All Companies", href: "/companies" },
          { label: "Add Company", href: "/companies/new" },
        ],
      },
      {
        label: "AI Workforce",
        href: "/workforce/agents",
        icon: Bot,
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
        children: [
          { label: "Active", href: "/tasks/active" },
          { label: "Queue", href: "/tasks/queue" },
          { label: "Completed", href: "/tasks/completed" },
          { label: "Failed", href: "/tasks/failed" },
        ],
      },
      { label: "Live Sessions", href: "/live", icon: MonitorPlay },
      { label: "Approvals", href: "/approvals", icon: BadgeCheck, badge: "approvals" },
    ],
  },
  {
    label: "Operations",
    items: [
      { label: "Leads", href: "/leads", icon: Target, stage: 13 },
      { label: "Email", href: "/email", icon: Mail, stage: 14 },
      { label: "Marketing", href: "/marketing", icon: Megaphone, stage: 20 },
      { label: "Advertising Intelligence", href: "/advertising", icon: Telescope, stage: 21 },
      { label: "Websites", href: "/websites", icon: Globe, stage: 24 },
      { label: "Research", href: "/research", icon: FileSearch, stage: 36 },
    ],
  },
  {
    label: "System",
    items: [
      { label: "Integrations", href: "/integrations", icon: Blocks },
      { label: "Analytics", href: "/analytics", icon: BarChart3, stage: 25 },
      { label: "Audit Log", href: "/audit", icon: ScrollText },
      { label: "Settings", href: "/settings", icon: Settings },
    ],
  },
];

export function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}
