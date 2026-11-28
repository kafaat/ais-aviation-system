import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type mysql from "mysql2/promise";
import * as schema from "../../drizzle/schema";
import type { TrpcContext } from "../_core/context";
import { closePool } from "../db";
import {
  createPaidBookingNativeFixture,
  type PaidBookingNativeFixture,
} from "./helpers/paid-booking-native-fixture";

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
const tagNumber = "0650000071";
const emdNumber = "06500000000071";
const request = {
  bookingId: 71,
  passengerId: 81,
  flightId: 41,
  serviceType: "wheelchair" as const,
  serviceCode: "WCHR",
};
const reads: Array<[string, (c: Caller) => Promise<unknown>]> = [
  ["SSR booking", c => c.specialServices.getBookingServices({ bookingId: 71 })],
  [
    "SSR passenger",
    c => c.specialServices.getPassengerServices({ passengerId: 81 }),
  ],
  ["SSR detail", c => c.specialServices.getServiceById({ serviceId: 91 })],
  ["baggage booking", c => c.baggage.getBookingBaggage({ bookingId: 71 })],
  [
    "baggage passenger",
    c => c.baggage.getPassengerBaggage({ passengerId: 81 }),
  ],
  ["baggage custody", c => c.baggage.custody({ tagNumber })],
  ["EMD booking", c => c.emd.getByBooking({ bookingId: 71 })],
  ["EMD detail", c => c.emd.get({ emdNumber })],
  [
    "itinerary",
    c => c.travelScenarios.getShareableItinerary({ bookingId: 71 }),
  ],
];
const writes: Array<[string, (c: Caller) => Promise<unknown>]> = [
  ["SSR creation", c => c.specialServices.requestService(request)],
  ["SSR cancellation", c => c.specialServices.cancelService({ serviceId: 91 })],
  [
    "lost baggage report",
    c =>
      c.baggage.reportLost({
        tagNumber,
        description: "Synthetic missing blue bag",
        contactEmail: "owner@example.test",
      }),
  ],
];

