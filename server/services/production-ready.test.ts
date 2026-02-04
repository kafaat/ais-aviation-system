import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  checkDatabase,
  checkStripe,
  performHealthChecks,
} from "./health.service";
import { cleanupExpiredLocks } from "./cron.service";
import { getDb, getPaymentByIdempotencyKey, createPayment } from "../db";
import { inventoryLocks } from "../../drizzle/schema";

describe("Production-Ready Features", () => {
  describe("Health Checks", () => {
    it("should check database connectivity", async () => {
      const result = await checkDatabase();
      expect(result.status).toBe("pass");
      expect(result.responseTime).toBeGreaterThan(0);
    });

    it("should check Stripe configuration", async () => {
      const result = await checkStripe();
      expect(result.status).toBe("pass");
    });

    it("should perform all health checks", async () => {
      const result = await performHealthChecks();
      expect(result.status).toBe("healthy");
      expect(result.checks.database.status).toBe("pass");
      expect(result.checks.stripe.status).toBe("pass");
      expect(result.timestamp).toBeDefined();
    });
  });

  describe("Cron Jobs", () => {
    beforeAll(async () => {
      // Clean up any existing test data
      const db = await getDb();
      if (db) {
        await db.delete(inventoryLocks);
      }
    });

    it("should clean up expired inventory locks", async () => {
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
    });

    afterAll(async () => {
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

    it("should create payment with idempotency key", async () => {
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
    });

    it("should retrieve existing payment by idempotency key", async () => {
      const payment = await getPaymentByIdempotencyKey(testIdempotencyKey);
      expect(payment).toBeDefined();
      expect(payment?.idempotencyKey).toBe(testIdempotencyKey);
    });

    it("should return null for non-existent idempotency key", async () => {
      const payment = await getPaymentByIdempotencyKey("non-existent-key");
      expect(payment).toBeNull();
    });
  });
});
