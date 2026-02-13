import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { stripe } from "../stripe";
import * as db from "../db";
import { getDb } from "../db";
import { bookings } from "../../drizzle/schema";
import { eq } from "drizzle-orm";

/**
 * Payments Router
 * Handles all payment-related operations
 */
export const paymentsRouter = router({
  /**
   * Create Stripe checkout session
   */
  createCheckoutSession: protectedProcedure
    .input(z.object({ bookingId: z.number() }))
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

      return {
        sessionId: session.id,
        url: session.url,
      };
    }),

  /**
   * Verify Stripe session
   */
  verifySession: protectedProcedure
    .input(z.object({ sessionId: z.string() }))
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
    .input(
      z.object({
        bookingId: z.number(),
        amount: z.number(),
        method: z.enum(["card", "wallet", "bank_transfer"]),
      })
    )
    .mutation(async ({ input }) => {
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

      return {
        paymentId,
        transactionId,
        status: "completed",
      };
    }),
});
