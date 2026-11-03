import mysql, {
  type ResultSetHeader,
  type RowDataPacket,
} from "mysql2/promise";
import { disposableDatabaseUrl } from "../disposable-database";
import { test, expect } from "./base-test";
import { useBrowserSession } from "./browser-session";
import { fixtureFlight, rpc } from "./hardening";

export function registerCodeshareTests() {
  test("codeshare search shows the applicable agreement's flight and operating carrier", async ({
    page,
  }) => {
    await page.addInitScript(() => localStorage.setItem("i18nextLng", "en"));
    const flightId = await fixtureFlight();
    const db = await mysql.createConnection(disposableDatabaseUrl());
    let operatingAirlineId: number | undefined;
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
      operatingAirlineId = operator.insertId;
      await db.execute("UPDATE flights SET airlineId = ? WHERE id = ?", [
        operatingAirlineId,
        flightId,
      ]);

      await useBrowserSession(page, "admin");
      const client = rpc(page);
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
    } finally {
      try {
        if (operatingAirlineId) {
          await db.execute(
            "DELETE FROM codeshare_agreements WHERE operatingAirlineId = ?",
            [operatingAirlineId]
          );
          await db.execute("DELETE FROM flights WHERE id = ?", [flightId]);
          await db.execute("DELETE FROM airlines WHERE id = ?", [
            operatingAirlineId,
          ]);
        }
      } finally {
        await db.end();
      }
    }
  });
}
