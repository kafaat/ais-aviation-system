import type { Page } from "@playwright/test";

/** Anonymous preference only; authenticated accounts use the server writer. */
export async function prepareAnonymousConsent(page: Page) {
  await page.addInitScript(() => {
    // A refused iframe has an opaque browser error document, not app storage.
    if (
      !["http:", "https:"].includes(window.location.protocol) ||
      window.origin === "null"
    )
      return;
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
