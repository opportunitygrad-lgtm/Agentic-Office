"use client";

import { useSyncExternalStore } from "react";

/* One shared 1s ticker for every clock on the page. */
let now = 0;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | undefined;

function subscribe(cb: () => void) {
  listeners.add(cb);
  if (!timer) {
    now = Date.now();
    timer = setInterval(() => {
      now = Date.now();
      listeners.forEach((l) => l());
    }, 1000);
  }
  return () => {
    listeners.delete(cb);
    if (!listeners.size && timer) {
      clearInterval(timer);
      timer = undefined;
    }
  };
}

/** Live local + UTC clock. Server render shows a placeholder (no hydration mismatch). */
export function Clock() {
  const ts = useSyncExternalStore(
    subscribe,
    () => now || Date.now(),
    () => 0,
  );
  const date = ts ? new Date(ts) : null;
  const local =
    date?.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) ??
    "--:--:--";
  const utc =
    date?.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) ??
    "--:--";
  const day =
    date?.toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short" }) ?? "";
  const tz = date ? Intl.DateTimeFormat().resolvedOptions().timeZone : "";

  return (
    <div className="hidden items-center gap-3 rounded-lg px-2 xl:flex" aria-label="Current time">
      <div className="text-right leading-tight">
        <time
          className="num block font-mono text-[13px] font-medium text-fg"
          dateTime={date?.toISOString()}
        >
          {local}
        </time>
        <span className="block text-[10.5px] text-fg-faint">
          {day} · {tz}
        </span>
      </div>
      <div className="h-7 w-px bg-line" aria-hidden="true" />
      <div className="leading-tight">
        <span className="num block font-mono text-[13px] text-fg-muted">{utc}</span>
        <span className="block text-[10.5px] text-fg-faint">UTC</span>
      </div>
    </div>
  );
}
