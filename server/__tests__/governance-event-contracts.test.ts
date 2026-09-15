import { describe, expect, it } from "vitest";
import { fromCloudEvent, toCloudEvent } from "../contracts/domain-events";
import { recordEvent } from "../services/outbox.service";
import { transactionMemory } from "./helpers/transaction-memory";

// Producer shapes are explicit fixtures, not derived from the contract registry.
const receipts: Array<[string, Record<string, unknown>]> = [
  [
    "tenant.status_changed",
    { tenantId: 2, previous: "pending", status: "active", actorId: 3 },
  ],
  [
    "tenant.user_assigned",
    { userId: 4, previousTenantId: null, tenantId: 2, actorId: 3 },
  ],
  ["family.miles_contributed", { groupId: 5, userId: 4, miles: 100 }],
  [
    "agent.price_approved",
    {
      digest: "historical-digest",
      approvedBy: 3,
      expiresAt: "2026-09-15T12:00:00.000Z",
    },
  ],
  [
    "agent.price_executed",
    {
      digest: "historical-digest",
      approvedBy: 3,
      executedBy: 6,
      previousPrice: 10000,
      price: 11000,
      flightId: 7,
    },
  ],
  [
    "AgentDecisionOverridden",
    {
      decisionId: 8,
      overriddenBy: 3,
      reason: "operator correction",
      supersededBy: null,
    },
  ],
  [
    "retail.premium_policy_approved",
    { actorId: 3, evidenceId: 9, version: "2026-09" },
  ],
  [
    "retail.premium_exposure",
    { policyId: "54c67ec1-a37c-4b4f-9e56-3d1eb508a3ea", variant: "control" },
  ],
  ["retail.premium_policy_paused", { actorId: 3 }],
];
const envelope = {
  eventId: "ed7b04b5-aaeb-4c69-a5d3-055a36471c7c",
  aggregateType: "governance",
  aggregateId: "1",
  tenantId: 2,
  schemaVersion: 1,
  createdAt: new Date("2026-09-15T00:00:00Z"),
};

describe("governance, pricing and loyalty event payloads", () => {
  it.each(receipts)(
    "persists and replays %s with additive v1 context",
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
      it(`rejects ${eventType} without ${field} before persistence and on replay`, async () => {
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
    ["tenant.status_changed", { status: "deleted" }],
    ["tenant.user_assigned", { previousTenantId: "2" }],
    ["family.miles_contributed", { miles: -1 }],
    ["family.miles_contributed", { miles: 0.5 }],
    ["agent.price_approved", { expiresAt: "tomorrow" }],
    ["agent.price_executed", { approvedBy: null }],
    ["agent.price_executed", { price: 0 }],
    ["AgentDecisionOverridden", { supersededBy: "9" }],
    ["retail.premium_policy_approved", { evidenceId: 0 }],
    ["retail.premium_exposure", { variant: "unapproved" }],
    ["retail.premium_policy_paused", { actorId: 0 }],
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

  it.each([
    ["tenant.user_assigned", { previousTenantId: 1 }],
    ["AgentDecisionOverridden", { supersededBy: 9 }],
    ["retail.premium_exposure", { variant: "treatment" }],
  ] as const)(
    "retains valid alternative %s payload %j",
    (eventType, change) => {
      const payload = {
        ...receipts.find(([name]) => name === eventType)![1],
        ...change,
      };
      expect(
        fromCloudEvent(toCloudEvent({ ...envelope, eventType, payload }))
          .payload
      ).toEqual(payload);
    }
  );
});
