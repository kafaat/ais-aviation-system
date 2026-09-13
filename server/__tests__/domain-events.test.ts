import { describe, expect, it } from "vitest";
import {
  fromCloudEvent,
  toCloudEvent,
  validateDomainEvent,
} from "../contracts/domain-events";
import { recordEvent } from "../services/outbox.service";
import { transactionMemory } from "./helpers/transaction-memory";
const event = {
  eventId: "a21a5afe-cf4a-4223-ad6d-39aaff08d781",
  eventType: "booking.confirmed",
  aggregateType: "booking",
  aggregateId: "12",
  tenantId: 3,
  schemaVersion: 1,
  payload: { bookingId: 12 },
  createdAt: new Date("2026-09-13T00:00:00Z"),
};
describe("versioned domain event contracts", () => {
  it("retains stable identity, tenant and occurrence time across retransmission", () => {
    const first = toCloudEvent(event);
    expect(
      toCloudEvent({ ...event, attempts: 5, leaseToken: "different" })
    ).toEqual(first);
    expect(first).toMatchObject({
      specversion: "1.0",
      id: event.eventId,
      tenantid: 3,
      source: "urn:ais:aviation:tenant:3",
      time: event.createdAt.toISOString(),
    });
    expect(fromCloudEvent(first)).toEqual(validateDomainEvent(event));
    expect(first).not.toHaveProperty("attempts");
    expect(first).not.toHaveProperty("leaseToken");
  });
  it("represents explicit public scope without a null CloudEvents extension", () => {
    const result = toCloudEvent({ ...event, tenantId: null });
    expect(result).not.toHaveProperty("tenantid");
    expect(fromCloudEvent(result).tenantId).toBeNull();
  });
  it.each([
    { tenantid: 4 },
    { source: "urn:foreign" },
    { aisscope: "public" },
    { subject: "booking/99" },
    { dataschema: "urn:other" },
    { schemaversion: 2 },
    { type: "org.ais.booking.confirmed.v2" },
  ])("rejects inconsistent or unsupported metadata %j", change => {
    expect(() =>
      fromCloudEvent({ ...toCloudEvent(event), ...change })
    ).toThrow();
  });
  it("accepts additive v1 fields but rejects missing typed payload fields", () => {
    expect(
      validateDomainEvent({
        ...event,
        payload: { bookingId: 12, extraContext: "future additive field" },
      }).payload
    ).toHaveProperty("extraContext");
    expect(() => validateDomainEvent({ ...event, payload: {} })).toThrow();
  });
  it("rejects unsupported versions before the producer inserts anything", async () => {
    const fixture = transactionMemory({});
    await expect(
      recordEvent(fixture.db, { ...event, schemaVersion: 2 })
    ).rejects.toThrow();
    expect(fixture.rows("outbox")).toHaveLength(0);
  });
  it("keeps version-one compatibility explicit for legacy envelopes", () => {
    const { schemaVersion: _version, ...old } = event;
    expect(validateDomainEvent(old).schemaVersion).toBe(1);
    expect(
      validateDomainEvent({
        ...old,
        eventType: "LegacyDomainSignal",
        payload: { supported: true },
      }).schemaVersion
    ).toBe(1);
  });
});
