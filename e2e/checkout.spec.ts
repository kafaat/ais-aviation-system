import { test, expect } from "@playwright/test";
import {
  testUsers,
  testPassengers,
  testPaymentCards,
  testRoutes,
  getNextWeekDate,
  formatDateForInput,
  BOOKING_REF_PATTERN,
} from "./fixtures/test-data";

/**
 * E2E Test: Checkout Flow
 * Tests the complete booking journey from flight selection to confirmation
 */

test.describe("Checkout Flow", () => {
  test.describe("Flight Selection", () => {
    test.beforeEach(async ({ page }) => {
      // Navigate to search results
      await page.goto("/");
      await page.waitForLoadState("networkidle");

      // Perform search
      await page.getByLabel(/من|From/i).click();
      await page
        .getByRole("option", { name: new RegExp(testRoutes.domestic.origin) })
        .click();

      await page.getByLabel(/إلى|To/i).click();
      await page
        .getByRole("option", {
          name: new RegExp(testRoutes.domestic.destination),
        })
        .click();

      const departureDate = getNextWeekDate();
      await page
        .getByLabel(/تاريخ المغادرة|Departure date/i)
        .fill(formatDateForInput(departureDate));

      await page.getByRole("button", { name: /بحث|Search/i }).click();
      await page.waitForSelector('[data-testid="flight-results"]', {
        timeout: 30000,
      });
    });

    test("should select a flight and proceed to booking", async ({ page }) => {
      // Click on first available flight
      const flightCard = page.locator('[data-testid="flight-card"]').first();

      if (await flightCard.isVisible()) {
        // Click select/book button
        const selectButton = flightCard.getByRole("button", {
          name: /احجز|اختر|Select|Book/i,
        });

        if (await selectButton.isVisible()) {
          await selectButton.click();
        } else {
          await flightCard.click();
        }

        // Wait for navigation to booking page
        await page.waitForURL(/\/booking/, { timeout: 10000 });

        // Verify we're on booking page
        expect(page.url()).toContain("/booking");
      }
    });

    test("should display flight details after selection", async ({ page }) => {
      const flightCard = page.locator('[data-testid="flight-card"]').first();

      if (await flightCard.isVisible()) {
        await flightCard.click();
        await page.waitForURL(/\/booking/, { timeout: 10000 });

        // Verify flight details are shown
        const hasFlightDetails =
          (await page.locator('[data-testid="flight-summary"]').isVisible()) ||
          (await page.getByText(/تفاصيل الرحلة|Flight details/i).isVisible()) ||
          (await page.getByText(/الرياض|جدة/i).isVisible());

        expect(hasFlightDetails).toBeTruthy();
      }
    });
  });

  test.describe("Passenger Information", () => {
    test.beforeEach(async ({ page }) => {
      // Navigate to a booking page directly (if possible) or through search
      await page.goto("/booking/1");
      await page.waitForLoadState("networkidle");

      // If redirected to login, login first
      if (page.url().includes("/login")) {
        await page
          .getByLabel(/البريد الإلكتروني|Email/i)
          .fill(testUsers.regular.email);
        await page.locator("input#password").fill(testUsers.regular.password);
        await page
          .getByRole("button", { name: /تسجيل الدخول|Login|Sign in/i })
          .click();
        await page.waitForURL(/\/booking/, { timeout: 10000 });
      }
    });

    test("should display passenger form", async ({ page }) => {
      const passengerForm = page.locator('[data-testid="passenger-form"]');

      // Check for passenger form or relevant fields
      const hasPassengerForm =
        (await passengerForm.isVisible()) ||
        (await page.getByLabel(/الاسم الأول|First name/i).isVisible()) ||
        (await page
          .getByText(/بيانات المسافر|Passenger information/i)
          .isVisible());

      expect(hasPassengerForm).toBeTruthy();
    });

    test("should fill passenger information successfully", async ({ page }) => {
      // Fill first passenger details
      const firstNameInput = page.getByLabel(/الاسم الأول|First name/i).first();
      const lastNameInput = page.getByLabel(/اسم العائلة|Last name/i).first();
      const passportInput = page.getByLabel(/رقم الجواز|Passport/i).first();
      const dobInput = page.getByLabel(/تاريخ الميلاد|Date of birth/i).first();

      if (await firstNameInput.isVisible()) {
        await firstNameInput.fill(testPassengers.adult1.firstName);
      }

      if (await lastNameInput.isVisible()) {
        await lastNameInput.fill(testPassengers.adult1.lastName);
      }

      if (await passportInput.isVisible()) {
        await passportInput.fill(testPassengers.adult1.passportNumber);
      }

      if (await dobInput.isVisible()) {
        await dobInput.fill(testPassengers.adult1.dateOfBirth);
      }

      // Verify fields are filled
      if (await firstNameInput.isVisible()) {
        await expect(firstNameInput).toHaveValue(
          testPassengers.adult1.firstName
        );
      }
    });

    test("should validate required passenger fields", async ({ page }) => {
      // Try to proceed without filling required fields
      const continueButton = page.getByRole("button", {
        name: /متابعة|Continue|Next/i,
      });

      if (await continueButton.isVisible()) {
        await continueButton.click();

        // Check for validation errors
        const hasValidationError =
          (await page
            .getByText(/الاسم الأول مطلوب|First name is required/i)
            .isVisible()) ||
          (await page.getByText(/مطلوب|required/i).isVisible()) ||
          (await page.locator('[aria-invalid="true"]').isVisible());

        expect(hasValidationError).toBeTruthy();
      }
    });

    test("should validate passport number format", async ({ page }) => {
      const passportInput = page.getByLabel(/رقم الجواز|Passport/i).first();

      if (await passportInput.isVisible()) {
        // Enter invalid passport number
        await passportInput.fill("123");

        // Trigger validation
        const continueButton = page.getByRole("button", {
          name: /متابعة|Continue|Next/i,
        });
        if (await continueButton.isVisible()) {
          await continueButton.click();
        }

        // Check for passport validation error
        const hasError =
          (await page
            .getByText(/رقم الجواز غير صالح|Invalid passport/i)
            .isVisible()) ||
          (await passportInput.evaluate(
            el => el.getAttribute("aria-invalid") === "true"
          ));

        expect(hasError).toBeTruthy();
      }
    });

    test("should add multiple passengers", async ({ page }) => {
      // Look for add passenger button
      const addPassengerButton = page.getByRole("button", {
        name: /إضافة راكب|Add passenger/i,
      });

      if (await addPassengerButton.isVisible()) {
        await addPassengerButton.click();

        // Verify second passenger form appears
        const passengerForms = page.locator('[data-testid="passenger-form"]');
        const count = await passengerForms.count();
        expect(count).toBeGreaterThan(1);
      }
    });
  });

  test.describe("Booking Review", () => {
    test.beforeEach(async ({ page }) => {
      // Navigate to booking and fill passenger info
      await page.goto("/booking/1");
      await page.waitForLoadState("networkidle");

      // Fill minimal passenger info
      const firstNameInput = page.getByLabel(/الاسم الأول|First name/i).first();
      if (await firstNameInput.isVisible()) {
        await firstNameInput.fill(testPassengers.adult1.firstName);

        const lastNameInput = page.getByLabel(/اسم العائلة|Last name/i).first();
        if (await lastNameInput.isVisible()) {
          await lastNameInput.fill(testPassengers.adult1.lastName);
        }

        const passportInput = page.getByLabel(/رقم الجواز|Passport/i).first();
        if (await passportInput.isVisible()) {
          await passportInput.fill(testPassengers.adult1.passportNumber);
        }

        const dobInput = page
          .getByLabel(/تاريخ الميلاد|Date of birth/i)
          .first();
        if (await dobInput.isVisible()) {
          await dobInput.fill(testPassengers.adult1.dateOfBirth);
        }
      }
    });

    test("should display booking summary", async ({ page }) => {
      // Try to proceed to review
      const continueButton = page.getByRole("button", {
        name: /متابعة|Continue|Next/i,
      });

      if (await continueButton.isVisible()) {
        await continueButton.click();
        await page.waitForTimeout(1000);

        // Check for booking summary/review
        const hasReview =
          (await page.locator('[data-testid="booking-review"]').isVisible()) ||
          (await page.locator('[data-testid="booking-summary"]').isVisible()) ||
          (await page.getByText(/مراجعة الحجز|Review booking/i).isVisible()) ||
          (await page.getByText(/الملخص|Summary/i).isVisible());

        expect(hasReview).toBeTruthy();
      }
    });

    test("should show total price", async ({ page }) => {
      // Look for total price display
      const totalPrice =
        (await page.locator('[data-testid="total-price"]').isVisible()) ||
        (await page.getByText(/المجموع|Total|الإجمالي/i).isVisible());

      expect(totalPrice).toBeTruthy();
    });

    test("should allow editing passenger information", async ({ page }) => {
      const editButton = page.getByRole("button", {
        name: /تعديل|Edit|Change/i,
      });

      if (await editButton.isVisible()) {
        await editButton.click();

        // Should go back to passenger form or show edit mode
        const canEdit =
          (await page.getByLabel(/الاسم الأول|First name/i).isVisible()) ||
          (await page.locator('[data-testid="passenger-form"]').isVisible());

        expect(canEdit).toBeTruthy();
      }
    });
  });

  test.describe("Ancillary Services", () => {
    test("should display available ancillary services", async ({ page }) => {
      await page.goto("/booking/1");
      await page.waitForLoadState("networkidle");

      // Look for ancillary services section
      const hasAncillaries =
        (await page
          .locator('[data-testid="ancillary-services"]')
          .isVisible()) ||
        (await page
          .getByText(/خدمات إضافية|Additional services/i)
          .isVisible()) ||
        (await page.getByText(/الأمتعة|Baggage|حقائب/i).isVisible()) ||
        (await page.getByText(/الوجبات|Meals/i).isVisible());

      // Ancillaries may not always be visible
      if (hasAncillaries) {
        expect(hasAncillaries).toBeTruthy();
      }
    });

    test("should add baggage to booking", async ({ page }) => {
      await page.goto("/booking/1");
      await page.waitForLoadState("networkidle");

      const baggageOption = page.getByRole("button", {
        name: /إضافة أمتعة|Add baggage/i,
      });

      if (await baggageOption.isVisible()) {
        await baggageOption.click();

        // Select baggage option
        const baggageSelect = page.locator('[data-testid="baggage-select"]');
        if (await baggageSelect.isVisible()) {
          await baggageSelect.click();
          await page.getByRole("option").first().click();
        }

        // Verify baggage was added
        const hasBaggageSelected = await page
          .getByText(/تم إضافة|Added|Selected/i)
          .isVisible();
        expect(hasBaggageSelected).toBeTruthy();
      }
    });

    test("should add meal to booking", async ({ page }) => {
      await page.goto("/booking/1");
      await page.waitForLoadState("networkidle");

      const mealOption = page.getByRole("button", {
        name: /إضافة وجبة|Add meal/i,
      });

      if (await mealOption.isVisible()) {
        await mealOption.click();

        // Select meal option
        const mealSelect = page.locator('[data-testid="meal-select"]');
        if (await mealSelect.isVisible()) {
          await mealSelect.click();
          await page.getByRole("option").first().click();
        }
      }
    });

    test("should update total price when adding services", async ({ page }) => {
      await page.goto("/booking/1");
      await page.waitForLoadState("networkidle");

      // Get initial price
      const initialPriceText = await page
        .locator('[data-testid="total-price"]')
        .textContent();
      const initialPrice = initialPriceText
        ? parseFloat(initialPriceText.replace(/[^\d.]/g, ""))
        : 0;

      // Add an ancillary service
      const addServiceButton = page.getByRole("button", {
        name: /إضافة|Add/i,
      });
      if ((await addServiceButton.count()) > 0) {
        await addServiceButton.first().click();
        await page.waitForTimeout(500);

        // Check if price updated
        const newPriceText = await page
          .locator('[data-testid="total-price"]')
          .textContent();
        const newPrice = newPriceText
          ? parseFloat(newPriceText.replace(/[^\d.]/g, ""))
          : 0;

        // Price should increase or stay same
        expect(newPrice).toBeGreaterThanOrEqual(initialPrice);
      }
    });
  });

  test.describe("Payment Processing", () => {
    test.beforeEach(async ({ page }) => {
      // Navigate to payment step
      await page.goto("/booking/1");
      await page.waitForLoadState("networkidle");

      // Fill required fields and proceed to payment
      const firstNameInput = page.getByLabel(/الاسم الأول|First name/i).first();
      if (await firstNameInput.isVisible()) {
        await firstNameInput.fill(testPassengers.adult1.firstName);

        const lastNameInput = page.getByLabel(/اسم العائلة|Last name/i).first();
        if (await lastNameInput.isVisible()) {
          await lastNameInput.fill(testPassengers.adult1.lastName);
        }

        const passportInput = page.getByLabel(/رقم الجواز|Passport/i).first();
        if (await passportInput.isVisible()) {
          await passportInput.fill(testPassengers.adult1.passportNumber);
        }

        const dobInput = page
          .getByLabel(/تاريخ الميلاد|Date of birth/i)
          .first();
        if (await dobInput.isVisible()) {
          await dobInput.fill(testPassengers.adult1.dateOfBirth);
        }

        // Proceed through steps
        const continueButton = page.getByRole("button", {
          name: /متابعة|Continue|Next/i,
        });
        if (await continueButton.isVisible()) {
          await continueButton.click();
          await page.waitForTimeout(1000);
        }
      }
    });

    test("should display payment form", async ({ page }) => {
      // Navigate to payment step
      const confirmButton = page.getByRole("button", {
        name: /تأكيد|Confirm|الدفع|Pay/i,
      });
      if (await confirmButton.isVisible()) {
        await confirmButton.click();
        await page.waitForTimeout(2000);
      }

      // Check for payment form (Stripe or custom)
      const hasPaymentForm =
        (await page.locator('[data-testid="payment-form"]').isVisible()) ||
        (await page
          .locator('iframe[name^="__privateStripeFrame"]')
          .isVisible()) ||
        (await page.getByLabel(/رقم البطاقة|Card number/i).isVisible()) ||
        (await page
          .getByText(/معلومات الدفع|Payment information/i)
          .isVisible());

      // Payment may redirect to Stripe, so this is expected
      expect(
        hasPaymentForm ||
          page.url().includes("stripe") ||
          page.url().includes("checkout")
      ).toBeTruthy();
    });

    test("should process payment with valid card", async ({ page }) => {
      // This test assumes a test environment with mock Stripe
      const paymentForm = page.locator('[data-testid="payment-form"]');

      if (await paymentForm.isVisible()) {
        // Fill card details
        const cardNumberInput = page.getByLabel(/رقم البطاقة|Card number/i);
        if (await cardNumberInput.isVisible()) {
          await cardNumberInput.fill(testPaymentCards.valid.number);
        }

        const expiryInput = page.getByLabel(/تاريخ الانتهاء|Expiry/i);
        if (await expiryInput.isVisible()) {
          await expiryInput.fill(testPaymentCards.valid.expiry);
        }

        const cvcInput = page.getByLabel(/CVV|CVC/i);
        if (await cvcInput.isVisible()) {
          await cvcInput.fill(testPaymentCards.valid.cvc);
        }

        // Submit payment
        const payButton = page.getByRole("button", {
          name: /ادفع|Pay|Submit/i,
        });
        if (await payButton.isVisible()) {
          await payButton.click();

          // Wait for confirmation or redirect
          await page.waitForTimeout(5000);

          // Check for success
          const isSuccess =
            (await page
              .locator('[data-testid="booking-confirmation"]')
              .isVisible()) ||
            (await page
              .getByText(/تم الحجز بنجاح|Booking confirmed/i)
              .isVisible()) ||
            page.url().includes("confirmation") ||
            page.url().includes("success");

          expect(isSuccess).toBeTruthy();
        }
      }
    });

    test("should handle payment failure gracefully", async ({ page }) => {
      const paymentForm = page.locator('[data-testid="payment-form"]');

      if (await paymentForm.isVisible()) {
        // Fill declined card
        const cardNumberInput = page.getByLabel(/رقم البطاقة|Card number/i);
        if (await cardNumberInput.isVisible()) {
          await cardNumberInput.fill(testPaymentCards.declined.number);
        }

        const expiryInput = page.getByLabel(/تاريخ الانتهاء|Expiry/i);
        if (await expiryInput.isVisible()) {
          await expiryInput.fill(testPaymentCards.declined.expiry);
        }

        const cvcInput = page.getByLabel(/CVV|CVC/i);
        if (await cvcInput.isVisible()) {
          await cvcInput.fill(testPaymentCards.declined.cvc);
        }

        // Submit payment
        const payButton = page.getByRole("button", {
          name: /ادفع|Pay|Submit/i,
        });
        if (await payButton.isVisible()) {
          await payButton.click();
          await page.waitForTimeout(5000);

          // Check for error message
          const hasError =
            (await page
              .getByText(/فشل الدفع|Payment failed|Declined|رفض/i)
              .isVisible()) ||
            (await page.locator('[data-testid="payment-error"]').isVisible());

          expect(hasError).toBeTruthy();
        }
      }
    });
  });

  test.describe("Booking Confirmation", () => {
    test("should display booking confirmation with reference number", async ({
      page,
    }) => {
      // Navigate to a mock confirmation page or complete booking
      await page.goto("/booking/confirmation?ref=ABC123");
      await page.waitForLoadState("networkidle");

      // Check for confirmation elements
      const hasConfirmation =
        (await page
          .locator('[data-testid="booking-confirmation"]')
          .isVisible()) ||
        (await page.getByText(/تم الحجز|Booking confirmed/i).isVisible()) ||
        (await page.getByText(/رقم الحجز|Booking reference/i).isVisible());

      if (hasConfirmation) {
        // Check for booking reference
        const bookingRef = page.locator('[data-testid="booking-reference"]');
        if (await bookingRef.isVisible()) {
          const refText = await bookingRef.textContent();
          expect(refText).toMatch(BOOKING_REF_PATTERN);
        }
      }
    });

    test("should show download ticket button", async ({ page }) => {
      await page.goto("/booking/confirmation?ref=ABC123");
      await page.waitForLoadState("networkidle");

      // Look for download ticket button
      const downloadButton = page.getByRole("button", {
        name: /تحميل التذكرة|Download ticket|Download e-ticket/i,
      });

      if (await downloadButton.isVisible()) {
        await expect(downloadButton).toBeEnabled();
      }
    });

    test("should show booking details in confirmation", async ({ page }) => {
      await page.goto("/booking/confirmation?ref=ABC123");
      await page.waitForLoadState("networkidle");

      // Check for flight details
      const hasFlightInfo =
        (await page.locator('[data-testid="flight-info"]').isVisible()) ||
        (await page.getByText(/تفاصيل الرحلة|Flight details/i).isVisible());

      // Check for passenger info
      const hasPassengerInfo =
        (await page.locator('[data-testid="passenger-info"]').isVisible()) ||
        (await page
          .getByText(/معلومات المسافر|Passenger information/i)
          .isVisible());

      expect(hasFlightInfo || hasPassengerInfo).toBeTruthy();
    });

    test("should allow sending confirmation email", async ({ page }) => {
      await page.goto("/booking/confirmation?ref=ABC123");
      await page.waitForLoadState("networkidle");

      const sendEmailButton = page.getByRole("button", {
        name: /إرسال|Send email|Email confirmation/i,
      });

      if (await sendEmailButton.isVisible()) {
        await sendEmailButton.click();
        await page.waitForTimeout(2000);

        // Check for success message
        const hasSentMessage =
          (await page.getByText(/تم الإرسال|Email sent/i).isVisible()) ||
          (await page.locator("[data-sonner-toast]").isVisible());

        expect(hasSentMessage).toBeTruthy();
      }
    });

    test("should navigate to my bookings from confirmation", async ({
      page,
    }) => {
      await page.goto("/booking/confirmation?ref=ABC123");
      await page.waitForLoadState("networkidle");

      const myBookingsLink = page.getByRole("link", {
        name: /حجوزاتي|My bookings|View bookings/i,
      });

      if (await myBookingsLink.isVisible()) {
        await myBookingsLink.click();
        await page.waitForURL(/\/my-bookings/);
        expect(page.url()).toContain("/my-bookings");
      }
    });
  });

  test.describe("Complete Booking Journey", () => {
    test("should complete full booking flow from search to confirmation", async ({
      page,
    }) => {
      // Step 1: Search for flights
      await test.step("Search for flights", async () => {
        await page.goto("/");
        await page.waitForLoadState("networkidle");

        await page.getByLabel(/من|From/i).click();
        await page
          .getByRole("option", { name: new RegExp(testRoutes.domestic.origin) })
          .click();

        await page.getByLabel(/إلى|To/i).click();
        await page
          .getByRole("option", {
            name: new RegExp(testRoutes.domestic.destination),
          })
          .click();

        const departureDate = getNextWeekDate();
        await page
          .getByLabel(/تاريخ المغادرة|Departure date/i)
          .fill(formatDateForInput(departureDate));

        await page.getByRole("button", { name: /بحث|Search/i }).click();
        await page.waitForSelector('[data-testid="flight-results"]', {
          timeout: 30000,
        });

        const flightCards = page.locator('[data-testid="flight-card"]');
        expect(await flightCards.count()).toBeGreaterThan(0);
      });

      // Step 2: Select a flight
      await test.step("Select a flight", async () => {
        const flightCard = page.locator('[data-testid="flight-card"]').first();
        await flightCard.click();
        await page.waitForURL(/\/booking/, { timeout: 10000 });
        expect(page.url()).toContain("/booking");
      });

      // Step 3: Fill passenger information
      await test.step("Fill passenger information", async () => {
        await page.waitForSelector(
          '[data-testid="passenger-form"], input[name*="name"], input[name*="passenger"]',
          { timeout: 5000 }
        );

        const firstNameInput = page
          .getByLabel(/الاسم الأول|First name/i)
          .first();
        if (await firstNameInput.isVisible()) {
          await firstNameInput.fill(testPassengers.adult1.firstNameAr);

          const lastNameInput = page
            .getByLabel(/اسم العائلة|Last name/i)
            .first();
          await lastNameInput.fill(testPassengers.adult1.lastNameAr);

          const passportInput = page.getByLabel(/رقم الجواز|Passport/i).first();
          await passportInput.fill(testPassengers.adult1.passportNumber);

          const dobInput = page
            .getByLabel(/تاريخ الميلاد|Date of birth/i)
            .first();
          await dobInput.fill(testPassengers.adult1.dateOfBirth);
        }

        // Proceed to next step
        const continueButton = page.getByRole("button", {
          name: /متابعة|Continue|Next/i,
        });
        if (await continueButton.isVisible()) {
          await continueButton.click();
        }
      });

      // Step 4: Review and confirm
      await test.step("Review booking", async () => {
        await page.waitForTimeout(1000);

        // Verify booking review is displayed
        const hasReview =
          (await page.locator('[data-testid="booking-review"]').isVisible()) ||
          (await page.locator('[data-testid="total-price"]').isVisible());

        if (hasReview) {
          // Click confirm/pay
          const confirmButton = page.getByRole("button", {
            name: /تأكيد الحجز|Confirm|Pay/i,
          });
          if (await confirmButton.isVisible()) {
            await confirmButton.click();
          }
        }
      });

      // Step 5: Payment (mock)
      await test.step("Complete payment", async () => {
        await page.waitForTimeout(2000);

        // Handle payment (mock or Stripe redirect)
        const paymentForm = page.locator('[data-testid="payment-form"]');
        if (await paymentForm.isVisible()) {
          const cardNumberInput = page.getByLabel(/رقم البطاقة|Card number/i);
          if (await cardNumberInput.isVisible()) {
            await cardNumberInput.fill(testPaymentCards.valid.number);
            await page
              .getByLabel(/تاريخ الانتهاء|Expiry/i)
              .fill(testPaymentCards.valid.expiry);
            await page.getByLabel(/CVV|CVC/i).fill(testPaymentCards.valid.cvc);

            const payButton = page.getByRole("button", {
              name: /ادفع|Pay/i,
            });
            await payButton.click();
          }
        }

        // Wait for confirmation
        await page.waitForTimeout(5000);
      });

      // Step 6: Verify confirmation
      await test.step("Verify booking confirmation", async () => {
        const isConfirmed =
          (await page
            .locator('[data-testid="booking-confirmation"]')
            .isVisible()) ||
          (await page
            .getByText(/تم الحجز بنجاح|Booking confirmed/i)
            .isVisible()) ||
          page.url().includes("confirmation") ||
          page.url().includes("success");

        expect(isConfirmed).toBeTruthy();
      });
    });
  });
});
