import { beforeEach, expect, it, vi } from "vitest";
import type { TrpcContext } from "../_core/context";
import { transactionMemory } from "../__tests__/helpers/transaction-memory";
import { issueSelfServiceCapability } from "../services/self-service-capability.service";
import { kioskRouter } from "./kiosk";

const state = vi.hoisted(() => ({ db: null as any }));
vi.mock("../db", () => ({ getDb: () => state.db }));
const caller = kioskRouter.createCaller({ user: null } as TrpcContext);
const tag = "0065123456";
const input = {
  capabilityToken: issueSelfServiceCapability({
    kind: "kiosk-session",
    sessionId: 1,
    bookingId: 1,
    passengerIds: [2, 3],
  }),
  passengerId: 2,
  flightId: 5,
  bagCount: 1,
  tagNumbers: [tag],
};
let fixture: ReturnType<typeof transactionMemory>;

beforeEach(() => {
  const departureTime = new Date(Date.now() + 4 * 3600000);
  const arrivalTime = new Date(Date.now() + 6 * 3600000);
  fixture = transactionMemory({
    bookings: [
      {
        id: 1,
        bookingReference: "TRAVEL",
        status: "confirmed",
        paymentStatus: "paid",
        flightId: 4,
        cabinClass: "economy",
        checkedIn: true,
        deletedAt: null,
        tenantId: null,
      },
    ],
    passengers: [2, 3].map(id => ({
      id,
      bookingId: 1,
      firstName: "P" + id,
      lastName: "Journey",
      tenantId: null,
    })),
    booking_segments: [
      {
        id: 10,
        bookingId: 1,
        flightId: 4,
        segmentOrder: 1,
        status: "confirmed",
        seatsReserved: true,
      },
      {
        id: 11,
        bookingId: 1,
        flightId: 5,
        segmentOrder: 2,
        status: "confirmed",
        seatsReserved: true,
      },
    ],
    flights: [
      { id: 4, originId: 6, destinationId: 7, flightNumber: "XX101" },
      { id: 5, originId: 7, destinationId: 6, flightNumber: "XX102" },
    ].map(f => ({
      ...f,
      departureTime,
      arrivalTime,
      tenantId: null,
      status: "scheduled",
    })),
    airports: [
      { id: 6, code: "AAA", country: "SA" },
      { id: 7, code: "BBB", country: "SA" },
    ],
    seat_inventory: [
      {
        id: 12,
        bookingId: 1,
        passengerId: 2,
        flightId: 5,
        seatNumber: "1A",
        status: "checked_in",
        checkedInAt: new Date(),
        boardingSequence: 1,
        checkInNonce: "current",
        cabinClass: "economy",
      },
    ],
    baggage_items: [
      {
        id: 8,
        bookingId: 1,
        passengerId: 2,
        tagNumber: tag,
        status: "loading",
      },
    ],
    baggage_custody_events: [
      {
        id: 9,
        baggageId: 8,
        flightId: 5,
        airportId: 7,
        stage: "transfer",
        observedAt: new Date(),
      },
    ],
  });
  state.db = fixture.db;
});

it("returns the same existing plate and return routing without a hardware acknowledgement or side effects", async () => {
  const document = await caller.printBagTag(input);
  expect(document).toMatchObject({
    printStatus: "document_ready",
    totalBags: 1,
    bagTags: [
      {
        tagNumber: tag,
        barcodeData: tag,
        origin: "BBB",
        destination: "AAA",
        flightNumber: "XX102",
        printedAt: null,
      },
    ],
  });
  expect(await caller.printBagTag(input)).toEqual(document);
  expect(fixture.rows("baggage_items")).toHaveLength(1);
  expect(fixture.rows("baggage_custody_events")).toHaveLength(1);
  expect(fixture.rows("kiosk_sessions")).toEqual([]);
});

it("requires precise physical identities and passenger/sector check-in", async () => {
  for (const patch of [
    { tagNumbers: undefined },
    { bagCount: 2, tagNumbers: [tag, tag] },
    { tagNumbers: ["0065000000"] },
    { flightId: 4 },
    { passengerId: 3 },
    { passengerId: 999 },
    { flightId: 999 },
  ]) {
    await expect(caller.printBagTag({ ...input, ...patch })).rejects.toThrow();
  }
  expect(fixture.rows("kiosk_sessions")).toEqual([]);
});

it.each(["loading", "arrival"])(
  "refuses a tag whose most recent custody is %s",
  async stage => {
    const event = fixture.rows("baggage_custody_events")[0];
    fixture
      .rows("baggage_custody_events")
      .push({
        ...event,
        id: 10,
        stage,
        observedAt: new Date(event.observedAt.getTime() + 1000),
      });
    await expect(caller.printBagTag(input)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
  }
);

it.each(["flightId", "airportId", "baggageId"])(
  "requires custody matching %s",
  async field => {
    fixture.rows("baggage_custody_events")[0][field] = 999;
    await expect(caller.printBagTag(input)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
  }
);

it("refuses unpaid or cancelled bookings even with current custody and a checked-in seat", async () => {
  fixture.rows("bookings")[0].paymentStatus = "refunded";
  await expect(caller.printBagTag(input)).rejects.toMatchObject({
    code: "PRECONDITION_FAILED",
  });
  fixture.rows("bookings")[0].paymentStatus = "paid";
  fixture.rows("bookings")[0].status = "cancelled";
  await expect(caller.printBagTag(input)).rejects.toMatchObject({
    code: "PRECONDITION_FAILED",
  });
});
