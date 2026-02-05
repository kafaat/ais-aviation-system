/**
 * Test Helpers for E2E Tests
 * Common utility functions and page interactions
 */

import { Page, expect, Locator } from "@playwright/test";
import {
  testUsers,
  testRoutes,
  getNextWeekDate,
  formatDateForInput,
} from "./test-data";

/**
 * Authentication helpers
 */
export async function login(
  page: Page,
  email: string = testUsers.regular.email,
  password: string = testUsers.regular.password
): Promise<void> {
  await page.goto("/login");
  await page.waitForLoadState("networkidle");

  // Fill login form
  await page.getByLabel(/البريد الإلكتروني|Email/i).fill(email);
  await page.getByLabel(/كلمة المرور|Password/i).fill(password);

  // Submit form
  await page
    .getByRole("button", { name: /تسجيل الدخول|Login|Sign in/i })
    .click();

  // Wait for navigation after login
  await page.waitForURL(/^(?!.*\/login).*$/);
}

export async function loginAsAdmin(page: Page): Promise<void> {
  await login(page, testUsers.admin.email, testUsers.admin.password);
}

export async function logout(page: Page): Promise<void> {
  // Look for user menu or logout button
  const userMenu = page.locator('[data-testid="user-menu"]');
  if (await userMenu.isVisible()) {
    await userMenu.click();
  }

  const logoutButton = page.getByRole("button", {
    name: /تسجيل الخروج|Logout|Sign out/i,
  });
  if (await logoutButton.isVisible()) {
    await logoutButton.click();
  }

  // Wait for redirect to home or login
  await page.waitForLoadState("networkidle");
}

export async function isLoggedIn(page: Page): Promise<boolean> {
  // Check for authenticated user indicators
  const profileLink = page.getByRole("link", { name: /الملف الشخصي|Profile/i });
  const logoutButton = page.getByRole("button", {
    name: /تسجيل الخروج|Logout/i,
  });

  return (
    (await profileLink.isVisible()) ||
    (await logoutButton.isVisible()) ||
    (await page.locator('[data-testid="user-menu"]').isVisible())
  );
}

/**
 * Search helpers
 */
export async function performFlightSearch(
  page: Page,
  options: {
    origin?: string;
    destination?: string;
    departureDate?: Date;
    passengers?: number;
  } = {}
): Promise<void> {
  const {
    origin = testRoutes.domestic.origin,
    destination = testRoutes.domestic.destination,
    departureDate = getNextWeekDate(),
    passengers = 1,
  } = options;

  // Select origin
  await page.getByLabel(/من|From/i).click();
  await page.getByRole("option", { name: new RegExp(origin) }).click();

  // Select destination
  await page.getByLabel(/إلى|To/i).click();
  await page.getByRole("option", { name: new RegExp(destination) }).click();

  // Set departure date
  await page
    .getByLabel(/تاريخ المغادرة|Departure date/i)
    .fill(formatDateForInput(departureDate));

  // Set passengers if input exists
  const passengersInput = page.getByLabel(/عدد المسافرين|Passengers/i);
  if (await passengersInput.isVisible()) {
    await passengersInput.fill(passengers.toString());
  }

  // Click search
  await page.getByRole("button", { name: /بحث|Search/i }).click();
}

export async function waitForSearchResults(page: Page): Promise<void> {
  await page.waitForSelector('[data-testid="flight-results"]', {
    timeout: 30000,
  });
}

export async function getFlightCards(page: Page): Promise<Locator> {
  return page.locator('[data-testid="flight-card"]');
}

/**
 * Filter helpers
 */
export async function applyPriceFilter(
  page: Page,
  min: number,
  max: number
): Promise<void> {
  const priceSlider = page.locator('[data-testid="price-filter"]');
  if (await priceSlider.isVisible()) {
    // Interact with price range slider
    await priceSlider
      .locator('input[type="range"]')
      .first()
      .fill(min.toString());
    await priceSlider
      .locator('input[type="range"]')
      .last()
      .fill(max.toString());
  }
}

export async function filterByAirline(
  page: Page,
  airlineName: string
): Promise<void> {
  const airlineFilter = page.locator('[data-testid="airline-filter"]');
  if (await airlineFilter.isVisible()) {
    await airlineFilter.getByLabel(airlineName).check();
  }
}

export async function filterByStops(
  page: Page,
  stops: "direct" | "1" | "2+"
): Promise<void> {
  const stopsFilter = page.locator('[data-testid="stops-filter"]');
  if (await stopsFilter.isVisible()) {
    const labelMap = {
      direct: /مباشر|Direct|Non-stop/i,
      "1": /توقف واحد|1 stop/i,
      "2+": /توقفان|2\+ stops/i,
    };
    await stopsFilter.getByLabel(labelMap[stops]).check();
  }
}

