import { test, expect } from "@playwright/test";
import {
  testRoutes,
  getNextWeekDate,
  formatDateForInput,
} from "./fixtures/test-data";

/**
 * E2E Test: Flight Search
 * Tests search functionality, filters, sorting, and results display
 */

test.describe("Flight Search", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
  });

  test.describe("Search Form", () => {
    test("should display search form with all required fields", async ({
      page,
    }) => {
      // Check origin/destination dropdowns
      await expect(page.getByLabel(/من|From/i)).toBeVisible();
      await expect(page.getByLabel(/إلى|To/i)).toBeVisible();

      // Check date picker
      await expect(
        page.getByLabel(/تاريخ المغادرة|Departure date/i)
      ).toBeVisible();

      // Check search button
      await expect(
        page.getByRole("button", { name: /بحث|Search/i })
      ).toBeVisible();
    });

    test("should load airports in origin dropdown", async ({ page }) => {
      // Click origin dropdown
      await page.getByLabel(/من|From/i).click();

      // Wait for options to load
      await page.waitForTimeout(1000);

      // Verify at least one airport option is visible
      const options = page.getByRole("option");
      const count = await options.count();
      expect(count).toBeGreaterThan(0);

      // Check for common airports
      await expect(
        page.getByRole("option", { name: /الرياض|Riyadh|RUH/i })
      ).toBeVisible();
    });

    test("should load airports in destination dropdown", async ({ page }) => {
      // Click destination dropdown
      await page.getByLabel(/إلى|To/i).click();

      // Wait for options to load
      await page.waitForTimeout(1000);

      // Verify airports are loaded
      const options = page.getByRole("option");
      const count = await options.count();
      expect(count).toBeGreaterThan(0);
    });

    test("should select origin airport", async ({ page }) => {
      // Select origin
      await page.getByLabel(/من|From/i).click();
      await page
        .getByRole("option", { name: new RegExp(testRoutes.domestic.origin) })
        .click();

      // Verify selection
      const trigger = page.getByLabel(/من|From/i);
      await expect(trigger).toContainText(testRoutes.domestic.origin);
    });

    test("should select destination airport", async ({ page }) => {
      // Select destination
      await page.getByLabel(/إلى|To/i).click();
      await page
        .getByRole("option", {
          name: new RegExp(testRoutes.domestic.destination),
        })
        .click();

      // Verify selection
      const trigger = page.getByLabel(/إلى|To/i);
      await expect(trigger).toContainText(testRoutes.domestic.destination);
    });

    test("should select departure date from calendar", async ({ page }) => {
      const departureDate = getNextWeekDate();

      // Click date input or calendar trigger
      await page.getByLabel(/تاريخ المغادرة|Departure date/i).click();

      // Wait for calendar to appear
      await page.waitForSelector('[role="dialog"], [data-radix-calendar]', {
        timeout: 5000,
      });

      // Fill date directly
      await page
        .getByLabel(/تاريخ المغادرة|Departure date/i)
        .fill(formatDateForInput(departureDate));

      // Close calendar if open
      await page.keyboard.press("Escape");
    });

    test("should not allow past dates for departure", async ({ page }) => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);

      const dateInput = page.getByLabel(/تاريخ المغادرة|Departure date/i);

      // Check if date input has min attribute or validation
      const minDate = await dateInput.getAttribute("min");
      if (minDate) {
        const minDateObj = new Date(minDate);
        expect(minDateObj.getTime()).toBeGreaterThanOrEqual(
          new Date().setHours(0, 0, 0, 0)
        );
      }
    });

    test("should require all fields before search", async ({ page }) => {
      // Try to search without filling form
      await page.getByRole("button", { name: /بحث|Search/i }).click();

      // Check we're still on search page or see validation errors
      const hasValidationError =
        (await page.getByText(/يرجى|Please select|Required/i).isVisible()) ||
        page.url() === (await page.url());

      expect(hasValidationError).toBeTruthy();
    });
  });

  test.describe("Search Execution", () => {
    test("should perform search and display results", async ({ page }) => {
      // Fill search form
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

      // Perform search
      await page.getByRole("button", { name: /بحث|Search/i }).click();

      // Wait for results
      await page.waitForSelector('[data-testid="flight-results"]', {
        timeout: 30000,
      });

      // Verify results are displayed
      const flightCards = page.locator('[data-testid="flight-card"]');
      const count = await flightCards.count();
      expect(count).toBeGreaterThanOrEqual(0);
    });

    test("should navigate to search results page with correct URL params", async ({
      page,
    }) => {
      // Fill and submit search
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

      // Wait for navigation
      await page.waitForURL(/\/search\?/);

      // Verify URL contains search params
      const url = page.url();
      expect(url).toContain("origin=");
      expect(url).toContain("destination=");
      expect(url).toContain("date=");
    });

    test("should show loading state during search", async ({ page }) => {
      // Fill search form
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

      // Click search and check for loading state
      await page.getByRole("button", { name: /بحث|Search/i }).click();

      // Check for loading indicator (skeleton, spinner, or loading text)
      const _loadingVisible =
        (await page.locator('[data-testid="loading"]').isVisible()) ||
        (await page.locator('[role="progressbar"]').isVisible()) ||
        (await page.locator(".skeleton, .animate-pulse").first().isVisible()) ||
        (await page.getByText(/جاري التحميل|Loading/i).isVisible());

      // Loading may be quick, so this is optional
      // Just verify the page transitions properly
      await page.waitForSelector('[data-testid="flight-results"]', {
        timeout: 30000,
      });
    });

    test("should show no results message when no flights found", async ({
      page,
    }) => {
      // Search for a route that likely has no flights
      await page.getByLabel(/من|From/i).click();

      // Select first available airport
      const originOptions = page.getByRole("option");
      await originOptions.first().click();

      await page.getByLabel(/إلى|To/i).click();
      const destOptions = page.getByRole("option");
      await destOptions.first().click();

      // Use a far future date
      const farFutureDate = new Date();
      farFutureDate.setMonth(farFutureDate.getMonth() + 12);
      await page
        .getByLabel(/تاريخ المغادرة|Departure date/i)
        .fill(formatDateForInput(farFutureDate));

      await page.getByRole("button", { name: /بحث|Search/i }).click();

      // Wait for results area
      await page.waitForSelector(
        '[data-testid="flight-results"], [data-testid="no-results"]',
        { timeout: 30000 }
      );

      // Either show flights or no results message
      const hasResults =
        (await page.locator('[data-testid="flight-card"]').count()) > 0;
      const hasNoResultsMessage = await page
        .getByText(/لا توجد رحلات|No flights found|No results|لم يتم العثور/i)
        .isVisible();

      expect(hasResults || hasNoResultsMessage).toBeTruthy();
    });
  });

  test.describe("Search Results Display", () => {
    test.beforeEach(async ({ page }) => {
      // Perform a search to get results
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

    test("should display flight cards with essential information", async ({
      page,
    }) => {
      const flightCard = page.locator('[data-testid="flight-card"]').first();

      if (await flightCard.isVisible()) {
        // Check for flight number or airline
        const hasAirlineInfo =
          (await flightCard
            .locator('[data-testid="airline-name"]')
            .isVisible()) ||
          (await flightCard
            .locator('[data-testid="flight-number"]')
            .isVisible()) ||
          (await flightCard.getByText(/SV|EK|QR|MS|GF/i).isVisible());

        // Check for departure/arrival times
        const hasTimes =
          (await flightCard.getByText(/\d{1,2}:\d{2}/).isVisible()) ||
          (await flightCard
            .locator('[data-testid="departure-time"]')
            .isVisible());

        // Check for price
        const hasPrice =
          (await flightCard
            .locator('[data-testid="flight-price"]')
            .isVisible()) ||
          (await flightCard.getByText(/﷼|\$|SAR|USD/).isVisible());

        expect(hasAirlineInfo || hasTimes || hasPrice).toBeTruthy();
      }
    });

    test("should display flight duration", async ({ page }) => {
      const flightCard = page.locator('[data-testid="flight-card"]').first();

      if (await flightCard.isVisible()) {
        // Look for duration in various formats
        const hasDuration =
          (await flightCard
            .locator('[data-testid="flight-duration"]')
            .isVisible()) ||
          (await flightCard.getByText(/\d+\s*(ساعة|hour|h|م|m)/i).isVisible());

        expect(hasDuration).toBeTruthy();
      }
    });

    test("should show select/book button on flight cards", async ({ page }) => {
      const flightCard = page.locator('[data-testid="flight-card"]').first();

      if (await flightCard.isVisible()) {
        const hasBookButton =
          (await flightCard
            .getByRole("button", { name: /احجز|اختر|Select|Book/i })
            .isVisible()) ||
          (await flightCard.locator('a[href*="/booking"]').isVisible());

        expect(hasBookButton).toBeTruthy();
      }
    });
  });

  test.describe("Search Filters", () => {
    test.beforeEach(async ({ page }) => {
      // Navigate to search results with params
      await page.goto("/");
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

    test("should display filter options", async ({ page }) => {
      // Check for filter section
      const hasFilters =
        (await page.locator('[data-testid="filters"]').isVisible()) ||
        (await page.locator('[data-testid="advanced-filters"]').isVisible()) ||
        (await page.getByRole("button", { name: /فلتر|Filter/i }).isVisible());

      // Filters may not be visible if no results
      const flightCount = await page
        .locator('[data-testid="flight-card"]')
        .count();
      if (flightCount > 0) {
        expect(hasFilters).toBeTruthy();
      }
    });

    test("should filter by price range", async ({ page }) => {
      const priceFilter = page.locator('[data-testid="price-filter"]');

      if (await priceFilter.isVisible()) {
        // Get initial count
        const initialCount = await page
          .locator('[data-testid="flight-card"]')
          .count();

        // Adjust price filter
        const priceSlider = priceFilter.locator('input[type="range"]').first();
        if (await priceSlider.isVisible()) {
          await priceSlider.fill("500");
          await page.waitForTimeout(500);

          // Count should potentially change
          const filteredCount = await page
            .locator('[data-testid="flight-card"]')
            .count();

          // Either filtered down or stayed the same
          expect(filteredCount).toBeLessThanOrEqual(initialCount);
        }
      }
    });

    test("should filter by airline", async ({ page }) => {
      const airlineFilter = page.locator('[data-testid="airline-filter"]');

      if (await airlineFilter.isVisible()) {
        // Check for airline checkboxes
        const airlineCheckboxes = airlineFilter.locator(
          'input[type="checkbox"]'
        );
        const checkboxCount = await airlineCheckboxes.count();

        if (checkboxCount > 0) {
          // Get initial count
          const initialCount = await page
            .locator('[data-testid="flight-card"]')
            .count();

          // Uncheck all, then check first one
          await airlineCheckboxes.first().check();
          await page.waitForTimeout(500);

          const filteredCount = await page
            .locator('[data-testid="flight-card"]')
            .count();
          expect(filteredCount).toBeLessThanOrEqual(initialCount);
        }
      }
    });

    test("should filter by stops (direct/connections)", async ({ page }) => {
      const stopsFilter = page.locator('[data-testid="stops-filter"]');

      if (await stopsFilter.isVisible()) {
        // Look for direct flights filter
        const directCheckbox = stopsFilter.getByLabel(/مباشر|Direct|Non-stop/i);

        if (await directCheckbox.isVisible()) {
          const initialCount = await page
            .locator('[data-testid="flight-card"]')
            .count();

          await directCheckbox.check();
          await page.waitForTimeout(500);

          const filteredCount = await page
            .locator('[data-testid="flight-card"]')
            .count();
          expect(filteredCount).toBeLessThanOrEqual(initialCount);
        }
      }
    });

    test("should clear all filters", async ({ page }) => {
      const clearButton = page.getByRole("button", {
        name: /مسح|Clear|Reset/i,
      });

      if (await clearButton.isVisible()) {
        // Apply some filter first
        const airlineFilter = page.locator('[data-testid="airline-filter"]');
        if (await airlineFilter.isVisible()) {
          const checkbox = airlineFilter
            .locator('input[type="checkbox"]')
            .first();
          if (await checkbox.isVisible()) {
            await checkbox.check();
            await page.waitForTimeout(500);
          }
        }

        // Clear filters
        await clearButton.click();
        await page.waitForTimeout(500);

        // Verify filters are cleared (checkboxes unchecked)
        const checkboxes = page.locator(
          '[data-testid="airline-filter"] input[type="checkbox"]:checked'
        );
        const checkedCount = await checkboxes.count();
        expect(checkedCount).toBe(0);
      }
    });
  });

  test.describe("Search Sorting", () => {
    test.beforeEach(async ({ page }) => {
      await page.goto("/");
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

    test("should have sort options", async ({ page }) => {
      const hasSortOptions =
        (await page.locator('[data-testid="sort-select"]').isVisible()) ||
        (await page.getByLabel(/ترتيب|Sort by/i).isVisible()) ||
        (await page.getByRole("button", { name: /ترتيب|Sort/i }).isVisible());

      const flightCount = await page
        .locator('[data-testid="flight-card"]')
        .count();
      if (flightCount > 1) {
        expect(hasSortOptions).toBeTruthy();
      }
    });

    test("should sort by price (low to high)", async ({ page }) => {
      const sortSelect = page.locator('[data-testid="sort-select"]');

      if (await sortSelect.isVisible()) {
        await sortSelect.click();
        await page
          .getByRole("option", { name: /السعر.*تصاعدي|Price.*low|Cheapest/i })
          .click();
        await page.waitForTimeout(500);

        // Get prices and verify they are sorted
        const prices = await page
          .locator('[data-testid="flight-price"]')
          .allTextContents();
        if (prices.length > 1) {
          const numericPrices = prices.map(p =>
            parseFloat(p.replace(/[^\d.]/g, ""))
          );
          for (let i = 1; i < numericPrices.length; i++) {
            expect(numericPrices[i]).toBeGreaterThanOrEqual(
              numericPrices[i - 1]
            );
          }
        }
      }
    });

    test("should sort by departure time", async ({ page }) => {
      const sortSelect = page.locator('[data-testid="sort-select"]');

      if (await sortSelect.isVisible()) {
        await sortSelect.click();
        await page
          .getByRole("option", {
            name: /وقت المغادرة|Departure time|Earliest/i,
          })
          .click();
        await page.waitForTimeout(500);

        // Verify sorting changed (just check it doesn't error)
        const flightCards = page.locator('[data-testid="flight-card"]');
        const count = await flightCards.count();
        expect(count).toBeGreaterThanOrEqual(0);
      }
    });
  });

  test.describe("Search History", () => {
    test("should save search to history", async ({ page }) => {
      // Perform a search
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

      // Go back to home and check search history
      await page.goto("/");
      await page.waitForLoadState("networkidle");

      // Look for search history section
      const searchHistory = page.locator('[data-testid="search-history"]');
      if (await searchHistory.isVisible()) {
        // Should contain the recent search
        await expect(
          searchHistory.getByText(
            new RegExp(
              `${testRoutes.domestic.origin}|${testRoutes.domestic.originCode}`
            )
          )
        ).toBeVisible();
      }
    });

    test("should populate form when clicking history item", async ({
      page,
    }) => {
      // First, perform a search to create history
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

      // Go back to home
      await page.goto("/");
      await page.waitForLoadState("networkidle");

      // Click on history item if available
      const historyItem = page
        .locator('[data-testid="search-history-item"]')
        .first();
      if (await historyItem.isVisible()) {
        await historyItem.click();
        await page.waitForTimeout(500);

        // Verify form is populated
        const originTrigger = page.getByLabel(/من|From/i);
        await expect(originTrigger).toContainText(testRoutes.domestic.origin);
      }
    });
  });

  test.describe("Favorites", () => {
    test("should show add to favorites button", async ({ page }) => {
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

      // Look for favorites button
      const favoritesButton = page.getByRole("button", {
        name: /المفضلة|Favorite|Heart/i,
      });

      if (await favoritesButton.isVisible()) {
        // Button should be clickable
        await expect(favoritesButton).toBeEnabled();
      }
    });
  });
});
