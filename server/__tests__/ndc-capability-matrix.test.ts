import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { transactionMemory } from "./helpers/transaction-memory";
const state = vi.hoisted(() => ({ db: null as any }));
vi.mock("../db", () => ({ getDb: () => state.db }));
import {
  ANY,
  DISTRIBUTION_ACTIONS,
  INTERNAL_NDC_VERSION,
  isSchemaVersionExpression,
  mergeCapabilityRows,
  renderCapabilityMatrixMarkdown,
  resolveCapability,
  seedDistributionCapabilities,
  type CapabilityRow,
} from "../services/ndc-capability-seed";
import {
  DistributionCapabilityError,
  assertCapability,
  bookingDistributionContext,
  capabilityFor,
  distributionChannelOf,
  listDistributionCapabilities,
  resolveCapabilitySummary,
  schemaVersionOf,
  upsertDistributionCapability,
} from "../services/ndc-capability-matrix";
import { quotePaidOrderService } from "../services/order-servicing.service";
import { changeOrder, addServices } from "../services/ndc.service";

const row = (
  partial: Partial<CapabilityRow> & Pick<CapabilityRow, "action" | "support">
): CapabilityRow => ({
  source: "seed",
  carrierCode: ANY,
  sellerId: ANY,
  channel: "ndc",
  schemaVersion: ANY,
  confirmation: "confirmed",
  evidenceUrl: null,
  evidenceNote: "test",
  effectiveFrom: null,
  effectiveTo: null,
  ...partial,
});
const query = {
  carrierCode: "LH",
  sellerId: "AGG1",
  channel: "ndc" as const,
  schemaVersion: "21.3",
  action: "passenger_split" as const,
};

