"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Brain,
  Eye,
  Hand,
  Lock,
  Maximize2,
  MessageSquare,
  Minimize2,
  MousePointer2,
  Moon,
  Navigation,
  Pause,
  PenLine,
  RotateCw,
  Square,
  Timer,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import type { LiveSessionDTO } from "@aibos/shared";
import { AGENT_STATUS_META, Button, MockBadge, ProgressBar, StatusPill, cn } from "@aibos/ui";
import { relativeTime } from "@/lib/format";

const KIND_ICON: Record<LiveSessionDTO["timeline"][number]["kind"], LucideIcon> = {
  navigate: Navigation,
  read: Eye,
  write: PenLine,
  think: Brain,
  wait: Timer,
};

const DISABLED_HINT = "Live control arrives with browser workers and human takeover (Stages 29–32)";

function BrowserWireframe() {
  return (
    <div className="absolute inset-0 overflow-hidden p-[5%]">
      <div className="flex items-center justify-between">
        <div className="h-2.5 w-[18%] rounded bg-white/20" />
        <div className="flex gap-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-2 w-8 rounded bg-white/10" />
          ))}
        </div>
      </div>
      <div className="mt-[5%] grid grid-cols-[1.4fr_1fr] gap-[4%]">
        <div className="space-y-2">
          <div className="h-3.5 w-[85%] rounded bg-white/25" />
          <div className="h-3.5 w-[60%] rounded bg-white/25" />
          <div className="mt-3 h-2 w-full rounded bg-white/10" />
          <div className="h-2 w-[92%] rounded bg-white/10" />
          <div className="h-2 w-[70%] rounded bg-white/10" />
          <div className="mt-3 h-6 w-24 rounded-md bg-sky-400/40" />
        </div>
        <div className="aspect-[4/3] rounded-lg bg-gradient-to-br from-white/15 to-white/5" />
      </div>
      <div className="mt-[5%] grid grid-cols-3 gap-[3%]">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className={cn(
              "space-y-1.5 rounded-lg p-2",
              i === 1 ? "bg-emerald-400/15 ring-1 ring-emerald-300/50" : "bg-white/[0.06]",
            )}
          >
            <div className="h-2 w-[70%] rounded bg-white/25" />
            <div className="h-1.5 w-full rounded bg-white/10" />
            <div className="h-1.5 w-[80%] rounded bg-white/10" />
          </div>
        ))}
      </div>
    </div>
  );
}

function AppWireframe() {
  return (
    <div className="absolute inset-0 grid grid-cols-[32%_1fr] overflow-hidden">
      <div className="space-y-2 border-r border-white/10 p-[4%]">
        {[0, 1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className={cn(
              "space-y-1 rounded-md p-1.5",
              i === 1 && "bg-sky-400/20 ring-1 ring-sky-300/40",
            )}
          >
            <div className="h-1.5 w-[60%] rounded bg-white/25" />
            <div className="h-1.5 w-[90%] rounded bg-white/10" />
          </div>
        ))}
      </div>
      <div className="space-y-2 p-[5%]">
        <div className="h-3 w-[55%] rounded bg-white/25" />
        <div className="h-1.5 w-[30%] rounded bg-white/15" />
        <div className="mt-4 space-y-1.5">
          <div className="h-1.5 w-full rounded bg-white/10" />
          <div className="h-1.5 w-[95%] rounded bg-white/10" />
          <div className="h-1.5 w-[80%] rounded bg-white/10" />
        </div>
        <div className="mt-4 space-y-1.5 rounded-md border border-dashed border-emerald-300/40 bg-emerald-400/10 p-2">
          <div className="h-1.5 w-[90%] rounded bg-emerald-200/40" />
          <div className="h-1.5 w-[70%] rounded bg-emerald-200/40" />
          <div className="h-1.5 w-[40%] rounded bg-emerald-200/40" />
        </div>
      </div>
    </div>
  );
}

