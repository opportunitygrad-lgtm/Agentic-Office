import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  AgentContextPack,
  AuditEventDTO,
  CommercialRuleDTO,
  KnowledgeDetailDTO,
  KnowledgeItemDTO,
  KnowledgeListDTO,
  MeDTO,
} from "@aibos/shared";
import { SessionProvider } from "../shell/SessionContext";
import { ME_OWNER, ept } from "@/test/fixtures";
import { routerMock } from "@/test/next-navigation";
import { KnowledgeLibrary } from "./KnowledgeLibrary";
import { RulesPanel } from "../company/RulesPanel";
import { ProfileSection } from "../company/ProfileSection";
import { HistoryFeed } from "../company/HistoryFeed";
import { ContextPreview } from "../context/ContextPreview";

const now = "2026-09-24T10:00:00.000Z";

function item(
  extra: Partial<KnowledgeItemDTO> & Pick<KnowledgeItemDTO, "id" | "title">,
): KnowledgeItemDTO {
  return {
    company: ept,
    scope: "company",
    department: null,
    summary: null,
    content: "Content",
    type: "company_fact",
    category: null,
    tags: [],
    sourceType: "management_entry",
    sourceReference: null,
    sourceUrl: null,
    sourceFileRef: null,
    sourceOwner: null,
    provenanceNotes: null,
    confidence: "high",
    verificationStatus: "management_confirmed",
    status: "approved",
    sensitivity: "internal",
    usableAsUnverified: false,
    effectiveAt: null,
    reviewAt: null,
    expiresAt: null,
    lastVerifiedAt: now,
    freshness: "current",
    precedence: { tier: 1, label: "Management-approved rule or policy" },
    version: 1,
    lineageId: extra.id,
    supersedesId: null,
    supersededById: null,
    conflictKey: null,
    createdBy: { id: "u1", name: "Platform Owner" },
    updatedBy: null,
    approvedBy: null,
    approvedAt: null,
    submittedAt: null,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
    origin: "dev_seed",
    conflictsWith: [],
    ...extra,
  };
}

const LIST: KnowledgeListDTO = {
  data: [
    item({ id: "k1", title: "Enquiry reply standards", tags: ["email"] }),
    item({ id: "k2", title: "Training fee guidance", freshness: "expired", type: "pricing" }),
    item({
      id: "k3",
      title: "Research notes",
      status: "review",
      sourceType: "claude_research",
      verificationStatus: "unverified",
    }),
  ],
  facets: {
    tags: ["email"],
    categories: [],
    total: 3,
    stale: 1,
    conflicts: 0,
    hiddenBySensitivity: 1,
  },
};

function detail(
  k: KnowledgeItemDTO,
  viewer = { canEdit: true, canApprove: true, canArchive: true },
): KnowledgeDetailDTO {
  return {
    item: k,
    versions: [
      {
        id: k.id,
        version: k.version,
        status: k.status,
        title: k.title,
        createdBy: null,
        approvedBy: null,
        approvedAt: null,
        createdAt: now,
        updatedAt: now,
      },
    ],
    links: [],
    history: [],
    conflicts: [],
    viewer,
  };
}

