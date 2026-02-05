import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import {
  waitlist,
  flights,
  users,
  airports,
  airlines,
} from "../../drizzle/schema";
import { eq, and, desc, asc, sql } from "drizzle-orm";

/**
 * Waitlist Service
 * Handles waitlist operations for fully booked flights
 */

/**
 * Get the next priority number for a waitlist entry
 */
async function getNextPriority(
  flightId: number,
  cabinClass: "economy" | "business"
): Promise<number> {
  const database = await getDb();
  if (!database) throw new Error("Database not available");

  const [result] = await database
    .select({ maxPriority: sql<number>`MAX(${waitlist.priority})` })
    .from(waitlist)
    .where(
      and(eq(waitlist.flightId, flightId), eq(waitlist.cabinClass, cabinClass))
    );

  return (result?.maxPriority ?? 0) + 1;
}

/**
 * Add user to waitlist for a flight
 */
export async function addToWaitlist(
  userId: number,
  flightId: number,
  passengers: number,
  cabinClass: "economy" | "business"
): Promise<{
  id: number;
  position: number;
  message: string;
}> {
  const database = await getDb();
  if (!database) throw new Error("Database not available");

  // Check if user is already on waitlist for this flight and class
  const [existing] = await database
    .select()
    .from(waitlist)
    .where(
      and(
        eq(waitlist.userId, userId),
        eq(waitlist.flightId, flightId),
        eq(waitlist.cabinClass, cabinClass),
        eq(waitlist.status, "waiting")
      )
    )
    .limit(1);

  if (existing) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "You are already on the waitlist for this flight",
    });
  }

  // Check if flight exists and get details
  const [flight] = await database
    .select()
    .from(flights)
    .where(eq(flights.id, flightId))
    .limit(1);

  if (!flight) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Flight not found",
    });
  }

  // Check if flight is actually full
  const availableSeats =
    cabinClass === "economy"
      ? flight.economyAvailable
      : flight.businessAvailable;

  if (availableSeats >= passengers) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Seats are still available. Please book directly.",
    });
  }

  // Get next priority (queue position)
  const priority = await getNextPriority(flightId, cabinClass);

  // Add to waitlist
  const [result] = await database.insert(waitlist).values({
    flightId,
    userId,
    cabinClass,
    seats: passengers,
    priority,
    status: "waiting",
    notifyByEmail: true,
    notifyBySms: false,
  });

  const insertId = (result as any).insertId;

  return {
    id: insertId,
    position: priority,
    message: `Successfully added to waitlist at position ${priority}`,
  };
}

/**
 * Get user's position on waitlist for a flight
 */
export async function getWaitlistPosition(
  userId: number,
  flightId: number,
  cabinClass: "economy" | "business"
): Promise<{
  position: number | null;
  status: string | null;
  entry: any | null;
}> {
  const database = await getDb();
  if (!database) throw new Error("Database not available");

  const [entry] = await database
    .select()
    .from(waitlist)
    .where(
      and(
        eq(waitlist.userId, userId),
        eq(waitlist.flightId, flightId),
        eq(waitlist.cabinClass, cabinClass)
      )
    )
    .orderBy(desc(waitlist.createdAt))
    .limit(1);

  if (!entry) {
    return { position: null, status: null, entry: null };
  }

  // Count how many people are ahead in queue
  const [positionResult] = await database
    .select({ count: sql<number>`COUNT(*)` })
    .from(waitlist)
    .where(
      and(
        eq(waitlist.flightId, flightId),
        eq(waitlist.cabinClass, cabinClass),
        eq(waitlist.status, "waiting"),
        sql`${waitlist.priority} < ${entry.priority}`
      )
    );

  const position = (positionResult?.count ?? 0) + 1;

  return {
    position: entry.status === "waiting" ? position : null,
    status: entry.status,
    entry,
  };
}

/**
 * Process waitlist when seats become available
 * Called when a booking is cancelled or seats are added
 */
