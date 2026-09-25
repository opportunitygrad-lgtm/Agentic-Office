import type {
  DuplicateLevel,
  DuplicateMatch,
  DuplicateResult,
  TaskStatus,
  TaskType,
} from "@aibos/shared";

/** Deterministic duplicate-task detection. No embeddings. */

const STOP = new Set(
  "a an and are as at be by for from in into is it of on or our that the their this to with we you your please new all any".split(
    " ",
  ),
);

/** Lower-case significant words, de-duplicated and sorted. */
export function normalizeObjective(text: string): string {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP.has(w))
    // crude singularisation so "schools" == "school"
    .map((w) => (w.length > 4 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w));
  return [...new Set(words)].sort().join(" ");
}

export function similarity(a: string, b: string): number {
  const A = new Set(a.split(" ").filter(Boolean));
  const B = new Set(b.split(" ").filter(Boolean));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / (A.size + B.size - inter);
}

export interface DuplicateCandidateTask {
  id: string;
  title: string;
  description: string | null;
  companyId: string | null;
  type: TaskType;
  status: TaskStatus;
  targetEntity: string | null;
  departmentId: string | null;
}

export interface DuplicateQuery {
  id?: string | null;
  companyId: string;
  title: string;
  description?: string | null;
  type: TaskType;
  targetEntity?: string | null;
  departmentId?: string | null;
  /** Task ids to ignore (the task itself, its tree). */
  ignoreIds?: readonly string[];
}

const ACTIVE: readonly TaskStatus[] = [
  "queued",
  "assigned",
  "running",
  "waiting",
  "needs_approval",
  "paused",
];

export const DUPLICATE_THRESHOLDS = { likely: 0.6, related: 0.35 } as const;

/**
 * Compares company, type, target entity, normalised objective, active state
 * and department. Only ACTIVE tasks can be duplicates; finished tasks with the
 * same objective are reported as related (reuse their results).
 */
export function detectDuplicates(
  q: DuplicateQuery,
  existing: readonly DuplicateCandidateTask[],
): DuplicateResult {
  const ignore = new Set([...(q.ignoreIds ?? []), ...(q.id ? [q.id] : [])]);
  const objective = normalizeObjective(q.title);
  const matches: DuplicateMatch[] = [];
  for (const t of existing) {
    if (ignore.has(t.id) || t.companyId !== q.companyId) continue;
    const sim = similarity(objective, normalizeObjective(t.title));
    const active = ACTIVE.includes(t.status);
    const sameType = t.type === q.type;
    const sameEntity = !!q.targetEntity && !!t.targetEntity && q.targetEntity === t.targetEntity;
    const reasons: string[] = ["same company"];
    if (sameType) reasons.push("same task type");
    if (sameEntity) reasons.push(`same target entity (${t.targetEntity})`);
    if (q.departmentId && t.departmentId === q.departmentId) reasons.push("same department");
    reasons.push(`objective similarity ${Math.round(sim * 100)}%`);
    reasons.push(
      active ? `existing task is ${t.status}` : `existing task is ${t.status} (reuse its result)`,
    );

    let level: DuplicateLevel = "no_duplicate";
    if (active && sameType && (sim === 1 || (sameEntity && sim >= DUPLICATE_THRESHOLDS.likely)))
      level = "exact_duplicate";
    else if (active && sameType && (sim >= DUPLICATE_THRESHOLDS.likely || sameEntity))
      level = "likely_duplicate";
    else if (sim >= DUPLICATE_THRESHOLDS.related || sameEntity) level = "related_existing_task";
    if (level !== "no_duplicate")
      matches.push({
        taskId: t.id,
        title: t.title,
        status: t.status,
        level,
        similarity: Math.round(sim * 100) / 100,
        reasons,
      });
  }
  const order: DuplicateLevel[] = [
    "exact_duplicate",
    "likely_duplicate",
    "related_existing_task",
    "no_duplicate",
  ];
  matches.sort(
    (a, b) => order.indexOf(a.level) - order.indexOf(b.level) || b.similarity - a.similarity,
  );
  return { level: matches[0]?.level ?? "no_duplicate", matches: matches.slice(0, 5) };
}
