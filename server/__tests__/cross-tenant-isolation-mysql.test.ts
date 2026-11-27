import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type mysql from "mysql2/promise";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import * as schema from "../../drizzle/schema";
import type { TrpcContext } from "../_core/context";
import { closePool } from "../db";
import {
  createPaidBookingNativeFixture,
  type PaidBookingNativeFixture,
} from "./helpers/paid-booking-native-fixture";

/**
 * Scenario S-28 of docs/architecture/improvement-plan-2026-11.md: cross-tenant
 * read and write. A user of tenant B calls every covered tenant-scoped
 * procedure of the application router against tenant A's booking, passengers,
 * PNR and flight. Each call must be refused with NOT_FOUND or FORBIDDEN before
 * any database write; the proof of "before any write" is a CHECKSUM TABLE of
 * every table in the disposable schema, compared before and after each call.
 *
 * The suite also checks, per procedure, that a foreign row and a missing row
 * are answered alike (NOT_FOUND for both), as the owner decided on
 * 2026-11-14 (#327): a caller cannot learn that another tenant's row exists.
 */
vi.mock("../_core/middleware/procedure-rate-limit", () => ({
  enforceProcedureRateLimit: vi.fn(),
}));

const nativeDescribe =
  process.env.AIS_DISPOSABLE_DATABASE === "true" &&
  process.env.NODE_ENV === "test" &&
  process.env.DATABASE_URL
    ? describe
    : describe.skip;

type AppRouter = typeof import("../routers").appRouter;
type Caller = ReturnType<AppRouter["createCaller"]>;
type Refusal = "NOT_FOUND" | "FORBIDDEN";

/** One covered procedure: how to call it against tenant A's resources, and
 * how it answers a foreign row today. `missing` is the answer for a row that
 * does not exist; equal codes mean foreign and missing are indistinguishable. */
type Probe = {
  path: string;
  kind: "query" | "mutation";
  call: (caller: Caller, ids: Ids) => Promise<unknown>;
  foreign: Refusal;
  missing: Refusal;
};
type Ids = {
  bookingId: number;
  passengerId: number;
  pnr: string;
  flightId: number;
};

const TENANT_A = {
  tenantId: 3,
  bookingId: 71,
  passengerId: 81,
  pnr: "PN0071",
  flightId: 41,
};
const MISSING: Ids = {
  bookingId: 7_100_000,
  passengerId: 8_100_000,
  pnr: "ZZ9999",
  flightId: 41,
};
const TENANT_B_USER = { id: 10, role: "user" as const, tenantId: 4 };

