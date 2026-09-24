"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@aibos/ui";

/**
 * Accessible modal built on the native <dialog> element (focus trapping,
 * Escape handling and inert background are provided by the platform).
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  className,
  side,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
  side?: "left" | "right";
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-label={title}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className={cn(
        "m-auto max-h-[calc(100dvh-2rem)] w-[min(640px,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-line bg-surface p-0 text-fg shadow-2xl",
        side === "left" && "ml-0 h-dvh max-h-dvh w-[min(300px,85vw)] rounded-none rounded-r-2xl",
        side === "right" && "mr-0 h-dvh max-h-dvh w-[min(560px,100vw)] rounded-none rounded-l-2xl",
        className,
      )}
    >
      {open && (
        <div className="flex h-full max-h-[inherit] flex-col">
          <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
            <div className="min-w-0">
              <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
              {description && <p className="mt-0.5 text-[13px] text-fg-muted">{description}</p>}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="focus-ring -mr-1 grid size-8 place-items-center rounded-lg text-fg-muted hover:bg-surface-2 hover:text-fg"
            >
              <X className="size-4" />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        </div>
      )}
    </dialog>
  );
}