describe("capability matrix precedence", () => {
  it("prefers an exact version over a range over the channel default", () => {
    const rows = [
      row({ action: "passenger_split", support: "unsupported" }),
      row({
        action: "passenger_split",
        support: "partial",
        schemaVersion: "17.2-24.1",
      }),
      row({
        action: "passenger_split",
        support: "supported",
        schemaVersion: "21.3",
      }),
    ];
    expect(resolveCapability(rows, query)).toMatchObject({
      support: "supported",
      precedence: "exact_version",
      allowed: true,
    });
    expect(resolveCapability(rows.slice(0, 2), query)).toMatchObject({
      support: "partial",
      precedence: "version_range",
      allowed: true,
    });
    expect(resolveCapability(rows.slice(0, 1), query)).toMatchObject({
      support: "unsupported",
      precedence: "channel_default",
      allowed: false,
    });
    expect(
      resolveCapability(rows.slice(1, 2), { ...query, schemaVersion: "24.2" })
    ).toMatchObject({ support: "unknown", precedence: "none", allowed: false });
  });
  it("prefers an exact carrier and seller at the same version level", () => {
    const rows = [
      row({ action: "refund", support: "supported", schemaVersion: "21.3" }),
      row({
        action: "refund",
        support: "unsupported",
        schemaVersion: "21.3",
        carrierCode: "lh",
      }),
      row({
        action: "refund",
        support: "partial",
        schemaVersion: "21.3",
        carrierCode: "LH",
        sellerId: "AGG1",
      }),
    ];
    expect(
      resolveCapability(rows, { ...query, action: "refund" })
    ).toMatchObject({ support: "partial", allowed: true });
    expect(
      resolveCapability(rows.slice(0, 2), { ...query, action: "refund" })
    ).toMatchObject({ support: "unsupported", allowed: false });
    expect(
      resolveCapability(rows, {
        ...query,
        action: "refund",
        carrierCode: "AY",
      })
    ).toMatchObject({ support: "supported", allowed: true });
  });
  it("fails closed for unconfirmed rows and names the combination", () => {
    const decision = resolveCapability(
      [
        row({
          action: "passenger_split",
          support: "supported",
          schemaVersion: "21.3",
          confirmation: "unconfirmed",
        }),
      ],
      query
    );
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain(
      "carrier LH, seller AGG1, channel ndc, schema 21.3"
    );
    expect(decision.reason).toContain("operator confirmation");
  });
  it("respects effective dates and lets stored rows replace seeds", () => {
    const expired = row({
      action: "seat_move",
      support: "supported",
      schemaVersion: "21.3",
      effectiveTo: new Date("2020-01-01"),
    });
    expect(
      resolveCapability([expired], { ...query, action: "seat_move" })
    ).toMatchObject({ precedence: "none" });
    const merged = mergeCapabilityRows(
      [
        row({
          action: "seat_move",
          support: "supported",
          schemaVersion: "21.3",
        }),
      ],
      [
        row({
          action: "seat_move",
          support: "unsupported",
          schemaVersion: "21.3",
          source: "database",
          id: 9,
        }),
      ]
    );
    expect(merged).toHaveLength(1);
    expect(
      resolveCapability(merged, { ...query, action: "seat_move" })
    ).toMatchObject({ allowed: false, source: "database", rowId: 9 });
    expect(isSchemaVersionExpression("17.2-21.3")).toBe(true);
    expect(isSchemaVersionExpression("24.1-17.2")).toBe(false);
    expect(isSchemaVersionExpression("v24")).toBe(false);
  });
  it("seeds the Lufthansa Group 24.1 versus 17.2 difference and fails closed elsewhere", () => {
    const lh = (schemaVersion: string, action: typeof query.action) =>
      resolveCapability(seedDistributionCapabilities, {
        carrierCode: "LH",
        sellerId: ANY,
        channel: "ndc",
        schemaVersion,
        action,
      });
    expect(lh("24.1", "passenger_split").allowed).toBe(true);
    expect(lh("17.2", "passenger_split").allowed).toBe(false);
    expect(lh("24.1", "order_change_involuntary").allowed).toBe(true);
    expect(lh("17.2", "order_change_involuntary").allowed).toBe(false);
    // 21.3 is not documented for Lufthansa Group: channel default, unconfirmed.
    expect(lh("21.3", "passenger_split")).toMatchObject({
      precedence: "channel_default",
      allowed: false,
    });
    for (const action of DISTRIBUTION_ACTIONS) {
      for (const channel of ["ndc", "gds", "ota"] as const)
        expect(
          resolveCapability(seedDistributionCapabilities, {
            carrierCode: "XX",
            sellerId: ANY,
            channel,
            schemaVersion: "24.1",
            action,
          }).allowed
        ).toBe(false);
    }
    const direct = (action: (typeof DISTRIBUTION_ACTIONS)[number]) =>
      resolveCapability(seedDistributionCapabilities, {
        carrierCode: "SV",
        sellerId: ANY,
        channel: "direct",
        schemaVersion: INTERNAL_NDC_VERSION,
        action,
      });
    expect(direct("order_change_voluntary").allowed).toBe(true);
    expect(direct("seat_move")).toMatchObject({
      support: "partial",
      allowed: true,
    });
    expect(direct("seat_fee_refund").allowed).toBe(false);
    expect(direct("passenger_split").allowed).toBe(false);
  });
});

describe("generated documentation", () => {
  it("matches the seeded data", () => {
    const file = readFileSync(
      resolve("docs/architecture/ndc-capability-matrix.md"),
      "utf8"
    );
    expect(file).toBe(
      renderCapabilityMatrixMarkdown(seedDistributionCapabilities)
    );
    expect(file).toContain(
      "| LH | * | ndc | 24.1 | passenger_split | supported"
    );
    expect(file).toContain(
      "| LH | * | ndc | 17.2 | passenger_split | unsupported"
    );
    // Idempotency key and per-attempt trace id are separate columns so
    // integrators do not replay a transactionId as an idempotency key.
    expect(file).toContain("| Idempotency key | Trace id |");
    expect(file).toMatch(
      /\| TK \| \* \| ndc \| 24\.1 \| shop \|.*not documented.*\| `transactionId` per call/
    );
    expect(file).toMatch(
      /\| \* \| \* \| direct \| 21\.3 \| order_create \|.*request body `idempotencyKey`.*\| `X-Request-ID` header/
    );
  });
});

