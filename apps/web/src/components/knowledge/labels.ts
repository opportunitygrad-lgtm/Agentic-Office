import {
  CONFIDENCE_LEVELS,
  FRESHNESS_STATES,
  KNOWLEDGE_SOURCE_LABELS,
  KNOWLEDGE_SOURCE_TYPES,
  KNOWLEDGE_STATUSES,
  KNOWLEDGE_TYPES,
  KNOWLEDGE_TYPE_LABELS,
  SENSITIVITY_LEVELS,
  VERIFICATION_LABELS,
  VERIFICATION_STATUSES,
  titleCase,
  type ExclusionReason,
  type InclusionReason,
} from "@aibos/shared";

export const opts = <T extends string>(values: readonly T[], label: (v: T) => string) =>
  values.map((value) => ({ value, label: label(value) }));

export const TYPE_OPTIONS = opts(KNOWLEDGE_TYPES, (v) => KNOWLEDGE_TYPE_LABELS[v]);
export const SOURCE_OPTIONS = opts(KNOWLEDGE_SOURCE_TYPES, (v) => KNOWLEDGE_SOURCE_LABELS[v]);
export const VERIFICATION_OPTIONS = opts(VERIFICATION_STATUSES, (v) => VERIFICATION_LABELS[v]);
export const STATUS_OPTIONS = opts(KNOWLEDGE_STATUSES, (v) =>
  v === "review" ? "In review" : titleCase(v),
);
export const CONFIDENCE_OPTIONS = opts(CONFIDENCE_LEVELS, titleCase);
export const SENSITIVITY_OPTIONS = opts(SENSITIVITY_LEVELS, titleCase);
export const FRESHNESS_OPTIONS = opts(FRESHNESS_STATES, (v) =>
  v === "review_due"
    ? "Review due"
    : v === "not_yet_effective"
      ? "Not yet effective"
      : titleCase(v),
);

/** Deterministic "why included" wording for the Context Preview. */
export const INCLUSION_LABELS: Record<InclusionReason, string> = {
  critical_rule: "Critical company policy",
  restriction: "Binding restriction",
  task_link: "Explicitly linked to task",
  handoff_link: "Evidence from a handoff",
  agent_link: "Linked to this agent",
  explicit_request: "Explicitly requested",
  required_by_agent: "Required by agent template",
  requested_category: "Requested category",
  matching_department: "Matching department",
  matching_tag: "Matching tag",
  task_type: "Relevant to task type",
  task_keywords: "Matches task wording",
  company_wide_rule: "Company-wide rule",
  global_policy: "Global operating policy",
  agent_channel: "Agent's channel",
  agent_domain: "Agent's area of work",
  unverified_allowed: "Unverified research allowed by task",
};

export const EXCLUSION_LABELS: Record<ExclusionReason, string> = {
  draft: "Draft",
  in_review: "In review",
  archived: "Archived",
  superseded: "Superseded",
  expired: "Expired",
  not_yet_effective: "Not yet effective",
  sensitivity: "Sensitivity",
  other_company: "Other company (blocked)",
  budget: "Dropped for budget",
  not_relevant: "Not relevant",
  inactive_rule: "Inactive / unapproved rule",
};

export const toDateInput = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : "");
export const fromDateInput = (v: string) => (v ? new Date(`${v}T00:00:00Z`).toISOString() : null);
export const shortDate = (iso: string | null | undefined) =>
  iso
    ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
    : "—";
