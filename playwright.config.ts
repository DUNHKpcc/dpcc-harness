import { defineConfig } from "@playwright/test";

const ci = process.env.CI === "true";

export default defineConfig({
  testDir: "./tests/ui",
  testMatch: "**/*.e2e.ts",
  outputDir: "test-results/playwright-ui",
  fullyParallel: false,
  workers: 1,
  forbidOnly: ci,
  retries: ci ? 1 : 0,
  timeout: 60_000,
  expect: {
    timeout: 12_000,
  },
  reporter: ci
    ? [["line"], ["html", { outputFolder: "playwright-report", open: "never" }]]
    : [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],
  webServer: {
    command: "pnpm exec vite --host 127.0.0.1 --port 4173",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: !ci,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
