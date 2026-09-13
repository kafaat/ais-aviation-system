import { randomUUID } from "node:crypto";
import {
  createInventoryLock,
  releaseInventoryLock,
} from "./inventory-lock.service";
import { countActiveHolds } from "./inventory-capacity.service";
import { recordEvent } from "./outbox.service";
import type { SettlementTx } from "./booking-settlement.service";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import {
  waitlist,
  inventoryLocks,
  flights,
  users,
  airports,
  airlines,
} from "../../drizzle/schema";
import { eq, and, desc, asc, sql, inArray, isNull } from "drizzle-orm";

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
  cabinClass: "economy" | "business",
  notifyByEmail: boolean = true,
  notifyBySms: boolean = false
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
    notifyByEmail,
    notifyBySms,
  });

  const insertId = result.insertId;

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
  entry: typeof waitlist.$inferSelect | null;
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
async function offerInTransaction(
  tx: SettlementTx,
  entry: typeof waitlist.$inferSelect
) {
  const hold = await createInventoryLock(
    entry.flightId,
    entry.seats,
    entry.cabinClass,
    `waitlist:${entry.id}:${randomUUID()}`,
    entry.userId,
    tx,
    1440
  );
  await tx
    .update(waitlist)
    .set({
      status: "offered",
      offeredAt: new Date(),
      offerExpiresAt: hold.expiresAt,
      inventoryLockId: hold.lockId,
    })
    .where(eq(waitlist.id, entry.id));
  await recordEvent(tx, {
    aggregateType: "waitlist",
    aggregateId: entry.id,
    eventType: "waitlist.offered",
    payload: {
      waitlistId: entry.id,
      flightId: entry.flightId,
      userId: entry.userId,
      expiresAt: hold.expiresAt.toISOString(),
    },
  });
  return hold;
}
export async function processWaitlist(
  flightId: number,
  cabin?: "economy" | "business"
): Promise<{
  offeredCount: number;
  notifications: Array<{ userId: number; email: boolean; sms: boolean }>;
}> {
  const db = getDb();
  if (!db) throw new Error("Database unavailable");
  return await db.transaction(async tx => {
    const [flight] = await tx
      .select()
      .from(flights)
      .where(eq(flights.id, flightId))
      .for("update");
    if (!flight) throw new Error("Flight not found");
    const notifications: Array<{
      userId: number;
      email: boolean;
      sms: boolean;
    }> = [];
    if (
      !["scheduled", "delayed"].includes(flight.status) ||
      flight.departureTime <= new Date()
    )
      return { offeredCount: 0, notifications };
    const entries = await tx
      .select()
      .from(waitlist)
      .where(
        and(
          eq(waitlist.flightId, flightId),
          eq(waitlist.status, "waiting"),
          cabin ? eq(waitlist.cabinClass, cabin) : undefined
        )
      )
      .orderBy(asc(waitlist.priority), asc(waitlist.id))
      .for("update");
    for (const entry of entries) {
      const available =
        (entry.cabinClass === "economy"
          ? flight.economyAvailable
          : flight.businessAvailable) -
        (await countActiveHolds(tx, flightId, entry.cabinClass));
      if (available < entry.seats) continue;
      await offerInTransaction(tx, entry);
      notifications.push({
        userId: entry.userId,
        email: entry.notifyByEmail,
        sms: entry.notifyBySms,
      });
    }
    return { offeredCount: notifications.length, notifications };
  });
}
async function lockedEntry(tx: SettlementTx, id: number, userId?: number) {
  const [candidate] = await tx
    .select()
    .from(waitlist)
    .where(eq(waitlist.id, id));
  if (!candidate || (userId !== undefined && candidate.userId !== userId))
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Waitlist entry not found",
    });
  await tx
    .select({ id: flights.id })
    .from(flights)
    .where(eq(flights.id, candidate.flightId))
    .for("update");
  const [entry] = await tx
    .select()
    .from(waitlist)
    .where(eq(waitlist.id, id))
    .for("update");
  if (!entry) throw new Error("Waitlist entry disappeared");
  return entry;
}
export async function offerSeat(waitlistId: number) {
  const db = getDb();
  if (!db) throw new Error("Database unavailable");
  return await db.transaction(async tx => {
    const entry = await lockedEntry(tx, waitlistId);
    if (entry.status !== "waiting")
      throw new Error("Waitlist entry is not waiting");
    const hold = await offerInTransaction(tx, entry);
    return { success: true, expiresAt: hold.expiresAt };
  });
}
export async function acceptOffer(waitlistId: number, userId: number) {
  const db = getDb();
  if (!db) throw new Error("Database unavailable");
  return await db.transaction(async tx => {
    const entry = await lockedEntry(tx, waitlistId, userId);
    if (!entry.inventoryLockId)
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message:
          "Legacy offer requires inventory reconciliation and a new offer",
      });
    const [hold] = await tx
      .select()
      .from(inventoryLocks)
      .where(eq(inventoryLocks.id, entry.inventoryLockId))
      .for("update");
    if (
      !["offered", "confirmed"].includes(entry.status) ||
      !hold ||
      hold.status !== "active" ||
      hold.expiresAt <= new Date() ||
      entry.bookingId
    )
      throw new Error("Offer expired or already transferred to a booking");
    await tx
      .update(waitlist)
      .set({
        status: "confirmed",
        confirmedAt: entry.confirmedAt ?? new Date(),
      })
      .where(eq(waitlist.id, entry.id));
    return {
      success: true,
      message:
        "Offer accepted; inventory is held until the displayed deadline. Payment confirms the booking.",
      flightId: entry.flightId,
      cabinClass: entry.cabinClass,
      passengers: entry.seats,
      waitlistId: entry.id,
      expiresAt: hold.expiresAt,
    };
  });
}
async function endOffer(
  waitlistId: number,
  userId: number | undefined,
  status: "expired" | "cancelled"
) {
  const db = getDb();
  if (!db) throw new Error("Database unavailable");
  return await db.transaction(async tx => {
    const entry = await lockedEntry(tx, waitlistId, userId);
    if (entry.bookingId) throw new Error("Manage the linked booking instead");
    if (["cancelled", "expired"].includes(entry.status))
      return { flightId: entry.flightId, changed: false };
    if (
      status === "expired" &&
      (!entry.offerExpiresAt || entry.offerExpiresAt > new Date())
    )
      return { flightId: entry.flightId, changed: false };
    if (entry.inventoryLockId)
      await releaseInventoryLock(entry.inventoryLockId, tx);
    // Historical offers did not consistently reserve capacity. Do not invent
    // a compensating increment; the inventory reconciliation gate exposes them.
    if (!entry.inventoryLockId && entry.status !== "waiting")
      throw new Error("Legacy offer requires inventory reconciliation");
    await tx.update(waitlist).set({ status }).where(eq(waitlist.id, entry.id));
    await recordEvent(tx, {
      aggregateType: "waitlist",
      aggregateId: entry.id,
      eventType: `waitlist.${status}`,
      payload: {
        waitlistId: entry.id,
        flightId: entry.flightId,
        userId: entry.userId,
      },
    });
    return { flightId: entry.flightId, changed: true };
  });
}
export async function declineOffer(waitlistId: number, userId: number) {
  const result = await endOffer(waitlistId, userId, "cancelled");
  await processWaitlist(result.flightId);
  return { success: true, message: "Offer released" };
}
export async function cancelWaitlistEntry(waitlistId: number, userId: number) {
  return await declineOffer(waitlistId, userId);
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
export async function processExpiredOffers() {
  const db = getDb();
  if (!db) throw new Error("Database unavailable");
  const entries = await db
    .select()
    .from(waitlist)
    .where(
      and(
        inArray(waitlist.status, ["offered", "confirmed"]),
        isNull(waitlist.bookingId),
        sql`${waitlist.offerExpiresAt} <= ${new Date()}`
      )
    );
  let expiredCount = 0,
    reofferedCount = 0;
  const failures: unknown[] = [];
  for (const entry of entries) {
    try {
      const ended = await endOffer(entry.id, undefined, "expired");
      if (ended.changed) expiredCount++;
      reofferedCount += (await processWaitlist(entry.flightId)).offeredCount;
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length)
    throw new AggregateError(
      failures,
      "Waitlist expiration needs reconciliation"
    );
  return { expiredCount, reofferedCount };
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
