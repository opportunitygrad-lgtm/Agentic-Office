import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@aibos/shared";

/** Pages reachable without a session. */
export const PUBLIC_PATHS = [
  "/login",
  "/forgot-password",
  "/reset-password",
  "/account-disabled",
  "/invite",
];

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/**
 * Optimistic gate: requests without a session cookie are redirected to
 * /login before rendering. The session itself is validated by the API on
 * every request (the (app) layout redirects if it is invalid or expired).
 */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (isPublicPath(pathname)) return NextResponse.next();
  if (request.cookies.get(SESSION_COOKIE)?.value) return NextResponse.next();
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  // Skip API proxy, Next internals and static assets.
  matcher: ["/((?!api/|_next/static|_next/image|icon.svg|favicon.ico).*)"],
};
