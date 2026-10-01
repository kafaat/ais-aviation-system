import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { transactionMemory } from "./helpers/transaction-memory";
const boundary = vi.hoisted(() => ({ db: null as any }));
vi.mock("../db", () => ({ getDb: () => boundary.db }));
import { calculateRequestHash } from "../services/idempotency-v2.service";
import {
  evidenceDigest,
  type EvidenceEnvelope,
} from "../services/aviation-evidence.service";
import {
  getFlightEconomics,
  ingestFlightCost,
  readFlightCosts,
} from "../services/flight-economics-evidence.service";

const KEY = "fixture-only-key-32-characters-long";
const sign = (e: EvidenceEnvelope) =>
  createHmac("sha256", KEY).update(calculateRequestHash(e)).digest("hex");
const costs = {
  fuel: 100_000,
  crew: 50_000,
  maintenance: 20_000,
  airport: 10_000,
  navigation: 5_000,
  insurance: 2_000,
  overhead: 3_000,
};
const envelope = (
  overrides: Partial<EvidenceEnvelope> = {}
): EvidenceEnvelope => ({
  sourceId: "erp-close",
  eventId: "close-2026-09-flight-11",
  issuedAt: new Date().toISOString(),
  observedAt: new Date().toISOString(),
  flightId: 11,
  kind: "flight_cost",
  payload: {
    version: "ERP-close-v1",
    reference: "period-2026-09",
    currency: "SAR",
    periodClosed: true,
    routeDistanceKm: 1000,
    costs,
    recognizedRevenueMinor: 300_000,
  },
  ...overrides,
});
let fixture: ReturnType<typeof transactionMemory>;
const seed = (extra: Record<string, any[]> = {}) => ({
  tenants: [{ id: 3, status: "active" }],
  flights: [
    {
      id: 11,
      tenantId: 3,
      airlineId: 5,
      status: "completed",
      departureTime: new Date(Date.now() - 7_200_000),
      arrivalTime: new Date(Date.now() - 3_600_000),
      economySeats: 150,
      businessSeats: 12,
    },
  ],
  ...extra,
});
beforeEach(() => {
  vi.stubEnv("AVIATION_COST_KEY", KEY);
  vi.stubEnv(
    "AVIATION_SOURCE_REGISTRY",
    JSON.stringify([
      {
        sourceId: "erp-close",
        tenantId: 3,
        capabilities: ["flight_cost"],
        secretEnv: "AVIATION_COST_KEY",
        validUntil: "2030-01-01T00:00:00Z",
        airlineIds: [5],
      },
    ])
  );
  fixture = transactionMemory(seed());
  boundary.db = fixture.db;
});
afterEach(() => vi.unstubAllEnvs());

