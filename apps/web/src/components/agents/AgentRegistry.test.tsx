import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { AGENTS } from "@/test/fixtures";
import { AgentRegistry, filterAgents } from "./AgentRegistry";

const names = () => screen.getAllByTestId("agent-name").map((n) => n.textContent);

describe("AgentRegistry filtering", () => {
  it("filters by search, status, department and provider", async () => {
    const user = userEvent.setup();
    render(<AgentRegistry agents={AGENTS} />);
    expect(names()).toHaveLength(5);

    await user.type(screen.getByRole("searchbox", { name: "Search agents" }), "opportunitygrad");
    expect(names()).toEqual(["Opportunitygrad Admissions"]);
    await user.clear(screen.getByRole("searchbox", { name: "Search agents" }));

    const statusGroup = screen.getByRole("group", { name: "Filter by status" });
    await user.click(within(statusGroup).getByRole("button", { name: /Working/ }));
    expect(names()).toEqual(["Group Manager", "EPT Flight School Research"]);
    expect(within(statusGroup).getByRole("button", { name: /Working/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await user.click(within(statusGroup).getByRole("button", { name: /All/ }));
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Filter by department" }),
      "marketing",
    );
    expect(names()).toEqual(["EPT Grok Social Intelligence", "PilotsAssist Website / SEO"]);

    await user.selectOptions(screen.getByRole("combobox", { name: "Filter by provider" }), "GROK");
    expect(names()).toEqual(["EPT Grok Social Intelligence"]);

    await user.selectOptions(
      screen.getByRole("combobox", { name: "Filter by provider" }),
      "OPENAI",
    );
    expect(screen.getByText("No agents match these filters")).toBeInTheDocument();
  });

  it("honours an initial status and opens the agent detail sheet", async () => {
    const user = userEvent.setup();
    render(<AgentRegistry agents={AGENTS} initialStatus="waiting" />);
    expect(names()).toEqual(["PilotsAssist Website / SEO"]);
    await user.click(screen.getByRole("button", { name: /PilotsAssist Website \/ SEO/ }));
    const dialog = screen.getByRole("dialog", { name: "PilotsAssist Website / SEO" });
    expect(dialog).toHaveTextContent("Company assignments");
    expect(dialog).toHaveTextContent("PilotsAssist");
  });

  it("exposes a pure filter function", () => {
    expect(
      filterAgents(AGENTS, { q: "", status: "all", department: "all", provider: "CLAUDE" }),
    ).toHaveLength(4);
  });
});
