import { test, expect } from "@playwright/test";
import type { RowDataPacket } from "mysql2/promise";
import { useBrowserSession } from "./fixtures/browser-session";
import { ownedBooking, rpc, sqlRows } from "./fixtures/hardening";

test("a historical EXST request stays readable and cannot reserve or confirm an extra seat", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem("i18nextLng", "en"));
  const { booking } = await ownedBooking(page);
  const api = rpc(page);
  const bookingId = booking.bookingId;
  const [passenger] = await api.bookings.getPassengers.query({ bookingId });
  const catalog = await api.specialServices.getAvailableServices.query();
  expect(catalog.extra_legroom).toEqual([]);
  await expect(
    api.specialServices.requestService.mutate({
      bookingId,
      passengerId: passenger.id,
      serviceType: "extra_legroom",
      serviceCode: "EXST",
    })
  ).rejects.toMatchObject({ data: { code: "BAD_REQUEST" } });
  expect(
    await api.specialServices.getBookingServices.query({ bookingId })
  ).toHaveLength(0);

  await sqlRows<RowDataPacket>(
    "INSERT INTO special_services (bookingId,passengerId,serviceType,serviceCode,status) VALUES (?,?,'extra_legroom','EXST','pending')",
    [bookingId, passenger.id]
  );
  const [legacy] = await api.specialServices.getBookingServices.query({
    bookingId,
  });
  await useBrowserSession(page, "admin");
  await expect(
    api.specialServices.adminUpdateStatus.mutate({
      serviceId: legacy.id,
      status: "confirmed",
    })
  ).rejects.toMatchObject({ data: { code: "BAD_REQUEST" } });
  await useBrowserSession(page, "regular");
  await page.goto("/my-bookings");
  const card = page
    .locator('[data-slot="card"]')
    .filter({ hasText: booking.bookingReference });
  await card
    .getByRole("button", { name: "Special Services", exact: true })
    .click();
  await card.getByRole("button", { name: /Extra Legroom/ }).click();
  await expect(
    card.getByText(
      "Historical request recorded as EXST. Seat allocation unverified."
    )
  ).toBeVisible();
  expect(
    await sqlRows<RowDataPacket>(
      "SELECT id FROM seat_inventory WHERE bookingId=? AND passengerId=?",
      [bookingId, passenger.id]
    )
  ).toEqual([]);
});
