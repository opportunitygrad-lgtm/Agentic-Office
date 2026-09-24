import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";
import { cn } from "./cn";
import { TONE_CLASSES, type Tone } from "./status";

/* ---------- Button ---------- */

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-accent text-white shadow-sm hover:bg-accent-strong disabled:bg-accent/50",
  secondary:
    "bg-surface text-fg ring-1 ring-inset ring-line hover:bg-surface-2 hover:ring-line-strong",
  ghost: "text-fg-muted hover:bg-surface-2 hover:text-fg",
  danger: "bg-rose-600 text-white hover:bg-rose-700",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
}

export function Button({
  variant = "secondary",
  size = "md",
  icon,
  className,
  children,
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        "focus-ring inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-55",
        size === "sm" ? "h-8 px-2.5 text-[13px]" : "h-9 px-3.5 text-sm",
        VARIANTS[variant],
        className,
      )}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
}

/* ---------- Status ---------- */

export function StatusDot({
  tone,
  pulse,
  className,
}: {
  tone: Tone;
  pulse?: boolean;
  className?: string;
}) {
  return (
    <span className={cn("relative inline-flex size-2 shrink-0", className)} aria-hidden="true">
      {pulse && (
        <span
          className={cn(
            "absolute inset-0 rounded-full opacity-60 animate-soft-ping",
            TONE_CLASSES[tone].dot,
          )}
        />
      )}
      <span className={cn("relative inline-flex size-2 rounded-full", TONE_CLASSES[tone].dot)} />
    </span>
  );
}

export function StatusPill({
  tone,
  label,
  pulse,
  className,
}: {
  tone: Tone;
  label: string;
  pulse?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[11.5px] font-medium ring-1 ring-inset",
        TONE_CLASSES[tone].pill,
        className,
      )}
    >
      <StatusDot tone={tone} pulse={pulse} />
      {label}
    </span>
  );
}

export function Badge({ children, className, ...rest }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-md bg-surface-3 px-1.5 py-0.5 text-[11px] font-medium text-fg-muted",
        className,
      )}
      {...rest}
    >
      {children}
    </span>
  );
}

/** Marks development / mock data so it is never mistaken for live operations. */
export function MockBadge({
  label = "Mock data",
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border border-dashed border-amber-500/50 px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-300",
        className,
      )}
      title="Development data — not live activity"
    >
      {label}
    </span>
  );
}

/* ---------- Progress ---------- */

export function ProgressBar({
  value,
  tone = "info",
  animated,
  label,
  className,
}: {
  value: number;
  tone?: Tone;
  animated?: boolean;
  label: string;
  className?: string;
}) {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={v}
      aria-label={label}
      className={cn("relative h-1.5 w-full overflow-hidden rounded-full bg-surface-3", className)}
    >
      <div
        className={cn(
          "h-full rounded-full transition-[width] duration-700 ease-out",
          TONE_CLASSES[tone].bar,
          animated && "progress-sheen",
        )}
        style={{ width: `${v}%` }}
      />
    </div>
  );
}

export function ProgressRing({
  value,
  size = 44,
  stroke = 4,
  label,
  children,
  colorClass = "text-accent",
}: {
  value: number;
  size?: number;
  stroke?: number;
  label: string;
  children?: ReactNode;
  colorClass?: string;
}) {
  const v = Math.max(0, Math.min(100, value));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div
      className="relative inline-grid place-items-center"
      style={{ width: size, height: size }}
      role="img"
      aria-label={label}
    >
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          className="stroke-surface-3"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c - (v / 100) * c}
          className={cn("stroke-current transition-[stroke-dashoffset] duration-700", colorClass)}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center">{children}</div>
    </div>
  );
}

/* ---------- Layout ---------- */

export function Panel({
  title,
  eyebrow,
  actions,
  children,
  className,
  bodyClassName,
  id,
}: {
  title?: ReactNode;
  eyebrow?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  id?: string;
}) {
  const headingId = id ? `${id}-title` : undefined;
  return (
    <section
      id={id}
      aria-labelledby={title ? headingId : undefined}
      className={cn("min-w-0 rounded-2xl border border-line bg-surface shadow-panel", className)}
    >
      {(title || actions) && (
        <header className="flex min-w-0 items-center justify-between gap-3 border-b border-line/70 px-4 py-3 sm:px-5">
          <div className="min-w-0">
            {eyebrow && <p className="eyebrow mb-0.5">{eyebrow}</p>}
            {title && (
              <h2
                id={headingId}
                className="truncate text-[14px] font-semibold tracking-tight text-fg"
              >
                {title}
              </h2>
            )}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={cn("p-4 sm:p-5", bodyClassName)}>{children}</div>
    </section>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn("skeleton rounded-md", className)} />;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-line px-6 py-10 text-center",
        className,
      )}
    >
      {icon && (
        <div className="mb-1 grid size-10 place-items-center rounded-xl bg-surface-2 text-fg-faint">
          {icon}
        </div>
      )}
      <p className="text-sm font-medium text-fg">{title}</p>
      {description && <p className="max-w-sm text-[13px] text-fg-muted">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

/** Company monogram tile using the company's accent colour. */
export function Monogram({
  name,
  color,
  size = "md",
}: {
  name: string;
  color?: string | null;
  size?: "sm" | "md" | "lg";
}) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
  const dims =
    size === "sm"
      ? "size-6 text-[10px] rounded-md"
      : size === "lg"
        ? "size-11 text-sm rounded-xl"
        : "size-8 text-[11px] rounded-lg";
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-grid shrink-0 place-items-center font-semibold text-white shadow-sm",
        dims,
      )}
      style={{ background: color ?? "#64748b" }}
    >
      {initials}
    </span>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border border-line bg-surface-2 px-1 font-mono text-[10.5px] text-fg-muted">
      {children}
    </kbd>
  );
}
