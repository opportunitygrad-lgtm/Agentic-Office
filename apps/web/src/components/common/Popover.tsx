"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { cn } from "@aibos/ui";

/**
 * Disclosure popover: toggles a panel, closes on Escape / outside click and
 * returns focus to the trigger. Used for alerts, health and company menus.
 */
export function Popover({
  label,
  trigger,
  children,
  align = "end",
  panelClassName,
  triggerClassName,
  haspopup = "dialog",
}: {
  label: string;
  trigger: ReactNode | ((open: boolean) => ReactNode);
  children: ReactNode | ((close: () => void) => ReactNode);
  align?: "start" | "end";
  panelClassName?: string;
  triggerClassName?: string;
  haspopup?: "dialog" | "listbox" | "menu";
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const triggerId = useId();
  const close = () => {
    setOpen(false);
    document.getElementById(triggerId)?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        id={triggerId}
        type="button"
        aria-label={label}
        aria-haspopup={haspopup}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((o) => !o)}
        className={cn("focus-ring", triggerClassName)}
      >
        {typeof trigger === "function" ? trigger(open) : trigger}
      </button>
      {open && (
        <div
          id={panelId}
          className={cn(
            "absolute top-[calc(100%+8px)] z-50 animate-fade-up rounded-xl border border-line bg-surface shadow-xl shadow-black/10",
            align === "end" ? "right-0" : "left-0",
            panelClassName,
          )}
        >
          {typeof children === "function" ? children(close) : children}
        </div>
      )}
    </div>
  );
}
