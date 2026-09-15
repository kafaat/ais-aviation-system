import {
  chromium,
  type Browser,
  type BrowserContext,
  type FullConfig,
  type Page,
} from "@playwright/test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { disposableDatabaseUrl } from "../disposable-database";
import { prepareAnonymousConsent } from "./consent";
import { login } from "./test-helpers";
import { testUsers } from "./test-data";

type Account = "regular" | "admin";
type StorageState = Awaited<ReturnType<BrowserContext["storageState"]>>;

/** Two real UI logins, then isolated contexts reuse their authenticated cookies.
 * This keeps retries within the real IP login quota without disabling it. */
export async function prepareBrowserSessions(config: FullConfig) {
  disposableDatabaseUrl();
  const directory = await mkdtemp(join(tmpdir(), "ais-e2e-sessions-"));
  let browser: Browser | undefined;
  try {
    browser = await chromium.launch(
      config.projects.find(project => project.name === "chromium")?.use
        .launchOptions
    );
    for (const account of ["regular", "admin"] as const) {
      const context = await browser.newContext({
        baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
      });
      try {
        const page = await context.newPage();
        await prepareAnonymousConsent(page);
        await page.addInitScript(() =>
          localStorage.setItem("i18nextLng", "en")
        );
        await login(
          page,
          testUsers[account].email,
          testUsers[account].password
        );
        await writeFile(
          join(directory, `${account}.json`),
          JSON.stringify(await context.storageState()),
          { mode: 0o600 }
        );
      } finally {
        await context.close();
      }
    }
    // Outside test-results: authentication cookies must never enter CI artifacts.
    process.env.AIS_E2E_SESSION_DIRECTORY = directory;
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  } finally {
    await browser?.close();
  }
  return () => rm(directory, { recursive: true, force: true });
}

export async function useBrowserSession(page: Page, account: Account) {
  disposableDatabaseUrl();
  const directory = process.env.AIS_E2E_SESSION_DIRECTORY;
  if (!directory) throw new Error("Authenticated E2E setup is missing");
  const state: StorageState = JSON.parse(
    await readFile(join(directory, `${account}.json`), "utf8")
  );
  await page.context().clearCookies();
  await page.context().addCookies(state.cookies);
}
