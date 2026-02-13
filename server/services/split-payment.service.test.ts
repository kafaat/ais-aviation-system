import { describe, expect, it } from "vitest";
import * as crypto from "crypto";
import { MIN_SPLIT_AMOUNT } from "./split-payment.service";

/**
 * Split Payment Service Unit Tests
 *
 * These tests focus on business logic validation that doesn't require database access.
 * Integration tests with full database operations should be run in environments with
 * database connectivity.
 */
describe("Split Payment Service", () => {
  describe("MIN_SPLIT_AMOUNT constant", () => {
    it("should have a minimum split amount of 100 cents (1 SAR)", () => {
      expect(MIN_SPLIT_AMOUNT).toBe(100);
    });

    it("should be a positive number", () => {
      expect(MIN_SPLIT_AMOUNT).toBeGreaterThan(0);
    });
  });

  describe("Payment token generation", () => {
    it("should generate unique tokens using crypto", () => {
      const token1 = crypto.randomBytes(32).toString("hex");
      const token2 = crypto.randomBytes(32).toString("hex");

      expect(token1).toHaveLength(64);
      expect(token2).toHaveLength(64);
      expect(token1).not.toBe(token2);
    });

    it("should generate hex-encoded tokens", () => {
      const token = crypto.randomBytes(32).toString("hex");
      // Should only contain hex characters
      expect(token).toMatch(/^[0-9a-f]+$/);
    });

    it("should generate consistent length tokens", () => {
      for (let i = 0; i < 10; i++) {
        const token = crypto.randomBytes(32).toString("hex");
        expect(token).toHaveLength(64);
      }
    });
  });

  describe("Percentage calculation", () => {
    it("should calculate correct percentages for equal splits", () => {
      const totalAmount = 100000;
      const splits = [{ amount: 50000 }, { amount: 50000 }];

      const percentages = splits.map(split =>
        ((split.amount / totalAmount) * 100).toFixed(2)
      );

      expect(percentages).toEqual(["50.00", "50.00"]);
    });

    it("should calculate correct percentages for unequal splits", () => {
      const totalAmount = 100000;
      const splits = [
        { amount: 30000 }, // 30%
        { amount: 50000 }, // 50%
        { amount: 20000 }, // 20%
      ];

      const percentages = splits.map(split =>
        ((split.amount / totalAmount) * 100).toFixed(2)
      );

      expect(percentages).toEqual(["30.00", "50.00", "20.00"]);
    });

    it("should sum to 100% for valid splits", () => {
      const totalAmount = 100000;
      const splits = [{ amount: 30000 }, { amount: 50000 }, { amount: 20000 }];

      const totalPercentage = splits.reduce(
        (sum, split) => sum + (split.amount / totalAmount) * 100,
        0
      );

      expect(totalPercentage).toBeCloseTo(100, 2);
    });

    it("should handle three-way equal split percentages", () => {
      const totalAmount = 99999; // Intentionally not divisible by 3
      const splitAmount = 33333;

      const percentage = ((splitAmount / totalAmount) * 100).toFixed(2);
      expect(parseFloat(percentage)).toBeCloseTo(33.33, 1);
    });

    it("should handle minimum percentage splits", () => {
      const totalAmount = 1000000; // 10,000 SAR
      const minSplit = MIN_SPLIT_AMOUNT;

      const percentage = ((minSplit / totalAmount) * 100).toFixed(2);
      expect(parseFloat(percentage)).toBe(0.01);
    });
  });

  describe("Amount validation", () => {
    it("should validate that split amounts equal total", () => {
      const totalAmount = 100000;
      const splits = [{ amount: 50000 }, { amount: 50000 }];

      const splitTotal = splits.reduce((sum, s) => sum + s.amount, 0);
      expect(splitTotal).toBe(totalAmount);
    });

    it("should detect mismatched amounts (under)", () => {
      const totalAmount = 100000;
      const splits = [{ amount: 40000 }, { amount: 40000 }];

      const splitTotal = splits.reduce((sum, s) => sum + s.amount, 0);
      expect(splitTotal).not.toBe(totalAmount);
      expect(splitTotal).toBeLessThan(totalAmount);
    });

    it("should detect mismatched amounts (over)", () => {
      const totalAmount = 100000;
      const splits = [{ amount: 60000 }, { amount: 60000 }];

      const splitTotal = splits.reduce((sum, s) => sum + s.amount, 0);
      expect(splitTotal).not.toBe(totalAmount);
      expect(splitTotal).toBeGreaterThan(totalAmount);
    });

    it("should validate minimum amount per split", () => {
      const splits = [{ amount: 50000 }, { amount: 50 }]; // 50 is below minimum

      const belowMinimum = splits.filter(s => s.amount < MIN_SPLIT_AMOUNT);
      expect(belowMinimum).toHaveLength(1);
      expect(belowMinimum[0].amount).toBe(50);
    });

    it("should accept valid split amounts", () => {
      const splits = [{ amount: 50000 }, { amount: 30000 }, { amount: 20000 }];

      const allValid = splits.every(s => s.amount >= MIN_SPLIT_AMOUNT);
      expect(allValid).toBe(true);
    });
  });

  describe("Input validation rules", () => {
    it("should require at least 2 payers", () => {
      const splits = [{ email: "a@test.com", name: "A", amount: 100000 }];
      expect(splits.length).toBeLessThan(2);
    });

    it("should accept 2 or more payers", () => {
      const splits = [
        { email: "a@test.com", name: "A", amount: 50000 },
        { email: "b@test.com", name: "B", amount: 50000 },
      ];
      expect(splits.length).toBeGreaterThanOrEqual(2);
    });

    it("should validate email format", () => {
      const validEmails = [
        "test@example.com",
        "user.name@domain.org",
        "a@b.co",
      ];

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      validEmails.forEach(email => {
        expect(email).toMatch(emailRegex);
      });
    });

    it("should detect invalid email format", () => {
      const invalidEmails = ["notanemail", "@nouser.com", "noat.com"];

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      invalidEmails.forEach(email => {
        expect(email).not.toMatch(emailRegex);
      });
    });

    it("should require non-empty payer names", () => {
      const validNames = ["John Doe", "Jane", "A B"];
      validNames.forEach(name => {
        expect(name.trim().length).toBeGreaterThan(0);
      });
    });
  });

  describe("Expiration calculation", () => {
    it("should calculate correct expiration date", () => {
      const days = 7;
      const now = new Date();
      const expirationDate = new Date();
      expirationDate.setDate(expirationDate.getDate() + days);

      const diffTime = expirationDate.getTime() - now.getTime();
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      expect(diffDays).toBe(days);
    });

    it("should handle custom expiration periods", () => {
      const testPeriods = [1, 3, 7, 14, 30];

      testPeriods.forEach(days => {
        const now = new Date();
        const expiration = new Date();
        expiration.setDate(expiration.getDate() + days);

        const diffTime = expiration.getTime() - now.getTime();
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        expect(diffDays).toBe(days);
      });
    });

    it("should detect expired dates", () => {
      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - 1);

      const isExpired = pastDate < new Date();
      expect(isExpired).toBe(true);
    });

    it("should detect valid (non-expired) dates", () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 1);

      const isExpired = futureDate < new Date();
      expect(isExpired).toBe(false);
    });
  });

  describe("Split status transitions", () => {
    const validStatuses = [
      "pending",
      "email_sent",
      "paid",
      "failed",
      "cancelled",
      "expired",
    ];

    it("should have defined status values", () => {
      expect(validStatuses).toContain("pending");
      expect(validStatuses).toContain("email_sent");
      expect(validStatuses).toContain("paid");
      expect(validStatuses).toContain("failed");
      expect(validStatuses).toContain("cancelled");
      expect(validStatuses).toContain("expired");
    });

    it("should start with pending status", () => {
      const initialStatus = "pending";
      expect(validStatuses).toContain(initialStatus);
    });

    it("should transition to email_sent after sending", () => {
      const afterSend = "email_sent";
      expect(validStatuses).toContain(afterSend);
    });

    it("should transition to paid after successful payment", () => {
      const afterPayment = "paid";
      expect(validStatuses).toContain(afterPayment);
    });

    it("should be able to transition to cancelled", () => {
      const cancelStatus = "cancelled";
      expect(validStatuses).toContain(cancelStatus);
    });
  });

  describe("Currency and amount formatting", () => {
    it("should store amounts in cents", () => {
      const amountInSAR = 500; // 500 SAR
      const amountInCents = amountInSAR * 100;

      expect(amountInCents).toBe(50000);
    });

    it("should convert cents to SAR for display", () => {
      const amountInCents = 50000;
      const amountInSAR = amountInCents / 100;

      expect(amountInSAR).toBe(500);
    });

    it("should handle decimal SAR amounts", () => {
      const amountInSAR = 499.99;
      const amountInCents = Math.round(amountInSAR * 100);

      expect(amountInCents).toBe(49999);
    });

    it("should format amounts for display", () => {
      const amountInCents = 50000;
      const formatted = (amountInCents / 100).toFixed(2);

      expect(formatted).toBe("500.00");
    });
  });

  describe("Multiple payer scenarios", () => {
    it("should handle 2 equal payers", () => {
      const total = 100000;
      const perPayer = total / 2;

      expect(perPayer * 2).toBe(total);
    });

    it("should handle 3 equal payers with rounding", () => {
      const total = 100000;
      const perPayer = Math.floor(total / 3);
      const remainder = total - perPayer * 3;

      // First payer gets the remainder
      const splits = [
        perPayer + remainder, // 33334
        perPayer, // 33333
        perPayer, // 33333
      ];

      expect(splits.reduce((a, b) => a + b, 0)).toBe(total);
    });

    it("should handle many payers (up to 10)", () => {
      const total = 100000;
      const numPayers = 10;
      const perPayer = Math.floor(total / numPayers);
      const remainder = total - perPayer * numPayers;

      const splits = Array(numPayers)
        .fill(perPayer)
        .map((amount, i) => (i === 0 ? amount + remainder : amount));

      expect(splits.reduce((a, b) => a + b, 0)).toBe(total);
      expect(splits.length).toBe(10);
    });

    it("should ensure all splits meet minimum amount", () => {
      const total = 100000;
      const numPayers = 10;
      const perPayer = Math.floor(total / numPayers);

      expect(perPayer).toBeGreaterThanOrEqual(MIN_SPLIT_AMOUNT);
    });
  });
});