export function LiveAgentScreen({
  session,
  variant = "full",
}: {
  session: LiveSessionDTO;
  variant?: "full" | "compact";
}) {
  const rootRef = useRef<HTMLElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const meta = AGENT_STATUS_META[session.agent.status];
  const idle = session.surface === "idle";
  const location = session.currentUrl ?? session.applicationName ?? "No active surface";
  const compact = variant === "compact";

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === rootRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  async function toggleFullscreen() {
    const el = rootRef.current;
    if (!el) return;
    if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
    else await el.requestFullscreen?.().catch(() => {});
  }

  return (
    <article
      ref={rootRef}
      aria-label={`Live view: ${session.agent.name}`}
      className={cn(
        "min-w-0 rounded-2xl border border-line bg-surface shadow-panel",
        fullscreen && "overflow-auto p-6",
      )}
    >
      <header
        className={cn(
          "flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line/70",
          compact ? "px-3 py-2.5" : "px-4 py-3 sm:px-5",
        )}
      >
        <span className="inline-flex items-center gap-1.5 rounded-md bg-rose-500/10 px-1.5 py-0.5 text-[10.5px] font-bold uppercase tracking-wider text-rose-600 dark:text-rose-400">
          <span
            className={cn("size-1.5 rounded-full bg-rose-500", !idle && "animate-pulse")}
            aria-hidden="true"
          />
          {idle ? "Offline" : "Live"}
        </span>
        <div className="min-w-0 flex-1">
          <p
            className={cn(
              "truncate font-semibold tracking-tight",
              compact ? "text-[13px]" : "text-[14px]",
            )}
          >
            {session.agent.name}
          </p>
          <p className="truncate text-[11.5px] text-fg-muted">
            {session.company?.name ?? "Group-wide"}
          </p>
        </div>
        <StatusPill tone={meta.tone} label={meta.label} pulse={meta.pulse} />
        {!compact && <MockBadge label="Mock stream" />}
      </header>

      <div
        className={cn(
          "grid gap-4",
          compact ? "p-3" : "p-4 sm:p-5",
          !compact && "xl:grid-cols-[minmax(0,1fr)_240px]",
        )}
      >
        <div className="min-w-0">
          {/* viewport */}
          <div className="overflow-hidden rounded-xl bg-[#0d1117] ring-1 ring-black/20 dark:ring-white/10">
            <div className="flex items-center gap-2 border-b border-white/10 bg-[#161b22] px-2.5 py-1.5 text-white/60">
              <ArrowLeft className="size-3.5 shrink-0" aria-hidden="true" />
              <ArrowRight className="size-3.5 shrink-0" aria-hidden="true" />
              <RotateCw className="size-3.5 shrink-0" aria-hidden="true" />
              <div className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md bg-black/30 px-2 py-1">
                {session.currentUrl && (
                  <Lock className="size-3 shrink-0 text-emerald-400/80" aria-hidden="true" />
                )}
                <span
                  className="truncate font-mono text-[11px] text-white/75"
                  data-testid="live-location"
                >
                  {location}
                </span>
              </div>
            </div>
            <div className="relative aspect-video">
              {idle ? (
                <div className="dot-grid absolute inset-0 grid place-items-center text-center">
                  <div>
                    <Moon className="mx-auto size-7 text-white/30" aria-hidden="true" />
                    <p className="mt-2 text-[13px] font-medium text-white/70">Agent is sleeping</p>
                    <p className="text-[11.5px] text-white/40">
                      Session opens when work is assigned
                    </p>
                  </div>
                </div>
              ) : (
                <>
                  {session.surface === "application" ? <AppWireframe /> : <BrowserWireframe />}
                  <div
                    className="pointer-events-none absolute inset-x-[5%] top-[18%] h-10 animate-scan rounded-md bg-gradient-to-b from-sky-400/0 via-sky-400/15 to-sky-400/0"
                    style={{ ["--scan-distance" as string]: "140%" }}
                    aria-hidden="true"
                  />
                  <div
                    className="pointer-events-none absolute inset-0 animate-cursor"
                    aria-hidden="true"
                  >
                    <MousePointer2 className="size-4 fill-white text-black drop-shadow" />
                  </div>
                  {session.currentAction && (
                    <div className="absolute inset-x-2 bottom-2 flex items-center gap-2 rounded-lg bg-black/65 px-2.5 py-1.5 backdrop-blur-sm sm:inset-x-3 sm:bottom-3">
                      <span
                        className="size-1.5 shrink-0 animate-pulse rounded-full bg-emerald-400"
                        aria-hidden="true"
                      />
                      <p className="truncate text-[11.5px] text-white/90">
                        {session.currentAction}
                      </p>
                    </div>
                  )}
                </>
              )}
              <span className="absolute right-2 top-2 rounded bg-black/55 px-1.5 py-0.5 font-mono text-[9.5px] uppercase tracking-wider text-white/60">
                Preview · Stage 31
              </span>
            </div>
          </div>

          {/* status strip */}
          <div className={cn("mt-3 grid gap-3", !compact && "sm:grid-cols-[minmax(0,1fr)_auto]")}>
            <div className="min-w-0">
              <div className="flex items-baseline justify-between gap-2 text-[12px]">
                <p className="truncate font-medium">{session.task?.title ?? "No task assigned"}</p>
                {session.task && (
                  <span className="num shrink-0 text-fg-muted">{session.task.progress}%</span>
                )}
              </div>
              <ProgressBar
                className="mt-1.5"
                value={session.task?.progress ?? 0}
                tone={idle ? "idle" : meta.tone}
                animated={session.agent.status === "working"}
                label="Task progress"
              />
            </div>
            <dl className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px]">
              <div className="flex gap-1">
                <dt className="text-fg-faint">Tool</dt>
                <dd className="font-medium">{session.currentTool ?? "—"}</dd>
              </div>
              <div className="flex gap-1">
                <dt className="text-fg-faint">Last frame</dt>
                <dd className="font-medium" suppressHydrationWarning>
                  {session.lastFrameAt ? relativeTime(session.lastFrameAt) : "—"}
                </dd>
              </div>
            </dl>
          </div>

          {!compact && (
            <div
              className="mt-4 flex flex-wrap gap-2 border-t border-line/70 pt-4"
              role="toolbar"
              aria-label="Session controls"
            >
              <Button
                size="sm"
                icon={<Pause className="size-3.5" />}
                disabled
                title={DISABLED_HINT}
              >
                Pause
              </Button>
              <Button
                size="sm"
                icon={<Square className="size-3.5" />}
                disabled
                title={DISABLED_HINT}
              >
                Stop
              </Button>
              <Button
                size="sm"
                icon={<MessageSquare className="size-3.5" />}
                disabled
                title={DISABLED_HINT}
              >
                Message agent
              </Button>
              <Button size="sm" icon={<Hand className="size-3.5" />} disabled title={DISABLED_HINT}>
                Take control
              </Button>
              <Button
                size="sm"
                icon={<Undo2 className="size-3.5" />}
                disabled
                title={DISABLED_HINT}
              >
                Return control
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="ml-auto"
                icon={
                  fullscreen ? (
                    <Minimize2 className="size-3.5" />
                  ) : (
                    <Maximize2 className="size-3.5" />
                  )
                }
                onClick={toggleFullscreen}
              >
                {fullscreen ? "Exit full screen" : "Full screen"}
              </Button>
            </div>
          )}
        </div>

        {!compact && (
          <section aria-label="Action timeline" className="min-w-0">
            <p className="eyebrow mb-2">Action timeline</p>
            {session.timeline.length === 0 ? (
              <p className="text-[12.5px] text-fg-faint">No actions recorded.</p>
            ) : (
              <ol className="space-y-2.5">
                {[...session.timeline].reverse().map((step, i) => {
                  const Icon = KIND_ICON[step.kind];
                  return (
                    <li key={`${step.at}-${i}`} className="flex gap-2.5">
                      <span
                        className={cn(
                          "mt-0.5 grid size-6 shrink-0 place-items-center rounded-md",
                          i === 0 ? "bg-accent-soft text-accent" : "bg-surface-2 text-fg-faint",
                        )}
                        aria-hidden="true"
                      >
                        <Icon className="size-3.5" />
                      </span>
                      <div className="min-w-0">
                        <p
                          className={cn(
                            "text-[12.5px] leading-snug",
                            i === 0 ? "font-medium" : "text-fg-muted",
                          )}
                        >
                          {step.label}
                        </p>
                        <p
                          className="num font-mono text-[10.5px] text-fg-faint"
                          suppressHydrationWarning
                        >
                          {new Date(step.at).toLocaleTimeString("en-GB")}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </section>
        )}
      </div>
    </article>
  );
}
