import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import {
  bookings,
  flights,
  airports,
  passengers,
  payments,
  paymentReceipts,
  paymentHistory,
  paymentSplits,
  financialLedger,
  bookingRefundPlans,
  bookingRefundItems,
  orderServiceRefunds,
  userCredits,
  creditUsage,
  voucherUsage,
  walletTransactions,
  milesTransactions,
  bookingLoyaltyAccruals,
  loyaltyCreditLots,
  loyaltyContractLiabilityEvents,
  agencyCreditObligations,
  corporateBookings,
  agentBookings,
  bookingModifications,
  bookingCheckoutRequests,
  retailOffers,
  bookingFareComponents,
  bookingAncillaries,
  zatcaInvoiceDrafts,
  ticketCoupons,
  electronicMiscDocs,
  ndcOrders,
  compensationClaims,
  emergencyHotelBookings,
} from "../../drizzle/schema";
import {
  eq,
  desc,
  asc,
  and,
  isNotNull,
  sql,
  count,
  inArray,
  lt,
  or,
  exists,
} from "drizzle-orm";
import type { AnyMySqlColumn, MySqlTable } from "drizzle-orm/mysql-core";
import { DELETED_BOOKING_RETENTION_DAYS } from "@shared/const";
import type { SettlementTx } from "./booking-settlement.service";

// Explicit retained financial/document authorities, not a generic cascade or a
// legal retention policy. Any state/tenant mismatch still preserves the source.
// Other operational/JSON references and non-locking writers remain outside this
// bounded guard; see the accompanying coverage/retention audit.
const retainedFinancialReferences: ReadonlyArray<{
  table: MySqlTable;
  bookingId: AnyMySqlColumn;
  passengerId?: AnyMySqlColumn;
}> = [
  { table: payments, bookingId: payments.bookingId },
  { table: paymentReceipts, bookingId: paymentReceipts.bookingId },
  { table: paymentHistory, bookingId: paymentHistory.bookingId },
  { table: paymentSplits, bookingId: paymentSplits.bookingId },
  { table: financialLedger, bookingId: financialLedger.bookingId },
  { table: bookingRefundPlans, bookingId: bookingRefundPlans.bookingId },
  { table: bookingRefundItems, bookingId: bookingRefundItems.bookingId },
  { table: orderServiceRefunds, bookingId: orderServiceRefunds.bookingId },
  { table: userCredits, bookingId: userCredits.bookingId },
  { table: creditUsage, bookingId: creditUsage.bookingId },
  { table: voucherUsage, bookingId: voucherUsage.bookingId },
  { table: walletTransactions, bookingId: walletTransactions.bookingId },
  { table: milesTransactions, bookingId: milesTransactions.bookingId },
  {
    table: bookingLoyaltyAccruals,
    bookingId: bookingLoyaltyAccruals.bookingId,
  },
  { table: loyaltyCreditLots, bookingId: loyaltyCreditLots.bookingId },
  {
    table: loyaltyContractLiabilityEvents,
    bookingId: loyaltyContractLiabilityEvents.bookingId,
  },
  {
    table: agencyCreditObligations,
    bookingId: agencyCreditObligations.bookingId,
  },
  { table: corporateBookings, bookingId: corporateBookings.bookingId },
  { table: agentBookings, bookingId: agentBookings.bookingId },
  { table: bookingModifications, bookingId: bookingModifications.bookingId },
  {
    table: bookingCheckoutRequests,
    bookingId: bookingCheckoutRequests.bookingId,
  },
  { table: retailOffers, bookingId: retailOffers.consumedBookingId },
  {
    table: bookingFareComponents,
    bookingId: bookingFareComponents.bookingId,
    passengerId: bookingFareComponents.passengerId,
  },
  {
    table: bookingAncillaries,
    bookingId: bookingAncillaries.bookingId,
    passengerId: bookingAncillaries.passengerId,
  },
  { table: zatcaInvoiceDrafts, bookingId: zatcaInvoiceDrafts.bookingId },
  {
    table: ticketCoupons,
    bookingId: ticketCoupons.bookingId,
    passengerId: ticketCoupons.passengerId,
  },
  {
    table: electronicMiscDocs,
    bookingId: electronicMiscDocs.bookingId,
    passengerId: electronicMiscDocs.passengerId,
  },
  { table: ndcOrders, bookingId: ndcOrders.bookingId },
  {
    table: compensationClaims,
    bookingId: compensationClaims.bookingId,
    passengerId: compensationClaims.passengerId,
  },
  {
    table: emergencyHotelBookings,
    bookingId: emergencyHotelBookings.bookingId,
    passengerId: emergencyHotelBookings.passengerId,
  },
];

function retainedFinancialEvidence(tx: SettlementTx) {
  // An outer FOR UPDATE does not make a nested query a current locking read.
  // Apply it to each source and passenger lookup after locking the candidates.
  const ownedPassengers = () =>
    tx
      .select({ id: passengers.id })
      .from(passengers)
      .where(eq(passengers.bookingId, bookings.id))
      .for("update");
  return or(
    inArray(bookings.paymentStatus, ["paid", "refunded"]),
    isNotNull(bookings.stripePaymentIntentId),
    isNotNull(bookings.stripeCheckoutSessionId),
    exists(
      tx
        .select({ retained: sql`1` })
        .from(passengers)
        .where(
          and(
            eq(passengers.bookingId, bookings.id),
            isNotNull(passengers.ticketNumber)
          )
        )
        .for("update")
    ),
    ...retainedFinancialReferences.map(reference =>
      exists(
        tx
          .select({ retained: sql`1` })
          .from(reference.table)
          .where(
            or(
              eq(reference.bookingId, bookings.id),
              reference.passengerId
                ? inArray(reference.passengerId, ownedPassengers())
                : undefined
            )
          )
          .for("update")
      )
    )
  );
}

