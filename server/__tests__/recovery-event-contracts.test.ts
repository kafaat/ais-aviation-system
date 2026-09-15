import { describe, expect, it } from "vitest";
import { fromCloudEvent, toCloudEvent } from "../contracts/domain-events";
import { recordEvent } from "../services/outbox.service";
import { transactionMemory } from "./helpers/transaction-memory";

// Historical v1 producer shapes, deliberately independent of the schemas.
const receipts: Array<[string, Record<string, unknown>]> = [
  [
    "waitlist.offered",
    {
      waitlistId: 1,
      flightId: 2,
      userId: 3,
      expiresAt: "2026-09-15T12:00:00.000Z",
    },
  ],
  ["waitlist.cancelled", { waitlistId: 1, flightId: 2, userId: 3 }],
  ["waitlist.expired", { waitlistId: 1, flightId: 2, userId: 3 }],
  ["irops.created", { flightId: 2, type: "equipment_change" }],
  ["irops.protection_planned", { flightId: 2, actionsCreated: 0 }],
  ["irops.notification_created", { userId: 3, flightId: 2 }],
  ["irops.escalated", { level: "critical" }],
  ["irops.resolved", {}],
  ["irops.reaccommodation_confirmed", { bookingId: 4 }],
  [
    "irops.recovery_proposed",
    {
      digest: "historical-digest",
      choices: [{ bookingId: 4, key: null }],
      optimal: false,
      gap: null,
      unassignedPassengers: 2,
      passengerDelayMinutes: 0,
    },
  ],
  ["irops.recovery_approved", { actorId: 3, digest: "historical-digest" }],
  [
    "irops.recovery_executed",
    {
      actorId: 3,
      digest: "historical-digest",
      choices: [{ bookingId: 4, key: "5" }],
      unassignedPassengers: 0,
      fulfillment: "awaiting_ticket_reissue",
    },
  ],
];
const envelope = {
  eventId: "45ffba4a-b4d1-4441-a1f2-68341a163c67",
  aggregateType: "irops",
  aggregateId: "1",
  tenantId: 2,
  schemaVersion: 1,
  createdAt: new Date("2026-09-15T00:00:00Z"),
};

describe("recovery and waitlist v1 payloads", () => {
  it.each(receipts)(
    "replays %s without losing additive fields",
    (eventType, payload) => {
      const data = { ...payload, futureContext: { source: "operator" } };
      const cloud = toCloudEvent({ ...envelope, eventType, payload: data });
      expect(fromCloudEvent(cloud)).toMatchObject({ eventType, payload: data });
    }
  );

  for (const [eventType, payload] of receipts) {
    for (const field of Object.keys(payload)) {
      it(`rejects ${eventType} missing ${field} before outbox persistence and on replay`, async () => {
        const incomplete = { ...payload };
        delete incomplete[field];
        const db = transactionMemory({});
        await expect(
          recordEvent(db.db, { ...envelope, eventType, payload: incomplete })
        ).rejects.toThrow();
        expect(db.rows("outbox")).toHaveLength(0);
        const valid = toCloudEvent({ ...envelope, eventType, payload });
        expect(() => fromCloudEvent({ ...valid, data: incomplete })).toThrow();
      });
    }
  }

  it.each([
    ["irops.recovery_proposed", { choices: [{ bookingId: 4 }] }],
    ["irops.recovery_proposed", { unassignedPassengers: -1 }],
    ["irops.recovery_proposed", { optimal: "true" }],
    ["irops.recovery_executed", { fulfillment: "ticket_issued" }],
    ["waitlist.offered", { expiresAt: "tomorrow" }],
    ["irops.escalated", { level: "unknown" }],
  ] as const)("rejects malformed %s payload %j", (eventType, change) => {
    const payload = receipts.find(([name]) => name === eventType)![1];
    expect(() =>
      toCloudEvent({
        ...envelope,
        eventType,
        payload: { ...payload, ...change },
      })
    ).toThrow();
  });
});
