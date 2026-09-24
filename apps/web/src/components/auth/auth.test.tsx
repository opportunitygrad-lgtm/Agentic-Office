import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { routerMock } from "@/test/next-navigation";
import { ME_OWNER } from "@/test/fixtures";
import { SessionProvider } from "../shell/SessionContext";
import { UserMenu } from "../shell/UserMenu";
import { Unauthorised } from "../common/Unauthorised";
import { safeNext } from "./AuthForm";
import { LoginForm } from "./LoginForm";

const json = (status: number, body: unknown = {}) => new Response(JSON.stringify(body), { status });

describe("LoginForm", () => {
  beforeEach(() => {
    routerMock.replace.mockClear();
    routerMock.push.mockClear();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("signs in and redirects to the requested page", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(200, { ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<LoginForm next="/approvals" />);
    await user.type(screen.getByLabelText("Email"), "owner@aibos.example");
    await user.type(screen.getByLabelText("Password"), "aibos-dev-only-password");
    await user.click(screen.getByRole("button", { name: /Sign in/ }));
    await waitFor(() => expect(routerMock.replace).toHaveBeenCalledWith("/approvals"));
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/v1/auth/login");
    expect(JSON.parse(init.body as string)).toEqual({
      email: "owner@aibos.example",
      password: "aibos-dev-only-password",
    });
  });

  it("shows a generic error on bad credentials and routes disabled accounts", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(json(401, { error: { code: "invalid_credentials" } }))
        .mockResolvedValueOnce(json(403, { error: { code: "account_disabled" } })),
    );
    const user = userEvent.setup();
    render(<LoginForm />);
    await user.type(screen.getByLabelText("Email"), "x@aibos.example");
    await user.type(screen.getByLabelText("Password"), "wrong");
    await user.click(screen.getByRole("button", { name: /Sign in/ }));
    expect(await screen.findByText("Invalid email or password.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Sign in/ }));
    await waitFor(() => expect(routerMock.push).toHaveBeenCalledWith("/account-disabled"));
  });

  it("never redirects off-site after sign-in", () => {
    expect(safeNext("//evil.example")).toBe("/");
    expect(safeNext("https://evil.example")).toBe("/");
    expect(safeNext("/\\evil")).toBe("/");
    expect(safeNext("/tasks/active")).toBe("/tasks/active");
  });
});

describe("UserMenu", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("shows the Platform Owner identity and signs out", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(
      <SessionProvider me={ME_OWNER}>
        <UserMenu />
      </SessionProvider>,
    );
    await user.click(screen.getByRole("button", { name: /Account menu for Platform Owner/ }));
    expect(screen.getByText(/Platform Owner · all companies/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(routerMock.replace).toHaveBeenCalledWith("/login"));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/auth/logout",
      expect.objectContaining({ method: "POST" }),
    );
  });
});

describe("Unauthorised state", () => {
  it("explains missing access without revealing details", () => {
    render(<Unauthorised />);
    expect(screen.getByRole("alert")).toHaveTextContent("You don't have access");
    expect(screen.getByRole("link", { name: "Back to Command Centre" })).toHaveAttribute(
      "href",
      "/",
    );
  });
});
