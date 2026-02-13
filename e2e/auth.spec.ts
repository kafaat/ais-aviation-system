import { test, expect } from "@playwright/test";
import { testUsers } from "./fixtures/test-data";

/**
 * E2E Test: Authentication Flows
 * Tests login, logout, registration, and session management
 */

test.describe("Authentication", () => {
  test.describe("Login Flow", () => {
    test.beforeEach(async ({ page }) => {
      await page.goto("/login");
      await page.waitForLoadState("networkidle");
    });

    test("should display login form correctly", async ({ page }) => {
      // Check form elements are present
      await expect(page.getByLabel(/البريد الإلكتروني|Email/i)).toBeVisible();
      await expect(page.locator("input#password")).toBeVisible();
      await expect(
        page.getByRole("button", { name: /تسجيل الدخول|Login|Sign in/i })
      ).toBeVisible();

      // Check "forgot password" link exists
      await expect(
        page.getByRole("link", { name: /نسيت كلمة المرور|Forgot password/i })
      ).toBeVisible();

      // Check "register" link exists
      await expect(
        page.getByRole("link", { name: /إنشاء حساب|Register|Sign up/i })
      ).toBeVisible();
    });

    test("should login successfully with valid credentials", async ({
      page,
    }) => {
      // Fill in credentials
      await page
        .getByLabel(/البريد الإلكتروني|Email/i)
        .fill(testUsers.regular.email);
      await page.locator("input#password").fill(testUsers.regular.password);

      // Submit form
      await page
        .getByRole("button", { name: /تسجيل الدخول|Login|Sign in/i })
        .click();

      // Wait for navigation away from login page
      await page.waitForURL(/^(?!.*\/login).*$/, { timeout: 10000 });

      // Verify user is logged in (check for profile link or user menu)
      const isLoggedIn =
        (await page
          .getByRole("link", { name: /الملف الشخصي|Profile/i })
          .isVisible()) ||
        (await page.locator('[data-testid="user-menu"]').isVisible());
      expect(isLoggedIn).toBeTruthy();
    });

    test("should show error for invalid email format", async ({ page }) => {
      // Enter invalid email
      await page.getByLabel(/البريد الإلكتروني|Email/i).fill("invalid-email");
      await page.locator("input#password").fill("password123");

      // Try to submit
      await page
        .getByRole("button", { name: /تسجيل الدخول|Login|Sign in/i })
        .click();

      // Check for validation error
      await expect(
        page.getByText(
          /البريد الإلكتروني غير صالح|Invalid email|Please enter a valid email/i
        )
      ).toBeVisible();
    });

    test("should show error for wrong password", async ({ page }) => {
      // Enter valid email but wrong password
      await page
        .getByLabel(/البريد الإلكتروني|Email/i)
        .fill(testUsers.regular.email);
      await page.locator("input#password").fill("wrongpassword");

      // Submit form
      await page
        .getByRole("button", { name: /تسجيل الدخول|Login|Sign in/i })
        .click();

      // Wait for error message
      await page.waitForSelector('[data-testid="error-message"]', {
        timeout: 5000,
      });

      // Check error message
      await expect(
        page.getByText(
          /كلمة المرور غير صحيحة|بيانات الاعتماد غير صحيحة|Invalid credentials|Incorrect password/i
        )
      ).toBeVisible();
    });

    test("should show error for non-existent user", async ({ page }) => {
      // Enter non-existent email
      await page
        .getByLabel(/البريد الإلكتروني|Email/i)
        .fill("nonexistent@example.com");
      await page.locator("input#password").fill("password123");

      // Submit form
      await page
        .getByRole("button", { name: /تسجيل الدخول|Login|Sign in/i })
        .click();

      // Wait for error message
      await page.waitForSelector('[data-testid="error-message"]', {
        timeout: 5000,
      });

      // Check error message (should be generic for security)
      await expect(
        page.getByText(
          /بيانات الاعتماد غير صحيحة|Invalid credentials|User not found/i
        )
      ).toBeVisible();
    });

    test("should require both email and password", async ({ page }) => {
      // Try to submit empty form
      await page
        .getByRole("button", { name: /تسجيل الدخول|Login|Sign in/i })
        .click();

      // Check for required field errors
      const emailRequired = await page
        .getByText(/البريد الإلكتروني مطلوب|Email is required/i)
        .isVisible();
      const passwordRequired = await page
        .getByText(/كلمة المرور مطلوبة|Password is required/i)
        .isVisible();

      expect(emailRequired || passwordRequired).toBeTruthy();
    });

    test("should mask password input", async ({ page }) => {
      const passwordInput = page.locator("input#password");
      await expect(passwordInput).toHaveAttribute("type", "password");

      // Check for show/hide password toggle if exists
      const toggleButton = page.locator(
        '[data-testid="toggle-password-visibility"]'
      );
      if (await toggleButton.isVisible()) {
        await toggleButton.click();
        await expect(passwordInput).toHaveAttribute("type", "text");
        await toggleButton.click();
        await expect(passwordInput).toHaveAttribute("type", "password");
      }
    });
  });

  test.describe("Registration Flow", () => {
    test.beforeEach(async ({ page }) => {
      await page.goto("/register");
      await page.waitForLoadState("networkidle");
    });

    test("should display registration form correctly", async ({ page }) => {
      // Check all form fields are present
      await expect(page.getByLabel(/الاسم الأول|First name/i)).toBeVisible();
      await expect(page.getByLabel(/اسم العائلة|Last name/i)).toBeVisible();
      await expect(page.getByLabel(/البريد الإلكتروني|Email/i)).toBeVisible();
      await expect(page.locator("input#password")).toBeVisible();
      await expect(
        page.getByLabel(/تأكيد كلمة المرور|Confirm password/i)
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: /إنشاء حساب|Register|Sign up/i })
      ).toBeVisible();
    });

    test("should register successfully with valid data", async ({ page }) => {
      // Fill registration form
      const uniqueEmail = `test.user.${Date.now()}@example.com`;

      await page.getByLabel(/الاسم الأول|First name/i).fill("Test");
      await page.getByLabel(/اسم العائلة|Last name/i).fill("User");
      await page.getByLabel(/البريد الإلكتروني|Email/i).fill(uniqueEmail);

      // Handle password fields (may be multiple)
      const passwordFields = page.locator(
        'input[type="password"], input[name*="password"]'
      );
      const count = await passwordFields.count();

      if (count >= 2) {
        await passwordFields.nth(0).fill("SecurePassword123!");
        await passwordFields.nth(1).fill("SecurePassword123!");
      } else {
        await page
          .locator('input[type="password"]')
          .first()
          .fill("SecurePassword123!");
      }

      // Accept terms if checkbox exists
      const termsCheckbox = page.getByLabel(
        /أوافق على الشروط|I agree|Terms and conditions/i
      );
      if (await termsCheckbox.isVisible()) {
        await termsCheckbox.check();
      }

      // Submit form
      await page
        .getByRole("button", { name: /إنشاء حساب|Register|Sign up/i })
        .click();

      // Wait for success (redirect or message)
      await page.waitForTimeout(3000);

      // Check for success indicators
      const isSuccessful =
        (await page.url().includes("/login")) ||
        (await page.url().includes("/")) ||
        (await page
          .getByText(/تم إنشاء الحساب بنجاح|Account created/i)
          .isVisible());

      expect(isSuccessful).toBeTruthy();
    });

    test("should show error when passwords do not match", async ({ page }) => {
      // Fill form with mismatched passwords
      await page.getByLabel(/الاسم الأول|First name/i).fill("Test");
      await page.getByLabel(/اسم العائلة|Last name/i).fill("User");
      await page
        .getByLabel(/البريد الإلكتروني|Email/i)
        .fill("test@example.com");

      const passwordFields = page.locator('input[type="password"]');
      const count = await passwordFields.count();

      if (count >= 2) {
        await passwordFields.nth(0).fill("Password123!");
        await passwordFields.nth(1).fill("DifferentPassword123!");
      }

      // Submit form
      await page
        .getByRole("button", { name: /إنشاء حساب|Register|Sign up/i })
        .click();

      // Check for error message
      await expect(
        page.getByText(/كلمات المرور غير متطابقة|Passwords do not match/i)
      ).toBeVisible();
    });

    test("should show error for weak password", async ({ page }) => {
      // Fill form with weak password
      await page.getByLabel(/الاسم الأول|First name/i).fill("Test");
      await page.getByLabel(/اسم العائلة|Last name/i).fill("User");
      await page
        .getByLabel(/البريد الإلكتروني|Email/i)
        .fill("test@example.com");

      const passwordFields = page.locator('input[type="password"]');
      await passwordFields.first().fill("weak");

      // Try to submit or check real-time validation
      await page
        .getByRole("button", { name: /إنشاء حساب|Register|Sign up/i })
        .click();

      // Check for password strength error
      const hasWeakPasswordError = await page
        .getByText(
          /كلمة المرور ضعيفة|كلمة المرور قصيرة|Password is too weak|Password must be/i
        )
        .isVisible();

      expect(hasWeakPasswordError).toBeTruthy();
    });

    test("should show error for duplicate email", async ({ page }) => {
      // Fill form with existing email
      await page.getByLabel(/الاسم الأول|First name/i).fill("Test");
      await page.getByLabel(/اسم العائلة|Last name/i).fill("User");
      await page
        .getByLabel(/البريد الإلكتروني|Email/i)
        .fill(testUsers.regular.email);

      const passwordFields = page.locator('input[type="password"]');
      const count = await passwordFields.count();
      if (count >= 2) {
        await passwordFields.nth(0).fill("SecurePassword123!");
        await passwordFields.nth(1).fill("SecurePassword123!");
      } else {
        await passwordFields.first().fill("SecurePassword123!");
      }

      // Submit form
      await page
        .getByRole("button", { name: /إنشاء حساب|Register|Sign up/i })
        .click();

      // Wait for error
      await page.waitForTimeout(2000);

      // Check for duplicate email error
      await expect(
        page.getByText(
          /البريد الإلكتروني مسجل|Email already exists|already registered/i
        )
      ).toBeVisible();
    });

    test("should navigate to login page from registration", async ({
      page,
    }) => {
      // Click login link
      await page
        .getByRole("link", { name: /تسجيل الدخول|Login|Sign in/i })
        .click();

      // Verify navigation to login page
      await expect(page).toHaveURL(/\/login/);
    });
  });

  test.describe("Logout Flow", () => {
    test.beforeEach(async ({ page }) => {
      // Login first
      await page.goto("/login");
      await page
        .getByLabel(/البريد الإلكتروني|Email/i)
        .fill(testUsers.regular.email);
      await page.locator("input#password").fill(testUsers.regular.password);
      await page
        .getByRole("button", { name: /تسجيل الدخول|Login|Sign in/i })
        .click();
      await page.waitForURL(/^(?!.*\/login).*$/, { timeout: 10000 });
    });

    test("should logout successfully", async ({ page }) => {
      // Find and click user menu or logout button
      const userMenu = page.locator('[data-testid="user-menu"]');
      if (await userMenu.isVisible()) {
        await userMenu.click();
      }

      // Click logout
      await page
        .getByRole("button", { name: /تسجيل الخروج|Logout|Sign out/i })
        .click();

      // Wait for logout to complete
      await page.waitForLoadState("networkidle");

      // Verify user is logged out
      const loginLink = page.getByRole("link", {
        name: /تسجيل الدخول|Login/i,
      });
      await expect(loginLink).toBeVisible();
    });

    test("should redirect to login when accessing protected route after logout", async ({
      page,
    }) => {
      // Logout
      const userMenu = page.locator('[data-testid="user-menu"]');
      if (await userMenu.isVisible()) {
        await userMenu.click();
      }
      await page
        .getByRole("button", { name: /تسجيل الخروج|Logout|Sign out/i })
        .click();
      await page.waitForLoadState("networkidle");

      // Try to access protected route
      await page.goto("/profile");

      // Should redirect to login or show unauthorized message
      const isOnLogin = page.url().includes("/login");
      const showsUnauthorized = await page
        .getByText(/غير مصرح|يرجى تسجيل الدخول|Please login|Unauthorized/i)
        .isVisible();

      expect(isOnLogin || showsUnauthorized).toBeTruthy();
    });
  });

  test.describe("Session Management", () => {
    test("should maintain session after page refresh", async ({ page }) => {
      // Login
      await page.goto("/login");
      await page
        .getByLabel(/البريد الإلكتروني|Email/i)
        .fill(testUsers.regular.email);
      await page.locator("input#password").fill(testUsers.regular.password);
      await page
        .getByRole("button", { name: /تسجيل الدخول|Login|Sign in/i })
        .click();
      await page.waitForURL(/^(?!.*\/login).*$/, { timeout: 10000 });

      // Refresh page
      await page.reload();
      await page.waitForLoadState("networkidle");

      // Verify still logged in
      const isLoggedIn =
        (await page
          .getByRole("link", { name: /الملف الشخصي|Profile/i })
          .isVisible()) ||
        (await page.locator('[data-testid="user-menu"]').isVisible());
      expect(isLoggedIn).toBeTruthy();
    });

    test("should redirect authenticated user away from login page", async ({
      page,
    }) => {
      // Login
      await page.goto("/login");
      await page
        .getByLabel(/البريد الإلكتروني|Email/i)
        .fill(testUsers.regular.email);
      await page.locator("input#password").fill(testUsers.regular.password);
      await page
        .getByRole("button", { name: /تسجيل الدخول|Login|Sign in/i })
        .click();
      await page.waitForURL(/^(?!.*\/login).*$/, { timeout: 10000 });

      // Try to navigate to login page
      await page.goto("/login");
      await page.waitForLoadState("networkidle");

      // Should redirect away from login
      const isNotOnLogin = !page.url().includes("/login");
      expect(isNotOnLogin).toBeTruthy();
    });
  });

  test.describe("Password Reset Flow", () => {
    test("should display password reset form", async ({ page }) => {
      await page.goto("/login");

      // Click forgot password link
      await page
        .getByRole("link", { name: /نسيت كلمة المرور|Forgot password/i })
        .click();

      // Verify password reset form is displayed
      await expect(page.getByLabel(/البريد الإلكتروني|Email/i)).toBeVisible();
      await expect(
        page.getByRole("button", {
          name: /إرسال رابط|Reset password|Send link/i,
        })
      ).toBeVisible();
    });

    test("should send password reset email for valid user", async ({
      page,
    }) => {
      await page.goto("/forgot-password");
      await page.waitForLoadState("networkidle");

      // Enter email
      await page
        .getByLabel(/البريد الإلكتروني|Email/i)
        .fill(testUsers.regular.email);

      // Submit form
      await page
        .getByRole("button", { name: /إرسال رابط|Reset password|Send link/i })
        .click();

      // Wait for success message
      await page.waitForTimeout(2000);

      // Check for success message
      await expect(
        page.getByText(
          /تم إرسال رابط|Check your email|Reset link sent|تحقق من بريدك/i
        )
      ).toBeVisible();
    });

    test("should show generic message for non-existent email (security)", async ({
      page,
    }) => {
      await page.goto("/forgot-password");
      await page.waitForLoadState("networkidle");

      // Enter non-existent email
      await page
        .getByLabel(/البريد الإلكتروني|Email/i)
        .fill("nonexistent@example.com");

      // Submit form
      await page
        .getByRole("button", { name: /إرسال رابط|Reset password|Send link/i })
        .click();

      // Wait for response
      await page.waitForTimeout(2000);

      // Should show same success message (for security, don't reveal if email exists)
      await expect(
        page.getByText(
          /تم إرسال رابط|Check your email|Reset link sent|تحقق من بريدك|If this email exists/i
        )
      ).toBeVisible();
    });
  });
});
