import { describe, expect, it } from "vitest";
import {
  decideDelegation,
  detectDuplicates,
  normalizeObjective,
  requiredPermissionsFor,
  type DelegationAgent,
  type DelegationRequest,
  type DelegationRequester,
} from "../src";

const NOW = new Date("2026-09-25T10:00:00Z");
const EPT = "company-ept";
const PA = "company-pa";

function agent(
  over: Partial<DelegationAgent> & Pick<DelegationAgent, "agentId" | "name">,
): DelegationAgent {
  return {
    templateKey: "research",
    scope: "company",
    companyIds: [EPT],
    departmentId: "dept-research",
    departmentSlug: "research",
    teamIds: [],
    capabilities: ["research.general", "research.web"],
    status: "sleeping",
    isTemporary: false,
    expiresAt: null,
    permissions: { "tool.web.search": "allow" },
    workload: { active: 0, queued: 0, capacity: 1 },
    perTaskBudget: 2,
    dailyBudget: 10,
    spentToday: 0,
    ...over,
  };
}

const MANAGER: DelegationRequester = {
  ...agent({
    agentId: "mgr",
    name: "EPT Company Manager",
    templateKey: "company_manager",
    departmentId: "dept-mgmt",
    departmentSlug: "management",
    capabilities: ["management.coordinate", "research.general"],
    permissions: { "tool.web.search": "allow", "action.create_temp_worker": "require_approval" },
    workload: { active: 0, queued: 0, capacity: 3 },
  }),
  delegation: { mayDelegate: true, allowedDelegates: [], allowedDepartments: [], maxDepth: 3 },
  maySpawnTemporary: false,
};

const RESEARCH = agent({ agentId: "res", name: "EPT Flight School Research" });
const MARKETING = agent({
  agentId: "mkt",
  name: "EPT Marketing",
  templateKey: "marketing_manager",
  departmentId: "dept-mkt",
  departmentSlug: "marketing",
  capabilities: ["marketing.strategy", "meta.analyse"],
});
const PA_RESEARCH = agent({ agentId: "pa-res", name: "PilotsAssist Research", companyIds: [PA] });

function request(
  over: Partial<DelegationRequest> = {},
  task: Partial<DelegationRequest["task"]> = {},
): DelegationRequest {
  return {
    now: NOW,
    requester: MANAGER,
    task: {
      id: "t1",
      companyId: EPT,
      title: "Find EASA flight schools in Portugal",
      type: "research",
      priority: "normal",
      requiredCapabilities: ["research.web"],
      preferredDepartmentId: null,
      preferredAgentId: null,
      preferredTeamId: null,
      maxBudget: 2,
      estimatedCost: 1,
      delegationAllowed: true,
      parallelAllowed: false,
      externalActionAllowed: false,
      requiresApproval: false,
      delegationDepth: 0,
      targetEntity: null,
      departmentId: null,
      workItems: null,
      ...task,
    },
    candidates: [MANAGER, RESEARCH, MARKETING, PA_RESEARCH],
    teams: [],
    concurrency: {
      global: { active: 1, limit: 3 },
      company: { active: 1, limit: 4 },
      departments: {},
    },
    budget: {
      companyDailyRemaining: 20,
      departmentRemaining: {},
      highCostThresholdUsd: 5,
      tempAgentApprovalBudgetUsd: 1,
    },
    chain: [],
    maxDepth: 3,
    openTasks: [],
    relatedTaskIds: [],
    policy: { tempWorkerMinItems: 20, activeTempAgents: 0, maxTempAgents: 5 },
    ...over,
  };
}

const find = (d: ReturnType<typeof decideDelegation>, id: string) =>
  d.candidates.find((c) => c.agentId === id)!;

