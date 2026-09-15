/** All E2E specs share anonymous consent; registered users are prepared through
 * the server consent writer in global setup. */
import { test as base, expect } from "@playwright/test";
import { prepareAnonymousConsent } from "./consent";

export const test = base.extend({
  page: async ({ page }, use, testInfo) => {
    const failures: string[] = [];
    const record = (message: string) => {
      if (failures.length < 20) failures.push(message.slice(0, 1200));
    };
    page.on("pageerror", error => record(error.message));
    page.on("response", response => {
      const url = new URL(response.url());
      if (response.status() >= 400 && url.pathname.startsWith("/api/"))
        record(`${response.status()} ${url.pathname}`);
    });
    await prepareAnonymousConsent(page);
    await use(page);
    if (testInfo.status !== testInfo.expectedStatus) {
      // Only page errors and HTTP status/path, never request/response bodies,
      // console arguments, query strings, cookies or authorization headers.
      console.info("[e2e-browser-errors]", JSON.stringify(failures));
    }
  },
});

export { expect };
