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
  const { booking, flightId } = await ownedBooking(
    page,
    true,
    undefined,
    "departurePassenger"
  );
  const db = await mysql.createConnection(disposableDatabaseUrl());
  try {
    await db.query("SET SESSION time_zone = '+00:00'");
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
  for (const status of ["delayed", "cancelled"] as const) {
    test(`scoped desk recovers a boarded passenger after departure on a ${status} flight`, async ({
      page,
    }) => {
      test.setTimeout(120000);
      await page.addInitScript(() => localStorage.setItem("i18nextLng", "en"));
      const scope = await prepareCounterBooking(page);
      // Payment funds the reservation. Issue its local document before DCS
      // changes the coupon from open to checked in and back to open.
      const { ticketNumber } = await rpc(page).eticket.generateETicket.mutate({
        bookingId: scope.bookingId,
        passengerId: scope.passengerId,
      });
      const couponStatus = () =>
        sqlRows<RowDataPacket>(
          "SELECT status FROM ticket_coupons WHERE flightId = ? AND bookingId = ? AND passengerId = ? AND ticketNumber = ?",
          [scope.flightId, scope.bookingId, scope.passengerId, ticketNumber]
        );
      expect(await couponStatus()).toEqual([{ status: "O" }]);
      await useBrowserSession(page, "ops");
      const client = rpc(page);
      const openPassenger = async () => {
        await page.goto("/airline/dcs");
        await page
          .getByRole("combobox", { name: "Flight", exact: true })
          .selectOption(String(scope.flightId));
        await page
          .getByRole("button", { name: "Select Synthetic Journey" })
          .click();
      };
      await openPassenger();
      await page
        .getByLabel("Passenger action reason")
        .fill("Current reservation and documents checked at counter");
      await page
        .getByRole("button", { name: "Check in passenger", exact: true })
        .click();
      await expect(
        page.getByRole("combobox", { name: "Passenger action", exact: true })
      ).toHaveValue("board");
      await page
        .getByLabel("Passenger action reason")
        .fill("Passenger physically boarded before operational interruption");
      await page
        .getByRole("button", { name: "Board passenger", exact: true })
        .click();
      await expect(
        page.getByRole("combobox", { name: "Passenger action", exact: true })
      ).toHaveValue("deplane");
      expect(await couponStatus()).toEqual([{ status: "C" }]);
      // Only the disposable fixture's flight status and clock change in SQL.
      // Check-in, boarding and both corrections run through the real UI/API.
      const db = await mysql.createConnection(disposableDatabaseUrl());
      try {
        await db.execute(
          "UPDATE flights SET status = ?, departureTime = CURRENT_TIMESTAMP() - INTERVAL 1 MINUTE WHERE id = ?",
          [status, scope.flightId]
        );
      } finally {
        await db.end();
      }
      await openPassenger();
      await expect(
        page.getByRole("combobox", { name: "Passenger action", exact: true })
      ).toHaveValue("deplane");
      await page
        .getByLabel("Passenger action reason")
        .fill("Passenger returned to the gate after the interruption");
      await page
        .getByRole("button", { name: "Deplane passenger", exact: true })
        .click();
      await expect(
        page.getByRole("combobox", { name: "Passenger action", exact: true })
      ).toHaveValue("offload");
      await expect(
        page
          .getByRole("combobox", { name: "Passenger action", exact: true })
          .locator('option[value="board"]')
      ).toHaveJSProperty("disabled", true);
      await expect(
        client.dcsOperations.transition.mutate({
          ...scope,
          action: "board",
          reason: "New boarding remains unavailable after interruption",
          idempotencyKey: randomUUID(),
        })
      ).rejects.toThrow(/not open/i);
      await page
        .getByLabel("Passenger action reason")
        .fill("Passenger and reservation reviewed for offload without bags");
      await page
        .getByRole("button", { name: "Offload passenger", exact: true })
        .click();
      await expect
        .poll(async () => {
          const desk = await client.dcsOperations.getDesk.query({
            flightId: scope.flightId,
          });
          return desk.passengers.find(p => p.passengerId === scope.passengerId)
            ?.attendanceState;
        })
        .toBe("offloaded");
      const desk = await client.dcsOperations.getDesk.query({
        flightId: scope.flightId,
      });
      expect(desk.passengers[0]).toMatchObject({
        bookingId: scope.bookingId,
        passengerId: scope.passengerId,
        attendanceState: "offloaded",
        checkedIn: false,
      });
      expect(desk.history.map(row => row.action).sort()).toEqual(
        ["check_in", "board", "deplane", "offload"].sort()
      );
      const seats = await sqlRows<RowDataPacket>(
        "SELECT status, checkInNonce FROM seat_inventory WHERE flightId = ? AND bookingId = ? AND passengerId = ?",
        [scope.flightId, scope.bookingId, scope.passengerId]
      );
      expect(seats).toHaveLength(1);
      expect(seats[0]).toMatchObject({
        status: "occupied",
        checkInNonce: null,
      });
      expect(await couponStatus()).toEqual([{ status: "O" }]);
      await openPassenger();
      await expect(
        page.getByRole("combobox", { name: "Passenger action", exact: true })
      ).toHaveValue("check_in");
      await expect(page.getByLabel("Passenger action reason")).toBeDisabled();
      await expect(
        page.getByRole("button", { name: "Check in passenger", exact: true })
      ).toBeDisabled();
      expect(
        await sqlRows<RowDataPacket>(
          "SELECT id FROM baggage_items WHERE bookingId = ?",
          [scope.bookingId]
        )
      ).toHaveLength(0);
    });
  }

  test("scoped desk persists boarding and recovers a received bag after a lost response", async ({
    page,
  }) => {
    test.setTimeout(120000);
    await page.addInitScript(() => localStorage.setItem("i18nextLng", "en"));
    const scope = await prepareCounterBooking(page);
    await useBrowserSession(page, "ops");
    const client = rpc(page);
    const staff = await client.auth.me.query();
    if (!staff) throw new Error("Scoped operator required");
    const { flight } = await client.dcsOperations.getDesk.query({
      flightId: scope.flightId,
    });
    await useBrowserSession(page, "admin");
    await client.dcsOperations.setBagReturnGrant.mutate({
      flightId: flight.id,
      airlineId: flight.airlineId,
      airportId: flight.originId,
      staffId: staff.id,
      enabled: true,
      reason: "Authorize the synthetic departure station handover",
      idempotencyKey: randomUUID(),
    });
    await useBrowserSession(page, "ops");
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
      "SELECT id, flightId, segmentId, tagNumber FROM baggage_items WHERE bookingId = ?",
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

    await useBrowserSession(page, "departurePassenger");
    const pass = await client.boardingPass.issue.mutate(scope);
    await useBrowserSession(page, "ops");
    await page.getByLabel("Boarding pass token (optional)").fill(pass.bcbp);
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
        action: "board",
        boardingPassToken: pass.bcbp,
        reason: "Gate repeats same boarding scan",
        idempotencyKey: randomUUID(),
      })
    ).rejects.toThrow(/has boarded|deplane/i);
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
    expect(desk.history.filter(e => e.action === "board")).toHaveLength(1);
    await page
      .getByLabel("Returned bag tag number")
      .fill(String(bags[0].tagNumber));
    await page
      .getByLabel("Bag handover reason")
      .fill("Passenger identity and tag verified at handover");
    const handover = page.getByRole("button", { name: "Confirm bag handover" });
    await page.route(
      "**/api/trpc/*dcsOperations.returnBag*",
      async route => {
        const committed = await route.fetch();
        expect(committed.ok()).toBe(true);
        await route.abort("failed");
      },
      { times: 1 }
    );
    await handover.click();
    const returnEvents = () =>
      sqlRows<RowDataPacket>(
        "SELECT id FROM dcs_operation_events WHERE flightId=? AND passengerId=? AND action='return_bag'",
        [scope.flightId, scope.passengerId]
      );
    await expect.poll(async () => (await returnEvents()).length).toBe(1);
    await handover.click();
    await expect(page.getByText(/Bag handover receipt/)).toContainText(
      String(bags[0].tagNumber)
    );
    expect(await returnEvents()).toHaveLength(1);
    await page
      .getByLabel("Passenger action reason")
      .fill("Handover receipt verified before offload");
    await page
      .getByRole("button", { name: "Offload passenger", exact: true })
      .click();
    await expect
      .poll(
        async () =>
          (
            await client.dcsOperations.getDesk.query({
              flightId: scope.flightId,
            })
          ).passengers[0]?.attendanceState
      )
      .toBe("offloaded");
    const receipt = await sqlRows<RowDataPacket>(
      "SELECT b.status,b.tagNumber,e.action,e.actorRole,e.flightId FROM baggage_items b JOIN dcs_operation_events e ON e.id=b.returnEventId WHERE b.id=?",
      [bags[0].id]
    );
    expect(receipt).toEqual([
      {
        status: "claimed",
        tagNumber: bags[0].tagNumber,
        action: "return_bag",
        actorRole: "ops",
        flightId: scope.flightId,
      },
    ]);
    expect(
      await sqlRows<RowDataPacket>(
        "SELECT status FROM ticket_coupons WHERE bookingId=? AND passengerId=? AND flightId=?",
        [scope.bookingId, scope.passengerId, scope.flightId]
      )
    ).toEqual([{ status: "O" }]);
    expect(
      await client.baggage.flightCloseout.query({ flightId: scope.flightId })
    ).toMatchObject({
      expectedBags: 0,
      unexpectedBags: 0,
      unresolvedRegistrations: [],
      acceptanceState: "operator_station_acceptance_required",
    });
  });

  test("scoped desk recovers the same 5 kg bag receipt after reload and registers a second equal-weight bag", async ({
    page,
  }) => {
    test.setTimeout(120000);
    await page.addInitScript(() => localStorage.setItem("i18nextLng", "en"));
    const scope = await prepareCounterBooking(page);
    await useBrowserSession(page, "ops");
    const operator = await rpc(page).auth.me.query();
    if (!operator || operator.tenantId == null)
      throw new Error(
        "Scoped operations identity is required for receipt recovery"
      );
    const selectPassenger = async () => {
      await page
        .getByRole("combobox", { name: "Flight", exact: true })
        .selectOption(String(scope.flightId));
      await page
        .getByRole("button", { name: "Select Synthetic Journey" })
        .click();
    };
    await page.goto("/airline/dcs");
    await selectPassenger();
    await page
      .getByLabel("Passenger action reason")
      .fill("Counter document and reservation review before receipt recovery");
    await page
      .getByRole("button", { name: "Check in passenger", exact: true })
      .click();
    await expect(
      page.getByRole("combobox", { name: "Passenger action", exact: true })
    ).toHaveValue("board");

    const commands: Record<string, unknown>[] = [];
    let recoveryRequested = false;
    const registerEndpoint = "**/api/trpc/*baggage.register*";
    await page.route(registerEndpoint, async route => {
      const request = route.request();
      const url = new URL(request.url());
      const procedures = decodeURIComponent(
        url.pathname.split("/api/trpc/")[1] ?? ""
      ).split(",");
      const index = procedures.indexOf("baggage.register");
      expect(index).toBeGreaterThanOrEqual(0);
      const body = request.postDataJSON() as Record<string, unknown>;
      const envelope = (
        url.searchParams.get("batch") === "1" ? body[String(index)] : body
      ) as { json?: unknown };
      if (
        !envelope ||
        !envelope.json ||
        typeof envelope.json !== "object" ||
        Array.isArray(envelope.json)
      )
        throw new Error("Expected the actual baggage registration payload");
      commands.push(envelope.json as Record<string, unknown>);
      if (commands.length === 2 || commands.length === 4) {
        expect(
          recoveryRequested,
          "A reload must not resubmit automatically"
        ).toBe(true);
        return route.continue();
      }
      expect(recoveryRequested).toBe(false);
      // Commit each new physical receipt, then lose only its first response.
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      await route.abort("failed");
    });
    const baggage = page.getByRole("region", {
      name: "Passenger baggage registration",
    });
    const description = "Blue cabin-size suitcase";
    const handling = "Fragile handle with care";
    await baggage.getByLabel("Bag weight in kilograms").fill("5");
    await baggage.getByLabel("Bag description (optional)").fill(description);
    await baggage.getByLabel("Handling instructions (optional)").fill(handling);
    await baggage
      .getByRole("button", { name: "Register received bag" })
      .click();
    await expect(
      baggage.getByRole("button", { name: "Recover bag receipt" })
    ).toBeVisible();
    await expect(
      baggage.getByRole("definition").filter({ hasText: /^18 kg$/ })
    ).toBeVisible();
    expect(commands).toHaveLength(1);
    const originalCommand = commands[0];
    expect(originalCommand).toEqual({
      ...scope,
      segmentId: expect.any(Number),
      weight: 5,
      description,
      specialHandling: handling,
      idempotencyKey: expect.any(String),
      expectedActorId: operator.id,
      expectedTenantId: operator.tenantId,
    });
    const readBags = () =>
      sqlRows<RowDataPacket>(
        "SELECT id, tagNumber, passengerId, flightId, segmentId, weight, description, specialHandling FROM baggage_items WHERE bookingId = ? ORDER BY id",
        [scope.bookingId]
      );
    const originalBags = await readBags();
    expect(originalBags).toHaveLength(1);
    const originalBag = originalBags[0];
    expect(Number(originalBag.weight)).toBe(5);
    expect(originalBag.flightId).toBe(scope.flightId);
    expect(originalBag.passengerId).toBe(scope.passengerId);
    expect(originalBag.segmentId).toBe(originalCommand.segmentId);
    expect(originalBag.description).toBe(description);
    expect(originalBag.specialHandling).toBe(handling);

    await page.reload();
    await selectPassenger();
    await expect(
      baggage.getByRole("definition").filter({ hasText: /^18 kg$/ })
    ).toBeVisible();
    const recover = baggage.getByRole("button", {
      name: "Recover bag receipt",
    });
    await expect(recover).toBeEnabled();
    await expect(baggage.getByLabel("Bag weight in kilograms")).toHaveValue(
      "5"
    );
    await expect(baggage.getByLabel("Bag description (optional)")).toHaveValue(
      description
    );
    await expect(
      baggage.getByLabel("Handling instructions (optional)")
    ).toHaveValue(handling);
    for (const label of [
      "Bag weight in kilograms",
      "Bag description (optional)",
      "Handling instructions (optional)",
    ])
      await expect(baggage.getByLabel(label)).toBeDisabled();
    await expect(
      baggage.getByRole("button", { name: "Register received bag" })
    ).toBeDisabled();
    expect(commands).toHaveLength(1);
    expect(await readBags()).toEqual(originalBags);

    recoveryRequested = true;
    await recover.click();
    await expect(baggage.getByRole("status")).toContainText(
      String(originalBag.tagNumber)
    );
    await expect(recover).toBeHidden();
    expect(commands).toHaveLength(2);
    expect(commands[1]).toEqual(originalCommand);
    expect(await readBags()).toEqual(originalBags);
    const tracking = await sqlRows<RowDataPacket>(
      "SELECT id FROM baggage_tracking WHERE baggageId = ?",
      [originalBag.id]
    );
    expect(tracking).toHaveLength(1);

    recoveryRequested = false;
    await page.reload();
    await selectPassenger();
    await expect(
      baggage.getByRole("definition").filter({ hasText: /^18 kg$/ })
    ).toBeVisible();
    await expect(recover).toBeHidden();
    await expect(baggage.getByLabel("Bag weight in kilograms")).toHaveValue("");
    await baggage.getByLabel("Bag weight in kilograms").fill("5");
    await expect(
      baggage.getByRole("button", { name: "Register received bag" })
    ).toBeEnabled();
    expect(commands).toHaveLength(2);
    expect(await readBags()).toEqual(originalBags);
    // Same passenger, weight and description: the explicit new registration
    // gives the second physical bag its own tag and retry identity.
    await baggage.getByLabel("Bag description (optional)").fill(description);
    await baggage.getByLabel("Handling instructions (optional)").fill(handling);
    await baggage
      .getByRole("button", { name: "Register received bag" })
      .click();
    await expect(recover).toBeEnabled();
    await expect(
      baggage.getByRole("definition").filter({ hasText: /^13 kg$/ })
    ).toBeVisible();
    expect(commands).toHaveLength(3);
    const secondCommand = commands[2];
    expect(secondCommand).toEqual({
      ...originalCommand,
      idempotencyKey: expect.any(String),
    });
    expect(secondCommand.idempotencyKey).not.toBe(
      originalCommand.idempotencyKey
    );
    const bothBags = await readBags();
    expect(bothBags).toHaveLength(2);
    expect(bothBags[0]).toEqual(originalBag);
    const secondBag = bothBags[1];
    expect(secondBag).toMatchObject({
      passengerId: originalBag.passengerId,
      flightId: originalBag.flightId,
      segmentId: originalBag.segmentId,
      weight: originalBag.weight,
      description,
      specialHandling: handling,
    });
    expect(secondBag.tagNumber).not.toBe(originalBag.tagNumber);

    recoveryRequested = true;
    await recover.click();
    await expect(baggage.getByRole("status")).toContainText(
      secondBag.tagNumber
    );
    await expect(recover).toBeHidden();
    expect(commands).toHaveLength(4);
    expect(commands[3]).toEqual(secondCommand);
    await page.reload();
    await selectPassenger();
    await expect(recover).toBeHidden();
    for (const bag of bothBags) {
      await expect(
        baggage.getByText(bag.tagNumber, { exact: true })
      ).toBeVisible();
    }
    expect(await readBags()).toEqual(bothBags);
    expect(
      await sqlRows<RowDataPacket>(
        "SELECT baggageId FROM baggage_tracking WHERE baggageId IN (?, ?) ORDER BY baggageId",
        [originalBag.id, secondBag.id]
      )
    ).toEqual([{ baggageId: originalBag.id }, { baggageId: secondBag.id }]);
    await page.unroute(registerEndpoint);
  });
}
