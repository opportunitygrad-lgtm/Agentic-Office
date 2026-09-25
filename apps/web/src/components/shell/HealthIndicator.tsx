"use client";

import { useEffect, useState } from "react";
import type { HealthState, SystemHealthDTO } from "@aibos/shared";
import { StatusDot, cn, type Tone } from "@aibos/ui";
import { Popover } from "../common/Popover";

const TONE: Record<HealthState, Tone> = {
  ok: "live",
  degraded: "attention",
  down: "danger",
  unknown: "neutral",
  not_configured: "idle",
};
const LABEL: Record<HealthState, string> = {
  ok: "All systems operational",
  degraded: "Degraded",
  down: "Outage",
  unknown: "Unknown",
  not_configured: "Not configured",
};

/** System health: API, PostgreSQL, Redis and worker heartbeat. Polls every 30s. */
export function HealthIndicator({ initial }: { initial: SystemHealthDTO | null }) {
  const [health, setHealth] = useState<SystemHealthDTO | null>(initial);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch("/api/v1/system/health", { cache: "no-store" });
        const data = (await res.json()) as SystemHealthDTO;
        if (alive) setHealth(data);
      } catch {
        if (alive)
          setHealth({
            status: "down",
            checkedAt: new Date().toISOString(),
            services: [{ name: "API", status: "down" }],
          });
      }
    };
    const t = setInterval(load, 30_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const state: HealthState = health?.status ?? "unknown";
  return (
    <Popover
      label={`System health: ${LABEL[state]}`}
      triggerClassName="flex h-9 items-center gap-2 rounded-lg border border-line bg-surface px-2.5 text-[12.5px] font-medium hover:border-line-strong"
      trigger={
        <>
          <StatusDot tone={TONE[state]} pulse={state === "ok"} />
          <span className="hidden sm:inline">{state === "ok" ? "Healthy" : LABEL[state]}</span>
        </>
      }
      panelClassName="w-72 p-3"
    >
      <p className="eyebrow mb-2">System health</p>
      <ul className="space-y-1">
        {(health?.services ?? []).map((s) => (
          <li
            key={s.name}
            className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-[13px] hover:bg-surface-2"
          >
            <span className="flex items-center gap-2">
              <StatusDot tone={TONE[s.status]} />
              {s.name}
            </span>
            <span
              className={cn(
                "text-[12px]",
                s.status === "ok" ? "text-fg-faint" : "font-medium text-fg",
              )}
            >
              {s.detail ?? s.status}
            </span>
          </li>
        ))}
        {!health && <li className="px-2 text-[13px] text-fg-muted">API not reachable.</li>}
      </ul>
      {health && (
        <p className="mt-2 border-t border-line pt-2 text-[11px] text-fg-faint">
          Checked {new Date(health.checkedAt).toLocaleTimeString("en-GB")}
        </p>
      )}
    </Popover>
  );
}
