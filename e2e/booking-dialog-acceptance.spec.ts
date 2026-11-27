import type { Page, Request } from "@playwright/test";
import { randomUUID } from "node:crypto";
import type { RowDataPacket } from "mysql2/promise";
import superjson from "superjson";
import { test, expect } from "./fixtures/base-test";
import { useBrowserSession } from "./fixtures/browser-session";
import {
  fixtureFlight,
  ownedBooking,
  rpc,
  sqlRows,
} from "./fixtures/hardening";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("i18nextLng", "en"));
});

function mutationInput<T>(request: Request): T {
  const batch = new URL(request.url()).searchParams.get("batch") === "1";
  const body = request.postDataJSON();
  return superjson.deserialize<T>(batch ? body["0"] : body);
}

test("saved passport expiry survives profile reload, booking selection and native invoice persistence", async ({
  page,
}, testInfo) => {
  await useBrowserSession(page, "regular");
  const client = rpc(page);
  const user = await client.auth.me.query();
  if (!user) throw new Error("Authenticated passenger missing");
  const firstName = `Audit${randomUUID()
    .replace(/[^a-f]/g, "")
    .slice(0, 8)}`;
  const lastName = "Passport";
  const passportNumber = `A${randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase()}`;
  const passportExpiry = "2032-12-31";
  let savedId: number | undefined;
  try {
    await page.goto("/saved-passengers");
    await page
      .getByRole("button", { name: "Add Passenger", exact: true })
      .click();
    const dialog = page.getByRole("dialog", { name: "Add New Passenger" });
    await dialog.locator("#firstName").fill(firstName);
    await dialog.locator("#lastName").fill(lastName);
    await dialog.locator("#dateOfBirth").fill("1990-01-01");
    await dialog.locator("#nationality").fill("SA");
    await dialog.locator("#passportNumber").fill(passportNumber);
    await dialog.locator("#passportExpiry").fill(passportExpiry);
    await dialog
      .getByRole("button", { name: "Save Passenger", exact: true })
      .click();
    await expect(dialog).not.toBeVisible();
    await page.reload();
    const card = page
      .locator('[data-slot="card"]')
      .filter({ hasText: firstName });
    await expect(card).toContainText("31 Dec 2032");
    const saved = (await client.savedPassengers.getAll.query()).find(
      p => p.firstName === firstName && p.passportNumber === passportNumber
    );
    expect(saved?.passportExpiry?.toISOString().slice(0, 10)).toBe(
      passportExpiry
    );
    if (!saved) throw new Error("Saved passenger was not persisted");
    savedId = saved.id;

    // Only inventory is a SQL fixture. The passenger and booking writes below
    // use the visible forms and the real application, with no provider calls.
    const flightId = await fixtureFlight(user.tenantId);
    await page.goto(`/booking/${flightId}`);
    await page
      .getByRole("combobox")
      .filter({ hasText: "Select Saved Passenger" })
      .click();
    await page.getByRole("option", { name: new RegExp(firstName) }).click();
    await expect(page.locator("#pax-passport-expiry-0")).toHaveValue(
      passportExpiry
    );
    await page.screenshot({
      path: testInfo.outputPath("saved-passport-booking.png"),
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Refresh fare offer", exact: true })
      .click();
    const pay = page.getByRole("button", {
      name: "Pay with wallet",
      exact: true,
    });
    await expect(pay).toBeEnabled();
    await pay.click();
    await expect(page).toHaveURL(/\/checkout\/\d+.*method=wallet/);
    const bookingId = Number(new URL(page.url()).pathname.split("/").at(-1));
    const rows = await sqlRows<RowDataPacket>(
      "SELECT p.firstName,p.lastName,p.passportNumber,DATE_FORMAT(p.passportExpiry,'%Y-%m-%d') AS passportExpiry,b.userId,b.paymentStatus FROM passengers p JOIN bookings b ON b.id=p.bookingId WHERE p.bookingId=?",
      [bookingId]
    );
    expect(rows).toEqual([
      expect.objectContaining({
        firstName,
        lastName,
        passportNumber,
        passportExpiry,
        userId: user.id,
        paymentStatus: "pending",
      }),
    ]);
    await page.reload();
    await expect(page.getByTestId("checkout-total")).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath("saved-passport-invoice.png"),
      fullPage: true,
    });
  } finally {
    if (savedId !== undefined)
      await client.savedPassengers.delete.mutate({ id: savedId });
  }
});

