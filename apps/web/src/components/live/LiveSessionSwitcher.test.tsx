import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { SESSIONS } from "@/test/fixtures";
import { LiveSessionSwitcher } from "./LiveSessionSwitcher";

describe("LiveSessionSwitcher", () => {
  it("switches between mock live sessions by click and keyboard", async () => {
    const user = userEvent.setup();
    render(<LiveSessionSwitcher sessions={SESSIONS} />);
    expect(screen.getByRole("article", { name: "Live view: Group Manager" })).toBeInTheDocument();
    expect(screen.getByTestId("live-location")).toHaveTextContent(
      "AI Business OS — Operations board",
    );

    await user.click(screen.getByRole("tab", { name: /EPT Flight School Research/ }));
    expect(
      screen.getByRole("article", { name: "Live view: EPT Flight School Research" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("live-location")).toHaveTextContent("easa.europa.eu");
    expect(screen.getByRole("tab", { name: /EPT Flight School Research/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("article", { name: "Live view: Group Manager" })).toBeInTheDocument();
  });

  it("keeps live controls disabled until later stages", () => {
    render(<LiveSessionSwitcher sessions={SESSIONS} />);
    const toolbar = screen.getByRole("toolbar", { name: "Session controls" });
    for (const name of ["Pause", "Stop", "Message agent", "Take control", "Return control"]) {
      expect(screen.getByRole("button", { name })).toBeDisabled();
    }
    expect(toolbar).toContainElement(screen.getByRole("button", { name: "Full screen" }));
    expect(screen.getByRole("button", { name: "Full screen" })).toBeEnabled();
  });
});
