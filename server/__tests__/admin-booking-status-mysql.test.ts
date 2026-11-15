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
 * Review finding R3 (#355): the administrative "update booking status"
 * command used to write the status column directly. On native MySQL this
 * suite drives the real admin router and checks that every transition now
 * follows the product rules: a paid booking cannot be cancelled here (the
 * refund flow owns that), an unpaid one is cancelled through the shared
 * release, confirmation is refused, completion requires flown flights, and a
 * refused command leaves every table unchanged.
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

nativeDescribe.sequential(
  "administrative booking status on native MySQL (R3)",
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
      await fixture.db.insert(schema.users).values({
        id: 20,
        openId: "native-platform-admin",
        tenantId: null,
        role: "admin",
        name: "Synthetic Admin",
        email: "admin@example.test",
      });
    });

    const admin = () =>
      appRouter.createCaller({
        user: { id: 20, role: "admin", tenantId: null },
        tenantId: null,
        authMethod: "cookie",
        req: { headers: {}, ip: "198.51.100.3", id: "req-native-r3" },
        res: {},
      } as unknown as TrpcContext);

    async function checksums(): Promise<Record<string, string>> {
      const [tables] = await fixture.admin.query<mysql.RowDataPacket[]>(
        "SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_TYPE='BASE TABLE' AND TABLE_NAME <> 'audit_logs'",
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

    async function bookingRow() {
      const [row] = await fixture.db.select().from(schema.bookings);
      return row;
    }

    async function markPaidConfirmed() {
      await fixture.pool.query(
        "UPDATE bookings SET status='confirmed', paymentStatus='paid', seatsReserved=1 WHERE id=71"
      );
    }

    it("refuses to cancel a paid booking and points at the refund flow, changing nothing", async () => {
      await markPaidConfirmed();
      const before = await checksums();
      await expect(
        admin().admin.updateBookingStatus({
          bookingId: 71,
          status: "cancelled",
        })
      ).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
        message: expect.stringContaining("refunds.adminCreate"),
      });
      expect(await checksums()).toEqual(before);
      expect(await bookingRow()).toMatchObject({
        status: "confirmed",
        paymentStatus: "paid",
        seatsReserved: true,
      });
    });

    it("cancels an unpaid booking through the shared release and audits it", async () => {
      await expect(
        admin().admin.updateBookingStatus({
          bookingId: 71,
          status: "cancelled",
        })
      ).resolves.toEqual({ success: true });
      expect(await bookingRow()).toMatchObject({
        status: "cancelled",
        paymentStatus: "pending",
      });
      const audits = await fixture.db.select().from(schema.auditLogs);
      expect(
        audits.filter(row => row.eventType === "BOOKING_CANCELLED")
      ).toHaveLength(1);
      expect(
        audits.filter(row => row.eventType === "PRIVILEGED_MUTATION")
      ).toHaveLength(1);
    });

    it("refuses confirmation and a return to pending without touching the booking", async () => {
      const before = await checksums();
      for (const status of ["confirmed", "pending"] as const)
        await expect(
          admin().admin.updateBookingStatus({ bookingId: 71, status })
        ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
      expect(await checksums()).toEqual(before);
    });

    it("completes a paid, confirmed booking only once every flight has completed", async () => {
      await markPaidConfirmed();
      const before = await checksums();
      await expect(
        admin().admin.updateBookingStatus({
          bookingId: 71,
          status: "completed",
        })
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
      expect(await checksums()).toEqual(before);

      await fixture.pool.query(
        "UPDATE flights SET status='completed' WHERE id=41"
      );
      await expect(
        admin().admin.updateBookingStatus({
          bookingId: 71,
          status: "completed",
        })
      ).resolves.toEqual({ success: true });
      expect(await bookingRow()).toMatchObject({ status: "completed" });
    });

    it("answers an unknown booking with NOT_FOUND", async () => {
      await expect(
        admin().admin.updateBookingStatus({
          bookingId: 7_100_000,
          status: "cancelled",
        })
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  }
);
