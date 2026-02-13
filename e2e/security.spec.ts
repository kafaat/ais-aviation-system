import { test, expect } from "@playwright/test";

/**
 * E2E Test: Security Features
 * Tests account locking and security measures
 */

test.describe("Security Features", () => {
  test("should lock account after multiple failed login attempts", async ({
    page,
  }) => {
    await page.goto("/login");

    // Attempt to login with wrong password 5 times
    for (let i = 0; i < 5; i++) {
      await page.getByLabel("البريد الإلكتروني").fill("test@example.com");
      await page.locator("input#password").fill("wrongpassword");
      await page.locator('[data-testid="login-submit"]').click();

      // Wait for error message
      await page.waitForSelector('[data-testid="error-message"]');
    }

    // 6th attempt should show account locked message
    await page.getByLabel("البريد الإلكتروني").fill("test@example.com");
    await page.locator("input#password").fill("wrongpassword");
    await page.locator('[data-testid="login-submit"]').click();

    // Verify account locked message
    await expect(page.getByText(/تم قفل الحساب/)).toBeVisible();
  });

  test("should include Request ID in response headers", async ({ page }) => {
    const response = await page.goto("/");

    // Verify X-Request-ID header is present
    const headers = response?.headers();
    expect(headers).toHaveProperty("x-request-id");

    // Verify it's a valid format (16 characters)
    const requestId = headers?.["x-request-id"];
    expect(requestId).toMatch(/^[a-zA-Z0-9_-]{16}$/);
  });

  test("should not expose sensitive information in error messages", async ({
    page,
  }) => {
    // Try to access a protected route without authentication
    await page.goto("/admin");
    await page.waitForLoadState("networkidle");

    // Should redirect to login or show generic error
    const url = page.url();
    const isLoginPage = url.includes("/login");
    const hasGenericError = await page
      .getByText(/غير مصرح|Unauthorized/)
      .isVisible();

    expect(isLoginPage || hasGenericError).toBeTruthy();

    // Should NOT show database errors or stack traces in visible text
    const visibleText = await page.locator("body").innerText();
    expect(visibleText).not.toContain("SQL");
    expect(visibleText).not.toMatch(/Error:.*at /);
    expect(visibleText).not.toMatch(/at \w+\.\w+ \(/);
  });

  test("should mask PII in client-side logs", async ({ page }) => {
    // Enable console logging
    const consoleLogs: string[] = [];
    page.on("console", msg => consoleLogs.push(msg.text()));

    await page.goto("/booking/new?flightId=1");

    // Fill in passenger information with sensitive data
    await page.getByLabel("الاسم الأول").fill("أحمد");
    await page.getByLabel("البريد الإلكتروني").fill("ahmed@example.com");
    await page.getByLabel("رقم الهاتف").fill("+966501234567");
    await page.getByLabel("رقم الجواز").fill("A12345678");

    // Submit form (which might log data)
    await page.getByRole("button", { name: "متابعة" }).click();

    // Wait a bit for any logging to occur
    await page.waitForTimeout(1000);

    // Verify sensitive data is not in console logs
    const logsText = consoleLogs.join(" ");
    expect(logsText).not.toContain("ahmed@example.com");
    expect(logsText).not.toContain("+966501234567");
    expect(logsText).not.toContain("A12345678");
  });

  test("should enforce rate limiting on search endpoint", async ({ page }) => {
    await page.goto("/");

    // Make multiple rapid search requests
    const searchButton = page.getByRole("button", { name: "بحث" });

    // Fill search form once
    await page.getByLabel("من").click();
    await page.getByRole("option", { name: "الرياض" }).first().click();
    await page.getByLabel("إلى").click();
    await page.getByRole("option", { name: "جدة" }).first().click();

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    await page
      .getByLabel("تاريخ المغادرة")
      .fill(tomorrow.toISOString().split("T")[0]);

    // Click search button rapidly 20 times
    let rateLimitHit = false;
    for (let i = 0; i < 20; i++) {
      await searchButton.click();
      await page.waitForTimeout(100);

      // Check if rate limit error appears
      const errorMessage = await page
        .locator('[data-testid="error-message"]')
        .textContent();
      if (
        errorMessage?.includes("كثيرة") ||
        errorMessage?.includes("rate limit")
      ) {
        rateLimitHit = true;
        break;
      }
    }

    // Verify rate limiting was enforced
    expect(rateLimitHit).toBeTruthy();
  });
});
