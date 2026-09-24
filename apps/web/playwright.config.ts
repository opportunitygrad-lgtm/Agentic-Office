import { defineConfig } from "@playwright/test";

/**
 * E2E / responsive smoke tests. Requires the stack running (pnpm dev).
 * Browser automation for agents (Stage 29) will live in packages/browser-core.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
      : {},
  },
  reporter: [["list"]],
});
