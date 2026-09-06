import { test, expect } from "@playwright/test";

const STORED_CONSENT = {
  version: "1.0",
  preferences: {
    essential: true,
    analytics: false,
    marketing: false,
    preferences: true,
  },
};

test.describe("CI smoke coverage", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(consent => {
      localStorage.setItem(
        "ais_cookie_consent",
        JSON.stringify({
          ...consent,
          timestamp: new Date().toISOString(),
        })
      );
      localStorage.setItem("i18nextLng", "en");
    }, STORED_CONSENT);
  });

  test("home renders the current one-way search controls", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    await expect(page.locator("#hero-title")).toBeVisible();
    await expect(page.getByTestId("home-origin-select")).toBeVisible();
    await expect(page.getByTestId("home-destination-select")).toBeVisible();

    const departureDateTrigger = page.getByTestId("home-date-trigger");
    await expect(departureDateTrigger).toBeVisible();
    await departureDateTrigger.click();
    await expect(page.locator('[data-slot="calendar"]')).toBeVisible();

    await expect(page.getByTestId("home-search-button")).toBeDisabled();
  });

  test("login renders the combined authentication form", async ({ page }) => {
    await page.goto("/login");
    await page.waitForLoadState("networkidle");

    await expect(page.getByLabel(/email|البريد الإلكتروني/i)).toBeVisible();
    await expect(page.locator("input#password")).toBeVisible();
    await expect(page.getByTestId("login-submit")).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: /don't have an account|ليس لديك حساب|create account|register/i,
      })
    ).toBeVisible();
  });
});