/**
 * Soft delete a booking (set deletedAt timestamp)
 */
export async function softDeleteBooking(
  bookingId: number,
  userId: number,
  isAdmin: boolean
) {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  return db.transaction(async tx => {
    const [booking] = await tx
      .select()
      .from(bookings)
      .where(eq(bookings.id, bookingId))
      .limit(1)
      .for("update");

    if (!booking) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Booking not found" });
    }

    if (!isAdmin && booking.userId !== userId) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Access denied" });
    }

    // Check the current owner and status under the same lock as the mutation.
    if (!isAdmin && booking.status !== "cancelled") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Only cancelled bookings can be deleted",
      });
    }

    await tx
      .update(bookings)
      .set({ deletedAt: new Date() })
      .where(eq(bookings.id, bookingId));

    return { success: true, bookingId };
  });
}

/**
 * Restore a soft-deleted booking (admin only)
 */
export async function restoreBooking(bookingId: number) {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  return db.transaction(async tx => {
    const [booking] = await tx
      .select()
      .from(bookings)
      .where(eq(bookings.id, bookingId))
      .limit(1)
      .for("update");

    if (!booking) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Booking not found" });
    }

    if (!booking.deletedAt) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Booking is not deleted",
      });
    }

    await tx
      .update(bookings)
      .set({ deletedAt: null })
      .where(eq(bookings.id, bookingId));

    return { success: true, bookingId };
  });
}

/**
 * Get all soft-deleted bookings (admin only)
 */
export async function getDeletedBookings(
  filters: {
    limit?: number;
    offset?: number;
  } = {}
) {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  const result = await db
    .select({
      id: bookings.id,
      bookingReference: bookings.bookingReference,
      pnr: bookings.pnr,
      status: bookings.status,
      totalAmount: bookings.totalAmount,
      paymentStatus: bookings.paymentStatus,
      cabinClass: bookings.cabinClass,
      numberOfPassengers: bookings.numberOfPassengers,
      deletedAt: bookings.deletedAt,
      createdAt: bookings.createdAt,
      userId: bookings.userId,
      flightNumber: flights.flightNumber,
      origin: airports.code,
      destination: sql<string>`dest.code`,
      departureTime: flights.departureTime,
    })
    .from(bookings)
    .innerJoin(flights, eq(bookings.flightId, flights.id))
    .innerJoin(airports, eq(flights.originId, airports.id))
    .innerJoin(sql`airports as dest`, sql`${flights.destinationId} = dest.id`)
    .where(isNotNull(bookings.deletedAt))
    .orderBy(desc(bookings.deletedAt))
    .limit(filters.limit || 50)
    .offset(filters.offset || 0);

  return result;
}

/**
 * Get count of deleted bookings
 */
export async function getDeletedBookingsCount() {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  const [result] = await db
    .select({ count: count() })
    .from(bookings)
    .where(isNotNull(bookings.deletedAt));

  return result.count;
}

/**
 * Permanently delete old soft-deleted bookings (admin cleanup)
 * Only deletes bookings that have been soft-deleted for more than the retention period
 */
export async function purgeDeletedBookings(
  retentionDays: number = DELETED_BOOKING_RETENTION_DAYS
) {
  // The service is also callable outside the router. Preserve its public
  // retention range rather than allowing a negative/invalid cutoff to purge.
  if (
    !Number.isSafeInteger(retentionDays) ||
    retentionDays < 30 ||
    retentionDays > 365
  )
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Retention must be an integer between 30 and 365 days",
    });
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

  return db.transaction(async tx => {
    const deletedBookingIds = await tx
      .select({ id: bookings.id })
      .from(bookings)
      .where(
        and(isNotNull(bookings.deletedAt), lt(bookings.deletedAt, cutoffDate))
      )
      .orderBy(asc(bookings.id))
      .for("update");

    if (deletedBookingIds.length === 0) return { purgedCount: 0 };
    const candidateIds = deletedBookingIds.map(booking => booking.id);
    const retained = await tx
      .select({ id: bookings.id })
      .from(bookings)
      .where(
        and(inArray(bookings.id, candidateIds), retainedFinancialEvidence(tx))
      )
      .for("update");
    const protectedIds = new Set(retained.map(booking => booking.id));
    const ids = candidateIds.filter(id => !protectedIds.has(id));
    if (ids.length === 0) return { purgedCount: 0 };

    // The same locked set owns both deletes. A restored/newly eligible booking
    // cannot expand the later predicate, and a retained-reference rejection
    // rolls back passenger deletion as well as every booking deletion.
    await tx.delete(passengers).where(inArray(passengers.bookingId, ids));
    const [result] = await tx.delete(bookings).where(inArray(bookings.id, ids));
    return { purgedCount: result.affectedRows };
  });
}