const probes: Probe[] = [
  {
    path: "bookings.getByPNR",
    kind: "query",
    call: (c, ids) => c.bookings.getByPNR({ pnr: ids.pnr }),
    foreign: "NOT_FOUND",
    missing: "NOT_FOUND",
  },
  {
    path: "bookings.getPassengers",
    kind: "query",
    call: (c, ids) => c.bookings.getPassengers({ bookingId: ids.bookingId }),
    foreign: "NOT_FOUND",
    missing: "NOT_FOUND",
  },
  {
    path: "bookings.cancel",
    kind: "mutation",
    call: (c, ids) => c.bookings.cancel({ bookingId: ids.bookingId }),
    foreign: "NOT_FOUND",
    missing: "NOT_FOUND",
  },
  {
    path: "refunds.checkRefundable",
    kind: "query",
    call: (c, ids) => c.refunds.checkRefundable({ bookingId: ids.bookingId }),
    foreign: "NOT_FOUND",
    missing: "NOT_FOUND",
  },
  {
    path: "refunds.create",
    kind: "mutation",
    call: (c, ids) =>
      c.refunds.create({
        bookingId: ids.bookingId,
        reason: "cross-tenant probe",
      }),
    foreign: "NOT_FOUND",
    missing: "NOT_FOUND",
  },
  {
    path: "splitPayments.getStatus",
    kind: "query",
    call: (c, ids) => c.splitPayments.getStatus({ bookingId: ids.bookingId }),
    foreign: "NOT_FOUND",
    missing: "NOT_FOUND",
  },
  {
    path: "payments.createCheckoutSession",
    kind: "mutation",
    call: (c, ids) =>
      c.payments.createCheckoutSession({ bookingId: ids.bookingId }),
    foreign: "NOT_FOUND",
    missing: "NOT_FOUND",
  },
  {
    path: "seatMap.selectSeat",
    kind: "mutation",
    call: (c, ids) =>
      c.seatMap.selectSeat({
        flightId: ids.flightId,
        seatNumber: "12A",
        bookingId: ids.bookingId,
        passengerId: ids.passengerId,
      }),
    foreign: "NOT_FOUND",
    missing: "NOT_FOUND",
  },
  {
    path: "specialServices.getBookingServices",
    kind: "query",
    call: (c, ids) =>
      c.specialServices.getBookingServices({ bookingId: ids.bookingId }),
    foreign: "NOT_FOUND",
    missing: "NOT_FOUND",
  },
  {
    path: "baggage.getBookingBaggage",
    kind: "query",
    call: (c, ids) => c.baggage.getBookingBaggage({ bookingId: ids.bookingId }),
    foreign: "NOT_FOUND",
    missing: "NOT_FOUND",
  },
  {
    path: "ancillary.getBookingAncillaries",
    kind: "query",
    call: (c, ids) =>
      c.ancillary.getBookingAncillaries({ bookingId: ids.bookingId }),
    foreign: "NOT_FOUND",
    missing: "NOT_FOUND",
  },
  {
    path: "ancillary.addToBooking",
    kind: "mutation",
    call: (c, ids) =>
      c.ancillary.addToBooking({
        bookingId: ids.bookingId,
        ancillaryServiceId: 1,
        idempotencyKey: `s28-${randomUUID()}`,
      }),
    foreign: "NOT_FOUND",
    missing: "NOT_FOUND",
  },
  {
    path: "eticket.generateETicket",
    kind: "mutation",
    call: (c, ids) =>
      c.eticket.generateETicket({
        bookingId: ids.bookingId,
        passengerId: ids.passengerId,
      }),
    foreign: "NOT_FOUND",
    missing: "NOT_FOUND",
  },
  {
    path: "emd.getByBooking",
    kind: "query",
    call: (c, ids) => c.emd.getByBooking({ bookingId: ids.bookingId }),
    foreign: "NOT_FOUND",
    missing: "NOT_FOUND",
  },
  {
    path: "apis.submitInfo",
    kind: "mutation",
    call: (c, ids) =>
      c.apis.submitInfo({
        passengerId: ids.passengerId,
        documentType: "passport",
        documentNumber: "X1234567",
        issuingCountry: "SA",
        nationality: "SA",
        dateOfBirth: "1990-01-01",
        gender: "M",
        expiryDate: "2035-01-01",
        givenNames: "Alpha",
        surname: "Native",
      }),
    foreign: "NOT_FOUND",
    missing: "NOT_FOUND",
  },
  {
    path: "rebooking.getRebookData",
    kind: "query",
    call: (c, ids) => c.rebooking.getRebookData({ bookingId: ids.bookingId }),
    foreign: "NOT_FOUND",
    missing: "NOT_FOUND",
  },
  {
    path: "softDelete.deleteBooking",
    kind: "mutation",
    call: (c, ids) => c.softDelete.deleteBooking({ bookingId: ids.bookingId }),
    foreign: "NOT_FOUND",
    missing: "NOT_FOUND",
  },
  {
    path: "travelScenarios.getShareableItinerary",
    kind: "query",
    call: (c, ids) =>
      c.travelScenarios.getShareableItinerary({ bookingId: ids.bookingId }),
    foreign: "NOT_FOUND",
    missing: "NOT_FOUND",
  },
  {
    path: "compensation.fileClaim",
    kind: "mutation",
    call: (c, ids) =>
      c.compensation.fileClaim({
        bookingId: ids.bookingId,
        regulationType: "eu261",
        claimType: "delay",
      }),
    foreign: "NOT_FOUND",
    missing: "NOT_FOUND",
  },
  {
    path: "modifications.requestChangeDate",
    kind: "mutation",
    call: (c, ids) =>
      c.modifications.requestChangeDate({
        bookingId: ids.bookingId,
        newFlightId: 42,
      }),
    foreign: "NOT_FOUND",
    missing: "NOT_FOUND",
  },
  {
    path: "multiCity.getSegments",
    kind: "query",
    call: (c, ids) => c.multiCity.getSegments({ bookingId: ids.bookingId }),
    foreign: "NOT_FOUND",
    missing: "NOT_FOUND",
  },
  {
    path: "boardingPass.issue",
    kind: "mutation",
    call: (c, ids) =>
      c.boardingPass.issue({
        bookingId: ids.bookingId,
        passengerId: ids.passengerId,
      }),
    foreign: "NOT_FOUND",
    missing: "NOT_FOUND",
  },
];

