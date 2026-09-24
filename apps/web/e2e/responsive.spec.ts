import { expect, test } from "@playwright/test";

/**
 * Stage 01 E2E smoke: every primary route renders without page-level
 * horizontal overflow at the target breakpoints. Requires `pnpm dev`.
 */
const ROUTES = [
  "/",
  "/companies",
  "/companies/new",
  "/workforce/agents",
  "/workforce/templates",
  "/workforce/teams",
  "/tasks/active",
  "/live",
  "/approvals",
  "/audit",
  "/integrations",
  "/settings",
  "/leads",
];
const WIDTHS = [1920, 1440, 1280, 1024, 768, 390];

for (const width of WIDTHS) {
  test(`no horizontal overflow at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    for (const route of ROUTES) {
      const res = await page.goto(route);
      expect(res?.status(), route).toBe(200);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(overflow, `${route} overflows at ${width}px`).toBeLessThanOrEqual(0);
    }
  });
}

test("command centre shows the three seeded companies and navigation works", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Command Centre" })).toBeVisible();
  for (const name of ["Euro Pilot Training", "PilotsAssist", "Opportunitygrad"]) {
    await expect(
      page.getByRole("region", { name: "Companies" }).getByText(name, { exact: true }),
    ).toBeVisible();
  }
  await page
    .getByRole("navigation", { name: "Primary" })
    .getByRole("link", { name: "Audit Log" })
    .click();
  await expect(page.getByRole("heading", { level: 1, name: "Audit log" })).toBeVisible();
});
