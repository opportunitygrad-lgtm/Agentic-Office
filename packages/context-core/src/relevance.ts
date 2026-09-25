import type { AgentKnowledgeProfile } from "@aibos/agent-core";
import type { InclusionReason, KnowledgeType, TaskType } from "@aibos/shared";
import type { KnowledgeCandidate } from "./types";

/** Knowledge types that typically matter for each task type. */
export const TASK_TYPE_KNOWLEDGE: Record<TaskType, KnowledgeType[]> = {
  management: ["policy", "company_fact", "sop", "financial"],
  research: ["market_research", "competitor", "partnership", "company_fact"],
  verification: ["company_fact", "compliance", "legal", "partnership"],
  email: [
    "communication_rule",
    "email_template",
    "customer_guidance",
    "faq",
    "contact",
    "pricing",
    "partnership",
  ],
  marketing: ["marketing", "brand_rule", "market_research", "competitor", "pricing"],
  advertising: ["marketing", "brand_rule", "pricing", "competitor", "market_research"],
  analysis: ["market_research", "financial", "marketing"],
  technical: ["technical", "sop", "website"],
  website: ["website", "technical", "brand_rule"],
  sales: ["sales", "pricing", "service", "product", "faq", "customer_guidance"],
  review: ["legal", "compliance", "policy"],
  custom: ["company_fact"],
};

const COMPANY_WIDE_TYPES: readonly KnowledgeType[] = ["policy", "compliance", "communication_rule"];

const STOP_WORDS = new Set(
  "a an and are as at be by for from has in into is it of on or our that the their this to with we you your draft prepare review reply build".split(
    " ",
  ),
);

/** Lower-cased significant words (≥ 4 chars, no stop words). */
export function keywords(text: string | null | undefined): Set<string> {
  const out = new Set<string>();
  for (const w of (text ?? "").toLowerCase().split(/[^a-z0-9]+/)) {
    if (w.length >= 4 && !STOP_WORDS.has(w)) out.add(w);
  }
  return out;
}

export interface RelevanceSignals {
  profile: AgentKnowledgeProfile;
  agentDepartmentId: string | null;
  taskType: TaskType | null;
  taskKeywords: ReadonlySet<string>;
  requestedCategories: readonly KnowledgeType[];
  taskLinked: ReadonlySet<string>;
  agentLinked: ReadonlySet<string>;
  explicitIds: ReadonlySet<string>;
  /** Knowledge referenced by handoffs to this agent (reuse prior research). */
  handoffLinked?: ReadonlySet<string>;
}

export interface RelevanceResult {
  score: number;
  reasons: InclusionReason[];
  details: string[];
  /** Explicit links/requests bypass the relevance threshold. */
  explicit: boolean;
}

/** Items below this score (and not explicitly linked) are "not relevant". */
export const RELEVANCE_THRESHOLD = 15;

/**
 * Deterministic relevance — company, department, type, tags, task type,
 * explicit links. No embeddings, no model calls; every point has a reason.
 */
export function scoreKnowledge(item: KnowledgeCandidate, s: RelevanceSignals): RelevanceResult {
  let score = 0;
  const reasons: InclusionReason[] = [];
  const details: string[] = [];
  const add = (points: number, reason: InclusionReason, detail: string) => {
    score += points;
    if (!reasons.includes(reason)) reasons.push(reason);
    details.push(detail);
  };

  if (s.taskLinked.has(item.id)) add(100, "task_link", "Explicitly linked to this task");
  if (s.explicitIds.has(item.id)) add(100, "explicit_request", "Explicitly requested");
  if (s.agentLinked.has(item.id)) add(80, "agent_link", "Linked to this agent");
  if (s.handoffLinked?.has(item.id))
    add(100, "handoff_link", "Evidence in a handoff to this agent");
  if (s.profile.requiredTypes.includes(item.type))
    add(40, "required_by_agent", `Required knowledge type for this agent (${item.type})`);
  if (s.requestedCategories.includes(item.type))
    add(30, "requested_category", `Requested category (${item.type})`);
  if (item.departmentId && item.departmentId === s.agentDepartmentId)
    add(20, "matching_department", "Matches the agent's department");

  const tagHits = item.tags.filter(
    (t) => s.profile.preferredTags.includes(t) || s.taskKeywords.has(t),
  );
  if (tagHits.length)
    add(Math.min(30, tagHits.length * 10), "matching_tag", `Matching tag: ${tagHits.join(", ")}`);

  if (s.taskType && TASK_TYPE_KNOWLEDGE[s.taskType].includes(item.type))
    add(15, "task_type", `Relevant to ${s.taskType} tasks`);

  if (s.taskKeywords.size) {
    const words = keywords(`${item.title} ${item.summary ?? ""} ${item.category ?? ""}`);
    const hits = [...words].filter((w) => s.taskKeywords.has(w));
    if (hits.length)
      add(
        Math.min(20, hits.length * 5),
        "task_keywords",
        `Matches task wording: ${hits.slice(0, 4).join(", ")}`,
      );
  }

  if (item.scope === "global" && COMPANY_WIDE_TYPES.includes(item.type))
    add(15, "global_policy", "Global operating policy");
  else if (COMPANY_WIDE_TYPES.includes(item.type))
    add(10, "company_wide_rule", "Company-wide rule");

  const explicit =
    s.taskLinked.has(item.id) || s.explicitIds.has(item.id) || s.agentLinked.has(item.id);
  return { score, reasons, details, explicit };
}
