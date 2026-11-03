import { randomUUID } from "node:crypto";
import mysql, {
  type ResultSetHeader,
  type RowDataPacket,
} from "mysql2/promise";
import type { Page } from "@playwright/test";
import { test, expect } from "./base-test";
import { ownedBooking, rpc, sqlRows } from "./hardening";
import { useBrowserSession } from "./browser-session";
import { disposableDatabaseUrl } from "../disposable-database";

async function prepareCounterBooking(page: Page) {
  // Creation and payment use the real customer commands. SQL only supplies
  // the synthetic airline, departure clock and aircraft-seat inventory.
  const { booking, flightId } = await ownedBooking(page, true);
  const db = await mysql.createConnection(disposableDatabaseUrl());
  try {
    await db.beginTransaction();
    const [actors] = await db.execute<(RowDataPacket & { tenantId: number })[]>(
      "SELECT tenantId FROM users WHERE email = 'test.ops@example.com' AND role = 'ops'"
    );
    if (actors.length !== 1 || !actors[0].tenantId)
      throw new Error("Scoped E2E operations account is missing");
    const tenantId = actors[0].tenantId;
    const [airports] = await db.execute<
      (RowDataPacket & { id: number; code: string; country: string })[]
    >(
      "SELECT id, code, country FROM airports WHERE code IN ('RUH', 'JED') ORDER BY code"
    );
    if (airports.length !== 2 || airports[0].country !== airports[1].country)
      throw new Error("Domestic counter fixture airports are missing");
    await db.execute(
      "UPDATE flights SET tenantId = ?, originId = ?, destinationId = ?, departureTime = UTC_TIMESTAMP() + INTERVAL 3 HOUR, arrivalTime = UTC_TIMESTAMP() + INTERVAL 5 HOUR WHERE id = ?",
      [tenantId, airports[0].id, airports[1].id, flightId]
    );
    await db.execute("UPDATE bookings SET tenantId = ? WHERE id = ?", [
      tenantId,
      booking.bookingId,
    ]);
    await db.execute("UPDATE passengers SET tenantId = ? WHERE bookingId = ?", [
      tenantId,
      booking.bookingId,
    ]);
    const [people] = await db.execute<(RowDataPacket & { id: number })[]>(
      "SELECT id FROM passengers WHERE bookingId = ?",
      [booking.bookingId]
    );
    if (people.length !== 1)
      throw new Error("Expected one funded fixture passenger");
    const [segments] = await db.execute<(RowDataPacket & { id: number })[]>(
      "SELECT id FROM booking_segments WHERE bookingId = ? AND flightId = ?",
      [booking.bookingId, flightId]
    );
    if (segments.length === 0) {
      await db.execute(
        "INSERT INTO booking_segments (bookingId, segmentOrder, flightId, seatsReserved, departureDate, status) SELECT ?, 1, id, true, departureTime, 'confirmed' FROM flights WHERE id = ?",
        [booking.bookingId, flightId]
      );
    } else if (segments.length !== 1)
      throw new Error("Ambiguous fixture segment");
    const [map] = await db.execute<ResultSetHeader>(
      "INSERT INTO seat_maps (aircraftType, airlineId, configName, cabinLayout, totalSeats, economySeats) SELECT aircraftType, airlineId, 'Synthetic DCS counter', '{}', 1, 1 FROM flights WHERE id = ?",
      [flightId]
    );
    await db.execute(
      "INSERT INTO seat_inventory (flightId, seatMapId, seatNumber, `row`, `column`, cabinClass, seatType, seatPrice, priceTier, status) VALUES (?, ?, '1A', 1, 'A', 'economy', 'window', 0, 'free', 'available')",
      [flightId, map.insertId]
    );
    await db.commit();
    return {
      bookingId: booking.bookingId,
      flightId,
      passengerId: people[0].id,
    };
  } catch (error) {
    await db.rollback();
    throw error;
  } finally {
    await db.end();
  }
}