export async function processWaitlist(flightId: number): Promise<{
  offeredCount: number;
  notifications: Array<{ userId: number; email: boolean; sms: boolean }>;
}> {
  const database = await getDb();
  if (!database) throw new Error("Database not available");

  // Get flight details
  const [flight] = await database
    .select()
    .from(flights)
    .where(eq(flights.id, flightId))
    .limit(1);

  if (!flight) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Flight not found",
    });
  }

  const notifications: Array<{
    userId: number;
    email: boolean;
    sms: boolean;
  }> = [];
  let offeredCount = 0;

  // Process economy waitlist
  if (flight.economyAvailable > 0) {
    const economyWaitlist = await database
      .select()
      .from(waitlist)
      .where(
        and(
          eq(waitlist.flightId, flightId),
          eq(waitlist.cabinClass, "economy"),
          eq(waitlist.status, "waiting")
        )
      )
      .orderBy(asc(waitlist.priority))
      .limit(flight.economyAvailable);

    for (const entry of economyWaitlist) {
      if (entry.seats <= flight.economyAvailable) {
        await offerSeat(entry.id);
        offeredCount++;
        notifications.push({
          userId: entry.userId,
          email: entry.notifyByEmail,
          sms: entry.notifyBySms,
        });
      }
    }
  }

  // Process business waitlist
  if (flight.businessAvailable > 0) {
    const businessWaitlist = await database
      .select()
      .from(waitlist)
      .where(
        and(
          eq(waitlist.flightId, flightId),
          eq(waitlist.cabinClass, "business"),
          eq(waitlist.status, "waiting")
        )
      )
      .orderBy(asc(waitlist.priority))
      .limit(flight.businessAvailable);

    for (const entry of businessWaitlist) {
      if (entry.seats <= flight.businessAvailable) {
        await offerSeat(entry.id);
        offeredCount++;
        notifications.push({
          userId: entry.userId,
          email: entry.notifyByEmail,
          sms: entry.notifyBySms,
        });
      }
    }
  }

  return { offeredCount, notifications };
}

/**
 * Offer seat to next person in waitlist queue
 */
export async function offerSeat(waitlistId: number): Promise<{
  success: boolean;
  expiresAt: Date;
}> {
  const database = await getDb();
  if (!database) throw new Error("Database not available");

  const [entry] = await database
    .select()
    .from(waitlist)
    .where(eq(waitlist.id, waitlistId))
    .limit(1);

  if (!entry) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Waitlist entry not found",
    });
  }

  if (entry.status !== "waiting") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "This waitlist entry is not in waiting status",
    });
  }

  // Set offer expiration to 24 hours from now
  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + 24);

  await database
    .update(waitlist)
    .set({
      status: "offered",
      offeredAt: new Date(),
      offerExpiresAt: expiresAt,
    })
    .where(eq(waitlist.id, waitlistId));

  return { success: true, expiresAt };
}

/**
 * Accept waitlist offer and convert to booking
 */
export async function acceptOffer(
  waitlistId: number,
  userId: number
): Promise<{
  success: boolean;
  message: string;
  flightId: number;
  cabinClass: "economy" | "business";
  passengers: number;
}> {
  const database = await getDb();
  if (!database) throw new Error("Database not available");

  const [entry] = await database
    .select()
    .from(waitlist)
    .where(and(eq(waitlist.id, waitlistId), eq(waitlist.userId, userId)))
    .limit(1);

  if (!entry) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Waitlist entry not found",
    });
  }

  if (entry.status !== "offered") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "No active offer for this waitlist entry",
    });
  }

  // Check if offer has expired
  if (entry.offerExpiresAt && new Date() > new Date(entry.offerExpiresAt)) {
    await database
      .update(waitlist)
      .set({ status: "expired" })
      .where(eq(waitlist.id, waitlistId));

    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "This offer has expired",
    });
  }

  // Mark as confirmed
  await database
    .update(waitlist)
    .set({
      status: "confirmed",
      confirmedAt: new Date(),
    })
    .where(eq(waitlist.id, waitlistId));

  return {
    success: true,
    message: "Offer accepted. Please proceed to complete your booking.",
    flightId: entry.flightId,
    cabinClass: entry.cabinClass as "economy" | "business",
    passengers: entry.seats,
  };
}

/**
 * Decline waitlist offer
 */
