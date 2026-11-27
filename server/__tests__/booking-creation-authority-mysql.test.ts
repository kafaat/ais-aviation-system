import { eq } from "drizzle-orm";
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

vi.mock("../_core/middleware/procedure-rate-limit", () => ({
  enforceProcedureRateLimit: vi.fn(),
}));
const nativeDescribe =
  process.env.AIS_DISPOSABLE_DATABASE === "true" &&
  process.env.NODE_ENV === "test" &&
  process.env.DATABASE_URL
    ? describe
    : describe.skip;
type Kind = "direct" | "multi-city" | "ndc";
const kinds: Kind[] = ["direct", "multi-city", "ndc"];

/** Source-authenticated contexts intentionally simulate the narrow race after
 * authentication. This is native router/transaction evidence, not UI or auth
 * provider acceptance. The fixture owns its entire MySQL schema. */
nativeDescribe.sequential(
  "creation and ancillary replay revalidate stored purchaser authority",
  () => {
    let fixture: PaidBookingNativeFixture;
    let bookingRouter: typeof import("../routers/bookings").bookingsRouter;
    let multiRouter: typeof import("../routers/multi-city").multiCityRouter;
    let ndcRouter: typeof import("../routers/ndc").ndcRouter;
    let ndc: typeof import("../services/ndc.service");
    let ancillary: typeof import("../services/ancillary-services.service");
    const originalDatabaseUrl = process.env.DATABASE_URL;
    beforeAll(async () => {
      fixture = await createPaidBookingNativeFixture("ais_confirmation");
      process.env.DATABASE_URL = fixture.databaseUrl;
      ({ bookingsRouter: bookingRouter } = await import("../routers/bookings"));
      ({ multiCityRouter: multiRouter } =
        await import("../routers/multi-city"));
      ({ ndcRouter } = await import("../routers/ndc"));
      ndc = await import("../services/ndc.service");
      ancillary = await import("../services/ancillary-services.service");
    }, 60000);
    afterAll(async () => {
      await closePool();
      process.env.DATABASE_URL = originalDatabaseUrl;
      await fixture?.close();
    });
    beforeEach(async () => {
      await fixture.reset();
      await fixture.seed();
      await fixture.db.insert(schema.tenants).values({
        id: 4,
        slug: "other-creation-tenant",
        name: "Other tenant",
        status: "active",
      });
      // A connected outbound/return itinerary, with actual flight dates later
      // than all documents in this synthetic fixture.
      await fixture.db
        .update(schema.flights)
        .set({ originId: 2, destinationId: 1 })
        .where(eq(schema.flights.id, 42));
    });
    const ctx = (tenantId: number | null): TrpcContext =>
      ({
        user: { id: 9, tenantId, role: "user" },
        tenantId,
        authMethod: "cookie",
        req: { headers: {}, ip: "198.51.100.46" },
        res: {},
      }) as unknown as TrpcContext;
    const move = (tenantId: number | null = 4) =>
      fixture.db
        .update(schema.users)
        .set({ tenantId })
        .where(eq(schema.users.id, 9));
    async function checksums(excludeUsers = false) {
      const [tables] = await fixture.admin.query<mysql.RowDataPacket[]>(
        "SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_TYPE='BASE TABLE'",
        [fixture.databaseName]
      );
      const names = tables
        .filter(t => !excludeUsers || t.name !== "users")
        .map(t => `\`${fixture.databaseName}\`.\`${t.name}\``);
      const [rows] = await fixture.admin.query<mysql.RowDataPacket[]>(
        `CHECKSUM TABLE ${names.join(", ")}`
      );
      return Object.fromEntries(
        rows.map(row => [String(row.Table), String(row.Checksum)])
      );
    }
    async function command(kind: Kind, tenantId: number | null = 3) {
      const context = ctx(tenantId);
      const passenger = {
        type: "adult" as const,
        firstName: "Synthetic",
        lastName: "Buyer",
      };
      if (kind === "direct")
        return () =>
          bookingRouter.createCaller(context).create({
            flightId: 41,
            cabinClass: "economy",
            passengers: [passenger],
            sessionId: `native-creation-${tenantId}`,
            idempotencyKey: `native-creation-${tenantId}`,
          });
      if (kind === "multi-city")
        return () =>
          multiRouter.createCaller(context).create({
            cabinClass: "economy",
            passengers: [passenger],
            sessionId: `native-multicity-${tenantId}`,
            segments: [
              { flightId: 41, departureDate: new Date("2030-06-10T12:00:00Z") },
              { flightId: 42, departureDate: new Date("2030-06-11T12:00:00Z") },
            ],
          });
      // Real local AirShopping creates the offer before the simulated account
      // reassignment. Offer setup is deliberately outside the zero-write window.
      const offers = await ndc.searchOffers({
        originId: 1,
        destinationId: 2,
        departureDate: "2030-06-10",
        passengerCount: 1,
        cabinClass: "economy",
      });
      expect(offers.length).toBeGreaterThan(0);
      const input = {
        offerId: offers[0].offerId,
        paymentMethod: "stripe",
        contactInfo: {
          emailAddress: "synthetic@example.test",
          phoneNumber: "1234567",
        },
        passengers: [
          {
            ...passenger,
            dateOfBirth: "1990-01-01",
            gender: "male" as const,
            nationality: "SA",
            passportNumber: "SYNTHETIC9",
            passportExpiry: "2035-01-01",
          },
        ],
      };
      return () => ndcRouter.createCaller(context).createOrder(input);
    }
    function bookingId(result: unknown) {
      const response = result as {
        bookingId?: number;
        data?: { bookingId?: number };
      };
      const id = response.bookingId ?? response.data?.bookingId;
      expect(id).toBeTypeOf("number");
      return id!;
    }

    it.each(kinds)(
      "refuses a new %s command from a stale authenticated tenant without any write",
      async kind => {
        const create = await command(kind);
        await move();
        const before = await checksums();
        await expect(create()).rejects.toMatchObject({ code: "NOT_FOUND" });
        expect(await checksums()).toEqual(before);
      }
    );

    it.each(kinds)(
      "creates %s once and refuses the same cached response after reassignment",
      async kind => {
        const create = await command(kind);
        const first = await create();
        expect(await create()).toEqual(first);
        expect(
          (
            await fixture.db
              .select()
              .from(schema.bookings)
              .where(eq(schema.bookings.id, bookingId(first)))
          )[0]
        ).toMatchObject({
          tenantId: 3,
          userId: 9,
          status: "pending",
          paymentStatus: "pending",
        });
        expect(await fixture.db.select().from(schema.bookings)).toHaveLength(2);
        await move();
        const before = await checksums();
        await expect(create()).rejects.toMatchObject({ code: "NOT_FOUND" });
        expect(await checksums()).toEqual(before);
      }
    );

    it("retains a real unassigned customer's direct, multi-city and local NDC purchases", async () => {
      await move(null);
      for (const kind of kinds) {
        const create = await command(kind, null);
        const first = await create();
        expect(await create()).toEqual(first);
        expect(
          (
            await fixture.db
              .select()
              .from(schema.bookings)
              .where(eq(schema.bookings.id, bookingId(first)))
          )[0]
        ).toMatchObject({ tenantId: 3, userId: 9 });
      }
      expect(await fixture.db.select().from(schema.bookings)).toHaveLength(4);
    });

    it.each(kinds)(
      "serializes %s creation behind an actual in-flight tenant transfer",
      async kind => {
        const create = await command(kind);
        const before = await checksums(true);
        const connection = await fixture.pool.getConnection();
        await connection.beginTransaction();
        let pending: Promise<unknown> | undefined;
        try {
          await connection.execute("UPDATE users SET tenantId=4 WHERE id=9");
          pending = create();
          const outcome = pending.then(
            () => "ADMITTED",
            (error: { code?: string }) => error.code
          );
          await fixture.waitForBlockedTransactions(1);
          await connection.commit();
          expect(await outcome).toBe("NOT_FOUND");
          expect(await checksums(true)).toEqual(before);
        } finally {
          await connection.rollback();
          connection.release();
          await pending?.catch(() => undefined);
        }
      }
    );

    it("reauthorizes a paid ancillary command replay while preserving the legitimate completed receipt", async () => {
      await fixture.db.insert(schema.bookingSegments).values({
        bookingId: 71,
        flightId: 41,
        segmentOrder: 1,
        departureDate: new Date("2030-06-10T12:00:00Z"),
        segmentAmount: 20000,
        status: "pending",
      });
      await fixture.db.insert(schema.ancillaryServices).values({
        id: 1,
        code: "NATIVE_MEAL",
        name: "Synthetic meal",
        category: "meal",
        available: true,
        price: 500,
        currency: "SAR",
      });
      const data = {
        bookingId: 71,
        passengerId: 81,
        flightId: 41,
        ancillaryServiceId: 1,
        idempotencyKey: "native-ancillary-replay",
      };
      const actor = { userId: 9, tenantId: 3 };
      const first = await ancillary.addAncillaryToBooking(data, actor);
      // This setup step models an already verified payment; it does not claim a
      // provider payment. A completed add receipt must remain replayable then.
      await fixture.db
        .update(schema.bookings)
        .set({
          status: "confirmed",
          paymentStatus: "paid",
          seatsReserved: true,
        })
        .where(eq(schema.bookings.id, 71));
      expect(await ancillary.addAncillaryToBooking(data, actor)).toEqual(first);
      await move();
      const before = await checksums();
      await expect(
        ancillary.addAncillaryToBooking(data, actor)
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect(await checksums()).toEqual(before);
    });
  }
);
