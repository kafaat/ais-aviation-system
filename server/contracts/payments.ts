// Explicit response field allowlists. Review contract changes with producers and consumers.
import { z } from "zod";
import { outputNumber } from "./primitives";
export const responseContracts = {
  settlementReviews: z.array(
    z.object({
      paymentIntentId: z.string(),
      kind: z.enum([
        "booking",
        "split_payment",
        "modification",
        "wallet_topup",
      ]),
      bookingId: z.union([z.null(), outputNumber]),
      userId: outputNumber,
      targetId: outputNumber,
      amount: outputNumber,
      currency: z.string(),
      refundedAmount: outputNumber,
      settlementStatus: z.enum([
        "applied",
        "review_required",
        "review_refunded",
      ]),
      settlementError: z.union([z.null(), z.string()]),
      createdAt: z.date(),
    })
  ),
  getProviders: z.array(
    z.object({
      integrationState: z
        .union([
          z.undefined(),
          z.literal("implemented"),
          z.literal("unverified"),
        ])
        .optional(),
      unavailableReason: z.union([z.undefined(), z.string()]).optional(),
      id: z.enum([
        "stripe",
        "hyperpay",
        "tabby",
        "tamara",
        "stc_pay",
        "moyasar",
        "floosak",
        "jawali",
        "onecash",
        "easycash",
      ]),
      name: z.string(),
      nameAr: z.string(),
      methods: z.array(
        z.enum([
          "tabby",
          "tamara",
          "stc_pay",
          "card",
          "wallet",
          "bank_transfer",
          "mada",
          "apple_pay",
        ])
      ),
      supportsBNPL: z.boolean(),
      supportsRefund: z.boolean(),
      supportsRecurring: z.boolean(),
      minAmount: outputNumber,
      maxAmount: outputNumber,
      currencies: z.array(z.string()),
      region: z.enum(["international", "saudi", "yemen", "mena"]),
      enabled: z.boolean(),
    })
  ),
  createModificationCheckout: z.object({
    provider: z.string(),
    sessionId: z.string(),
    url: z.union([z.null(), z.string()]),
  }),
  getHistory: z.array(
    z.object({
      id: outputNumber,
      amount: outputNumber,
      currency: z.string(),
      method: z.enum([
        "tabby",
        "tamara",
        "stc_pay",
        "card",
        "wallet",
        "bank_transfer",
        "mada",
        "apple_pay",
      ]),
      status: z.enum(["completed", "pending", "refunded", "failed"]),
      transactionId: z.union([z.null(), z.string()]),
      createdAt: z.date(),
      bookingId: outputNumber,
      bookingReference: z.string(),
      pnr: z.string(),
      cabinClass: z.enum(["economy", "business"]),
      flightNumber: z.string(),
      origin: z.string(),
      destination: z.string(),
      departureTime: z.date(),
    })
  ),
  getStats: z.object({
    totalPayments: outputNumber,
    totalAmount: outputNumber,
    completedCount: outputNumber,
    completedAmount: outputNumber,
    refundedCount: outputNumber,
    refundedAmount: outputNumber,
    pendingCount: outputNumber,
    failedCount: outputNumber,
  }),
  adminGetHistory: z.array(
    z.object({
      id: outputNumber,
      amount: outputNumber,
      currency: z.string(),
      method: z.enum([
        "tabby",
        "tamara",
        "stc_pay",
        "card",
        "wallet",
        "bank_transfer",
        "mada",
        "apple_pay",
      ]),
      status: z.enum(["completed", "pending", "refunded", "failed"]),
      transactionId: z.union([z.null(), z.string()]),
      createdAt: z.date(),
      bookingId: outputNumber,
      bookingReference: z.string(),
      pnr: z.string(),
      cabinClass: z.enum(["economy", "business"]),
      numberOfPassengers: outputNumber,
      flightNumber: z.string(),
      origin: z.string(),
      destination: z.string(),
      departureTime: z.date(),
    })
  ),
  adminGetStats: z.object({
    totalPayments: outputNumber,
    totalAmount: outputNumber,
    completedCount: outputNumber,
    completedAmount: outputNumber,
    refundedCount: outputNumber,
    refundedAmount: outputNumber,
    pendingCount: outputNumber,
    failedCount: outputNumber,
    todayPayments: outputNumber,
    todayAmount: outputNumber,
  }),
};
