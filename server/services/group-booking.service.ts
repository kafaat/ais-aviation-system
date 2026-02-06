import { TRPCError } from "@trpc/server";
import { eq, desc, and, sql, SQL } from "drizzle-orm";
import { getDb } from "../db";
import {
  groupBookings,
  flights,
  type GroupBooking,
} from "../../drizzle/schema";

/**
 * Group Booking Service
 * Business logic for group booking operations (10+ passengers)
 */

// Minimum group size for group bookings
export const MIN_GROUP_SIZE = 10;

// Discount tiers based on group size
export const DISCOUNT_TIERS = {
  SMALL: { min: 10, max: 19, discount: 5 }, // 5% discount
  MEDIUM: { min: 20, max: 49, discount: 10 }, // 10% discount
  LARGE: { min: 50, max: Infinity, discount: 15 }, // 15% discount
} as const;

export interface CreateGroupBookingInput {
  organizerName: string;
  organizerEmail: string;
  organizerPhone: string;
  groupSize: number;
  flightId: number;
  cabinClass?: "economy" | "business";
  notes?: string;
}

export interface GroupBookingFilters {
  status?: "pending" | "confirmed" | "cancelled";
  flightId?: number;
}

/**
 * Calculate the group discount based on group size
 * @param groupSize - Number of passengers in the group
 * @returns Discount percentage (5%, 10%, or 15%)
 */
export function calculateGroupDiscount(groupSize: number): number {
  if (groupSize < MIN_GROUP_SIZE) {
    return 0;
  }

  if (groupSize >= DISCOUNT_TIERS.LARGE.min) {
    return DISCOUNT_TIERS.LARGE.discount;
  }

  if (
    groupSize >= DISCOUNT_TIERS.MEDIUM.min &&
    groupSize <= DISCOUNT_TIERS.MEDIUM.max
  ) {
    return DISCOUNT_TIERS.MEDIUM.discount;
  }

  if (
    groupSize >= DISCOUNT_TIERS.SMALL.min &&
    groupSize <= DISCOUNT_TIERS.SMALL.max
  ) {
    return DISCOUNT_TIERS.SMALL.discount;
  }

  return 0;
}

/**
 * Create a new group booking request
 * @param data - Group booking request data
 * @returns Created group booking with ID
 */
export async function createGroupBookingRequest(
  data: CreateGroupBookingInput
): Promise<{ id: number; suggestedDiscount: number }> {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });
  }

  // Validate group size
  if (data.groupSize < MIN_GROUP_SIZE) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Group size must be at least ${MIN_GROUP_SIZE} passengers`,
    });
  }

  // Verify flight exists
  const flight = await db
    .select()
    .from(flights)
    .where(eq(flights.id, data.flightId))
    .limit(1);

  if (flight.length === 0) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Flight not found",
    });
  }

  // Check if flight has enough seats available for the requested cabin class
  const flightData = flight[0];
  const cabinClass = data.cabinClass ?? "economy";
  const availableSeats =
    cabinClass === "economy"
      ? flightData.economyAvailable
      : flightData.businessAvailable;
  if (availableSeats < data.groupSize) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Not enough ${cabinClass} seats available. Only ${availableSeats} seats remaining.`,
    });
  }

  // Calculate suggested discount
  const suggestedDiscount = calculateGroupDiscount(data.groupSize);

  // Create the group booking request
  const result = await db.insert(groupBookings).values({
    organizerName: data.organizerName,
    organizerEmail: data.organizerEmail,
    organizerPhone: data.organizerPhone,
    groupSize: data.groupSize,
    cabinClass,
    flightId: data.flightId,
    notes: data.notes,
    status: "pending",
  });

  const insertId = (result as any).insertId || (result as any)[0]?.insertId;

  if (!insertId) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to create group booking request",
    });
  }

  return {
    id: insertId,
    suggestedDiscount,
  };
}

/**
 * Get group bookings with optional filters (admin)
 * @param filters - Optional filters for status and flight
 * @returns List of group bookings with flight details
 */
export async function getGroupBookings(
  filters?: GroupBookingFilters
): Promise<GroupBooking[]> {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });
  }

  const conditions: SQL[] = [];

  if (filters?.status) {
    conditions.push(eq(groupBookings.status, filters.status));
  }

  if (filters?.flightId) {
    conditions.push(eq(groupBookings.flightId, filters.flightId));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const results = await db
    .select()
    .from(groupBookings)
    .where(whereClause)
    .orderBy(desc(groupBookings.createdAt));

  return results;
}

/**
 * Get a single group booking by ID
 * @param id - Group booking ID
 * @returns Group booking or null
 */
export async function getGroupBookingById(
  id: number
): Promise<GroupBooking | null> {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });
  }

  const result = await db
    .select()
    .from(groupBookings)
    .where(eq(groupBookings.id, id))
    .limit(1);

  return result.length > 0 ? result[0] : null;
}

/**
 * Approve a group booking request with discount (admin only)
 * @param id - Group booking ID
 * @param discountPercent - Discount percentage to apply
 * @param adminUserId - Admin user ID approving the request
 * @returns Updated group booking
 */
