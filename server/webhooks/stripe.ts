import type { Request, Response } from 'express';
import Stripe from 'stripe';
import { stripe } from '../stripe';
import { getDb } from '../db';
import { bookings, flights, airports, users } from '../../drizzle/schema';
import { eq } from 'drizzle-orm';
import { sendBookingConfirmation } from '../services/email.service';
import { awardMilesForBooking } from '../services/loyalty.service';
import { generateETicketForPassenger } from '../services/eticket.service';
import { passengers } from '../../drizzle/schema';

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

export async function handleStripeWebhook(req: Request, res: Response) {
  const sig = req.headers['stripe-signature'];

  if (!sig || !webhookSecret) {
    console.error('[Webhook] Missing signature or webhook secret');
    return res.status(400).send('Webhook Error: Missing signature');
  }

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err: any) {
    console.error(`[Webhook] Signature verification failed:`, err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Handle test events
  if (event.id.startsWith('evt_test_')) {
    console.log('[Webhook] Test event detected, returning verification response');
    return res.json({ verified: true });
  }

  console.log(`[Webhook] Processing event: ${event.type} (${event.id})`);

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        await handleCheckoutSessionCompleted(session);
        break;
      }

      case 'payment_intent.succeeded': {
        const paymentIntent = event.data.object as Stripe.PaymentIntent;
        console.log(`[Webhook] PaymentIntent succeeded: ${paymentIntent.id}`);
        break;
      }

      case 'payment_intent.payment_failed': {
        const paymentIntent = event.data.object as Stripe.PaymentIntent;
        console.log(`[Webhook] PaymentIntent failed: ${paymentIntent.id}`);
        await handlePaymentFailed(paymentIntent);
        break;
      }

      default:
        console.log(`[Webhook] Unhandled event type: ${event.type}`);
    }

    res.json({ received: true });
  } catch (error: any) {
    console.error(`[Webhook] Error processing event:`, error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
}

async function handleCheckoutSessionCompleted(session: Stripe.Checkout.Session) {
  console.log(`[Webhook] Checkout session completed: ${session.id}`);

  const bookingId = session.metadata?.bookingId;
  if (!bookingId) {
    console.error('[Webhook] No bookingId in session metadata');
    return;
  }

  const db = await getDb();
  if (!db) {
    console.error('[Webhook] Database not available');
    return;
  }

  // Update booking status
  await db.update(bookings)
    .set({
      paymentStatus: 'paid',
      status: 'confirmed',
      stripePaymentIntentId: session.payment_intent as string,
    })
    .where(eq(bookings.id, parseInt(bookingId)));

  console.log(`[Webhook] Booking ${bookingId} marked as paid`);

  // Send booking confirmation email
  try {
    const [booking] = await db
      .select({
        bookingReference: bookings.bookingReference,
        pnr: bookings.pnr,
        totalAmount: bookings.totalAmount,
        cabinClass: bookings.cabinClass,
        numberOfPassengers: bookings.numberOfPassengers,
        userName: users.name,
        userEmail: users.email,
        flightNumber: flights.flightNumber,
        departureTime: flights.departureTime,
        arrivalTime: flights.arrivalTime,
        originCode: airports.code,
        originCity: airports.city,
      })
      .from(bookings)
      .innerJoin(users, eq(bookings.userId, users.id))
      .innerJoin(flights, eq(bookings.flightId, flights.id))
      .innerJoin(airports, eq(flights.originId, airports.id))
      .where(eq(bookings.id, parseInt(bookingId)))
      .limit(1);

    if (booking && booking.userEmail) {
      // Get destination airport
      const [flight] = await db
        .select({ destinationId: flights.destinationId })
        .from(flights)
        .innerJoin(bookings, eq(bookings.flightId, flights.id))
        .where(eq(bookings.id, parseInt(bookingId)))
        .limit(1);

      const [destAirport] = await db
        .select({ code: airports.code, city: airports.city })
        .from(airports)
        .where(eq(airports.id, flight.destinationId))
        .limit(1);

      await sendBookingConfirmation({
        passengerName: booking.userName || 'Passenger',
        passengerEmail: booking.userEmail,
        bookingReference: booking.bookingReference,
        pnr: booking.pnr,
        flightNumber: booking.flightNumber,
        origin: `${booking.originCity} (${booking.originCode})`,
        destination: `${destAirport.city} (${destAirport.code})`,
        departureTime: booking.departureTime,
        arrivalTime: booking.arrivalTime,
        cabinClass: booking.cabinClass,
        numberOfPassengers: booking.numberOfPassengers,
        totalAmount: booking.totalAmount,
      });

      console.log(`[Webhook] Booking confirmation email sent to ${booking.userEmail}`);
      
      // Generate and attach e-tickets for all passengers
      try {
        const bookingPassengers = await db
          .select()
          .from(passengers)
          .where(eq(passengers.bookingId, parseInt(bookingId)));

        if (bookingPassengers.length > 0) {
          const eticketAttachments = await Promise.all(
            bookingPassengers.map(async (passenger) => {
              const pdf = await generateETicketForPassenger(parseInt(bookingId), passenger.id);
              return {
                filename: `eticket-${booking.bookingReference}-${passenger.firstName}.pdf`,
                content: pdf, // Already base64 string
                contentType: 'application/pdf',
              };
            })
          );

          // TODO: Re-send email with e-ticket attachments
          // This requires updating sendBookingConfirmation to support attachments
          console.log(`[Webhook] Generated ${eticketAttachments.length} e-ticket PDFs for booking ${bookingId}`);
        }
      } catch (eticketError) {
        console.error('[Webhook] Failed to generate e-tickets:', eticketError);
      }
    }
  } catch (emailError) {
    console.error('[Webhook] Failed to send booking confirmation email:', emailError);
  }

  // Award loyalty miles
  try {
    const [bookingDetails] = await db
      .select({
        userId: bookings.userId,
        flightId: bookings.flightId,
        totalAmount: bookings.totalAmount,
      })
      .from(bookings)
      .where(eq(bookings.id, parseInt(bookingId)))
      .limit(1);

    if (bookingDetails) {
      const result = await awardMilesForBooking(
        bookingDetails.userId,
        parseInt(bookingId),
        bookingDetails.flightId,
        bookingDetails.totalAmount
      );

      console.log(
        `[Webhook] Awarded ${result.milesEarned} miles to user ${bookingDetails.userId} ` +
        `(Base: ${result.baseMiles}, Bonus: ${result.bonusMiles})`
      );

      if (result.tierUpgraded) {
        console.log(`[Webhook] User ${bookingDetails.userId} upgraded to ${result.newTier} tier!`);
      }
    }
  } catch (loyaltyError) {
    console.error('[Webhook] Failed to award loyalty miles:', loyaltyError);
    // Don't fail the webhook if loyalty fails
  }
}

async function handlePaymentFailed(paymentIntent: Stripe.PaymentIntent) {
  console.log(`[Webhook] Payment failed: ${paymentIntent.id}`);

  const db = await getDb();
  if (!db) {
    console.error('[Webhook] Database not available');
    return;
  }

  // Find booking by payment intent ID
  const booking = await db.select()
    .from(bookings)
    .where(eq(bookings.stripePaymentIntentId, paymentIntent.id))
    .limit(1);

  if (booking[0]) {
    await db.update(bookings)
      .set({ paymentStatus: 'failed' })
      .where(eq(bookings.id, booking[0].id));

    console.log(`[Webhook] Booking ${booking[0].id} marked as payment failed`);
  }
}