/**
 * Booking helpers
 */
export async function selectFirstFlight(page: Page): Promise<void> {
  const flightCards = await getFlightCards(page);
  await flightCards.first().click();
}

export async function fillPassengerForm(
  page: Page,
  passengerIndex: number,
  data: {
    firstName: string;
    lastName: string;
    passportNumber: string;
    dateOfBirth: string;
  }
): Promise<void> {
  const suffix = passengerIndex > 1 ? ` (راكب ${passengerIndex})` : "";
  const suffixEn = passengerIndex > 1 ? ` (Passenger ${passengerIndex})` : "";

  await page
    .getByLabel(new RegExp(`الاسم الأول${suffix}|First name${suffixEn}`, "i"))
    .fill(data.firstName);

  await page
    .getByLabel(new RegExp(`اسم العائلة${suffix}|Last name${suffixEn}`, "i"))
    .fill(data.lastName);

  await page
    .getByLabel(new RegExp(`رقم الجواز${suffix}|Passport${suffixEn}`, "i"))
    .fill(data.passportNumber);

  await page
    .getByLabel(
      new RegExp(`تاريخ الميلاد${suffix}|Date of birth${suffixEn}`, "i")
    )
    .fill(data.dateOfBirth);
}

/**
 * Payment helpers
 */
export async function fillPaymentForm(
  page: Page,
  cardData: {
    number: string;
    expiry: string;
    cvc: string;
    name?: string;
  }
): Promise<void> {
  // Handle Stripe iframe if present
  const stripeFrame = page.frameLocator('iframe[name^="__privateStripeFrame"]');

  // Fill card number
  const cardNumberInput =
    page.getByLabel(/رقم البطاقة|Card number/i) ||
    stripeFrame.getByPlaceholder(/Card number/i);
  await cardNumberInput.fill(cardData.number);

  // Fill expiry
  const expiryInput =
    page.getByLabel(/تاريخ الانتهاء|Expiry/i) ||
    stripeFrame.getByPlaceholder(/MM \/ YY/i);
  await expiryInput.fill(cardData.expiry);

  // Fill CVC
  const cvcInput =
    page.getByLabel(/CVV|CVC/i) || stripeFrame.getByPlaceholder(/CVC/i);
  await cvcInput.fill(cardData.cvc);

  // Fill name if provided and field exists
  if (cardData.name) {
    const nameInput = page.getByLabel(/اسم حامل البطاقة|Cardholder/i);
    if (await nameInput.isVisible()) {
      await nameInput.fill(cardData.name);
    }
  }
}

/**
 * Navigation helpers
 */
export async function navigateToProfile(page: Page): Promise<void> {
  await page.goto("/profile");
  await page.waitForLoadState("networkidle");
}

export async function navigateToMyBookings(page: Page): Promise<void> {
  await page.goto("/my-bookings");
  await page.waitForLoadState("networkidle");
}

export async function navigateToAdmin(page: Page): Promise<void> {
  await page.goto("/admin");
  await page.waitForLoadState("networkidle");
}

export async function navigateToAdminAnalytics(page: Page): Promise<void> {
  await page.goto("/analytics");
  await page.waitForLoadState("networkidle");
}

/**
 * Assertion helpers
 */
export async function expectToastMessage(
  page: Page,
  message: RegExp | string
): Promise<void> {
  const toast = page.locator("[data-sonner-toast]");
  await expect(toast.filter({ hasText: message })).toBeVisible();
}

export async function expectNoErrors(page: Page): Promise<void> {
  // Check no error toasts
  const errorToast = page.locator('[data-sonner-toast][data-type="error"]');
  await expect(errorToast).not.toBeVisible();

  // Check no error messages
  const errorMessage = page.locator('[data-testid="error-message"]');
  await expect(errorMessage).not.toBeVisible();
}

export async function expectValidationError(
  page: Page,
  fieldLabel: string | RegExp
): Promise<void> {
  const field = page.getByLabel(fieldLabel);
  await expect(field).toHaveAttribute("aria-invalid", "true");
}

/**
 * Wait helpers
 */
export async function waitForApiResponse(
  page: Page,
  urlPattern: string | RegExp
): Promise<void> {
  await page.waitForResponse(
    response =>
      (typeof urlPattern === "string"
        ? response.url().includes(urlPattern)
        : urlPattern.test(response.url())) && response.status() === 200
  );
}

export async function waitForNetworkIdle(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle");
}

/**
 * Debug helpers
 */
export async function takeScreenshotOnFailure(
  page: Page,
  testName: string
): Promise<void> {
  await page.screenshot({
    path: `test-results/screenshots/${testName}-${Date.now()}.png`,
    fullPage: true,
  });
}

export async function logPageErrors(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", error => {
    errors.push(error.message);
  });
  return errors;
}
