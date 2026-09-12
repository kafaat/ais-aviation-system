import { createHmac } from "node:crypto";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { transactionMemory } from "./helpers/transaction-memory";
const boundary = vi.hoisted(() => ({ db: null as any }));
vi.mock("../db", () => ({ getDb: () => boundary.db }));
import {
  carbonFromEvidence,
  carbonEvidenceSchema,
  travelRuleSchema,
} from "../services/travel-evidence-policy";
import {
  ingestTravelEvidence,
  sourcedCarbon,
  sourcedTravelRequirements,
} from "../services/travel-evidence.service";
import {
  getClearanceContext,
  ingestTravelClearance,
  assertTravelClearance,
} from "../services/travel-clearance.service";
import { calculateRequestHash } from "../services/idempotency-v2.service";
import type { EvidenceEnvelope } from "../services/aviation-evidence.service";
let fixture: ReturnType<typeof transactionMemory>, seq: number;
const departure = new Date(Date.now() + 86400000);
const carbon = {
  method: "operator-model",
  version: "1",
  reference: "https://example.org/method",
  basis: "estimated" as const,
  validUntil: new Date(Date.now() + 2 * 86400000).toISOString(),
  originId: 1,
  destinationId: 2,
  departureTime: departure.toISOString(),
  distanceKm: 500,
  fuelKg: 1000,
  co2KgPerFuelKg: 3,
  passengerFuelShare: 0.8,
  economyEquivalentPassengers: 120,
  businessWeight: 2,
};
beforeEach(() => {
  seq = 0;
  fixture = transactionMemory({
    flights: [
      {
        id: 11,
        airlineId: 1,
        tenantId: 3,
        originId: 1,
        destinationId: 2,
        departureTime: departure,
        arrivalTime: new Date(departure.getTime() + 3600000),
        status: "scheduled",
      },
    ],
    airports: [
      { id: 1, code: "AAA", city: "A", country: "SA" },
      { id: 2, code: "BBB", city: "B", country: "AE" },
    ],
    bookings: [{ id: 7, userId: 1, tenantId: 3, flightId: 11 }],
    passengers: [
      {
        id: 8,
        bookingId: 7,
        firstName: "Test",
        lastName: "Traveler",
        nationality: "SA",
        passportNumber: "P123456",
        passportExpiry: new Date("2030-01-01"),
      },
    ],
  });
  boundary.db = fixture.db;
  vi.stubEnv("TRAVEL_TEST_KEY", "test-only-source-key-32-characters");
  vi.stubEnv(
    "AVIATION_SOURCE_REGISTRY",
    JSON.stringify([
      {
        sourceId: "provider",
        tenantId: 3,
        airlineIds: [1],
        capabilities: ["carbon", "travel_rules", "travel_clearance"],
        secretEnv: "TRAVEL_TEST_KEY",
        validUntil: "2030-01-01T00:00:00Z",
      },
    ])
  );
});
afterEach(() => vi.unstubAllEnvs());
function event(kind: string, payload: Record<string, unknown>) {
  const envelope: EvidenceEnvelope = {
    sourceId: "provider",
    eventId: `travel-${++seq}`,
    issuedAt: new Date().toISOString(),
    observedAt: new Date(Date.now() - 10000 + seq * 100).toISOString(),
    flightId: 11,
    kind,
    payload,
  };
  return {
    envelope,
    signature: createHmac("sha256", "test-only-source-key-32-characters")
      .update(calculateRequestHash(envelope))
      .digest("hex"),
  };
}
describe("sourced carbon and documents", () => {
  it("keeps unavailable emissions unknown and uses explicit fuel allocation", async () => {
    expect((await sourcedCarbon(11)).co2Economy).toBeNull();
    expect(carbonFromEvidence(carbon)).toEqual({
      co2Economy: 20,
      co2Business: 40,
    });
    const e = event("carbon", carbon);
    await ingestTravelEvidence(e.envelope, e.signature);
    expect(await sourcedCarbon(11)).toMatchObject({
      co2Economy: 20,
      co2Business: 40,
      offsetCostSAR: null,
      treesEquivalent: null,
    });
    expect(() =>
      carbonEvidenceSchema.parse({ ...carbon, economyEquivalentPassengers: 0 })
    ).toThrow();
  });
  it("does not infer visa freedom without a matching traveler context", async () => {
    const profile = {
      nationality: "SA",
      residenceCountry: null,
      documentType: "passport",
      purpose: "tourism",
      stayDays: 7,
      dateOfBirth: null,
      transitAirportIds: [],
    };
    const p = travelRuleSchema.parse({
      profile,
      version: "operator-v1",
      reference: "https://example.org/rule",
      providerTransactionId: "synthetic",
      validUntil: carbon.validUntil,
      departureTime: departure.toISOString(),
      destinationId: 2,
      visaRequired: false,
      visaOnArrival: false,
      passportValidUntil: "2027-01-01",
      covidTestRequired: false,
      notes: [],
    });
    const e = event("travel_rules", p);
    await ingestTravelEvidence(e.envelope, e.signature);
    expect(
      (await sourcedTravelRequirements(11)).requirements.visaRequired
    ).toBeNull();
    expect(
      (await sourcedTravelRequirements(11, p.profile)).requirements.visaRequired
    ).toBe(false);
    expect(
      (await sourcedTravelRequirements(11, { ...p.profile, nationality: "GB" }))
        .status
    ).toBe("unknown");
  });
  it("binds international clearance to documents and a current provider verdict", async () => {
    await expect(assertTravelClearance(fixture.db, 7, 8)).rejects.toThrow(
      "requires current"
    );
    const c = await getClearanceContext(7, 8, 3);
    const e = event("travel_clearance", {
      bookingId: 7,
      passengerId: 8,
      documentDigest: c.documentDigest,
      itineraryDigest: c.itineraryDigest,
      verdict: "cleared",
      validUntil: carbon.validUntil,
      providerTransactionId: "clear-1",
      reference: "operator-review",
    });
    await ingestTravelClearance(e.envelope, e.signature);
    expect((await assertTravelClearance(fixture.db, 7, 8)).required).toBe(true);
    const revoked = event("travel_clearance", {
      ...e.envelope.payload,
      verdict: "denied",
      providerTransactionId: "clear-2",
    });
    await ingestTravelClearance(revoked.envelope, revoked.signature);
    await expect(assertTravelClearance(fixture.db, 7, 8)).rejects.toThrow(
      "requires current"
    );
  });
  it("rolls evidence back when the durable event cannot be written", async () => {
    fixture.failInsert("outbox");
    const e = event("carbon", carbon);
    await expect(
      ingestTravelEvidence(e.envelope, e.signature)
    ).rejects.toThrow();
    expect((await sourcedCarbon(11)).co2Economy).toBeNull();
  });
});