export async function declineOffer(
  waitlistId: number,
  userId: number
): Promise<{ success: boolean; message: string }> {
  const database = await getDb();
  if (!database) throw new Error("Database not available");

  const [entry] = await database
    .select()
    .from(waitlist)
    .where(and(eq(waitlist.id, waitlistId), eq(waitlist.userId, userId)))
    .limit(1);

  if (!entry) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Waitlist entry not found",
    });
  }

  if (entry.status !== "offered") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "No active offer to decline",
    });
  }

  // Mark as cancelled
  await database
    .update(waitlist)
    .set({ status: "cancelled" })
    .where(eq(waitlist.id, waitlistId));

  // Process waitlist to offer to next person
  await processWaitlist(entry.flightId);

  return {
    success: true,
    message: "Offer declined. The seat will be offered to the next person.",
  };
}

/**
 * Cancel waitlist entry
 */
export async function cancelWaitlistEntry(
  waitlistId: number,
  userId: number
): Promise<{ success: boolean; message: string }> {
  const database = await getDb();
  if (!database) throw new Error("Database not available");

  const [entry] = await database
    .select()
    .from(waitlist)
    .where(and(eq(waitlist.id, waitlistId), eq(waitlist.userId, userId)))
    .limit(1);

  if (!entry) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Waitlist entry not found",
    });
  }

  if (entry.status === "cancelled" || entry.status === "confirmed") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Cannot cancel this waitlist entry",
    });
  }

  await database
    .update(waitlist)
    .set({ status: "cancelled" })
    .where(eq(waitlist.id, waitlistId));

  return {
    success: true,
    message: "Successfully removed from waitlist",
  };
}

/**
 * Get all waitlist entries for a flight (admin view)
 */
export async function getFlightWaitlist(flightId: number): Promise<
  Array<{
    id: number;
    userId: number;
    userName: string | null;
    userEmail: string | null;
    cabinClass: string;
    seats: number;
    priority: number;
    status: string;
    offeredAt: Date | null;
    offerExpiresAt: Date | null;
    confirmedAt: Date | null;
    createdAt: Date;
  }>
> {
  const database = await getDb();
  if (!database) throw new Error("Database not available");

  const entries = await database
    .select({
      id: waitlist.id,
      userId: waitlist.userId,
      userName: users.name,
      userEmail: users.email,
      cabinClass: waitlist.cabinClass,
      seats: waitlist.seats,
      priority: waitlist.priority,
      status: waitlist.status,
      offeredAt: waitlist.offeredAt,
      offerExpiresAt: waitlist.offerExpiresAt,
      confirmedAt: waitlist.confirmedAt,
      createdAt: waitlist.createdAt,
    })
    .from(waitlist)
    .leftJoin(users, eq(waitlist.userId, users.id))
    .where(eq(waitlist.flightId, flightId))
    .orderBy(asc(waitlist.priority));

  return entries;
}

/**
 * Get all waitlist entries for a user
 */
export async function getUserWaitlist(userId: number): Promise<
  Array<{
    id: number;
    flightId: number;
    flightNumber: string;
    originCode: string;
    originCity: string;
    destinationCode: string;
    destinationCity: string;
    airlineName: string;
    airlineLogo: string | null;
    departureTime: Date;
    cabinClass: string;
    seats: number;
    priority: number;
    status: string;
    offeredAt: Date | null;
    offerExpiresAt: Date | null;
    createdAt: Date;
  }>
> {
  const database = await getDb();
  if (!database) throw new Error("Database not available");

  // Create aliases for the origin and destination airports
  const originAirport = database
    .select({
      id: airports.id,
      code: airports.code,
      city: airports.city,
    })
    .from(airports)
    .as("originAirport");

  const destinationAirport = database
    .select({
      id: airports.id,
      code: airports.code,
      city: airports.city,
    })
    .from(airports)
    .as("destinationAirport");

  const entries = await database
    .select({
      id: waitlist.id,
      flightId: waitlist.flightId,
      flightNumber: flights.flightNumber,
      originCode: sql<string>`originAirport.code`,
      originCity: sql<string>`originAirport.city`,
      destinationCode: sql<string>`destinationAirport.code`,
      destinationCity: sql<string>`destinationAirport.city`,
      airlineName: airlines.name,
      airlineLogo: airlines.logo,
      departureTime: flights.departureTime,
      cabinClass: waitlist.cabinClass,
      seats: waitlist.seats,
      priority: waitlist.priority,
      status: waitlist.status,
      offeredAt: waitlist.offeredAt,
      offerExpiresAt: waitlist.offerExpiresAt,
      createdAt: waitlist.createdAt,
    })
    .from(waitlist)
    .innerJoin(flights, eq(waitlist.flightId, flights.id))
    .innerJoin(airlines, eq(flights.airlineId, airlines.id))
    .innerJoin(originAirport, eq(flights.originId, sql`originAirport.id`))
    .innerJoin(
      destinationAirport,
      eq(flights.destinationId, sql`destinationAirport.id`)
    )
    .where(eq(waitlist.userId, userId))
    .orderBy(desc(waitlist.createdAt));

  return entries;
}

