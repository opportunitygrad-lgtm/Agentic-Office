import { expect, test, type Page } from "@playwright/test";

/**
 * Stage 04 workforce flows (requires `pnpm dev` and the development seed).
 * Uses the DEVELOPMENT SEED accounts documented in docs/DEVELOPMENT.md.
 */
const PASSWORD = "aibos-dev-only-password";

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}

async function idOf(page: Page, path: string, key: "name" | "title", value: string) {
  const body = (await (await page.request.get(`/api/v1${path}`)).json()) as {
    data: Record<string, string>[];
  };
  return body.data.find((x) => x[key] === value)!.id!;
}

test("platform owner: org chart, role versioning, instruction preview, delegation", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await signIn(page, "owner@aibos.example");

  await page.goto("/workforce/organisation");
  await expect(page.getByRole("heading", { level: 1, name: "Organisation chart" })).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Euro Pilot Training" }).getByText("EPT Company Manager"),
  ).toBeVisible();
  await expect(
    page.getByRole("list", { name: "EPT Flight School Research temporary workers" }),
  ).toContainText("Portugal Research Worker");

  const agentId = await idOf(page, "/agents?company=euro-pilot-training", "name", "EPT Marketing");
  await page.goto(`/workforce/agents/${agentId}?tab=role`);
  const summary = `E2E focus ${Date.now()}`;
  await page
    .getByRole("textbox", { name: "Mission" })
    // Unique per run so the form is dirty even when a previous run saved a version.
    .fill(`Attract qualified international pilot-training candidates across Europe (${summary}).`);
  await page.getByLabel(/Change summary/).fill(summary);
  await page.getByRole("button", { name: "Save new version" }).click();
  await expect(page.getByRole("status").filter({ hasText: /Saved as version \d+/ })).toBeVisible();
  await expect(page.getByRole("list", { name: "Role versions" })).toContainText(summary);

  await page.goto(`/workforce/agents/${agentId}?tab=instructions`);
  const layers = page.getByRole("list", { name: "Instruction layers" });
  await expect(layers.getByRole("heading", { name: "1. Platform safety" })).toBeVisible();
  await expect(layers.getByRole("heading", { name: "3. Company rules & AI policy" })).toBeVisible();

  const taskId = await idOf(
    page,
    "/tasks?company=euro-pilot-training&limit=200",
    "title",
    "Find EASA flight schools in Portugal",
  );
  await page.goto(`/tasks/item/${taskId}`);
  await expect(page.getByTestId("delegation-recommendation")).toBeVisible();
  await expect(page.getByLabel("Capability: failed").first()).toBeVisible();
  await page
    .getByLabel(/^(Assign|Reassign) to$/)
    .selectOption({ label: "EPT Flight School Research — override" });
  await page.getByLabel(/Reason \(required for override\)/).fill("Owns partner research");
  await page.getByRole("button", { name: /^(Assign|Reassign)$/ }).click();
  await expect(page.getByText("Task delegated.")).toBeVisible();
  await expect(page.getByText("Reason: Owns partner research").first()).toBeVisible();
});

test("company manager: own workforce only; no global teams", async ({ page }) => {
  await signIn(page, "ept.manager@aibos.example");
  await page.goto("/workforce/organisation");
  await expect(page.getByRole("region", { name: "Euro Pilot Training" })).toBeVisible();
  await expect(page.getByRole("region", { name: "PilotsAssist" })).toHaveCount(0);

  await page.goto("/workforce/teams");
  await page.getByRole("button", { name: "New team" }).click();
  await expect(page.getByRole("option", { name: "Global team (all companies)" })).toHaveCount(0);
  await page.keyboard.press("Escape");

  // API enforcement, not just UI: another company's agent and a global team are refused.
  const ownerless = await page.request.put("/api/v1/workforce/policy", {
    data: { globalActiveAgentLimit: 99 },
  });
  expect(ownerless.status()).toBe(403);
  const global = await page.request.post("/api/v1/teams", {
    data: { companyId: null, name: "Sneaky global", memberIds: [] },
  });
  expect(global.status()).toBe(403);
  const pa = await page.request.get("/api/v1/agents?company=pilotsassist");
  expect(pa.status()).toBe(403);
});

test("department manager: limited to own department", async ({ page }) => {
  await signIn(page, "og.marketing@aibos.example");
  await page.goto("/workforce/teams");
  await expect(page.getByRole("heading", { level: 1, name: "Teams & departments" })).toBeVisible();
  await expect(page.getByRole("button", { name: "New team" })).toHaveCount(0);
  const taskId = await idOf(page, "/tasks?limit=200", "title", "Review Meta campaign performance");
  await page.goto(`/tasks/item/${taskId}`);
  await expect(page.getByRole("heading", { name: "Delegation & assignment" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Accept recommendation" })).toHaveCount(0);
  const res = await page.request.post(`/api/v1/tasks/${taskId}/delegate`, { data: {} });
  expect(res.status()).toBe(403);
});
