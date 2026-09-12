import { TRPCError } from "@trpc/server";
export function calculateModificationFee(
  originalAmount: number,
  departureTime: Date
): number {
  const now = new Date();
  const hoursUntilDeparture =
    (departureTime.getTime() - now.getTime()) / (1000 * 60 * 60);

  let feePercentage: number;

  if (hoursUntilDeparture < 0) {
    // After departure - not allowed
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Cannot modify booking after departure",
    });
  } else if (hoursUntilDeparture < 24) {
    // Less than 24 hours - 15% fee
    feePercentage = 15;
  } else if (hoursUntilDeparture < 72) {
    // 1-3 days - 10% fee
    feePercentage = 10;
  } else if (hoursUntilDeparture < 168) {
    // 3-7 days - 5% fee
    feePercentage = 5;
  } else {
    // More than 7 days - no fee
    feePercentage = 0;
  }

  return Math.round((originalAmount * feePercentage) / 100);
}