describe("servicing gates", () => {
  let fixture: ReturnType<typeof transactionMemory>;
  const future = new Date("2035-01-01T10:00:00Z");
  const booking = {
    id: 7,
    userId: 1,
    tenantId: 3,
    flightId: 11,
    cabinClass: "economy",
    totalAmount: 10000,
    numberOfPassengers: 1,
    status: "confirmed",
    paymentStatus: "paid",
    seatsReserved: true,
    checkedIn: false,
  };
  const deny = (
    action: string,
    channel = "direct",
    schemaVersion = "21.3"
  ) => ({
    id: 1,
    carrierCode: "*",
    sellerId: "*",
    channel,
    schemaVersion,
    action,
    support: "unsupported",
    confirmation: "confirmed",
    evidenceUrl: null,
    evidenceNote: "operator override",
    effectiveFrom: null,
    effectiveTo: null,
  });
  beforeEach(() => {
    fixture = transactionMemory({
      tenants: [{ id: 3, status: "active" }],
      airlines: [{ id: 2, code: "SV" }],
      flights: [
        {
          id: 11,
          tenantId: 3,
          airlineId: 2,
          departureTime: future,
          arrivalTime: new Date("2035-01-01T12:00:00Z"),
          status: "scheduled",
          economyAvailable: 5,
          businessAvailable: 2,
        },
      ],
      bookings: [booking],
      passengers: [{ id: 1, bookingId: 7, tenantId: 3, type: "adult" }],
      booking_segments: [],
      booking_modifications: [],
      agent_bookings: [],
      corporate_bookings: [],
      ndc_orders: [],
      distribution_capabilities: [],
    });
    state.db = fixture.db;
  });
  it("derives the combination from the issuing order and payload version", async () => {
    expect(distributionChannelOf("ndc_aggregator")).toBe("ndc");
    expect(distributionChannelOf("travel_agent")).toBe("gds");
    expect(schemaVersionOf(JSON.stringify({ ndcVersion: "24.1" }))).toBe(
      "24.1"
    );
    expect(schemaVersionOf("{broken")).toBe(INTERNAL_NDC_VERSION);
    expect(await bookingDistributionContext(fixture.db, booking)).toEqual({
      carrierCode: "SV",
      sellerId: "*",
      channel: "direct",
      schemaVersion: "21.3",
    });
    const withOrder = await bookingDistributionContext(fixture.db, booking, {
      channel: "ndc_aggregator",
      distributorId: "AGG1",
      orderPayload: JSON.stringify({ ndcVersion: "17.2" }),
    });
    expect(withOrder).toEqual({
      carrierCode: "SV",
      sellerId: "AGG1",
      channel: "ndc",
      schemaVersion: "17.2",
    });
  });
  it("allows the seeded direct exchange and refuses it after an operator override", async () => {
    const allowed = await capabilityFor(fixture.db, {
      carrierCode: "SV",
      sellerId: ANY,
      channel: "direct",
      schemaVersion: INTERNAL_NDC_VERSION,
      action: "order_change_voluntary",
    });
    expect(allowed.allowed).toBe(true);
    fixture = transactionMemory({
      distribution_capabilities: [deny("order_change_voluntary")],
    });
    await expect(
      assertCapability(fixture.db, {
        carrierCode: "SV",
        sellerId: ANY,
        channel: "direct",
        schemaVersion: INTERNAL_NDC_VERSION,
        action: "order_change_voluntary",
      })
    ).rejects.toMatchObject({
      name: "DistributionCapabilityError",
      code: "PRECONDITION_FAILED",
      message: expect.stringContaining(
        "order_change_voluntary is unsupported on carrier SV, seller *, channel direct, schema 21.3"
      ),
    });
  });
  it("refuses each gated servicing action with the combination named", async () => {
    for (const action of [
      "order_change_voluntary",
      "ancillary_change",
      "refund",
      "seat_move",
      "name_correction",
      "order_create",
    ] as const) {
      const memory = transactionMemory({
        distribution_capabilities: [deny(action)],
      });
      const error = await assertCapability(memory.db, {
        carrierCode: "SV",
        sellerId: ANY,
        channel: "direct",
        schemaVersion: INTERNAL_NDC_VERSION,
        action,
      }).catch(e => e);
      expect(error).toBeInstanceOf(DistributionCapabilityError);
      expect(error.decision.action).toBe(action);
      expect(error.message).toContain(`${action} is unsupported on carrier SV`);
    }
  });
  it("blocks a paid itinerary exchange quote when the matrix withdraws voluntary change", async () => {
    const memory = transactionMemory({
      tenants: [{ id: 3, status: "active" }],
      airlines: [{ id: 2, code: "SV" }],
      flights: [],
      bookings: [booking],
      passengers: [{ id: 1, bookingId: 7, tenantId: 3, type: "adult" }],
      booking_segments: [],
      booking_modifications: [],
      agent_bookings: [],
      corporate_bookings: [],
      ndc_orders: [],
      retail_offers: [],
      distribution_capabilities: [deny("order_change_voluntary")],
    });
    state.db = memory.db;
    await expect(
      quotePaidOrderService(
        {
          bookingId: 7,
          idempotencyKey: "capability-gate-1",
          offerIds: ["11111111-1111-4111-8111-111111111111"],
        },
        1,
        3
      )
    ).rejects.toThrow(/Distribution capability: order_change_voluntary/);
  });
  it("blocks ancillary changes and unpaid name corrections for a withdrawn NDC channel", async () => {
    const order = {
      id: 1,
      orderId: "ORD-7",
      offerId: "OFF-7",
      bookingId: 7,
      airlineId: 2,
      passengers: JSON.stringify([
        { type: "adult", firstName: "A", lastName: "B", passportNumber: "P" },
      ]),
      contactInfo: "{}",
      totalAmount: 10000,
      currency: "SAR",
      status: "pending",
      orderPayload: JSON.stringify({ ndcVersion: "17.2" }),
      channel: "ndc_aggregator",
      distributorId: "AGG1",
    };
    const pending = {
      ...booking,
      userId: 9,
      status: "pending",
      paymentStatus: "pending",
      seatsReserved: false,
      inventoryLockId: 1,
    };
    const memory = transactionMemory({
      tenants: [{ id: 3, status: "active" }],
      airlines: [{ id: 2, code: "SV" }],
      flights: [{ id: 11, tenantId: 3, airlineId: 2, departureTime: future }],
      bookings: [pending],
      passengers: [
        {
          id: 1,
          bookingId: 7,
          tenantId: 3,
          type: "adult",
          firstName: "A",
          lastName: "B",
          passportNumber: "P",
        },
      ],
      ndc_orders: [order],
      booking_checkout_requests: [],
      distribution_capabilities: [],
    });
    state.db = memory.db;
    const command = { orderId: "ORD-7", userId: 9, idempotencyKey: "k1" };
    await expect(
      addServices({
        ...command,
        services: [{ serviceCode: "BGAG", quantity: 1 }],
      })
    ).rejects.toThrow(
      /ancillary_change is recorded as unsupported but unconfirmed on carrier SV, seller AGG1, channel ndc, schema 17.2/
    );
    await expect(
      changeOrder({
        ...command,
        idempotencyKey: "k2",
        changes: { passengerUpdates: [{ index: 0, firstName: "C" }] },
      })
    ).rejects.toThrow(/name_correction .* channel ndc, schema 17.2/);
  });
  it("summarizes every action and persists operator rows", async () => {
    const summary = await resolveCapabilitySummary(fixture.db, {
      carrierCode: "sv",
      sellerId: ANY,
      channel: "direct",
      schemaVersion: INTERNAL_NDC_VERSION,
    });
    expect(Object.keys(summary.actions).sort()).toEqual(
      [...DISTRIBUTION_ACTIONS].sort()
    );
    expect(summary.carrierCode).toBe("SV");
    expect(summary.actions.refund.allowed).toBe(true);
    await expect(
      upsertDistributionCapability(
        {
          carrierCode: "LH",
          sellerId: ANY,
          channel: "ndc",
          schemaVersion: "21.3",
          action: "seat_move",
          support: "supported",
          confirmation: "confirmed",
        },
        1
      )
    ).rejects.toThrow(/needs an evidence URL or note/);
    const stored = await upsertDistributionCapability(
      {
        carrierCode: "LH",
        sellerId: ANY,
        channel: "ndc",
        schemaVersion: "21.3",
        action: "seat_move",
        support: "supported",
        confirmation: "confirmed",
        evidenceNote: "Counterparty test 2026-11",
        idempotencyKeyHeader: "Idempotency-Key header",
        traceIdHeader: "transactionId per call",
      },
      1
    );
    expect(stored.idempotencyKeyHeader).toBe("Idempotency-Key header");
    expect(stored.traceIdHeader).toBe("transactionId per call");
    expect(stored.source).toBe("database");
    const listed = await listDistributionCapabilities({
      channel: "ndc",
      carrierCode: "LH",
    });
    expect(listed.some(r => r.source === "database")).toBe(true);
    expect(listed.every(r => r.channel === "ndc")).toBe(true);
  });
});
