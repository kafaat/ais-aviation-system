import { TRPCError } from "@trpc/server";
import { and, eq, desc, isNull } from "drizzle-orm";
import { getDb } from "../db";
import {
  baggageItems,
  baggageTracking,
  passengers,
  type BaggageItem,
  type BaggageTracking,
  type InsertBaggageTracking,
} from "../../drizzle/schema";

/**
 * Baggage Handling & Tracking Service
 * Manages baggage registration, tracking, and lost baggage reports
 */

// Baggage status type
export type BaggageStatus =
  | "checked_in"
  | "security_screening"
  | "loading"
  | "in_transit"
  | "arrived"
  | "customs"
  | "ready_for_pickup"
  | "claimed"
  | "lost"
  | "found"
  | "damaged";

// Status labels for display
export const BAGGAGE_STATUS_LABELS: Record<BaggageStatus, string> = {
  checked_in: "Checked In",
  security_screening: "Security Screening",
  loading: "Loading",
  in_transit: "In Transit",
  arrived: "Arrived",
  customs: "Customs",
  ready_for_pickup: "Ready for Pickup",
  claimed: "Claimed",
  lost: "Lost",
  found: "Found",
  damaged: "Damaged",
};

// Valid status transitions
export const VALID_STATUS_TRANSITIONS: Record<BaggageStatus, BaggageStatus[]> =
  {
    checked_in: ["security_screening", "lost", "damaged"],
    security_screening: ["loading", "lost", "damaged"],
    loading: ["in_transit", "lost", "damaged"],
    in_transit: ["arrived", "lost", "damaged"],
    arrived: ["customs", "ready_for_pickup", "lost", "damaged"],
    customs: ["ready_for_pickup", "lost", "damaged"],
    ready_for_pickup: ["claimed", "lost", "damaged"],
    claimed: [],
    lost: ["found"],
    found: ["ready_for_pickup", "claimed"],
    damaged: ["claimed"],
  };

export {
  generateBaggageTag,
  isBaggageLicensePlate,
} from "./baggage-license-plate";
export {
  registerBaggage,
  getBaggageRegistrationSummary,
  baggageRegistrationInput,
  baggageRegistrationScopeInput,
} from "./baggage-registration.service";
export type {
  BaggageRegistrationActor,
  BaggageRegistrationInput,
} from "./baggage-registration.service";

/**
 * Preserve a completed handover when an older tracking request finishes late.
 */
function heldBag(bag: BaggageItem) {
  return and(
    eq(baggageItems.id, bag.id),
    eq(baggageItems.status, bag.status),
    isNull(baggageItems.returnEventId),
    isNull(baggageItems.returnEvidenceId)
  );
}
function requireBaggageUpdate(affected: number) {
  if (!affected)
    throw new TRPCError({
      code: "CONFLICT",
      message: "Baggage custody changed; refresh the current receipt",
    });
}

