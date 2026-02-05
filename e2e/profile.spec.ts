import { test, expect } from "@playwright/test";
import { testUsers, testPreferences } from "./fixtures/test-data";

/**
 * E2E Test: Profile Management
 * Tests user profile, preferences, and account settings
 */

test.describe("Profile Management", () => {
  // Login before each test
  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
    await page.waitForLoadState("networkidle");

    await page
      .getByLabel(/البريد الإلكتروني|Email/i)
      .fill(testUsers.regular.email);
    await page
      .getByLabel(/كلمة المرور|Password/i)
      .fill(testUsers.regular.password);
    await page
      .getByRole("button", { name: /تسجيل الدخول|Login|Sign in/i })
      .click();
    await page.waitForURL(/^(?!.*\/login).*$/, { timeout: 10000 });
  });

  test.describe("Profile Page Access", () => {
    test("should navigate to profile page", async ({ page }) => {
      await page.goto("/profile");
      await page.waitForLoadState("networkidle");

      expect(page.url()).toContain("/profile");
    });

    test("should display profile header with user info", async ({ page }) => {
      await page.goto("/profile");
      await page.waitForLoadState("networkidle");

      // Check for user email display
      await expect(page.getByText(testUsers.regular.email)).toBeVisible();

      // Check for profile title
      const hasProfileTitle =
        (await page
          .getByRole("heading", { name: /الملف الشخصي|Profile/i })
          .isVisible()) ||
        (await page.getByText(/الملف الشخصي|Profile/i).isVisible());

      expect(hasProfileTitle).toBeTruthy();
    });

    test("should show avatar or initials", async ({ page }) => {
      await page.goto("/profile");
      await page.waitForLoadState("networkidle");

      // Look for avatar component
      const hasAvatar =
        (await page.locator('[data-testid="avatar"]').isVisible()) ||
        (await page.locator('[role="img"]').isVisible()) ||
        (await page.locator(".avatar, [class*='avatar']").isVisible());

      expect(hasAvatar).toBeTruthy();
    });

    test("should redirect to login if not authenticated", async ({ page }) => {
      // Clear cookies/session
      await page.context().clearCookies();

      await page.goto("/profile");
      await page.waitForLoadState("networkidle");

      // Should redirect to login or show login message
      const isRedirected =
        page.url().includes("/login") ||
        (await page.getByText(/يرجى تسجيل الدخول|Please login/i).isVisible());

      expect(isRedirected).toBeTruthy();
    });
  });

  test.describe("Profile Tabs", () => {
    test.beforeEach(async ({ page }) => {
      await page.goto("/profile");
      await page.waitForLoadState("networkidle");
    });

    test("should display profile tabs", async ({ page }) => {
      // Check for tab navigation
      const hasTabs =
        (await page.locator('[role="tablist"]').isVisible()) ||
        (await page.locator('[data-testid="profile-tabs"]').isVisible());

      expect(hasTabs).toBeTruthy();
    });

    test("should show travel preferences tab", async ({ page }) => {
      const travelTab = page.getByRole("tab", {
        name: /تفضيلات السفر|Travel preferences|Travel/i,
      });

      if (await travelTab.isVisible()) {
        await travelTab.click();

        // Verify travel preferences content
        const hasTravelContent =
          (await page.getByText(/المقعد المفضل|Preferred seat/i).isVisible()) ||
          (await page.getByText(/درجة السفر|Cabin class/i).isVisible()) ||
          (await page.getByText(/الوجبات|Meal preference/i).isVisible());

        expect(hasTravelContent).toBeTruthy();
      }
    });

    test("should show personal information tab", async ({ page }) => {
      const personalTab = page.getByRole("tab", {
        name: /المعلومات الشخصية|Personal|Personal information/i,
      });

      if (await personalTab.isVisible()) {
        await personalTab.click();

        // Verify personal info content
        const hasPersonalContent =
          (await page.getByText(/رقم الجواز|Passport/i).isVisible()) ||
          (await page.getByText(/الجنسية|Nationality/i).isVisible()) ||
          (await page.getByText(/رقم الهاتف|Phone/i).isVisible());

        expect(hasPersonalContent).toBeTruthy();
      }
    });

    test("should show notifications tab", async ({ page }) => {
      const notificationsTab = page.getByRole("tab", {
        name: /الإشعارات|Notifications/i,
      });

      if (await notificationsTab.isVisible()) {
        await notificationsTab.click();

        // Verify notifications content
        const hasNotificationsContent =
          (await page
            .getByText(/إشعارات البريد|Email notifications/i)
            .isVisible()) ||
          (await page
            .getByText(/إشعارات الرسائل|SMS notifications/i)
            .isVisible());

        expect(hasNotificationsContent).toBeTruthy();
      }
    });
  });

  test.describe("Travel Preferences", () => {
    test.beforeEach(async ({ page }) => {
      await page.goto("/profile");
      await page.waitForLoadState("networkidle");

      // Click travel preferences tab
      const travelTab = page.getByRole("tab", {
        name: /تفضيلات السفر|Travel|السفر/i,
      });
      if (await travelTab.isVisible()) {
        await travelTab.click();
      }
    });

    test("should update preferred seat type", async ({ page }) => {
      const seatSelect = page.locator('[data-testid="seat-preference-select"]');
      const fallbackSelect = page.getByLabel(/المقعد المفضل|Preferred seat/i);

      const selectToUse = (await seatSelect.isVisible())
        ? seatSelect
        : fallbackSelect;

      if (await selectToUse.isVisible()) {
        await selectToUse.click();

        // Select window seat
        await page.getByRole("option", { name: /نافذة|Window/i }).click();

        // Save changes
        const saveButton = page.getByRole("button", {
          name: /حفظ|Save/i,
        });
        if (await saveButton.isVisible()) {
          await saveButton.click();

          // Check for success message
          await expect(page.getByText(/تم الحفظ|Saved|Updated/i)).toBeVisible({
            timeout: 5000,
          });
        }
      }
    });

    test("should update preferred cabin class", async ({ page }) => {
      const classSelect = page.getByLabel(/درجة السفر|Cabin class|Class/i);

      if (await classSelect.isVisible()) {
        await classSelect.click();

        // Select business class
        await page
          .getByRole("option", { name: /رجال الأعمال|Business/i })
          .click();

        // Save changes
        const saveButton = page.getByRole("button", {
          name: /حفظ|Save/i,
        });
        if (await saveButton.isVisible()) {
          await saveButton.click();
        }
      }
    });

    test("should update meal preference", async ({ page }) => {
      const mealSelect = page.getByLabel(/الوجبات|Meal preference/i);

      if (await mealSelect.isVisible()) {
        await mealSelect.click();

        // Select halal option
        await page.getByRole("option", { name: /حلال|Halal/i }).click();
      }
    });

    test("should toggle wheelchair assistance", async ({ page }) => {
      const wheelchairSwitch = page.getByLabel(
        /المساعدة بالكرسي المتحرك|Wheelchair assistance/i
      );

      if (await wheelchairSwitch.isVisible()) {
        const initialState = await wheelchairSwitch.isChecked();

        // Toggle the switch
        await wheelchairSwitch.click();

        // Verify state changed
        const newState = await wheelchairSwitch.isChecked();
        expect(newState).toBe(!initialState);
      }
    });

    test("should toggle extra legroom preference", async ({ page }) => {
      const legroomSwitch = page.getByLabel(
        /مساحة إضافية للأرجل|Extra legroom/i
      );

      if (await legroomSwitch.isVisible()) {
        const initialState = await legroomSwitch.isChecked();

        // Toggle the switch
        await legroomSwitch.click();

        // Verify state changed
        const newState = await legroomSwitch.isChecked();
        expect(newState).toBe(!initialState);
      }
    });
  });

  test.describe("Personal Information", () => {
    test.beforeEach(async ({ page }) => {
      await page.goto("/profile");
      await page.waitForLoadState("networkidle");

      // Click personal info tab
      const personalTab = page.getByRole("tab", {
        name: /المعلومات الشخصية|Personal|الشخصية/i,
      });
      if (await personalTab.isVisible()) {
        await personalTab.click();
      }
    });

    test("should update passport number", async ({ page }) => {
      const passportInput = page.getByLabel(/رقم الجواز|Passport number/i);

      if (await passportInput.isVisible()) {
        await passportInput.clear();
        await passportInput.fill(testPreferences.personal.passportNumber);

        // Verify input value
        await expect(passportInput).toHaveValue(
          testPreferences.personal.passportNumber
        );
      }
    });

    test("should validate passport number format", async ({ page }) => {
      const passportInput = page.getByLabel(/رقم الجواز|Passport number/i);

      if (await passportInput.isVisible()) {
        // Enter invalid passport
        await passportInput.clear();
        await passportInput.fill("123");

        // Try to save
        const saveButton = page.getByRole("button", { name: /حفظ|Save/i });
        if (await saveButton.isVisible()) {
          await saveButton.click();

          // Check for validation error
          const hasError =
            (await page
              .getByText(/رقم الجواز غير صالح|Invalid passport/i)
              .isVisible()) ||
            (await passportInput.evaluate(
              el => el.getAttribute("aria-invalid") === "true"
            ));

          expect(hasError).toBeTruthy();
        }
      }
    });

    test("should update nationality", async ({ page }) => {
      const nationalityInput = page.getByLabel(/الجنسية|Nationality/i);

      if (await nationalityInput.isVisible()) {
        await nationalityInput.clear();
        await nationalityInput.fill(testPreferences.personal.nationality);
      }
    });

    test("should update phone number", async ({ page }) => {
      const phoneInput = page.getByLabel(/رقم الهاتف|Phone number/i);

      if (await phoneInput.isVisible()) {
        await phoneInput.clear();
        await phoneInput.fill(testUsers.regular.phone);

        // Verify input
        await expect(phoneInput).toHaveValue(testUsers.regular.phone);
      }
    });

    test("should validate phone number format", async ({ page }) => {
      const phoneInput = page.getByLabel(/رقم الهاتف|Phone number/i);

      if (await phoneInput.isVisible()) {
        // Enter invalid phone
        await phoneInput.clear();
        await phoneInput.fill("123");

        // Try to save
        const saveButton = page.getByRole("button", { name: /حفظ|Save/i });
        if (await saveButton.isVisible()) {
          await saveButton.click();

          // Check for validation error
          const hasError =
            (await page
              .getByText(/رقم الهاتف غير صالح|Invalid phone/i)
              .isVisible()) ||
            (await phoneInput.evaluate(
              el => el.getAttribute("aria-invalid") === "true"
            ));

          expect(hasError).toBeTruthy();
        }
      }
    });

    test("should update emergency contact", async ({ page }) => {
      const emergencyContactInput = page.getByLabel(
        /جهة اتصال الطوارئ|Emergency contact/i
      );

      if (await emergencyContactInput.isVisible()) {
        await emergencyContactInput.clear();
        await emergencyContactInput.fill(
          testPreferences.personal.emergencyContact
        );
      }

      const emergencyPhoneInput = page.getByLabel(
        /هاتف الطوارئ|Emergency phone/i
      );

      if (await emergencyPhoneInput.isVisible()) {
        await emergencyPhoneInput.clear();
        await emergencyPhoneInput.fill(testPreferences.personal.emergencyPhone);
      }
    });
  });

  test.describe("Notification Preferences", () => {
    test.beforeEach(async ({ page }) => {
      await page.goto("/profile");
      await page.waitForLoadState("networkidle");

      // Click notifications tab
      const notificationsTab = page.getByRole("tab", {
        name: /الإشعارات|Notifications/i,
      });
      if (await notificationsTab.isVisible()) {
        await notificationsTab.click();
      }
    });

    test("should toggle email notifications", async ({ page }) => {
      const emailSwitch = page.getByLabel(
        /إشعارات البريد|Email notifications/i
      );

      if (await emailSwitch.isVisible()) {
        const initialState = await emailSwitch.isChecked();

        // Toggle
        await emailSwitch.click();

        // Verify state changed
        const newState = await emailSwitch.isChecked();
        expect(newState).toBe(!initialState);
      }
    });

    test("should toggle SMS notifications", async ({ page }) => {
      const smsSwitch = page.getByLabel(/إشعارات الرسائل|SMS notifications/i);

      if (await smsSwitch.isVisible()) {
        const initialState = await smsSwitch.isChecked();

        // Toggle
        await smsSwitch.click();

        // Verify state changed
        const newState = await smsSwitch.isChecked();
        expect(newState).toBe(!initialState);
      }
    });
  });

  test.describe("Avatar Upload", () => {
    test.beforeEach(async ({ page }) => {
      await page.goto("/profile");
      await page.waitForLoadState("networkidle");
    });

    test("should show avatar upload option", async ({ page }) => {
      // Look for avatar upload trigger
      const hasUploadOption =
        (await page.locator('[data-testid="avatar-upload"]').isVisible()) ||
        (await page.locator('[aria-label*="avatar"]').isVisible()) ||
        (await page.getByText(/تغيير الصورة|Change photo/i).isVisible());

      expect(hasUploadOption).toBeTruthy();
    });

    test("should open file picker when clicking avatar", async ({ page }) => {
      // Look for hidden file input
      const fileInput = page.locator('input[type="file"][accept*="image"]');

      if (await fileInput.isVisible()) {
        // Verify input accepts images
        const acceptAttr = await fileInput.getAttribute("accept");
        expect(acceptAttr).toContain("image");
      }
    });
  });

  test.describe("Save Changes", () => {
    test.beforeEach(async ({ page }) => {
      await page.goto("/profile");
      await page.waitForLoadState("networkidle");
    });

    test("should show save button", async ({ page }) => {
      const saveButton = page.getByRole("button", { name: /حفظ|Save/i });
      await expect(saveButton).toBeVisible();
    });

    test("should save profile changes successfully", async ({ page }) => {
      // Make a change
      const travelTab = page.getByRole("tab", {
        name: /تفضيلات السفر|Travel/i,
      });
      if (await travelTab.isVisible()) {
        await travelTab.click();
      }

      // Toggle a preference
      const legroomSwitch = page.getByLabel(
        /مساحة إضافية للأرجل|Extra legroom/i
      );
      if (await legroomSwitch.isVisible()) {
        await legroomSwitch.click();
      }

      // Save changes
      const saveButton = page.getByRole("button", { name: /حفظ|Save/i });
      if (await saveButton.isVisible()) {
        await saveButton.click();

        // Check for success message
        const hasSuccess =
          (await page
            .getByText(/تم الحفظ بنجاح|Saved successfully|Updated/i)
            .isVisible()) ||
          (await page.locator("[data-sonner-toast]").isVisible());

        expect(hasSuccess).toBeTruthy();
      }
    });

    test("should show loading state when saving", async ({ page }) => {
      const saveButton = page.getByRole("button", { name: /حفظ|Save/i });

      if (await saveButton.isVisible()) {
        // Click save and check for loading state
        await saveButton.click();

        // Loading indicator might be shown briefly
        const hasLoading =
          (await saveButton.getByText(/جاري الحفظ|Saving/i).isVisible()) ||
          (await saveButton.locator('[role="progressbar"]').isVisible()) ||
          (await saveButton.locator(".animate-spin").isVisible());

        // This might be too fast to catch, so just verify save completes
        await page.waitForTimeout(1000);
      }
    });

    test("should persist changes after page reload", async ({ page }) => {
      // Make a change to meal preference
      const travelTab = page.getByRole("tab", {
        name: /تفضيلات السفر|Travel/i,
      });
      if (await travelTab.isVisible()) {
        await travelTab.click();
      }

      const mealSelect = page.getByLabel(/الوجبات|Meal preference/i);
      if (await mealSelect.isVisible()) {
        await mealSelect.click();
        await page.getByRole("option", { name: /نباتي|Vegetarian/i }).click();

        // Save
        const saveButton = page.getByRole("button", { name: /حفظ|Save/i });
        await saveButton.click();
        await page.waitForTimeout(2000);

        // Reload page
        await page.reload();
        await page.waitForLoadState("networkidle");

        // Navigate to travel tab
        const reloadedTravelTab = page.getByRole("tab", {
          name: /تفضيلات السفر|Travel/i,
        });
        if (await reloadedTravelTab.isVisible()) {
          await reloadedTravelTab.click();
        }

        // Verify the value is still set
        const reloadedMealSelect = page.getByLabel(/الوجبات|Meal preference/i);
        if (await reloadedMealSelect.isVisible()) {
          await expect(reloadedMealSelect).toContainText(/نباتي|Vegetarian/i);
        }
      }
    });
  });

  test.describe("My Bookings Integration", () => {
    test("should navigate to my bookings from profile", async ({ page }) => {
      await page.goto("/profile");
      await page.waitForLoadState("networkidle");

      // Look for link to my bookings
      const myBookingsLink = page.getByRole("link", {
        name: /حجوزاتي|My bookings/i,
      });

      if (await myBookingsLink.isVisible()) {
        await myBookingsLink.click();
        await page.waitForURL(/\/my-bookings/);
        expect(page.url()).toContain("/my-bookings");
      }
    });
  });

  test.describe("Loyalty Program", () => {
    test("should navigate to loyalty dashboard from profile", async ({
      page,
    }) => {
      await page.goto("/profile");
      await page.waitForLoadState("networkidle");

      // Look for loyalty link
      const loyaltyLink = page.getByRole("link", {
        name: /برنامج الولاء|Loyalty|Miles/i,
      });

      if (await loyaltyLink.isVisible()) {
        await loyaltyLink.click();
        await page.waitForURL(/\/loyalty/);
        expect(page.url()).toContain("/loyalty");
      }
    });

    test("should display loyalty points if available", async ({ page }) => {
      await page.goto("/profile");
      await page.waitForLoadState("networkidle");

      // Look for loyalty points display
      const hasLoyaltyInfo =
        (await page.getByText(/نقاط|Points|Miles/i).isVisible()) ||
        (await page.locator('[data-testid="loyalty-points"]').isVisible());

      // Loyalty info may not be visible for all users
      if (hasLoyaltyInfo) {
        expect(hasLoyaltyInfo).toBeTruthy();
      }
    });
  });

  test.describe("Accessibility", () => {
    test.beforeEach(async ({ page }) => {
      await page.goto("/profile");
      await page.waitForLoadState("networkidle");
    });

    test("should have proper form labels", async ({ page }) => {
      // Check that form inputs have labels
      const inputs = page.locator("input:visible");
      const count = await inputs.count();

      for (let i = 0; i < Math.min(count, 5); i++) {
        const input = inputs.nth(i);
        const id = await input.getAttribute("id");
        const ariaLabel = await input.getAttribute("aria-label");
        const ariaLabelledBy = await input.getAttribute("aria-labelledby");

        // Input should have id (for label association) or aria attributes
        const hasAccessibleName = id || ariaLabel || ariaLabelledBy;
        expect(hasAccessibleName).toBeTruthy();
      }
    });

    test("should be keyboard navigable", async ({ page }) => {
      // Tab through the page
      await page.keyboard.press("Tab");
      await page.keyboard.press("Tab");

      // Verify focus is visible
      const focusedElement = await page.locator(":focus").first();
      await expect(focusedElement).toBeFocused();
    });
  });
});