type Route = (url: string, init?: RequestInit) => unknown;
function mockApi(routes: Record<string, Route | unknown>) {
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const path = url.split("?")[0]!;
    const key = Object.keys(routes).find((k) => {
      const [method, p] = k.includes(" ") ? k.split(" ") : ["GET", k];
      return (
        (init?.method ?? "GET") === method &&
        (p === path || (p!.endsWith("*") && path.startsWith(p!.slice(0, -1))))
      );
    });
    if (!key)
      return new Response(JSON.stringify({ error: { message: "not mocked" } }), { status: 404 });
    const r = routes[key];
    const body = typeof r === "function" ? (r as Route)(url, init) : r;
    if (body instanceof Response) return body;
    return new Response(JSON.stringify(body));
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

const withMe = (me: MeDTO, ui: React.ReactElement) => (
  <SessionProvider me={me}>{ui}</SessionProvider>
);

afterEach(() => {
  vi.unstubAllGlobals();
  routerMock.refresh.mockClear();
});

const KNOWLEDGE_ADMIN = [
  "knowledge.view",
  "knowledge.create",
  "knowledge.edit",
  "knowledge.approve",
  "knowledge.archive",
];
const ME_ADMIN: MeDTO = {
  ...ME_OWNER,
  companyPermissions: { [ept.id]: [...ME_OWNER.companyPermissions[ept.id]!, ...KNOWLEDGE_ADMIN] },
};

const ME_STAFF: MeDTO = {
  ...ME_OWNER,
  isPlatformOwner: false,
  globalPermissions: [],
  companyPermissions: { [ept.id]: ["company.view", "knowledge.view"] },
  accessibleCompanies: [ept],
};

describe("Knowledge Library", () => {
  it("lists knowledge with lifecycle, verification, freshness and source", async () => {
    mockApi({ "/api/v1/knowledge": LIST, "/api/v1/knowledge/conflicts": { data: [] } });
    render(withMe(ME_ADMIN, <KnowledgeLibrary company={ept} departments={[]} />));
    const row = (await screen.findByText("Training fee guidance")).closest("li")!;
    expect(within(row).getByText("Expired")).toBeInTheDocument();
    expect(within(row).getByText("Approved")).toBeInTheDocument();
    const research = screen.getByText("Research notes").closest("li")!;
    expect(within(research).getByText("In review")).toBeInTheDocument();
    expect(within(research).getByText("Unverified")).toBeInTheDocument();
    expect(within(research).getByText("Claude research")).toBeInTheDocument();
    expect(screen.getByText("Hidden (clearance)").nextSibling).toHaveTextContent("1");
  });

  it("searches and filters through the API", async () => {
    const fetchMock = mockApi({
      "/api/v1/knowledge": LIST,
      "/api/v1/knowledge/conflicts": { data: [] },
    });
    const u = userEvent.setup();
    render(withMe(ME_ADMIN, <KnowledgeLibrary company={ept} departments={[]} />));
    await screen.findByText("Enquiry reply standards");
    await u.selectOptions(screen.getByLabelText("Status"), "review");
    await u.type(screen.getByLabelText("Search knowledge"), "fees");
    await waitFor(() => {
      const urls = fetchMock.mock.calls.map(([url]) => String(url));
      expect(
        urls.some(
          (x) =>
            x.includes("status=review") &&
            x.includes("q=fees") &&
            x.includes("company=euro-pilot-training"),
        ),
      ).toBe(true);
    });
  });

  it("adds knowledge as a draft", async () => {
    const created = item({ id: "k9", title: "Refund policy", status: "draft" });
    const fetchMock = mockApi({
      "/api/v1/knowledge": LIST,
      "/api/v1/knowledge/conflicts": { data: [] },
      "POST /api/v1/knowledge": { data: created },
      "/api/v1/knowledge/k9": { data: detail(created) },
    });
    const u = userEvent.setup();
    render(withMe(ME_ADMIN, <KnowledgeLibrary company={ept} departments={[]} />));
    await u.click(await screen.findByRole("button", { name: /Add knowledge/ }));
    const form = screen.getByRole("form", { name: "Add knowledge" });
    await u.type(within(form).getByLabelText(/^Title/), "Refund policy");
    await u.type(within(form).getByLabelText(/^Content/), "Refunds are decided by management.");
    await u.click(within(form).getByRole("button", { name: "Create draft" }));
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(true),
    );
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === "POST")!;
    expect(JSON.parse(post[1]!.body as string)).toMatchObject({
      title: "Refund policy",
      companyId: ept.id,
      scope: "company",
      sourceType: "management_entry",
    });
    expect(await screen.findByTestId("knowledge-drawer")).toBeInTheDocument();
  });

  it("runs the approval lifecycle and requires human verification for AI-sourced items", async () => {
    const research = LIST.data[2]!;
    const fetchMock = mockApi({
      "/api/v1/knowledge": LIST,
      "/api/v1/knowledge/conflicts": { data: [] },
      "/api/v1/knowledge/k3": { data: detail(research) },
      "POST /api/v1/knowledge/k3/approve": { data: research },
      "/api/v1/tasks": { data: [] },
      "/api/v1/agents": { data: [] },
    });
    const u = userEvent.setup();
    render(withMe(ME_ADMIN, <KnowledgeLibrary company={ept} departments={[]} />));
    await u.click(await screen.findByText("Research notes"));
    const drawer = await screen.findByTestId("knowledge-drawer");
    const approve = within(drawer).getByRole("button", { name: "Approve" });
    expect(approve).toBeDisabled();
    await u.selectOptions(
      within(drawer).getByLabelText("Verification level for approval"),
      "verified",
    );
    await u.click(approve);
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/k3/approve"));
      expect(call && JSON.parse(call[1]!.body as string)).toEqual({
        verificationStatus: "verified",
      });
    });
  });

  it("shows a restricted state: no Add button and no lifecycle actions without permission", async () => {
    mockApi({
      "/api/v1/knowledge": LIST,
      "/api/v1/knowledge/conflicts": { data: [] },
      "/api/v1/knowledge/k1": {
        data: detail(LIST.data[0]!, { canEdit: false, canApprove: false, canArchive: false }),
      },
      "/api/v1/tasks": { data: [] },
      "/api/v1/agents": { data: [] },
    });
    const u = userEvent.setup();
    render(withMe(ME_STAFF, <KnowledgeLibrary company={ept} departments={[]} />));
    await u.click(await screen.findByText("Enquiry reply standards"));
    const drawer = await screen.findByTestId("knowledge-drawer");
    expect(screen.queryByRole("button", { name: /Add knowledge/ })).not.toBeInTheDocument();
    expect(
      within(drawer).queryByRole("button", { name: /^(Approve|Archive|Edit.*|Supersede)$/ }),
    ).not.toBeInTheDocument();
  });

  it("explains when an item is above the viewer's clearance", async () => {
    mockApi({
      "/api/v1/knowledge": LIST,
      "/api/v1/knowledge/conflicts": { data: [] },
      "/api/v1/knowledge/k1": new Response(
        JSON.stringify({
          error: { message: "This knowledge is RESTRICTED; you are not cleared to read it" },
        }),
        { status: 403 },
      ),
      "/api/v1/tasks": { data: [] },
      "/api/v1/agents": { data: [] },
    });
    render(
      withMe(ME_STAFF, <KnowledgeLibrary company={ept} departments={[]} initialItemId="k1" />),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(/not cleared/);
  });
});

