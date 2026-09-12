import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { transactionMemory } from "./helpers/transaction-memory";
const boundary = vi.hoisted(() => ({ db: null as any }));
vi.mock("../db", () => ({ getDb: () => boundary.db }));
import { calculateRequestHash } from "../services/idempotency-v2.service";
import {
  ingestBaggageCustody,
  getBaggageCustody,
  validateCustodyTransition,
} from "../services/baggage-custody.service";
import type { EvidenceEnvelope } from "../services/aviation-evidence.service";
let fixture: ReturnType<typeof transactionMemory>;
let sequence: number;
beforeEach(() => {
  sequence = 0;
  vi.stubEnv("BAGGAGE_TEST_KEY", "test-only-source-key-32-characters");
  vi.stubEnv(
    "AVIATION_SOURCE_REGISTRY",
    JSON.stringify([
      {
        sourceId: "handler",
        tenantId: 3,
        capabilities: ["baggage"],
        deviceIds: ["scanner"],
        airportIds: [1, 2, 3],
        secretEnv: "BAGGAGE_TEST_KEY",
        validUntil: "2030-01-01T00:00:00Z",
      },
    ])
  );
  fixture = transactionMemory({
    tenants: [{ id: 3, status: "active" }],
    bookings: [
      {
        id: 7,
        userId: 1,
        tenantId: 3,
        flightId: 11,
        status: "confirmed",
        paymentStatus: "paid",
      },
    ],
    baggage_items: [{ id: 1, bookingId: 7, tagNumber: "AIS-BAG" }],
    booking_segments: [
      { id: 1, bookingId: 7, flightId: 11, segmentOrder: 1 },
      { id: 2, bookingId: 7, flightId: 12, segmentOrder: 2 },
    ],
    flights: [
      {
        id: 11,
        tenantId: 3,
        originId: 1,
        destinationId: 2,
        departureTime: new Date(),
      },
      {
        id: 12,
        tenantId: 3,
        originId: 2,
        destinationId: 3,
        departureTime: new Date(),
      },
    ],
  });
  boundary.db = fixture.db;
});
afterEach(() => vi.unstubAllEnvs());
async function scan(
  stage: string,
  flightId: number,
  airportId: number,
  previousEvidenceId: number | null
) {
  const e: EvidenceEnvelope = {
    sourceId: "handler",
    eventId: `scan-${++sequence}`,
    issuedAt: new Date().toISOString(),
    observedAt: new Date(Date.now() - 60000 + sequence * 1000).toISOString(),
    flightId,
    kind: "baggage_custody",
    payload: {
      tagNumber: "AIS-BAG",
      stage,
      airportId,
      previousEvidenceId,
      deviceId: "scanner",
    },
  };
  const signature = createHmac("sha256", "test-only-source-key-32-characters")
    .update(calculateRequestHash(e))
    .digest("hex");
  return { e, signature, result: await ingestBaggageCustody(e, signature) };
}
describe("baggage handover evidence", () => {
  it("follows acceptance, loading, arrival and transfer across all itinerary legs", async () => {
    let receipt = (await scan("acceptance", 11, 1, null)).result;
    receipt = (await scan("loading", 11, 1, receipt.evidenceId)).result;
    receipt = (await scan("arrival", 11, 2, receipt.evidenceId)).result;
    receipt = (await scan("transfer", 12, 2, receipt.evidenceId)).result;
    receipt = (await scan("loading", 12, 2, receipt.evidenceId)).result;
    const last = await scan("arrival", 12, 3, receipt.evidenceId);
    expect(
      await getBaggageCustody("AIS-BAG", { id: 1, role: "user", tenantId: 3 })
    ).toMatchObject({ complete: true, verifiedPoints: 6, requiredPoints: 6 });
    expect(await ingestBaggageCustody(last.e, last.signature)).toMatchObject({
      duplicate: true,
    });
    expect(fixture.rows("baggage_tracking")).toHaveLength(6);
  });
  it("rejects a missing predecessor and an unrelated journey flight", async () => {
    await expect(scan("loading", 11, 1, null)).rejects.toThrow(/Initial/);
    expect(() =>
      validateCustodyTransition(
        {
          tagNumber: "A",
          stage: "acceptance",
          airportId: 1,
          deviceId: "s",
          previousEvidenceId: null,
        },
        { id: 99, originId: 1, destinationId: 2 },
        undefined,
        [11],
        new Date()
      )
    ).toThrow(/not routed/);
  });
  it("rolls back source evidence if the tracking projection fails", async () => {
    fixture.failInsert("baggage_tracking");
    await expect(scan("acceptance", 11, 1, null)).rejects.toThrow();
    expect(fixture.rows("aviation_evidence")).toHaveLength(0);
    expect(fixture.rows("baggage_custody_events")).toHaveLength(0);
  });
  it("exposes custody evidence only to the owner or a scoped administrator", async () => {
    await expect(
      getBaggageCustody("AIS-BAG", { id: 2, role: "user", tenantId: 3 })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      getBaggageCustody("AIS-BAG", { id: 2, role: "admin", tenantId: 4 })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(
      await getBaggageCustody("AIS-BAG", { id: 1, role: "user", tenantId: 3 })
    ).toMatchObject({ complete: false, verifiedPoints: 0 });
  });
});
