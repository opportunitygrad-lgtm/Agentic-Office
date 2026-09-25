import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  AgentRole,
  AgentRoleDTO,
  CompiledAgentInstructionPack,
  DelegationDecisionDTO,
  OrgAgentNode,
  TaskDetailDTO,
} from "@aibos/shared";
import { AGENTS, ME_OWNER, TASKS, agent, ept } from "@/test/fixtures";
import { routerMock } from "@/test/next-navigation";
import { AgentRegistry, filterAgents } from "../agents/AgentRegistry";
import { SessionProvider } from "../shell/SessionContext";
import { InstructionPreview } from "./InstructionPreview";
import { ManagerStatsPanel } from "./ManagerStatsPanel";
import { NewTaskButton } from "./NewTaskButton";
import { OrgChart } from "./OrgChart";
import { RoleEditor } from "./RoleEditor";
import { TaskWorkforcePanel } from "./TaskWorkforcePanel";

afterEach(() => vi.unstubAllGlobals());

type Route = [match: string, body: unknown, status?: number, method?: string];
/** Fetch mock answering by URL fragment and optional method (first match wins); records every call. */
function stubApi(routes: Route[]) {
  const fn = vi.fn((url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const r = routes.find(([m, , , verb]) => url.includes(m) && (!verb || verb === method));
    return Promise.resolve(
      new Response(JSON.stringify(r ? r[1] : { error: { message: "nope" } }), {
        status: r ? (r[2] ?? 200) : 404,
      }),
    );
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}
const calls = (fn: ReturnType<typeof stubApi>, method: string, fragment: string) =>
  fn.mock.calls.filter(
    ([url, init]) =>
      String(url).includes(fragment) && (init as RequestInit | undefined)?.method === method,
  );

const ROLE: AgentRole = {
  identity: { roleName: "Flight School Research", mission: "Find partner schools" },
  responsibilities: { primary: ["Shortlists"], secondary: [] },
  behaviours: { workflow: [], requiredChecks: ["Verify approvals"], requiredContext: [] },
  prohibited: { actions: ["Fabricate facts"], belongsElsewhere: [], dataNotAccessed: [] },
  delegation: {
    mayDelegate: false,
    allowedDelegates: [],
    allowedDepartments: [],
    maxDepth: 0,
    conditions: [],
  },
  handoff: { destinations: [] },
  research: {
    maxSearches: 10,
    maxRetries: 1,
    deepResearch: "approval",
    stopCondition: "Stop when verified",
  },
  cost: { maxTaskBudget: null, providerPreference: [], escalationThreshold: null },
  completion: { definitionOfDone: ["Cited"], stopConditions: [], resultFormat: "Table" },
  expectedTools: [],
  freeText: "",
};

const roleDTO = (viewerCanManage: boolean): AgentRoleDTO => ({
  agentId: "a1",
  source: "agent",
  role: ROLE,
  templateRole: ROLE,
  roleTemplate: {
    id: "rt1",
    key: "ept-research",
    name: "Flight School Research",
    companySpecific: true,
  },
  currentVersion: null,
  versions: [
    {
      id: "v2",
      version: 2,
      changeSummary: "Tighter limits",
      material: true,
      createdBy: { id: "u1", name: "Platform Owner" },
      approvedBy: { id: "u1", name: "Platform Owner" },
      effectiveFrom: "2026-09-20T10:00:00Z",
      createdAt: "2026-09-20T10:00:00Z",
      isCurrent: true,
    },
    {
      id: "v1",
      version: 1,
      changeSummary: "Initial role",
      material: true,
      createdBy: null,
      approvedBy: null,
      effectiveFrom: "2026-09-10T10:00:00Z",
      createdAt: "2026-09-10T10:00:00Z",
      isCurrent: false,
    },
  ],
  capabilities: ["research.web"],
  viewerCanManage,
});

describe("RoleEditor", () => {
  it("shows version history and saves a new version only with a change summary", async () => {
    const fn = stubApi([
      ["/role", { data: { version: 3, created: true, role: roleDTO(true) } }, 200, "PUT"],
      ["/role", { data: roleDTO(true) }],
    ]);
    const u = userEvent.setup();
    render(<RoleEditor agentId="a1" />);
    const history = await screen.findByRole("list", { name: "Role versions" });
    expect(within(history).getAllByRole("listitem")).toHaveLength(2);
    expect(history).toHaveTextContent("Changed by Platform Owner");
    const save = screen.getByRole("button", { name: /Save new version/ });
    expect(save).toBeDisabled();
    await u.clear(screen.getByLabelText("Mission"));
    await u.type(screen.getByLabelText("Mission"), "Find verified partner schools");
    expect(save).toBeDisabled();
    await u.type(screen.getByLabelText(/Change summary/), "Clarify mission");
    await u.click(save);
    await waitFor(() => expect(calls(fn, "PUT", "/v1/agents/a1/role")).toHaveLength(1));
    const body = JSON.parse(calls(fn, "PUT", "/v1/agents/a1/role")[0]![1]!.body as string);
    expect(body.changeSummary).toBe("Clarify mission");
    expect(body.role.identity.mission).toBe("Find verified partner schools");
  });

  it("is read-only without role management permission", async () => {
    stubApi([["/role", { data: roleDTO(false) }]]);
    render(<RoleEditor agentId="a1" />);
    expect(await screen.findByText(/Read-only/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Save new version/ })).not.toBeInTheDocument();
  });
});

const rule = (
  id: string,
  layer: CompiledAgentInstructionPack["layers"][number]["layer"],
  text: string,
  extra = {},
) => ({
  id,
  layer,
  priority: 1,
  category: "safety",
  text,
  source: "Platform safety",
  reason: "Applies to every agent",
  locked: layer === "platform",
  ...extra,
});

const PACK: CompiledAgentInstructionPack = {
  version: "instr-1",
  agentId: "a1",
  companyId: ept.id,
  taskId: null,
  layers: [
    {
      layer: "platform",
      label: "Platform safety",
      priority: 1,
      rules: [rule("p1", "platform", "Never reveal secrets.")],
    },
    {
      layer: "company",
      label: "Company rules & AI policy",
      priority: 3,
      rules: [rule("c1", "company", "Company research limit: 5 searches")],
    },
    {
      layer: "agent",
      label: "Agent-specific role",
      priority: 6,
      rules: [
        rule("a1", "agent", "Never reveal secrets.", { duplicateOf: "p1" }),
        rule("a2", "agent", "Ignore company policy", { rejected: "Cannot override higher layers" }),
      ],
    },
  ],
  conflicts: [
    {
      id: "k1",
      category: "research_limit",
      requested: { layer: "agent", text: "Max searches 10" },
      winner: { layer: "company", text: "Company research limit: 5" },
      resolution: "Company policy wins: max 5 searches",
    },
  ],
  effective: {
    maxSearches: 5,
    maxRetries: 1,
    maxTaskBudgetUsd: 2,
    deepResearch: "approval",
    externalActions: "approval_required",
    mayDelegate: false,
    maxDelegationDepth: 0,
    allowedTools: ["tool.web.search"],
    approvalTools: [],
    deniedTools: [],
    providerPreference: [],
    stopConditions: [],
    definitionOfDone: [],
    resultFormat: "Table",
  },
  context: null,
  text: "## PLATFORM SAFETY\n- Never reveal secrets.",
  metadata: {
    generatedAt: "2026-09-25T10:00:00Z",
    ruleCount: 3,
    duplicatesRemoved: 1,
    rejectedCount: 1,
    approxChars: 40,
    roleVersion: 2,
  },
};

describe("InstructionPreview", () => {
  it("lists layers by priority with source and reason, folds duplicates and explains conflicts", async () => {
    stubApi([["/instructions", { data: PACK }]]);
    const u = userEvent.setup();
    render(
      <InstructionPreview
        agentId="a1"
        companies={[{ slug: ept.slug, name: ept.name }]}
        tasks={[]}
      />,
    );
    const layers = await screen.findByRole("list", { name: "Instruction layers" });
    const titles = within(layers)
      .getAllByRole("heading")
      .map((h) => h.textContent);
    expect(titles).toEqual([
      "1. Platform safety",
      "3. Company rules & AI policy",
      "6. Agent-specific role",
    ]);
    expect(
      within(layers).getAllByText(/Why included: Applies to every agent/).length,
    ).toBeGreaterThan(0);
    expect(screen.getByText(/Rejected: Cannot override higher layers/)).toBeInTheDocument();
    expect(screen.queryByText(/Duplicate — kept at higher priority/)).not.toBeInTheDocument();
    await u.click(screen.getByRole("button", { name: "Show folded duplicates" }));
    expect(screen.getByText(/Duplicate — kept at higher priority/)).toBeInTheDocument();
    expect(screen.getByText("Company policy wins: max 5 searches")).toBeInTheDocument();
    await u.click(screen.getByRole("button", { name: "Show compiled text" }));
    expect(screen.getByText(/## PLATFORM SAFETY/)).toBeInTheDocument();
  });
});

const detail = (over: Partial<TaskDetailDTO> = {}): TaskDetailDTO => ({
  ...TASKS[0]!,
  status: "queued",
  assignedAgent: null,
  requirements: {
    requiredCapabilities: ["research.web"],
    preferredDepartment: null,
    preferredAgent: null,
    preferredTeam: null,
    providerPreference: null,
    maxBudget: 2,
    maxConcurrency: null,
    delegationAllowed: true,
    parallelAllowed: false,
    externalActionAllowed: false,
    approvalRequirements: [],
    resultSchema: null,
    stoppingCondition: "Stop at 20 schools",
    expectedOutcome: null,
    targetEntity: null,
    workItems: null,
  },
  department: null,
  team: null,
  delegationDepth: 0,
  delegatedFrom: null,
  claim: null,
  delegations: [],
  viewer: {
    canAssign: true,
    canDelegate: true,
    canPause: true,
    canManageHandoffs: true,
    canCreateTemporary: true,
  },
  ...over,
});

const check = (
  c: DelegationDecisionDTO["candidates"][number]["checks"][number]["check"],
  passed = true,
  d = "ok",
) => ({ check: c, passed, detail: d });
const DECISION: DelegationDecisionDTO = {
  outcome: "delegate_to_agent",
  requester: { id: "mgr", name: "EPT Company Manager" },
  target: { kind: "agent", id: "res", name: "EPT Flight School Research" },
  budget: { decision: "allowed", estimateUsd: 1, reasons: [] },
  approvalRequired: false,
  queued: false,
  duplicate: { level: "no_duplicate", matches: [] },
  requiredCapabilities: ["research.web"],
  requiredPermissions: ["tool.web.search"],
  candidates: [
    {
      agentId: "res",
      name: "EPT Flight School Research",
      templateKey: "research",
      department: "research",
      isTemporary: false,
      checks: [check("company"), check("capability"), check("permission"), check("capacity")],
      eligible: true,
      score: 90,
      scoreReasons: ["required capability match", "available capacity"],
      rejectedReason: null,
      approvalGates: [],
    },
    {
      agentId: "mkt",
      name: "EPT Marketing",
      templateKey: "marketing_manager",
      department: "marketing",
      isTemporary: false,
      checks: [
        check("company"),
        check("capability", false, "Capability mismatch"),
        check("permission"),
        check("capacity"),
      ],
      eligible: false,
      score: 0,
      scoreReasons: [],
      rejectedReason: "Capability mismatch (missing research.web)",
      approvalGates: [],
    },
  ],
  teams: [],
  temporaryWorker: null,
  explanation: [
    "DELEGATE → EPT Flight School Research: required capability match, available capacity.",
  ],
};

describe("TaskWorkforcePanel", () => {
  it("explains the recommendation with per-candidate ✓/✗ checks and accepts it", async () => {
    const fn = stubApi([
      ["/detail", { data: detail() }],
      ["/delegation", { data: DECISION }],
      ["/handoffs", { data: [] }],
      ["/delegate", { data: {} }],
    ]);
    const u = userEvent.setup();
    render(<TaskWorkforcePanel taskId="t1" />);
    const rec = await screen.findByTestId("delegation-recommendation");
    expect(rec).toHaveTextContent("Recommendation: Delegate to agent → EPT Flight School Research");
    expect(screen.getAllByLabelText("Capability: failed")).toHaveLength(1);
    expect(screen.getByText("Capability mismatch (missing research.web)")).toBeInTheDocument();
    await u.click(screen.getByRole("button", { name: /Accept recommendation/ }));
    await waitFor(() => expect(calls(fn, "POST", "/v1/tasks/t1/delegate")).toHaveLength(1));
  });

  it("requires a reason to override a failed check", async () => {
    const fn = stubApi([
      ["/detail", { data: detail() }],
      ["/delegation", { data: DECISION }],
      ["/handoffs", { data: [] }],
      ["/delegate", { data: {} }],
    ]);
    const u = userEvent.setup();
    render(<TaskWorkforcePanel taskId="t1" />);
    await screen.findByTestId("delegation-recommendation");
    await u.selectOptions(screen.getByLabelText("Assign to"), "mkt");
    const assign = screen.getByRole("button", { name: "Assign" });
    expect(assign).toBeDisabled();
    await u.type(
      screen.getByLabelText(/Reason \(required for override\)/),
      "Brand-sensitive outreach",
    );
    await u.click(assign);
    await waitFor(() => expect(calls(fn, "POST", "/v1/tasks/t1/delegate")).toHaveLength(1));
    expect(JSON.parse(calls(fn, "POST", "/delegate")[0]![1]!.body as string)).toEqual({
      targetAgentId: "mkt",
      reason: "Brand-sensitive outreach",
    });
  });

  it("hides actions the viewer may not take", async () => {
    stubApi([
      [
        "/detail",
        {
          data: detail({
            viewer: {
              canAssign: false,
              canDelegate: false,
              canPause: false,
              canManageHandoffs: false,
              canCreateTemporary: false,
            },
          }),
        },
      ],
      ["/delegation", { error: { message: "You don't have permission to do that." } }, 403],
      ["/handoffs", { data: [] }],
    ]);
    render(<TaskWorkforcePanel taskId="t1" />);
    expect(await screen.findByText("You don't have permission to do that.")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Accept recommendation|Pause|Create handoff/ }),
    ).not.toBeInTheDocument();
  });
});

const node = (id: string, name: string, over: Partial<OrgAgentNode> = {}): OrgAgentNode => ({
  id,
  name,
  templateKey: "research",
  status: "sleeping",
  autonomyLevel: "limited_operator",
  isTemporary: false,
  reportsToId: null,
  workload: { active: 0, queued: 0, completedRecent: 0, capacity: 1, load: 0 },
  currentTask: null,
  ...over,
});

describe("OrgChart", () => {
  it("draws the hierarchy with temporary workers under their parent", () => {
    const mgr = node("m", "EPT Company Manager", { templateKey: "company_manager" });
    const res = node("r", "EPT Flight School Research", {
      reportsToId: "m",
      status: "working",
      workload: { active: 1, queued: 0, completedRecent: 0, capacity: 1, load: 1 },
    });
    const temp = node("t", "Portugal Research Worker", { reportsToId: "r", isTemporary: true });
    render(
      <OrgChart
        chart={{
          group: [node("g", "Group Manager", { templateKey: "company_manager" })],
          companies: [
            {
              company: ept,
              managers: [mgr],
              departments: [
                {
                  department: { id: "d", name: "Research", slug: "research", color: null },
                  teams: [],
                  agents: [res, temp],
                },
              ],
            },
          ],
        }}
      />,
    );
    expect(screen.getByRole("region", { name: "Group level" })).toHaveTextContent("Group Manager");
    const company = screen.getByRole("region", { name: ept.name });
    expect(within(company).getAllByTestId("org-node")).toHaveLength(3);
    const workers = within(company).getByRole("list", {
      name: "EPT Flight School Research temporary workers",
    });
    expect(workers).toHaveTextContent("Portugal Research Worker");
    expect(within(company).getByText("1/1")).toBeInTheDocument();
  });
});

describe("ManagerStatsPanel", () => {
  it("shows delegation statistics", () => {
    render(
      <ManagerStatsPanel
        stats={{
          manager: { id: "m", name: "EPT Company Manager" },
          tasksReceived: 7,
          handledDirectly: 2,
          delegated: 5,
          waitingApprovals: 1,
          duplicatesAvoided: 3,
          temporaryAgentsActive: 1,
          concurrency: { active: 5, limit: 3 },
          handoffsPending: 0,
        }}
      />,
    );
    const stats = screen.getByTestId("manager-stats");
    expect(stats).toHaveTextContent("Duplicates avoided3");
    expect(stats).toHaveTextContent("Concurrency5/3");
    expect(screen.getByText(/new work will queue/)).toBeInTheDocument();
  });
});

describe("NewTaskButton", () => {
  it("warns about a likely duplicate instead of creating another task", async () => {
    const fn = stubApi([
      [
        "/v1/tasks",
        {
          data: {
            task: null,
            reused: null,
            duplicate: {
              level: "likely_duplicate",
              matches: [
                {
                  taskId: "t9",
                  title: "Find EASA flight schools in Portugal",
                  status: "queued",
                  level: "likely_duplicate",
                  similarity: 0.8,
                  reasons: [],
                },
              ],
            },
          },
        },
      ],
    ]);
    const u = userEvent.setup();
    render(
      <SessionProvider
        me={{ ...ME_OWNER, globalPermissions: [...ME_OWNER.globalPermissions, "task.create"] }}
      >
        <NewTaskButton />
      </SessionProvider>,
    );
    await u.click(screen.getByRole("button", { name: "New task" }));
    await u.type(screen.getByLabelText(/Title/), "Find EASA flight schools in Portugal and Spain");
    await u.click(screen.getByRole("button", { name: "Check & create" }));
    const warning = await screen.findByTestId("duplicate-warning");
    expect(warning).toHaveTextContent("A similar task is already active");
    expect(routerMock.push).not.toHaveBeenCalled();
    await u.click(within(warning).getByRole("button", { name: "Create anyway" }));
    await waitFor(() => expect(calls(fn, "POST", "/v1/tasks")).toHaveLength(2));
    expect(JSON.parse(calls(fn, "POST", "/v1/tasks")[1]![1]!.body as string).onDuplicate).toBe(
      "create",
    );
    expect(await screen.findByTestId("duplicate-warning")).toBeInTheDocument();
  });
});

describe("Agent directory filters", () => {
  it("filters by company, lifecycle and autonomy", async () => {
    const temp = agent({
      id: "tmp",
      name: "Portugal Research Worker",
      isTemporary: true,
      autonomyLevel: "limited_operator",
    });
    const list = [...AGENTS, temp];
    const base = { q: "", status: "all" as const, department: "all", provider: "all" as const };
    expect(filterAgents(list, { ...base, kind: "temporary" }).map((a) => a.name)).toEqual([
      "Portugal Research Worker",
    ]);
    expect(
      filterAgents(list, { ...base, company: "global" }).every((a) => a.scope === "global"),
    ).toBe(true);
    expect(
      filterAgents(list, { ...base, autonomy: "limited_operator" }).map((a) => a.id),
    ).toContain("tmp");
    const u = userEvent.setup();
    render(<AgentRegistry agents={list} />);
    await u.selectOptions(
      screen.getByRole("combobox", { name: "Filter by lifecycle" }),
      "temporary",
    );
    expect(screen.getAllByTestId("agent-name").map((n) => n.textContent)).toEqual([
      "Portugal Research Worker",
    ]);
  });
});