/** Update baggage status and location. */
export async function updateBaggageStatus(data: {
  tagNumber: string;
  location: string;
  status: BaggageStatus;
  scannedBy?: number;
  notes?: string;
}): Promise<{ success: boolean; baggage: BaggageItem }> {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  // Find baggage by tag number
  const [baggage] = await db
    .select()
    .from(baggageItems)
    .where(eq(baggageItems.tagNumber, data.tagNumber))
    .limit(1);

  if (!baggage) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Baggage not found with tag number: " + data.tagNumber,
    });
  }

  // Validate status transition
  const currentStatus = baggage.status as BaggageStatus;
  const validTransitions = VALID_STATUS_TRANSITIONS[currentStatus];

  if (!validTransitions.includes(data.status)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Invalid status transition from '${currentStatus}' to '${data.status}'`,
    });
  }

  // Update baggage item
  const [write] = await db
    .update(baggageItems)
    .set({
      status: data.status,
      lastLocation: data.location,
      updatedAt: new Date(),
    })
    .where(heldBag(baggage));
  requireBaggageUpdate(write.affectedRows);

  // Create tracking record
  const trackingData: InsertBaggageTracking = {
    baggageId: baggage.id,
    location: data.location,
    status: data.status,
    scannedBy: data.scannedBy || null,
    notes: data.notes || null,
  };

  await db.insert(baggageTracking).values(trackingData);

  // Return updated baggage
  const [updated] = await db
    .select()
    .from(baggageItems)
    .where(eq(baggageItems.id, baggage.id))
    .limit(1);

  return { success: true, baggage: updated };
}

/**
 * Get tracking history for a baggage item
 */
export async function trackBaggage(
  tagNumber: string
): Promise<{ baggage: BaggageItem; tracking: BaggageTracking[] }> {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  // Find baggage by tag number
  const [baggage] = await db
    .select()
    .from(baggageItems)
    .where(eq(baggageItems.tagNumber, tagNumber))
    .limit(1);

  if (!baggage) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Baggage not found with tag number: " + tagNumber,
    });
  }

  // Get tracking history ordered by scanned time (newest first)
  const tracking = await db
    .select()
    .from(baggageTracking)
    .where(eq(baggageTracking.baggageId, baggage.id))
    .orderBy(desc(baggageTracking.scannedAt));

  return { baggage, tracking };
}

/**
 * Get all baggage for a specific passenger
 */
export async function getPassengerBaggage(
  passengerId: number
): Promise<BaggageItem[]> {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  return await db
    .select()
    .from(baggageItems)
    .where(eq(baggageItems.passengerId, passengerId))
    .orderBy(desc(baggageItems.createdAt));
}

/**
 * Get all baggage for a booking
 */
export async function getBookingBaggage(
  bookingId: number
): Promise<Array<BaggageItem & { passengerName?: string }>> {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  const items = await db
    .select({
      id: baggageItems.id,
      bookingId: baggageItems.bookingId,
      passengerId: baggageItems.passengerId,
      flightId: baggageItems.flightId,
      segmentId: baggageItems.segmentId,
      returnEventId: baggageItems.returnEventId,
      returnEvidenceId: baggageItems.returnEvidenceId,
      replacesBaggageId: baggageItems.replacesBaggageId,
      tagNumber: baggageItems.tagNumber,
      weight: baggageItems.weight,
      status: baggageItems.status,
      lastLocation: baggageItems.lastLocation,
      description: baggageItems.description,
      specialHandling: baggageItems.specialHandling,
      lostReportedAt: baggageItems.lostReportedAt,
      lostDescription: baggageItems.lostDescription,
      createdAt: baggageItems.createdAt,
      updatedAt: baggageItems.updatedAt,
      passengerFirstName: passengers.firstName,
      passengerLastName: passengers.lastName,
    })
    .from(baggageItems)
    .leftJoin(passengers, eq(baggageItems.passengerId, passengers.id))
    .where(eq(baggageItems.bookingId, bookingId))
    .orderBy(desc(baggageItems.createdAt));

  return items.map(item => ({
    id: item.id,
    bookingId: item.bookingId,
    passengerId: item.passengerId,
    flightId: item.flightId,
    segmentId: item.segmentId,
    returnEventId: item.returnEventId,
    returnEvidenceId: item.returnEvidenceId,
    replacesBaggageId: item.replacesBaggageId,
    tagNumber: item.tagNumber,
    weight: item.weight,
    status: item.status,
    lastLocation: item.lastLocation,
    description: item.description,
    specialHandling: item.specialHandling,
    lostReportedAt: item.lostReportedAt,
    lostDescription: item.lostDescription,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    passengerName:
      item.passengerFirstName && item.passengerLastName
        ? `${item.passengerFirstName} ${item.passengerLastName}`
        : undefined,
  }));
}

/**
 * Report baggage as lost
 */
export async function reportLostBaggage(data: {
  tagNumber: string;
  description: string;
  contactEmail?: string;
  contactPhone?: string;
}): Promise<{ success: boolean; baggage: BaggageItem }> {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  // Find baggage by tag number
  const [baggage] = await db
    .select()
    .from(baggageItems)
    .where(eq(baggageItems.tagNumber, data.tagNumber))
    .limit(1);

  if (!baggage) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Baggage not found with tag number: " + data.tagNumber,
    });
  }

  // Cannot report if already claimed
  if (baggage.status === "claimed") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Cannot report lost baggage that has already been claimed",
    });
  }

  // Cannot report if already lost
  if (baggage.status === "lost") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Baggage has already been reported as lost",
    });
  }

  // Build lost description with contact info
  let lostDescription = data.description;
  if (data.contactEmail) {
    lostDescription += `\nContact Email: ${data.contactEmail}`;
  }
  if (data.contactPhone) {
    lostDescription += `\nContact Phone: ${data.contactPhone}`;
  }

  // Update baggage status to lost
  const [write] = await db
    .update(baggageItems)
    .set({
      status: "lost",
      lostReportedAt: new Date(),
      lostDescription,
      updatedAt: new Date(),
    })
    .where(heldBag(baggage));
  requireBaggageUpdate(write.affectedRows);

  // Create tracking record
  await db.insert(baggageTracking).values({
    baggageId: baggage.id,
    location: baggage.lastLocation || "Unknown",
    status: "lost",
    notes: `Lost baggage report: ${data.description}`,
  });

  // Return updated baggage
  const [updated] = await db
    .select()
    .from(baggageItems)
    .where(eq(baggageItems.id, baggage.id))
    .limit(1);

  return { success: true, baggage: updated };
}

/**
 * Get baggage by ID
 */
export async function getBaggageById(id: number): Promise<BaggageItem | null> {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  const [baggage] = await db
    .select()
    .from(baggageItems)
    .where(eq(baggageItems.id, id))
    .limit(1);

  return baggage || null;
}

/**
 * Get baggage by tag number
 */
export async function getBaggageByTag(
  tagNumber: string
): Promise<BaggageItem | null> {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  const [baggage] = await db
    .select()
    .from(baggageItems)
    .where(eq(baggageItems.tagNumber, tagNumber))
    .limit(1);

  return baggage || null;
}

/**
 * Get all lost baggage (admin)
 */
export async function getLostBaggage(): Promise<BaggageItem[]> {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  return await db
    .select()
    .from(baggageItems)
    .where(eq(baggageItems.status, "lost"))
    .orderBy(desc(baggageItems.lostReportedAt));
}

/**
 * Get all baggage by status (admin)
 */
export async function getBaggageByStatus(
  status: BaggageStatus
): Promise<BaggageItem[]> {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  return await db
    .select()
    .from(baggageItems)
    .where(eq(baggageItems.status, status))
    .orderBy(desc(baggageItems.updatedAt));
}

/**
 * Get baggage statistics (admin)
 */
export async function getBaggageStats(): Promise<{
  totalBaggage: number;
  checkedIn: number;
  inTransit: number;
  claimed: number;
  lost: number;
  damaged: number;
}> {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  const allBaggage = await db.select().from(baggageItems);

  const stats = {
    totalBaggage: allBaggage.length,
    checkedIn: 0,
    inTransit: 0,
    claimed: 0,
    lost: 0,
    damaged: 0,
  };

  for (const item of allBaggage) {
    switch (item.status) {
      case "checked_in":
      case "security_screening":
      case "loading":
        stats.checkedIn++;
        break;
      case "in_transit":
      case "arrived":
      case "customs":
      case "ready_for_pickup":
        stats.inTransit++;
        break;
      case "claimed":
        stats.claimed++;
        break;
      case "lost":
        stats.lost++;
        break;
      case "damaged":
        stats.damaged++;
        break;
    }
  }

  return stats;
}

/**
 * Mark found baggage
 */
export async function markBaggageFound(data: {
  tagNumber: string;
  foundLocation: string;
  scannedBy?: number;
  notes?: string;
}): Promise<{ success: boolean; baggage: BaggageItem }> {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  // Find baggage by tag number
  const [baggage] = await db
    .select()
    .from(baggageItems)
    .where(eq(baggageItems.tagNumber, data.tagNumber))
    .limit(1);

  if (!baggage) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Baggage not found with tag number: " + data.tagNumber,
    });
  }

  if (baggage.status !== "lost") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Only lost baggage can be marked as found",
    });
  }

  // Update baggage status
  const [write] = await db
    .update(baggageItems)
    .set({
      status: "found",
      lastLocation: data.foundLocation,
      updatedAt: new Date(),
    })
    .where(heldBag(baggage));
  requireBaggageUpdate(write.affectedRows);

  // Create tracking record
  await db.insert(baggageTracking).values({
    baggageId: baggage.id,
    location: data.foundLocation,
    status: "found",
    scannedBy: data.scannedBy || null,
    notes: data.notes || "Baggage found and recovered",
  });

  // Return updated baggage
  const [updated] = await db
    .select()
    .from(baggageItems)
    .where(eq(baggageItems.id, baggage.id))
    .limit(1);

  return { success: true, baggage: updated };
}

/**
 * Get all baggage for admin listing with filters
 */
export async function getAllBaggage(filters?: {
  status?: BaggageStatus;
  bookingId?: number;
}): Promise<Array<BaggageItem & { passengerName?: string }>> {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  let query = db
    .select({
      id: baggageItems.id,
      bookingId: baggageItems.bookingId,
      passengerId: baggageItems.passengerId,
      flightId: baggageItems.flightId,
      segmentId: baggageItems.segmentId,
      returnEventId: baggageItems.returnEventId,
      returnEvidenceId: baggageItems.returnEvidenceId,
      replacesBaggageId: baggageItems.replacesBaggageId,
      tagNumber: baggageItems.tagNumber,
      weight: baggageItems.weight,
      status: baggageItems.status,
      lastLocation: baggageItems.lastLocation,
      description: baggageItems.description,
      specialHandling: baggageItems.specialHandling,
      lostReportedAt: baggageItems.lostReportedAt,
      lostDescription: baggageItems.lostDescription,
      createdAt: baggageItems.createdAt,
      updatedAt: baggageItems.updatedAt,
      passengerFirstName: passengers.firstName,
      passengerLastName: passengers.lastName,
    })
    .from(baggageItems)
    .leftJoin(passengers, eq(baggageItems.passengerId, passengers.id));

  if (filters?.status) {
    query = query.where(
      eq(baggageItems.status, filters.status)
    ) as typeof query;
  }

  if (filters?.bookingId) {
    query = query.where(
      eq(baggageItems.bookingId, filters.bookingId)
    ) as typeof query;
  }

  const items = await query.orderBy(desc(baggageItems.updatedAt));

  return items.map(item => ({
    id: item.id,
    bookingId: item.bookingId,
    passengerId: item.passengerId,
    flightId: item.flightId,
    segmentId: item.segmentId,
    returnEventId: item.returnEventId,
    returnEvidenceId: item.returnEvidenceId,
    replacesBaggageId: item.replacesBaggageId,
    tagNumber: item.tagNumber,
    weight: item.weight,
    status: item.status,
    lastLocation: item.lastLocation,
    description: item.description,
    specialHandling: item.specialHandling,
    lostReportedAt: item.lostReportedAt,
    lostDescription: item.lostDescription,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    passengerName:
      item.passengerFirstName && item.passengerLastName
        ? `${item.passengerFirstName} ${item.passengerLastName}`
        : undefined,
  }));
}
