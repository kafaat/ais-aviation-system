/**
 * Base Playwright test fixture.
 *
 * Pre-seeds the cookie-consent localStorage key BEFORE any page script runs, so
 * the CookieConsent banner (a fixed, z-[9999] bottom dialog) never renders
 * during tests. In CI the banner overlays the viewport and intercepts pointer
 * events ("subtree intercepts pointer events"), causing widespread click/fill
 * timeouts across auth/checkout/admin/currency flows.
 *
 * All e2e specs should import { test, expect } from this module instead of
 * "@playwright/test".
 */
import { test as base, expect } from "@playwright/test";

// Must match the StoredConsent shape, CONSENT_STORAGE_KEY and CONSENT_VERSION
// in client/src/components/CookieConsent.tsx. getStoredConsent() requires the
// top-level `version` field to equal CONSENT_VERSION and a nested `preferences`
// object; otherwise it treats consent as absent and shows the banner.
const CONSENT_STORAGE_KEY = "ais_cookie_consent";
const CONSENT_VERSION = "1.0";

const dismissedConsent = JSON.stringify({
  version: CONSENT_VERSION,
  preferences: {
    essential: true,
    analytics: false,
    marketing: false,
    preferences: false,
  },
  timestamp: new Date().toISOString(),
});

export const test = base.extend({
  page: async ({ page }, use) => {
    // addInitScript runs in the page context before any app code on every
    // navigation, so the consent banner is pre-dismissed on first paint.
    await page.addInitScript(
      ([key, value]) => {
        try {
          window.localStorage.setItem(key, value);
        } catch {
          /* localStorage may be unavailable in some contexts; ignore */
        }
      },
      [CONSENT_STORAGE_KEY, dismissedConsent]
    );
    await use(page);
  },
});

export { expect };
