import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { transactionMemory } from "./helpers/transaction-memory";

const state = vi.hoisted(() => ({ db: undefined as any }));
vi.mock("../db", () => ({ getDb: () => state.db }));
import {
  calculatePriorityScore,
  rankPassengers,
  suggestRebookingOrder,
} from "../services/passenger-priority.service";
import { buildReaccommodationAdvisory } from "../services/reaccommodation-advisory.service";

let fixture: ReturnType<typeof transactionMemory>;
beforeEach(() => {
  fixture = transactionMemory({
    bookings: [
      {
        id: 7,
        userId: 1,
        flightId: 31,
        status: "confirmed",
        cabinClass: "economy",
        totalAmount: 10000,
        numberOfPassengers: 1,
      },
    ],
    passengers: [{ id: 11, bookingId: 7, dateOfBirth: null }],
    booking_segments: [31, 32].map((flightId, index) => ({
      id: 21 + index,
      bookingId: 7,
      flightId,
      status: "confirmed",
      segmentOrder: index + 1,
      departureDate: new Date(Date.now() + (2 + index * 24) * 3600000),
      segmentAmount: 5000,
    })),
    flights: [31, 32].map((id, index) => ({
      id,
      originId: 1,
      destinationId: 2,
      economyPrice: 10000,
      status: "scheduled",
      departureTime: new Date(Date.now() + (2 + index * 24) * 3600000),
      arrivalTime: new Date(Date.now() + (3 + index * 24) * 3600000),
    })),
    special_services: [],
  });
  // The advisory's inventory SQL is unrelated to this boundary. Supply no
  // candidate flights while keeping its real ranking/normalisation path intact.
  const select = fixture.db.select;
  fixture.db.select = (projection?: Record<string, unknown>) => {
    if (!projection?.economyAvailable) return select(projection);
    const empty: any = {
      from: () => empty,
      where: () => empty,
      orderBy: () => empty,
      limit: async () => [],
    };
    return empty;
  };
  state.db = fixture.db;
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

function request(overrides: Record<string, unknown> = {}) {
  fixture.rows("special_services").push({
    id: 1,
    bookingId: 7,
    passengerId: 11,
    serviceType: "wheelchair",
    serviceCode: "WCHR",
    status: "confirmed",
    flightId: null,
    bookingSegmentId: null,
    ...overrides,
  });
}
const score = (flightId = 31) =>
  calculatePriorityScore(11, 7, { db: fixture.db, flightId });
const needsReview = {
  code: "PRECONDITION_FAILED",
  message: expect.stringMatching(/assistance.*sector.*reconcile/i),
};

describe("legacy assistance priority reconciliation", () => {
  it.each(
    ["wheelchair", "medical_assistance", "unaccompanied_minor"].flatMap(
      serviceType =>
        ["pending", "confirmed"].map(status => ({ serviceType, status }))
    )
  )(
    "refuses a complete score for unresolved $status $serviceType",
    async values => {
      request(values);
      await expect(score()).rejects.toMatchObject(needsReview);
      expect(fixture.rows("special_services")[0]).toMatchObject({
        flightId: null,
        bookingSegmentId: null,
      });
    }
  );

  it.each([
    { reader: "ranking", read: () => rankPassengers(31) },
    { reader: "rebooking order", read: () => suggestRebookingOrder(31) },
    { reader: "real advisory", read: () => buildReaccommodationAdvisory(31) },
  ])("propagates reconciliation through $reader", async ({ read }) => {
    request();
    await expect(read()).rejects.toMatchObject(needsReview);
  });

  it.each(["cancelled", "rejected"])(
    "does not block on %s legacy assistance",
    async status => {
      request({ status });
      expect((await score()).specialNeedsScore).toBe(0);
      expect(await rankPassengers(31)).toHaveLength(1);
    }
  );

  it("keeps a verified request on its own sector and does not guess the other sector", async () => {
    request({ flightId: 32, bookingSegmentId: 22 });
    expect((await score(31)).specialNeedsScore).toBe(0);
    expect((await score(32)).specialNeedsScore).toBe(100);
  });

  it("preserves an explicitly requested flight on a legacy booking without a stored segment", async () => {
    fixture.rows("booking_segments").splice(0);
    request({ flightId: 31, bookingSegmentId: null });
    expect((await score()).specialNeedsScore).toBe(100);
  });

  it("does not apply another passenger's or booking's unresolved request", async () => {
    request({ passengerId: 12 });
    request({ id: 2, bookingId: 8 });
    expect((await score()).specialNeedsScore).toBe(0);
  });

  it("does not turn an unresolved meal or other non-assistance service into an assistance blocker", async () => {
    for (const serviceType of ["meal", "extra_legroom", "pet_in_cabin"])
      request({ serviceType });
    expect((await score()).specialNeedsScore).toBe(0);
  });
});
