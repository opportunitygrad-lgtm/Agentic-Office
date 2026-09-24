"use client";

import { useId, useRef, useState, type KeyboardEvent } from "react";
import { MonitorOff } from "lucide-react";
import type { LiveSessionDTO } from "@aibos/shared";
import { AGENT_STATUS_META, EmptyState, StatusDot, cn } from "@aibos/ui";
import { LiveAgentScreen } from "./LiveAgentScreen";

/** Tabbed switcher between (mock) live agent sessions. */
export function LiveSessionSwitcher({ sessions }: { sessions: LiveSessionDTO[] }) {
  const [index, setIndex] = useState(0);
  const tabsRef = useRef<(HTMLButtonElement | null)[]>([]);
  const id = useId();

  if (!sessions.length) {
    return (
      <EmptyState
        icon={<MonitorOff className="size-5" />}
        title="No live sessions"
        description="When agents open browsers or applications, their screens appear here."
      />
    );
  }
  const current = sessions[Math.min(index, sessions.length - 1)]!;

  function onKey(e: KeyboardEvent) {
    const moves: Record<string, number> = {
      ArrowRight: (index + 1) % sessions.length,
      ArrowLeft: (index - 1 + sessions.length) % sessions.length,
      Home: 0,
      End: sessions.length - 1,
    };
    const next = moves[e.key];
    if (next === undefined) return;
    e.preventDefault();
    setIndex(next);
    tabsRef.current[next]?.focus();
  }

  return (
    <div className="min-w-0">
      <div
        role="tablist"
        aria-label="Live agent sessions"
        onKeyDown={onKey}
        className="-mx-1 mb-3 flex gap-1.5 overflow-x-auto px-1 pb-1"
      >
        {sessions.map((s, i) => {
          const meta = AGENT_STATUS_META[s.agent.status];
          const selected = i === index;
          return (
            <button
              key={s.id}
              ref={(el) => {
                tabsRef.current[i] = el;
              }}
              role="tab"
              id={`${id}-tab-${i}`}
              aria-selected={selected}
              aria-controls={`${id}-panel`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setIndex(i)}
              className={cn(
                "focus-ring flex shrink-0 items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left transition-colors",
                selected
                  ? "border-accent bg-accent-soft/60"
                  : "border-line bg-surface hover:border-line-strong",
              )}
            >
              <StatusDot tone={meta.tone} pulse={meta.pulse} />
              <span className="max-w-[180px] truncate text-[12.5px] font-medium">
                {s.agent.name}
              </span>
            </button>
          );
        })}
      </div>
      <div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-tab-${index}`}>
        <LiveAgentScreen key={current.id} session={current} />
      </div>
    </div>
  );
}
