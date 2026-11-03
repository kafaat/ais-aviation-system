import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName } from "drizzle-orm";
import { transactionMemory } from "./helpers/transaction-memory";

const boundary = vi.hoisted(() => ({ db: null as any }));
vi.mock("../db", () => ({ getDb: async () => boundary.db }));
// Baggage procedures have no sensitive rate-limit scope; isolate Redis startup.
vi.mock("../_core/middleware/procedure-rate-limit", () => ({
  enforceProcedureRateLimit: vi.fn(),
}));
import {
  registerBaggage,
  getBaggageRegistrationSummary,
} from "../services/baggage.service";

import { baggageRouter } from "../routers/baggage";

const scope = { bookingId: 7, passengerId: 11, flightId: 31, segmentId: 21 };
const actor = { id: 91, role: "ops", tenantId: 3 };
const input = {
  bookingId: 7,
  passengerId: 11,
  flightId: 31,
  segmentId: 21,
  weight: 10,
  idempotencyKey: "accept-bag-0001",
};

function seed() {
  const departure = new Date(Date.now() + 3 * 3600000);
  return {
    tenants: [{ id: 3, status: "active" }],
    dcs_flight_operations: [] as Record<string, any>[],
    dcs_passenger_states: [] as Record<string, any>[],
    bookings: [
      {
        id: 7,
        userId: 1,
        tenantId: 3,
        flightId: 31,
        status: "confirmed",
        paymentStatus: "paid",
        cabinClass: "economy",
        seatsReserved: true,
        numberOfPassengers: 1,
        checkedIn: true,
        deletedAt: null,
      },
    ],
    passengers: [{ id: 11, bookingId: 7, tenantId: 3 }],
    flights: [
      {
        id: 31,
        tenantId: 3,
        originId: 101,
        status: "scheduled",
        departureTime: departure,
      },
    ],
    booking_segments: [
      {
        id: 21,
        bookingId: 7,
        flightId: 31,
        segmentOrder: 1,
        status: "confirmed",
        seatsReserved: true,
      },
    ],
    seat_inventory: [
      {
        id: 51,
        flightId: 31,
        bookingId: 7,
        passengerId: 11,
        status: "checked_in",
        cabinClass: "economy",
        checkInNonce: "current-check-in",
        checkedInAt: new Date(),
        boardingSequence: 1,
      },
    ],
    baggage_items: [] as Record<string, any>[],
    baggage_tracking: [] as Record<string, any>[],
    booking_ancillaries: [] as Record<string, any>[],
    ancillary_services: [{ id: 41, category: "baggage", name: "10kg extra" }],
    booking_modifications: [
      {
        id: 61,
        bookingId: 7,
        status: "completed",
        paymentStatus: "paid",
        totalCost: 5000,
        stripePaymentIntentId: "pi_bag_funded",
        executionEventId: "bag-paid-event",
      },
    ],
    payment_receipts: [
      {
        paymentIntentId: "pi_bag_funded",
        kind: "modification",
        bookingId: 7,
        targetId: 61,
        settlementStatus: "applied",
        refundedAmount: 0,
      },
    ],
    idempotency_requests: [] as Record<string, any>[],
  };
}
let data: ReturnType<typeof seed>;
let fixture: ReturnType<typeof transactionMemory>;
function install() {
  fixture = transactionMemory(data);
  const insert = fixture.db.insert;
  fixture.db.insert = (table: any) => {
    const name = getTableName(table);
    if (name !== "baggage_items") return insert(table);
    return {
      values(value: any) {
        return insert(table).values({
          lastLocation: null,
          lostReportedAt: null,
          lostDescription: null,
          flightId: null,
          segmentId: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...value,
        });
      },
    };
  };
  boundary.db = fixture.db;
}
function paidWeight(overrides: Record<string, unknown> = {}) {
  return {
    id: 71,
    bookingId: 7,
    passengerId: 11,
    ancillaryServiceId: 41,
    status: "active",
    weightSnapshotGrams: 10000,
    fundedAt: new Date(),
    fundingReference: {
      kind: "collected_modification",
      modificationId: 61,
      paymentIntentId: "pi_bag_funded",
      executionEventId: "bag-paid-event",
    },
    metadata: JSON.stringify({ preferences: { modificationId: 61 } }),
    segmentId: 21,
    scopeState: "specific_segment",
    ...overrides,
  };
}
async function denied(
  overrides = {},
  operator: any = actor,
  code = "PRECONDITION_FAILED"
) {
  await expect(
    registerBaggage({ ...input, ...overrides }, operator)
  ).rejects.toMatchObject({ code });
  expect(fixture.rows("baggage_items")).toHaveLength(0);
  expect(fixture.rows("baggage_tracking")).toHaveLength(0);
}
beforeEach(() => {
  data = seed();
  install();
});

