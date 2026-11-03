import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { expect, test } from "./base-test";
import { useBrowserSession } from "./browser-session";
import { fixtureFlight, rpc, sqlRows } from "./hardening";

export function registerBaggageConsistencyTest() {
  test("AT-02 preserves funded baggage totals and the single-bag cap from e-ticket to bag drop", async ({
    page,
  }) => {
    await page.addInitScript(() => localStorage.setItem("i18nextLng", "en"));
    await useBrowserSession(page, "reporting");
    const client = rpc(page);
    const user = await client.auth.me.query();
    if (!user) throw new Error("Passenger session missing");
    expect(user.role).toBe("user");
    expect(user.tenantId).toEqual(expect.any(Number));
    const bag = (await client.ancillary.getAvailable.query({})).find(
      item => item.code === "BAG_20KG"
    );
    if (!bag) throw new Error("20 kg product missing");
    const scenarios = [
      { cabinClass: "business", firstName: "Business", totalKg: 32 },
      { cabinClass: "economy", firstName: "Economy", totalKg: 43 },
    ] as const;
    const fixtures = [];
    for (const { cabinClass, firstName, totalKg } of scenarios) {
      const flightId = await fixtureFlight(user.tenantId);
      // A domestic, check-in-eligible sector with a real cabin seat.
      await sqlRows(
        "UPDATE flights f JOIN airports o ON o.id=f.originId SET f.departureTime=UTC_TIMESTAMP()+INTERVAL 12 HOUR, f.arrivalTime=UTC_TIMESTAMP()+INTERVAL 14 HOUR, f.destinationId=(SELECT a.id FROM airports a WHERE a.country=o.country AND a.id<>o.id ORDER BY a.id LIMIT 1) WHERE f.id=?",
        [flightId]
      );
      const mapName = "AT02 " + randomUUID();
      await sqlRows(
        "INSERT INTO seat_maps(aircraftType,airlineId,configName,cabinLayout,totalSeats,economySeats,businessSeats) SELECT aircraftType,airlineId,?,'[]',1,?,? FROM flights WHERE id=?",
        [
          mapName,
          Number(cabinClass === "economy"),
          Number(cabinClass === "business"),
          flightId,
        ]
      );
      await sqlRows(
        "INSERT INTO seat_inventory(flightId,seatMapId,seatNumber,`row`,`column`,cabinClass,seatType,priceTier,seatPrice) SELECT ?,id,'1A',1,'A',?,'window','free',0 FROM seat_maps WHERE configName=?",
        [flightId, cabinClass, mapName]
      );
      const booking = await client.bookings.create.mutate({
        flightId,
        cabinClass,
        sessionId: randomUUID(),
        passengers: [{ firstName, lastName: "Baggage", type: "adult" }],
        ancillaries:
          cabinClass === "economy"
            ? [
                {
                  ancillaryServiceId: bag.id,
                  passengerIndex: 0,
                  segmentIndex: 0,
                  quantity: 1,
                  unitPrice: bag.price,
                  totalPrice: bag.price,
                },
              ]
            : [],
      });
      await sqlRows(
        "INSERT INTO user_credits(userId,amount,source) VALUES (?,?,'promo')",
        [user.id, booking.totalAmount]
      );
      await client.vouchers.useCredits.mutate({
        bookingId: booking.bookingId,
        amount: booking.totalAmount,
      });
      const [pax] = await client.bookings.getPassengers.query({
        bookingId: booking.bookingId,
      });
      await page.goto("/my-bookings");
      const card = page
        .locator('[data-slot="card"]')
        .filter({ hasText: booking.bookingReference });
      const allowance = card.getByRole("region", { name: "Baggage allowance" });
      await expect(allowance).toContainText(
        `Segment 1: ${totalKg} kg verified`
      );
      await expect(allowance).toContainText("Maximum per bag: 32 kg");
      const downloading = page.waitForEvent("download");
      await card
        .getByRole("button", {
          name: `Download e-ticket for ${firstName} Baggage`,
        })
        .click();
      const download = await downloading;
      expect(download.suggestedFilename()).toBe(
        `itinerary_${booking.bookingId}_${pax.id}.pdf`
      );
      const path = await download.path();
      if (!path) throw new Error("E-ticket download unavailable");
      const { stdout } = await promisify(execFile)("pdftotext", [path, "-"]);
      expect(stdout).toContain(
        cabinClass === "business"
          ? "Baggage: 32 kg total, max 32 kg per bag"
          : "Baggage: 43 kg total (includes 20 kg extra), max 32 kg per bag"
      );
      await client.bookings.checkIn.mutate({
        bookingId: booking.bookingId,
        flightId,
        seatAssignments: [{ passengerId: pax.id, seatNumber: "1A" }],
      });
      const pass = await client.boardingPass.issue.mutate({
        bookingId: booking.bookingId,
        passengerId: pax.id,
        flightId,
      });
      const admission = await client.bagDrop.scanPass.mutate({
        boardingPassToken: pass.token,
      });
      const session = await client.bagDrop.initiate.mutate({
        capabilityToken: admission.capabilityToken,
      });
      const allowed = await client.bagDrop.checkAllowance.query({
        sessionToken: session.sessionToken,
      });
      expect(allowed).toMatchObject({
        cabinClass,
        allowanceWeightGrams: totalKg * 1000,
        maxBagWeightGrams: 32000,
      });
      fixtures.push({
        bookingId: booking.bookingId,
        passengerId: pax.id,
        totalKg,
      });
    }
    await useBrowserSession(page, "admin");
    await page.goto("/admin/bag-drop");
    for (const { bookingId, passengerId, totalKg } of fixtures) {
      await page
        .getByLabel("Booking ID", { exact: true })
        .fill(String(bookingId));
      await page
        .getByLabel("Passenger ID", { exact: true })
        .fill(String(passengerId));
      const summary = page.getByRole("region", { name: "Baggage allowance" });
      await expect(summary).toContainText(`Segment 1: ${totalKg} kg verified`);
      await expect(summary).toContainText("Maximum per bag: 32 kg");
    }
  });
}
