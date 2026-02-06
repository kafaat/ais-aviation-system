import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  checkDatabase,
  checkStripe,
  performHealthChecks,
} from "./health.service";
import { cleanupExpiredLocks } from "./cron.service";
import { getDb, getPaymentByIdempotencyKey, createPayment } from "../db";
import { inventoryLocks } from "../../drizzle/schema";

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
    it.skipIf(!process.env.DATABASE_URL)(
      "should check database connectivity",
      async () => {
        if (!isDatabaseAvailable) return; // Skip if db not reachable
        const result = await checkDatabase();
        expect(result.status).toBe("pass");
        expect(result.responseTime).toBeGreaterThan(0);
      }
    );

    it.skipIf(!process.env.STRIPE_SECRET_KEY)(
      "should check Stripe configuration",
      async () => {
        const result = await checkStripe();
        // Key format validated by regex; CI may have a placeholder key
        const keyFormat = /^sk_(test|live)_[a-zA-Z0-9]{24,}$/;
        const isValidKey = keyFormat.test(process.env.STRIPE_SECRET_KEY!);
        expect(result.status).toBe(isValidKey ? "pass" : "fail");
      }
    );

    it.skipIf(!process.env.DATABASE_URL)(
      "should perform all health checks",
      async () => {
        if (!isDatabaseAvailable) return; // Skip if db not reachable
        const result = await performHealthChecks();
        expect(["healthy", "degraded", "unhealthy"]).toContain(result.status);
        expect(result.checks.database.status).toBe("pass");
        expect(result.timestamp).toBeDefined();
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

        // Check that only valid lock remains
        const remainingLocks = await db.select().from(inventoryLocks);
        expect(remainingLocks.length).toBe(1);
        expect(remainingLocks[0]?.sessionId).toBe("test-session-valid");
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
