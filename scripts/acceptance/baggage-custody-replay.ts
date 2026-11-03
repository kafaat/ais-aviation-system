import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import * as s from "../../drizzle/schema";
import type { SettlementTx } from "../../server/services/booking-settlement.service";
import type { EvidenceEnvelope } from "../../server/services/aviation-evidence.service";
import { calculateRequestHash } from "../../server/services/idempotency-v2.service";
import {
  getFlightBaggageCloseout,
  ingestBaggageCustody,
} from "../../server/services/baggage-custody.service";

/** Disposable MySQL only. The station, signed messages and passenger are synthetic. */
export async function verifyBaggageCustodyReplay(
  db: SettlementTx,
  tenantId: number
) {
  const now = Date.now();
  const [{ id: first }, { id: next }] = await db
    .insert(s.flights)
    .values(
      [0, 1].map(i => ({
        airlineId: tenantId,
        tenantId,
        flightNumber: `ZY88${i}`,
        originId: tenantId + i,
        destinationId: tenantId + i + 1,
        departureTime: new Date(now + i * 3_600_000),
        arrivalTime: new Date(now + (i + 1) * 3_600_000),
        economySeats: 10,
        businessSeats: 2,
        economyPrice: 1000,
        businessPrice: 2000,
        economyAvailable: 9,
        businessAvailable: 2,
      }))
    )
    .$returningId();
  const [{ id: bookingId }] = await db
    .insert(s.bookings)
    .values({
      tenantId,
      userId: tenantId,
      flightId: first,
      bookingReference: "BAGT01",
      pnr: "BAGT01",
      cabinClass: "economy",
      numberOfPassengers: 1,
      totalAmount: 2000,
      paymentStatus: "paid",
      status: "confirmed",
      seatsReserved: true,
    })
    .$returningId();
  const [{ id: passengerId }] = await db
    .insert(s.passengers)
    .values({
      tenantId,
      bookingId,
      firstName: "Synthetic",
      lastName: "Bag",
    })
    .$returningId();
  await db.insert(s.bookingSegments).values(
    [first, next].map((flightId, i) => ({
      bookingId,
      flightId,
      segmentOrder: i + 1,
      status: "confirmed" as const,
      seatsReserved: true,
      departureDate: new Date(now + i * 3_600_000),
    }))
  );
  const tagNumber = "0000000001";
  const [{ id: bagId }] = await db
    .insert(s.baggageItems)
    .values({ bookingId, passengerId, tagNumber, weight: "10.00" })
    .$returningId();
  const key = "synthetic-only-station-signing-material";
  const sourceId = "test-baggage-handler";
  const registry = process.env.AVIATION_SOURCE_REGISTRY;
  const oldKey = process.env.AIS_TEST_SCAN_KEY;
  process.env.AIS_TEST_SCAN_KEY = key;
  process.env.AVIATION_SOURCE_REGISTRY = JSON.stringify([
    {
      sourceId,
      tenantId,
      capabilities: ["baggage"],
      deviceIds: ["scanner"],
      airportIds: [tenantId, tenantId + 1, tenantId + 2],
      secretEnv: "AIS_TEST_SCAN_KEY",
      validUntil: new Date(now + 86400000).toISOString(),
    },
  ]);
  let index = 0;
  function event(
    stage: string,
    flightId: number,
    airportId: number,
    previousEvidenceId: number | null
  ): EvidenceEnvelope {
    return {
      kind: "baggage_custody",
      sourceId,
      eventId: `scan-fixture-${++index}`,
      issuedAt: new Date(now).toISOString(),
      observedAt: new Date(now - 60_000 + index * 1_000).toISOString(),
      flightId,
      payload: {
        tagNumber,
        stage,
        airportId,
        previousEvidenceId,
        deviceId: "scanner",
      },
    };
  }
  const submit = (e: EvidenceEnvelope) =>
    ingestBaggageCustody(
      e,
      createHmac("sha256", key).update(calculateRequestHash(e)).digest("hex")
    );
  try {
    const acceptance = event("acceptance", first, tenantId, null);
    const [a, b] = await Promise.all([submit(acceptance), submit(acceptance)]);
    assert.equal(a.evidenceId, b.evidenceId);
    assert.notEqual(a.duplicate, b.duplicate);
    await assert.rejects(
      submit({ ...acceptance, flightId: next }),
      /identity was reused/
    );
    const loaded = await submit(
      event("loading", first, tenantId, a.evidenceId)
    );
    const arrived = await submit(
      event("arrival", first, tenantId + 1, loaded.evidenceId)
    );
    const handover = await submit(
      event("transfer", next, tenantId + 1, arrived.evidenceId)
    );
    const before = await getFlightBaggageCloseout(next, tenantId);
    assert.deepEqual(before.missingLoading, [tagNumber]);
    assert.equal(before.readyToClose, false);
    const loading = event("loading", next, tenantId + 1, handover.evidenceId);
    const [c, d] = await Promise.all([submit(loading), submit(loading)]);
    assert.equal(c.evidenceId, d.evidenceId);
    assert.notEqual(c.duplicate, d.duplicate);
    const closeout = await getFlightBaggageCloseout(next, tenantId);
    assert.equal(closeout.readyToClose, true);
    assert.equal(closeout.loadedBags, 1);
    const events = await db
      .select()
      .from(s.baggageCustodyEvents)
      .where(eq(s.baggageCustodyEvents.baggageId, bagId));
    assert.equal(events.length, 5);
    await db
      .update(s.bookingSegments)
      .set({ status: "cancelled" })
      .where(eq(s.bookingSegments.flightId, next));
    const after = await getFlightBaggageCloseout(next, tenantId);
    assert.equal(after.expectedBags, 0);
    assert.equal(after.unexpectedBags, 1);
    assert.equal(after.readyToClose, false);
    return {
      distinctScans: events.length,
      concurrentRetries: 2,
      changedSectorRefused: true,
      unexpectedAfterCancellation: after.unexpectedBags,
    };
  } finally {
    if (registry === undefined) delete process.env.AVIATION_SOURCE_REGISTRY;
    else process.env.AVIATION_SOURCE_REGISTRY = registry;
    if (oldKey === undefined) delete process.env.AIS_TEST_SCAN_KEY;
    else process.env.AIS_TEST_SCAN_KEY = oldKey;
  }
}
