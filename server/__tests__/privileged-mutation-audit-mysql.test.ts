import { desc, eq } from "drizzle-orm";
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
 * Scenario S-21 on native MySQL: a real privileged mutation of the application
 * router, called through the tRPC caller, leaves one row in audit_logs for a
 * refused call (with the target unchanged) and one for a completed call (with
 * the target changed), written by the shared builder middleware rather than by
 * the handler. The unit sweep proves the surface; this proves the row.
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

nativeDescribe.sequential("privileged mutation audit on native MySQL", () => {
  let fixture: PaidBookingNativeFixture;
  let appRouter: AppRouter;
  const originalDatabaseUrl = process.env.DATABASE_URL;

  beforeAll(async () => {
    fixture = await createPaidBookingNativeFixture("ais_confirmation");
    // The application's lazy connection and the audit writer must both open
    // against the disposable schema, so the router is imported afterwards.
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

  const context = (user: {
    id: number;
    role: string;
    tenantId: number | null;
  }) =>
    ({
      user,
      tenantId: user.tenantId,
      authMethod: "cookie",
      req: {
        ip: "198.51.100.7",
        id: "req-native-s21",
        headers: { "user-agent": "vitest-native" },
      },
      res: {},
    }) as unknown as TrpcContext;

  async function auditRows() {
    return fixture.db
      .select()
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.eventType, "PRIVILEGED_MUTATION"))
      .orderBy(desc(schema.auditLogs.id));
  }

  async function bookingStatus() {
    const [row] = await fixture.db
      .select({ status: schema.bookings.status })
      .from(schema.bookings)
      .where(eq(schema.bookings.id, 71));
    return row?.status;
  }

  it("refuses the booking owner and records the refusal without touching the booking", async () => {
    const caller = appRouter.createCaller(
      context({ id: 9, role: "user", tenantId: 3 })
    );
    await expect(
      caller.admin.updateBookingStatus({ bookingId: 71, status: "cancelled" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    expect(await bookingStatus()).toBe("pending");
    const rows = await auditRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      eventCategory: "access",
      outcome: "failure",
      severity: "high",
      userId: 9,
      userRole: "user",
      actorType: "user",
      sourceIp: "198.51.100.7",
      requestId: "req-native-s21",
      resourceType: "admin",
    });
    expect(JSON.parse(rows[0].metadata ?? "{}")).toMatchObject({
      path: "admin.updateBookingStatus",
      scope: "admin",
      errorCode: "FORBIDDEN",
    });
  });

  it("records the completed admin mutation beside the changed booking", async () => {
    const caller = appRouter.createCaller(
      context({ id: 20, role: "admin", tenantId: null })
    );
    await expect(
      caller.admin.updateBookingStatus({ bookingId: 71, status: "confirmed" })
    ).resolves.toEqual({ success: true });

    expect(await bookingStatus()).toBe("confirmed");
    const rows = await auditRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      outcome: "success",
      severity: "medium",
      userId: 20,
      userRole: "admin",
      actorType: "admin",
      resourceType: "admin",
      changeDescription: "admin.updateBookingStatus completed",
    });
    expect(JSON.parse(rows[0].metadata ?? "{}")).toMatchObject({
      path: "admin.updateBookingStatus",
      scope: "admin",
      procedureType: "mutation",
    });
    expect(rows[0].eventId).toHaveLength(32);
  });

  it("writes nothing for a privileged query", async () => {
    const caller = appRouter.createCaller(
      context({ id: 20, role: "admin", tenantId: null })
    );
    await caller.admin.getMetricsInfo();
    expect(await auditRows()).toHaveLength(0);
  });
});