/**
 * Check and expire old offers (run via cron job)
 */
export async function processExpiredOffers(): Promise<{
  expiredCount: number;
  reofferedCount: number;
}> {
  const database = await getDb();
  if (!database) {
    console.error("Database not available for offer expiration");
    return { expiredCount: 0, reofferedCount: 0 };
  }

  try {
    const now = new Date();

    // Find expired offers
    const expiredOffers = await database
      .select()
      .from(waitlist)
      .where(
        and(
          eq(waitlist.status, "offered"),
          sql`${waitlist.offerExpiresAt} < ${now}`
        )
      );

    let expiredCount = 0;
    const flightsToProcess = new Set<number>();

    for (const offer of expiredOffers) {
      await database
        .update(waitlist)
        .set({ status: "expired" })
        .where(eq(waitlist.id, offer.id));

      expiredCount++;
      flightsToProcess.add(offer.flightId);
    }

    // Re-process waitlists for affected flights
    let reofferedCount = 0;
    for (const flightId of flightsToProcess) {
      const result = await processWaitlist(flightId);
      reofferedCount += result.offeredCount;
    }

    console.info(
      `[Waitlist] Processed ${expiredCount} expired offers, re-offered to ${reofferedCount} users`
    );

    return { expiredCount, reofferedCount };
  } catch (error) {
    console.error("Error processing expired offers:", error);
    return { expiredCount: 0, reofferedCount: 0 };
  }
}

/**
 * Update notification preferences for waitlist entry
 */
export async function updateNotificationPreferences(
  waitlistId: number,
  userId: number,
  notifyByEmail: boolean,
  notifyBySms: boolean
): Promise<{ success: boolean }> {
  const database = await getDb();
  if (!database) throw new Error("Database not available");

  const [entry] = await database
    .select()
    .from(waitlist)
    .where(and(eq(waitlist.id, waitlistId), eq(waitlist.userId, userId)))
    .limit(1);

  if (!entry) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Waitlist entry not found",
    });
  }

  await database
    .update(waitlist)
    .set({ notifyByEmail, notifyBySms })
    .where(eq(waitlist.id, waitlistId));

  return { success: true };
}

/**
 * Get waitlist statistics for admin dashboard
 */
export async function getWaitlistStats(): Promise<{
  totalWaiting: number;
  totalOffered: number;
  totalConfirmed: number;
  totalExpired: number;
  avgWaitTime: number;
}> {
  const database = await getDb();
  if (!database) throw new Error("Database not available");

  const [waiting] = await database
    .select({ count: sql<number>`COUNT(*)` })
    .from(waitlist)
    .where(eq(waitlist.status, "waiting"));

  const [offered] = await database
    .select({ count: sql<number>`COUNT(*)` })
    .from(waitlist)
    .where(eq(waitlist.status, "offered"));

  const [confirmed] = await database
    .select({ count: sql<number>`COUNT(*)` })
    .from(waitlist)
    .where(eq(waitlist.status, "confirmed"));

  const [expired] = await database
    .select({ count: sql<number>`COUNT(*)` })
    .from(waitlist)
    .where(eq(waitlist.status, "expired"));

  // Calculate average wait time for confirmed entries
  const [avgWait] = await database
    .select({
      avgHours: sql<number>`AVG(TIMESTAMPDIFF(HOUR, ${waitlist.createdAt}, ${waitlist.confirmedAt}))`,
    })
    .from(waitlist)
    .where(eq(waitlist.status, "confirmed"));

  return {
    totalWaiting: waiting?.count ?? 0,
    totalOffered: offered?.count ?? 0,
    totalConfirmed: confirmed?.count ?? 0,
    totalExpired: expired?.count ?? 0,
    avgWaitTime: avgWait?.avgHours ?? 0,
  };
}