describe("Rules", () => {
  const meta: CommercialRuleDTO = {
    id: "r1",
    kind: "commercial",
    companyId: "c-og",
    title: "Meta budget increase limit",
    description: "Automatic budget increases must not exceed ₹100.",
    severity: "critical",
    active: true,
    status: "approved",
    createdBy: null,
    approvedBy: null,
    approvedAt: now,
    updatedAt: now,
    origin: "dev_seed",
    category: "advertising_budget",
    appliesTo: "meta.budget_increase",
    effect: "limit",
    limitAmount: 100,
    currency: "INR",
    period: "day",
    requiredPermission: "approval.financial",
  };
  const draft: CommercialRuleDTO = {
    ...meta,
    id: "r2",
    title: "Discount authority",
    status: "draft",
    severity: "required",
  };

  it("renders commercial rules with their machine-readable constraint", () => {
    render(
      <RulesPanel
        kind="commercial"
        rules={[meta]}
        companySlug="opportunitygrad"
        canManage={false}
        canApprove={false}
      />,
    );
    expect(screen.getByText("Meta budget increase limit")).toBeInTheDocument();
    expect(screen.getByText(/up to INR 100 per day automatically/)).toBeInTheDocument();
    expect(screen.getByText("Binding")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Add rule|Approve|Edit/ })).not.toBeInTheDocument();
  });

  it("only approvers see Approve; managers can add rules", async () => {
    const { rerender } = render(
      <RulesPanel
        kind="commercial"
        rules={[draft]}
        companySlug="og"
        canManage
        canApprove={false}
      />,
    );
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Add rule/ })).toBeInTheDocument();
    const fetchMock = mockApi({
      "POST /api/v1/rules/commercial/r2/approve": { data: { ...draft, status: "approved" } },
    });
    rerender(
      <RulesPanel kind="commercial" rules={[draft]} companySlug="og" canManage canApprove />,
    );
    await userEvent.setup().click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(routerMock.refresh).toHaveBeenCalled();
  });

  it("adds brand and compliance rules through the form", async () => {
    const fetchMock = mockApi({ "POST /api/v1/companies/ept/rules/compliance": { data: {} } });
    const u = userEvent.setup();
    render(<RulesPanel kind="compliance" rules={[]} companySlug="ept" canManage canApprove />);
    await u.click(screen.getByRole("button", { name: /Add rule/ }));
    const form = screen.getByRole("form", { name: "Add compliance rule" });
    await u.type(within(form).getByLabelText(/^Title/), "Disclose finance");
    await u.type(within(form).getByLabelText(/^Rule/), "Mention the finance disclosure.");
    await u.clear(within(form).getByLabelText(/^IF action/));
    await u.type(within(form).getByLabelText(/^IF action/), "email.send");
    await u.selectOptions(within(form).getByLabelText("THEN"), "require_disclosure");
    await u.type(within(form).getByLabelText("Disclosure text"), "Finance is not guaranteed.");
    await u.click(within(form).getByRole("button", { name: "Add rule" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(JSON.parse(fetchMock.mock.calls[0]![1]!.body as string)).toMatchObject({
      action: "email.send",
      effect: "require_disclosure",
      disclosureText: "Finance is not guaranteed.",
      approve: false,
    });
  });
});

describe("Company profile", () => {
  it("edits a profile section and sends exactly the section's fields", async () => {
    const fetchMock = mockApi({ "PUT /api/v1/companies/ept/profile/brand": { ok: true } });
    const u = userEvent.setup();
    render(
      <ProfileSection
        section="brand"
        title="Brand"
        companySlug="ept"
        canEdit
        values={{
          brandPositioning: "Premium",
          prohibitedClaims: ["Cheapest"],
          approvedPhrases: [],
        }}
      />,
    );
    expect(screen.getByText("Cheapest")).toBeInTheDocument();
    await u.click(screen.getByRole("button", { name: "Edit" }));
    const voice = screen.getByLabelText("Voice");
    await u.type(voice, "Confident");
    await u.click(screen.getByRole("button", { name: "Save section" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string);
    expect(Object.keys(body).sort()).toEqual(
      [
        "approvedPhrases",
        "brandPersonality",
        "brandPositioning",
        "brandTone",
        "brandVoice",
        "claimsAllowed",
        "claimsRequiringEvidence",
        "competitorNotes",
        "prohibitedClaims",
        "prohibitedPhrases",
        "visualGuidance",
      ].sort(),
    );
    expect(body).toMatchObject({
      brandVoice: "Confident",
      brandPersonality: null,
      prohibitedClaims: ["Cheapest"],
    });
    expect(routerMock.refresh).toHaveBeenCalled();
  });

  it("is read-only without edit permission", () => {
    render(
      <ProfileSection
        section="identity"
        title="Identity"
        companySlug="ept"
        canEdit={false}
        values={{ name: "EPT" }}
      />,
    );
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
  });

  it("renders the company history feed", () => {
    const events: AuditEventDTO[] = [
      {
        id: "e1",
        occurredAt: now,
        company: ept,
        agent: null,
        taskId: null,
        actorType: "human",
        actorUser: "owner@aibos.example",
        actorUserId: "u1",
        actorServiceId: null,
        resourceType: "company",
        resourceId: ept.id,
        action: "company.profile_updated",
        description: 'Brand profile updated for "Euro Pilot Training" (1 field)',
        tool: null,
        provider: null,
        metadata: { changedFields: ["brandVoice"] },
        outcome: "success",
        error: null,
        origin: "live",
      },
    ];
    render(<HistoryFeed events={events} />);
    expect(screen.getByTestId("company-history")).toHaveTextContent("Brand profile updated");
    expect(screen.getByText("Changed: brandVoice")).toBeInTheDocument();
  });
});

describe("Context Preview", () => {
  const pack: AgentContextPack = {
    version: "ctx-1",
    request: {
      companyId: ept.id,
      agentId: "a1",
      taskId: null,
      capability: null,
      budget: "standard",
      maxChars: 16000,
      categories: [],
      explicitKnowledgeIds: [],
      allowUnverified: false,
    },
    agent: {
      id: "a1",
      name: "EPT Marketing",
      templateKey: "marketing_manager",
      department: "Marketing",
      reportsTo: "Company Manager",
      autonomyLevel: "approval_gated",
      autonomyLabel: "L3 · Approval-gated",
      allowed: ["tool.web.search"],
      approvalRequired: ["tool.meta.write"],
      denied: ["tool.email.send"],
    },
    company: {
      id: ept.id,
      name: ept.name,
      lines: [{ label: "Industry", value: "Aviation education" }],
      extended: [],
      extendedIncluded: false,
    },
    task: null,
    rules: {
      brand: [
        {
          id: "r1",
          kind: "brand",
          title: "Premium aviation presentation",
          description: "No cheap positioning.",
          severity: "critical",
          category: "positioning",
          detail: null,
          global: false,
          mandatory: true,
          reasons: ["critical_rule"],
        },
      ],
      commercial: [],
      compliance: [],
      aiPolicy: [{ label: "Email auto-send", value: "Disabled" }],
    },
    handoffs: [],
    knowledge: [
      {
        id: "k1",
        title: "Partnership approach",
        type: "partnership",
        source: "Management entry",
        sourceType: "management_entry",
        verificationStatus: "management_confirmed",
        lastVerifiedAt: now,
        snippet: "Only suitable schools.",
        precedenceTier: 1,
        freshness: "current",
        sensitivity: "internal",
        global: false,
        section: "knowledge",
        priority: 40,
        score: 100,
        reasons: ["task_link"],
        reasonDetails: ["Explicitly linked to this task"],
        warnings: [],
        chars: 120,
      },
      {
        id: "k2",
        title: "Restricted knowledge item",
        type: "financial",
        source: "Management entry",
        sourceType: "management_entry",
        verificationStatus: "management_confirmed",
        lastVerifiedAt: null,
        snippet: "Hidden",
        precedenceTier: 3,
        freshness: "expired",
        sensitivity: "restricted",
        global: false,
        section: "knowledge",
        priority: 60,
        score: 40,
        reasons: ["required_by_agent"],
        reasonDetails: [],
        warnings: ["STALE — expired, do not present as current"],
        chars: 80,
        redacted: true,
      },
    ],
    unverified: [],
    prohibitedActions: [{ action: "Email auto-send", source: "Company AI policy: disabled" }],
    requiredApprovals: [
      {
        action: "meta.budget_increase",
        requirement: "Above INR 100 per day",
        source: "Commercial rule",
      },
    ],
    excluded: [
      {
        id: "x1",
        title: null,
        kind: "knowledge",
        reason: "other_company",
        detail: "Belongs to another company",
      },
      {
        id: "x2",
        title: "Social voice (draft)",
        kind: "knowledge",
        reason: "draft",
        detail: "Draft",
      },
    ],
    warnings: [],
    metadata: {
      generatedAt: now,
      contextVersion: "ctx-1",
      approxChars: 4000,
      approxTokens: 1000,
      budgetChars: 16000,
      overBudget: false,
      includedKnowledgeIds: ["k1", "k2"],
      excludedCount: 2,
      staleCount: 1,
      droppedForBudget: 0,
      blockedCrossCompany: 1,
    },
  };

  it("shows agent, rules, knowledge with why-included reasons, exclusions and approvals", async () => {
    const fetchMock = mockApi({
      "/api/v1/agents/a1/context": { data: pack, redactedForViewer: 1 },
    });
    const u = userEvent.setup();
    render(
      <ContextPreview
        target={{ agentId: "a1" }}
        companies={[{ slug: ept.slug, name: ept.name }]}
        tasks={[]}
      />,
    );
    const preview = await screen.findByText("~1,000 tokens");
    expect(preview).toBeInTheDocument();
    expect(screen.getByText("Premium aviation presentation")).toBeInTheDocument();
    expect(screen.getAllByText("Explicitly linked to task").length).toBeGreaterThan(0);
    expect(screen.getByText("Critical company policy")).toBeInTheDocument();
    expect(screen.getByText("Hidden from you")).toBeInTheDocument();
    expect(screen.getByText("Another company's item (hidden)")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Stale items" })).toHaveTextContent(
      "Restricted knowledge item",
    );
    expect(screen.getByRole("region", { name: "Approval requirements" })).toHaveTextContent(
      "meta.budget_increase",
    );
    expect(screen.getByRole("region", { name: "Prohibited actions" })).toHaveTextContent(
      "Email auto-send",
    );
    await u.click(screen.getByRole("radio", { name: "Small" }));
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([url]) => String(url).includes("budget=small"))).toBe(true),
    );
    await u.click(screen.getByRole("button", { name: /Provider text/ }));
    expect(screen.getByLabelText("Provider text")).toHaveTextContent("## SYSTEM IDENTITY");
  });

  it("shows the API's refusal when the viewer lacks access", async () => {
    mockApi({
      "/api/v1/tasks/t1/context": new Response(
        JSON.stringify({ error: { message: "You do not have access to this company" } }),
        { status: 403 },
      ),
    });
    render(<ContextPreview target={{ taskId: "t1" }} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "You do not have access to this company",
    );
  });
});
