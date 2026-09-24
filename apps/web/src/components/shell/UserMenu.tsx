"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Crown, LogOut, Settings, UserCog } from "lucide-react";
import { cn } from "@aibos/ui";
import { Popover } from "../common/Popover";
import { hasPermission, useMe } from "./SessionContext";

export function initials(name: string): string {
  return name
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}

export function Avatar({
  name,
  owner,
  size = "md",
}: {
  name: string;
  owner?: boolean;
  size?: "sm" | "md";
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid shrink-0 place-items-center rounded-full font-semibold text-white",
        size === "sm" ? "size-7 text-[11px]" : "size-9 text-[12px]",
        owner
          ? "bg-gradient-to-br from-amber-500 to-orange-600 ring-2 ring-amber-400/40"
          : "bg-gradient-to-br from-slate-500 to-slate-700",
      )}
    >
      {initials(name)}
    </span>
  );
}

export function UserMenu() {
  const me = useMe();
  const router = useRouter();
  const [pending, setPending] = useState(false);
  if (!me) return null;
  const primaryRole = me.isPlatformOwner
    ? "Platform Owner"
    : (me.user.memberships.find((m) => m.status === "active")?.role.name ?? "Member");

  async function logout() {
    setPending(true);
    try {
      await fetch("/api/v1/auth/logout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
    } finally {
      router.replace("/login");
      router.refresh();
    }
  }

  return (
    <Popover
      label={`Account menu for ${me.user.displayName}`}
      haspopup="menu"
      triggerClassName="flex h-9 items-center gap-2 rounded-lg pl-1 pr-2 hover:bg-surface-2"
      trigger={
        <>
          <Avatar name={me.user.displayName} owner={me.isPlatformOwner} size="sm" />
          <span className="hidden max-w-[140px] text-left leading-tight lg:block">
            <span className="block truncate text-[12.5px] font-semibold">
              {me.user.displayName}
            </span>
            <span className="block truncate text-[10.5px] text-fg-faint">{primaryRole}</span>
          </span>
        </>
      }
      panelClassName="w-72 p-2"
    >
      {(close) => (
        <div>
          <div className="flex items-center gap-3 px-2 py-2">
            <Avatar name={me.user.displayName} owner={me.isPlatformOwner} />
            <div className="min-w-0">
              <p className="truncate text-[13px] font-semibold">{me.user.displayName}</p>
              <p className="truncate text-[12px] text-fg-muted">{me.user.email}</p>
            </div>
          </div>
          {me.isPlatformOwner && (
            <p className="mx-2 mb-1 inline-flex items-center gap-1 rounded-md bg-amber-500/10 px-2 py-0.5 text-[11px] font-semibold text-amber-700 dark:text-amber-300">
              <Crown className="size-3" aria-hidden="true" /> Platform Owner · all companies
            </p>
          )}
          <div className="my-1.5 border-t border-line" />
          {hasPermission(me, "user.view") && (
            <Link
              href="/settings/users"
              onClick={close}
              className="focus-ring flex items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] hover:bg-surface-2"
            >
              <UserCog className="size-4 text-fg-faint" aria-hidden="true" /> Users & Access
            </Link>
          )}
          <Link
            href="/settings"
            onClick={close}
            className="focus-ring flex items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] hover:bg-surface-2"
          >
            <Settings className="size-4 text-fg-faint" aria-hidden="true" /> Settings
          </Link>
          <button
            type="button"
            onClick={logout}
            disabled={pending}
            className="focus-ring flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] text-rose-600 hover:bg-rose-500/10 dark:text-rose-400"
          >
            <LogOut className="size-4" aria-hidden="true" /> {pending ? "Signing out…" : "Sign out"}
          </button>
        </div>
      )}
    </Popover>
  );
}
