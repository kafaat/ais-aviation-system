/**
 * Check-In Reminder Job
 * Sends email and SMS reminders to passengers 24 hours before their flight
 */

import { getDb } from "../db";
import {
  bookings,
  passengers,
  flights,
  airports,
  users,
} from "../../drizzle/schema";
import { eq, and, gte, lt, isNull } from "drizzle-orm";
import { sendCheckInReminder } from "../services/email.service";
// SMS can be added when user preferences with phone numbers are integrated
// import { sendTemplatedSMS } from "../services/sms.service";

interface ReminderResult {
  processed: number;
  emailsSent: number;
  errors: string[];
}

/**
 * Find bookings where the flight departs in the next 24-26 hours
 * and check-in reminder hasn't been sent yet
 */
export async function findBookingsForReminder(): Promise<
  Array<{
    booking: typeof bookings.$inferSelect;
    passenger: typeof passengers.$inferSelect;
    flight: typeof flights.$inferSelect;
    user: typeof users.$inferSelect;
    origin: typeof airports.$inferSelect;
    destination: typeof airports.$inferSelect;
  }>
> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const now = new Date();
  const in24Hours = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const in26Hours = new Date(now.getTime() + 26 * 60 * 60 * 1000);

  // Find confirmed bookings with flights departing in the next 24-26 hours
  // that haven't been sent a check-in reminder yet
  const results = await db
    .select({
      booking: bookings,
      passenger: passengers,
      flight: flights,
      user: users,
    })
    .from(bookings)
    .innerJoin(passengers, eq(passengers.bookingId, bookings.id))
    .innerJoin(flights, eq(flights.id, bookings.flightId))
    .innerJoin(users, eq(users.id, bookings.userId))
    .where(
      and(
        eq(bookings.status, "confirmed"),
        gte(flights.departureTime, in24Hours),
        lt(flights.departureTime, in26Hours),
        isNull(bookings.checkInReminderSentAt)
      )
    );

  // Get airport information for each result
  const enrichedResults = await Promise.all(
    results.map(async result => {
      const [origin] = await db
        .select()
        .from(airports)
        .where(eq(airports.id, result.flight.originId));

      const [destination] = await db
        .select()
        .from(airports)
        .where(eq(airports.id, result.flight.destinationId));

      return {
        ...result,
        origin,
        destination,
      };
    })
  );

  return enrichedResults;
}

/**
 * Mark a booking as having received a check-in reminder
 */
export async function markReminderSent(bookingId: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db
    .update(bookings)
    .set({ checkInReminderSentAt: new Date() })
    .where(eq(bookings.id, bookingId));
}

/**
 * Run the check-in reminder job
 * This should be scheduled to run every hour
 */
export async function runCheckInReminderJob(): Promise<ReminderResult> {
  const result: ReminderResult = {
    processed: 0,
    emailsSent: 0,
    errors: [],
  };

  try {
    console.info("[Check-In Reminder Job] Starting...");

    const bookingsToRemind = await findBookingsForReminder();
    console.info(
      `[Check-In Reminder Job] Found ${bookingsToRemind.length} bookings to remind`
    );

    for (const item of bookingsToRemind) {
      try {
        result.processed++;

        const checkInUrl = `${process.env.APP_URL || "https://ais-aviation.com"}/check-in?booking=${item.booking.bookingReference}`;

        // Skip if user has no email
        if (!item.user.email) {
          console.warn(
            `[Check-In Reminder Job] No email for user ${item.user.id}, skipping`
          );
          continue;
        }

        // Send email reminder
        const emailSent = await sendCheckInReminder({
          passengerName: `${item.passenger.firstName} ${item.passenger.lastName}`,
          passengerEmail: item.user.email,
          bookingReference: item.booking.bookingReference,
          pnr: item.booking.pnr,
          flightNumber: item.flight.flightNumber,
          origin: `${item.origin.city} (${item.origin.code})`,
          destination: `${item.destination.city} (${item.destination.code})`,
          departureTime: item.flight.departureTime,
          checkInUrl,
        });

        if (emailSent) {
          result.emailsSent++;
        }

        // Note: SMS reminders can be added when user preferences with phone numbers are available

        // Mark reminder as sent
        await markReminderSent(item.booking.id);

        console.info(
          `[Check-In Reminder Job] Sent reminder for booking ${item.booking.bookingReference}`
        );
      } catch (itemError) {
        const errorMessage =
          itemError instanceof Error ? itemError.message : "Unknown error";
        result.errors.push(`Booking ${item.booking.id}: ${errorMessage}`);
        console.error(
          `[Check-In Reminder Job] Error processing booking ${item.booking.id}:`,
          itemError
        );
      }
    }

    console.info(
      `[Check-In Reminder Job] Completed. Processed: ${result.processed}, Emails: ${result.emailsSent}, Errors: ${result.errors.length}`
    );
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    result.errors.push(`Job error: ${errorMessage}`);
    console.error("[Check-In Reminder Job] Fatal error:", error);
  }

  return result;
}

/**
 * Run the check-in reminder job as a standalone process
 */
export async function main(): Promise<void> {
  console.info("[Check-In Reminder Job] Starting standalone execution...");
  const result = await runCheckInReminderJob();
  console.info(
    "[Check-In Reminder Job] Result:",
    JSON.stringify(result, null, 2)
  );
  process.exit(result.errors.length > 0 ? 1 : 0);
}

// If running as standalone script
if (require.main === module) {
  main().catch(error => {
    console.error("[Check-In Reminder Job] Failed:", error);
    process.exit(1);
  });
}