describe("flight cost capacity snapshot", () => {
  it("captures the seat configuration at ingest beside the signed payload, outside its digest", async () => {
    const e = envelope();
    await ingestFlightCost(e, sign(e));
    const [row] = fixture.rows("aviation_evidence");
    expect(row.payload).toEqual(e.payload);
    expect(row.ingestSnapshot).toEqual({
      kind: "flight_capacity_at_ingest",
      source: "flights.row_at_ingest",
      economySeats: 150,
      businessSeats: 12,
      flightStatus: "completed",
    });
    expect(row.ingestSnapshotAt).toBeInstanceOf(Date);
    // The digest is computed from the source envelope alone, so the snapshot
    // cannot alter it and a signature check over the envelope still holds.
    expect(row.digest).toBe(evidenceDigest(e));
  });

  it("keeps ASK, CASK and RASK fixed after the flight's seats are reconfigured", async () => {
    const e = envelope();
    await ingestFlightCost(e, sign(e));
    const before = await getFlightEconomics(11, 3);
    expect(before.capacityBasis).toBe("ingest_snapshot");
    expect(before.availableSeatKm).toBe(162 * 1000);
    expect(before.caskMinor).toBeCloseTo(190_000 / 162_000, 9);
    expect(before.raskMinor).toBeCloseTo(300_000 / 162_000, 9);
    expect(before.capacity).toMatchObject({
      economySeats: 150,
      businessSeats: 12,
    });

    fixture.rows("flights")[0].economySeats = 180;
    fixture.rows("flights")[0].businessSeats = 0;
    const after = await getFlightEconomics(11, 3);
    expect(after.availableSeatKm).toBe(before.availableSeatKm);
    expect(after.caskMinor).toBe(before.caskMinor);
    expect(after.raskMinor).toBe(before.raskMinor);
    expect(after.capacity).toEqual(before.capacity);
  });

  it("reuses the original evidence and snapshot when the same event is replayed after a seat change", async () => {
    const e = envelope();
    const first = await ingestFlightCost(e, sign(e));
    const snapshot = structuredClone(fixture.rows("aviation_evidence")[0]);
    fixture.rows("flights")[0].economySeats = 180;
    const replay = await ingestFlightCost(
      { ...e, issuedAt: new Date().toISOString() },
      sign({ ...e, issuedAt: new Date().toISOString() })
    );
    expect(replay).toEqual({ evidenceId: first.evidenceId, duplicate: true });
    expect(fixture.rows("aviation_evidence")).toHaveLength(1);
    expect(fixture.rows("aviation_evidence")[0].ingestSnapshot).toEqual(
      snapshot.ingestSnapshot
    );
    expect(fixture.rows("aviation_evidence")[0].ingestSnapshotAt).toEqual(
      snapshot.ingestSnapshotAt
    );
    const economics = await getFlightEconomics(11, 3);
    expect(economics.availableSeatKm).toBe(162 * 1000);
  });

  it("rejects a changed payload that reuses the same source event identity", async () => {
    const e = envelope();
    await ingestFlightCost(e, sign(e));
    const changed = envelope({
      payload: { ...e.payload, recognizedRevenueMinor: 1 },
    });
    await expect(ingestFlightCost(changed, sign(changed))).rejects.toThrow(
      /reused/
    );
    expect(fixture.rows("aviation_evidence")).toHaveLength(1);
  });

  it("reports legacy evidence without a snapshot as a limitation and keeps its costs and revenue", async () => {
    // Evidence recorded before the snapshot column existed: seeded directly,
    // because the fixture's row accessor does not create missing tables.
    fixture = transactionMemory(
      seed({
        aviation_evidence: [
          {
            id: 900,
            sourceId: "erp-close",
            sourceEventId: "legacy-close",
            tenantId: 3,
            flightId: 11,
            kind: "flight_cost",
            payload: envelope().payload,
            digest: "0".repeat(64),
            observedAt: new Date(Date.now() - 1_800_000),
            receivedAt: new Date(Date.now() - 1_800_000),
            ingestSnapshot: null,
            ingestSnapshotAt: null,
          },
        ],
      })
    );
    boundary.db = fixture.db;
    const economics = await getFlightEconomics(11, 3);
    expect(economics.evidenceId).toBe(900);
    expect(economics.totalCostMinor).toBe(190_000);
    expect(economics.recognizedRevenueMinor).toBe(300_000);
    expect(economics.operatingResultMinor).toBe(110_000);
    expect(economics.costs).toEqual(costs);
    expect(economics.capacityBasis).toBe("missing_ingest_snapshot");
    expect(economics.capacity).toBeNull();
    expect(economics.availableSeatKm).toBeNull();
    expect(economics.caskMinor).toBeNull();
    expect(economics.raskMinor).toBeNull();
    const read = await readFlightCosts([11], 3);
    expect(read.get(11)?.capacity).toBeNull();
  });

  it("refuses to record cost evidence for a flight that is not completed", async () => {
    fixture.rows("flights")[0].status = "scheduled";
    const e = envelope();
    await expect(ingestFlightCost(e, sign(e))).rejects.toThrow(/completed/);
    expect(fixture.rows("aviation_evidence")).toHaveLength(0);
  });
});
