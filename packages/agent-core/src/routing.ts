import type { AgentStatus, ProviderCapability, TaskPriority, TaskType } from "@aibos/shared";
import type { AgentTemplate } from "./templates";

/**
 * Task-routing contracts. Stage 06 (Task orchestration) implements a real
 * router backed by the queue; Stage 01 ships a deterministic in-memory
 * reference implementation that is safe to unit test.
 */
export interface RoutableTask {
  id: string;
  companyId: string | null;
  type: TaskType;
  priority: TaskPriority;
  requiredCapabilities?: ProviderCapability[];
}

export interface RoutableAgent {
  id: string;
  status: AgentStatus;
  companyIds: string[];
  scope: "global" | "company";
  template: Pick<AgentTemplate, "key" | "department" | "capabilities">;
  openTaskCount: number;
  concurrencyLimit: number;
}

export interface RoutingDecision {
  agentId: string | null;
  reason: string;
}

export interface TaskRouter {
  route(task: RoutableTask, candidates: RoutableAgent[]): RoutingDecision;
}

const TASK_TYPE_DEPARTMENT: Record<TaskType, string[]> = {
  management: ["management"],
  research: ["research"],
  verification: ["research", "legal"],
  email: ["communications", "sales"],
  marketing: ["marketing"],
  advertising: ["marketing"],
  analysis: ["analytics", "finance"],
  technical: ["technical"],
  website: ["technical", "marketing"],
  sales: ["sales", "revenue"],
  review: ["legal", "management"],
  custom: [],
};

const UNAVAILABLE: AgentStatus[] = ["paused", "failed", "offline", "blocked"];

/** Prefers company-assigned agents over global ones, then the least loaded. */
export class RuleBasedTaskRouter implements TaskRouter {
  route(task: RoutableTask, candidates: RoutableAgent[]): RoutingDecision {
    const departments = TASK_TYPE_DEPARTMENT[task.type];
    const eligible = candidates.filter((a) => {
      if (UNAVAILABLE.includes(a.status)) return false;
      if (a.openTaskCount >= a.concurrencyLimit) return false;
      if (task.companyId && a.scope === "company" && !a.companyIds.includes(task.companyId)) {
        return false;
      }
      if (departments.length && !departments.includes(a.template.department)) return false;
      const caps = task.requiredCapabilities ?? [];
      return caps.every((c) => a.template.capabilities.includes(c));
    });
    if (!eligible.length) return { agentId: null, reason: "No eligible agent with capacity" };
    eligible.sort((a, b) => {
      const aLocal = task.companyId && a.companyIds.includes(task.companyId) ? 0 : 1;
      const bLocal = task.companyId && b.companyIds.includes(task.companyId) ? 0 : 1;
      return aLocal - bLocal || a.openTaskCount - b.openTaskCount;
    });
    const chosen = eligible[0]!;
    return { agentId: chosen.id, reason: `Matched ${chosen.template.key}` };
  }
}
