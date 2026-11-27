import { eq } from "drizzle-orm";
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
const provider = vi.hoisted(() => ({
  create: vi.fn(),
  retrieve: vi.fn(),
  expire: vi.fn(),
}));
vi.mock("../stripe", () => ({
  stripe: { checkout: { sessions: provider } },
}));
const nativeDescribe =
  process.env.AIS_DISPOSABLE_DATABASE === "true" &&
  process.env.NODE_ENV === "test" &&
  process.env.DATABASE_URL
    ? describe
    : describe.skip;

/** Real MySQL predicates and InnoDB locks; payment provider deliberately fake.
 * The fixture copies migrated table definitions into an owned temporary schema.
 * It does not claim foreign-key migration or external-provider acceptance. */
nativeDescribe.sequential(
  "servicing follows the purchaser's current tenant",
  () => {
    let fixture: PaidBookingNativeFixture;
    let rebooking: typeof import("../routers/rebooking").rebookingRouter;
    let modifications: typeof import("../routers/modifications").modificationsRouter;
    let ndc: typeof import("../routers/ndc").ndcRouter;
    let ndcService: typeof import("../services/ndc.service");
    let paidService: typeof import("../services/order-servicing.service");
    let checkout: typeof import("../services/order-service-checkout.service");
    const originalDatabaseUrl = process.env.DATABASE_URL;

    beforeAll(async () => {
      fixture = await createPaidBookingNativeFixture("ais_confirmation");
      process.env.DATABASE_URL = fixture.databaseUrl;
      ({ rebookingRouter: rebooking } = await import("../routers/rebooking"));
      ({ modificationsRouter: modifications } =
        await import("../routers/modifications"));
      ({ ndcRouter: ndc } = await import("../routers/ndc"));
      ndcService = await import("../services/ndc.service");
      paidService = await import("../services/order-servicing.service");
      checkout = await import("../services/order-service-checkout.service");
    }, 60000);
    afterAll(async () => {
      await closePool();
      process.env.DATABASE_URL = originalDatabaseUrl;
      await fixture?.close();
    });
    beforeEach(async () => {
      vi.clearAllMocks();
      await fixture.reset();
      await fixture.seed();
      await fixture.db.insert(schema.tenants).values({
        id: 4,
        slug: "other-servicing-tenant",
        name: "Other tenant",
        status: "active",
      });
      await fixture.db.insert(schema.bookingModifications).values({
        id: 61,
        bookingId: 71,
        userId: 9,
        modificationType: "change_flight",
        status: "rejected",
        originalFlightId: 41,
        newFlightId: 42,
        originalAmount: 20000,
        newAmount: 20000,
        priceDifference: 0,
        totalCost: 0,
        servicingPayload: { version: 1 },
      });
      await fixture.db.insert(schema.ndcOrders).values({
        id: 51,
        orderId: "NDC-SERVICING-71",
        offerId: "NDC-OFFER-71",
        bookingId: 71,
        airlineId: 3,
        totalAmount: 20000,
        passengers: JSON.stringify(
          ["Alpha", "Beta"].map(firstName => ({
            type: "adult",
            firstName,
            lastName: "Native",
            gender: "male",
            dateOfBirth: "1990-01-01",
            nationality: "SA",
            passportNumber: "",
            passportExpiry: "2035-01-01",
          }))
        ),
        contactInfo: JSON.stringify({
          emailAddress: "owner@example.test",
          phoneNumber: "12345",
        }),
        orderPayload: JSON.stringify({
          ndcVersion: "21.3",
          segments: [{ flightId: 41, segmentKey: "SEG-41" }],
        }),
      });
    });

    const context = (tenantId: number | null): TrpcContext =>
      ({
        user: { id: 9, tenantId, role: "user" },
        tenantId,
        authMethod: "cookie",
        req: { headers: {}, ip: "198.51.100.45", id: "servicing-tenant-proof" },
        res: {},
      }) as unknown as TrpcContext;
    const move = (tenantId: number | null = 4) =>
      fixture.db
        .update(schema.users)
        .set({ tenantId })
        .where(eq(schema.users.id, 9));
    async function domainSnapshot() {
      return {
        bookings: await fixture.db.select().from(schema.bookings),
        modifications: await fixture.db
          .select()
          .from(schema.bookingModifications),
        orders: await fixture.db.select().from(schema.ndcOrders),
        passengers: await fixture.db.select().from(schema.passengers),
        flights: await fixture.db.select().from(schema.flights),
        locks: await fixture.db.select().from(schema.inventoryLocks),
        ancillaries: await fixture.db.select().from(schema.bookingAncillaries),
        commands: await fixture.db.select().from(schema.idempotencyRequests),
        outbox: await fixture.db.select().from(schema.outbox),
      };
    }
    const contactChange = {
      orderId: "NDC-SERVICING-71",
      userId: 9,
      idempotencyKey: "native-contact-change",
      changes: { contactInfoUpdate: { emailAddress: "changed@example.test" } },
    };

    it("denies rebooking data and copying of former-tenant passengers", async () => {
      await move();
      const caller = rebooking.createCaller(context(4));
      const before = await domainSnapshot();
      await expect(
        caller.getRebookData({ bookingId: 71 })
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(
        caller.quickRebook({ bookingId: 71, newFlightId: 42 })
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect(await domainSnapshot()).toEqual(before);
    });

    it("filters modification details and history through the current booking scope", async () => {
      await move();
      const caller = modifications.createCaller(context(4));
      await expect(
        caller.getDetails({ modificationId: 61 })
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect(await caller.myModifications()).toEqual([]);
    });

    it("filters NDC retrieval and history before disclosing passenger/contact fields", async () => {
      await move();
      const caller = ndc.createCaller(context(4));
      await expect(
        caller.retrieveOrder({ orderId: "NDC-SERVICING-71" })
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect((await caller.getOrderHistory()).data).toMatchObject({
        orders: [],
        total: 0,
      });
    });

    it("refuses cancellation and unpaid servicing with a stale request context and no business writes", async () => {
      await move();
      const before = await domainSnapshot();
      await expect(
        ndcService.cancelOrder({
          orderId: "NDC-SERVICING-71",
          userId: 9,
          reason: "Synthetic test",
        })
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(ndcService.changeOrder(contactChange)).rejects.toMatchObject(
        { code: "NOT_FOUND" }
      );
      await expect(
        ndcService.addServices({
          orderId: "NDC-SERVICING-71",
          userId: 9,
          idempotencyKey: "native-add-service",
          services: [{ serviceCode: "BAG20", quantity: 1 }],
        })
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect(await domainSnapshot()).toEqual(before);
    });

    it("authorizes an unpaid-command replay again after the owner is reassigned", async () => {
      // An unpaid invoice cannot have a prior financial workflow, even rejected.
      await fixture.db.delete(schema.bookingModifications);
      const first = await ndcService.changeOrder(contactChange);
      expect(first.contactInfo.emailAddress).toBe("changed@example.test");
      await move();
      const before = await domainSnapshot();
      await expect(ndcService.changeOrder(contactChange)).rejects.toMatchObject(
        { code: "NOT_FOUND" }
      );
      expect(await domainSnapshot()).toEqual(before);
    });

    it("blocks paid quote, no-charge confirmation and checkout/cancellation before provider I/O using current stored identity", async () => {
      await move();
      const before = await domainSnapshot();
      await expect(
        paidService.quotePaidOrderService(
          {
            bookingId: 71,
            idempotencyKey: "stale-paid-quote",
            ancillaries: [{ ancillaryServiceId: 1, quantity: 1 }],
          },
          9,
          3
        )
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(
        paidService.confirmNoChargeService(61, 9, 3)
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(
        checkout.createOrderServiceCheckout(61, 9, "https://example.test", 3)
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(
        checkout.cancelOrderServiceQuote(61, 9, 3)
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect(provider.create).not.toHaveBeenCalled();
      expect(provider.retrieve).not.toHaveBeenCalled();
      expect(provider.expire).not.toHaveBeenCalled();
      expect(await domainSnapshot()).toEqual(before);
    });

    it.each([3, null])(
      "retains purchaser reads and unpaid update for current assignment %s",
      async tenantId => {
        await move(tenantId);
        const ctx = context(tenantId);
        expect(
          (await rebooking.createCaller(ctx).getRebookData({ bookingId: 71 }))
            .passengers
        ).toHaveLength(2);
        expect(
          (await modifications.createCaller(ctx).myModifications()).map(
            change => change.id
          )
        ).toEqual([61]);
        expect(
          (
            await modifications
              .createCaller(ctx)
              .getDetails({ modificationId: 61 })
          ).bookingId
        ).toBe(71);
        expect(
          (
            await ndc
              .createCaller(ctx)
              .retrieveOrder({ orderId: "NDC-SERVICING-71" })
          ).data.bookingId
        ).toBe(71);
        expect((await ndc.createCaller(ctx).getOrderHistory()).data.total).toBe(
          1
        );
        await fixture.db.delete(schema.bookingModifications);
        expect(
          (await ndcService.changeOrder(contactChange)).contactInfo.emailAddress
        ).toBe("changed@example.test");
      }
    );

    it("copies owned passengers atomically, preserves passport expiry and replays the new booking once", async () => {
      const expiry = new Date("2035-01-01T00:00:00Z");
      await fixture.db
        .update(schema.passengers)
        .set({ passportExpiry: expiry })
        .where(eq(schema.passengers.bookingId, 71));
      const caller = rebooking.createCaller(context(3));
      const result = await caller.quickRebook({
        bookingId: 71,
        newFlightId: 42,
      });
      expect(
        await caller.quickRebook({ bookingId: 71, newFlightId: 42 })
      ).toEqual(result);
      expect(result.newBookingId).not.toBe(71);
      const copies = await fixture.db
        .select()
        .from(schema.passengers)
        .where(eq(schema.passengers.bookingId, result.newBookingId));
      expect(
        copies.map(p => ({
          firstName: p.firstName,
          passportExpiry: p.passportExpiry,
          tenantId: p.tenantId,
        }))
      ).toEqual(
        ["Alpha", "Beta"].map(firstName => ({
          firstName,
          passportExpiry: expiry,
          tenantId: 3,
        }))
      );
      expect(await fixture.db.select().from(schema.bookings)).toHaveLength(2);
      await move();
      await expect(
        caller.quickRebook({ bookingId: 71, newFlightId: 42 })
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect(await fixture.db.select().from(schema.bookings)).toHaveLength(2);
    });

    it("serializes NDC cancellation behind an in-flight reassignment and refuses after commit", async () => {
      const connection = await fixture.pool.getConnection();
      await connection.beginTransaction();
      let pending: Promise<unknown> | undefined;
      try {
        await connection.execute("UPDATE users SET tenantId=4 WHERE id=9");
        pending = ndcService.cancelOrder({
          orderId: "NDC-SERVICING-71",
          userId: 9,
          reason: "Reassignment race",
        });
        const outcome = pending.then(
          () => ({ code: "ADMITTED" }),
          (error: { code?: string }) => ({ code: error.code })
        );
        await fixture.waitForBlockedTransactions(1);
        await connection.commit();
        expect(await outcome).toEqual({ code: "NOT_FOUND" });
        expect(
          (await fixture.db.select().from(schema.bookings))[0].status
        ).toBe("pending");
        expect(await fixture.db.select().from(schema.outbox)).toEqual([]);
      } finally {
        await connection.rollback();
        connection.release();
        await pending?.catch(() => undefined);
      }
    });
  }
);
