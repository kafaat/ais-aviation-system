import { passengerRightsSource } from "../shared/passenger-policy";
import { registerProviderCheckoutTests } from "./fixtures/provider-checkout";
import { registerFamilyCheckInTests } from "./fixtures/family-check-in";
import { registerDcsCounterTests } from "./fixtures/dcs-counter";
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
import { readFile } from "node:fs/promises";

registerProviderCheckoutTests();
registerDcsCounterTests();
registerFamilyCheckInTests();

async function loginAsAdmin(page: Page) {
  await useBrowserSession(page, "admin");
}

test.describe("Funded journeys and truthful operational reads", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("i18nextLng", "en"));
  });
  test("wheelchair assistance selected in My Bookings stays on its requested sector", async ({
    page,
  }) => {
    await useBrowserSession(page, "regular");
    const client = rpc(page);
    const outboundId = await fixtureFlight();
    const returnId = await fixtureFlight();
    const outbound = await client.flights.getById.query({ id: outboundId });
    if (!outbound) throw new Error("Missing outbound flight");
    await sqlRows<RowDataPacket>(
      "UPDATE flights SET originId=?,destinationId=?,departureTime=DATE_ADD(departureTime,INTERVAL 1 DAY), arrivalTime=DATE_ADD(arrivalTime,INTERVAL 1 DAY) WHERE id=?",
      [outbound.destination.id, outbound.origin.id, returnId]
    );
    const inbound = await client.flights.getById.query({ id: returnId });
    if (!inbound) throw new Error("Missing return flight");
    const journey = await client.multiCity.create.mutate({
      segments: [outbound, inbound].map(f => ({
        flightId: f.id,
        departureDate: f.departureTime,
      })),
      cabinClass: "economy",
      passengers: [{ firstName: "Mona", lastName: "Sector", type: "adult" }],
      sessionId: randomUUID(),
    });
    const [pax] = await client.bookings.getPassengers.query({
      bookingId: journey.bookingId,
    });
    const input = {
      bookingId: journey.bookingId,
      passengerId: pax.id,
      serviceType: "wheelchair" as const,
      serviceCode: "WCHR",
    };
    await expect(
      client.specialServices.requestService.mutate(input)
    ).rejects.toThrow(/unique active flight sector/);
    await page.goto("/my-bookings");
    const card = page
      .locator('[data-slot="card"]')
      .filter({ hasText: journey.bookingReference });
    await card
      .getByRole("button", { name: "Special Services", exact: true })
      .click();
    await card
      .getByRole("button", { name: "Add Service", exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    await dialog
      .getByRole("combobox", { name: "Flight sector" })
      .selectOption(String(returnId));
    await dialog
      .getByRole("combobox", { name: "Passenger", exact: true })
      .click();
    await page.getByRole("option", { name: /Mona Sector/ }).click();
    await dialog
      .getByRole("combobox", { name: "Service Type", exact: true })
      .click();
    await page.getByRole("option", { name: "Wheelchair Assistance" }).click();
    await dialog
      .getByRole("combobox", { name: "Service", exact: true })
      .click();
    await page.getByRole("option", { name: /Wheelchair - Ramp/ }).click();
    await dialog.getByRole("button", { name: "Submit Request" }).click();
    await expect(dialog).toHaveCount(0);
    await card.getByRole("button", { name: /Wheelchair Assistance/ }).click();
    await expect(card).toContainText(
      "Requested flight " + inbound.flightNumber
    );
    const services = await client.specialServices.getBookingServices.query({
      bookingId: journey.bookingId,
    });
    expect(services).toHaveLength(1);
    const [record] = await sqlRows<RowDataPacket>(
      "SELECT s.flightId,s.passengerId,bs.flightId AS segmentFlight FROM special_services s JOIN booking_segments bs ON bs.id=s.bookingSegmentId AND bs.bookingId=s.bookingId WHERE s.id=?",
      [services[0].id]
    );
    expect(record).toMatchObject({
      flightId: returnId,
      segmentFlight: returnId,
      passengerId: pax.id,
    });
    await expect(
      client.specialServices.requestService.mutate({
        ...input,
        flightId: returnId,
      })
    ).rejects.toThrow(/already exists/);
    const separate = await client.specialServices.requestService.mutate({
      ...input,
      flightId: outboundId,
    });
    expect(separate.service.flightId).toBe(outboundId);
    expect(separate.service.bookingSegmentId).not.toBe(
      services[0].bookingSegmentId
    );
    await client.specialServices.cancelService.mutate({
      serviceId: separate.service.id,
    });
    await loginAsAdmin(page);
    const operator = rpc(page);
    const sectorNeedsScore = async (flightId: number) => {
      const rank = await operator.passengerPriority.rankPassengers.query({
        flightId,
      });
      return rank.find(row => row.passengerId === pax.id)?.specialNeedsScore;
    };
    expect(await sectorNeedsScore(returnId)).toBeGreaterThan(0);
    expect(await sectorNeedsScore(outboundId)).toBe(0);
  });

  test("payment history shows an outage and recovers through the real reader", async ({
    page,
  }) => {
    await useBrowserSession(page, "regular");
    const historyEndpoint = "**/api/trpc/*payments.getHistory*";
    await page.route(historyEndpoint, route => route.abort("failed"));
    await page.goto("/payment-history");
    const unavailable = page.getByRole("alert").filter({
      hasText: "Payment history could not be loaded",
    });
    await expect(unavailable).toBeVisible({ timeout: 20000 });
    await expect(
      page.getByText("No payments found", { exact: true })
    ).toHaveCount(0);

    await page.unroute(historyEndpoint);
    const recovered = page.waitForResponse(
      response =>
        new URL(response.url()).pathname.includes("payments.getHistory") &&
        response.ok()
    );
    await unavailable.getByRole("button", { name: "Retry" }).click();
    const reply = await recovered;
    const paths = decodeURIComponent(
      new URL(reply.url()).pathname.split("/").pop()!
    ).split(",");
    const result = (await reply.json())[paths.indexOf("payments.getHistory")];
    const rows = result?.result?.data?.json;
    expect(Array.isArray(rows)).toBe(true);
    await expect(unavailable).toHaveCount(0);
    if (rows.length) {
      await expect(
        page.getByText(rows[0].bookingReference, { exact: true }).first()
      ).toBeVisible();
    } else {
      await expect(
        page.getByText("No payments found", { exact: true })
      ).toBeVisible();
    }
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

  test("outbound bag and meal selected in checkout belong only to their passenger and sector", async ({
    page,
  }) => {
    await useBrowserSession(page, "regular");
    const client = rpc(page);
    const outboundId = await fixtureFlight();
    const returnId = await fixtureFlight();
    const outbound = await client.flights.getById.query({ id: outboundId });
    if (!outbound) throw new Error("Missing outbound fixture");
    await sqlRows<RowDataPacket>(
      "UPDATE flights SET originId=?, destinationId=?, departureTime=DATE_ADD(departureTime,INTERVAL 1 DAY), arrivalTime=DATE_ADD(arrivalTime,INTERVAL 1 DAY) WHERE id=?",
      [outbound.destination.id, outbound.origin.id, returnId]
    );
    const inbound = await client.flights.getById.query({ id: returnId });
    if (!inbound) throw new Error("Missing return fixture");
    const catalog = await client.ancillary.getAvailable.query({});
    const bag = catalog.find(item => item.code === "BAG_20KG");
    const meal = catalog.find(item => item.code === "MEAL_VEG");
    if (!bag || !meal) throw new Error("Seed passenger extras missing");
    const itinerary = {
      version: 1,
      passengerCount: 2,
      sessionId: randomUUID(),
      cabinClass: "economy",
      segments: [outbound, inbound].map(f => ({
        flightId: f.id,
        departureDate: f.departureTime.toISOString(),
      })),
    };
    await page.goto(
      "/booking/multi-city?" +
        new URLSearchParams({ data: JSON.stringify(itinerary) })
    );
    for (const [index, name] of ["Ahmed", "Sara"].entries()) {
      await page
        .getByLabel("First Name", { exact: true })
        .nth(index)
        .fill(name);
      await page
        .getByLabel("Last Name", { exact: true })
        .nth(index)
        .fill("Journey");
    }
    await page.getByTestId("ancillary-segment").selectOption("0");
    await page.getByTestId("ancillary-passenger").selectOption("0");
    for (const item of [bag, meal]) {
      await page.getByTestId("ancillary-product").selectOption(String(item.id));
      await page.getByTestId("ancillary-add").click();
      await expect(page.getByTestId("ancillary-review")).toContainText(
        item.name
      );
    }
    await page.getByRole("button", { name: "Book Now", exact: true }).click();
    await expect(page).toHaveURL(/\/my-bookings/);
    const user = await client.auth.me.query();
    if (!user) throw new Error("Authenticated passenger missing");
    const [booking] = await sqlRows<RowDataPacket>(
      "SELECT id, bookingReference, totalAmount FROM bookings WHERE userId=? AND flightId=?",
      [user.id, outboundId]
    );
    const passengers = await client.bookings.getPassengers.query({
      bookingId: booking.id,
    });
    const ahmed = passengers.find(p => p.firstName === "Ahmed");
    const sara = passengers.find(p => p.firstName === "Sara");
    if (!ahmed || !sara) throw new Error("Missing travellers");
    const currentItems = () =>
      client.ancillary.getBookingAncillaries.query({ bookingId: booking.id });
    const invoiceTotal = async () =>
      (await client.bookings.myBookings.query()).find(
        row => row.id === booking.id
      )?.totalAmount;
    const purchased = await currentItems();
    expect(purchased).toHaveLength(2);
    const card = page.locator('[data-slot="card"]').filter({
      hasText: booking.bookingReference,
    });
    await card.getByRole("button", { name: "Manage Services" }).click();
    const dialog = page.getByRole("dialog");
    const offer = dialog.getByTestId(`extra-offer-${meal.id}`);
    await offer.getByLabel("Flight sector").selectOption(String(returnId));
    await offer.getByLabel("Passenger").selectOption(String(sara.id));
    await offer.getByRole("button", { name: "Add", exact: true }).click();
    const addedLine = dialog
      .locator('[data-testid^="extra-line-"]')
      .filter({ hasText: "Sara Journey" })
      .filter({ hasText: meal.name });
    await expect(addedLine).toContainText(inbound.flightNumber);
    const changed = await currentItems();
    expect(changed).toHaveLength(3);
    expect(await invoiceTotal()).toBe(booking.totalAmount + meal.price);
    const added = changed.find(line => line.passengerId === sara.id);
    expect(added).toMatchObject({
      scopeState: "specific_segment",
      segmentOrder: 2,
      flightNumber: inbound.flightNumber,
      quantity: 1,
      totalPrice: meal.price,
      status: "active",
    });
    if (!added) throw new Error("Return meal was not added");
    await dialog
      .getByTestId(`extra-line-${added.id}`)
      .getByRole("button")
      .click();
    await expect
      .poll(
        async () =>
          (await currentItems()).find(line => line.id === added.id)?.status
      )
      .toBe("cancelled");
    const remaining = (await currentItems()).filter(
      line => line.status === "active"
    );
    expect(remaining).toHaveLength(2);
    expect(remaining).toEqual(expect.arrayContaining(purchased));
    expect(await invoiceTotal()).toBe(booking.totalAmount);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await sqlRows<RowDataPacket>(
      "INSERT INTO user_credits (userId, amount, source) VALUES (?, ?, 'promo')",
      [user.id, booking.totalAmount]
    );
    await client.vouchers.useCredits.mutate({
      bookingId: booking.id,
      amount: booking.totalAmount,
    });
    const rows = await client.bookings.baggageEntitlements.query({
      bookingId: booking.id,
    });
    expect(rows).toHaveLength(4);
    for (const passenger of [ahmed, sara]) {
      for (const flightId of [outboundId, returnId]) {
        expect(rows).toContainEqual(
          expect.objectContaining({
            passengerId: passenger.id,
            flightId,
            requiresOperationalReview: false,
            totalWeightGrams:
              passenger.id === ahmed.id && flightId === outboundId
                ? 43000
                : 23000,
          })
        );
      }
    }
    await loginAsAdmin(page);
    await page.goto("/admin/bag-drop");
    await page
      .getByLabel("Booking ID", { exact: true })
      .fill(String(booking.id));
    await page
      .getByRole("button", {
        name: "Show booking extras by passenger and sector",
      })
      .click();
    for (const item of [bag, meal]) {
      await expect(
        page
          .getByTestId("booked-extra")
          .filter({ hasText: item.name })
          .filter({ hasText: "Ahmed Journey" })
      ).toContainText("Ahmed Journey · Sector 1");
    }
    for (const passenger of [ahmed, sara]) {
      await page
        .getByLabel("Passenger ID", { exact: true })
        .fill(String(passenger.id));
      const summary = page.getByRole("region", { name: "Baggage allowance" });
      await expect(summary).toContainText(
        "Segment 1: " +
          (passenger.id === ahmed.id ? "43" : "23") +
          " kg verified"
      );
      await expect(summary).toContainText("Segment 2: 23 kg verified");
    }
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
  test("a profile export reaches an authenticated browser download and a different account receives 404", async ({
    page,
  }) => {
    const { booking } = await ownedBooking(page);
    await page.goto("/profile");
    await page.getByRole("tab", { name: "Security and privacy" }).click();
    await page.getByLabel("File format").selectOption("json");
    await page.getByRole("button", { name: "Request export" }).click();

    // Track the request the passenger can see, not a pre-existing export.
    const pending = page
      .getByRole("listitem")
      .filter({ hasText: /#\d+ · JSON · .*pending/i });
    await expect(pending).toHaveCount(1);
    const requestId = (await pending.innerText()).match(/#(\d+)/)?.[1];
    expect(requestId).toBeTruthy();
    await expect(pending.getByRole("link", { name: "Download" })).toHaveCount(
      0
    );

    await promisify(execFile)(
      process.execPath,
      ["--import", "tsx", "scripts/e2e/process-privacy.ts"],
      { timeout: 30000 }
    );
    await page.getByRole("button", { name: "Refresh exports" }).click();
    const row = page.getByRole("listitem").filter({
      hasText: new RegExp("#" + requestId + " · JSON · .*completed", "i"),
    });
    const link = row.getByRole("link", { name: "Download" });
    const downloadUrl = "/api/gdpr/download/" + requestId;
    await expect(link).toHaveAttribute("href", downloadUrl);
    const downloaded = page.waitForEvent("download");
    await link.click();
    const file = await downloaded;
    expect(file.suggestedFilename()).toBe("privacy-" + requestId + ".json");
    const filePath = await file.path();
    if (!filePath) throw new Error("Export download missing");
    const document = JSON.parse(await readFile(filePath, "utf8"));
    expect(document.profile.email).toBe("test.user@example.com");
    expect(document.bookings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ bookingReference: booking.bookingReference }),
      ])
    );
    await loginAsAdmin(page);
    expect((await page.request.get(downloadUrl)).status()).toBe(404);
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
