import { randomUUID } from "node:crypto";
import mysql, { type RowDataPacket } from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import * as schema from "../drizzle/schema";
import type { SettlementTx } from "../server/services/booking-settlement.service";
import { issueSelfServiceCapability } from "../server/services/self-service-capability.service";
import { disposableDatabaseUrl } from "./disposable-database";
import { test, expect } from "./fixtures/base-test";
import { useBrowserSession } from "./fixtures/browser-session";
import { ownedBooking, rpc, sqlRows } from "./fixtures/hardening";

// The provider has no live endpoint in the disposable lab. Supply the verified
// event to the same transactional handler used by its webhook.
async function settleFixtureEvent(
  databaseUrl: string,
  settle: (tx: SettlementTx) => Promise<unknown>
) {
  const connection = await mysql.createConnection(databaseUrl);
  try {
    const db = drizzle(connection, { schema, mode: "default" });
    await db.transaction(settle);
  } finally {
    await connection.end();
  }
}

test("AT-03 rejects new baggage across channels before check-in, after offload, above allowance and after cancellation", async ({
  page,
}) => {
  test.setTimeout(120000);
  const databaseUrl = disposableDatabaseUrl();
  const { settleVerifiedPayment, settleVerifiedRefund } =
    await import("../server/services/payment-settlement.service");
  const { booking, flightId, userId } = await ownedBooking(
    page,
    false,
    undefined,
    "departurePassenger"
  );
  const bookingId = booking.bookingId;
  const [operator] = await sqlRows<RowDataPacket>(
    "SELECT tenantId FROM users WHERE role='ops' AND email='test.ops@example.com'"
  );
  expect(operator.tenantId).toBeGreaterThan(0);
  // Supply the operator's synthetic domestic flight, departure clock and seat.
  // Passenger and staff actions use HTTP; payment events use local settlement.
  await sqlRows(
    "UPDATE flights SET tenantId=?,originId=(SELECT id FROM airports WHERE code='JED'),destinationId=(SELECT id FROM airports WHERE code='RUH'),departureTime=NOW()+INTERVAL 10 HOUR,arrivalTime=NOW()+INTERVAL 12 HOUR WHERE id=?",
    [operator.tenantId, flightId]
  );
  await sqlRows("UPDATE bookings SET tenantId=? WHERE id=?", [
    operator.tenantId,
    bookingId,
  ]);
  await sqlRows("UPDATE passengers SET tenantId=? WHERE bookingId=?", [
    operator.tenantId,
    bookingId,
  ]);
  const paymentIntentId = "pi_at03_" + randomUUID();
  await settleFixtureEvent(databaseUrl, tx =>
    settleVerifiedPayment(tx, {
      paymentIntentId,
      amount: booking.totalAmount,
      currency: "sar",
      metadata: { bookingId: String(bookingId), userId: String(userId) },
      eventId: "evt_at03_" + randomUUID(),
    })
  );
  const mapName = "AT03 " + randomUUID();
  await sqlRows(
    "INSERT INTO seat_maps(aircraftType,airlineId,configName,cabinLayout,totalSeats,economySeats) SELECT aircraftType,airlineId,?,'[]',1,1 FROM flights WHERE id=?",
    [mapName, flightId]
  );
  await sqlRows(
    "INSERT INTO seat_inventory(flightId,seatMapId,seatNumber,`row`,`column`,cabinClass,seatType,priceTier,seatPrice) SELECT ?,id,'1A',1,'A','economy','window','free',0 FROM seat_maps WHERE configName=?",
    [flightId, mapName]
  );
  const [scope] = await sqlRows<
    RowDataPacket & { passengerId: number; segmentId: number }
  >(
    "SELECT p.id AS passengerId,s.id AS segmentId FROM passengers p JOIN booking_segments s ON s.bookingId=p.bookingId WHERE p.bookingId=? AND s.flightId=?",
    [bookingId, flightId]
  );
  const { passengerId, segmentId } = scope;
  const passenger = { bookingId, passengerId, flightId };
  const client = rpc(page);
  const kiosk = await client.kiosk.authenticate.mutate({
    bookingRef: booking.bookingReference,
    lastName: "Journey",
    flightId,
  });
  const reprint = (tagNumber: string) =>
    client.kiosk.printBagTag.mutate({
      capabilityToken: kiosk.capabilityToken,
      passengerId,
      flightId,
      bagCount: 1,
      tagNumbers: [tagNumber],
    });
  const register = (weight: number) =>
    client.baggage.register.mutate({
      ...passenger,
      segmentId,
      weight,
      idempotencyKey: randomUUID(),
    });
  const checkIn = () =>
    client.dcsOperations.checkIn.mutate({
      ...passenger,
      seatNumber: "1A",
      reason: "AT-03 counter check-in",
      idempotencyKey: randomUUID(),
    });
  const counts = async () =>
    (
      await sqlRows<RowDataPacket>(
        `SELECT (SELECT COUNT(*) FROM baggage_items WHERE bookingId=?) AS bags,
     (SELECT COUNT(*) FROM baggage_tracking t JOIN baggage_items b ON b.id=t.baggageId WHERE b.bookingId=?) AS tracking,
     (SELECT COUNT(*) FROM baggage_custody_events e JOIN baggage_items b ON b.id=e.baggageId WHERE b.bookingId=?) AS custody,
     (SELECT COUNT(*) FROM bag_drop_sessions WHERE bookingId=?) AS dropSessions,
     (SELECT COUNT(*) FROM bag_drop_tags t JOIN bag_drop_sessions s ON s.id=t.sessionId WHERE s.bookingId=?) AS dropTags`,
        [bookingId, bookingId, bookingId, bookingId, bookingId]
      )
    )[0];

  const notCheckedIn = /check(?:ed)?[ -]in/i;
  await expect(client.boardingPass.issue.mutate(passenger)).rejects.toThrow(
    notCheckedIn
  );
  await expect(reprint("0000000000")).rejects.toThrow(notCheckedIn);
  // The kiosk lookup succeeds for the paid passenger, but its session cannot
  // serve as a boarding pass for the scanner.
  await expect(
    client.bagDrop.scanPass.mutate({ boardingPassToken: kiosk.capabilityToken })
  ).rejects.toMatchObject({ data: { code: "UNAUTHORIZED" } });
  // Independently exercise the session's live seat check with a correctly
  // signed test admission. No check-in or boarding pass has ever been issued.
  const uncheckedAdmission = issueSelfServiceCapability({
    kind: "bag-drop-admission",
    ...passenger,
    passDigest: "0".repeat(64),
  });
  await expect(
    client.bagDrop.initiate.mutate({ capabilityToken: uncheckedAdmission })
  ).rejects.toThrow(notCheckedIn);

  await useBrowserSession(page, "ops");
  await expect(register(1)).rejects.toThrow(notCheckedIn);
  await page.addInitScript(() => localStorage.setItem("i18nextLng", "en"));
  const openDesk = async () => {
    await page.goto("/airline/dcs");
    await page
      .getByRole("combobox", { name: "Flight", exact: true })
      .selectOption(String(flightId));
    await page
      .getByRole("button", { name: "Select Synthetic Journey" })
      .click();
  };
  const desk = page.getByRole("region", {
    name: "Passenger baggage registration",
  });
  await openDesk();
  await expect(
    page.getByRole("combobox", { name: "Passenger action", exact: true })
  ).toHaveValue("check_in");
  await expect(
    desk.getByText(/available after passenger check-in/i)
  ).toBeVisible();
  await desk.getByLabel("Bag weight in kilograms").fill("1");
  await expect(
    desk.getByRole("button", { name: "Register received bag" })
  ).toBeDisabled();
  expect(await counts()).toMatchObject({
    bags: 0,
    tracking: 0,
    custody: 0,
    dropSessions: 0,
    dropTags: 0,
  });
  await checkIn();
  await useBrowserSession(page, "departurePassenger");
  const oldPass = await client.boardingPass.issue.mutate(passenger);
  const oldAdmission = await client.bagDrop.scanPass.mutate({
    boardingPassToken: oldPass.token,
  });
  await useBrowserSession(page, "ops");
  await client.dcsOperations.transition.mutate({
    ...passenger,
    action: "offload",
    reason: "AT-03 customer offloaded before any bag was received",
    idempotencyKey: randomUUID(),
  });
  await expect(register(1)).rejects.toThrow(/check(?:ed)?[ -]in|offload/i);
  await expect(reprint("0000000000")).rejects.toThrow(
    /check(?:ed)?[ -]in|offload/i
  );
  await expect(
    client.bagDrop.scanPass.mutate({ boardingPassToken: oldPass.token })
  ).rejects.toMatchObject({ data: { code: "UNAUTHORIZED" } });
  await expect(
    client.bagDrop.initiate.mutate({
      capabilityToken: oldAdmission.capabilityToken,
    })
  ).rejects.toThrow(/check(?:ed)?[ -]in|offload|boarding pass|eligib/i);
  expect(await counts()).toMatchObject({
    bags: 0,
    tracking: 0,
    custody: 0,
    dropTags: 0,
  });

  await checkIn();
  await useBrowserSession(page, "departurePassenger");
  const currentPass = await client.boardingPass.issue.mutate(passenger);
  const admission = await client.bagDrop.scanPass.mutate({
    boardingPassToken: currentPass.token,
  });
  const session = await client.bagDrop.initiate.mutate({
    capabilityToken: admission.capabilityToken,
  });
  const quote = await client.bagDrop.calculateFee.query({
    sessionToken: session.sessionToken,
    totalWeight: 24000,
  });
  expect(quote).toMatchObject({
    allowanceWeightGrams: 23000,
    excessWeightGrams: 1000,
  });
  // These are production-mode APIs with no station scale or belt configured.
  // Quoting excess cannot create a receipt or acknowledge physical acceptance.
  await expect(
    client.bagDrop.weighBag.mutate({
      sessionToken: session.sessionToken,
      weight: 24000,
      bagNumber: 1,
    })
  ).rejects.toThrow(/no verified production adapter/i);
  await expect(
    client.bagDrop.printTag.mutate({
      sessionToken: session.sessionToken,
      bagNumber: 1,
    })
  ).rejects.toThrow(/no verified production adapter/i);
  await expect(
    client.bagDrop.confirm.mutate({ sessionToken: session.sessionToken })
  ).rejects.toThrow(/no verified production adapter/i);
  await expect(
    client.bagDrop.processPayment.mutate({ sessionToken: session.sessionToken })
  ).rejects.toThrow(/verified payment-provider callback/i);

  await useBrowserSession(page, "ops");
  const { baggage } = await register(13);
  await expect(register(11)).rejects.toThrow(/exceeds funded allowance/i);
  await openDesk();
  await expect(
    desk.getByRole("definition").filter({ hasText: /^10 kg$/ })
  ).toBeVisible();
  await desk.getByLabel("Bag weight in kilograms").fill("11");
  await expect(
    desk.getByRole("button", { name: "Register received bag" })
  ).toBeDisabled();
  await expect(reprint(baggage.tagNumber)).rejects.toThrow(
    /unavailable for reprint/i
  );
  expect(await counts()).toMatchObject({
    bags: 1,
    tracking: 1,
    custody: 0,
    dropTags: 0,
  });

  // Materialize a synthetic accepted station observation for the actual desk tag.
  // Reprinting this already-received bag consumes no further allowance.
  const eventKey = randomUUID();
  await sqlRows(
    "INSERT INTO aviation_evidence(sourceId,sourceEventId,flightId,kind,payload,digest,observedAt) VALUES ('at03-station',?,?,'baggage_custody',JSON_OBJECT('stage','acceptance','tagNumber',?),SHA2(?,256),NOW())",
    [eventKey, flightId, baggage.tagNumber, eventKey]
  );
  await sqlRows(
    "INSERT INTO baggage_custody_events(baggageId,flightId,stage,evidenceId,airportId,deviceId,sourceId,observedAt) SELECT ?,?,'acceptance',e.id,f.originId,'at03-reader',e.sourceId,NOW() FROM aviation_evidence e JOIN flights f ON f.id=e.flightId WHERE e.sourceId='at03-station' AND e.sourceEventId=?",
    [baggage.id, flightId, eventKey]
  );
  expect(await reprint(baggage.tagNumber)).toMatchObject({
    printStatus: "document_ready",
    bagTags: [{ tagNumber: baggage.tagNumber, printedAt: null }],
  });
  expect(await counts()).toMatchObject({
    bags: 1,
    tracking: 1,
    custody: 1,
    dropTags: 0,
  });

  // An operator cannot issue an internal-tender refund after check-in. Model a
  // later provider reversal of the very receipt that funded this booking.
  await settleFixtureEvent(databaseUrl, tx =>
    settleVerifiedRefund(tx, {
      paymentIntentId,
      chargeId: "ch_at03_" + randomUUID(),
      amount: booking.totalAmount,
      amountRefunded: booking.totalAmount,
      currency: "sar",
      eventId: "evt_at03_" + randomUUID(),
    })
  );
  const [cancelled] = await sqlRows<RowDataPacket>(
    "SELECT b.status,b.paymentStatus,r.refundedAmount FROM bookings b JOIN payment_receipts r ON r.bookingId=b.id WHERE b.id=? AND r.paymentIntentId=?",
    [bookingId, paymentIntentId]
  );
  expect(cancelled).toMatchObject({
    status: "cancelled",
    paymentStatus: "refunded",
    refundedAmount: booking.totalAmount,
  });
  await expect(register(1)).rejects.toThrow(
    /booking not found|paid reservation|active.*sector|funded/i
  );
  await expect(reprint(baggage.tagNumber)).rejects.toThrow(
    /booking not found|paid reservation|active.*sector/i
  );
  await expect(
    client.bagDrop.scanPass.mutate({ boardingPassToken: currentPass.token })
  ).rejects.toMatchObject({ data: { code: "UNAUTHORIZED" } });
  await expect(
    client.bagDrop.initiate.mutate({
      capabilityToken: admission.capabilityToken,
    })
  ).rejects.toThrow(/booking|reservation|eligib/i);
  expect(await counts()).toMatchObject({
    bags: 1,
    tracking: 1,
    custody: 1,
    dropTags: 0,
  });
});
