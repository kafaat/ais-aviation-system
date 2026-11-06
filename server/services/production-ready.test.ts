import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
  vi,
} from "vitest";
import {
  checkDatabase,
  checkStripe,
  performHealthChecks,
} from "./health.service";
import { cleanupExpiredLocks } from "./cron.service";
import { getDb, getPaymentByIdempotencyKey, createPayment } from "../db";
import * as database from "../db";
import { inventoryLocks } from "../../drizzle/schema";
import { redisCacheService } from "./redis-cache.service";

// Check if database is actually reachable (not just env var set)
let isDatabaseAvailable = false;

describe("Production-Ready Features", () => {
  beforeAll(async () => {
    try {
      const db = await getDb();
      if (db) {
        // Try a simple query to verify connection
        await db.select().from(inventoryLocks).limit(1);
        isDatabaseAvailable = true;
      }
    } catch {
      isDatabaseAvailable = false;
    }
  });

  describe("Health Checks", () => {
    const stripeOrigin = "http://127.0.0.1:43871";
    const stripeKey = "sk_test_production_health_fixture";
    const balance = {
      object: "balance",
      livemode: false,
      available: [],
      pending: [],
    };
    const providerFetch = vi.fn<typeof fetch>();

    beforeEach(() => {
      // Own the provider transport even when the full-suite runner supplies a
      // rejecting listener. These are controlled fetch tests, not live probes.
      vi.stubEnv("AIS_PROVIDER_BOUNDARY", "isolated");
      vi.stubEnv("STRIPE_SECRET_KEY", stripeKey);
      vi.stubEnv("STRIPE_MOCK_HOST", stripeOrigin);
      providerFetch.mockReset().mockImplementation(
        async () =>
          new Response(JSON.stringify(balance), {
            status: 200,
            headers: { "content-type": "application/json" },
          })
      );
      vi.stubGlobal("fetch", providerFetch);
    });

    afterEach(() => {
      try {
        // Assert outside the fetch stub: checkStripe intentionally catches a
        // transport error, so a destination assertion inside it could be lost.
        for (const [input, init] of providerFetch.mock.calls) {
          expect(input).toBe(`${stripeOrigin}/v1/balance`);
          expect(init).toMatchObject({
            method: "GET",
            headers: { Authorization: `Bearer ${stripeKey}` },
            redirect: "error",
            signal: expect.any(AbortSignal),
          });
        }
      } finally {
        vi.unstubAllGlobals();
        vi.unstubAllEnvs();
        vi.restoreAllMocks();
      }
    });

    it.skipIf(!process.env.DATABASE_URL)(
      "should check database connectivity",
      async () => {
        if (!isDatabaseAvailable) return; // Skip if db not reachable
        const result = await checkDatabase();
        expect(result.status).toBe("pass");
        // Date.now() has millisecond resolution; a successful query may take 0 ms.
        expect(Number.isFinite(result.responseTime)).toBe(true);
        expect(result.responseTime).toBeGreaterThanOrEqual(0);
      }
    );

    it.each([
      {
        label: "a healthy balance",
        httpStatus: 200,
        body: balance,
        expectedStatus: "pass",
      },
      {
        label: "a rejected request",
        httpStatus: 503,
        body: { error: "Controlled provider refusal" },
        expectedStatus: "fail",
      },
      {
        label: "an invalid live-mode balance",
        httpStatus: 200,
        body: { ...balance, livemode: true },
        expectedStatus: "fail",
      },
    ])(
      "checks isolated Stripe health with $label",
      async ({ httpStatus, body, expectedStatus }) => {
        providerFetch.mockResolvedValueOnce(
          new Response(JSON.stringify(body), { status: httpStatus })
        );
        const result = await checkStripe();
        expect(result).toMatchObject({ status: expectedStatus, mode: "mock" });
        if (expectedStatus === "fail")
          expect(result.error).toBe("STRIPE_MOCK_INVALID_RESPONSE");
        expect(providerFetch).toHaveBeenCalledTimes(1);
      }
    );

    it.each([
      { httpStatus: 200, expectedStatus: "healthy", stripeStatus: "pass" },
      { httpStatus: 503, expectedStatus: "unhealthy", stripeStatus: "fail" },
    ])(
      "reports aggregate health as $expectedStatus for isolated Stripe HTTP $httpStatus",
      async ({ httpStatus, expectedStatus, stripeStatus }) => {
        // Control the other dependencies so these assertions prove the real
        // aggregate decision, independently of native DB/Redis availability.
        const execute = vi.fn().mockResolvedValue([]);
        vi.spyOn(database, "getDb").mockReturnValue({
          execute,
        } as unknown as NonNullable<ReturnType<typeof getDb>>);
        const cacheHealth = vi
          .spyOn(redisCacheService, "healthCheck")
          .mockResolvedValue({
            status: "ok",
            redis: { connected: true, latency: 1 },
            memory: { entries: 0, maxSize: 10000 },
          });
        providerFetch.mockResolvedValueOnce(
          new Response(JSON.stringify(balance), { status: httpStatus })
        );
        const result = await performHealthChecks();
        expect(result).toMatchObject({
          status: expectedStatus,
          checks: {
            database: { status: "pass" },
            stripe: { status: stripeStatus, mode: "mock" },
            cache: { status: "pass" },
          },
          timestamp: expect.any(String),
        });
        expect(execute).toHaveBeenCalledExactlyOnceWith("SELECT 1");
        expect(cacheHealth).toHaveBeenCalledTimes(1);
        expect(providerFetch).toHaveBeenCalledTimes(1);
      }
    );
  });

  describe("Cron Jobs", () => {
    beforeAll(async () => {
      if (!isDatabaseAvailable) return;
      // Clean up any existing test data
      const db = await getDb();
      if (db) {
        await db.delete(inventoryLocks);
      }
    });

    it.skipIf(!process.env.DATABASE_URL)(
      "should clean up expired inventory locks",
      async () => {
        if (!isDatabaseAvailable) return; // Skip if db not reachable
        const db = await getDb();
        if (!db) throw new Error("Database not available");

        // Create an expired lock
        await db.insert(inventoryLocks).values({
          flightId: 1,
          cabinClass: "economy",
          numberOfSeats: 2,
          userId: 1,
          sessionId: "test-session-expired",
          expiresAt: new Date(Date.now() - 60000), // 1 minute ago
        });

        // Create a valid lock
        await db.insert(inventoryLocks).values({
          flightId: 1,
          cabinClass: "economy",
          numberOfSeats: 1,
          userId: 1,
          sessionId: "test-session-valid",
          expiresAt: new Date(Date.now() + 60000), // 1 minute from now
        });

        // Run cleanup
        await cleanupExpiredLocks();

        // Expiry retains historical records and removes only their active capacity claim.
        const remainingLocks = await db.select().from(inventoryLocks);
        expect(remainingLocks).toHaveLength(2);
        expect(
          remainingLocks.find(lock => lock.sessionId === "test-session-expired")
            ?.status
        ).toBe("expired");
        expect(
          remainingLocks
            .filter(lock => lock.status === "active")
            .map(lock => lock.sessionId)
        ).toEqual(["test-session-valid"]);
      }
    );

    afterAll(async () => {
      if (!isDatabaseAvailable) return;
      // Clean up test data
      const db = await getDb();
      if (db) {
        await db.delete(inventoryLocks);
      }
    });
  });

  describe("Payment Idempotency", () => {
    const testIdempotencyKey = `test-idempotency-${Date.now()}`;

    afterAll(async () => {
      if (!isDatabaseAvailable) return;
      // Clean up test payment
      const db = await getDb();
      if (db) {
        const { payments } = await import("../../drizzle/schema");
        const { eq } = await import("drizzle-orm");
        await db
          .delete(payments)
          .where(eq(payments.idempotencyKey, testIdempotencyKey));
      }
    });

    it.skipIf(!process.env.DATABASE_URL)(
      "should create payment with idempotency key",
      async () => {
        if (!isDatabaseAvailable) return; // Skip if db not reachable
        await createPayment({
          bookingId: 1,
          amount: 50000,
          currency: "SAR",
          status: "pending",
          method: "card",
          transactionId: "test-transaction-123",
          idempotencyKey: testIdempotencyKey,
        });

        const payment = await getPaymentByIdempotencyKey(testIdempotencyKey);
        expect(payment).toBeDefined();
        expect(payment?.idempotencyKey).toBe(testIdempotencyKey);
        expect(payment?.amount).toBe(50000);
      }
    );

    it.skipIf(!process.env.DATABASE_URL)(
      "should retrieve existing payment by idempotency key",
      async () => {
        if (!isDatabaseAvailable) return; // Skip if db not reachable
        const payment = await getPaymentByIdempotencyKey(testIdempotencyKey);
        expect(payment).toBeDefined();
        expect(payment?.idempotencyKey).toBe(testIdempotencyKey);
      }
    );

    it.skipIf(!process.env.DATABASE_URL)(
      "should return null for non-existent idempotency key",
      async () => {
        if (!isDatabaseAvailable) return; // Skip if db not reachable
        const payment = await getPaymentByIdempotencyKey("non-existent-key");
        expect(payment).toBeNull();
      }
    );
  });
});
