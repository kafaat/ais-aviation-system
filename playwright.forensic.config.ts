import { defineConfig, devices } from "@playwright/test";

// Standalone profile: every actor/reference belongs to the selected test. No
// auth-provider setup or existing server is borrowed from another invocation.
process.env.E2E_BASE_URL ??= "http://127.0.0.1:3201";
const origin = new URL(process.env.E2E_BASE_URL);
if (
  origin.protocol !== "http:" ||
  !["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname)
)
  throw new Error("Forensic browser acceptance requires an owned loopback app");
const report = process.env.AIS_E2E_REPORT_DIR || "test-results/forensic";
export default defineConfig({
  testDir: "./e2e",
  testMatch: "forensic-consumers.spec.ts",
  timeout: 60000,
  globalTimeout: 8 * 60000,
  expect: { timeout: 15000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  outputDir: report,
  reporter: [["list"], ["json", { outputFile: `${report}/results.json` }]],
  use: {
    baseURL: origin.origin,
    locale: "en-GB",
    timezoneId: "UTC",
    actionTimeout: 15000,
    navigationTimeout: 30000,
    trace: "off",
    video: "off",
    screenshot: "off",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: {
          chromiumSandbox: true,
          executablePath: process.env.AIS_TEST_CHROMIUM_BIN,
        },
      },
    },
  ],
  webServer: {
    command: "node dist/index.js",
    env: {
      NODE_ENV: "test",
      PORT: origin.port || "80",
      AIS_PROVIDER_BOUNDARY: "isolated",
    },
    url: origin.origin,
    reuseExistingServer: false,
    timeout: 120000,
    stdout: "pipe",
    stderr: "pipe",
    gracefulShutdown: { signal: "SIGTERM", timeout: 10000 },
  },
});
