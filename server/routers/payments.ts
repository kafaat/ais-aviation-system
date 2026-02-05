import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { stripe } from "../stripe";
import * as db from "../db";
import { getDb } from "../db";
import { bookings } from "../../drizzle/schema";
import { eq } from "drizzle-orm";
import { auditPayment } from "../services/audit.service";

/**
 * Payments Router
 * Handles all payment-related operations
 */
export const paymentsRouter = router({
  /**
   * Create Stripe checkout session
   */
  createCheckoutSession: protectedProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/payments/checkout",
        tags: ["Payments"],
        summary: "Create Stripe checkout session",
        description:
          "Create a Stripe checkout session for a pending booking. Returns a session ID and URL to redirect the user to the Stripe payment page. The booking must belong to the authenticated user and not already be paid.",
        protect: true,
      },
    })
    .input(z.object({ bookingId: z.number().describe("Booking ID to pay for") }))
    .output(
      z.object({
        sessionId: z.string().describe("Stripe session ID"),
        url: z.string().nullable().describe("Stripe checkout URL"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const database = await getDb();
      if (!database) throw new Error("Database not available");

      // Get booking details
      const bookingResult = await database
        .select()
        .from(bookings)
        .where(eq(bookings.id, input.bookingId))
        .limit(1);

      const bookingData = bookingResult[0];
      if (!bookingData) {
        throw new Error("Booking not found");
      }

      // Verify ownership
      if (bookingData.userId !== ctx.user.id) {
        throw new Error("Access denied");
      }

      // Check if already paid
      if (bookingData.paymentStatus === "paid") {
        throw new Error("Booking is already paid");
      }

      // Create Stripe checkout session
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
        success_url: `${ctx.req.headers.origin}/my-bookings?session_id={CHECKOUT_SESSION_ID}&success=true`,
        cancel_url: `${ctx.req.headers.origin}/booking/${input.bookingId}?canceled=true`,
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

      // Update booking with session ID
      await database
        .update(bookings)
        .set({ stripeCheckoutSessionId: session.id })
        .where(eq(bookings.id, input.bookingId));

      // Audit log: Payment initiated
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
        sessionId: session.id,
        url: session.url,
      };
    }),

  /**
   * Verify Stripe session
   */
  verifySession: protectedProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/payments/verify/{sessionId}",
        tags: ["Payments"],
        summary: "Verify Stripe session status",
        description:
          "Verify the payment status of a Stripe checkout session. Use this after redirect from Stripe to confirm payment completion.",
        protect: true,
      },
    })
    .input(z.object({ sessionId: z.string().describe("Stripe session ID") }))
    .output(
      z.object({
        status: z.string().describe("Payment status (paid, unpaid, no_payment_required)"),
        customerEmail: z.string().nullable().describe("Customer email"),
      })
    )
    .query(async ({ input }) => {
      const session = await stripe.checkout.sessions.retrieve(input.sessionId);
      return {
        status: session.payment_status,
        customerEmail: session.customer_email,
      };
    }),

  /**
   * Create payment record (legacy - for non-Stripe payments)
   */
  create: protectedProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/payments",
        tags: ["Payments"],
        summary: "Create payment (legacy)",
        description:
          "Create a payment record for non-Stripe payment methods. This is a legacy endpoint for direct card, wallet, or bank transfer payments. For new integrations, use the Stripe checkout flow.",
        protect: true,
      },
    })
    .input(
      z.object({
        bookingId: z.number().describe("Booking ID"),
        amount: z.number().describe("Payment amount in smallest currency unit"),
        method: z.enum(["card", "wallet", "bank_transfer"]).describe("Payment method"),
      })
    )
    .output(
      z.object({
        paymentId: z.number(),
        transactionId: z.string(),
        status: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Get booking reference for audit
      const booking = await db.getBookingByIdWithDetails(input.bookingId);
      const bookingReference = booking?.bookingReference || `booking-${input.bookingId}`;

      // Create payment record
      const paymentResult = await db.createPayment({
        bookingId: input.bookingId,
        amount: input.amount,
        currency: "SAR",
        method: input.method,
        status: "pending",
        transactionId: null,
      });

      const paymentId = Number(paymentResult[0].insertId);

      // Simulate payment processing
      // In production, integrate with actual payment gateway
      const transactionId = `TXN-${Date.now()}-${Math.random()
        .toString(36)
        .substring(7)}`;

      await db.updatePaymentStatus(paymentId, "completed", transactionId);
      await db.updateBookingStatus(input.bookingId, "confirmed");

      // Audit log: Payment success
      await auditPayment(
        input.bookingId,
        bookingReference,
        input.amount,
        "PAYMENT_SUCCESS",
        ctx.user.id,
        transactionId,
        ctx.req.ip,
        ctx.req.headers["x-request-id"] as string
      );

      return {
        paymentId,
        transactionId,
        status: "completed",
      };
    }),
});
