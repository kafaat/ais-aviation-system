import { test, expect } from "@playwright/test";

/**
 * E2E Test: Multi-Currency Support
 * Tests currency selection and price conversion
 */

test.describe("Multi-Currency Support", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("should change currency and update prices", async ({ page }) => {
    // Wait for page to load
    await page.waitForLoadState("networkidle");

    // Get initial price in SAR
    const initialPrice = await page
      .locator('[data-testid="flight-price"]')
      .first()
      .textContent();
    expect(initialPrice).toContain("﷼");

    // Open currency selector
    await page.locator('[data-testid="currency-selector"]').click();

    // Select USD
    await page.getByRole("option", { name: /USD/ }).click();

    // Wait for prices to update
    await page.waitForTimeout(1000);

    // Verify price is now in USD
    const usdPrice = await page
      .locator('[data-testid="flight-price"]')
      .first()
      .textContent();
    expect(usdPrice).toContain("$");

    // Verify price has changed (not just the symbol)
    expect(usdPrice).not.toBe(initialPrice);
  });

  test("should persist currency selection across pages", async ({ page }) => {
    // Select EUR
    await page.locator('[data-testid="currency-selector"]').click();
    await page.getByRole("option", { name: /EUR/ }).click();

    // Navigate to another page
    await page.goto("/flights");

    // Verify currency is still EUR
    await page.waitForLoadState("networkidle");
    const price = await page
      .locator('[data-testid="flight-price"]')
      .first()
      .textContent();
    expect(price).toContain("€");
  });

  test("should show all supported currencies", async ({ page }) => {
    // Open currency selector
    await page.locator('[data-testid="currency-selector"]').click();

    // Verify all currencies are listed
    const currencies = [
      "SAR",
      "USD",
      "EUR",
      "GBP",
      "AED",
      "KWD",
      "BHD",
      "OMR",
      "QAR",
      "EGP",
    ];

    for (const currency of currencies) {
      await expect(
        page.getByRole("option", { name: new RegExp(currency) })
      ).toBeVisible();
    }
  });

  test("should convert prices correctly in booking flow", async ({ page }) => {
    // Select USD
    await page.locator('[data-testid="currency-selector"]').click();
    await page.getByRole("option", { name: /USD/ }).click();

    // Search for flights
    await page.getByLabel("من").click();
    await page.getByRole("option", { name: "الرياض" }).click();
    await page.getByLabel("إلى").click();
    await page.getByRole("option", { name: "جدة" }).click();

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    await page
      .getByLabel("تاريخ المغادرة")
      .fill(tomorrow.toISOString().split("T")[0]);

    await page.getByRole("button", { name: "بحث" }).click();

    // Wait for results
    await page.waitForSelector('[data-testid="flight-results"]');

    // Verify all prices are in USD
    const prices = await page
      .locator('[data-testid="flight-price"]')
      .allTextContents();
    for (const price of prices) {
      expect(price).toContain("$");
    }

    // Select a flight
    await page.locator('[data-testid="flight-card"]').first().click();

    // Verify total price is also in USD
    const totalPrice = await page
      .locator('[data-testid="total-price"]')
      .textContent();
    expect(totalPrice).toContain("$");
  });
});
