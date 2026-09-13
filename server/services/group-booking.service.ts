import {
  createInventoryLock,
  releaseInventoryLock,
} from "./inventory-lock.service";
import { recordEvent } from "./outbox.service";
import { TRPCError } from "@trpc/server";
import { eq, desc, and, sql, SQL, isNull } from "drizzle-orm";
import { getDb } from "../db";
import {
  groupBookings,
  flights,
  users,
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
  organizerUserId?: number;
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
  if (
    !Number.isSafeInteger(data.groupSize) ||
    data.groupSize < MIN_GROUP_SIZE ||
    data.groupSize > 600
  ) {
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
    organizerUserId: data.organizerUserId,
    organizerName: data.organizerName,
    organizerEmail: data.organizerEmail,
    organizerPhone: data.organizerPhone,
    groupSize: data.groupSize,
    cabinClass,
    flightId: data.flightId,
    notes: data.notes,
    status: "pending",
  });

  const insertId = result[0].insertId;

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
  adminUserId: number,
  organizerUserId?: number
): Promise<GroupBooking> {
  const db = getDb();
  if (!db) throw new Error("Database unavailable");
  if (
    !Number.isFinite(discountPercent) ||
    discountPercent < 0 ||
    discountPercent > 100
  )
    throw new Error("Invalid group discount");
  return await db.transaction(async tx => {
    const [group] = await tx
      .select()
      .from(groupBookings)
      .where(eq(groupBookings.id, id))
      .for("update");
    if (!group || group.status !== "pending")
      throw new Error("Group request is not pending");
    const ownerId = group.organizerUserId ?? organizerUserId;
    const [owner] = ownerId
      ? await tx.select().from(users).where(eq(users.id, ownerId))
      : [];
    if (
      !owner ||
      (!group.organizerUserId &&
        owner.email?.toLowerCase() !== group.organizerEmail.toLowerCase())
    )
      throw new Error(
        "Assign the organizer's verified customer account before allocating seats"
      );
    const [flight] = await tx
      .select()
      .from(flights)
      .where(eq(flights.id, group.flightId))
      .for("update");
    if (
      !flight ||
      (flight.tenantId !== null && owner.tenantId !== flight.tenantId)
    )
      throw new Error("Group customer and flight tenant do not match");
    const hold = await createInventoryLock(
      group.flightId,
      group.groupSize,
      group.cabinClass,
      `group:${id}`,
      owner.id,
      tx,
      1440
    );
    const basePrice =
      (group.cabinClass === "economy"
        ? flight.economyPrice
        : flight.businessPrice) * group.groupSize;
    const totalPrice =
      basePrice - Math.round((basePrice * discountPercent) / 100);
    if (!Number.isSafeInteger(totalPrice) || totalPrice <= 0)
      throw new Error("A positive approved group invoice is required");
    await tx
      .update(groupBookings)
      .set({
        status: "confirmed",
        organizerUserId: owner.id,
        inventoryLockId: hold.lockId,
        allocationExpiresAt: hold.expiresAt,
        discountPercent: String(discountPercent),
        totalPrice,
        approvedBy: adminUserId,
        approvedAt: new Date(),
      })
      .where(eq(groupBookings.id, id));
    await recordEvent(tx, {
      aggregateType: "group",
      aggregateId: id,
      tenantId: flight.tenantId,
      eventType: "group.allocated",
      payload: {
        groupBookingId: id,
        organizerUserId: owner.id,
        inventoryLockId: hold.lockId,
        expiresAt: hold.expiresAt.toISOString(),
        totalPrice,
        actorId: adminUserId,
      },
    });
    const [updated] = await tx
      .select()
      .from(groupBookings)
      .where(eq(groupBookings.id, id));
    if (!updated) throw new Error("Group allocation disappeared");
    return updated;
  });
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
  const db = getDb();
  if (!db) throw new Error("Database unavailable");
  return await db.transaction(async tx => {
    const [group] = await tx
      .select()
      .from(groupBookings)
      .where(eq(groupBookings.id, id))
      .for("update");
    if (!group) throw new Error("Group request not found");
    if (group.bookingId)
      throw new Error("Cancel the linked booking through its refund workflow");
    if (group.status === "cancelled") return group;
    await tx
      .select()
      .from(flights)
      .where(eq(flights.id, group.flightId))
      .for("update");
    if (group.inventoryLockId)
      await releaseInventoryLock(group.inventoryLockId, tx);
    else if (group.status === "confirmed")
      throw new Error("Legacy group requires inventory reconciliation");
    await tx
      .update(groupBookings)
      .set({ status: "cancelled", rejectionReason: reason })
      .where(eq(groupBookings.id, id));
    await recordEvent(tx, {
      aggregateType: "group",
      aggregateId: id,
      eventType: "group.allocation_released",
      payload: { groupBookingId: id, reason },
    });
    return { ...group, status: "cancelled", rejectionReason: reason };
  });
}

export async function expireGroupAllocations() {
  const db = getDb();
  if (!db) throw new Error("Database unavailable");
  const rows = await db
    .select()
    .from(groupBookings)
    .where(
      and(
        eq(groupBookings.status, "confirmed"),
        isNull(groupBookings.bookingId),
        sql`${groupBookings.allocationExpiresAt} <= ${new Date()}`
      )
    );
  for (const row of rows)
    await rejectGroupBooking(row.id, "Allocation expired before booking");
  return rows.length;
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
      inventoryLockId: groupBookings.inventoryLockId,
      organizerUserId: groupBookings.organizerUserId,
      bookingId: groupBookings.bookingId,
      allocationExpiresAt: groupBookings.allocationExpiresAt,
      organizerName: groupBookings.organizerName,
      organizerEmail: groupBookings.organizerEmail,
      organizerPhone: groupBookings.organizerPhone,
      groupSize: groupBookings.groupSize,
      flightId: groupBookings.flightId,
      cabinClass: groupBookings.cabinClass,
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

  return results;
}
