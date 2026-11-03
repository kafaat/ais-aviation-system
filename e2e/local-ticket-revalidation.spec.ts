import { randomUUID } from "node:crypto";
import type { RowDataPacket } from "mysql2";
import { test, expect } from "./fixtures/base-test";
import { useBrowserSession } from "./fixtures/browser-session";
import { fixtureFlight, sqlRows } from "./fixtures/hardening";
import { rpc } from "./fixtures/rpc";

test("owner revalidates an open local coupon to a different date once and recovers its receipt", async ({
  page,
  browser,
}) => {
  await useBrowserSession(page, "reporting");
  const client = rpc(page);
  const user = await client.auth.me.query();
  if (!user) throw new Error("No fixture user");
  const from = await fixtureFlight(user.tenantId);
  const to = await fixtureFlight(user.tenantId);
  const rows = sqlRows<RowDataPacket>;
  const carrier = from.toString(36).toUpperCase().padStart(3, "0");
  await rows(
    "INSERT INTO airlines(code,name) VALUES (?, 'Local date fixture')",
    [carrier]
  );
  await rows(
    "UPDATE flights SET airlineId=(SELECT id FROM airlines WHERE code=?), flightNumber=?, departureTime=TIMESTAMP(DATE(UTC_TIMESTAMP())+INTERVAL 42 DAY, '12:00:00'), arrivalTime=TIMESTAMP(DATE(UTC_TIMESTAMP())+INTERVAL 42 DAY, '14:00:00') WHERE id IN (?,?)",
    [carrier, `R${from}`, from, to]
  );
  await rows(
    "UPDATE flights SET departureTime=departureTime+INTERVAL 7 DAY, arrivalTime=arrivalTime+INTERVAL 7 DAY WHERE id=?",
    [to]
  );
  await rows(
    "INSERT INTO fare_classes(airlineId,code,name,cabinClass,fareFamily) SELECT airlineId,'Q','Local Q','economy','Local Flex' FROM flights WHERE id=?",
    [from]
  );
  await rows(
    "INSERT INTO flight_fare_class_inventory(flightId,fareClassId,capacity,availableSeats) SELECT f.id,c.id,8,8 FROM flights f JOIN fare_classes c ON c.airlineId=f.airlineId AND c.code='Q' WHERE f.id IN (?,?)",
    [from, to]
  );
  const offer = await client.priceQuote.createOffer.mutate({
    flightId: from,
    cabinClass: "economy",
    fareClassCode: "Q",
    passengerTypes: ["adult"],
  });
  const booking = await client.bookings.create.mutate({
    flightId: from,
    cabinClass: "economy",
    fareClassCode: "Q",
    offerId: offer.offerId,
    sessionId: randomUUID(),
    idempotencyKey: randomUUID(),
    passengers: [{ firstName: "Local", lastName: "Date", type: "adult" }],
  });
  const bookingId = booking.bookingId;
  await rows(
    "INSERT INTO user_credits(userId,amount,source) VALUES (?,?,'promo')",
    [user.id, booking.totalAmount]
  );
  await client.vouchers.useCredits.mutate({
    bookingId,
    amount: booking.totalAmount,
  });
  const [pax] = await rows("SELECT id FROM passengers WHERE bookingId=?", [
    bookingId,
  ]);
  const change = {
    bookingId,
    replaceFlightId: from,
    newFlightId: to,
    intent: "revalidate" as const,
  };
  // Missing locally issued document must roll back the quote and its capacity hold.
  await expect(
    client.modifications.requestChangeDate.mutate({
      ...change,
      idempotencyKey: randomUUID(),
    })
  ).rejects.toThrow(/local ticket revalidation/i);
  expect(
    await rows("SELECT id FROM booking_modifications WHERE bookingId=?", [
      bookingId,
    ])
  ).toHaveLength(0);
  expect(
    await rows(
      "SELECT id FROM inventory_locks WHERE flightId=? AND status='active'",
      [to]
    )
  ).toHaveLength(0);
  const doc = await client.eticket.generateETicket.mutate({
    bookingId,
    passengerId: pax.id,
  });
  // The catalog price can stay identical while the accepted fare stops permitting
  // a free date change. The original signed offer is still the authority.
  await rows(
    "UPDATE fare_classes c JOIN flights f ON f.airlineId=c.airlineId SET c.changeFee=100 WHERE f.id=? AND c.code='Q'",
    [from]
  );
  await expect(
    client.modifications.requestChangeDate.mutate({
      ...change,
      idempotencyKey: randomUUID(),
    })
  ).rejects.toThrow(/local ticket revalidation/i);
  await rows(
    "UPDATE fare_classes c JOIN flights f ON f.airlineId=c.airlineId SET c.changeFee=0 WHERE f.id=? AND c.code='Q'",
    [from]
  );
  expect(
    await rows("SELECT id FROM booking_modifications WHERE bookingId=?", [
      bookingId,
    ])
  ).toHaveLength(0);
  const getCoupon = () =>
    rows(
      "SELECT id, ticketNumber, couponNumber, status, flightId FROM ticket_coupons WHERE bookingId=?",
      [bookingId]
    );
  const getInvoice = () =>
    rows(
      "SELECT id, passengerId, bookingSegmentId, componentType, amount, sourceReference, reversedAt FROM booking_fare_components WHERE bookingId=? ORDER BY id",
      [bookingId]
    );
  const capacity = () =>
    rows(
      "SELECT f.id,f.economyAvailable,r.availableSeats FROM flights f JOIN flight_fare_class_inventory r ON r.flightId=f.id WHERE f.id IN (?,?) ORDER BY f.id",
      [from, to]
    );
  const [originalCoupon] = await getCoupon();
  const originalFare = await getInvoice();
  const before = await capacity();
  const foreign = await browser.newPage();
  try {
    await useBrowserSession(foreign, "regular");
    await expect(
      rpc(foreign).modifications.requestChangeDate.mutate({
        ...change,
        idempotencyKey: randomUUID(),
      })
    ).rejects.toThrow(/not found/i);
  } finally {
    await foreign.close();
  }
  const flight = await client.flights.getById.query({ id: to });
  if (!flight) throw new Error("Replacement unavailable");
  const date = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: flight.origin.timezone ?? "UTC",
  }).format(flight.departureTime);
  await page.goto(`/my-bookings?exchange=${bookingId}`);
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Revalidate local ticket" }).click();
  await dialog.getByLabel("New departure date").fill(date);
  await dialog
    .getByRole("button", { name: new RegExp(flight.flightNumber) })
    .click();
  await dialog.getByRole("button", { name: "Quote change" }).click();
  await expect(dialog.getByText(new RegExp(doc.ticketNumber))).toBeVisible();
  const quote = (
    await client.modifications.exchangeContext.query({ bookingId })
  ).latest;
  if (!quote?.revalidation) throw new Error("No revalidation quote");
  expect(quote.totalCost).toBe(0);
  // Simulate a DCS writer changing O to C while the customer reads the quote.
  await rows("UPDATE ticket_coupons SET status='C' WHERE id=?", [
    originalCoupon.id,
  ]);
  const confirm = { modificationId: quote.modificationId };
  await expect(
    client.ndc.confirmNoChargeService.mutate(confirm)
  ).rejects.toThrow(/local ticket revalidation/i);
  expect(await capacity()).toEqual(before);
  expect(await getCoupon()).toEqual([{ ...originalCoupon, status: "C" }]);
  await rows("UPDATE ticket_coupons SET status='O' WHERE id=?", [
    originalCoupon.id,
  ]);
  await dialog
    .getByLabel("I accept this itinerary change", { exact: false })
    .check();
  await page.route("**/api/trpc/*confirmNoChargeService*", async route => {
    const result = await route.fetch();
    expect(result.ok()).toBe(true);
    await route.abort("failed");
  });
  await dialog.getByRole("button", { name: "Accept this quote" }).click();
  await expect(dialog.getByRole("alert")).toHaveText(
    /last result could not be verified/
  );
  await dialog.getByRole("button", { name: "Check operation status" }).click();
  await expect(dialog.getByText(/Local ticket revalidated/)).toBeVisible();
  const recovered = (
    await client.modifications.exchangeContext.query({ bookingId })
  ).latest;
  expect(recovered?.receiptId).toBeTruthy();
  const replay = await client.ndc.confirmNoChargeService.mutate(confirm);
  expect(replay.receiptId).toBe(recovered?.receiptId);
  const history = await client.modifications.getDetails.query(confirm);
  expect(history.executionEventId).toBe(replay.receiptId);
  expect(history.revalidation).toEqual(recovered?.revalidation);
  expect(await getCoupon()).toEqual([{ ...originalCoupon, flightId: to }]);
  expect(await getInvoice()).toEqual(originalFare);
  expect(await capacity()).toEqual(
    before.map(r => ({
      ...r,
      economyAvailable: r.economyAvailable + (r.id === from ? 1 : -1),
      availableSeats: r.availableSeats + (r.id === from ? 1 : -1),
    }))
  );
  expect(
    await rows("SELECT id FROM financial_ledger WHERE bookingId=?", [bookingId])
  ).toHaveLength(1);
  expect(
    await rows(
      "SELECT eventId FROM outbox WHERE aggregateType='booking' AND aggregateId=? AND eventType='order.servicing_applied'",
      [String(bookingId)]
    )
  ).toEqual([{ eventId: replay.receiptId }]);
});