nativeDescribe.sequential(
  "cross-tenant isolation on native MySQL (S-28)",
  () => {
    let fixture: PaidBookingNativeFixture;
    let appRouter: AppRouter;
    const originalDatabaseUrl = process.env.DATABASE_URL;

    beforeAll(async () => {
      fixture = await createPaidBookingNativeFixture("ais_confirmation");
      process.env.DATABASE_URL = fixture.databaseUrl;
      ({ appRouter } = await import("../routers"));
    }, 60000);

    afterAll(async () => {
      await closePool().catch(() => undefined);
      process.env.DATABASE_URL = originalDatabaseUrl;
      await fixture?.close();
    });

    beforeEach(async () => {
      await fixture.reset();
      await fixture.seed();
      // Tenant A's booking is paid and confirmed so that every covered
      // procedure reaches its ownership check rather than a payment-state check.
      await fixture.pool.query(
        "UPDATE bookings SET status='confirmed', paymentStatus='paid', seatsReserved=1 WHERE id=71"
      );
      // Tenant B: its own active tenant and a plain user who owns nothing here.
      await fixture.db.insert(schema.tenants).values({
        id: 4,
        slug: "native-other-tenant",
        name: "Native other tenant",
        status: "active",
      });
      await fixture.db.insert(schema.users).values({
        id: 10,
        openId: "native-other-tenant-user",
        tenantId: 4,
        role: "user",
        name: "Synthetic Outsider",
        email: "outsider@example.test",
      });
    });

    const callerFor = (user: { id: number; role: string; tenantId: number }) =>
      appRouter.createCaller({
        user,
        tenantId: user.tenantId,
        authMethod: "cookie",
        req: { headers: {}, ip: "198.51.100.28", id: "req-native-s28" },
        res: {},
      } as unknown as TrpcContext);

    /** CHECKSUM TABLE over every table of the disposable schema: the whole
     * database, not a chosen subset, must be unchanged after a refusal. */
    async function checksums(): Promise<Record<string, string>> {
      const [tables] = await fixture.admin.query<mysql.RowDataPacket[]>(
        "SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_TYPE='BASE TABLE'",
        [fixture.databaseName]
      );
      const names = tables.map(
        row => `\`${fixture.databaseName}\`.\`${row.name}\``
      );
      const [rows] = await fixture.admin.query<mysql.RowDataPacket[]>(
        `CHECKSUM TABLE ${names.join(", ")}`
      );
      return Object.fromEntries(
        rows.map(row => [String(row.Table), String(row.Checksum)])
      );
    }

    async function refusal(promise: Promise<unknown>): Promise<string> {
      try {
        await promise;
        return "ADMITTED";
      } catch (error) {
        const code = (error as { code?: string }).code ?? "UNKNOWN";
        if (code !== "NOT_FOUND" && code !== "FORBIDDEN")
          console.error(
            "S-28 unexpected refusal",
            code,
            (error as Error).message
          );
        return code;
      }
    }

    it("covers every probe exactly once and names a refusal for both cells", () => {
      const paths = probes.map(probe => probe.path);
      expect(new Set(paths).size).toBe(paths.length);
      expect(paths.length).toBeGreaterThanOrEqual(20);
      for (const probe of probes) {
        expect(["NOT_FOUND", "FORBIDDEN"], probe.path).toContain(probe.foreign);
        expect(["NOT_FOUND", "FORBIDDEN"], probe.path).toContain(probe.missing);
      }
    });

    it("refuses a tenant B user on every covered procedure against tenant A's resources without writing anything", async () => {
      const outsider = callerFor(TENANT_B_USER);
      const before = await checksums();
      const outcomes: Record<string, string> = {};
      for (const probe of probes) {
        outcomes[probe.path] = await refusal(probe.call(outsider, TENANT_A));
      }
      const admitted = Object.entries(outcomes).filter(
        ([, code]) => code !== "NOT_FOUND" && code !== "FORBIDDEN"
      );
      // A path listed here reached tenant A's data, or failed for a reason other
      // than ownership (which means the ownership check is not the first guard).
      expect(admitted).toEqual([]);
      expect(await checksums()).toEqual(before);
      expect(Object.keys(before).length).toBeGreaterThan(100);
    });

    it("answers foreign and missing rows exactly as recorded, so any drift in distinguishability is seen", async () => {
      const outsider = callerFor(TENANT_B_USER);
      const actual: Record<string, { foreign: string; missing: string }> = {};
      for (const probe of probes) {
        actual[probe.path] = {
          foreign: await refusal(probe.call(outsider, TENANT_A)),
          missing: await refusal(probe.call(outsider, MISSING)),
        };
      }
      const expected = Object.fromEntries(
        probes.map(probe => [
          probe.path,
          { foreign: probe.foreign, missing: probe.missing },
        ])
      );
      expect(actual).toEqual(expected);
    });

    it("reports which covered procedures still tell a foreign row from a missing one", () => {
      const distinguishable = probes
        .filter(probe => probe.foreign !== probe.missing)
        .map(probe => probe.path)
        .sort();
      const indistinguishable = probes
        .filter(probe => probe.foreign === probe.missing)
        .map(probe => probe.path)
        .sort();
      // Documented state on 2026-11-14. The plan's target is an empty
      // `distinguishable` list; closing it is a product change (FORBIDDEN to
      // NOT_FOUND on foreign rows) that needs the owner's decision. Until then
      // the two lists are pinned so a change in either direction is reviewed.
      // Owner decision of 2026-11-14 (#327): foreign and missing rows are
      // answered alike. Every covered procedure must stay in this list; a path
      // that reappears under `distinguishable` is a regression.
      expect(distinguishable).toEqual([]);
      expect(indistinguishable).toEqual(probes.map(probe => probe.path).sort());
    });

    it("refuses former-tenant ticket and calendar requests with no issuance on native MySQL", async () => {
      await fixture.db
        .update(schema.users)
        .set({ tenantId: 4 })
        .where(eq(schema.users.id, 9));
      const caller = callerFor({ id: 9, role: "user", tenantId: 4 });
      const before = await checksums();
      const document = {
        bookingId: TENANT_A.bookingId,
        passengerId: TENANT_A.passengerId,
      };
      await expect(
        caller.eticket.generateETicket(document)
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(
        caller.eticket.generateCalendarEvent({ bookingId: document.bookingId })
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect(await checksums()).toEqual(before);
    });

    it("refuses every old-tenant buyer rail and both history APIs after reassignment", async () => {
      await fixture.db
        .update(schema.bookings)
        .set({
          status: "pending",
          paymentStatus: "pending",
          seatsReserved: false,
        })
        .where(eq(schema.bookings.id, 71));
      await fixture.db.insert(schema.payments).values({
        bookingId: 71,
        amount: 20000,
        currency: "SAR",
        method: "card",
        status: "completed",
      });
      await fixture.db
        .update(schema.users)
        .set({ tenantId: 4 })
        .where(eq(schema.users.id, 9));
      const c = callerFor({ id: 9, role: "user", tenantId: 4 });
      const input = { bookingId: 71 };
      const before = await checksums();
      const rails = [
        () => c.payments.getCheckoutState(input),
        () => c.payments.createCheckoutSession(input),
        () => c.wallet.pay(input),
        () =>
          c.vouchers.applyVoucher({ ...input, code: "TEST", amount: 20000 }),
        () => c.vouchers.useCredits({ ...input, amount: 20000 }),
        () =>
          c.splitPayments.initiate({
            ...input,
            splits: [
              { name: "First", email: "first@example.test", amount: 10000 },
              { name: "Second", email: "second@example.test", amount: 10000 },
            ],
          }),
      ];
      for (const rail of rails)
        await expect(rail()).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect(await c.payments.getHistory({})).toEqual([]);
      expect(await c.paymentHistory.myPayments({})).toEqual([]);
      for (const stats of [
        await c.payments.getStats(),
        await c.paymentHistory.myStats(),
      ])
        expect(stats).toMatchObject({
          totalPayments: 0,
          totalAmount: 0,
          refundedAmount: 0,
        });
      expect(await checksums()).toEqual(before);
    });

    it("allows delegated corporate funding only while both buyer and administrator are in scope", async () => {
      await fixture.db
        .update(schema.bookings)
        .set({
          status: "pending",
          paymentStatus: "pending",
          seatsReserved: false,
        })
        .where(eq(schema.bookings.id, 71));
      await fixture.db.insert(schema.corporateAccounts).values({
        id: 1,
        companyName: "Fixture company",
        taxId: "SYNTH-1",
        contactName: "Admin",
        contactEmail: "corp@example.test",
        creditLimit: 60000,
        discountPercent: "10",
        status: "active",
      });
      await fixture.db.insert(schema.corporateUsers).values([
        { userId: 9, corporateAccountId: 1, role: "traveler" },
        { userId: 10, corporateAccountId: 1, role: "admin" },
      ]);
      await fixture.db.insert(schema.corporateBookings).values({
        id: 1,
        bookingId: 71,
        bookedByUserId: 9,
        corporateAccountId: 1,
        approvalStatus: "pending",
      });
      const foreign = callerFor({ id: 10, role: "user", tenantId: 4 });
      const before = await checksums();
      await expect(
        foreign.corporate.approveBooking({ id: 1 })
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(
        foreign.corporate.payInvoice({ bookingId: 71 })
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect(await checksums()).toEqual(before);
      await fixture.db
        .update(schema.users)
        .set({ tenantId: 3 })
        .where(eq(schema.users.id, 10));
      const current = callerFor({ id: 10, role: "user", tenantId: 3 });
      await current.corporate.approveBooking({ id: 1 });
      const settlement = await current.corporate.payInvoice({ bookingId: 71 });
      expect(await current.corporate.payInvoice({ bookingId: 71 })).toEqual(
        settlement
      );
      const [company] = await fixture.db
        .select()
        .from(schema.corporateAccounts);
      expect(company.balance).toBe(-18000);
      await fixture.db
        .update(schema.users)
        .set({ tenantId: 4 })
        .where(eq(schema.users.id, 9));
      const after = await checksums();
      await expect(
        current.corporate.payInvoice({ bookingId: 71 })
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect(await checksums()).toEqual(after);
    });

    it("removes claim, disruption and seat access after the purchaser moves airlines", async () => {
      const beforeMove = callerFor({ id: 9, role: "user", tenantId: 3 });
      const bookingId = 71;
      const passengerId = 81;
      const flightId = 41;
      const claim = {
        bookingId,
        passengerId,
        flightId,
        regulationType: "local" as const,
        claimType: "delay" as const,
      };
      const filed = await beforeMove.compensation.fileClaim(claim);
      expect(
        (await beforeMove.compensation.claimTargets({ bookingId })).passengers
      ).toHaveLength(2);
      await fixture.db
        .insert(schema.flightDisruptions)
        .values({
          flightId,
          type: "delay",
          reason: "Synthetic delay",
          severity: "minor",
        });
      expect(await beforeMove.disruptions.myDisruptions()).toHaveLength(1);
      await fixture.db
        .insert(schema.seatInventory)
        .values(
          ["A", "B"].map(column => ({
            flightId,
            seatMapId: 1,
            seatNumber: "1" + column,
            row: 1,
            column,
            cabinClass: "economy" as const,
            seatType: "window" as const,
          }))
        );
      await beforeMove.seatMap.selectSeat({
        bookingId,
        passengerId,
        flightId,
        seatNumber: "1A",
      });
      const { selectSeat, changeSeat } =
        await import("../services/seat-map.service");
      await fixture.db
        .update(schema.users)
        .set({ tenantId: 4 })
        .where(eq(schema.users.id, 9));
      const c = callerFor({ id: 9, role: "user", tenantId: 4 });
      const before = await checksums();
      expect(await c.disruptions.myDisruptions()).toEqual([]);
      expect(await c.compensation.getMyClaims()).toEqual([]);
      const refused = [
        () => c.compensation.claimTargets({ bookingId }),
        () => c.compensation.fileClaim(claim),
        () => c.compensation.getClaimDetail({ claimId: filed.id }),
        () =>
          c.compensation.checkEligibility({
            bookingId,
            flightId,
            disruptionType: "delay",
          }),
        () => c.seatMap.getPassengerSeat({ bookingId, passengerId, flightId }),
        () =>
          c.seatMap.selectSeat({
            bookingId,
            passengerId,
            flightId,
            seatNumber: "1B",
          }),
        () =>
          c.seatMap.changeSeat({
            bookingId,
            passengerId,
            flightId,
            oldSeatNumber: "1A",
            newSeatNumber: "1B",
          }),
        () =>
          c.seatMap.checkIn({
            bookingId,
            passengerId,
            flightId,
            seatNumber: "1A",
          }),
        () => selectSeat(flightId, "1B", bookingId, passengerId, undefined, 9),
        () => changeSeat(flightId, "1A", "1B", bookingId, passengerId, 9),
      ];
      for (const action of refused)
        await expect(action()).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect(await checksums()).toEqual(before);
    });

    it("still serves the owner of tenant A the same resources", async () => {
      const owner = callerFor({ id: 9, role: "user", tenantId: 3 });
      const passengers = await owner.bookings.getPassengers({
        bookingId: TENANT_A.bookingId,
      });
      expect(passengers.map(p => p.id).sort()).toEqual([81, 82]);
      const byPnr = await owner.bookings.getByPNR({ pnr: TENANT_A.pnr });
      expect(byPnr).toMatchObject({ id: 71 });
    });
  }
);
