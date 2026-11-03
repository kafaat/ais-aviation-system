import { describe, expect, it, vi } from "vitest";
import { transactionMemory } from "./helpers/transaction-memory";
const boundary = vi.hoisted(() => ({ db: null as any }));
vi.mock("../db", () => ({ getDb: () => boundary.db }));
vi.mock("../_core/middleware/procedure-rate-limit", () => ({
  enforceProcedureRateLimit: vi.fn(),
}));
import { bagDropRouter } from "../routers/bag-drop";
import {
  issueBoardingPass,
  verifyActiveBoardingPass,
} from "../services/boarding-pass.service";
import { decodeBcbpM1 } from "../services/bcbp.service";

const anonymous = () =>
  bagDropRouter.createCaller({
    user: null,
    tenantId: null,
    req: { headers: {} },
    res: {},
  } as never);

/** Two-leg itinerary RUH-JED-DXB with the departure zones airport readers assume. */
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
      {
        id: 4,
        bookingId: 3,
        firstName: "Sample",
        lastName: "Traveler",
        type: "adult",
        ticketNumber: "0651234567890",
      },
    ],
    airlines: [{ id: 1, code: "SV", name: "Sample Carrier" }],
    airports: [
      { id: 1, code: "RUH", country: "SA", timezone: "Asia/Riyadh" },
      { id: 2, code: "JED", country: "SA", timezone: "Asia/Riyadh" },
      { id: 3, code: "DXB", country: "SA", timezone: "Asia/Dubai" },
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
      boardingSequence: 1 + i,
      seatNumber: "12A",
      cabinClass: "economy",
    })),
  });
  boundary.db = fixture.db;
  return fixture;
}
async function issued(flightId: number) {
  return issueBoardingPass(
    { bookingId: 3, passengerId: 4, flightId },
    { userId: 7 }
  );
}
const flipLast = (s: string) => s.slice(0, -1) + (s.endsWith("0") ? "1" : "0");

describe("BCBP scan verification", () => {
  it("issues an M1 string whose items match the stored leg", async () => {
    itinerary();
    const pass = await issued(11);
    const d = decodeBcbpM1(pass.bcbp);
    expect(d.passengerName).toBe("TRAVELER/SAMPLE");
    expect(d.pnr).toBe("TR1234");
    expect(d.departureAirport).toBe("RUH");
    expect(d.arrivalAirport).toBe("JED");
    expect(d.carrier).toBe("SV");
    expect(d.flightNumber).toBe("0011");
    expect(d.compartmentCode).toBe("Y");
    expect(d.seatNumber).toBe("012A");
    expect(d.sequence).toBe(1);
    expect(d.passengerStatus).toBe("1");
    expect(d.version).toBe(6);
    expect(d.securityData).toMatch(/^[a-f0-9]{64}$/);
    expect(pass.bcbp).toContain("0D0651234567890");
  });

  it("admits a scanned BCBP at bag drop and still accepts the signed QR layer", async () => {
    itinerary();
    const pass = await issued(11);
    const scanned = await verifyActiveBoardingPass(pass.bcbp);
    expect(scanned.valid).toBe(true);
    if (scanned.valid) {
      expect(scanned.format).toBe("bcbp");
      expect(scanned.data).toEqual(pass.payload);
      expect(scanned.expiresAt).toBeLessThanOrEqual(
        Math.floor(Date.parse(pass.payload.departureTime) / 1000)
      );
    }
    const qr = await verifyActiveBoardingPass(pass.token);
    expect(qr.valid && qr.format).toBe("jwt");
    const grant = await anonymous().scanPass({ boardingPassToken: pass.bcbp });
    expect(grant).toMatchObject({
      success: true,
      bookingId: 3,
      passengerId: 4,
      flightNumber: "SV11",
    });
    const onward = await verifyActiveBoardingPass((await issued(12)).bcbp);
    expect(onward.valid && onward.data.flightId).toBe(12);
  });

  it("rejects a BCBP whose security data or mandatory items were altered", async () => {
    itinerary();
    const pass = await issued(11);
    const tamperedSecurity = flipLast(pass.bcbp);
    const bad = await verifyActiveBoardingPass(tamperedSecurity);
    expect(bad.valid).toBe(false);
    if (!bad.valid) expect(bad.reason).toMatch(/altered/);
    await expect(
      anonymous().scanPass({ boardingPassToken: tamperedSecurity })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });

    const seatMoved = pass.bcbp.replace("012A", "013A");
    expect((await verifyActiveBoardingPass(seatMoved)).valid).toBe(false);

    const otherSequence = pass.bcbp.replace("0001 1", "0002 1");
    const seq = await verifyActiveBoardingPass(otherSequence);
    expect(seq.valid).toBe(false);
    if (!seq.valid) expect(seq.reason).toMatch(/sequence/);

    const foreignPnr = pass.bcbp.replace("TR1234 ", "ZZ9999 ");
    const pnr = await verifyActiveBoardingPass(foreignPnr);
    expect(pnr.valid).toBe(false);
    if (!pnr.valid) expect(pnr.reason).toMatch(/reservation/);

    const unsigned = pass.bcbp.slice(0, pass.bcbp.indexOf("^"));
    const none = await verifyActiveBoardingPass(unsigned);
    expect(none.valid).toBe(false);
    if (!none.valid) expect(none.reason).toMatch(/security data/);
  });

  it("rejects a BCBP once the check-in is revoked or the flight is closed", async () => {
    const fixture = itinerary();
    const pass = await issued(11);
    fixture.rows("seat_inventory")[0].checkInNonce =
      "8c78e2e3-99ef-4c26-9838-a61bc155168a";
    const revoked = await verifyActiveBoardingPass(pass.bcbp);
    expect(revoked.valid).toBe(false);
    if (!revoked.valid) expect(revoked.reason).toMatch(/revoked/);
    fixture.rows("seat_inventory")[0].checkInNonce =
      "8c78e2e3-99ef-4c26-9838-a61bc155168e";
    expect((await verifyActiveBoardingPass(pass.bcbp)).valid).toBe(true);
    fixture.rows("flights")[0].status = "cancelled";
    expect((await verifyActiveBoardingPass(pass.bcbp)).valid).toBe(false);
  });
});
