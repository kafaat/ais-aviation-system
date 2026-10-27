/**
 * Authorization boundaries closed by the October 2026 review. Each case is a
 * handler that accepted a client-supplied identifier (a bag tag, an EMD
 * number, a provider session id, a user id) and acted on it without tying it
 * to the caller. The identifiers are printed on documents or carried in URLs,
 * so they are not credentials.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName } from "drizzle-orm";
import type { TrpcContext } from "../_core/context";

const boundary = vi.hoisted(() => ({
  rows: {} as Record<string, any[]>,
  bookingOwner: 101,
  reportLost: vi.fn(),
  getByTag: vi.fn(),
  track: vi.fn(),
  assessFraud: vi.fn(),
  getEmd: vi.fn(),
  addUser: vi.fn(),
  retrieveSession: vi.fn(),
}));

vi.mock("../db", () => ({
  getDb: () => ({
    select() {
      let table = "";
      const query: any = {
        from(value: Parameters<typeof getTableName>[0]) {
          table = getTableName(value);
          return query;
        },
        where: () => query,
        limit: () => Promise.resolve(boundary.rows[table] ?? []),
      };
      return query;
    },
  }),
}));
vi.mock("../_core/middleware/procedure-rate-limit", () => ({
  enforceProcedureRateLimit: vi.fn(),
}));
vi.mock("../services/access-control.service", async importOriginal => ({
  ...(await importOriginal<object>()),
  assertBookingOwnership: vi.fn(
    async (bookingId: number, userId: number, role?: string) => {
      if (userId !== boundary.bookingOwner && role !== "admin") {
        const { TRPCError } = await import("@trpc/server");
        throw new TRPCError({ code: "FORBIDDEN", message: "Access denied" });
      }
      return boundary.bookingOwner;
    }
  ),
  isBookingOwnedBy: vi.fn(
    async (_bookingId: number, userId: number) =>
      userId === boundary.bookingOwner
  ),
}));
vi.mock("../services/baggage.service", async importOriginal => ({
  ...(await importOriginal<object>()),
  getBaggageByTag: boundary.getByTag,
  reportLostBaggage: boundary.reportLost,
  trackBaggage: boundary.track,
}));
vi.mock("../services/intelligence", () => ({
  intelligenceKernel: { assessBookingFraud: boundary.assessFraud },
}));
vi.mock("../services/emd.service", async importOriginal => ({
  ...(await importOriginal<object>()),
  getEmd: boundary.getEmd,
}));
vi.mock("../services/corporate.service", async importOriginal => ({
  ...(await importOriginal<object>()),
  addUserToCorporate: boundary.addUser,
}));
vi.mock("../stripe", () => ({
  stripe: { checkout: { sessions: { retrieve: boundary.retrieveSession } } },
}));

import { baggageRouter } from "../routers/baggage";
import { intelligenceRouter } from "../routers/intelligence.router";
import { emdRouter } from "../routers/emd";
import { corporateRouter } from "../routers/corporate";
import { paymentsRouter } from "../routers/payments";
import { specialServicesRouter } from "../routers/special-services";
import { ancillaryRouter } from "../routers/ancillary";

function context(id: number, role = "user"): TrpcContext {
  return {
    user: { id, role, tenantId: 1 },
    tenantId: 1,
    req: { headers: {} },
    res: {},
  } as TrpcContext;
}
const owner = () => context(101);
const stranger = () => context(202);
const admin = () => context(303, "admin");

const bag = {
  id: 7,
  status: "checked_in" as const,
  createdAt: new Date("2026-10-01T00:00:00Z"),
  updatedAt: new Date("2026-10-01T00:00:00Z"),
  description: null,
  bookingId: 800,
  passengerId: 700,
  tagNumber: "AIS1234567",
  weight: "23.00",
  lastLocation: null,
  specialHandling: null,
  lostReportedAt: new Date("2026-10-02T00:00:00Z"),
  lostDescription: "Black case\nContact Email: owner@example.com",
};

beforeEach(() => {
  boundary.rows = {};
  boundary.getByTag.mockReset().mockResolvedValue(bag);
  boundary.track.mockReset().mockResolvedValue({ baggage: bag, tracking: [] });
  boundary.reportLost
    .mockReset()
    .mockResolvedValue({ success: true, baggage: { ...bag, status: "lost" } });
  boundary.assessFraud.mockReset();
  boundary.getEmd.mockReset();
  boundary.addUser.mockReset();
  boundary.retrieveSession
    .mockReset()
    .mockResolvedValue({ payment_status: "paid", customer_email: "o@x.test" });
});

describe("baggage: a bag tag is not a credential", () => {
  it("lets only the booking owner (or an admin) report the bag lost", async () => {
    const input = {
      tagNumber: bag.tagNumber,
      description: "Black hard case with a red strap",
      contactEmail: "attacker@example.com",
    };
    await expect(
      baggageRouter.createCaller(stranger()).reportLost(input)
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(boundary.reportLost).not.toHaveBeenCalled();

    await baggageRouter.createCaller(owner()).reportLost(input);
    await baggageRouter.createCaller(admin()).reportLost(input);
    expect(boundary.reportLost).toHaveBeenCalledTimes(2);
  });

  it("answers NOT_FOUND for an unknown tag before any write", async () => {
    boundary.getByTag.mockResolvedValue(null);
    await expect(
      baggageRouter.createCaller(owner()).reportLost({
        tagNumber: "AISUNKNOWN",
        description: "Black hard case with a red strap",
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(boundary.reportLost).not.toHaveBeenCalled();
  });

  it("never returns the lost-report contact details on the public tracker", async () => {
    const anonymous = baggageRouter.createCaller({
      user: null,
      tenantId: null,
      req: { headers: {} },
      res: {},
    } as any);
    const tracked = await anonymous.track({ tagNumber: bag.tagNumber });
    expect(tracked.baggage.lostDescription).toBeNull();
    expect(tracked.baggage.status).toBe("checked_in");
    const looked = await anonymous.getByTag({ tagNumber: bag.tagNumber });
    expect(looked.lostDescription).toBeNull();
  });
});

describe("intelligence: fraud profiling is an admin tool", () => {
  it("refuses a regular user before the kernel runs", async () => {
    await expect(
      intelligenceRouter
        .createCaller(owner())
        .assessFraud({ bookingId: 800, userId: 202 })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(boundary.assessFraud).not.toHaveBeenCalled();
  });
});

describe("emd: a document number is visible to its booking owner or an admin", () => {
  const at = new Date("2026-10-01T00:00:00Z");
  const emd = {
    id: 1,
    emdNumber: "06512345678901",
    emdType: "EMD-S" as const,
    status: "void" as const,
    reasonForIssuance: "baggage" as const,
    createdAt: at,
    updatedAt: at,
    dateOfIssuance: at,
    flightId: null,
    bookingId: 800,
    passengerId: 700,
    ticketNumber: null,
    amount: 5000,
    taxAmount: 0,
    currency: "SAR",
    iataNumber: null,
    expiryDate: null,
    issuingAirlineId: 1,
    issuingAgentId: null,
    serviceDescription: "Extra bag",
    rficCode: null,
    rfiscCode: null,
    flightSegment: null,
    dateOfService: null,
    voidedAt: null,
    voidReason: null,
    exchangedFromEmd: null,
    booking: {
      id: 800,
      bookingReference: "ABC123",
      pnr: "PNR123",
      status: "confirmed",
    },
  };
  it("hides another user's EMD behind NOT_FOUND", async () => {
    boundary.getEmd.mockResolvedValue(emd);
    await expect(
      emdRouter.createCaller(stranger()).get({ emdNumber: emd.emdNumber })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("hides an EMD that is attached to no booking from non-admins", async () => {
    boundary.getEmd.mockResolvedValue({ ...emd, bookingId: null });
    await expect(
      emdRouter.createCaller(owner()).get({ emdNumber: emd.emdNumber })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const seen = await emdRouter
      .createCaller(admin())
      .get({ emdNumber: emd.emdNumber });
    expect(seen.success).toBe(true);
  });
  it("returns the owner's EMD", async () => {
    boundary.getEmd.mockResolvedValue(emd);
    const seen = await emdRouter
      .createCaller(owner())
      .get({ emdNumber: emd.emdNumber });
    expect(seen.data.booking?.pnr).toBe("PNR123");
  });
});

describe("corporate: direct enrolment needs a platform admin", () => {
  const input = { accountId: 5, userId: 909, role: "traveler" as const };
  it("refuses a corporate admin, who must invite instead", async () => {
    await expect(
      corporateRouter.createCaller(owner()).addUser(input)
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(boundary.addUser).not.toHaveBeenCalled();
  });
  it("lets a platform admin enrol directly", async () => {
    boundary.addUser.mockResolvedValue({
      id: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
      userId: 909,
      role: "traveler",
      isActive: true,
      corporateAccountId: 5,
    });
    const result = await corporateRouter.createCaller(admin()).addUser(input);
    expect(result.success).toBe(true);
    expect(boundary.addUser).toHaveBeenCalledWith(
      expect.objectContaining({ corporateAccountId: 5, userId: 909 })
    );
  });
});

describe("payments: a provider session id is looked up only for its owner", () => {
  it("does not reach the provider for a session the caller does not own", async () => {
    await expect(
      paymentsRouter
        .createCaller(stranger())
        .verifySession({ sessionId: "cs_test_other", provider: "stripe" })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(boundary.retrieveSession).not.toHaveBeenCalled();
  });
  it("rejects a malformed session id before any lookup", async () => {
    await expect(
      paymentsRouter
        .createCaller(owner())
        .verifySession({ sessionId: "cs_test/../x", provider: "stripe" })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(boundary.retrieveSession).not.toHaveBeenCalled();
  });
  it("verifies a session attached to the caller's own booking", async () => {
    boundary.rows.bookings = [{ id: 800 }];
    const result = await paymentsRouter
      .createCaller(owner())
      .verifySession({ sessionId: "cs_test_mine", provider: "stripe" });
    expect(result).toEqual({ status: "paid", customerEmail: "o@x.test" });
    expect(boundary.retrieveSession).toHaveBeenCalledWith("cs_test_mine");
  });
  it("verifies a split-payment session through the split's booking", async () => {
    boundary.rows.payment_splits = [{ bookingId: 800 }];
    await paymentsRouter
      .createCaller(owner())
      .verifySession({ sessionId: "cs_test_split", provider: "stripe" });
    expect(boundary.retrieveSession).toHaveBeenCalledWith("cs_test_split");
  });
  it("lets an admin verify any session", async () => {
    await paymentsRouter
      .createCaller(admin())
      .verifySession({ sessionId: "cs_test_any", provider: "stripe" });
    expect(boundary.retrieveSession).toHaveBeenCalledWith("cs_test_any");
  });
});

describe("free-form client JSON is bounded before it is persisted", () => {
  it("rejects nested or oversized special-service details", async () => {
    await expect(
      specialServicesRouter.createCaller(owner()).requestService({
        bookingId: 800,
        passengerId: 700,
        serviceType: "meal",
        serviceCode: "VGML",
        details: { nested: { deep: true } } as any,
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      specialServicesRouter.createCaller(owner()).requestService({
        bookingId: 800,
        passengerId: 700,
        serviceType: "meal",
        serviceCode: "VGML",
        details: { note: "x".repeat(501) },
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
  it("rejects nested ancillary metadata", async () => {
    await expect(
      ancillaryRouter.createCaller(owner()).addToBooking({
        bookingId: 800,
        ancillaryServiceId: 1,
        idempotencyKey: "k1",
        metadata: { seat: ["12A"] } as any,
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
