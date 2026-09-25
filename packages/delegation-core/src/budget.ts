import type { BudgetDecision } from "@aibos/shared";

/** One hard budget ceiling: exceeding `remainingUsd` blocks the work. */
export interface BudgetLimit {
  /** Human wording, e.g. "the company's remaining daily budget". */
  label: string;
  remainingUsd: number | null;
  /** Show the remaining value with two decimals (as Stage 04 did for company budgets). */
  fixed?: boolean;
}

/**
 * Stage 04 budget control, shared by delegation and AI execution:
 * any exceeded ceiling → BLOCKED; otherwise above the high-cost threshold →
 * REQUIRES_APPROVAL; otherwise ALLOWED. Deterministic, no AI.
 */
export function evaluateBudget(
  estimateUsd: number,
  limits: BudgetLimit[],
  highCostThresholdUsd: number,
): { decision: BudgetDecision; reasons: string[] } {
  const reasons: string[] = [];
  let decision: BudgetDecision = "allowed";
  for (const l of limits) {
    if (l.remainingUsd === null || l.remainingUsd === undefined) continue;
    if (estimateUsd > l.remainingUsd) {
      decision = "blocked";
      reasons.push(
        `Estimate $${estimateUsd} exceeds ${l.label} $${l.fixed ? l.remainingUsd.toFixed(2) : l.remainingUsd}`,
      );
    }
  }
  if (decision === "allowed" && estimateUsd > highCostThresholdUsd) {
    decision = "requires_approval";
    reasons.push(
      `High-cost task: $${estimateUsd} is above the $${highCostThresholdUsd} approval threshold`,
    );
  }
  return { decision, reasons };
}
