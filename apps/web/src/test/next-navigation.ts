import { vi } from "vitest";

/** Shared mock for next/navigation used by client components under test. */
export const routerMock = {
  push: vi.fn(),
  refresh: vi.fn(),
  replace: vi.fn(),
  back: vi.fn(),
  prefetch: vi.fn(),
};
export const navState = { pathname: "/", search: "" };

vi.mock("next/navigation", () => ({
  useRouter: () => routerMock,
  usePathname: () => navState.pathname,
  useSearchParams: () => new URLSearchParams(navState.search),
}));
