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
 * The suite also records, per procedure, whether a foreign row and a missing
 * row are told apart (FORBIDDEN versus NOT_FOUND). The plan's target is that
 * they are indistinguishable; the committed expectation below documents the
 * current answer for each procedure so a change in either direction is seen.
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
    foreign: "FORBIDDEN",
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
    foreign: "FORBIDDEN",
    missing: "NOT_FOUND",
  },
  {
    path: "splitPayments.getStatus",
    kind: "query",
    call: (c, ids) => c.splitPayments.getStatus({ bookingId: ids.bookingId }),
    foreign: "FORBIDDEN",
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
    foreign: "FORBIDDEN",
    missing: "NOT_FOUND",
  },
  {
    path: "specialServices.getBookingServices",
    kind: "query",
    call: (c, ids) =>
      c.specialServices.getBookingServices({ bookingId: ids.bookingId }),
    foreign: "FORBIDDEN",
    missing: "NOT_FOUND",
  },
  {
    path: "baggage.getBookingBaggage",
    kind: "query",
    call: (c, ids) => c.baggage.getBookingBaggage({ bookingId: ids.bookingId }),
    foreign: "FORBIDDEN",
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
    foreign: "FORBIDDEN",
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
    foreign: "FORBIDDEN",
    missing: "NOT_FOUND",
  },
  {
    path: "rebooking.getRebookData",
    kind: "query",
    call: (c, ids) => c.rebooking.getRebookData({ bookingId: ids.bookingId }),
    foreign: "FORBIDDEN",
    missing: "NOT_FOUND",
  },
  {
    path: "softDelete.deleteBooking",
    kind: "mutation",
    call: (c, ids) => c.softDelete.deleteBooking({ bookingId: ids.bookingId }),
    foreign: "FORBIDDEN",
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
    foreign: "FORBIDDEN",
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
    foreign: "FORBIDDEN",
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
      expect(distinguishable).toEqual([
        "apis.submitInfo",
        "baggage.getBookingBaggage",
        "boardingPass.issue",
        "emd.getByBooking",
        "multiCity.getSegments",
        "rebooking.getRebookData",
        "refunds.checkRefundable",
        "refunds.create",
        "seatMap.selectSeat",
        "softDelete.deleteBooking",
        "specialServices.getBookingServices",
        "splitPayments.getStatus",
      ]);
      expect(indistinguishable).toEqual([
        "ancillary.addToBooking",
        "ancillary.getBookingAncillaries",
        "bookings.cancel",
        "bookings.getByPNR",
        "bookings.getPassengers",
        "compensation.fileClaim",
        "eticket.generateETicket",
        "modifications.requestChangeDate",
        "payments.createCheckoutSession",
        "travelScenarios.getShareableItinerary",
      ]);
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
