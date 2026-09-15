import { describe, expect, it } from "vitest";
import { fromCloudEvent, toCloudEvent } from "../contracts/domain-events";
import { recordEvent } from "../services/outbox.service";
import { transactionMemory } from "./helpers/transaction-memory";

const digest = "a".repeat(64);
// Independent snapshots of the payloads emitted by the ingestion commands.
const evidenceKinds = [
  "maintenance",
  "crew_rules",
  "baggage_custody",
  "premium_policy",
  "departure_estimate",
  "departure_actual",
  "arrival_actual",
  "tobt",
  "tsat",
  "carbon",
  "travel_rules",
  "travel_clearance",
  "flight_cost",
];
const receipts: Array<[string, Record<string, unknown>]> = [
  ...evidenceKinds.map(
    kind =>
      [
        `aviation.${kind}`,
        {
          evidenceId: 10,
          sourceId: "operator-source",
          flightId: kind === "crew_rules" ? null : 2,
          observedAt: "2026-09-15T12:00:00.000Z",
          digest,
        },
      ] as [string, Record<string, unknown>]
  ),
  ["crew.rules_accepted", { actorId: 3, version: "rules-v1", airlineId: 1 }],
  [
    "crew.assignment_created",
    { crewMemberId: 5, flightId: 2, ruleEvidenceId: 10, assignedBy: 3 },
  ],
  [
    "aircraft.rotation_planned",
    {
      flightId: 2,
      airlineId: 1,
      tenantId: null,
      tailNumber: "7O-FIXTURE",
      maintenanceEvidenceId: 10,
      scheduleDigest: digest,
      assignedBy: 3,
      acceptance: "planning_only_dispatch_required",
    },
  ],
  [
    "operations.event_replay_requested",
    {
      eventId: "legacy-receipt-1",
      actorId: 3,
      reason: "transport restored",
      previousAttempts: 5,
    },
  ],
  [
    "operations.cancellation_retry_requested",
    { jobId: 11, actorId: 3, reason: "review completed" },
  ],
  [
    "travel_agent.owner_assigned",
    { agentId: 12, previousOwnerId: null, ownerUserId: 6, actorId: 3 },
  ],
  [
    "NdcOrderCreated",
    {
      orderId: "NDC-1",
      offerId: "OFFER-1",
      totalAmount: 12000,
      currency: "SAR",
    },
  ],
  [
    "NdcOrderCancelled",
    {
      orderId: "NDC-1",
      bookingId: 7,
      reason: "passenger request",
      paymentStatus: "paid",
    },
  ],
  ["NdcUnpaidOrderChanged", { orderId: "NDC-1", bookingId: 7, actorId: 3 }],
  ["NdcUnpaidServicesAdded", { orderId: "NDC-1", bookingId: 7, actorId: 3 }],
];
const envelope = {
  eventId: "ed7b04b5-aaeb-4c69-a5d3-055a36471c7c",
  aggregateType: "fixture",
  aggregateId: "1",
  tenantId: 2,
  schemaVersion: 1,
  createdAt: new Date("2026-09-15T00:00:00Z"),
};

describe("operational and NDC event payloads", () => {
  it.each(receipts)(
    "persists and replays %s without dropping additive v1 fields",
    async (eventType, payload) => {
      const data = { ...payload, futureContext: { reference: "operator" } };
      const db = transactionMemory({});
      await recordEvent(db.db, { ...envelope, eventType, payload: data });
      expect(db.rows("outbox")).toHaveLength(1);
      const stored = db.rows("outbox")[0];
      expect(
        fromCloudEvent(
          toCloudEvent({ ...stored, createdAt: envelope.createdAt })
        )
      ).toMatchObject({ eventType, payload: data, tenantId: 2 });
    }
  );
  for (const [eventType, payload] of receipts) {
    for (const field of Object.keys(payload)) {
      it(`rejects ${eventType} without ${field} before writing and on replay`, async () => {
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
    ["aviation.maintenance", { digest: "unverified" }],
    ["aviation.crew_rules", { observedAt: "tomorrow" }],
    ["crew.assignment_created", { ruleEvidenceId: null }],
    ["aircraft.rotation_planned", { acceptance: "dispatch_authorized" }],
    ["operations.event_replay_requested", { previousAttempts: -1 }],
    ["travel_agent.owner_assigned", { ownerUserId: 0 }],
    ["NdcOrderCreated", { totalAmount: -1 }],
    ["NdcOrderCancelled", { paymentStatus: "refund_sent" }],
    ["NdcUnpaidOrderChanged", { actorId: null }],
    ["NdcUnpaidServicesAdded", { bookingId: "7" }],
  ] as const)("rejects unsupported %s data %j", (eventType, change) => {
    const payload = receipts.find(([name]) => name === eventType)![1];
    expect(() =>
      toCloudEvent({
        ...envelope,
        eventType,
        payload: { ...payload, ...change },
      })
    ).toThrow();
  });
  it.each(["LegacyDomainSignal", "constructor", "toString"])(
    "replays historical %s but refuses a new write",
    async eventType => {
      const historical = {
        ...envelope,
        eventType,
        payload: { oldField: "preserve me" },
      };
      expect(fromCloudEvent(toCloudEvent(historical)).payload).toEqual(
        historical.payload
      );
      const db = transactionMemory({});
      await expect(recordEvent(db.db, historical)).rejects.toThrow(
        "Unregistered domain event type"
      );
      expect(db.rows("outbox")).toHaveLength(0);
    }
  );
});
