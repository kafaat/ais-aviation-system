import { createHmac } from "node:crypto";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { transactionMemory } from "./helpers/transaction-memory";
const boundary = vi.hoisted(() => ({ db: null as any }));
vi.mock("../db", () => ({ getDb: () => boundary.db }));
import { calculateRequestHash } from "../services/idempotency-v2.service";
import {
  verifyAviationSource,
  type EvidenceEnvelope,
} from "../services/aviation-evidence.service";
import {
  ingestOperationalEvent,
  departureEvidence,
} from "../services/operational-events.service";
let fixture: ReturnType<typeof transactionMemory>;
const sign = (e: EvidenceEnvelope) =>
  createHmac("sha256", "fixture-only-key-32-characters-long")
    .update(calculateRequestHash(e))
    .digest("hex");
const event = (): EvidenceEnvelope => ({
  sourceId: "airport-1",
  eventId: "event-1",
  issuedAt: new Date().toISOString(),
  observedAt: new Date().toISOString(),
  flightId: 11,
  kind: "departure_estimate",
  payload: { time: new Date(Date.now() + 3600000).toISOString() },
});
beforeEach(() => {
  vi.stubEnv("AVIATION_TEST_KEY", "fixture-only-key-32-characters-long");
  vi.stubEnv(
    "AVIATION_SOURCE_REGISTRY",
    JSON.stringify([
      {
        sourceId: "airport-1",
        tenantId: 3,
        capabilities: ["operations"],
        secretEnv: "AVIATION_TEST_KEY",
        validUntil: "2030-01-01T00:00:00Z",
      },
    ])
  );
  fixture = transactionMemory({
    tenants: [{ id: 3, status: "active" }],
    flights: [
      { id: 11, tenantId: 3, departureTime: new Date(Date.now() + 3600000) },
    ],
  });
  boundary.db = fixture.db;
});
afterEach(() => vi.unstubAllEnvs());
describe("verified aviation evidence", () => {
  it("accepts a signed event once and rejects identity reuse", async () => {
    const e = event();
    const first = await ingestOperationalEvent(e, sign(e));
    expect(await ingestOperationalEvent(e, sign(e))).toEqual({
      ...first,
      duplicate: true,
    });
    expect(fixture.rows("aviation_evidence")).toHaveLength(1);
    const changed = { ...e, payload: { time: new Date().toISOString() } };
    await expect(
      ingestOperationalEvent(changed, sign(changed))
    ).rejects.toThrow(/reused/);
  });
  it("refuses bad signatures, missing capabilities, old transport timestamps and foreign flights", async () => {
    const e = event();
    expect(() =>
      verifyAviationSource(e, "0".repeat(64), "operations")
    ).toThrow();
    expect(() => verifyAviationSource(e, sign(e), "baggage")).toThrow();
    const old = { ...e, issuedAt: new Date(0).toISOString() };
    expect(() => verifyAviationSource(old, sign(old), "operations")).toThrow();
    fixture.rows("flights")[0].tenantId = 4;
    await expect(ingestOperationalEvent(e, sign(e))).rejects.toThrow(
      /cannot write/
    );
  });
  it("rolls evidence back if its outbox receipt fails", async () => {
    fixture.failInsert("outbox");
    const e = event();
    await expect(ingestOperationalEvent(e, sign(e))).rejects.toThrow();
    expect(fixture.rows("aviation_evidence")).toHaveLength(0);
  });
  it("preserves unknown and stale observations and prefers actual departure", () => {
    const now = new Date();
    const scheduled = new Date(now.getTime() - 3600000);
    expect(departureEvidence([], scheduled).delayMinutes).toBeNull();
    const estimate: any = {
      id: 1,
      kind: "departure_estimate",
      sourceId: "airport-1",
      observedAt: new Date(now.getTime() - 16 * 60000),
      payload: { time: now.toISOString() },
    };
    expect(departureEvidence([estimate], scheduled).delayMinutes).toBeNull();
    const actual = { ...estimate, id: 2, kind: "departure_actual" };
    expect(departureEvidence([estimate, actual], scheduled)).toMatchObject({
      delayMinutes: 60,
      basis: "observed",
      evidenceId: 2,
    });
  });
});
