import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  publicProcedure,
  protectedProcedure,
  adminProcedure,
  router,
} from "../_core/trpc";
import { stripe } from "../stripe";
import { getDb } from "../db";
import { bookings, bookingModifications } from "../../drizzle/schema";
import { and, eq } from "drizzle-orm";
import { auditPayment } from "../services/audit.service";
import * as paymentHistoryService from "../services/payment-history.service";
import {
  getAllProviderInfo,
  getAvailableProviderInfo,
  createCheckoutWithProvider,
  verifyPaymentWithProvider,
  type PaymentProviderType,
} from "../services/payment-providers";

const providerEnum = z.enum([
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
]);

/**
 * Payments Router
 * Handles all payment-related operations with multi-provider support
 */
export const paymentsRouter = router({
  /**
   * Get all available payment providers
   */
  getProviders: publicProcedure
    .input(
      z
        .object({
          includeUnavailable: z.boolean().optional(),
        })
        .optional()
    )
    .query(({ input }) => {
      if (input?.includeUnavailable) {
        return getAllProviderInfo();
      }
      return getAvailableProviderInfo();
    }),

  /**
   * Create checkout session with selected payment provider
   */
  createCheckoutSession: protectedProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/payments/checkout",
        tags: ["Payments"],
        summary: "Create checkout session with payment provider",
        description:
          "Create a checkout session for a pending booking using the selected payment provider. Returns a session ID and URL to redirect the user to the payment page.",
        protect: true,
      },
    })
    .input(
      z.object({
        bookingId: z.number().describe("Booking ID to pay for"),
        provider: providerEnum
          .optional()
          .default("stripe")
          .describe("Payment provider"),
      })
    )
    .output(
      z.object({
        provider: z.string().describe("Payment provider used"),
        sessionId: z.string().describe("Provider session ID"),
        url: z.string().nullable().describe("Checkout URL"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const database = await getDb();
      if (!database)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Database not available",
        });

      // Get booking details
      const bookingResult = await database
        .select()
        .from(bookings)
        .where(eq(bookings.id, input.bookingId))
        .limit(1);

      const bookingData = bookingResult[0];
      if (!bookingData) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Booking not found",
        });
      }

      // Verify ownership
      if (bookingData.userId !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Access denied" });
      }

      // Check if already paid
      if (bookingData.paymentStatus === "paid") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Booking is already paid",
        });
      }

      const appBaseUrl =
        ctx.req.headers.origin ||
        process.env.VITE_APP_URL ||
        `${ctx.req.protocol}://${ctx.req.get("host")}`;

      const providerId = (input.provider || "stripe") as PaymentProviderType;

      // Use legacy Stripe flow for backward compatibility when provider is stripe
      if (providerId === "stripe") {
        const productName = `Flight Booking - ${bookingData.bookingReference}`;
        const productDescription = `PNR: ${bookingData.pnr}`;

        const session = await stripe.checkout.sessions.create({
          payment_method_types: ["card"],
          line_items: [
            {
              price_data: {
                currency: "sar",
                product_data: {
                  name: productName,
                  description: `${productDescription} - ${bookingData.numberOfPassengers} passenger(s) - Ref: ${bookingData.bookingReference}`,
                  metadata: {
                    bookingReference: bookingData.bookingReference,
                    pnr: bookingData.pnr,
                  },
                },
                unit_amount: bookingData.totalAmount,
              },
              quantity: 1,
            },
          ],
          mode: "payment",
          success_url: `${appBaseUrl}/my-bookings?session_id={CHECKOUT_SESSION_ID}&success=true`,
          cancel_url: `${appBaseUrl}/booking/${input.bookingId}?canceled=true`,
          customer_email: ctx.user.email || undefined,
          client_reference_id: ctx.user.id.toString(),
          metadata: {
            bookingId: input.bookingId.toString(),
            userId: ctx.user.id.toString(),
            bookingReference: bookingData.bookingReference,
            customerEmail: ctx.user.email || "",
            customerName: ctx.user.name || "",
          },
          allow_promotion_codes: true,
        });

        await database
          .update(bookings)
          .set({ stripeCheckoutSessionId: session.id })
          .where(eq(bookings.id, input.bookingId));

        await auditPayment(
          input.bookingId,
          bookingData.bookingReference,
          bookingData.totalAmount,
          "PAYMENT_INITIATED",
          ctx.user.id,
          session.id,
          ctx.req.ip,
          ctx.req.headers["x-request-id"] as string
        );

        return {
          provider: "stripe",
          sessionId: session.id,
          url: session.url,
        };
      }

      // Use multi-provider flow for other providers
      const result = await createCheckoutWithProvider(providerId, {
        bookingId: input.bookingId,
        userId: ctx.user.id,
        amount: bookingData.totalAmount,
        currency: "SAR",
        customerEmail: ctx.user.email || undefined,
        customerName: ctx.user.name || undefined,
        bookingReference: bookingData.bookingReference,
        pnr: bookingData.pnr,
        description: `Flight Booking - ${bookingData.bookingReference}`,
        successUrl: `${appBaseUrl}/my-bookings?provider=${providerId}&success=true`,
        cancelUrl: `${appBaseUrl}/booking/${input.bookingId}?canceled=true`,
        metadata: {
          bookingId: input.bookingId.toString(),
          userId: ctx.user.id.toString(),
        },
      });

      await auditPayment(
        input.bookingId,
        bookingData.bookingReference,
        bookingData.totalAmount,
        "PAYMENT_INITIATED",
        ctx.user.id,
        result.sessionId,
        ctx.req.ip,
        ctx.req.headers["x-request-id"] as string
      );

      return {
        provider: result.provider,
        sessionId: result.sessionId,
        url: result.url,
      };
    }),

  /**
   * Create checkout for a persisted booking modification (date change / upgrade).
   * The client identifies the modification but never supplies the amount: the
   * authoritative charge comes from booking_modifications.totalCost.
   */
  createModificationCheckout: protectedProcedure
    .input(
      z.object({
        bookingId: z.number().int().positive().describe("Booking ID"),
        modificationId: z
          .number()
          .int()
          .positive()
          .describe("Modification request ID"),
        provider: providerEnum.optional().default("stripe"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const database = await getDb();
      if (!database)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Database not available",
        });

      const [bookingData] = await database
        .select()
        .from(bookings)
        .where(
          and(
            eq(bookings.id, input.bookingId),
            eq(bookings.userId, ctx.user.id)
          )
        )
        .limit(1);

      if (!bookingData) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Booking not found",
        });
      }

      // Collapse ID, booking and user authority into one lookup. A mismatched
      // modification is indistinguishable from a missing one and cannot leak
      // another passenger's modification existence.
      const [modification] = await database
        .select()
        .from(bookingModifications)
        .where(
          and(
            eq(bookingModifications.id, input.modificationId),
            eq(bookingModifications.bookingId, input.bookingId),
            eq(bookingModifications.userId, ctx.user.id)
          )
        )
        .limit(1);

      if (!modification) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Modification request not found",
        });
      }

      if (modification.status !== "pending") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Only pending modification requests can be paid",
        });
      }

      if (modification.totalCost <= 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This modification does not require a positive payment",
        });
      }

      const authoritativeAmount = modification.totalCost;
      const appBaseUrl =
        ctx.req.headers.origin ||
        process.env.VITE_APP_URL ||
        `${ctx.req.protocol}://${ctx.req.get("host")}`;

      const providerId = (input.provider || "stripe") as PaymentProviderType;

      if (providerId === "stripe") {
        const session = await stripe.checkout.sessions.create({
          payment_method_types: ["card"],
          line_items: [
            {
              price_data: {
                currency: "sar",
                product_data: {
                  name: `Booking Modification - ${bookingData.bookingReference}`,
                  description: `Modification #${input.modificationId}`,
                },
                unit_amount: authoritativeAmount,
              },
              quantity: 1,
            },
          ],
          mode: "payment",
          success_url: `${appBaseUrl}/my-bookings?modification=success&session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${appBaseUrl}/my-bookings?modification=cancelled`,
          customer_email: ctx.user.email || undefined,
          client_reference_id: ctx.user.id.toString(),
          metadata: {
            bookingId: input.bookingId.toString(),
            modificationId: input.modificationId.toString(),
            userId: ctx.user.id.toString(),
            type: "modification",
            authoritativeAmount: authoritativeAmount.toString(),
          },
        });

        return {
          provider: "stripe",
          sessionId: session.id,
          url: session.url,
        };
      }

      const result = await createCheckoutWithProvider(providerId, {
        bookingId: input.bookingId,
        userId: ctx.user.id,
        amount: authoritativeAmount,
        currency: "SAR",
        customerEmail: ctx.user.email || undefined,
        customerName: ctx.user.name || undefined,
        bookingReference: bookingData.bookingReference,
        pnr: bookingData.pnr,
        description: `Booking Modification - ${bookingData.bookingReference}`,
        successUrl: `${appBaseUrl}/my-bookings?modification=success`,
        cancelUrl: `${appBaseUrl}/my-bookings?modification=cancelled`,
        metadata: {
          bookingId: input.bookingId.toString(),
          modificationId: input.modificationId.toString(),
          userId: ctx.user.id.toString(),
          type: "modification",
          authoritativeAmount: authoritativeAmount.toString(),
        },
      });

      return {
        provider: result.provider,
        sessionId: result.sessionId,
        url: result.url,
      };
    }),

  /**
   * Verify payment session with provider
   */
  verifySession: protectedProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/payments/verify/{sessionId}",
        tags: ["Payments"],
        summary: "Verify payment session status",
        description:
          "Verify the payment status of a checkout session. Supports all payment providers.",
        protect: true,
      },
    })
    .input(
      z.object({
        sessionId: z.string().describe("Provider session ID"),
        provider: providerEnum.optional().default("stripe"),
      })
    )
    .output(
      z.object({
        status: z.string().describe("Payment status"),
        customerEmail: z.string().nullable().describe("Customer email"),
      })
    )
    .query(async ({ input }) => {
      const providerId = (input.provider || "stripe") as PaymentProviderType;

      if (providerId === "stripe") {
        const session = await stripe.checkout.sessions.retrieve(
          input.sessionId
        );
        return {
          status: session.payment_status,
          customerEmail: session.customer_email,
        };
      }

      const result = await verifyPaymentWithProvider(
        providerId,
        input.sessionId
      );
      return {
        status: result.status,
        customerEmail: result.customerEmail || null,
      };
    }),

  /**
   * Retired legacy payment endpoint. Keep the contract to return an explicit
   * error to old clients; only provider-verified flows may settle a payment.
   */
  create: protectedProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/payments",
        tags: ["Payments"],
        summary: "Create payment (legacy, disabled)",
        description:
          "Disabled: direct payment creation cannot prove collection of funds. Use /payments/checkout and the provider-verified payment flow.",
        protect: true,
      },
    })
    .input(
      z.object({
        bookingId: z.number().describe("Booking ID"),
        amount: z.number().describe("Payment amount in smallest currency unit"),
        method: z
          .enum(["card", "wallet", "bank_transfer"])
          .describe("Payment method"),
      })
    )
    .output(
      z.object({
        paymentId: z.number(),
        transactionId: z.string(),
        status: z.string(),
      })
    )
    .mutation(() => {
      // Authentication, ownership, or an admin role is not proof of payment.
      // Do not create records, confirm bookings, or emit success audit events.
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message:
          "Legacy payment creation is disabled. Use payments.createCheckoutSession.",
      });
    }),

  /**
   * Get user's payment history
   */
  getHistory: protectedProcedure
    .input(
      z.object({
        status: z.string().optional(),
        method: z.string().optional(),
        dateFrom: z.string().optional(),
        dateTo: z.string().optional(),
        limit: z.number().int().min(1).max(100).optional(),
        offset: z.number().int().min(0).optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      return await paymentHistoryService.getUserPaymentHistory(ctx.user.id, {
        status: input.status,
        method: input.method,
        dateFrom: input.dateFrom ? new Date(input.dateFrom) : undefined,
        dateTo: input.dateTo ? new Date(input.dateTo) : undefined,
        limit: input.limit,
        offset: input.offset,
      });
    }),

  /**
   * Get user's payment statistics
   */
  getStats: protectedProcedure.query(async ({ ctx }) => {
    return await paymentHistoryService.getUserPaymentStats(ctx.user.id);
  }),

  /**
   * Admin: Get all payment history
   */
  adminGetHistory: adminProcedure
    .input(
      z.object({
        status: z.string().optional(),
        method: z.string().optional(),
        dateFrom: z.string().optional(),
        dateTo: z.string().optional(),
        limit: z.number().int().min(1).max(100).optional(),
        offset: z.number().int().min(0).optional(),
      })
    )
    .query(async ({ input }) => {
      return await paymentHistoryService.getAdminPaymentHistory({
        status: input.status,
        method: input.method,
        dateFrom: input.dateFrom ? new Date(input.dateFrom) : undefined,
        dateTo: input.dateTo ? new Date(input.dateTo) : undefined,
        limit: input.limit,
        offset: input.offset,
      });
    }),

  /**
   * Admin: Get payment statistics
   */
  adminGetStats: adminProcedure.query(async () => {
    return await paymentHistoryService.getAdminPaymentStats();
  }),
});
