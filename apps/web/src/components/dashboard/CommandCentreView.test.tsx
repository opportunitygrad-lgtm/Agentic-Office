import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import "@/test/next-navigation";
import { ME_EPT_MANAGER, ME_OWNER, SESSIONS, SUMMARY } from "@/test/fixtures";
import { SessionProvider } from "../shell/SessionContext";
import { CommandCentreView } from "./CommandCentreView";

describe("CommandCentreView", () => {
  it("renders the command centre with companies, workforce, approvals, usage, live view, tasks and activity", () => {
    render(
      <SessionProvider me={ME_OWNER}>
        <CommandCentreView summary={SUMMARY} sessions={SESSIONS} />
      </SessionProvider>,
    );
    expect(screen.getByRole("heading", { level: 1, name: "Command Centre" })).toBeInTheDocument();

    const companies = screen.getByRole("region", { name: "Companies" });
    for (const name of ["Euro Pilot Training", "PilotsAssist", "Opportunitygrad"]) {
      expect(within(companies).getByText(name)).toBeInTheDocument();
    }
    expect(within(companies).getByRole("link", { name: /Add company/ })).toHaveAttribute(
      "href",
      "/companies/new",
    );

    expect(screen.getByRole("region", { name: "Workforce" })).toHaveTextContent("5");
    expect(screen.getByRole("region", { name: "Active agents" })).toHaveTextContent(
      "Group Manager",
    );
    expect(screen.getByRole("region", { name: "Approval centre" })).toHaveTextContent(
      "Raise UK Masters daily budget",
    );

    const usage = screen.getByRole("region", { name: "AI usage" });
    expect(within(usage).getByText("Includes mock data")).toBeInTheDocument();
    // Real Claude usage is labelled separately from mock providers.
    expect(within(usage).getAllByText("REAL")).toHaveLength(1);
    expect(within(usage).getAllByText("MOCK")).toHaveLength(3);
    expect(within(usage).getByTestId("claude-usage")).toHaveTextContent("Cache reads (month)500");
    for (const p of ["Claude", "OpenAI", "Grok", "Local logic"])
      expect(within(usage).getByText(p)).toBeInTheDocument();

    expect(screen.getByRole("article", { name: "Live view: Group Manager" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Current tasks" })).toHaveTextContent(
      "Research European EASA flight schools",
    );
    expect(screen.getByRole("region", { name: "Activity stream" })).toHaveTextContent(
      "Extracted course data",
    );
    expect(screen.getByText("Dev seed data")).toBeInTheDocument();
  });

  it("hides Add company from users without company.create", () => {
    render(
      <SessionProvider me={ME_EPT_MANAGER}>
        <CommandCentreView summary={SUMMARY} sessions={[]} />
      </SessionProvider>,
    );
    expect(screen.queryByRole("link", { name: /Add company/ })).not.toBeInTheDocument();
  });

  it("marks the selected company when scoped", () => {
    render(
      <CommandCentreView summary={{ ...SUMMARY, scope: SUMMARY.companies[2]! }} sessions={[]} />,
    );
    const link = screen.getByRole("link", { name: /Opportunitygrad \(selected/ });
    expect(link).toHaveAttribute("aria-current", "true");
    expect(screen.getByText("No live sessions")).toBeInTheDocument();
  });
});
