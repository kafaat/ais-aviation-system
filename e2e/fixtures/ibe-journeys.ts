import { randomUUID } from "node:crypto";
import type { RowDataPacket } from "mysql2/promise";
import { test, expect } from "./base-test";
import { useBrowserSession } from "./browser-session";
import { fixtureFlight, ownedBooking, rpc, sqlRows } from "./hardening";
import { testUsers } from "./test-data";

/** Real browser + disposable database acceptance; no external provider charge. */
export function registerIbeJourneyTests() {
  test.describe("IBE entry and invoice review", () => {
    test.beforeEach(async ({ page }) => {
      await page.addInitScript(() => localStorage.setItem("i18nextLng", "en"));
    });

    test("search party survives login and a promotion settles once through the owned wallet", async ({
      page,
    }) => {
      await useBrowserSession(page, "admin");
      const client = rpc(page);
      const code =
        "IBE" + randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase();
      await client.vouchers.create.mutate({
        code,
        type: "fixed",
        value: 1000,
        minPurchase: 0,
        maxUses: 1,
        validFrom: new Date(Date.now() - 60_000),
        validUntil: new Date(Date.now() + 86_400_000),
        isActive: true,
      });
      const flightId = await fixtureFlight();
      const flight = await client.flights.getById.query({ id: flightId });
      if (!flight) throw new Error("Missing IBE flight fixture");
      await page.context().clearCookies();
      const search = new URLSearchParams({
        origin: String(flight.origin.id),
        destination: String(flight.destination.id),
        date: flight.departureTime.toISOString().slice(0, 10),
        adults: "1",
        children: "1",
        infants: "0",
        currency: "KWD",
        country: "KW",
      });
      await page.goto(`/?${search}`);
      await page.getByTestId("home-search-button").click();
      const card = page
        .getByTestId("flight-card")
        .filter({ hasText: flight.flightNumber });
      await card
        .getByRole("link", { name: "Book Now", exact: true })
        .first()
        .click();
      await expect(page).toHaveURL(/\/login\?returnTo=/);
      await page.locator("#email").fill(testUsers.regular.email);
      await page.locator("#password").fill(testUsers.regular.password);
      await page.getByTestId("login-submit").click();
      await expect(page).toHaveURL(new RegExp(`/booking/${flightId}\\?`));
      const bookingQuery = new URL(page.url()).searchParams;
      expect(
        new URLSearchParams(bookingQuery.get("search") ?? "").get("currency")
      ).toBe("KWD");
      for (const [index, name] of ["Adult", "Child"].entries()) {
        await page.locator(`#pax-firstname-${index}`).fill(name);
        await page.locator(`#pax-lastname-${index}`).fill("Journey");
      }
      await page
        .getByRole("button", { name: "Refresh fare offer", exact: true })
        .click();
      await page
        .getByRole("button", {
          name: "Complete Booking & Payment",
          exact: true,
        })
        .click();
      await expect(page).toHaveURL(/\/checkout\/\d+\?/);
      const bookingId = Number(new URL(page.url()).pathname.split("/").pop());
      expect(new URL(page.url()).searchParams.get("currency")).toBe("KWD");
      const before = await client.payments.getCheckoutState.query({
        bookingId,
      });
      expect(before.currency).toBe("SAR");
      expect(
        (await client.bookings.getPassengers.query({ bookingId })).map(
          row => row.type
        )
      ).toEqual(["adult", "child"]);
      await page.getByLabel("Voucher Code", { exact: true }).fill(code);
      await page.getByRole("button", { name: "Apply", exact: true }).click();
      await expect(
        page.getByText(`Promotion ${code}`, { exact: true })
      ).toBeVisible();
      const discounted = await client.payments.getCheckoutState.query({
        bookingId,
      });
      expect(discounted.totalAmount).toBe(before.totalAmount - 1000);
      const user = await client.auth.me.query();
      if (!user) throw new Error("Missing IBE account");
      await client.wallet.balance.query();
      // Synthetic opening funds in the owned disposable database; no top-up or
      // provider acceptance is claimed by this fixture.
      await sqlRows<RowDataPacket>(
        "UPDATE wallets SET balance=balance+? WHERE userId=? AND status='active' AND currency='SAR'",
        [discounted.totalAmount, user.id]
      );
      await page.getByRole("button", { name: "Wallet", exact: true }).click();
      await page
        .getByRole("button", { name: "Confirm wallet payment", exact: true })
        .click();
      await expect(page).toHaveURL(/\/payment-history/);
      await page.goto(`/booking/${bookingId}?canceled=true`);
      await expect(page).toHaveURL(
        new RegExp(`/checkout/${bookingId}\\?canceled=true`)
      );
      await expect(
        page.getByRole("heading", { name: "Payment received", exact: true })
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Continue payment", exact: true })
      ).toHaveCount(0);
      expect(
        (await client.payments.getCheckoutState.query({ bookingId })).state
      ).toBe("paid");
      expect(
        await sqlRows<RowDataPacket>(
          "SELECT id FROM bookings WHERE userId=? AND flightId=?",
          [user.id, flightId]
        )
      ).toHaveLength(1);
      const charges = await sqlRows<RowDataPacket>(
        "SELECT amount, currency FROM financial_ledger WHERE bookingId=? AND type='charge'",
        [bookingId]
      );
      expect(charges).toHaveLength(1);
      // The invoice uses minor units; the ledger stores DECIMAL major units.
      expect(Math.round(Number(charges[0].amount) * 100)).toBe(
        discounted.totalAmount
      );
      expect(charges[0].currency).toBe("SAR");
    });

    test("public reference lookup shows only the itinerary and does not grant account access", async ({
      page,
    }) => {
      const { booking, flightId } = await ownedBooking(page);
      const flight = await rpc(page).flights.getById.query({ id: flightId });
      if (!flight) throw new Error("Missing public lookup fixture");
      await page.context().clearCookies();
      await page.goto("/manage-booking");
      await page
        .getByLabel("Booking reference", { exact: true })
        .fill(booking.bookingReference);
      await page
        .getByLabel("Passenger surname", { exact: true })
        .fill("Journey");
      const reply = page.waitForResponse(
        response =>
          new URL(response.url()).pathname.includes("manageBooking.lookup") &&
          response.ok()
      );
      await page
        .getByRole("button", { name: "Find booking", exact: true })
        .click();
      expect((await reply).headers()["cache-control"]).toContain("no-store");
      await expect(
        page.getByRole("heading", { name: flight.flightNumber, exact: true })
      ).toBeVisible();
      await expect(page.locator("#manage-booking-surname")).toHaveValue("");
      await expect(page).toHaveURL(/\/manage-booking$/);
      await page
        .getByRole("link", { name: "Open my bookings", exact: true })
        .click();
      await expect(page).toHaveURL(/\/login\?returnTo=/);
      expect(new URL(page.url()).searchParams.get("returnTo")).toBe(
        "/my-bookings"
      );
    });
  });
}
