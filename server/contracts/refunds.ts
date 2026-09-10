// Explicit response field allowlists. Review contract changes with producers and consumers.
import { z } from "zod";
import { outputNumber } from "./primitives";
export const responseContracts = {
  create: z.object({
    success: z.boolean(),
    refundId: z.string(),
    amount: outputNumber,
    status: z.union([z.null(), z.string()]),
    cumulativeRefundedAmount: outputNumber,
    remainingRefundableAmount: outputNumber,
  }),
  adminCreate: z.object({
    success: z.boolean(),
    refundId: z.string(),
    amount: outputNumber,
    status: z.union([z.null(), z.string()]),
    cumulativeRefundedAmount: outputNumber,
    remainingRefundableAmount: outputNumber,
  }),
  getDetails: z.object({
    id: z.string(),
    amount: outputNumber,
    status: z.union([z.null(), z.string()]),
    reason: z.union([
      z.null(),
      z.literal("duplicate"),
      z.literal("expired_uncaptured_charge"),
      z.literal("fraudulent"),
      z.literal("requested_by_customer"),
    ]),
    created: outputNumber,
  }),
  checkRefundable: z.object({
    refundable: z.boolean(),
    reason: z.union([z.undefined(), z.string()]).optional(),
  }),
  calculateCancellationFee: z.object({
    totalAmount: outputNumber,
    cancellationFee: outputNumber,
    refundAmount: outputNumber,
    refundPercentage: outputNumber,
    tier: z.enum(["full", "high", "medium", "low", "none"]),
  }),
  getCancellationPolicy: z.array(
    z.object({
      tier: z.string(),
      timeframe: z.string(),
      refundPercentage: outputNumber,
      feePercentage: outputNumber,
      description: z.string(),
    })
  ),
  getStats: z.object({
    totalRefunds: outputNumber,
    totalRefundedAmount: outputNumber,
    pendingRefunds: outputNumber,
    completedRefunds: outputNumber,
    refundRate: outputNumber,
  }),
  getHistory: z.array(
    z.object({
      id: outputNumber,
      bookingId: outputNumber,
      bookingReference: z.string(),
      pnr: z.string(),
      userId: outputNumber,
      amount: outputNumber,
      status: z.string(),
      refundedAt: z.date(),
      flightNumber: z.union([z.undefined(), z.string()]).optional(),
      origin: z.union([z.undefined(), z.string()]).optional(),
      destination: z.union([z.undefined(), z.string()]).optional(),
    })
  ),
  getTrends: z.array(
    z.object({ date: z.string(), count: outputNumber, amount: outputNumber })
  ),
};
