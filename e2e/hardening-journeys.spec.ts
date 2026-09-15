import { test, expect } from "./fixtures/base-test";
import { useBrowserSession } from "./fixtures/browser-session";
import type { Page } from "@playwright/test";
import { ownedBooking, rpc, sqlRows } from "./fixtures/hardening";
import type { RowDataPacket } from "mysql2/promise";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

async function loginAsAdmin(page: Page) {
  await useBrowserSession(page, "admin");
}

test.describe("Funded journeys and truthful operational reads", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("i18nextLng", "en"));
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
