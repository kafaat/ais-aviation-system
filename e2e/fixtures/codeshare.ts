import { randomUUID } from "node:crypto";
import mysql, {
  type ResultSetHeader,
  type RowDataPacket,
} from "mysql2/promise";
import { disposableDatabaseUrl } from "../disposable-database";
import { test, expect } from "./base-test";
import { useBrowserSession } from "./browser-session";
import { fixtureFlight, rpc } from "./hardening";

export function registerCodeshareTests() {
  test("codeshare checkout and concurrent sales respect the last configured seat", async ({
    page,
  }) => {
    await page.addInitScript(() => localStorage.setItem("i18nextLng", "en"));
    await useBrowserSession(page, "reporting");
    const client = rpc(page);
    const customer = await client.auth.me.query();
    if (!customer) throw new Error("Customer login required");
    const flightId = await fixtureFlight(customer.tenantId);
    const db = await mysql.createConnection(disposableDatabaseUrl());

    try {
      const [[flight]] = await db.execute<RowDataPacket[]>(
        "SELECT airlineId, originId, destinationId, flightNumber FROM flights WHERE id = ?",
        [flightId]
      );
      const code = flightId.toString(36).toUpperCase().padStart(3, "0");
      const carrierName = "Codeshare fixture " + code;
      const [operator] = await db.execute<ResultSetHeader>(
        "INSERT INTO airlines (code, name) VALUES (?, ?)",
        [code, carrierName]
      );
      const operatingAirlineId = operator.insertId;
      await db.execute("UPDATE flights SET airlineId = ? WHERE id = ?", [
        operatingAirlineId,
        flightId,
      ]);

      await useBrowserSession(page, "admin");

      const market = { airlineId: Number(flight.airlineId) };
      const route = {
        originId: Number(flight.originId),
        destinationId: Number(flight.destinationId),
      };
      const shared = {
        marketingAirlineId: market.airlineId,
        operatingAirlineId,
        agreementType: "free_sale" as const,
        revenueShareModel: "free_flow" as const,
        routeScope: "specific_routes" as const,
        validFrom: new Date(Date.now() - 86400000).toISOString(),
      };
      for (const params of [
        {
          routes: [
            { originId: route.destinationId, destinationId: route.originId },
          ],
        },
        {
          routes: [route],
          validUntil: new Date(Date.now() + 3600000).toISOString(),
        },
      ]) {
        const { data } = await client.codeshare.createAgreement.mutate({
          ...shared,
          ...params,
        });
        await client.codeshare.activate.mutate({ id: data.id });
      }
      const before = await client.codeshare.getCodeshareFlights.query(market);
      expect(before.data.filter(row => row.flightId === flightId)).toHaveLength(
        0
      );

      const { data: valid } = await client.codeshare.createAgreement.mutate({
        ...shared,
        routes: [route],
        agreementType: "hard_block",
        blockSize: 3,
      });
      await client.codeshare.activate.mutate({ id: valid.id });
      await page.context().clearCookies();
      const matched = (
        await client.codeshare.getCodeshareFlights.query(market)
      ).data.filter(row => row.flightId === flightId);
      expect(matched).toHaveLength(1);
      expect(matched[0]).toMatchObject({
        partnerSeatsAvailable: null,
        agreementReference: valid.agreementReference,
        agreementType: "hard_block",
        blockSize: 3,
        operatingAirline: { id: operatingAirlineId },
        marketingAirline: { id: market.airlineId },
      });

      await page.goto("/");
      await page.getByRole("link", { name: "Codeshare Flights" }).click();
      await page
        .getByRole("combobox", { name: "Marketing Airline" })
        .selectOption(String(market.airlineId));
      const entry = page.getByRole("listitem").filter({
        has: page.getByRole("heading", {
          name: flight.flightNumber,
          exact: true,
        }),
      });
      await expect(entry).toContainText(carrierName);
      await expect(entry.locator("time")).toBeVisible();

      await useBrowserSession(page, "admin");
      const marketingFlightNumber =
        matched[0].marketingAirline.code + String(flightId);
      const { allotmentId } = await client.codeshare.configureAllotment.mutate({
        agreementId: valid.id,
        flightId,
        marketingFlightNumber,
        cabinClass: "economy",
        seatLimit: 2,
      });
      await useBrowserSession(page, "reporting");
      await page.reload();
      await page
        .getByRole("combobox", { name: "Marketing Airline" })
        .selectOption(String(market.airlineId));
      await entry
        .getByRole("link", { name: "Book " + marketingFlightNumber })
        .click();
      await expect(page).toHaveURL(
        url =>
          url.pathname === "/booking/" + flightId &&
          url.searchParams.get("codeshareAllotmentId") === String(allotmentId)
      );

      await page.locator("#pax-firstname-0").fill("Codeshare");
      await page.locator("#pax-lastname-0").fill("Shopper");
      await page
        .getByRole("button", {
          name: "Complete Booking & Payment",
          exact: true,
        })
        .click();
      await expect(page).toHaveURL(/\/checkout\/\d+\?/);
      const uiBookingId = Number(new URL(page.url()).pathname.split("/").pop());
      const balance = async () =>
        (await client.codeshare.getCodeshareFlights.query(market)).data.find(
          row => row.flightId === flightId
        )?.partnerSeatsAvailable;
      expect(await balance()).toBe(1);

      const commands = [randomUUID(), randomUUID()].map(key => ({
        flightId,
        cabinClass: "economy" as const,
        codeshareAllotmentId: allotmentId,
        sessionId: key,
        idempotencyKey: key,
        passengers: [
          { type: "adult" as const, firstName: "Market", lastName: "Traveler" },
        ],
      }));
      const results = await Promise.allSettled(
        commands.map(command => client.bookings.create.mutate(command))
      );
      const index = results.findIndex(result => result.status === "fulfilled");
      const winner = results[index];
      if (!winner || winner.status !== "fulfilled")
        throw new Error("Neither codeshare booking succeeded");
      expect(results[1 - index]).toMatchObject({
        status: "rejected",
        reason: { message: "Insufficient codeshare allotment" },
      });
      const booking = winner.value;
      expect(await client.bookings.create.mutate(commands[index])).toEqual(
        booking
      );
      expect(
        (await client.bookings.myBookings.query()).find(
          row => row.id === booking.bookingId
        )
      ).toMatchObject({ marketingFlightNumber });
      expect(await balance()).toBe(0);

      await db.execute(
        "INSERT INTO user_credits (userId, amount, source) VALUES (?, ?, 'promo')",
        [customer.id, booking.totalAmount]
      );
      await client.vouchers.useCredits.mutate({
        bookingId: booking.bookingId,
        amount: booking.totalAmount,
      });
      expect(
        (await client.bookings.myBookings.query()).find(
          row => row.id === booking.bookingId
        )
      ).toMatchObject({
        status: "confirmed",
        paymentStatus: "paid",
        canExchange: false,
        marketingFlightNumber,
      });
      await expect(
        client.ndc.quotePaidService.mutate({
          bookingId: booking.bookingId,
          replaceFlightId: flightId,
          offerIds: [randomUUID()],
          idempotencyKey: randomUUID(),
        })
      ).rejects.toThrow(/Issuing channel/);
      expect(await balance()).toBe(0);
      const [[sale]] = await db.execute<RowDataPacket[]>(
        "SELECT count(*) AS invoices, sum(seatsReserved) AS funded FROM bookings WHERE codeshareAllotmentId = ?",
        [allotmentId]
      );
      expect(Number(sale.invoices)).toBe(2);
      expect(Number(sale.funded)).toBe(1);
      await db.execute(
        "UPDATE inventory_locks h JOIN bookings b ON b.inventoryLockId = h.id SET h.expiresAt = UTC_TIMESTAMP() - INTERVAL 1 MINUTE WHERE b.id = ?",
        [uiBookingId]
      );
      expect(await balance()).toBe(1);
    } finally {
      await db.end();
    }
  });
}
