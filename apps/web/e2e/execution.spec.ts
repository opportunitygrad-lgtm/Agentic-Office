import { expect, test, type BrowserContext, type Page } from "@playwright/test";

test.describe.configure({ mode: "serial" });

/**
 * Stage 05 execution flows. Deterministic: runs ONLY against a stack started
 * with AIBOS_AI_PROVIDER_MODE=mock AIBOS_MOCK_CHUNK_DELAY_MS=150 (the worker uses MockClaudeProvider), so
 * `pnpm test:e2e` never consumes Claude credit. Live checks live in
 * `pnpm test:claude-live` behind ALLOW_LIVE_AI_TESTS=true.
 */
const PASSWORD = "aibos-dev-only-password";
const ORIGIN = { origin: "http://localhost:3000" };

/**
 * One real sign-in per user for the whole file (the login throttle allows 30
 * per IP per 15 minutes); later tests reuse the saved session cookies.
 */
const sessions = new Map<string, Awaited<ReturnType<BrowserContext["storageState"]>>>();
async function signIn(page: Page, email: string) {
  const saved = sessions.get(email);
  if (saved) {
    await page.context().clearCookies();
    await page.context().addCookies(saved.cookies);
    await page.goto("/");
    return;
  }
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
  sessions.set(email, await page.context().storageState());
}

async function requireMock(page: Page) {
  const res = await page.request.get("/api/v1/providers");
  const body = (await res.json()) as { mode?: string };
  test.skip(
    body.mode !== "mock",
    "Execution E2E runs only with AIBOS_AI_PROVIDER_MODE=mock (no live AI in automated suites)",
  );
}

async function newAssignedTask(page: Page, title: string) {
  const tasks = (await (
    await page.request.get("/api/v1/companies/euro-pilot-training")
  ).json()) as { data: { id: string } };
  const created = (await (
    await page.request.post("/api/v1/tasks", {
      data: {
        companyId: tasks.data.id,
        title,
        description:
          "Produce a short internal operational brief. Do not perform external research.",
        type: "custom",
        onDuplicate: "create",
      },
      headers: ORIGIN,
    })
  ).json()) as { data: { task: { id: string } } };
  const agents = (await (
    await page.request.get("/api/v1/agents?q=EPT%20Company%20Manager")
  ).json()) as { data: { id: string; name: string }[] };
  const manager = agents.data.find((a) => a.name === "EPT Company Manager")!;
  await page.request.post(`/api/v1/tasks/${created.data.task.id}/assign`, {
    data: { agentId: manager.id },
    headers: ORIGIN,
  });
  return { taskId: created.data.task.id, managerId: manager.id };
}

test("task run: preview → run in worker → live timeline → result → history → feedback", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await signIn(page, "ept.manager@aibos.example");
  await requireMock(page);
  const { taskId } = await newAssignedTask(page, `E2E brief ${Date.now()}`);
  await page.goto(`/tasks/item/${taskId}`);
  const preview = page.getByTestId("provider-preview");
  await expect(preview).toContainText("Claude Sonnet");
  // Default transport: the owner's Claude Code subscription — no API spend.
  await expect(page.getByTestId("estimated-cost")).toHaveText("Included in subscription");
  await expect(preview).toContainText(/medium/i);
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(page.getByTestId("live-run-panel")).toBeVisible();
  await expect(page.getByTestId("run-result")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("run-timeline")).toContainText("Usage recorded");
  await expect(page.getByTestId("run-history")).toContainText("#1");
  await page.getByRole("button", { name: "Useful", exact: true }).click();
  await expect(page.getByRole("button", { name: "Useful", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("agent chat: streamed reply with model indicator; company shown", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, "ept.manager@aibos.example");
  await requireMock(page);
  const { managerId } = await newAssignedTask(page, `E2E chat ${Date.now()}`);
  await page.goto(`/workforce/agents/${managerId}?tab=chat`);
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "New conversation" }).click();
  await expect(page.getByText(/Company: Euro Pilot Training/)).toBeVisible();
  await page.getByLabel("Message", { exact: true }).fill("What is your current responsibility?");
  await page.getByRole("button", { name: "Send" }).click();
  const messages = page.getByTestId("chat-messages");
  await expect(messages).toContainText("Claude Sonnet", { timeout: 60_000 });
  await expect(messages).toContainText("What is your current responsibility?");
});

test("provider settings: status visible, test connection limited to platform roles, no credentials", async ({
  page,
}) => {
  await signIn(page, "ept.manager@aibos.example");
  await page.goto("/settings/providers");
  await expect(page.getByTestId("provider-CLAUDE")).toBeVisible();
  await expect(page.getByRole("button", { name: /Test Claude/ })).toHaveCount(0);
  // Claude Code card: subscription login, never an API-key or password field.
  await expect(page.getByTestId("provider-CLAUDE")).toContainText("Included subscription usage");
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
  const html = await page.content();
  expect(html).not.toMatch(/sk-ant|ANTHROPIC_API_KEY=/);
  expect(
    (await page.request.post("/api/v1/providers/CLAUDE/test", { headers: ORIGIN })).status(),
  ).toBe(403);
});

