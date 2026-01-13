import { describe, expect, it } from "vitest";
import {
  calculateCancellationFee,
  getAllCancellationTiers,
} from "./cancellation-fees.service";

describe("Cancellation Fees Service", () => {
  const totalAmount = 100000; // 1000 SAR in cents

  it("should return 100% refund for cancellations more than 7 days before departure", () => {
    const departureTime = new Date(Date.now() + 8 * 24 * 60 * 60 * 1000); // 8 days from now
    const result = calculateCancellationFee(totalAmount, departureTime);

    expect(result.tier).toBe("full");
    expect(result.refundPercentage).toBe(100);
    expect(result.cancellationFee).toBe(0);
    expect(result.refundAmount).toBe(totalAmount);
  });

  it("should return 75% refund for cancellations 3-7 days before departure", () => {
    const departureTime = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000); // 5 days from now
    const result = calculateCancellationFee(totalAmount, departureTime);

    expect(result.tier).toBe("high");
    expect(result.refundPercentage).toBe(75);
    expect(result.cancellationFee).toBe(25000); // 25%
    expect(result.refundAmount).toBe(75000); // 75%
  });

  it("should return 50% refund for cancellations 1-3 days before departure", () => {
    const departureTime = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000); // 2 days from now
    const result = calculateCancellationFee(totalAmount, departureTime);

    expect(result.tier).toBe("medium");
    expect(result.refundPercentage).toBe(50);
    expect(result.cancellationFee).toBe(50000); // 50%
    expect(result.refundAmount).toBe(50000); // 50%
  });

  it("should return 25% refund for cancellations less than 24 hours before departure", () => {
    const departureTime = new Date(Date.now() + 12 * 60 * 60 * 1000); // 12 hours from now
    const result = calculateCancellationFee(totalAmount, departureTime);

    expect(result.tier).toBe("low");
    expect(result.refundPercentage).toBe(25);
    expect(result.cancellationFee).toBe(75000); // 75%
    expect(result.refundAmount).toBe(25000); // 25%
  });

  it("should return no refund for cancellations after departure", () => {
    const departureTime = new Date(Date.now() - 1 * 60 * 60 * 1000); // 1 hour ago
    const result = calculateCancellationFee(totalAmount, departureTime);

    expect(result.tier).toBe("none");
    expect(result.refundPercentage).toBe(0);
    expect(result.cancellationFee).toBe(totalAmount); // 100%
    expect(result.refundAmount).toBe(0); // 0%
  });

  it("should return all cancellation policy tiers", () => {
    const tiers = getAllCancellationTiers();

    expect(tiers).toHaveLength(5);
    expect(tiers[0]?.tier).toBe("full");
    expect(tiers[1]?.tier).toBe("high");
    expect(tiers[2]?.tier).toBe("medium");
    expect(tiers[3]?.tier).toBe("low");
    expect(tiers[4]?.tier).toBe("none");
  });
});
