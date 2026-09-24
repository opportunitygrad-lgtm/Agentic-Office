"use client";

import { useId, useState, type InputHTMLAttributes, type ReactNode } from "react";
import { Eye, EyeOff } from "lucide-react";
import { cn } from "@aibos/ui";

export function AuthHeading({ title, subtitle }: { title: string; subtitle?: ReactNode }) {
  return (
    <div className="mb-7">
      <h1 className="text-[24px] font-semibold tracking-tight">{title}</h1>
      {subtitle && <p className="mt-1.5 text-[13.5px] text-fg-muted">{subtitle}</p>}
    </div>
  );
}

export function AuthField({
  label,
  error,
  hint,
  type = "text",
  trailing,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  error?: string;
  hint?: string;
  trailing?: ReactNode;
}) {
  const id = useId();
  const [show, setShow] = useState(false);
  const isPassword = type === "password";
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between">
        <label htmlFor={id} className="text-[12.5px] font-medium">
          {label}
        </label>
        {trailing}
      </div>
      <div className="relative">
        <input
          id={id}
          type={isPassword && show ? "text" : type}
          aria-invalid={!!error}
          aria-describedby={error ? `${id}-err` : hint ? `${id}-hint` : undefined}
          className={cn(
            "h-11 w-full rounded-xl border border-line bg-surface px-3.5 text-[14px] text-fg placeholder:text-fg-faint transition-colors hover:border-line-strong focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25",
            isPassword && "pr-11",
            error && "border-rose-500",
          )}
          {...rest}
        />
        {isPassword && (
          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            aria-label={show ? "Hide password" : "Show password"}
            className="focus-ring absolute right-1.5 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-lg text-fg-faint hover:text-fg"
          >
            {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        )}
      </div>
      {error ? (
        <p
          id={`${id}-err`}
          role="alert"
          className="mt-1.5 text-[12px] font-medium text-rose-600 dark:text-rose-400"
        >
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="mt-1.5 text-[12px] text-fg-faint">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function FormAlert({
  tone = "error",
  children,
}: {
  tone?: "error" | "info" | "success";
  children: ReactNode;
}) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "rounded-xl border px-3.5 py-2.5 text-[13px]",
        tone === "error" && "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300",
        tone === "info" && "border-sky-500/30 bg-sky-500/10 text-sky-800 dark:text-sky-300",
        tone === "success" &&
          "border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300",
      )}
    >
      {children}
    </div>
  );
}

/** Length-based strength hint (matches the server policy: ≥12 characters). */
export function PasswordStrength({ value }: { value: string }) {
  const score =
    value.length >= 20
      ? 4
      : value.length >= 16
        ? 3
        : value.length >= 12
          ? 2
          : value.length > 0
            ? 1
            : 0;
  const labels = ["", "Too short", "Acceptable", "Strong", "Very strong"];
  return (
    <div className="mt-2" aria-live="polite">
      <div className="flex gap-1" aria-hidden="true">
        {[1, 2, 3, 4].map((i) => (
          <span
            key={i}
            className={cn(
              "h-1 flex-1 rounded-full",
              i <= score
                ? score === 1
                  ? "bg-rose-500"
                  : score === 2
                    ? "bg-amber-500"
                    : "bg-emerald-500"
                : "bg-surface-3",
            )}
          />
        ))}
      </div>
      {score > 0 && <p className="mt-1 text-[11.5px] text-fg-faint">{labels[score]}</p>}
    </div>
  );
}

/** Only allow same-site relative redirects after sign-in (no open redirects). */
export function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return "/";
  return next;
}
