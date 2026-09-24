import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { routerMock } from "@/test/next-navigation";
import { APPROVALS } from "@/test/fixtures";
import { ApprovalCard } from "./ApprovalList";

afterEach(() => vi.unstubAllGlobals());

describe("approval button permissions", () => {
  it("shows required authority instead of buttons when the viewer cannot decide", () => {
    render(<ApprovalCard approval={APPROVALS[0]!} />);
    expect(screen.queryByRole("button", { name: /Approve/ })).not.toBeInTheDocument();
    expect(screen.getByText(/Needs/)).toHaveTextContent("approval.financial, approval.high_risk");
    expect(screen.getByText("Requires")).toBeInTheDocument();
  });

  it("lets an authorised viewer approve with notes", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: {} })));
    vi.stubGlobal("fetch", fetchMock);
    const u = userEvent.setup();
    render(
      <ApprovalCard
        approval={{ ...APPROVALS[0]!, viewerCanDecide: true, viewerMissingPermissions: [] }}
      />,
    );
    await u.click(screen.getByRole("button", { name: "Approve" }));
    const dialog = screen.getByRole("dialog", { name: "Approve request" });
    await u.type(within(dialog).getByLabelText(/Decision notes/), "Within plan");
    await u.click(within(dialog).getByRole("button", { name: /Confirm approval/ }));
    await waitFor(() => expect(routerMock.refresh).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/v1/approvals/ap1/decision");
    expect(JSON.parse(init.body as string)).toEqual({ decision: "approve", notes: "Within plan" });
  });
});