test("company isolation: another company's manager cannot run or view EPT runs", async ({
  page,
}) => {
  await signIn(page, "ept.manager@aibos.example");
  await requireMock(page);
  const { taskId } = await newAssignedTask(page, `E2E isolation ${Date.now()}`);
  const run = (await (
    await page.request.post(`/api/v1/tasks/${taskId}/runs`, { data: {}, headers: ORIGIN })
  ).json()) as { data: { run: { id: string } } };
  await signIn(page, "pa.manager@aibos.example");
  expect(
    (
      await page.request.post(`/api/v1/tasks/${taskId}/runs`, { data: {}, headers: ORIGIN })
    ).status(),
  ).toBe(404);
  expect((await page.request.get(`/api/v1/runs/${run.data.run.id}`)).status()).toBe(404);
});

test("stop run: cancellation reaches the worker and the run ends CANCELLED", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, "ept.manager@aibos.example");
  await requireMock(page);
  const { taskId } = await newAssignedTask(page, `E2E stop ${Date.now()}`);
  await page.goto(`/tasks/item/${taskId}`);
  await page.getByRole("button", { name: "Run", exact: true }).click();
  const panel = page.getByTestId("live-run-panel");
  await expect(panel).toBeVisible();
  // Stop mid-stream so the cancel must reach the worker's in-flight provider call.
  await expect(page.getByTestId("run-output")).not.toBeEmpty({ timeout: 30_000 });
  await page.getByRole("button", { name: /^Stop/ }).first().click();
  await expect(page.getByTestId("run-history")).toContainText(/Stopped|Cancelled/i, {
    timeout: 60_000,
  });
});

test("second opinion: Ask OpenAI to review a completed Claude run — both results visible, original preserved", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await signIn(page, "ept.manager@aibos.example");
  await requireMock(page);
  const { taskId } = await newAssignedTask(page, `E2E second opinion ${Date.now()}`);
  await page.goto(`/tasks/item/${taskId}`);
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(page.getByTestId("live-run-panel")).toBeVisible();
  const result = page.getByTestId("run-result");
  await expect(result).toBeVisible({ timeout: 60_000 });
  const originalText = await result.textContent();

  const askButton = page.getByRole("button", { name: "Ask OpenAI to review" });
  await expect(askButton).toBeVisible();
  await askButton.click();
  await expect(page.getByText(/Second-opinion review requested from OpenAI/)).toBeVisible();

  const runs = (await (
    await page.request.get(`/api/v1/tasks/${taskId}/runs`)
  ).json()) as { data: { id: string; purpose: string }[] };
  const primaryId = runs.data.find((r) => r.purpose === "primary")!.id;

  // The review runs as a separate background job; poll the API (not the DOM)
  // until it lands, then load the page once so the assertions below never
  // race a client-side fetch that hasn't resolved yet.
  await expect
    .poll(
      async () =>
        (
          (await (await page.request.get(`/api/v1/runs/${primaryId}`)).json()) as {
            data: { review: unknown };
          }
        ).data.review !== null,
      { timeout: 60_000, intervals: [1000] },
    )
    .toBe(true);
  await page.goto(`/tasks/item/${taskId}`);
  // A completed run's result lives in its history-row dialog, not inline —
  // open run #1 (the primary) to see it alongside its attached review.
  await page.getByTestId("run-history").getByRole("button", { name: /^#1/ }).click();

  // Both the original result AND the independent review are visible together —
  // the review is never merged into or replacing the original.
  await expect(page.getByTestId("run-result")).toBeVisible();
  await expect(page.getByTestId("run-result")).toHaveText(originalText ?? "");
  const review = page.getByTestId("review-card");
  await expect(review).toContainText("Second opinion");
  await expect(review).not.toContainText(/wins|winner/i);
  await expect(page.getByRole("button", { name: "Ask OpenAI to review" })).toHaveCount(0);
});

test("second opinion: cancelling an in-flight review stops it without touching the original run", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await signIn(page, "ept.manager@aibos.example");
  await requireMock(page);
  const { taskId } = await newAssignedTask(page, `E2E review cancel ${Date.now()}`);
  const created = (await (
    await page.request.post(`/api/v1/tasks/${taskId}/runs`, { data: {}, headers: ORIGIN })
  ).json()) as { data: { run: { id: string } } };
  const primaryId = created.data.run.id;
  await expect
    .poll(
      async () =>
        (
          (await (await page.request.get(`/api/v1/runs/${primaryId}`)).json()) as {
            data: { status: string };
          }
        ).data.status,
      { timeout: 30_000 },
    )
    .toBe("completed");

  const review = (await (
    await page.request.post(`/api/v1/runs/${primaryId}/review`, {
      data: { reviewerProvider: "OPENAI" },
      headers: ORIGIN,
    })
  ).json()) as { data: { run: { id: string } } };
  const reviewId = review.data.run.id;
  await page.request.post(`/api/v1/runs/${reviewId}/cancel`, { data: {}, headers: ORIGIN });
  await expect
    .poll(
      async () =>
        (
          (await (await page.request.get(`/api/v1/runs/${reviewId}`)).json()) as {
            data: { status: string };
          }
        ).data.status,
      { timeout: 30_000 },
    )
    .toMatch(/cancelled|cancel_requested/);

  // Cancelling the review never touches the original run's own completed result.
  const original = (await (await page.request.get(`/api/v1/runs/${primaryId}`)).json()) as {
    data: { status: string; result: unknown };
  };
  expect(original.data.status).toBe("completed");
  expect(original.data.result).not.toBeNull();
});
