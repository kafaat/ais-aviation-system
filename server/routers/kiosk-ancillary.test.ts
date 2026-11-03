import { beforeEach, expect, it, vi } from "vitest";
import type { TrpcContext } from "../_core/context";
import { issueSelfServiceCapability } from "../services/self-service-capability.service";
import { transactionMemory } from "../__tests__/helpers/transaction-memory";
import { kioskRouter } from "./kiosk";

const state = vi.hoisted(() => ({ db: null as any }));
vi.mock("../db", () => ({ getDb: () => state.db }));

const caller = kioskRouter.createCaller({ user: null } as TrpcContext);
const capabilityToken = issueSelfServiceCapability({
  kind: "kiosk-session",
  sessionId: 9,
  bookingId: 10,
  passengerIds: [11],
});
let fixture: ReturnType<typeof transactionMemory>;
beforeEach(() => {
  fixture = transactionMemory({
    bookings: [
      {
        id: 10,
        status: "confirmed",
        paymentStatus: "paid",
        cabinClass: "economy",
        totalAmount: 12000,
      },
    ],
    passengers: [
      { id: 11, bookingId: 10, firstName: "A", lastName: "Traveler" },
    ],
    booking_segments: [
      { id: 1, bookingId: 10, flightId: 12 },
      { id: 2, bookingId: 10, flightId: 13 },
    ],
    ancillary_services: [
      {
        id: 1,
        code: "BAG",
        name: "Bag",
        category: "baggage",
        price: 5000,
        currency: "SAR",
        available: true,
      },
      {
        id: 2,
        code: "MEAL",
        name: "Meal",
        category: "meal",
        price: 0,
        currency: "SAR",
        available: true,
      },
    ],
  });
  state.db = fixture.db;
});

it.each([
  ["BAG", 12],
  ["MEAL", 13],
  ["BAG", 999],
  ["BAG", undefined],
] as const)(
  "declines kiosk issuance for %s on sector %s without recording a sale",
  async (serviceType, flightId) => {
    await expect(
      caller.addAncillary({
        capabilityToken,
        passengerId: 11,
        serviceType,
        flightId,
      })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(fixture.rows("booking_ancillaries")).toHaveLength(0);
    expect(fixture.rows("kiosk_sessions")).toHaveLength(0);
    expect(fixture.rows("bookings")[0].totalAmount).toBe(12000);
  }
);
it("still rejects a passenger outside the kiosk session", async () => {
  await expect(
    caller.addAncillary({
      capabilityToken,
      passengerId: 22,
      serviceType: "BAG",
      flightId: 12,
    })
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
});