describe("physical baggage registration authority", () => {
  it("requires a scoped airline staff actor even when the caller owns the booking", async () => {
    await denied({}, { id: 1, role: "user", tenantId: 3 }, "FORBIDDEN");
  });
  it("rejects an absent service actor", async () => {
    await expect(registerBaggage(input, undefined)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(fixture.rows("baggage_items")).toHaveLength(0);
  });
  it.each(["support", "finance"])(
    "rejects non-operational %s actors",
    async role => {
      await denied({}, { ...actor, role }, "FORBIDDEN");
    }
  );
  it("requires explicit tenant scope even for platform admin", async () => {
    await denied({}, { ...actor, role: "admin", tenantId: null }, "FORBIDDEN");
  });
  it("rejects another airline and never writes", async () => {
    await denied({}, { ...actor, tenantId: 4 }, "NOT_FOUND");
  });
  it("rejects a suspended airline", async () => {
    data.tenants[0].status = "suspended";
    install();
    await denied({}, actor, "FORBIDDEN");
  });
  it.each([
    ["pending", "pending"],
    ["cancelled", "refunded"],
    ["completed", "paid"],
    ["confirmed", "pending"],
  ])("rejects booking state %s / %s", async (status, paymentStatus) => {
    Object.assign(data.bookings[0], { status, paymentStatus });
    install();
    await denied();
  });
  it("rejects paid but unreserved sector inventory", async () => {
    data.booking_segments[0].seatsReserved = false;
    install();
    await denied();
  });
  it("requires exact segment and flight membership", async () => {
    await denied({ segmentId: 99 }, actor, "NOT_FOUND");
  });
  it("rejects a wrong passenger scope", async () => {
    await denied({ passengerId: 99 }, actor, "NOT_FOUND");
  });
  it("rejects a departed/completed flight", async () => {
    data.flights[0].status = "completed";
    install();
    await denied();
  });
  it("rejects a past departure even if flight state remained scheduled", async () => {
    data.flights[0].departureTime = new Date(Date.now() - 60000);
    install();
    await denied();
  });
  it("does not treat booking-level check-in as this passenger's sector check-in", async () => {
    data.seat_inventory[0].status = "occupied";
    install();
    await denied();
  });
  it("requires a current check-in nonce", async () => {
    data.seat_inventory[0].checkInNonce = "";
    install();
    await denied();
  });
  it("creates a scoped bag and actor-attributed tracking in one transaction", async () => {
    const bag = await registerBaggage(input, actor);
    expect(bag).toMatchObject({
      bookingId: 7,
      passengerId: 11,
      flightId: 31,
      segmentId: 21,
      status: "checked_in",
      weight: "10.00",
    });
    expect(fixture.rows("baggage_tracking")).toEqual([
      expect.objectContaining({
        baggageId: bag.id,
        scannedBy: actor.id,
        status: "checked_in",
      }),
    ]);
    expect(fixture.rows("idempotency_requests")[0]).toMatchObject({
      status: "COMPLETED",
      expiresAt: null,
    });
  });
  it("replays one physical bag and tracking event with the same command key", async () => {
    const first = await registerBaggage(input, actor);
    const second = await registerBaggage(input, actor);
    expect(second).toEqual(first);
    expect(fixture.rows("baggage_items")).toHaveLength(1);
    expect(fixture.rows("baggage_tracking")).toHaveLength(1);
  });
  it("rejects a changed weight under the same key", async () => {
    await registerBaggage(input, actor);
    await expect(
      registerBaggage({ ...input, weight: 11 }, actor)
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(fixture.rows("baggage_items")).toHaveLength(1);
  });
  it("rejects ambiguous or sub-centi-kilogram weights before writing", async () => {
    await expect(
      registerBaggage({ ...input, weight: 1.001 }, actor)
    ).rejects.toThrow();
    expect(fixture.rows("baggage_items")).toHaveLength(0);
  });
  it("counts cumulative physical bag weights against the same passenger/sector allowance", async () => {
    await registerBaggage({ ...input, weight: 15 }, actor);
    await expect(
      registerBaggage(
        { ...input, weight: 9, idempotencyKey: "second-bag-0002" },
        actor
      )
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(fixture.rows("baggage_items")).toHaveLength(1);
  });
  it("permits extra weight only with matched funded entitlement", async () => {
    data.booking_ancillaries.push(paidWeight());
    install();
    const bag = await registerBaggage({ ...input, weight: 30 }, actor);
    expect(bag.weight).toBe("30.00");
  });
  it("fails closed on purchased extra weight without funding evidence", async () => {
    data.booking_ancillaries.push(
      paidWeight({ fundedAt: null, fundingReference: null })
    );
    install();
    await denied({ weight: 30 });
  });
  it("counts unscoped legacy bags conservatively on an unambiguous single sector", async () => {
    data.baggage_items.push({
      id: 80,
      bookingId: 7,
      passengerId: 11,
      flightId: null,
      segmentId: null,
      weight: "20.00",
      status: "checked_in",
      tagNumber: "0000000080",
    });
    install();
    await expect(
      registerBaggage({ ...input, weight: 4 }, actor)
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(fixture.rows("baggage_items")).toHaveLength(1);
  });
  it("rejects ambiguous legacy baggage on a multi-sector booking", async () => {
    data.booking_segments.push({
      id: 22,
      bookingId: 7,
      flightId: 32,
      segmentOrder: 2,
      status: "confirmed",
      seatsReserved: true,
    });
    data.flights.push({ ...data.flights[0], id: 32 });
    data.baggage_items.push({
      id: 80,
      bookingId: 7,
      passengerId: 11,
      flightId: null,
      segmentId: null,
      weight: "1.00",
      status: "checked_in",
      tagNumber: "0000000080",
    });
    install();
    await expect(registerBaggage(input, actor)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
    expect(fixture.rows("baggage_items")).toHaveLength(1);
  });
  it("rolls back the bag and command when the tracking write fails", async () => {
    fixture.failInsert("baggage_tracking");
    await expect(registerBaggage(input, actor)).rejects.toThrow(
      "Injected insert failure"
    );
    expect(fixture.rows("baggage_items")).toHaveLength(0);
    expect(fixture.rows("idempotency_requests")).toHaveLength(0);
  });
  it("rejects registration when departure control has closed the flight", async () => {
    data.dcs_flight_operations.push({
      id: 1,
      flightId: 31,
      checkInState: "closed",
    });
    install();
    await denied();
  });
  it.each(["boarded", "offloaded", "not_checked_in"])(
    "rejects explicit DCS passenger state %s despite a stale checked-in seat",
    async state => {
      data.dcs_passenger_states.push({
        id: 1,
        ...scope,
        state,
        boardingDenied: false,
      });
      install();
      await denied();
    }
  );
  it("does not bypass DENY by retaining the old checked-in seat", async () => {
    data.dcs_passenger_states.push({
      id: 1,
      ...scope,
      state: "checked_in",
      boardingDenied: true,
    });
    install();
    await denied();
  });
  it("replays the committed result after departure without accepting a second bag", async () => {
    const first = await registerBaggage(input, actor);
    fixture.rows("flights")[0].status = "completed";
    fixture.rows("bookings")[0].status = "completed";
    expect(await registerBaggage(input, actor)).toEqual(first);
    expect(fixture.rows("baggage_items")).toHaveLength(1);
  });
  it("shows scoped staff canonical allowance and registered weight without funding references", async () => {
    data.booking_ancillaries.push(paidWeight());
    install();
    const bag = await registerBaggage(input, actor);
    const summary = await getBaggageRegistrationSummary(scope, actor);
    expect(summary).toMatchObject({
      ...scope,
      allowanceWeightGrams: 33000,
      registeredWeightGrams: 10000,
      remainingWeightGrams: 23000,
      requiresOperationalReview: false,
      bags: [
        {
          id: bag.id,
          tagNumber: bag.tagNumber,
          weightGrams: 10000,
          flightId: 31,
          segmentId: 21,
          legacy: false,
        },
      ],
    });
    expect(JSON.stringify(summary)).not.toContain("pi_bag_funded");
    expect(summary).not.toHaveProperty("sources");
  });
  it("does not expand owner read access into the staff registration summary", async () => {
    await expect(
      getBaggageRegistrationSummary(scope, { id: 1, role: "user", tenantId: 3 })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      getBaggageRegistrationSummary(scope, { ...actor, tenantId: 4 })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("keeps ambiguous legacy weight unknown in the staff summary", async () => {
    data.booking_segments.push({
      ...data.booking_segments[0],
      id: 22,
      flightId: 32,
      segmentOrder: 2,
    });
    data.flights.push({ ...data.flights[0], id: 32 });
    data.baggage_items.push({
      id: 80,
      bookingId: 7,
      passengerId: 11,
      flightId: null,
      segmentId: null,
      weight: "2.00",
      tagNumber: "0000000080",
      status: "checked_in",
    });
    install();
    expect(await getBaggageRegistrationSummary(scope, actor)).toMatchObject({
      registeredWeightGrams: null,
      remainingWeightGrams: null,
      requiresOperationalReview: true,
      warnings: ["ambiguous_legacy_baggage"],
    });
  });
  it("enforces the staff boundary through the actual router and returns exact bag scope", async () => {
    const ctx = (role: string, id = 91) =>
      ({
        user: { id, role, tenantId: 3 },
        tenantId: 3,
        req: { headers: {} },
        res: {},
      }) as any;
    await expect(
      baggageRouter.createCaller(ctx("user", 1)).register(input)
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const registered = await baggageRouter
      .createCaller(ctx("ops"))
      .register(input);
    expect(registered).toMatchObject({
      success: true,
      baggage: { flightId: 31, segmentId: 21 },
    });
    expect(
      await baggageRouter.createCaller(ctx("ops")).registrationSummary(scope)
    ).toMatchObject({ registeredWeightGrams: 10000 });
  });
  it("does not accept client payment assertions or actor fields", async () => {
    const caller = baggageRouter.createCaller({
      user: { id: 91, role: "ops", tenantId: 3 },
      tenantId: 3,
      req: { headers: {} },
      res: {},
    } as any);
    await expect(
      caller.register({ ...input, paymentStatus: "paid", actorId: 1 } as any)
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(fixture.rows("baggage_items")).toHaveLength(0);
  });
});