nativeDescribe.sequential(
  "passenger servicing after tenant reassignment (AIS-PAX)",
  () => {
    let fixture: PaidBookingNativeFixture;
    let appRouter: AppRouter;
    const originalUrl = process.env.DATABASE_URL;
    beforeAll(async () => {
      fixture = await createPaidBookingNativeFixture("ais_confirmation");
      process.env.DATABASE_URL = fixture.databaseUrl;
      ({ appRouter } = await import("../routers"));
    }, 60000);
    afterAll(async () => {
      await closePool().catch(() => undefined);
      process.env.DATABASE_URL = originalUrl;
      await fixture?.close();
    });
    beforeEach(async () => {
      await fixture.reset();
      await fixture.seed();
      await fixture.pool.query(
        "UPDATE bookings SET status='confirmed', paymentStatus='paid', seatsReserved=1 WHERE id=71"
      );
      await fixture.db.insert(schema.tenants).values({
        id: 4,
        slug: "passenger-other",
        name: "Other airline",
        status: "active",
      });
      await fixture.db.insert(schema.bookingSegments).values({
        id: 94,
        bookingId: 71,
        flightId: 41,
        segmentOrder: 1,
        departureDate: new Date("2030-06-10T12:00:00Z"),
        status: "confirmed",
        segmentAmount: 20000,
      });
      await fixture.db.insert(schema.specialServices).values({
        id: 91,
        bookingId: 71,
        passengerId: 81,
        flightId: 41,
        bookingSegmentId: 94,
        serviceType: "meal",
        serviceCode: "VGML",
        status: "pending",
        details: JSON.stringify({ allergy: "Synthetic dietary details" }),
      });
      await fixture.db.insert(schema.baggageItems).values({
        id: 92,
        bookingId: 71,
        passengerId: 81,
        flightId: 41,
        segmentId: 94,
        tagNumber,
        weight: "12.00",
        status: "checked_in",
        description: "Synthetic blue bag",
      });
      await fixture.db.insert(schema.electronicMiscDocs).values({
        id: 93,
        emdNumber,
        emdType: "EMD-A",
        bookingId: 71,
        passengerId: 81,
        issuingAirlineId: 3,
        reasonForIssuance: "baggage",
        serviceDescription: "Synthetic prepaid bag",
        amount: 1000,
      });
    });
    const caller = (tenantId: number | null = 3, role = "user", id = 9) =>
      appRouter.createCaller({
        user: { id, role, tenantId },
        tenantId,
        authMethod: "cookie",
        req: {
          headers: {},
          ip: "198.51.100.71",
          id: "req-native-passenger-scope",
        },
        res: {},
      } as unknown as TrpcContext);
    async function checksums() {
      const [tables] = await fixture.admin.query<mysql.RowDataPacket[]>(
        "SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_TYPE='BASE TABLE'",
        [fixture.databaseName]
      );
      const [rows] = await fixture.admin.query<mysql.RowDataPacket[]>(
        `CHECKSUM TABLE ${tables.map(row => `\`${fixture.databaseName}\`.\`${row.name}\``).join(", ")}`
      );
      return Object.fromEntries(
        rows.map(row => [String(row.Table), String(row.Checksum)])
      );
    }
    const resultCode = async (p: Promise<unknown>) => {
      try {
        await p;
        return "ADMITTED";
      } catch (e) {
        return (e as { code?: string }).code ?? "UNKNOWN";
      }
    };

    it("denies nine detail paths when the original owner has moved to another tenant", async () => {
      await fixture.pool.query("UPDATE users SET tenantId=4 WHERE id=9");
      const before = await checksums();
      for (const [name, read] of reads)
        expect.soft(await resultCode(read(caller(4))), name).toBe("NOT_FOUND");
      expect(await checksums()).toEqual(before);
    });

    it.each(writes)(
      "denies %s with no persisted side effects after owner reassignment",
      async (_name, write) => {
        await fixture.pool.query("UPDATE users SET tenantId=4 WHERE id=9");
        const before = await checksums();
        await expect(write(caller(4))).rejects.toMatchObject({
          code: "NOT_FOUND",
        });
        expect(await checksums()).toEqual(before);
      }
    );

    it.each(writes)(
      "rechecks the current owner under the transaction lock for %s",
      async (_name, write) => {
        const lock = await fixture.pool.getConnection();
        await lock.beginTransaction();
        await lock.query("UPDATE users SET tenantId=4 WHERE id=9");
        let pending: Promise<string> | undefined;
        try {
          pending = resultCode(write(caller(3))); // A request context obtained before reassignment.
          await fixture.waitForBlockedTransactions(1);
          await lock.commit();
          expect(await pending).toBe("NOT_FOUND");
          const [services] = await fixture.pool.query<mysql.RowDataPacket[]>(
            "SELECT id,status FROM special_services ORDER BY id"
          );
          expect(
            services.map(row => ({ id: row.id, status: row.status }))
          ).toEqual([{ id: 91, status: "pending" }]);
          const [bags] = await fixture.pool.query<mysql.RowDataPacket[]>(
            "SELECT status,lostDescription FROM baggage_items WHERE id=92"
          );
          expect(bags[0]).toMatchObject({
            status: "checked_in",
            lostDescription: null,
          });
          const [events] = await fixture.pool.query<mysql.RowDataPacket[]>(
            "SELECT COUNT(*) AS count FROM baggage_tracking"
          );
          expect(Number(events[0].count)).toBe(0);
        } finally {
          await lock.rollback();
          lock.release();
          if (pending) await pending;
        }
      },
      20000
    );

    it.each([3, null])(
      "preserves owned details and valid mutations for tenant %s",
      async tenantId => {
        await fixture.pool.query("UPDATE users SET tenantId=? WHERE id=9", [
          tenantId,
        ]);
        const owner = caller(tenantId);
        for (const [name, read] of reads)
          expect(await resultCode(read(owner)), name).toBe("ADMITTED");
        const created = await owner.specialServices.requestService(request);
        expect(created.service).toMatchObject({
          bookingId: 71,
          passengerId: 81,
          flightId: 41,
          serviceCode: "WCHR",
          status: "pending",
        });
        await owner.specialServices.cancelService({
          serviceId: created.service.id,
        });
        const [persisted] = await fixture.pool.query<mysql.RowDataPacket[]>(
          "SELECT status FROM special_services WHERE id=?",
          [created.service.id]
        );
        expect(persisted[0].status).toBe("cancelled");
        await owner.baggage.reportLost({
          tagNumber,
          description: "Synthetic missing blue bag",
          contactEmail: "owner@example.test",
        });
        const [bags] = await fixture.pool.query<mysql.RowDataPacket[]>(
          "SELECT status,lostDescription FROM baggage_items WHERE id=92"
        );
        expect(bags[0]).toMatchObject({
          status: "lost",
          lostDescription:
            "Synthetic missing blue bag\nContact Email: owner@example.test",
        });
        const [events] = await fixture.pool.query<mysql.RowDataPacket[]>(
          "SELECT status,notes FROM baggage_tracking WHERE baggageId=92"
        );
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({
          status: "lost",
          notes: "Lost baggage report: Synthetic missing blue bag",
        });
        const publicResponse = await owner.baggage.track({ tagNumber });
        expect(publicResponse.baggage).not.toHaveProperty("lostDescription");
        expect(publicResponse.baggage).not.toHaveProperty("passengerId");
        expect(publicResponse.tracking[0]).not.toHaveProperty("notes");
      }
    );

    it("preserves platform support read access and refuses strangers with the same tenant", async () => {
      const admin = caller(null, "admin", 999);
      for (const read of [
        reads[0],
        reads[1],
        reads[2],
        reads[3],
        reads[4],
        reads[6],
        reads[7],
      ])
        expect(await resultCode(read[1](admin)), read[0]).toBe("ADMITTED");
      const before = await checksums();
      for (const [name, read] of reads)
        expect
          .soft(await resultCode(read(caller(3, "user", 999))), name)
          .toBe("NOT_FOUND");
      for (const [name, write] of writes)
        expect
          .soft(await resultCode(write(caller(3, "user", 999))), name)
          .toBe("NOT_FOUND");
      expect(await checksums()).toEqual(before);
    });
  }
);
