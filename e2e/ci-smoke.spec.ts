import { selectDepartureDate } from "./fixtures/test-helpers";
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

    // The production bundler must retain side-effect-only i18n bootstrap.
    // Visibility alone also passes when the untranslated key is rendered.
    await expect(page.locator("#hero-title")).toHaveText(
      "Book Your Next Flight"
    );
    await expect(page.getByTestId("home-origin-select")).toBeVisible();
    await expect(page.getByTestId("home-destination-select")).toBeVisible();

    const departureDateTrigger = page.getByTestId("home-date-trigger");
    await expect(departureDateTrigger).toBeVisible();
    await departureDateTrigger.click();
    await expect(page.locator('[data-slot="calendar"]')).toBeVisible();

    await expect(page.getByTestId("home-search-button")).toBeDisabled();
  });

  for (const language of ["en", "ar"]) {
    test(`calendar selection reaches search in ${language} across a year boundary`, async ({
      page,
    }) => {
      await page.addInitScript(
        lang => localStorage.setItem("i18nextLng", lang),
        language
      );
      await page.goto("/");
      await page.getByTestId("home-origin-select").click();
      await page.getByRole("option", { name: /RUH/ }).click();
      await page.getByTestId("home-destination-select").click();
      await page.getByRole("option", { name: /JED/ }).click();
      const date = new Date(
        Date.UTC(new Date().getUTCFullYear() + 1, 0, 1, 12)
      );
      await selectDepartureDate(page, date);
      await page.getByTestId("home-search-button").click();
      await expect(page).toHaveURL(/\/search\?/);
      const selectedDate = new URL(page.url()).searchParams.get("date");
      expect(selectedDate).toBeTruthy();
      const localDate = await page.evaluate(value => {
        const selected = new Date(value!);
        return [
          selected.getFullYear(),
          selected.getMonth(),
          selected.getDate(),
        ];
      }, selectedDate);
      expect(localDate).toEqual([date.getUTCFullYear(), 0, 1]);
    });
  }

  test("login renders the combined authentication form", async ({ page }) => {
    await page.goto("/login");

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
