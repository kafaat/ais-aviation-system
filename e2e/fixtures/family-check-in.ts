import { randomUUID } from "node:crypto";
import type { RowDataPacket } from "mysql2/promise";
import { test, expect } from "./base-test";
import { useBrowserSession } from "./browser-session";
import { ownedBooking, rpc, sqlRows } from "./hardening";

export function registerFamilyCheckInTests() {
  test("a family can check in its eligible passenger while a companion remains denied", async ({
    page,
  }) => {
    test.setTimeout(120000);
    await page.addInitScript(() => localStorage.setItem("i18nextLng", "en"));
    const { booking, flightId } = await ownedBooking(page, true, [
      { firstName: "Nora", lastName: "Family", type: "adult" },
      { firstName: "Sami", lastName: "Family", type: "adult" },
    ]);
    const client = rpc(page);
    const bookingId = booking.bookingId;
    const passengers = await client.bookings.getPassengers.query({ bookingId });
    const nora = passengers.find(p => p.firstName === "Nora");
    const sami = passengers.find(p => p.firstName === "Sami");
    if (!nora || !sami)
      throw new Error("Funded family booking is missing a passenger");

    // TIMESTAMP assignments use the connection's local clock. Set the domestic
    // departure well inside the 1–48 hour window even when MySQL runs outside UTC.
    await sqlRows<RowDataPacket>(
      "UPDATE flights f JOIN airports o ON o.code='RUH' JOIN airports d ON d.code='JED' AND o.country=d.country SET f.originId=o.id, f.destinationId=d.id, f.departureTime=CURRENT_TIMESTAMP + INTERVAL 12 HOUR, f.arrivalTime=CURRENT_TIMESTAMP + INTERVAL 14 HOUR WHERE f.id=?",
      [flightId]
    );
    const legs = await client.bookings.getDepartureState.query({ bookingId });
    const leg = legs.find(row => row.flightId === flightId);
    expect(leg?.open).toBe(true);

    await useBrowserSession(page, "admin");
    const flight = await client.flights.getById.query({ id: flightId });
    if (!flight) throw new Error("Family fixture flight is missing");
    expect([flight.origin.code, flight.destination.code]).toEqual([
      "RUH",
      "JED",
    ]);
    const map = await client.seatMap.createSeatMap.mutate({
      airlineId: flight.airline.id,
      aircraftType: "B737",
      configName: "Family check-in " + randomUUID(),
      totalSeats: 2,
      economySeats: 2,
      cabinLayout: {
        rows: [
          {
            row: 1,
            cabinClass: "economy",
            seats: [
              { column: "A", seatType: "window", priceTier: "free" },
              { column: "B", seatType: "middle", priceTier: "free" },
            ],
          },
        ],
      },
    });
    await client.seatMap.initializeFlightSeats.mutate({
      flightId,
      seatMapId: map.id,
    });
    await client.dcsOperations.transition.mutate({
      flightId,
      bookingId,
      passengerId: nora.id,
      action: "deny",
      reason: "Synthetic gate denial for this passenger",
      idempotencyKey: randomUUID(),
    });

    await useBrowserSession(page, "regular");
    await page.goto("/check-in");
    await page.getByLabel("Booking Reference (PNR)").fill(booking.pnr);
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await expect(
      page.getByText("Nora Family · Boarding denied", { exact: true })
    ).toBeVisible();
    await expect(
      page.getByRole("checkbox", { name: "Nora Family" })
    ).toHaveCount(0);
    await expect(
      page.getByRole("checkbox", { name: "Sami Family" })
    ).toBeChecked();
    await page.getByRole("button", { name: "Check-in", exact: true }).click();
    const pass = page
      .locator('[data-slot="card"]')
      .filter({ has: page.getByRole("heading", { name: /Boarding Pass/ }) });
    await expect(pass).toHaveCount(1);
    await expect(pass.getByText("Sami Family", { exact: true })).toBeVisible();
    await expect(
      pass.getByRole("button", { name: "Print Boarding Pass" })
    ).toBeVisible();
    const seats = await sqlRows<RowDataPacket>(
      "SELECT passengerId, status FROM seat_inventory WHERE flightId=? AND bookingId=?",
      [flightId, bookingId]
    );
    expect(seats).toEqual([{ passengerId: sami.id, status: "checked_in" }]);
    const states = await client.bookings.getDepartureState.query({ bookingId });
    expect(states.find(row => row.flightId === flightId)?.passengers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          passengerId: nora.id,
          checkedIn: false,
          departureState: "boarding_denied",
        }),
        expect.objectContaining({
          passengerId: sami.id,
          checkedIn: true,
          departureState: "checked_in",
        }),
      ])
    );
  });
}
