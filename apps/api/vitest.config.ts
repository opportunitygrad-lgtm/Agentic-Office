import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: ["../../packages/db/test/global-setup.ts"],
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