describe("delegation engine", () => {
  it("delegates to the matching specialist and explains every candidate", () => {
    const d = decideDelegation(request());
    expect(d.outcome).toBe("delegate_to_agent");
    expect(d.target).toMatchObject({ kind: "agent", id: "res" });
    expect(d.requiredPermissions).toEqual(["tool.web.search"]);
    expect(find(d, "mkt").rejectedReason).toMatch(/Capability mismatch/);
    expect(find(d, "pa-res").rejectedReason).toBe("Agent does not serve company");
    expect(d.explanation[0]).toMatch(
      /DELEGATE → EPT Flight School Research: .*required capability match.*available capacity/,
    );
    expect(decideDelegation(request())).toEqual(d);
  });

  it("handles routine work itself when the requester is capable", () => {
    const self: DelegationRequester = {
      ...(RESEARCH as DelegationRequester),
      delegation: MANAGER.delegation,
      maySpawnTemporary: false,
    };
    const d = decideDelegation(request({ requester: self }));
    expect(d.outcome).toBe("handle_self");
    expect(d.explanation.join(" ")).toMatch(/routine work is not delegated/);
  });

  it("rejects missing permissions, full capacity and budget per candidate", () => {
    const noPerm = agent({ agentId: "np", name: "No Permission", permissions: {} });
    const busy = agent({
      agentId: "busy",
      name: "Busy",
      workload: { active: 1, queued: 0, capacity: 1 },
    });
    const broke = agent({ agentId: "broke", name: "Broke", perTaskBudget: 0.5 });
    const boundElsewhere = agent({
      agentId: "temp",
      name: "Temp Worker",
      isTemporary: true,
      boundTaskId: "other-task",
    });
    const d = decideDelegation(
      request({ candidates: [MANAGER, noPerm, busy, broke, boundElsewhere] }),
    );
    expect(find(d, "temp").rejectedReason).toBe("Temporary worker is bound to another task");
    expect(find(d, "np").rejectedReason).toBe("Missing permission tool.web.search");
    expect(find(d, "busy").rejectedReason).toBe("At concurrency limit");
    expect(find(d, "broke").rejectedReason).toMatch(/exceeds per-task budget/);
    expect(d.outcome).not.toBe("delegate_to_agent");
  });

  it("blocks when the budget would be exceeded and asks approval for high-cost work", () => {
    const blocked = decideDelegation(
      request({ budget: { ...request().budget, companyDailyRemaining: 0.5 } }),
    );
    expect(blocked.outcome).toBe("blocked");
    expect(blocked.budget.decision).toBe("blocked");
    const costly = decideDelegation(
      request(
        { candidates: [MANAGER, { ...RESEARCH, perTaskBudget: 20 }] },
        { estimatedCost: 8, maxBudget: 10 },
      ),
    );
    expect(costly.budget.decision).toBe("requires_approval");
    expect(costly.approvalRequired).toBe(true);
    expect(costly.outcome).toBe("delegate_to_agent");
  });

  it("blocks exact duplicates and suggests reuse", () => {
    const d = decideDelegation(
      request({
        openTasks: [
          {
            id: "t0",
            title: "Find EASA flight schools in Portugal",
            description: null,
            companyId: EPT,
            type: "research",
            status: "running",
            targetEntity: null,
            departmentId: null,
          },
        ],
      }),
    );
    expect(d.outcome).toBe("blocked");
    expect(d.duplicate.level).toBe("exact_duplicate");
    expect(d.explanation[0]).toMatch(/reuse or attach/);
  });

  it("enforces the delegation depth limit and prevents circular delegation", () => {
    const deep = decideDelegation(request({}, { delegationDepth: 3 }));
    expect(deep.outcome).toBe("require_human_review");
    expect(deep.explanation.join(" ")).toMatch(/depth limit reached/);
    const circular = decideDelegation(request({ chain: ["res"] }));
    expect(find(circular, "res").rejectedReason).toMatch(/circular delegation/);
    expect(circular.target?.id).not.toBe("res");
  });

  it("respects department concurrency and queues at the global limit", () => {
    const d = decideDelegation(
      request({
        concurrency: {
          global: { active: 3, limit: 3 },
          company: { active: 1, limit: 4 },
          departments: { "dept-research": { active: 5, limit: 5 } },
        },
      }),
    );
    expect(find(d, "res").rejectedReason).toBe("Department at concurrency limit");
    expect(d.queued).toBe(true);
  });

  it("recommends a temporary worker (approval required) when no permanent agent is eligible", () => {
    const d = decideDelegation(
      request(
        { candidates: [MANAGER, { ...RESEARCH, workload: { active: 1, queued: 0, capacity: 1 } }] },
        { parallelAllowed: true, workItems: 200 },
      ),
    );
    expect(d.outcome).toBe("create_temporary_worker");
    expect(d.approvalRequired).toBe(true);
    expect(d.temporaryWorker).toMatchObject({
      capabilities: ["research.web"],
      permissions: ["tool.web.search"],
    });
    // Temporary workers may not spawn further workers unless explicitly permitted.
    const tempRequester: DelegationRequester = {
      ...MANAGER,
      isTemporary: true,
      maySpawnTemporary: false,
    };
    expect(
      decideDelegation(request({ requester: tempRequester, candidates: [tempRequester] })).outcome,
    ).not.toBe("create_temporary_worker");
  });

  it("delegates to a team for large parallel work", () => {
    const r2 = agent({ agentId: "res2", name: "EPT Research 2", teamIds: ["team"] });
    const d = decideDelegation(
      request(
        {
          candidates: [MANAGER, { ...RESEARCH, teamIds: ["team"] }, r2],
          teams: [
            {
              id: "team",
              name: "EPT Partnerships Team",
              companyId: EPT,
              departmentId: null,
              leaderAgentId: "res",
              memberIds: ["res", "res2"],
              concurrencyLimit: 3,
              activeTasks: 0,
              active: true,
            },
          ],
        },
        { parallelAllowed: true, workItems: 50 },
      ),
    );
    expect(d.outcome).toBe("delegate_to_team");
    expect(d.target).toMatchObject({ kind: "team", id: "team" });
  });

  it("blocks requesters that do not serve the company", () => {
    const d = decideDelegation(request({ requester: { ...MANAGER, companyIds: [PA] } }));
    expect(d.outcome).toBe("blocked");
  });

  it("maps capabilities to required permissions", () => {
    expect(
      requiredPermissionsFor({
        requiredCapabilities: ["email.reply", "meta.execute"],
        externalActionAllowed: true,
      }),
    ).toEqual(["action.external_send", "tool.email.draft", "tool.email.read", "tool.meta.write"]);
  });
});

