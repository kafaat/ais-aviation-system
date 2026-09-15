import type { Page } from "@playwright/test";

/** Anonymous preference only; authenticated accounts use the server writer. */
export async function prepareAnonymousConsent(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem(
      "ais_cookie_consent",
      JSON.stringify({
        version: "1.0",
        preferences: {
          essential: true,
          analytics: false,
          marketing: false,
          preferences: false,
        },
        timestamp: new Date().toISOString(),
      })
    );
  });
}
