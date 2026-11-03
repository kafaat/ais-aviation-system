import { passengerRightsSource } from "../shared/passenger-policy";
import { registerProviderCheckoutTests } from "./fixtures/provider-checkout";
import { test, expect } from "./fixtures/base-test";
import { useBrowserSession } from "./fixtures/browser-session";
import type { Page } from "@playwright/test";
import {
  fixtureFlight,
  ownedBooking,
  rpc,
  sqlRows,
} from "./fixtures/hardening";
import type { RowDataPacket } from "mysql2/promise";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

registerProviderCheckoutTests();

async function loginAsAdmin(page: Page) {
  await useBrowserSession(page, "admin");
}

test.describe("Funded journeys and truthful operational reads", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("i18nextLng", "en"));
  });
  test("passenger-rights referral cites an official source and keeps follow-ups local", async ({
    page,
  }) => {
    await useBrowserSession(page, "regular");
    await page.goto("/ai-chat");
    await page.getByRole("button", { name: "Start Conversation" }).click();
    await page
      .getByRole("button", { name: "Passenger rights and refunds" })
      .click();
    const source = page.getByRole("link", {
      name: /^Source: Saudi Passenger Rights Protection Regulations/,
    });
    await expect(source).toHaveAttribute("href", passengerRightsSource.en);
    await page
      .getByRole("textbox", { name: "Your message" })
      .fill("What about my child?");
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(source).toHaveCount(2);
    await expect(page.getByRole("log")).toContainText(
      "This chat has not issued a refund"
    );
  });

  test("issuer capability hides the exchange button and rejects a direct command for the same booking", async ({
    page,
  }) => {
    const { booking, flightId } = await ownedBooking(page, true);
    const client = rpc(page);
    const card = page
      .locator('[data-slot="card"]')
      .filter({ hasText: booking.bookingReference });
    await page.goto("/my-bookings");
    await expect(
      card.getByRole("button", { name: "Modify", exact: true })
    ).toBeVisible();
    const ref = randomUUID();
    await sqlRows<RowDataPacket>(
      "INSERT INTO ndc_orders(orderId,offerId,bookingId,airlineId,passengers,contactInfo,totalAmount,orderPayload,channel,distributorId) SELECT ?,?,b.id,f.airlineId,'[]','{}',b.totalAmount,?, 'ndc_aggregator','synthetic-seller' FROM bookings b JOIN flights f ON f.id=b.flightId WHERE b.id=?",
      [ref, ref, JSON.stringify({ ndcVersion: "24.1" }), booking.bookingId]
    );
    await page.goto(`/my-bookings?exchange=${booking.bookingId}`);
    await expect(card).toBeVisible();
    await expect(
      card.getByRole("button", { name: "Modify", exact: true })
    ).toHaveCount(0);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(
      client.ndc.quotePaidService.mutate({
        bookingId: booking.bookingId,
        replaceFlightId: flightId,
        offerIds: [randomUUID()],
        idempotencyKey: randomUUID(),
      })
    ).rejects.toThrow(/Issuing channel/);
  });

  test("second-sector exchange recovers the completed change after its response is lost", async ({
    page,
  }) => {
    await useBrowserSession(page, "regular");
    const client = rpc(page);
    const user = await client.auth.me.query();
    if (!user) throw new Error("Authenticated passenger missing");
    const first = await fixtureFlight();
    const second = await fixtureFlight();
    const replacement = await fixtureFlight();
    const outbound = await client.flights.getById.query({ id: first });
    if (!outbound) throw new Error("Missing outbound flight");
    // Same route, cabin, schedule and price for the two inbound flights, outside the fee window.
    // Set fixtures before searching so both alternatives are visible to the real cache.
    await sqlRows<RowDataPacket>(
      "UPDATE flights SET departureTime=DATE_ADD(departureTime,INTERVAL 15 DAY), arrivalTime=DATE_ADD(arrivalTime,INTERVAL 15 DAY) WHERE id=?",
      [first]
    );
    await sqlRows<RowDataPacket>(
      "UPDATE flights SET originId=?, destinationId=?, departureTime=DATE_ADD(departureTime,INTERVAL 16 DAY), arrivalTime=DATE_ADD(arrivalTime,INTERVAL 16 DAY) WHERE id IN (?,?)",
      [outbound.destination.id, outbound.origin.id, second, replacement]
    );
    const [firstFlight, secondFlight, newFlight] = await Promise.all(
      [first, second, replacement].map(id =>
        client.flights.getById.query({ id })
      )
    );
    if (!firstFlight || !secondFlight || !newFlight)
      throw new Error("Incomplete fixture itinerary");
    const itinerary = {
      version: 1,
      passengerCount: 1,
      sessionId: randomUUID(),
      cabinClass: "economy",
      segments: [firstFlight, secondFlight].map(f => ({
        flightId: f.id,
        departureDate: f.departureTime.toISOString(),
      })),
    };
    const query = new URLSearchParams({ data: JSON.stringify(itinerary) });
    await page.goto("/booking/multi-city?" + query);
    await page.getByLabel("First Name", { exact: true }).fill("Test");
    await page.getByLabel("Last Name", { exact: true }).fill("Exchange");
    let bookingAttempts = 0;
    await page.route("**/api/trpc/*multiCity.create*", async route => {
      bookingAttempts++;
      if (bookingAttempts === 1) {
        const reply = await route.fetch();
        expect(reply.ok()).toBe(true);
        await route.abort("failed");
      } else await route.continue();
    });
    const submit = page.getByRole("button", { name: "Book Now", exact: true });
    await submit.click();
    await expect(page.getByRole("alert")).toBeVisible();
    await submit.click();
    await expect(page).toHaveURL(/\/my-bookings/);
    expect(bookingAttempts).toBe(2);
    const bookingsAfterRetry = await sqlRows<RowDataPacket>(
      "SELECT id AS bookingId, bookingReference, totalAmount FROM bookings WHERE userId=? AND flightId=?",
      [user.id, first]
    );
    expect(bookingsAfterRetry).toHaveLength(1);
    const [booking] = bookingsAfterRetry;
    const saved = await client.bookings.getPassengers.query({
      bookingId: booking.bookingId,
    });
    expect(saved).toHaveLength(1);
    const [passenger] = saved;
    const service = (
      await client.ancillary.getAvailable.query({ category: "seat" })
    ).find(s => s.code === "SEAT_EXTRA_LEG");
    if (!passenger || !service)
      throw new Error("Seed paid seat or booking passenger missing");
    const mapName = "Browser extra legroom " + randomUUID();
    await sqlRows<RowDataPacket>(
      "INSERT INTO seat_maps(aircraftType,airlineId,configName,cabinLayout,totalSeats,economySeats) VALUES('B737',?,?,'[]',1,1)",
      [outbound.airline.id, mapName]
    );
    const [map] = await sqlRows<RowDataPacket>(
      "SELECT id FROM seat_maps WHERE configName=?",
      [mapName]
    );
    for (const id of [second, replacement]) {
      await sqlRows<RowDataPacket>(
        "INSERT INTO seat_inventory(flightId,seatMapId,seatNumber,`row`,`column`,cabinClass,seatType,priceTier,hasExtraLegroom,seatPrice) VALUES (?,?,'12A',12,'A','economy','window','extra_legroom',1,?)",
        [id, map.id, service.price]
      );
    }
    await page.goto("/my-bookings");
    const card = page
      .locator('[data-slot="card"]')
      .filter({ hasText: booking.bookingReference });
    await card.getByRole("button", { name: "Manage Services" }).click();
    const servicesDialog = page.getByRole("dialog");
    const product = servicesDialog
      .getByText(service.name, { exact: true })
      .locator("../..");
    await product.getByLabel("Flight sector").selectOption(String(second));
    await product.getByLabel("Passenger").selectOption(String(passenger.id));
    await product
      .getByRole("combobox", { name: "Seat", exact: true })
      .selectOption("12A");
    await product.getByRole("button", { name: "Add", exact: true }).click();
    await expect(
      page
        .locator("[data-sonner-toast]")
        .filter({ hasText: "Service added successfully" })
    ).toBeVisible();
    await page.keyboard.press("Escape");
    const fundingAmount = booking.totalAmount + service.price;
    await sqlRows<RowDataPacket>(
      "INSERT INTO user_credits(userId,amount,source) VALUES (?,?,'promo')",
      [user.id, fundingAmount]
    );
    await client.vouchers.useCredits.mutate({
      bookingId: booking.bookingId,
      amount: fundingAmount,
    });
    await page.goto(`/my-bookings?exchange=${booking.bookingId}`);
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Sector to change").selectOption(String(second));
    await dialog
      .getByRole("button", { name: new RegExp(newFlight.flightNumber) })
      .click();
    await dialog.getByRole("button", { name: "Quote change" }).click();
    const accept = dialog.getByRole("button", { name: "Accept this quote" });
    await expect(accept).toBeDisabled();
    const quote = (
      await client.modifications.exchangeContext.query({
        bookingId: booking.bookingId,
      })
    ).latest;
    expect(quote?.replacementFlight?.flightId).toBe(replacement);
    expect(quote?.totalCost).toBe(0);
    await expect(dialog.getByText(/Paid seat 12A retained/)).toBeVisible();
    expect(quote?.seatExchange?.retainedAmount).toBe(service.price);
    await dialog
      .getByLabel("I accept this itinerary change", { exact: false })
      .check();
    let commits = 0;
    await page.route("**/api/trpc/*confirmNoChargeService*", async route => {
      commits++;
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      await route.abort("failed");
    });
    await accept.click();
    await expect(dialog.getByRole("alert")).toHaveText(
      /last result could not be verified/
    );
    await dialog
      .getByRole("button", { name: "Check operation status" })
      .click();
    await expect(dialog.getByText(/Exchange completed/)).toBeVisible();
    const result = await client.modifications.exchangeContext.query({
      bookingId: booking.bookingId,
    });
    expect(result.sectors.map(s => s.flightId)).toEqual([first, replacement]);
    expect(result.latest?.modificationId).toBe(quote?.modificationId);
    expect(result.latest?.receiptId).toBeTruthy();
    expect(
      await sqlRows<RowDataPacket>(
        "SELECT status FROM seat_inventory WHERE flightId=? AND seatNumber='12A' AND bookingId=? AND passengerId=?",
        [replacement, booking.bookingId, passenger.id]
      )
    ).toEqual([{ status: "occupied" }]);
    expect(
      await sqlRows<RowDataPacket>(
        "SELECT id FROM financial_ledger WHERE bookingId=? AND type='charge'",
        [booking.bookingId]
      )
    ).toHaveLength(1);
    expect(commits).toBe(1);
  });
  test("exchange chat links the funded reservation without creating a quote or collecting again", async ({
    page,
  }) => {
    const { booking } = await ownedBooking(page, true);
    const effects = () =>
      sqlRows<RowDataPacket>(
        "SELECT (SELECT COUNT(*) FROM booking_modifications WHERE bookingId=?) AS changesCount, (SELECT COUNT(*) FROM financial_ledger WHERE bookingId=?) AS ledgerCount",
        [booking.bookingId, booking.bookingId]
      );
    const before = await effects();
    await page.goto("/ai-chat");
    await page.getByRole("button", { name: "Start Conversation" }).click();
    await page.getByRole("button", { name: "Change my booking" }).click();
    const target = page.getByRole("link", {
      name: "Review booking " + booking.bookingReference,
    });
    await expect(target).toHaveAttribute(
      "href",
      "/my-bookings?exchange=" + booking.bookingId
    );
    await page
      .getByRole("textbox", { name: "Your message" })
      .fill("Go ahead and charge me");
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(target).toHaveCount(2);
    expect(await effects()).toEqual(before);
    await target.last().click();
    await expect(page).toHaveURL(url => url.pathname === "/my-bookings");
  });

  for (const paymentButton of [
    "Complete Booking & Payment",
    "Split with Others",
  ]) {
    test(`invalid passport blocks ${paymentButton} before booking or payment`, async ({
      page,
    }) => {
      await useBrowserSession(page, "regular");
      const flightId = await fixtureFlight();
      let mutationRequests = 0;
      await page.route("**/api/trpc/*", async route => {
        if (
          /bookings\.create|payments\.createCheckoutSession/.test(
            route.request().url()
          )
        ) {
          mutationRequests++;
          await route.abort();
        } else {
          await route.continue();
        }
      });
      await page.goto(`/booking/${flightId}`);
      await page.locator("#pax-firstname-0").fill("Synthetic");
      await page.locator("#pax-lastname-0").fill("Passenger");
      const passport = page.locator("#pax-passport-0");
      await passport.fill("bad!");
      await expect(passport).toHaveAttribute("aria-invalid", "true");
      await expect(passport).toHaveAccessibleDescription(
        "Passport number must be 6-12 alphanumeric characters"
      );
      await page
        .getByRole("button", { name: "Refresh fare offer", exact: true })
        .click();
      const submit = page.getByRole("button", {
        name: paymentButton,
        exact: true,
      });
      await expect(submit).toBeEnabled();
      await submit.click();
      // A toast as well as the field error proves the submit handler rejected it.
      await expect(
        page.locator("[data-sonner-toast]").filter({
          hasText: "Passport number must be 6-12 alphanumeric characters",
        })
      ).toBeVisible();
      expect(mutationRequests).toBe(0);
      expect(
        await sqlRows<RowDataPacket>(
          "SELECT id FROM bookings WHERE flightId=?",
          [flightId]
        )
      ).toHaveLength(0);
      await passport.fill("AB123456");
      await expect(passport).toHaveAttribute("aria-invalid", "false");
      await expect(passport).not.toHaveAttribute("aria-describedby");
      await passport.fill("");
      await expect(passport).toHaveAttribute("aria-invalid", "false");
    });
  }
  test("flight search and detail preserve dates across repeated Redis-backed HTTP reads", async ({
    page,
  }) => {
    await useBrowserSession(page, "regular");
    const flightId = await fixtureFlight();
    const client = rpc(page);
    const cold = await client.flights.getById.query({ id: flightId });
    expect(cold).toBeTruthy();
    if (!cold) throw new Error("Fixture flight missing");
    const warm = await client.flights.getById.query({ id: flightId });
    expect(warm).toEqual(cold);
    expect(warm?.departureTime).toBeInstanceOf(Date);
    expect(warm?.arrivalTime).toBeInstanceOf(Date);
    const query = {
      originId: cold.origin.id,
      destinationId: cold.destination.id,
      // The search day is a civil date in the origin airport's zone. The
      // fixture departs at 12:00 UTC, which is the same civil day in UTC and
      // in any inhabited zone, so the UTC calendar day is the right one.
      departureDate: cold.departureTime.toISOString().slice(0, 10),
    };
    const firstSearch = await client.flights.search.query(query);
    const secondSearch = await client.flights.search.query(query);
    expect(firstSearch.some(flight => flight.id === flightId)).toBe(true);
    expect(secondSearch).toEqual(firstSearch);
    expect(
      secondSearch.find(flight => flight.id === flightId)?.departureTime
    ).toBeInstanceOf(Date);
    expect(
      secondSearch.find(flight => flight.id === flightId)?.arrivalTime
    ).toBeInstanceOf(Date);
    await page.goto(`/booking/${flightId}`);
    await expect(page.locator("#pax-firstname-0")).toBeVisible();
  });
  test("booking creation replays one unpaid invoice without consuming a seat", async ({
    page,
  }) => {
    const { booking, flightId, command } = await ownedBooking(page);
    expect(await rpc(page).bookings.create.mutate(command)).toEqual(booking);
    const [row] = await sqlRows<RowDataPacket>(
      "SELECT paymentStatus, seatsReserved FROM bookings WHERE id=?",
      [booking.bookingId]
    );
    expect(row.paymentStatus).toBe("pending");
    expect(row.seatsReserved).toBe(0);
    const [flight] = await sqlRows<RowDataPacket>(
      "SELECT economyAvailable FROM flights WHERE id=?",
      [flightId]
    );
    expect(flight.economyAvailable).toBe(10);
    await page.goto("/my-bookings");
    await expect(
      page.getByText(booking.bookingReference, { exact: false })
    ).toBeVisible();
  });
  test("customer confirms full credit funding in the booking screen; replay posts once", async ({
    page,
  }) => {
    const { booking } = await ownedBooking(page);
    await page.goto("/my-bookings");
    const card = page
      .locator('[data-slot="card"]')
      .filter({ hasText: booking.bookingReference });
    await card
      .getByRole("button", { name: "Pay using credits", exact: true })
      .click();
    await card
      .getByRole("button", { name: "Confirm credit payment", exact: true })
      .click();
    // Observe the server-confirmed UI state before an API replay, so the
    // replay cannot fund a booking after a broken UI mutation and mask it.
    await expect(card.getByText("Paid", { exact: true })).toBeVisible();
    const client = rpc(page);
    await client.vouchers.useCredits.mutate({
      bookingId: booking.bookingId,
      amount: booking.totalAmount,
    });
    const rows = await sqlRows<RowDataPacket>(
      "SELECT id FROM financial_ledger WHERE bookingId=? AND type='charge'",
      [booking.bookingId]
    );
    expect(rows).toHaveLength(1);
    expect(
      (await client.bookings.myBookings.query()).find(
        b => b.id === booking.bookingId
      )?.paymentStatus
    ).toBe("paid");
  });
  for (const cancel of [false, true])
    test(
      cancel
        ? "approved full refund cancels all inventory and restores original credit"
        : "approved partial refund retains the funded itinerary",
      async ({ page }) => {
        const { booking, flightId } = await ownedBooking(page, true);
        await loginAsAdmin(page);
        await page.goto("/admin/refunds");
        const form = page.getByRole("region", {
          name: "Internal funding refund",
        });
        await form
          .getByLabel("Booking ID", { exact: true })
          .fill(String(booking.bookingId));
        await form
          .getByLabel("Amount in SAR")
          .fill((cancel ? booking.totalAmount / 100 : 1).toFixed(2));
        await form
          .getByLabel("Finance approval reference")
          .fill("Synthetic E2E approval");
        await form.getByLabel("Refund reason").fill("Synthetic journey refund");
        if (cancel)
          await form
            .getByLabel("Cancel the entire itinerary and refund the remainder")
            .check();
        await form
          .getByRole("button", { name: "Execute approved refund" })
          .click();
        await expect(form.getByRole("status")).toContainText(
          cancel ? "Itinerary cancelled" : "Itinerary retained"
        );
        const [row] = await sqlRows<RowDataPacket>(
          "SELECT paymentStatus, status FROM bookings WHERE id=?",
          [booking.bookingId]
        );
        expect(row.paymentStatus).toBe(cancel ? "refunded" : "paid");
        expect(row.status).toBe(cancel ? "cancelled" : "confirmed");
        const [flight] = await sqlRows<RowDataPacket>(
          "SELECT economyAvailable FROM flights WHERE id=?",
          [flightId]
        );
        expect(flight.economyAvailable).toBe(cancel ? 10 : 9);
      }
    );
  test("customer cannot execute a finance refund or fund another owner's invoice", async ({
    page,
  }) => {
    const { booking } = await ownedBooking(page, true);
    await expect(
      rpc(page).refunds.refundInternalFunding.mutate({
        bookingId: booking.bookingId,
        amount: booking.totalAmount,
        requestId: randomUUID(),
        approvalReference: "Unapproved fixture",
        reason: "Attempt",
        cancelItinerary: true,
      })
    ).rejects.toThrow();
    await loginAsAdmin(page);
    await expect(
      rpc(page).vouchers.useCredits.mutate({
        bookingId: booking.bookingId,
        amount: booking.totalAmount,
      })
    ).rejects.toThrow();
    const [row] = await sqlRows<RowDataPacket>(
      "SELECT paymentStatus FROM bookings WHERE id=?",
      [booking.bookingId]
    );
    expect(row.paymentStatus).toBe("paid");
    expect(
      await sqlRows<RowDataPacket>(
        "SELECT id FROM financial_ledger WHERE bookingId=? AND type IN ('refund','partial_refund')",
        [booking.bookingId]
      )
    ).toHaveLength(0);
  });
  test("privacy request reaches an authenticated download and a different account receives 404", async ({
    page,
  }) => {
    await ownedBooking(page);
    const exported = await rpc(page).gdpr.exportData.mutate({ format: "json" });
    await promisify(execFile)(
      process.execPath,
      ["--import", "tsx", "scripts/e2e/process-privacy.ts"],
      { timeout: 30000 }
    );
    const status = await rpc(page).gdpr.getExportStatus.query({
      requestId: exported.requestId,
    });
    expect(status.status).toBe("completed");
    expect(status.downloadUrl).toBeTruthy();
    if (!status.downloadUrl) throw new Error("Download URL missing");
    const response = await page.request.get(status.downloadUrl);
    expect(response.status()).toBe(200);
    const document = await response.json();
    expect(document.profile.email).toBe("test.user@example.com");
    expect(document.bookings.length).toBeGreaterThan(0);
    await loginAsAdmin(page);
    expect((await page.request.get(status.downloadUrl)).status()).toBe(404);
  });
  test("demonstrates operational booking values alongside unverified earned revenue", async ({
    page,
  }) => {
    const { booking } = await ownedBooking(page, true);
    await useBrowserSession(page, "admin");
    const client = rpc(page);
    const summary = await client.revenueAccounting.getDashboard.query();
    expect(summary.recognizedRevenue).toBeNull();
    expect(summary.deferredRevenue).toBeNull();
    expect(summary.ancillaryRevenue).toBeNull();
    const detail = await client.revenueAccounting.getDeferredRevenue.query();
    expect(detail.total).toBeNull();
    expect(
      detail.items.find(r => r.bookingId === booking.bookingId)?.amount
    ).toBe(booking.totalAmount);
    await page.goto("/admin/revenue-accounting");
    await expect(page.getByText("Not verified", { exact: true })).toHaveCount(
      3
    );
    await expect(
      page.getByText("Upcoming paid bookings", { exact: true })
    ).toBeVisible();
    await expect(
      page.getByText(booking.bookingReference, { exact: true })
    ).toBeVisible();
  });

  test("revenue source failure stays visible instead of presenting zero cash", async ({
    page,
  }) => {
    await loginAsAdmin(page);
    await page.route("**/api/trpc/*revenueAccounting*", route =>
      route.abort("failed")
    );
    await page.goto("/admin/revenue-accounting");
    await expect(page.getByRole("alert")).toContainText("unavailable", {
      ignoreCase: true,
    });
    await expect(
      page.getByRole("button", { name: "Retry", exact: true })
    ).toBeVisible();
  });
  test("biometric without an accepted adapter reports unavailable, not empty", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", e => errors.push(e.message));
    await loginAsAdmin(page);
    await expect(
      rpc(page).biometric.getEvents.query({ limit: 50, offset: 0 })
    ).rejects.toMatchObject({ data: { code: "PRECONDITION_FAILED" } });
    await page.goto("/admin/biometric");
    await page.getByRole("tab", { name: "Events Log" }).click();
    await expect(page.getByRole("alert")).toContainText(
      "no verified production adapter configured"
    );
    await expect(
      page.getByRole("button", { name: "Retry", exact: true })
    ).toBeVisible();
    await expect(
      page.getByText("No recorded events", { exact: true })
    ).toHaveCount(0);
    expect(errors).toEqual([]);
  });
  test("kiosk API has no registered devices and the screen shows that state", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", e => errors.push(e.message));
    await loginAsAdmin(page);
    await page.goto("/admin/kiosk");
    await expect(
      page.getByText("No registered devices", { exact: true })
    ).toBeVisible();
    expect(errors).toEqual([]);
  });
});
