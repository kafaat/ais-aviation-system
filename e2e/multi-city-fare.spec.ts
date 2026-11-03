import type { RowDataPacket } from "mysql2/promise";
import { test, expect } from "./fixtures/base-test";
import { useBrowserSession } from "./fixtures/browser-session";
import { fixtureFlight, rpc, sqlRows } from "./fixtures/hardening";

test("multi-city selects named fares per sector and rejects a stale class without a cabin fallback", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem("i18nextLng", "en"));
  await useBrowserSession(page, "regular");
  const client = rpc(page);
  const outboundId = await fixtureFlight();
  const inboundId = await fixtureFlight();
  const carrier = outboundId.toString(36).toUpperCase().padStart(3, "0");
  await sqlRows(
    "INSERT INTO airlines(code,name) VALUES (?, 'Multi-city fare fixture')",
    [carrier]
  );
  await sqlRows(
    "UPDATE flights SET airlineId=(SELECT id FROM airlines WHERE code=?) WHERE id IN (?,?)",
    [carrier, outboundId, inboundId]
  );
  const outbound = await client.flights.getById.query({ id: outboundId });
  if (!outbound) throw new Error("Missing outbound fixture");
  await sqlRows(
    "UPDATE flights SET originId=?, destinationId=?, departureTime=DATE_ADD(departureTime,INTERVAL 1 DAY), arrivalTime=DATE_ADD(arrivalTime,INTERVAL 1 DAY) WHERE id=?",
    [outbound.destination.id, outbound.origin.id, inboundId]
  );
  const inbound = await client.flights.getById.query({ id: inboundId });
  if (!inbound) throw new Error("Missing inbound fixture");
  for (const [flightId, code, name, multiplier, seats] of [
    [outboundId, "Y", "Outbound Flex", "1.400", 3],
    [inboundId, "M", "Return Saver", "0.800", 3],
    [inboundId, "L", "One seat left", "0.700", 1],
  ] as const) {
    await sqlRows(
      "INSERT INTO fare_classes(airlineId,code,name,cabinClass,fareFamily,basePriceMultiplier) VALUES (?,?,?,'economy',?,?)",
      [outbound.airline.id, code, name, name, multiplier]
    );
    await sqlRows(
      "INSERT INTO flight_fare_class_inventory(flightId,fareClassId,capacity,availableSeats) SELECT ?,id,?,? FROM fare_classes WHERE airlineId=? AND code=?",
      [flightId, seats, seats, outbound.airline.id, code]
    );
  }
  const search = new URLSearchParams({
    segments: JSON.stringify(
      [outbound, inbound].map(flight => ({
        originId: flight.origin.id,
        destinationId: flight.destination.id,
        departureDate: flight.departureTime.toISOString().slice(0, 10),
      }))
    ),
  });
  await page.goto("/multi-city?" + search);
  const first = page.getByRole("button", { name: /Outbound Flex · Y/ });
  const last = page.getByRole("button", { name: /Return Saver · M/ });
  await expect(
    page.getByRole("button", { name: /One seat left/ })
  ).toBeVisible();
  await page.getByRole("combobox", { name: /^Passengers/ }).selectOption("2");
  await first.click();
  await last.click();
  await expect(first).toHaveAttribute("aria-pressed", "true");
  await expect(last).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: /One seat left/ })).toHaveCount(
    0
  );
  await page.getByLabel("Passenger Type 2").selectOption("child");
  const segments = [
    {
      flightId: outboundId,
      cabinClass: "economy" as const,
      fareClassCode: "Y",
    },
    { flightId: inboundId, cabinClass: "economy" as const, fareClassCode: "M" },
  ];
  const quote = await client.multiCity.calculatePrice.query({
    segments,
    passengerCount: 2,
    passengerTypes: ["adult", "child"],
  });
  const continueButton = page.getByRole("button", {
    name: "Continue to Booking",
  });
  await expect(page.getByTestId("multi-city-quoted-total")).toContainText(
    (quote.totalPrice / 100).toLocaleString("en-US")
  );
  await continueButton.click();
  await expect(page).toHaveURL(/\/booking\/multi-city\?/);
  const handoff = JSON.parse(new URL(page.url()).searchParams.get("data")!);
  expect(
    handoff.segments.map(
      (item: { fareClassCode: string }) => item.fareClassCode
    )
  ).toEqual(["Y", "M"]);
  const submit = page.getByRole("button", { name: "Book Now" });
  async function enterNames() {
    await expect(
      page.getByRole("combobox", { name: /Passenger Type/ }).nth(1)
    ).toHaveValue("child");
    for (const [index, firstName] of ["Synthetic", "Second"].entries()) {
      await page
        .getByLabel("First Name", { exact: true })
        .nth(index)
        .fill(firstName);
      await page
        .getByLabel("Last Name", { exact: true })
        .nth(index)
        .fill("Passenger");
    }
    await expect(submit).toBeEnabled();
  }
  await enterNames();
  await sqlRows(
    "UPDATE flight_fare_class_inventory i JOIN fare_classes c ON c.id=i.fareClassId SET i.availableSeats=0 WHERE i.flightId=? AND c.code='M'",
    [inboundId]
  );
  await submit.click();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Booking class unavailable for segment 2" })
  ).toBeVisible();
  await expect(submit).toBeDisabled();
  expect(
    await sqlRows("SELECT id FROM bookings WHERE flightId=?", [outboundId])
  ).toHaveLength(0);
  expect(
    await sqlRows("SELECT id FROM inventory_locks WHERE flightId IN (?,?)", [
      outboundId,
      inboundId,
    ])
  ).toHaveLength(0);
  await sqlRows(
    "UPDATE flight_fare_class_inventory i JOIN fare_classes c ON c.id=i.fareClassId SET i.availableSeats=3 WHERE i.flightId=? AND c.code='M'",
    [inboundId]
  );
  await page.reload();
  await enterNames();
  await submit.click();
  await expect(page).toHaveURL(/\/checkout\/\d+(?:\?|$)/);
  await expect(
    page.getByRole("heading", { name: "Payment pending", exact: true })
  ).toBeVisible();
  const sold = await sqlRows<RowDataPacket>(
    "SELECT s.flightId, c.code, l.fareClassId=s.fareClassId AS matchedHold, l.numberOfSeats, b.totalAmount FROM bookings b JOIN booking_segments s ON s.bookingId=b.id JOIN fare_classes c ON c.id=s.fareClassId JOIN inventory_locks l ON l.id=s.inventoryLockId WHERE b.flightId=? ORDER BY s.segmentOrder",
    [outboundId]
  );
  expect(sold).toEqual(
    segments.map(s => ({
      flightId: s.flightId,
      code: s.fareClassCode,
      matchedHold: 1,
      numberOfSeats: 2,
      totalAmount: quote.totalPrice,
    }))
  );
});
