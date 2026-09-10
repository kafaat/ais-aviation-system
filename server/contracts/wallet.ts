// Explicit response field allowlists. Review contract changes with producers and consumers.
import { z } from "zod";
import { outputNumber } from "./primitives";
export const responseContracts = {
  balance: z.object({
    balance: outputNumber,
    currency: z.string(),
    status: z.enum(["active", "closed", "frozen"]),
  }),
  topUp: z.object({
    status: z.literal("pending"),
    sessionId: z.string(),
    url: z.union([z.null(), z.string()]),
  }),
  pay: z.object({ balance: outputNumber, amountPaid: outputNumber }),
  transactions: z.array(
    z.object({
      id: outputNumber,
      walletId: outputNumber,
      userId: outputNumber,
      type: z.enum(["payment", "refund", "bonus", "top_up", "withdrawal"]),
      amount: outputNumber,
      balanceAfter: outputNumber,
      description: z.string(),
      bookingId: z.union([z.null(), outputNumber]),
      stripePaymentIntentId: z.union([z.null(), z.string()]),
      status: z.enum(["completed", "pending", "failed"]),
      createdAt: z.date(),
    })
  ),
};