for (const [method, button] of [
  ["wallet", "Pay with wallet"],
  ["split", "Split with Others"],
] as const) {
  test(`the booking ${method} action opens the server-issued invoice and amount`, async ({
    page,
  }) => {
    await useBrowserSession(page, "regular");
    const client = rpc(page);
    const user = await client.auth.me.query();
    if (!user) throw new Error("Authenticated passenger missing");
    const flightId = await fixtureFlight(user.tenantId);
    await page.goto(`/booking/${flightId}?adults=2`);
    for (const [index, firstName] of ["Aisha", "Sara"].entries()) {
      await page.locator(`#pax-firstname-${index}`).fill(firstName);
      await page.locator(`#pax-lastname-${index}`).fill("Invoice");
    }
    await page
      .getByRole("button", { name: "Refresh fare offer", exact: true })
      .click();
    const pay = page.getByRole("button", { name: button, exact: true });
    await expect(pay).toBeEnabled();
    const creation = page.waitForResponse(
      response =>
        new URL(response.url()).pathname
          .split("/")
          .at(-1)
          ?.split(",")
          .includes("bookings.create") === true
    );
    await pay.click();
    const response = await creation;
    expect(response.ok()).toBe(true);
    const batch = await response.json();
    const booking = superjson.deserialize<{
      bookingId: number;
      totalAmount: number;
    }>(batch[0].result.data);
    await expect(page).toHaveURL(
      url =>
        url.pathname === `/checkout/${booking.bookingId}` &&
        url.searchParams.get("method") === method
    );
    const invoice = await client.payments.getCheckoutState.query({
      bookingId: booking.bookingId,
    });
    expect(invoice.totalAmount).toBe(booking.totalAmount);
    expect(invoice.totalAmount).toBeGreaterThan(0);
    expect(invoice.currency).toBe("SAR");
    await expect(page.getByTestId("checkout-total")).toHaveText(
      new Intl.NumberFormat("en", {
        style: "currency",
        currency: "SAR",
      }).format(invoice.totalAmount / 100)
    );
    if (method === "wallet") {
      await expect(
        page.getByText(
          `Booking total: ${(invoice.totalAmount / 100).toFixed(2)} SAR`,
          { exact: true }
        )
      ).toBeVisible();
    } else {
      const amounts = page.getByRole("spinbutton");
      await expect(amounts).toHaveCount(2);
      await expect(amounts.nth(0)).toHaveValue(
        (Math.floor(invoice.totalAmount / 2) / 100).toFixed(2)
      );
      await expect(amounts.nth(1)).toHaveValue(
        (
          (invoice.totalAmount - Math.floor(invoice.totalAmount / 2)) /
          100
        ).toFixed(2)
      );
    }
    expect(
      await sqlRows<RowDataPacket>(
        "SELECT id FROM bookings WHERE userId=? AND flightId=?",
        [user.id, flightId]
      )
    ).toEqual([{ id: booking.bookingId }]);
    expect(
      await sqlRows<RowDataPacket>(
        "SELECT id FROM financial_ledger WHERE bookingId=? AND type='charge'",
        [booking.bookingId]
      )
    ).toEqual([]);
  });
}

async function changeableBooking(page: Page) {
  const { booking, flightId } = await ownedBooking(page, true);
  const client = rpc(page);
  const user = await client.auth.me.query();
  if (!user) throw new Error("Authenticated passenger missing");
  const replacementId = await fixtureFlight(user.tenantId, 3);
  await sqlRows<RowDataPacket>(
    "UPDATE flights SET economyPrice=15000 WHERE id=?",
    [replacementId]
  );
  const replacement = await client.flights.getById.query({ id: replacementId });
  if (!replacement) throw new Error("Replacement fixture missing");
  await page.goto(`/my-bookings?exchange=${booking.bookingId}`);
  const chooseReplacement = async () => {
    const dialog = page.getByRole("dialog");
    await dialog
      .getByLabel("New departure date")
      .fill(replacement.departureTime.toISOString().slice(0, 10));
    await dialog
      .getByRole("button", { name: new RegExp(replacement.flightNumber) })
      .click();
    return dialog;
  };
  return { booking, flightId, replacementId, client, chooseReplacement };
}

