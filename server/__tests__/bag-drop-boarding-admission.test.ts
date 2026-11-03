import { describe, expect, it, vi } from "vitest";
import { transactionMemory } from "./helpers/transaction-memory";
const boundary = vi.hoisted(() => ({ db: null as any }));
vi.mock("../db", () => ({ getDb: () => boundary.db }));
vi.mock("../_core/middleware/procedure-rate-limit", () => ({
  enforceProcedureRateLimit: vi.fn(),
}));
import { bagDropRouter } from "../routers/bag-drop";
import { issueBoardingPass } from "../services/boarding-pass.service";
import { verifySelfServiceCapability } from "../services/self-service-capability.service";
import { initiateBagDrop } from "../services/bag-drop.service";

const anonymous = () =>
  bagDropRouter.createCaller({
    user: null,
    tenantId: null,
    req: { headers: {} },
    res: {},
  } as never);
function itinerary() {
  const flightIds = [11, 12];
  const fixture = transactionMemory({
    bookings: [
      {
        id: 3,
        userId: 7,
        flightId: 11,
        status: "confirmed",
        paymentStatus: "paid",
        cabinClass: "economy",
        bookingReference: "TR1234",
        pnr: "TR1234",
      },
    ],
    passengers: [
      { id: 4, bookingId: 3, firstName: "Sample", lastName: "Traveler" },
    ],
    // Carrier and airport codes feed the IATA BCBP leg issued with each pass.
    airlines: [{ id: 1, code: "SV", name: "Sample Carrier" }],
    airports: [
      { id: 1, code: "RUH", country: "SA", timezone: "Asia/Riyadh" },
      { id: 2, code: "JED", country: "SA", timezone: "Asia/Riyadh" },
      { id: 3, code: "DMM", country: "SA", timezone: "Asia/Riyadh" },
    ],
    flights: flightIds.map((id, i) => ({
      id,
      flightNumber: "SV" + id,
      airlineId: 1,
      originId: i + 1,
      destinationId: i + 2,
      status: "scheduled",
      departureTime: new Date(Date.now() + (2 + i * 3) * 3600000),
      arrivalTime: new Date(Date.now() + (3 + i * 3) * 3600000),
    })),
    booking_segments: flightIds.map((flightId, i) => ({
      id: 11 + i,
      bookingId: 3,
      flightId,
      segmentOrder: i + 1,
      status: "confirmed",
      seatsReserved: true,
    })),
    seat_inventory: flightIds.map((flightId, i) => ({
      id: 5 + i,
      flightId,
      bookingId: 3,
      passengerId: 4,
      status: "checked_in",
      checkedInAt: new Date(),
      checkInNonce: "8c78e2e3-99ef-4c26-9838-a61bc155168e",
      boardingSequence: 1,
      seatNumber: "12A",
      cabinClass: "economy",
    })),
  });
  boundary.db = fixture.db;
  return fixture;
}
async function ticket(flightId: number) {
  return (
    await issueBoardingPass(
      { bookingId: 3, passengerId: 4, flightId },
      { userId: 7 }
    )
  ).token;
}
describe("bag-drop pass redemption", () => {
  it("rejects a revoked pass at scan and a grant revoked between scan and redemption", async () => {
    const fixture = itinerary(),
      token = await ticket(11);
    const grant = await anonymous().scanPass({ boardingPassToken: token });
    fixture.rows("seat_inventory")[0].checkInNonce =
      "8c78e2e3-99ef-4c26-9838-a61bc155168a";
    await expect(
      anonymous().scanPass({ boardingPassToken: token })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(
      anonymous().initiate({ capabilityToken: grant.capabilityToken })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(fixture.rows("bag_drop_sessions")).toHaveLength(0);
  });
  it("keeps onward passes out of a primary-leg bag drop and admits current primary passes", async () => {
    const fixture = itinerary();
    const onward = await anonymous().scanPass({
      boardingPassToken: await ticket(12),
    });
    await expect(
      anonymous().initiate({ capabilityToken: onward.capabilityToken })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(fixture.rows("bag_drop_sessions")).toHaveLength(0);
    const primary = await anonymous().scanPass({
      boardingPassToken: await ticket(11),
    });
    const admission = verifySelfServiceCapability(
      primary.capabilityToken,
      "bag-drop-admission"
    );
    const session = await initiateBagDrop(
      admission.bookingId,
      admission.passengerId,
      admission
    );
    expect(session.entitlementSegmentId).toBe(11);
  });
});
