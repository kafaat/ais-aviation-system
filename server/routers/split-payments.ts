/**
 * Split Payments Router
 * Handles all split payment related API endpoints
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { router, protectedProcedure, publicProcedure } from "../_core/trpc";
import * as splitPaymentService from "../services/split-payment.service";
import { getDb } from "../db";
import { bookings, paymentSplits } from "../../drizzle/schema";

// Input schemas
const splitPayerSchema = z.object({
  email: z.string().email("Invalid email address"),
  name: z.string().min(1, "Name is required"),
  amount: z.number().positive("Amount must be positive"),
});

const initiateSplitPaymentSchema = z.object({
  bookingId: z.number().positive(),
  splits: z.array(splitPayerSchema).min(2, "At least 2 payers required"),
  expirationDays: z.number().min(1).max(30).optional(),
});

export const splitPaymentsRouter = router({
  /**
   * Initiate a split payment for a booking
   * Protected: Only booking owner can initiate
   */
  initiate: protectedProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/split-payments/initiate",
        tags: ["Split Payments"],
        summary: "Initiate split payment for a booking",
        description:
          "Create payment splits for a booking. Requires at least 2 payers and amounts must equal booking total.",
        protect: true,
      },
    })
    .input(initiateSplitPaymentSchema)
    .output(
      z.object({
        splitIds: z.array(z.number()),
        totalAmount: z.number(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      // Validate booking exists
      const [booking] = await db
        .select()
        .from(bookings)
        .where(eq(bookings.id, input.bookingId))
        .limit(1);

      if (!booking) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Booking not found",
        });
      }

      // Validate booking belongs to the initiating user
      if (booking.userId !== ctx.user.id) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You can only initiate split payments for your own bookings",
        });
      }

      // Validate sum of split amounts equals booking total
      const totalSplitAmount = input.splits.reduce(
        (sum, s) => sum + s.amount,
        0
      );
      if (totalSplitAmount !== booking.totalAmount) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Split amounts total (${totalSplitAmount}) must equal booking total (${booking.totalAmount})`,
        });
      }

      return await splitPaymentService.initiateSplitPayment(input);
    }),

  /**
   * Get split payment status for a booking
   * Protected: Only booking owner or admin can view
   */
  getStatus: protectedProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/split-payments/status/{bookingId}",
        tags: ["Split Payments"],
        summary: "Get split payment status",
        description: "Get detailed status of all payment splits for a booking.",
        protect: true,
      },
    })
    .input(z.object({ bookingId: z.number().positive() }))
    .output(
      z
        .object({
          bookingId: z.number(),
          bookingReference: z.string(),
          totalAmount: z.number(),
          splits: z.array(
            z.object({
              id: z.number(),
              payerEmail: z.string(),
              payerName: z.string(),
              amount: z.number(),
              percentage: z.string(),
              status: z.string(),
              paidAt: z.date().nullable(),
            })
          ),
          allPaid: z.boolean(),
          paidCount: z.number(),
          totalSplits: z.number(),
          paidAmount: z.number(),
          pendingAmount: z.number(),
        })
        .nullable()
    )
    .query(async ({ input }) => {
      return await splitPaymentService.getSplitPaymentStatus(input.bookingId);
    }),

  /**
   * Send payment request email to a specific payer
   */
  sendRequest: protectedProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/split-payments/send-request",
        tags: ["Split Payments"],
        summary: "Send payment request email",
        description: "Send payment request email to a specific payer.",
        protect: true,
      },
    })
    .input(z.object({ splitId: z.number().positive() }))
    .output(z.object({ sent: z.boolean() }))
    .mutation(async ({ input }) => {
      const sent = await splitPaymentService.sendPaymentRequest(input.splitId);
      return { sent };
    }),

  /**
   * Resend payment request email
   */
  resendRequest: protectedProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/split-payments/resend-request",
        tags: ["Split Payments"],
        summary: "Resend payment request email",
        description:
          "Resend payment request email to a payer who has not yet paid.",
        protect: true,
      },
    })
    .input(z.object({ splitId: z.number().positive() }))
    .output(z.object({ sent: z.boolean() }))
    .mutation(async ({ input }) => {
      const sent = await splitPaymentService.resendPaymentRequest(
        input.splitId
      );
      return { sent };
    }),

  /**
   * Send all pending payment requests for a booking
   */
  sendAllRequests: protectedProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/split-payments/send-all-requests",
        tags: ["Split Payments"],
        summary: "Send all pending payment requests",
        description:
          "Send payment request emails to all payers who have not been notified.",
        protect: true,
      },
    })
    .input(z.object({ bookingId: z.number().positive() }))
    .output(z.object({ sentCount: z.number() }))
    .mutation(async ({ input }) => {
      const sentCount = await splitPaymentService.sendAllPaymentRequests(
        input.bookingId
      );
      return { sentCount };
    }),

  /**
   * Cancel a specific split (before it's paid)
   */
  cancelSplit: protectedProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/split-payments/cancel-split",
        tags: ["Split Payments"],
        summary: "Cancel a split",
        description:
          "Cancel a specific payment split. Cannot cancel if already paid.",
        protect: true,
      },
    })
    .input(z.object({ splitId: z.number().positive() }))
    .output(z.object({ cancelled: z.boolean() }))
    .mutation(async ({ input }) => {
      await splitPaymentService.cancelSplit(input.splitId);
      return { cancelled: true };
    }),

  /**
   * Cancel all splits for a booking
   */
  cancelAll: protectedProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/split-payments/cancel-all",
        tags: ["Split Payments"],
        summary: "Cancel all splits for a booking",
        description:
          "Cancel all payment splits for a booking. Cannot cancel if any are paid.",
        protect: true,
      },
    })
    .input(z.object({ bookingId: z.number().positive() }))
    .output(z.object({ cancelled: z.boolean() }))
    .mutation(async ({ input }) => {
      await splitPaymentService.cancelAllSplits(input.bookingId);
      return { cancelled: true };
    }),

  /**
   * Get payment details for payer (public - uses token)
   */
  getPayerDetails: publicProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/split-payments/pay/{paymentToken}",
        tags: ["Split Payments"],
        summary: "Get payment details for payer",
        description:
          "Get payment details using a payment token. This is a public endpoint for payers.",
      },
    })
    .input(z.object({ paymentToken: z.string().length(64) }))
    .output(
      z
        .object({
          splitId: z.number(),
          bookingReference: z.string(),
          flightNumber: z.string(),
          route: z.string(),
          departureTime: z.date(),
          payerName: z.string(),
          payerEmail: z.string(),
          amount: z.number(),
          status: z.string(),
          expiresAt: z.date().nullable(),
        })
        .nullable()
    )
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      // Check payment expiration before fetching full details
      const [split] = await db
        .select({
          expiresAt: paymentSplits.expiresAt,
          status: paymentSplits.status,
        })
        .from(paymentSplits)
        .where(eq(paymentSplits.paymentToken, input.paymentToken))
        .limit(1);

      if (!split) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Payment not found",
        });
      }

      if (split.expiresAt && new Date() > split.expiresAt) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This payment request has expired",
        });
      }

      return await splitPaymentService.getPayerPaymentDetails(
        input.paymentToken
      );
    }),

  /**
   * Create Stripe checkout session for payer (public - uses token)
   */
  createPayerCheckout: publicProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/split-payments/checkout",
        tags: ["Split Payments"],
        summary: "Create checkout session for payer",
        description:
          "Create a Stripe checkout session for a payer using their payment token.",
      },
    })
    .input(z.object({ paymentToken: z.string().length(64) }))
    .output(
      z.object({
        sessionId: z.string(),
        url: z.string().nullable(),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      // Check payment expiration before creating checkout session
      const [split] = await db
        .select({
          expiresAt: paymentSplits.expiresAt,
          status: paymentSplits.status,
        })
        .from(paymentSplits)
        .where(eq(paymentSplits.paymentToken, input.paymentToken))
        .limit(1);

      if (!split) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Payment not found",
        });
      }

      if (split.expiresAt && new Date() > split.expiresAt) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This payment request has expired",
        });
      }

      return await splitPaymentService.processPayerPayment(input.paymentToken);
    }),

  /**
   * Check if all splits are paid
   */
  checkAllPaid: protectedProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/split-payments/check-all-paid/{bookingId}",
        tags: ["Split Payments"],
        summary: "Check if all splits are paid",
        description:
          "Check if all payment splits for a booking have been paid.",
        protect: true,
      },
    })
    .input(z.object({ bookingId: z.number().positive() }))
    .output(z.object({ allPaid: z.boolean() }))
    .query(async ({ input }) => {
      const allPaid = await splitPaymentService.checkAllPaid(input.bookingId);
      return { allPaid };
    }),
});