describe("duplicate detection", () => {
  const base = { companyId: EPT, description: null, departmentId: null, targetEntity: null };
  it("classifies exact, likely, related and none", () => {
    expect(normalizeObjective("Find the EASA flight schools in Portugal")).toBe(
      normalizeObjective("find easa flight school portugal"),
    );
    const existing = [
      {
        ...base,
        id: "a",
        title: "Find EASA flight schools in Portugal",
        type: "research" as const,
        status: "queued" as const,
      },
      {
        ...base,
        id: "b",
        title: "Find EASA flight schools in Spain",
        type: "research" as const,
        status: "running" as const,
      },
      {
        ...base,
        id: "c",
        title: "Find EASA flight schools in Portugal",
        type: "research" as const,
        status: "completed" as const,
      },
      {
        ...base,
        id: "d",
        title: "Find EASA flight schools in Portugal",
        type: "research" as const,
        status: "running" as const,
        companyId: PA,
      },
    ];
    const q = {
      companyId: EPT,
      title: "Find EASA flight schools in Portugal",
      type: "research" as const,
    };
    const r = detectDuplicates(q, existing);
    expect(r.level).toBe("exact_duplicate");
    expect(r.matches.map((m) => [m.taskId, m.level])).toEqual([
      ["a", "exact_duplicate"],
      ["b", "likely_duplicate"],
      ["c", "related_existing_task"],
    ]);
    expect(detectDuplicates({ ...q, title: "Plan Instagram campaign" }, existing).level).toBe(
      "no_duplicate",
    );
    const entity = detectDuplicates(
      {
        ...q,
        title: "Contact Lisbon Aviation Academy",
        targetEntity: "school:lisbon",
        type: "email",
      },
      [
        {
          ...base,
          id: "e",
          title: "Email Lisbon academy",
          type: "email",
          status: "queued",
          targetEntity: "school:lisbon",
        },
      ],
    );
    expect(entity.level).toBe("likely_duplicate");
  });
});
