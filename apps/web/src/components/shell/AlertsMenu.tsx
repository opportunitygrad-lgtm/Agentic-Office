"use client";

import Link from "next/link";
import { AlertTriangle, Bell, CircleAlert, Info } from "lucide-react";
import type { AlertDTO } from "@aibos/shared";
import { cn } from "@aibos/ui";
import { Popover } from "../common/Popover";

const ICON = { critical: CircleAlert, warning: AlertTriangle, info: Info };
const COLOR = {
  critical: "text-rose-600 dark:text-rose-400",
  warning: "text-amber-600 dark:text-amber-400",
  info: "text-sky-600 dark:text-sky-400",
};

export function AlertsMenu({ alerts }: { alerts: AlertDTO[] }) {
  const critical = alerts.filter((a) => a.severity === "critical").length;
  return (
    <Popover
      label={`Alerts: ${alerts.length}`}
      triggerClassName="relative grid size-9 place-items-center rounded-lg border border-line bg-surface text-fg-muted hover:border-line-strong hover:text-fg"
      trigger={
        <>
          <Bell className="size-4" />
          {alerts.length > 0 && (
            <span
              className={cn(
                "num absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full px-1 text-[10px] font-semibold text-white ring-2 ring-bg",
                critical ? "bg-rose-600" : "bg-amber-500",
              )}
            >
              {alerts.length}
            </span>
          )}
        </>
      }
      panelClassName="w-[min(360px,calc(100vw-2rem))] p-2"
    >
      {(close) => (
        <>
          <p className="eyebrow px-2 pb-1.5 pt-1">Alerts</p>
          {alerts.length === 0 ? (
            <p className="px-2 pb-2 text-[13px] text-fg-muted">No active alerts.</p>
          ) : (
            <ul className="max-h-96 space-y-0.5 overflow-y-auto">
              {alerts.map((a) => {
                const Icon = ICON[a.severity];
                return (
                  <li key={a.id}>
                    <Link
                      href={a.href ?? "/"}
                      onClick={close}
                      className="focus-ring flex gap-2.5 rounded-lg px-2 py-2 hover:bg-surface-2"
                    >
                      <Icon
                        className={cn("mt-0.5 size-4 shrink-0", COLOR[a.severity])}
                        aria-hidden="true"
                      />
                      <span className="min-w-0">
                        <span className="block text-[13px] font-medium leading-snug">
                          {a.title}
                        </span>
                        <span className="block truncate text-[12px] text-fg-muted">
                          {a.company ? `${a.company.name} · ` : ""}
                          {a.detail}
                        </span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </Popover>
  );
}
