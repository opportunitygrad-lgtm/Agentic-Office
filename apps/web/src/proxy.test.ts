// @vitest-environment node
import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { SESSION_COOKIE } from "@aibos/shared";
import { isPublicPath, proxy } from "./proxy";

const req = (path: string, cookie?: string) =>
  new NextRequest(new URL(path, "http://localhost:3000"), {
    headers: cookie ? { cookie: `${SESSION_COOKIE}=${cookie}` } : {},
  });

describe("route protection (proxy)", () => {
  it("redirects unauthenticated requests for protected pages to /login with next", () => {
    const res = proxy(req("/workforce/agents?company=opportunitygrad"));
    expect(res.status).toBe(307);
    const location = new URL(res.headers.get("location")!);
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("next")).toBe("/workforce/agents?company=opportunitygrad");
  });

  it("lets public auth pages and requests with a session through", () => {
    for (const p of [
      "/login",
      "/forgot-password",
      "/reset-password",
      "/account-disabled",
      "/invite/abc",
    ]) {
      expect(isPublicPath(p)).toBe(true);
      expect(proxy(req(p)).headers.get("location")).toBeNull();
    }
    expect(proxy(req("/", "some-session-token")).headers.get("location")).toBeNull();
    expect(isPublicPath("/loginx")).toBe(false);
  });
});
