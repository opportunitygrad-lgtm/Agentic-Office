import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentAuthorityDTO } from "@aibos/shared";
import { AgentAuthorityPanel } from "./AgentAuthorityPanel";

const authority = (viewerCanManage: boolean): AgentAuthorityDTO => ({
  agentId: "a1",
  companyId: null,
  autonomyLevel: "approval_gated",
  status: "working",
  companies: [],
  groups: [
    {
      group: "Email",
      items: [
        {
          permission: "tool.email.read",
          verb: "READ",
          label: "Read mailboxes",
          risk: "low",
          grant: "allow",
          decision: "allow",
          reason: "Granted",
        },
        {
          permission: "tool.email.draft",
          verb: "DRAFT",
          label: "Create email drafts",
          risk: "medium",
          grant: "allow",
          decision: "allow",
          reason: "Granted",
        },
        {
          permission: "tool.email.send",
          verb: "SEND",
          label: "Send email",
          risk: "high",
          grant: "require_approval",
          decision: "require_approval",
          reason: "High-risk actions are approval-gated",
        },
      ],
    },
    {
      group: "Meta",
      items: [
        {
          permission: "tool.meta.write",
          verb: "EDIT",
          label: "Modify Meta campaigns",
          risk: "high",
          grant: null,
          decision: "deny",
          reason: "Not granted",
        },
      ],
    },
  ],
  approvalGates: ["email_send"],
  prohibitedActions: ["Spend money or change budgets without approval"],
  limits: {
    perTaskBudget: 2,
    dailyBudget: 15,
    maxExternalSearches: 20,
    maxRetries: 2,
    concurrencyLimit: 3,
  },
  viewerCanManage,
});

afterEach(() => vi.unstubAllGlobals());

describe("AgentAuthorityPanel", () => {
  it("shows readable authority (✓, → APPROVAL, ✗) read-only for viewers", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: authority(false) }))),
    );
    render(<AgentAuthorityPanel agentId="a1" />);
    await screen.findByTestId("authority-panel");
    expect(screen.getByText("L3 · Approval-gated operator")).toBeInTheDocument();
    expect(screen.getByTestId("authority-tool.email.read")).toHaveTextContent("READ✓");
    expect(screen.getByTestId("authority-tool.email.send")).toHaveTextContent("SEND→ APPROVAL");
    expect(screen.getByTestId("authority-tool.meta.write")).toHaveTextContent("EDIT✗");
    expect(screen.getByText("Email send")).toBeInTheDocument();
    expect(screen.getByText("Read-only")).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("lets authorised users change autonomy", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(new Response(JSON.stringify({ data: authority(true) }))),
      );
    vi.stubGlobal("fetch", fetchMock);
    const u = userEvent.setup();
    render(<AgentAuthorityPanel agentId="a1" />);
    await screen.findByTestId("authority-panel");
    await u.selectOptions(screen.getByLabelText("Change autonomy level"), "limited_operator");
    await u.click(screen.getByRole("button", { name: /Save/ }));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([url, init]) => url === "/api/v1/agents/a1/autonomy" && init?.method === "PUT",
        ),
      ).toBe(true),
    );
    const put = fetchMock.mock.calls.find(([url]) => url === "/api/v1/agents/a1/autonomy")!;
    expect(JSON.parse(put[1].body as string)).toEqual({ autonomyLevel: "limited_operator" });
  });
});