export async function approveGroupBooking(
  id: number,
  discountPercent: number,
  adminUserId: number
): Promise<GroupBooking> {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });
  }

  // Get the group booking
  const booking = await getGroupBookingById(id);
  if (!booking) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Group booking request not found",
    });
  }

  if (booking.status !== "pending") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Cannot approve a ${booking.status} group booking`,
    });
  }

  // Get flight pricing and availability
  const flight = await db
    .select()
    .from(flights)
    .where(eq(flights.id, booking.flightId))
    .limit(1);

  if (flight.length === 0) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Flight not found",
    });
  }

  const flightData = flight[0];
  const cabinClass = booking.cabinClass ?? "economy";

  // Re-check seat availability before approving
  const availableSeats =
    cabinClass === "economy"
      ? flightData.economyAvailable
      : flightData.businessAvailable;

  if (availableSeats < booking.groupSize) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Not enough ${cabinClass} seats available. Only ${availableSeats} seats remaining, but ${booking.groupSize} are needed.`,
    });
  }

  // Calculate total price with discount using the correct cabin class price
  const pricePerSeat =
    cabinClass === "economy"
      ? flightData.economyPrice
      : flightData.businessPrice;
  const basePrice = pricePerSeat * booking.groupSize;
  const discountAmount = Math.round(basePrice * (discountPercent / 100));
  const totalPrice = basePrice - discountAmount;

  // Update the group booking
  await db
    .update(groupBookings)
    .set({
      status: "confirmed",
      discountPercent: String(discountPercent),
      totalPrice,
      approvedBy: adminUserId,
      approvedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(groupBookings.id, id));

  // Decrement the flight's available seats
  if (cabinClass === "economy") {
    await db
      .update(flights)
      .set({
        economyAvailable: sql`${flights.economyAvailable} - ${booking.groupSize}`,
      })
      .where(eq(flights.id, booking.flightId));
  } else {
    await db
      .update(flights)
      .set({
        businessAvailable: sql`${flights.businessAvailable} - ${booking.groupSize}`,
      })
      .where(eq(flights.id, booking.flightId));
  }

  // Return updated booking
  const updated = await getGroupBookingById(id);
  return updated!;
}

/**
 * Reject a group booking request (admin only)
 * @param id - Group booking ID
 * @param reason - Reason for rejection
 * @returns Updated group booking
 */
export async function rejectGroupBooking(
  id: number,
  reason: string
): Promise<GroupBooking> {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });
  }

  // Get the group booking
  const booking = await getGroupBookingById(id);
  if (!booking) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Group booking request not found",
    });
  }

  if (booking.status !== "pending") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Cannot reject a ${booking.status} group booking`,
    });
  }

  // Update the group booking
  await db
    .update(groupBookings)
    .set({
      status: "cancelled",
      rejectionReason: reason,
      updatedAt: new Date(),
    })
    .where(eq(groupBookings.id, id));

  // Return updated booking
  const updated = await getGroupBookingById(id);
  return updated!;
}

/**
 * Get group booking statistics (admin)
 * @returns Statistics about group bookings
 */
export async function getGroupBookingStats(): Promise<{
  totalRequests: number;
  pendingRequests: number;
  confirmedRequests: number;
  cancelledRequests: number;
  totalGroupPassengers: number;
}> {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });
  }

  const allBookings = await db.select().from(groupBookings);

  const stats = {
    totalRequests: allBookings.length,
    pendingRequests: allBookings.filter(b => b.status === "pending").length,
    confirmedRequests: allBookings.filter(b => b.status === "confirmed").length,
    cancelledRequests: allBookings.filter(b => b.status === "cancelled").length,
    totalGroupPassengers: allBookings
      .filter(b => b.status === "confirmed")
      .reduce((sum, b) => sum + b.groupSize, 0),
  };

  return stats;
}

/**
 * Get group bookings with flight details (admin)
 * @param filters - Optional filters
 * @returns Group bookings with flight information
 */
export async function getGroupBookingsWithFlightDetails(
  filters?: GroupBookingFilters
): Promise<
  Array<
    GroupBooking & {
      flight: {
        flightNumber: string;
        departureTime: Date;
        economyPrice: number;
        businessPrice: number;
      };
    }
  >
> {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });
  }

  const conditions: SQL[] = [];

  if (filters?.status) {
    conditions.push(eq(groupBookings.status, filters.status));
  }

  if (filters?.flightId) {
    conditions.push(eq(groupBookings.flightId, filters.flightId));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const results = await db
    .select({
      id: groupBookings.id,
      organizerName: groupBookings.organizerName,
      organizerEmail: groupBookings.organizerEmail,
      organizerPhone: groupBookings.organizerPhone,
      groupSize: groupBookings.groupSize,
      flightId: groupBookings.flightId,
      status: groupBookings.status,
      discountPercent: groupBookings.discountPercent,
      totalPrice: groupBookings.totalPrice,
      notes: groupBookings.notes,
      rejectionReason: groupBookings.rejectionReason,
      approvedBy: groupBookings.approvedBy,
      approvedAt: groupBookings.approvedAt,
      createdAt: groupBookings.createdAt,
      updatedAt: groupBookings.updatedAt,
      flight: {
        flightNumber: flights.flightNumber,
        departureTime: flights.departureTime,
        economyPrice: flights.economyPrice,
        businessPrice: flights.businessPrice,
      },
    })
    .from(groupBookings)
    .innerJoin(flights, eq(groupBookings.flightId, flights.id))
    .where(whereClause)
    .orderBy(desc(groupBookings.createdAt));

  return results as any;
}
