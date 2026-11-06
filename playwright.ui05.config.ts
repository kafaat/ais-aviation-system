import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig, devices } from "@playwright/test";
import { chromiumSandboxEnv } from "./e2e/fixtures/chromium-sandbox-env";

// A dedicated launch owns both the actual built app and a loopback provider.
// This config must never reuse a separately running application or live Stripe.
// Keep this provider-specific profile outside the ordinary e2e test directory,
// so the default browser suite cannot launch it without its owned transport.
// Each financial journey registers and signs in its own retail customer. Five
// real logins fit the normal IP auth quota; financial writes remain isolated by
// authenticated user without resetting or bypassing the production limiter.
process.env.AIS_UI05_PROVIDER_FILE ??= join(
  tmpdir(),
  `ais-ui05-provider-${randomUUID()}.json`
);
export default defineConfig({
  testDir: "./browser-acceptance",
  testMatch: "ui05-financial-dialogs.spec.ts",
  globalTimeout: 10 * 60 * 1000,
  timeout: 60000,
  expect: { timeout: 10000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  outputDir: process.env.AIS_E2E_REPORT_DIR || "test-results/ui05",
  reporter: [
    ["list"],
    [
      "json",
      {
        outputFile: `${process.env.AIS_E2E_REPORT_DIR || "test-results/ui05"}/results.json`,
      },
    ],
    [
      "html",
      {
        outputFolder:
          process.env.AIS_E2E_HTML_REPORT_DIR || "playwright-report/ui05",
        open: "never",
      },
    ],
  ],
  use: {
    baseURL: process.env.E2E_BASE_URL || "http://localhost:3000",
    viewport: { width: 1280, height: 720 },
    locale: "en-GB",
    timezoneId: "Asia/Riyadh",
    navigationTimeout: 30000,
    actionTimeout: 15000,
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: {
          chromiumSandbox: true,
          env: chromiumSandboxEnv(),
          executablePath: process.env.AIS_TEST_CHROMIUM_BIN,
        },
      },
    },
  ],
  webServer: {
    command: "node --import tsx e2e/fixtures/ui05-financial-server.ts",
    env: { AIS_UI05_PROVIDER_FILE: process.env.AIS_UI05_PROVIDER_FILE },
    url: process.env.E2E_BASE_URL || "http://localhost:3000",
    reuseExistingServer: false,
    timeout: 120000,
    stdout: "pipe",
    stderr: "pipe",
    gracefulShutdown: { signal: "SIGTERM", timeout: 10000 },
  },
});
