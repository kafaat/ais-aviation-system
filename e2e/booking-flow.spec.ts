import { test, expect } from "@playwright/test";

/**
 * E2E Test: Complete Booking Flow
 * Tests the entire user journey from search to booking confirmation
 */

test.describe("Booking Flow", () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to homepage
    await page.goto("/");
  });

  test("should complete a full booking flow", async ({ page }) => {
    // Step 1: Search for flights
    await test.step("Search for flights", async () => {
      // Fill in search form
      await page.getByLabel("من").click();
      await page.getByRole("option", { name: "الرياض" }).click();

      await page.getByLabel("إلى").click();
      await page.getByRole("option", { name: "جدة" }).click();

      // Select departure date (tomorrow)
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      await page
        .getByLabel("تاريخ المغادرة")
        .fill(tomorrow.toISOString().split("T")[0]);

      // Select number of passengers
      await page.getByLabel("عدد المسافرين").fill("2");

      // Click search button
      await page.getByRole("button", { name: "بحث" }).click();

      // Wait for results to load
      await page.waitForSelector('[data-testid="flight-results"]');

      // Verify results are displayed
      const results = await page.locator('[data-testid="flight-card"]').count();
      expect(results).toBeGreaterThan(0);
    });

    // Step 2: Select a flight
    await test.step("Select a flight", async () => {
      // Click on first flight
      await page.locator('[data-testid="flight-card"]').first().click();

      // Verify flight details page
      await expect(
        page.getByRole("heading", { name: /تفاصيل الرحلة/ })
      ).toBeVisible();

      // Click "احجز الآن" button
      await page.getByRole("button", { name: "احجز الآن" }).click();
    });

    // Step 3: Fill passenger information
    await test.step("Fill passenger information", async () => {
      // Wait for passenger form
      await page.waitForSelector('[data-testid="passenger-form"]');

      // Fill first passenger
      await page.getByLabel("الاسم الأول (راكب 1)").fill("أحمد");
      await page.getByLabel("اسم العائلة (راكب 1)").fill("محمد");
      await page.getByLabel("رقم الجواز (راكب 1)").fill("A12345678");
      await page.getByLabel("تاريخ الميلاد (راكب 1)").fill("1990-01-15");

      // Fill second passenger
      await page.getByLabel("الاسم الأول (راكب 2)").fill("فاطمة");
      await page.getByLabel("اسم العائلة (راكب 2)").fill("علي");
      await page.getByLabel("رقم الجواز (راكب 2)").fill("B87654321");
      await page.getByLabel("تاريخ الميلاد (راكب 2)").fill("1992-05-20");

      // Click continue
      await page.getByRole("button", { name: "متابعة" }).click();
    });

    // Step 4: Review and confirm
    await test.step("Review and confirm booking", async () => {
      // Wait for review page
      await page.waitForSelector('[data-testid="booking-review"]');

      // Verify passenger details are displayed
      await expect(page.getByText("أحمد محمد")).toBeVisible();
      await expect(page.getByText("فاطمة علي")).toBeVisible();

      // Verify total price is displayed
      await expect(page.locator('[data-testid="total-price"]')).toBeVisible();

      // Click confirm booking
      await page.getByRole("button", { name: "تأكيد الحجز" }).click();
    });

    // Step 5: Payment (mock)
    await test.step("Complete payment", async () => {
      // Wait for payment page
      await page.waitForSelector('[data-testid="payment-form"]');

      // In test environment, we might have a mock payment
      // Fill payment details (using Stripe test card)
      await page.getByLabel("رقم البطاقة").fill("4242424242424242");
      await page.getByLabel("تاريخ الانتهاء").fill("12/25");
      await page.getByLabel("CVV").fill("123");

      // Click pay button
      await page.getByRole("button", { name: "ادفع الآن" }).click();

      // Wait for confirmation
      await page.waitForSelector('[data-testid="booking-confirmation"]', {
        timeout: 30000,
      });
    });

    // Step 6: Verify booking confirmation
    await test.step("Verify booking confirmation", async () => {
      // Check for success message
      await expect(
        page.getByRole("heading", { name: /تم الحجز بنجاح/ })
      ).toBeVisible();

      // Verify booking reference is displayed
      const bookingRef = await page
        .locator('[data-testid="booking-reference"]')
        .textContent();
      expect(bookingRef).toMatch(/^[A-Z0-9]{6}$/);

      // Verify download ticket button is visible
      await expect(
        page.getByRole("button", { name: "تحميل التذكرة" })
      ).toBeVisible();
    });
  });

  test("should show validation errors for invalid passenger data", async ({
    page,
  }) => {
    // Navigate to booking page (assuming we have a direct link for testing)
    await page.goto("/booking/new?flightId=1");

    // Try to submit without filling required fields
    await page.getByRole("button", { name: "متابعة" }).click();

    // Verify error messages
    await expect(page.getByText("الاسم الأول مطلوب")).toBeVisible();
    await expect(page.getByText("اسم العائلة مطلوب")).toBeVisible();
    await expect(page.getByText("رقم الجواز مطلوب")).toBeVisible();
  });

  test("should handle payment failure gracefully", ({ page: _page }) => {
    // This test would require mocking a payment failure
    // Implementation depends on your payment setup
  });
});
