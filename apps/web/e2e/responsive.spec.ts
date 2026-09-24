import { expect, test, type Page } from "@playwright/test";

/**
 * E2E smoke (requires `pnpm dev` and the development seed). Signs in with the
 * DEVELOPMENT SEED accounts documented in docs/DEVELOPMENT.md.
 */
const PASSWORD = "aibos-dev-only-password";
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
  "/settings/users",
  "/settings/roles",
  "/settings/knowledge",
  "/companies/euro-pilot-training",
  "/companies/euro-pilot-training?tab=business",
  "/companies/euro-pilot-training?tab=brand",
  "/companies/opportunitygrad?tab=commercial",
  "/companies/euro-pilot-training?tab=compliance",
  "/companies/euro-pilot-training?tab=ai",
  "/companies/euro-pilot-training?tab=knowledge",
  "/companies/euro-pilot-training?tab=history",
  "/leads",
];
const WIDTHS = [1920, 1440, 1280, 1024, 768, 390];

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}

test("unauthenticated visitors are redirected to sign in", async ({ page }) => {
  await page.goto("/approvals");
  await expect(page).toHaveURL(/\/login\?next=%2Fapprovals/);
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
});

test("sign in, see only permitted companies, sign out", async ({ page }) => {
  await signIn(page, "ept.manager@aibos.example");
  await expect(page.getByRole("heading", { level: 1, name: "Command Centre" })).toBeVisible();
  const companies = page.getByRole("region", { name: "Companies" });
  await expect(companies.getByText("Euro Pilot Training", { exact: true })).toBeVisible();
  await expect(companies.getByText("PilotsAssist", { exact: true })).toHaveCount(0);
  await page.goto("/?company=pilotsassist");
  await expect(page.getByRole("heading", { name: "You don't have access" })).toBeVisible();
  await page.getByRole("button", { name: /Account menu/ }).click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);
});

test("no horizontal overflow on any page at target widths", async ({ page }) => {
  test.setTimeout(240_000);
  await signIn(page, "owner@aibos.example");
  const agents = (await (
    await page.request.get("/api/v1/agents?company=euro-pilot-training")
  ).json()) as {
    data: { id: string; name: string }[];
  };
  const tasks = (await (
    await page.request.get("/api/v1/tasks?company=euro-pilot-training")
  ).json()) as {
    data: { id: string; title: string }[];
  };
  const dynamic = [
    `/workforce/agents/${agents.data.find((a) => a.name === "EPT Marketing")!.id}`,
    `/tasks/item/${tasks.data.find((t) => t.title === "Draft partnership introduction emails")!.id}`,
  ];
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of [...ROUTES, ...dynamic]) {
      const res = await page.goto(route);
      expect(res?.status(), route).toBe(200);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(overflow, `${route} overflows at ${width}px`).toBeLessThanOrEqual(0);
    }
  }
  for (const route of ["/login", "/forgot-password", "/account-disabled"]) {
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto(route);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
    ).toBeLessThanOrEqual(0);
  }
});

test("knowledge library, lifecycle drawer and context preview", async ({ page }) => {
  await signIn(page, "ept.manager@aibos.example");
  await page.goto("/companies/euro-pilot-training?tab=knowledge");
  await expect(page.getByTestId("knowledge-library")).toBeVisible();
  // RESTRICTED banking details are hidden from a manager without clearance.
  await expect(page.getByText("Banking and payment details")).toHaveCount(0);
  await page.getByText("Enquiry reply standards").first().click();
  const drawer = page.getByTestId("knowledge-drawer");
  await expect(drawer.getByText("Where did this come from?")).toBeVisible();
  await expect(drawer.getByRole("button", { name: "Edit (new version)" })).toBeVisible();
  await page.keyboard.press("Escape");
  // Other companies are not reachable by URL manipulation.
  await page.goto("/companies/pilotsassist");
  await expect(page.getByRole("heading", { name: "You don't have access" })).toBeVisible();
  // Task → Agent context shows linked knowledge first, with a reason.
  await page.goto("/tasks/queue?company=euro-pilot-training");
  await page.getByRole("link", { name: "Draft partnership introduction emails" }).click();
  const preview = page.getByTestId("context-preview");
  await expect(preview.getByText("Flight-school partnership approach")).toBeVisible();
  await expect(preview.getByText("Explicitly linked to task").first()).toBeVisible();
  await expect(preview.getByText(/PilotsAssist|Opportunitygrad/)).toHaveCount(0);
});
