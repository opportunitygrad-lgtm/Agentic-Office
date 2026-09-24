"use client";

import { Suspense, useState, type ReactNode } from "react";
import Link from "next/link";
import { BadgeCheck, Menu } from "lucide-react";
import type { ShellDTO, SystemHealthDTO } from "@aibos/shared";
import { Dialog } from "../common/Dialog";
import { AlertsMenu } from "./AlertsMenu";
import { Clock } from "./Clock";
import { CompanySwitcher } from "./CompanySwitcher";
import { HealthIndicator } from "./HealthIndicator";
import { Sidebar } from "./Sidebar";
import { ThemeToggle } from "./ThemeToggle";

export function AppShell({
  shell,
  health,
  children,
}: {
  shell: ShellDTO | null;
  health: SystemHealthDTO | null;
  children: ReactNode;
}) {
  const [navOpen, setNavOpen] = useState(false);
  const pending = shell?.pendingApprovals ?? 0;
  const devData = shell?.containsDevSeedData ?? false;

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[248px_minmax(0,1fr)]">
      <a
        href="#main"
        className="focus-ring sr-only z-[60] rounded-lg bg-accent px-3 py-2 text-white focus:not-sr-only focus:fixed focus:left-3 focus:top-3"
      >
        Skip to content
      </a>

      <aside className="sticky top-0 hidden h-dvh border-r border-line bg-surface lg:block">
        <Suspense>
          <Sidebar pendingApprovals={pending} devData={devData} />
        </Suspense>
      </aside>

      <Dialog
        open={navOpen}
        onClose={() => setNavOpen(false)}
        title="Navigation"
        side="left"
        className="lg:hidden"
      >
        <Suspense>
          <Sidebar
            pendingApprovals={pending}
            devData={devData}
            onNavigate={() => setNavOpen(false)}
          />
        </Suspense>
      </Dialog>

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-40 border-b border-line bg-bg/85 backdrop-blur-md">
          <div className="flex h-14 items-center gap-2 px-3 sm:gap-3 sm:px-6">
            <button
              type="button"
              onClick={() => setNavOpen(true)}
              aria-label="Open navigation"
              className="focus-ring grid size-9 shrink-0 place-items-center rounded-lg border border-line bg-surface text-fg-muted lg:hidden"
            >
              <Menu className="size-4" />
            </button>
            <Suspense
              fallback={<div className="h-9 w-44 rounded-lg border border-line bg-surface" />}
            >
              <CompanySwitcher companies={shell?.companies ?? []} />
            </Suspense>
            <div className="flex-1" />
            <Clock />
            <HealthIndicator initial={health} />
            <AlertsMenu alerts={shell?.alerts ?? []} />
            <Link
              href="/approvals"
              aria-label={`Approvals: ${pending} pending`}
              className="focus-ring hidden h-9 items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 text-[12.5px] font-medium text-fg-muted hover:border-line-strong hover:text-fg sm:flex"
            >
              <BadgeCheck
                className="size-4 text-violet-600 dark:text-violet-400"
                aria-hidden="true"
              />
              <span className="num">{pending}</span>
              <span className="hidden md:inline">pending</span>
            </Link>
            <ThemeToggle />
          </div>
        </header>
        <main
          id="main"
          tabIndex={-1}
          className="min-w-0 flex-1 px-4 pb-16 pt-6 outline-none sm:px-6 xl:px-8"
        >
          {children}
        </main>
      </div>
    </div>
  );
}
