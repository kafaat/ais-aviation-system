import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright Configuration for E2E Tests
 * See https://playwright.dev/docs/test-configuration
 *
 * Environment Variables:
 * - E2E_BASE_URL: Base URL for tests (default: http://localhost:3000)
 * - CI: Set to true in CI environment
 */
export default defineConfig({
  testDir: "./e2e",

  /* Global timeout for each test */
  timeout: 60 * 1000,

  /* Expect timeout */
  expect: {
    timeout: 10 * 1000,
  },

  /* Run tests in files in parallel */
  fullyParallel: true,

  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,

  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,

  /* Limit workers on CI for stability */
  workers: process.env.CI ? 2 : undefined,

  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: process.env.CI
    ? [
        ["list"],
        ["json", { outputFile: "test-results/results.json" }],
        ["html", { open: "never" }],
        ["github"],
      ]
    : [
        ["html", { open: "on-failure" }],
        ["list"],
        ["json", { outputFile: "test-results/results.json" }],
      ],

  /* Output directory for test artifacts */
  outputDir: "test-results",

  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL to use in actions like `await page.goto('/')`. */
    baseURL: process.env.E2E_BASE_URL || "http://localhost:3000",

    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: "on-first-retry",

    /* Screenshot on failure */
    screenshot: "only-on-failure",

    /* Video on failure */
    video: "retain-on-failure",

    /* Browser context options */
    viewport: { width: 1280, height: 720 },

    /* Navigation timeout */
    navigationTimeout: 30 * 1000,

    /* Action timeout */
    actionTimeout: 15 * 1000,

    /* Locale for tests */
    locale: "ar-SA",

    /* Timezone */
    timezoneId: "Asia/Riyadh",

    /* Ignore HTTPS errors */
    ignoreHTTPSErrors: true,
  },

  /* Configure projects for major browsers */
  projects: [
    /* Setup project - can be used for global authentication */
    {
      name: "setup",
      testMatch: /.*\.setup\.ts/,
      teardown: "cleanup",
    },
    {
      name: "cleanup",
      testMatch: /.*\.teardown\.ts/,
    },

    /* Desktop browsers */
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: {
          args: process.env.CI ? ["--disable-gpu", "--no-sandbox"] : [],
        },
      },
      dependencies: ["setup"],
    },
    {
      name: "firefox",
      use: { ...devices["Desktop Firefox"] },
      dependencies: ["setup"],
    },
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"] },
      dependencies: ["setup"],
    },

    /* Mobile viewports */
    {
      name: "Mobile Chrome",
      use: { ...devices["Pixel 5"] },
      dependencies: ["setup"],
    },
    {
      name: "Mobile Safari",
      use: { ...devices["iPhone 12"] },
      dependencies: ["setup"],
    },

    /* Tablet viewport */
    {
      name: "Tablet",
      use: { ...devices["iPad (gen 7)"] },
      dependencies: ["setup"],
    },
  ],

  /* Run your local dev server before starting the tests */
  webServer: {
    command: process.env.CI ? "pnpm start" : "pnpm dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000,
    stdout: "pipe",
    stderr: "pipe",
  },

  /* Global setup and teardown */
  globalSetup: undefined, // Can be set to './e2e/global-setup.ts'
  globalTeardown: undefined, // Can be set to './e2e/global-teardown.ts'
});