test("a consented paid modification reaches its returned checkout URL without marking the exchange paid", async ({
  page,
}) => {
  const { booking, client, chooseReplacement } = await changeableBooking(page);
  const dialog = await chooseReplacement();
  await dialog
    .getByRole("button", { name: "Quote change", exact: true })
    .click();
  const accept = dialog.getByRole("button", {
    name: "Accept this quote",
    exact: true,
  });
  await expect(accept).toBeDisabled();
  const quote = (
    await client.modifications.exchangeContext.query({
      bookingId: booking.bookingId,
    })
  ).latest;
  if (!quote) throw new Error("Native modification quote missing");
  expect(quote.totalCost).toBeGreaterThan(0);
  const providerUrl = "https://checkout.example.test/modification/synthetic";
  await page.route(providerUrl, route =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><h1>Synthetic modification checkout</h1>",
    })
  );
  let received:
    | {
        bookingId: number;
        modificationId: number;
        provider: string;
        consent?: { quoteVersion: string; totalCost: number; currency: string };
      }
    | undefined;
  // The response to payments.createModificationCheckout is mocked here.
  // This verifies consent, the quote identifier and UI navigation only;
  // the checkout service and payment provider are not called by this test.
  await page.route(
    "**/api/trpc/*payments.createModificationCheckout*",
    async route => {
      received = mutationInput(route.request());
      const batch =
        new URL(route.request().url()).searchParams.get("batch") === "1";
      const response = {
        result: { data: superjson.serialize({ url: providerUrl }) },
      };
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(batch ? [response] : response),
      });
    }
  );
  await dialog
    .getByLabel("I accept this itinerary change", { exact: false })
    .check();
  await accept.click();
  await expect(page).toHaveURL(providerUrl);
  await expect(
    page.getByRole("heading", { name: "Synthetic modification checkout" })
  ).toBeVisible();
  // The dialog binds the passenger's consent to the quote version and amount
  // it displayed; the server refuses a checkout whose consent does not match.
  expect(received).toEqual({
    bookingId: booking.bookingId,
    modificationId: quote.modificationId,
    provider: "stripe",
    consent: {
      quoteVersion: quote.quoteVersion,
      totalCost: quote.totalCost,
      currency: "SAR",
    },
  });
  const after = (
    await client.modifications.exchangeContext.query({
      bookingId: booking.bookingId,
    })
  ).latest;
  expect(after?.status).toBe("pending");
  expect(after?.receiptId).toBeNull();
  expect(
    await sqlRows<RowDataPacket>(
      "SELECT id FROM financial_ledger WHERE bookingId=? AND type='charge'",
      [booking.bookingId]
    )
  ).toHaveLength(1);
});

test("an unknown change with no persisted quote retains its request key across status refresh and browser reload", async ({
  page,
}) => {
  const { booking, flightId, replacementId, client, chooseReplacement } =
    await changeableBooking(page);
  const attempts: Array<{
    bookingId: number;
    replaceFlightId: number;
    newFlightId: number;
    idempotencyKey: string;
  }> = [];
  await page.route(
    "**/api/trpc/*modifications.requestChangeDate*",
    async route => {
      attempts.push(mutationInput(route.request()));
      // The first two requests never reach the server, so status lookup must
      // return latest:null. The third request is sent to the native service.
      if (attempts.length < 3) await route.abort("failed");
      else await route.continue();
    }
  );
  let dialog = await chooseReplacement();
  await dialog
    .getByRole("button", { name: "Quote change", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toHaveText(
    /last result could not be verified/
  );
  expect(
    (
      await client.modifications.exchangeContext.query({
        bookingId: booking.bookingId,
      })
    ).latest
  ).toBeNull();
  await dialog
    .getByRole("button", { name: "Check operation status", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await dialog
    .getByRole("button", { name: "Quote change", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toHaveText(
    /last result could not be verified/
  );
  expect(attempts).toHaveLength(2);
  expect(attempts[1]).toEqual(attempts[0]);
  // MyBookings consumes the exchange handoff parameter when opening the
  // dialog. A real reload returns to the list; reopen this same booking via
  // its visible Modify action while retaining the tab's sessionStorage.
  await expect(page).toHaveURL(url => !url.searchParams.has("exchange"));
  await page.reload();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page
    .locator('[data-slot="card"]')
    .filter({ has: page.getByText(booking.bookingReference, { exact: true }) })
    .getByRole("button", { name: "Modify", exact: true })
    .click();
  dialog = await chooseReplacement();
  await dialog
    .getByRole("button", { name: "Quote change", exact: true })
    .click();
  await expect(
    dialog.getByRole("button", { name: "Accept this quote", exact: true })
  ).toBeDisabled();
  expect(attempts).toHaveLength(3);
  expect(attempts[2]).toEqual(attempts[0]);
  expect(attempts[2]).toMatchObject({
    bookingId: booking.bookingId,
    replaceFlightId: flightId,
    newFlightId: replacementId,
  });
  expect(
    await sqlRows<RowDataPacket>(
      "SELECT id FROM booking_modifications WHERE bookingId=?",
      [booking.bookingId]
    )
  ).toHaveLength(1);
  const quote = (
    await client.modifications.exchangeContext.query({
      bookingId: booking.bookingId,
    })
  ).latest;
  expect(quote?.replacementFlight?.flightId).toBe(replacementId);
});
