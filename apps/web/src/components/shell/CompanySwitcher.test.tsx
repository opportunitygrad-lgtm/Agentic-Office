import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { navState, routerMock } from "@/test/next-navigation";
import { ept, og, pa } from "@/test/fixtures";
import { CompanySwitcher } from "./CompanySwitcher";

describe("CompanySwitcher", () => {
  beforeEach(() => {
    routerMock.push.mockClear();
    navState.pathname = "/";
    navState.search = "";
  });

  it("switches from the global scope to a company", async () => {
    const user = userEvent.setup();
    render(<CompanySwitcher companies={[ept, pa, og]} />);
    const button = screen.getByRole("button", { name: "Company scope: All companies" });
    await user.click(button);
    const listbox = screen.getByRole("listbox", { name: "Select company scope" });
    expect(listbox).toBeInTheDocument();
    expect(screen.getAllByRole("option")).toHaveLength(4);
    await user.click(screen.getByRole("option", { name: /Opportunitygrad/ }));
    expect(routerMock.push).toHaveBeenCalledWith("/?company=opportunitygrad");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("supports keyboard selection and preserves the current page", async () => {
    const user = userEvent.setup();
    navState.pathname = "/workforce/agents";
    navState.search = "company=pilotsassist";
    render(<CompanySwitcher companies={[ept, pa, og]} />);
    expect(screen.getByRole("button", { name: "Company scope: PilotsAssist" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Company scope/ }));
    expect(screen.getByRole("option", { name: /PilotsAssist/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await user.keyboard("{Home}{Enter}");
    expect(routerMock.push).toHaveBeenCalledWith("/workforce/agents");
  });
});
