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
  assertBaggageNotInCustody,
  assertPassengerBaggageCanOffload,
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
    baggage_items: [
      { id: 1, bookingId: 7, passengerId: 11, tagNumber: "AIS-BAG" },
    ],
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
  it("blocks the booking only after verified custody, without blocking another booking", async () => {
    await expect(
      assertBaggageNotInCustody(fixture.db, 7)
    ).resolves.toBeUndefined();
    await scan("acceptance", 11, 1, null);
    await expect(assertBaggageNotInCustody(fixture.db, 7)).rejects.toThrow(
      /verified rerouting/
    );
    await expect(
      assertBaggageNotInCustody(fixture.db, 8)
    ).resolves.toBeUndefined();
  });
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
  it("refuses to reuse a device event identity for a different sector", async () => {
    const first = await scan("acceptance", 11, 1, null);
    const changed = { ...first.e, flightId: 12 };
    const signature = createHmac("sha256", "test-only-source-key-32-characters")
      .update(calculateRequestHash(changed))
      .digest("hex");
    await expect(ingestBaggageCustody(changed, signature)).rejects.toThrow(
      "identity was reused"
    );
    expect(fixture.rows("baggage_custody_events")).toHaveLength(1);
  });
  it("routes around cancelled legs and never reports an empty itinerary complete", async () => {
    const actor = { id: 1, role: "user", tenantId: 3 };
    const [firstLeg] = fixture.rows("booking_segments");
    firstLeg.status = "cancelled";
    expect(await getBaggageCustody("AIS-BAG", actor)).toMatchObject({
      complete: false,
      requiredPoints: 3,
    });
    await expect(scan("acceptance", 11, 1, null)).rejects.toThrow("not routed");
    await scan("acceptance", 12, 2, null);
    fixture.rows("booking_segments")[1].status = "cancelled";
    expect(await getBaggageCustody("AIS-BAG", actor)).toMatchObject({
      complete: false,
      requiredPoints: 0,
    });
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
  it("does not silently extend a scoped registration onto an onward flight", async () => {
    Object.assign(fixture.rows("baggage_items")[0], {
      flightId: 11,
      segmentId: 1,
    });
    fixture.rows("booking_segments").forEach(leg => {
      leg.status = "confirmed";
    });
    let receipt = (await scan("acceptance", 11, 1, null)).result;
    receipt = (await scan("loading", 11, 1, receipt.evidenceId)).result;
    receipt = (await scan("arrival", 11, 2, receipt.evidenceId)).result;
    expect(
      await getBaggageCustody("AIS-BAG", { id: 1, role: "user", tenantId: 3 })
    ).toMatchObject({ complete: true, requiredPoints: 3, verifiedPoints: 3 });
    await expect(scan("transfer", 12, 2, receipt.evidenceId)).rejects.toThrow(
      /not routed/
    );
    expect(fixture.rows("baggage_custody_events")).toHaveLength(3);
  });
  it("accepts a second-sector-only bag at that sector's origin", async () => {
    Object.assign(fixture.rows("baggage_items")[0], {
      flightId: 12,
      segmentId: 2,
    });
    fixture.rows("booking_segments").forEach(leg => {
      leg.status = "confirmed";
    });
    await scan("acceptance", 12, 2, null);
    const custody = await getBaggageCustody("AIS-BAG", {
      id: 1,
      role: "user",
      tenantId: 3,
    });
    expect(custody.required).toEqual([
      { flightId: 12, stage: "acceptance", observed: true },
      { flightId: 12, stage: "loading", observed: false },
      { flightId: 12, stage: "arrival", observed: false },
    ]);
  });
  it("rejects partial physical baggage scope before persisting source evidence", async () => {
    Object.assign(fixture.rows("baggage_items")[0], {
      flightId: 11,
      segmentId: null,
    });
    await expect(scan("acceptance", 11, 1, null)).rejects.toThrow(/scope/);
    expect(fixture.rows("aviation_evidence")).toHaveLength(0);
  });
  it("rejects a bag whose segment and flight no longer match", async () => {
    Object.assign(fixture.rows("baggage_items")[0], {
      flightId: 11,
      segmentId: 2,
    });
    await expect(scan("acceptance", 11, 1, null)).rejects.toThrow(/scope/);
    expect(fixture.rows("aviation_evidence")).toHaveLength(0);
  });
  it("blocks passenger offload after physical counter receipt without requiring a device scan", async () => {
    Object.assign(fixture.rows("baggage_items")[0], {
      flightId: 11,
      segmentId: 1,
      status: "checked_in",
    });
    await expect(
      assertPassengerBaggageCanOffload(fixture.db, {
        bookingId: 7,
        passengerId: 11,
        flightId: 11,
      })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(fixture.rows("baggage_custody_events")).toHaveLength(0);
  });
  it("does not interpret a mutable claimed/lost status as a verified return", async () => {
    Object.assign(fixture.rows("baggage_items")[0], {
      flightId: 11,
      segmentId: 1,
      status: "claimed",
    });
    await expect(
      assertPassengerBaggageCanOffload(fixture.db, {
        bookingId: 7,
        passengerId: 11,
        flightId: 11,
      })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });
  it("allows another passenger and an explicitly different flight while refusing ambiguous legacy baggage", async () => {
    const key = { bookingId: 7, passengerId: 11, flightId: 11 };
    await expect(
      assertPassengerBaggageCanOffload(fixture.db, key)
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await expect(
      assertPassengerBaggageCanOffload(fixture.db, { ...key, passengerId: 12 })
    ).resolves.toBeUndefined();
    Object.assign(fixture.rows("baggage_items")[0], {
      flightId: 12,
      segmentId: 2,
    });
    await expect(
      assertPassengerBaggageCanOffload(fixture.db, key)
    ).resolves.toBeUndefined();
  });
  it("does not hide current-flight custody behind inconsistent other-flight metadata", async () => {
    await scan("acceptance", 11, 1, null);
    Object.assign(fixture.rows("baggage_items")[0], {
      flightId: 12,
      segmentId: 2,
    });
    await expect(
      assertPassengerBaggageCanOffload(fixture.db, {
        bookingId: 7,
        passengerId: 11,
        flightId: 11,
      })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });
});

describe("signed origin baggage recovery", () => {
  function recoveryFixture() {
    const sources = JSON.parse(process.env.AVIATION_SOURCE_REGISTRY!);
    sources[0].capabilities.push("baggage_recovery");
    sources[0].airlineIds = [8];
    vi.stubEnv("AVIATION_SOURCE_REGISTRY", JSON.stringify(sources));
    Object.assign(fixture.rows("flights")[0], {
      airlineId: 8,
      status: "scheduled",
    });
    Object.assign(fixture.rows("baggage_items")[0], {
      flightId: 11,
      segmentId: 1,
      createdAt: new Date(Date.now() - 3600000),
    });
    fixture.rows("booking_segments")[0].status = "confirmed";
  }
  it("requires signed unloading before returning a loaded bag, rejects reuse and then allows offload", async () => {
    recoveryFixture();
    const key = { flightId: 11, bookingId: 7, passengerId: 11 };
    const accepted = await scan("acceptance", 11, 1, null);
    const loaded = await scan("loading", 11, 1, accepted.result.evidenceId);
    await expect(
      scan("return", 11, 1, loaded.result.evidenceId)
    ).rejects.toThrow(/handover/);
    const unloaded = await scan("unloading", 11, 1, loaded.result.evidenceId);
    await expect(
      assertPassengerBaggageCanOffload(fixture.db, key)
    ).rejects.toThrow();
    const returned = await scan("return", 11, 1, unloaded.result.evidenceId);
    expect(fixture.rows("baggage_items")[0].returnEvidenceId).toBe(
      returned.result.evidenceId
    );
    await expect(
      assertPassengerBaggageCanOffload(fixture.db, key)
    ).resolves.toBeUndefined();
    await expect(
      ingestBaggageCustody(returned.e, returned.signature)
    ).resolves.toMatchObject({ duplicate: true });
    await expect(
      scan("loading", 11, 1, returned.result.evidenceId)
    ).rejects.toThrow(/retired/);
  });
  it("refuses ordinary scanners, the wrong airport and unscoped historical bags", async () => {
    await expect(scan("return", 11, 1, null)).rejects.toThrow(/authorized/);
    recoveryFixture();
    await expect(scan("return", 11, 2, null)).rejects.toThrow();
    fixture.rows("baggage_items")[0].segmentId = null;
    await expect(scan("return", 11, 1, null)).rejects.toThrow();
    expect(fixture.rows("baggage_custody_events")).toHaveLength(0);
  });
});
