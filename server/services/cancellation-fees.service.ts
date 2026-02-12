/**
 * Cancellation Fees Service
 * Calculates cancellation fees based on time until departure
 */

import { TRPCError } from "@trpc/server";

export interface CancellationFeeResult {
  totalAmount: number;
  cancellationFee: number;
  refundAmount: number;
  refundPercentage: number;
  tier: "full" | "high" | "medium" | "low" | "none";
}

/**
 * Calculate cancellation fee based on time until departure
 *
 * Tiered structure:
 * - More than 7 days: 0% fee (100% refund)
 * - 3-7 days: 25% fee (75% refund)
 * - 1-3 days: 50% fee (50% refund)
 * - Less than 24 hours: 75% fee (25% refund)
 * - After departure: No refund
 */
export function calculateCancellationFee(
  totalAmount: number,
  departureTime: Date,
  bookingStatus?: string
): CancellationFeeResult {
  // Validate totalAmount is positive
  if (totalAmount <= 0) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Total amount must be a positive number",
    });
  }

  // Validate departureTime is a valid Date
  if (!(departureTime instanceof Date) || isNaN(departureTime.getTime())) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Departure time must be a valid date",
    });
  }

  // If booking is not yet confirmed, return 0 fee and full refund
  if (bookingStatus && bookingStatus !== "confirmed") {
    return {
      totalAmount,
      cancellationFee: 0,
      refundAmount: totalAmount,
      refundPercentage: 100,
      tier: "full",
    };
  }

  const now = new Date();
  const hoursUntilDeparture =
    (departureTime.getTime() - now.getTime()) / (1000 * 60 * 60);

  let feePercentage: number;
  let tier: CancellationFeeResult["tier"];

  if (hoursUntilDeparture < 0) {
    // After departure - no refund
    feePercentage = 100;
    tier = "none";
  } else if (hoursUntilDeparture < 24) {
    // Less than 24 hours - 75% fee
    feePercentage = 75;
    tier = "low";
  } else if (hoursUntilDeparture < 72) {
    // 1-3 days - 50% fee
    feePercentage = 50;
    tier = "medium";
  } else if (hoursUntilDeparture < 168) {
    // 3-7 days - 25% fee
    feePercentage = 25;
    tier = "high";
  } else {
    // More than 7 days - no fee
    feePercentage = 0;
    tier = "full";
  }

  const cancellationFee = Math.round((totalAmount * feePercentage) / 100);
  const refundAmount = totalAmount - cancellationFee;
  const refundPercentage = 100 - feePercentage;

  return {
    totalAmount,
    cancellationFee,
    refundAmount,
    refundPercentage,
    tier,
  };
}

/**
 * Get cancellation policy description
 */
export function getCancellationPolicyDescription(
  tier: CancellationFeeResult["tier"]
): string {
  const descriptions = {
    full: "استرداد كامل (100%) - أكثر من 7 أيام قبل الرحلة",
    high: "استرداد 75% - من 3 إلى 7 أيام قبل الرحلة",
    medium: "استرداد 50% - من 1 إلى 3 أيام قبل الرحلة",
    low: "استرداد 25% - أقل من 24 ساعة قبل الرحلة",
    none: "لا يمكن الاسترداد - بعد موعد الرحلة",
  };

  return descriptions[tier];
}

/**
 * Get all cancellation policy tiers
 */
export function getAllCancellationTiers() {
  return [
    {
      tier: "full",
      timeframe: "أكثر من 7 أيام",
      refundPercentage: 100,
      feePercentage: 0,
      description: "استرداد كامل بدون رسوم",
    },
    {
      tier: "high",
      timeframe: "3-7 أيام",
      refundPercentage: 75,
      feePercentage: 25,
      description: "رسوم إلغاء 25%",
    },
    {
      tier: "medium",
      timeframe: "1-3 أيام",
      refundPercentage: 50,
      feePercentage: 50,
      description: "رسوم إلغاء 50%",
    },
    {
      tier: "low",
      timeframe: "أقل من 24 ساعة",
      refundPercentage: 25,
      feePercentage: 75,
      description: "رسوم إلغاء 75%",
    },
    {
      tier: "none",
      timeframe: "بعد موعد الرحلة",
      refundPercentage: 0,
      feePercentage: 100,
      description: "لا يمكن الاسترداد",
    },
  ];
}