export function registerDcsCounterTests() {
  test("scoped desk persists boarding and recovers a received bag after a lost response", async ({
    page,
  }) => {
    test.setTimeout(120000);
    await page.addInitScript(() => localStorage.setItem("i18nextLng", "en"));
    const scope = await prepareCounterBooking(page);
    await useBrowserSession(page, "ops");
    const client = rpc(page);
    await page.goto("/airline/dcs");
    await page
      .getByRole("combobox", { name: "Flight", exact: true })
      .selectOption(String(scope.flightId));
    await page
      .getByRole("button", { name: "Select Synthetic Journey" })
      .click();
    await page
      .getByLabel("Passenger action reason")
      .fill("Counter document and reservation review");
    await page
      .getByRole("button", { name: "Check in passenger", exact: true })
      .click();
    await expect(
      page.getByRole("combobox", { name: "Passenger action", exact: true })
    ).toHaveValue("board");

    // The server commits the real request; only its first response is lost.
    const registerEndpoint = "**/api/trpc/*baggage.register*";
    let dropped = false;
    await page.route(registerEndpoint, async route => {
      if (dropped) return route.continue();
      dropped = true;
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      await route.abort("failed");
    });
    const baggage = page.getByRole("region", {
      name: "Passenger baggage registration",
    });
    await baggage.getByLabel("Bag weight in kilograms").fill("13");
    await baggage
      .getByRole("button", { name: "Register received bag" })
      .click();
    await expect
      .poll(
        async () =>
          (
            await sqlRows<RowDataPacket>(
              "SELECT id FROM baggage_items WHERE bookingId = ?",
              [scope.bookingId]
            )
          ).length
      )
      .toBe(1);
    await expect(
      baggage.getByRole("definition").filter({ hasText: /^10 kg$/ })
    ).toBeVisible();
    await page.unroute(registerEndpoint);
    await baggage.getByRole("button", { name: "Recover bag receipt" }).click();
    await expect(baggage.getByRole("status")).toContainText(
      "Registered bag tag"
    );
    const bags = await sqlRows<RowDataPacket>(
      "SELECT id, flightId, segmentId FROM baggage_items WHERE bookingId = ?",
      [scope.bookingId]
    );
    expect(bags).toHaveLength(1);
    expect(bags[0].flightId).toBe(scope.flightId);
    expect(bags[0].segmentId).toBeGreaterThan(0);

    await page
      .getByLabel("Check-in state reason")
      .fill("Counter is closing for boarding");
    await page
      .getByRole("button", { name: "Close check-in", exact: true })
      .click();
    await expect(
      page.getByText("Check-in closed", { exact: true })
    ).toBeVisible();
    await baggage.getByLabel("Bag weight in kilograms").fill("1");
    await expect(
      baggage.getByRole("button", { name: "Register received bag" })
    ).toBeDisabled();

    await page
      .getByLabel("Passenger action reason")
      .fill("Verified at the departure gate");
    await page
      .getByRole("button", { name: "Board passenger", exact: true })
      .click();
    await expect(
      page.getByRole("combobox", { name: "Passenger action", exact: true })
    ).toHaveValue("deplane");
    await expect(
      client.dcsOperations.transition.mutate({
        ...scope,
        action: "offload",
        reason: "Must deplane before offload",
        idempotencyKey: randomUUID(),
      })
    ).rejects.toThrow(/deplane|boarded/i);
    await page.reload();
    await page
      .getByRole("combobox", { name: "Flight", exact: true })
      .selectOption(String(scope.flightId));
    await page
      .getByRole("button", { name: "Select Synthetic Journey" })
      .click();
    await expect(
      page.getByRole("combobox", { name: "Passenger action", exact: true })
    ).toHaveValue("deplane");
    await page
      .getByLabel("Passenger action reason")
      .fill("Passenger returned to departure gate");
    await page
      .getByRole("button", { name: "Deplane passenger", exact: true })
      .click();
    await expect(
      page.getByRole("combobox", { name: "Passenger action", exact: true })
    ).toHaveValue("board");
    await page
      .getByRole("combobox", { name: "Passenger action", exact: true })
      .selectOption("offload");
    await page
      .getByLabel("Passenger action reason")
      .fill("Counter bag still requires retrieval");
    await page
      .getByRole("button", { name: "Offload passenger", exact: true })
      .click();
    await expect(
      page.getByRole("alert").filter({ hasText: /baggage|bag/i })
    ).toBeVisible();
    const desk = await client.dcsOperations.getDesk.query({
      flightId: scope.flightId,
    });
    expect(desk.passengers[0].attendanceState).toBe("checked_in");
    expect(desk.history.map(row => row.action)).toEqual(
      expect.arrayContaining(["check_in", "board", "deplane", "close"])
    );
  });
}
