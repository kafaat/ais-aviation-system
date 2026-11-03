import { randomUUID } from "node:crypto";
import type { RowDataPacket } from "mysql2/promise";
import { test, expect } from "./fixtures/base-test";
import {
  fixtureFlight,
  ownedBooking,
  rpc,
  sqlRows,
} from "./fixtures/hardening";

test("a kiosk passenger retries the same return-sector bag tag after a printer failure", async ({
  page,
}) => {
  const { booking, flightId: outbound } = await ownedBooking(
    page,
    true,
    [
      { firstName: "Synthetic", lastName: "Journey", type: "adult" },
      { firstName: "Test", lastName: "Companion", type: "adult" },
      { firstName: "Related", lastName: "Journey", type: "adult" },
    ],
    "admin"
  );
  const inbound = await fixtureFlight();
  const bookingId = booking.bookingId;
  const [passenger] = await sqlRows<RowDataPacket>(
    "SELECT id FROM passengers WHERE bookingId=? AND firstName='Synthetic' AND lastName='Journey'",
    [bookingId]
  );
  const edit = (query: string, params: (string | number)[]) =>
    sqlRows<RowDataPacket>(query, params);
  // The disposable fixture represents an already checked-in return passenger
  // with one physical bag transferred at JED. No station hardware is involved.
  await edit(
    "UPDATE flights SET departureTime=DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 DAY), arrivalTime=DATE_SUB(UTC_TIMESTAMP(), INTERVAL 22 HOUR), status='completed' WHERE id=?",
    [outbound]
  );
  await edit(
    "UPDATE flights SET originId=(SELECT id FROM airports WHERE code='JED'), destinationId=(SELECT id FROM airports WHERE code='RUH'), departureTime=DATE_ADD(UTC_TIMESTAMP(), INTERVAL 4 HOUR), arrivalTime=DATE_ADD(UTC_TIMESTAMP(), INTERVAL 6 HOUR) WHERE id=?",
    [inbound]
  );
  await edit("DELETE FROM booking_segments WHERE bookingId=?", [bookingId]);
  await edit(
    "INSERT INTO booking_segments (bookingId, segmentOrder, flightId, departureDate, status, seatsReserved) SELECT ?, IF(id=?,1,2), id, departureTime, IF(id=?,'completed','confirmed'), 1 FROM flights WHERE id IN (?,?)",
    [bookingId, outbound, outbound, outbound, inbound]
  );
  await edit(
    "INSERT INTO seat_inventory (flightId,seatMapId,seatNumber,`row`,`column`,cabinClass,seatType,status,bookingId,passengerId,checkedInAt,checkInNonce,boardingSequence) VALUES (?,1,'1A',1,'A','economy','window','checked_in',?,?,UTC_TIMESTAMP(),?,1)",
    [inbound, bookingId, passenger.id, randomUUID()]
  );
  const tagNumber = "0000" + String(inbound).padStart(6, "0");
  await edit(
    "INSERT INTO baggage_items (bookingId,passengerId,tagNumber,weight,status) VALUES (?,?,?,10,'loading')",
    [bookingId, passenger.id, tagNumber]
  );
  const [bag] = await sqlRows<RowDataPacket>(
    "SELECT id FROM baggage_items WHERE tagNumber=?",
    [tagNumber]
  );
  const eventKey = randomUUID();
  await edit(
    "INSERT INTO aviation_evidence(sourceId,sourceEventId,flightId,kind,payload,digest,observedAt) VALUES ('test-station',?,?,'baggage_custody',JSON_OBJECT('stage','transfer','tagNumber',?),SHA2(?,256),UTC_TIMESTAMP())",
    [eventKey, inbound, tagNumber, eventKey]
  );
  await edit(
    "INSERT INTO baggage_custody_events(baggageId,flightId,stage,evidenceId,airportId,deviceId,sourceId,observedAt) SELECT ?,?,'transfer',e.id,f.originId,'test-reader',e.sourceId,e.observedAt FROM aviation_evidence e JOIN flights f ON f.id=e.flightId WHERE e.sourceEventId=?",
    [bag.id, inbound, eventKey]
  );

  // The kiosk uses the passenger's capability and has no account session.
  await page.context().clearCookies();
  await page.goto("/");
  const call = (op: string, input: Record<string, unknown>) =>
    page.evaluate(
      async ({ op, input }) => {
        const response = await fetch("/api/trpc/kiosk." + op, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ json: input }),
        });
        return { status: response.status, body: await response.json() };
      },
      { op, input }
    );
  const auth = await call("authenticate", {
    bookingRef: booking.bookingReference,
    lastName: "Journey",
    flightId: inbound,
  });
  expect(auth.status).toBe(200);
  // Both matched family members can review their own purchases. The
  // differently named companion and unattributed legacy lines remain private.
  const [companion] = await sqlRows<RowDataPacket>(
    "SELECT id FROM passengers WHERE bookingId=? AND lastName='Companion'",
    [bookingId]
  );
  const [relative] = await sqlRows<RowDataPacket>(
    "SELECT id FROM passengers WHERE bookingId=? AND firstName='Related'",
    [bookingId]
  );
  const [service] = await sqlRows<RowDataPacket>(
    "SELECT id FROM ancillary_services ORDER BY id LIMIT 1"
  );
  await edit(
    "INSERT INTO booking_ancillaries (bookingId,passengerId,ancillaryServiceId,unitPrice,totalPrice) VALUES (?,?,?,100,100),(?,?,?,200,200),(?,NULL,?,300,300),(?,?,?,400,400)",
    [
      bookingId,
      passenger.id,
      service.id,
      bookingId,
      companion.id,
      service.id,
      bookingId,
      service.id,
      bookingId,
      relative.id,
      service.id,
    ]
  );
  const scoped = await rpc(page).kiosk.getCheckInData.query({
    capabilityToken: auth.body.result.data.json.capabilityToken,
  });
  expect(scoped.passengers.map(person => person.id).sort()).toEqual(
    [passenger.id, relative.id].sort()
  );
  expect(
    scoped.ancillaries.purchased
      .map(line => [line.passengerId, line.totalPrice])
      .sort()
  ).toEqual(
    [
      [passenger.id, 100],
      [relative.id, 400],
    ].sort()
  );
  const input = {
    capabilityToken: auth.body.result.data.json.capabilityToken,
    passengerId: passenger.id,
    flightId: inbound,
    tagNumbers: [tagNumber],
    bagCount: 1,
  };
  const first = await call("printBagTag", input);
  expect(first.status).toBe(200);
  expect(first.body.result.data.json).toMatchObject({
    printStatus: "document_ready",
    bagTags: [
      {
        tagNumber,
        barcodeData: tagNumber,
        origin: "JED",
        destination: "RUH",
        printedAt: null,
      },
    ],
  });
  expect(await call("printBagTag", input)).toEqual(first);
  expect(
    (await call("printBagTag", { ...input, flightId: outbound })).status
  ).toBeGreaterThanOrEqual(400);
  const receipt = {
    bookingRef: booking.bookingReference,
    lastName: "Journey",
    tagNumber,
  };
  const prepared = await call("reprintRegisteredTag", receipt);
  expect(prepared.status).toBe(200);
  // The exact printable fields are the entire response. A bag receipt
  // provides no reusable session or access to family/private itinerary data.
  expect(prepared.body.result.data.json).toEqual({
    ...first.body.result.data.json,
    documentVersion: expect.stringMatching(/^[a-f0-9]{64}$/),
  });
  for (const invalid of [
    { lastName: "Companion" },
    { bookingRef: "XXXXXX" },
    { tagNumber: "9999999999" },
    { passengerId: passenger.id + 1 },
    { expectedVersion: "0".repeat(64) },
    { flightId: outbound },
  ]) {
    expect(
      (await call("reprintRegisteredTag", { ...receipt, ...invalid })).status
    ).toBeGreaterThanOrEqual(400);
  }
  // Simulate only the local print handoff. All tag lookups, eligibility
  // checks and document generation continue to use the real services.
  await page.addInitScript(() => {
    localStorage.setItem("i18nextLng", "en");
    let requests = 0;
    window.print = () => {
      if (++requests === 1) throw new Error("Print dialog unavailable");
    };
  });
  await page.reload();
  await page.getByRole("link", { name: "Kiosk bag tag reprint" }).click();
  await page.locator("#kiosk-reference").fill(booking.bookingReference);
  await page.locator("#kiosk-surname").fill("Journey");
  await page.getByLabel("10-digit bag tag number").fill(tagNumber);
  await page.getByRole("button", { name: "Find registered tag" }).click();
  const copy = page.getByRole("region", { name: "Registered bag tag copy" });
  await expect(copy).toContainText(tagNumber);
  await expect(copy).toContainText("Journey");
  await expect(copy).toContainText("JED → RUH");
  await expect(
    copy.getByRole("img", { name: "Bag tag barcode" })
  ).toBeVisible();
  const reprint = page.getByRole("button", { name: "Reprint this tag" });
  await reprint.click();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Could not open the print dialog" })
  ).toBeVisible();
  await reprint.click();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Physical printing is unconfirmed" })
  ).toBeVisible();
  await page.getByRole("button", { name: "No tag came out" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "You reported no printed copy" })
  ).toBeVisible();
  await reprint.click();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Physical printing is unconfirmed" })
  ).toBeVisible();
  await expect(copy).toContainText(tagNumber);
  await page.getByRole("button", { name: "Finish and clear" }).click();
  await expect(copy).toHaveCount(0);
  await expect(page.locator("#kiosk-reference")).toHaveValue("");
  const [counts] = await sqlRows<RowDataPacket>(
    "SELECT (SELECT count(*) FROM baggage_items WHERE bookingId=?) AS bags,(SELECT count(*) FROM baggage_custody_events WHERE baggageId=?) AS events,(SELECT count(*) FROM kiosk_sessions WHERE bookingId=? AND sessionType='bag_tag') AS printSessions",
    [bookingId, bag.id, bookingId]
  );
  expect(counts).toMatchObject({ bags: 1, events: 1, printSessions: 0 });
});
