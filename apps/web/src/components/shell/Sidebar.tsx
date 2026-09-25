"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { FlaskConical, PlugZap } from "lucide-react";
import { cn } from "@aibos/ui";
import { NAV, isActive, type NavItem } from "@/lib/nav";
import { hasPermission, useMe } from "./SessionContext";
import { withCompany } from "@/lib/format";
import { BrandMark } from "./Brand";

export function Sidebar({
  pendingApprovals,
  devData,
  onNavigate,
}: {
  pendingApprovals: number;
  devData: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const company = useSearchParams().get("company");
  const me = useMe();
  const visible = (item: NavItem) => !item.permission || hasPermission(me, item.permission);
  const href = (h: string) => (h.startsWith("/companies") ? h : withCompany(h, company));

  function Item({ item }: { item: NavItem }) {
    const active =
      isActive(pathname, item.href) || !!item.children?.some((c) => isActive(pathname, c.href));
    const Icon = item.icon;
    return (
      <li>
        <Link
          href={href(item.href)}
          onClick={onNavigate}
          aria-current={active && !item.children ? "page" : undefined}
          className={cn(
            "focus-ring group relative flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-[13px] transition-colors",
            active
              ? "bg-surface-3 font-semibold text-fg"
              : "text-fg-muted hover:bg-surface-2 hover:text-fg",
          )}
        >
          {active && (
            <span
              className="absolute -left-3 top-1.5 h-5 w-[3px] rounded-r-full bg-accent"
              aria-hidden="true"
            />
          )}
          {Icon && (
            <Icon
              className={cn(
                "size-4 shrink-0",
                active ? "text-accent" : "text-fg-faint group-hover:text-fg-muted",
              )}
              aria-hidden="true"
            />
          )}
          <span className="flex-1 truncate">{item.label}</span>
          {item.badge === "approvals" && pendingApprovals > 0 && (
            <span className="num rounded-full bg-violet-500/15 px-1.5 text-[11px] font-semibold text-violet-700 dark:text-violet-300">
              {pendingApprovals}
            </span>
          )}
          {item.stage && (
            <span
              className="font-mono text-[10px] text-fg-faint"
              title={`Planned for build stage ${item.stage}`}
            >
              S{String(item.stage).padStart(2, "0")}
            </span>
          )}
        </Link>
        {item.children && active && (
          <ul className="ml-[18px] mt-0.5 space-y-0.5 border-l border-line pl-3">
            {item.children.filter(visible).map((c) => {
              const childActive = pathname === c.href;
              return (
                <li key={c.href}>
                  <Link
                    href={href(c.href)}
                    onClick={onNavigate}
                    aria-current={childActive ? "page" : undefined}
                    className={cn(
                      "focus-ring flex h-7 items-center rounded-md px-2 text-[12.5px]",
                      childActive ? "font-semibold text-fg" : "text-fg-muted hover:text-fg",
                    )}
                  >
                    {c.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </li>
    );
  }

  return (
    <nav aria-label="Primary" className="flex h-full flex-col">
      <div className="flex h-14 shrink-0 items-center gap-2.5 px-4">
        <BrandMark />
        <div className="leading-tight">
          <p className="text-[13.5px] font-semibold tracking-tight">AI Business OS</p>
          <p className="text-[10.5px] text-fg-faint">Multi-company command</p>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4 pt-2">
        {NAV.filter((group) => group.items.some(visible)).map((group, gi) => (
          <div key={gi} className={cn(gi > 0 && "mt-5")}>
            {group.label && <p className="eyebrow mb-1.5 px-2.5">{group.label}</p>}
            <ul className="space-y-0.5">
              {group.items.filter(visible).map((item) => (
                <Item key={item.href + item.label} item={item} />
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="shrink-0 border-t border-line p-3">
        <div className="rounded-xl bg-surface-2 p-3">
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-semibold">Stage 05 · AI execution</span>
            <span className="font-mono text-[10px] text-fg-faint">v0.5a</span>
          </div>
          <ul className="mt-2 space-y-1 text-[11.5px] text-fg-muted">
            <li className="flex items-center gap-1.5">
              <PlugZap className="size-3.5 text-fg-faint" aria-hidden="true" /> Claude Code
              subscription · no external tools
            </li>
            {devData && (
              <li className="flex items-center gap-1.5 text-amber-700 dark:text-amber-300">
                <FlaskConical className="size-3.5" aria-hidden="true" /> Development seed data
              </li>
            )}
          </ul>
        </div>
      </div>
    </nav>
  );
}
