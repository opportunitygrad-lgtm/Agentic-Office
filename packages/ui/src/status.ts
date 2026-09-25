import type { AgentStatus, ApprovalStatus, RiskLevel, TaskStatus } from "@aibos/shared";

/**
 * Semantic status tones. Status colours are reserved for state and are never
 * reused as chart series colours. Every status also ships with a text label.
 */
export type Tone =
  "live" | "attention" | "approval" | "danger" | "idle" | "info" | "done" | "neutral";

export const TONE_CLASSES: Record<Tone, { dot: string; pill: string; text: string; bar: string }> =
  {
    live: {
      dot: "bg-emerald-500",
      pill: "bg-emerald-500/10 text-emerald-700 ring-emerald-600/20 dark:text-emerald-300 dark:ring-emerald-400/25",
      text: "text-emerald-700 dark:text-emerald-300",
      bar: "bg-emerald-500",
    },
    attention: {
      dot: "bg-amber-500",
      pill: "bg-amber-500/10 text-amber-800 ring-amber-600/25 dark:text-amber-300 dark:ring-amber-400/25",
      text: "text-amber-700 dark:text-amber-300",
      bar: "bg-amber-500",
    },
    approval: {
      dot: "bg-violet-500",
      pill: "bg-violet-500/10 text-violet-700 ring-violet-600/20 dark:text-violet-300 dark:ring-violet-400/25",
      text: "text-violet-700 dark:text-violet-300",
      bar: "bg-violet-500",
    },
    danger: {
      dot: "bg-rose-500",
      pill: "bg-rose-500/10 text-rose-700 ring-rose-600/20 dark:text-rose-300 dark:ring-rose-400/25",
      text: "text-rose-700 dark:text-rose-300",
      bar: "bg-rose-500",
    },
    idle: {
      dot: "bg-slate-400 dark:bg-slate-500",
      pill: "bg-slate-500/10 text-slate-600 ring-slate-500/20 dark:text-slate-300 dark:ring-slate-400/20",
      text: "text-slate-600 dark:text-slate-400",
      bar: "bg-slate-400",
    },
    info: {
      dot: "bg-sky-500",
      pill: "bg-sky-500/10 text-sky-700 ring-sky-600/20 dark:text-sky-300 dark:ring-sky-400/25",
      text: "text-sky-700 dark:text-sky-300",
      bar: "bg-sky-500",
    },
    done: {
      dot: "bg-teal-500",
      pill: "bg-teal-500/10 text-teal-700 ring-teal-600/20 dark:text-teal-300 dark:ring-teal-400/25",
      text: "text-teal-700 dark:text-teal-300",
      bar: "bg-teal-500",
    },
    neutral: {
      dot: "bg-zinc-400",
      pill: "bg-zinc-500/10 text-zinc-600 ring-zinc-500/20 dark:text-zinc-300 dark:ring-zinc-400/20",
      text: "text-zinc-600 dark:text-zinc-400",
      bar: "bg-zinc-400",
    },
  };

export const AGENT_STATUS_META: Record<
  AgentStatus,
  { label: string; tone: Tone; pulse?: boolean }
> = {
  working: { label: "Working", tone: "live", pulse: true },
  queued: { label: "Queued", tone: "info" },
  waiting: { label: "Waiting", tone: "attention" },
  blocked: { label: "Blocked", tone: "danger" },
  needs_approval: { label: "Needs approval", tone: "approval", pulse: true },
  paused: { label: "Paused", tone: "neutral" },
  failed: { label: "Error", tone: "danger" },
  sleeping: { label: "Sleeping", tone: "idle" },
  completed: { label: "Completed", tone: "done" },
  offline: { label: "Offline", tone: "neutral" },
  expired: { label: "Expired", tone: "idle" },
  terminated: { label: "Terminated", tone: "neutral" },
};

export const TASK_STATUS_META: Record<TaskStatus, { label: string; tone: Tone; pulse?: boolean }> =
  {
    queued: { label: "Queued", tone: "idle" },
    assigned: { label: "Assigned", tone: "info" },
    running: { label: "Running", tone: "live", pulse: true },
    waiting: { label: "Waiting", tone: "attention" },
    needs_approval: { label: "Needs approval", tone: "approval", pulse: true },
    paused: { label: "Paused", tone: "neutral" },
    completed: { label: "Completed", tone: "done" },
    failed: { label: "Failed", tone: "danger" },
    cancelled: { label: "Cancelled", tone: "neutral" },
  };

export const APPROVAL_STATUS_META: Record<ApprovalStatus, { label: string; tone: Tone }> = {
  pending: { label: "Pending", tone: "approval" },
  approved: { label: "Approved", tone: "done" },
  rejected: { label: "Rejected", tone: "danger" },
  expired: { label: "Expired", tone: "neutral" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

export const RISK_META: Record<RiskLevel, { label: string; tone: Tone }> = {
  low: { label: "Low risk", tone: "info" },
  medium: { label: "Medium risk", tone: "attention" },
  high: { label: "High risk", tone: "danger" },
  critical: { label: "Critical", tone: "danger" },
};
