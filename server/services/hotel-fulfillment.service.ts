import { createHash, randomUUID } from "node:crypto";
import { and, eq, inArray, isNull, lte, or } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db";
import {
  bookings,
  passengers,
  emergencyHotels,
  emergencyHotelBookings,
} from "../../drizzle/schema";
import {
  hotelRequest,
  type HotelReceipt,
} from "../../shared/hotel-fulfillment";
import {
  configuredHotelProvider,
  type HotelProvider,
} from "../integrations/hotelbeds";
import { recordEvent } from "./outbox.service";
import { flightBookingCondition } from "./flight-state.service";
import type { SettlementTx } from "./booking-settlement.service";

const digest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const dbRequired = () => {
  const db = getDb();
  if (!db) throw new Error("Database unavailable");
  return db;
};
/** Strict: the result becomes a provider commitment, so refuse a nonsense stay. */
export function nightsBetween(checkIn: Date, checkOut: Date): number {
  const diff = checkOut.getTime() - checkIn.getTime();
  if (!Number.isFinite(diff) || diff <= 0 || diff > 30 * 86400000)
    throw new Error("Hotel stay must be positive and at most 30 days");
  return Math.ceil(diff / 86400000);
}
/** Lenient: a browsing estimate must never turn a hotel search into an error.
 * Same-day and reversed dates count as one night, as they did before R2-04. */
export function estimateNights(checkIn: Date, checkOut: Date): number {
  const diff = Math.abs(checkOut.getTime() - checkIn.getTime());
  if (!Number.isFinite(diff)) return 1;
  return Math.min(30, Math.max(1, Math.ceil(diff / 86400000)));
}
export const hotelIntent = z.object({
  hotelId: z.number().int().positive(),
  bookingId: z.number().int().positive(),
  flightId: z.number().int().positive(),
  passengerId: z.number().int().positive(),
  roomType: z.enum(["standard", "suite"]),
  checkIn: z.date(),
  checkOut: z.date(),
  mealIncluded: z.boolean().default(false),
  transportIncluded: z.boolean().default(false),
  notes: z.string().max(1000).optional(),
  idempotencyKey: z.string().min(8).max(128).optional(),
});
export async function createHotelRequest(
  tx: SettlementTx,
  input: z.input<typeof hotelIntent>,
  requestedBy: number
) {
  const parsed = hotelIntent.parse(input);
  const { idempotencyKey, ...intent } = parsed;
  const nights = nightsBetween(intent.checkIn, intent.checkOut);
  const [booking] = await tx
    .select()
    .from(bookings)
    .where(eq(bookings.id, intent.bookingId))
    .for("update");
  if (!booking || booking.deletedAt) throw new Error("Booking not found");
  const [member] = await tx
    .select({ id: bookings.id })
    .from(bookings)
    .where(
      and(eq(bookings.id, booking.id), flightBookingCondition(intent.flightId))
    );
  const [passenger] = await tx
    .select()
    .from(passengers)
    .where(eq(passengers.id, intent.passengerId))
    .for("share");
  if (
    !member ||
    !passenger ||
    passenger.bookingId !== booking.id ||
    passenger.tenantId !== booking.tenantId
  )
    throw new Error(
      "Hotel booking, passenger and current flight scope do not match"
    );
  const [hotel] = await tx
    .select()
    .from(emergencyHotels)
    .where(eq(emergencyHotels.id, intent.hotelId))
    .for("share");
  if (!hotel?.isActive) throw new Error("Hotel is not active");
  const requestHash = digest(intent);
  const base = idempotencyKey ?? requestHash;
  // A cancelled or rejected request is finished. Returning it for an identical
  // repeat would report a dead row as a live booking, so a repeat opens the next
  // attempt slot instead. Slot 0 keeps the original derivation, and every slot
  // stays individually idempotent: a duplicate call lands on the same slot and
  // reuses the live row rather than sending a second request.
  const requestKeyFor = (attempt: number) =>
    digest(attempt === 0 ? [booking.id, base] : [booking.id, base, attempt]);
  let requestKey: string | null = null;
  let reusable: typeof emergencyHotelBookings.$inferSelect | undefined;
  for (let attempt = 0; attempt < 32 && requestKey === null; attempt++) {
    const candidate = requestKeyFor(attempt);
    const [row] = await tx
      .select()
      .from(emergencyHotelBookings)
      .where(eq(emergencyHotelBookings.requestKey, candidate));
    if (row && row.requestHash !== requestHash)
      throw new Error("Hotel idempotency key reused with a different request");
    if (!row || !["cancelled", "rejected"].includes(row.status)) {
      requestKey = candidate;
      reusable = row;
    }
  }
  if (requestKey === null)
    throw new Error("Too many superseded hotel requests for this stay");
  if (reusable)
    return {
      ...reusable,
      hotelName: hotel.name,
      hotelAddress: hotel.address,
      hotelPhone: hotel.phone,
    };
  const nightlyRate = Math.round(
    hotel.standardRate * (intent.roomType === "suite" ? 1.8 : 1)
  );
  if (
    !Number.isSafeInteger(nightlyRate * nights) ||
    nightlyRate < 0 ||
    nightlyRate * nights > 2147483647
  )
    throw new Error("Invalid local hotel estimate");
  const requestReference =
    `H${BigInt(`0x${requestKey}`).toString(36).slice(0, 19)}`.toUpperCase();
  const [inserted] = await tx.insert(emergencyHotelBookings).values({
    ...intent,
    tenantId: booking.tenantId,
    nightlyRate,
    totalCost: nightlyRate * nights,
    status: "requested",
    confirmationNumber: null,
    requestKey,
    requestHash,
    requestReference,
  });
  await recordEvent(tx, {
    aggregateType: "hotel_booking",
    aggregateId: inserted.insertId,
    eventType: "hotel.requested",
    tenantId: booking.tenantId,
    payload: {
      hotelBookingId: inserted.insertId,
      bookingId: booking.id,
      requestedBy,
    },
  });
  const [row] = await tx
    .select()
    .from(emergencyHotelBookings)
    .where(eq(emergencyHotelBookings.id, inserted.insertId));
  if (!row) throw new Error("Hotel request was not persisted");
  return {
    ...row,
    hotelName: hotel.name,
    hotelAddress: hotel.address,
    hotelPhone: hotel.phone,
  };
}
export function requestHotelRoom(
  input: z.input<typeof hotelIntent>,
  requestedBy: number
) {
  return dbRequired().transaction(tx =>
    createHotelRequest(tx, input, requestedBy)
  );
}

export async function prepareHotelQuote(
  input: {
    hotelBookingId: number;
    hotelCode: number;
    rateKey: string;
    mappingEvidence: string;
  },
  adminUserId: number
) {
  const db = dbRequired();
  const provider = configuredHotelProvider();
  if (!provider)
    throw new Error("Hotel provider disabled; request remains unconfirmed");
  const [hint] = await db
    .select()
    .from(emergencyHotelBookings)
    .where(eq(emergencyHotelBookings.id, input.hotelBookingId));
  if (!hint || !["requested", "rejected"].includes(hint.status))
    throw new Error("Hotel request is not awaiting a quote");
  const quote = await provider.quote(input.rateKey);
  if (
    quote.hotelCode !== input.hotelCode ||
    quote.checkIn !== hint.checkIn.toISOString().slice(0, 10) ||
    quote.checkOut !== hint.checkOut.toISOString().slice(0, 10) ||
    (hint.mealIncluded && quote.boardCode !== "BB")
  )
    throw new Error(
      "Quote differs from the approved hotel mapping, dates or requested meals"
    );
  return db.transaction(async tx => {
    const [row] = await tx
      .select()
      .from(emergencyHotelBookings)
      .where(eq(emergencyHotelBookings.id, hint.id))
      .for("update");
    if (
      !row ||
      row.requestHash !== hint.requestHash ||
      !["requested", "rejected"].includes(row.status)
    )
      throw new Error("Hotel request changed while quoting");
    const [pax] = await tx
      .select()
      .from(passengers)
      .where(eq(passengers.id, row.passengerId))
      .for("share");
    if (
      !pax ||
      pax.bookingId !== row.bookingId ||
      pax.tenantId !== row.tenantId ||
      pax.type !== "adult"
    )
      throw new Error("Hotelbeds pilot requires one bound adult passenger");
    const request = hotelRequest.parse({
      quote,
      quoteId: randomUUID(),
      mappingEvidence: input.mappingEvidence,
      quotedBy: adminUserId,
      approvedBy: null,
      approvedAt: null,
      holder: { name: pax.firstName, surname: pax.lastName },
      maxCancellationCost: 0,
    });
    await tx
      .update(emergencyHotelBookings)
      .set({
        providerRequest: request,
        status: "requested",
        providerLastError: null,
      })
      .where(eq(emergencyHotelBookings.id, row.id));
    const {
      rateKey: _privateKey,
      account: _privateAccount,
      ...publicQuote
    } = quote;
    return { quoteId: request.quoteId, ...publicQuote };
  });
}
export function approveHotelQuote(
  id: number,
  quoteId: string,
  adminUserId: number
) {
  return dbRequired().transaction(async tx => {
    const [row] = await tx
      .select()
      .from(emergencyHotelBookings)
      .where(eq(emergencyHotelBookings.id, id))
      .for("update");
    const request = hotelRequest.parse(row?.providerRequest);
    if (!row || request.quoteId !== quoteId)
      throw new Error("Hotel quote identity changed");
    if (row.status === "pending_provider" && request.approvedAt)
      return { status: row.status };
    if (
      row.status !== "requested" ||
      Date.parse(request.quote.expiresAt) <= Date.now()
    )
      throw new Error("Hotel quote expired or request already submitted");
    request.approvedBy = adminUserId;
    request.approvedAt = new Date().toISOString();
    await tx
      .update(emergencyHotelBookings)
      .set({
        status: "pending_provider",
        providerRequest: request,
        providerNextAttemptAt: new Date(),
      })
      .where(eq(emergencyHotelBookings.id, id));
    await recordEvent(tx, {
      aggregateType: "hotel_booking",
      aggregateId: id,
      eventType: "hotel.approved",
      tenantId: row.tenantId,
      payload: { hotelBookingId: id, approvedBy: adminUserId, quoteId },
    });
    return { status: "pending_provider" as const };
  });
}
export function requestHotelCancellation(
  id: number,
  adminUserId: number,
  maxCancellationCost = 0
) {
  return dbRequired().transaction(async tx => {
    const [row] = await tx
      .select()
      .from(emergencyHotelBookings)
      .where(eq(emergencyHotelBookings.id, id))
      .for("update");
    if (!row) throw new Error("Hotel request not found");
    if (["cancelled", "cancellation_unknown"].includes(row.status))
      return {
        success: true,
        status: row.status,
        confirmationNumber: row.confirmationNumber,
      };
    if (row.providerLeaseUntil && row.providerLeaseUntil.getTime() > Date.now())
      throw new Error("Hotel provider operation is in progress");
    // A row created before R2-04 carries no provider state whatsoever, so
    // cancelling it is purely local bookkeeping — what cancelHotelBooking did
    // before this change. Without this branch every pre-migration reservation
    // would be permanently uncancellable through both the API and the admin
    // screen. `checked_out` stays refused, as it was before.
    const localOnly =
      row.providerRequest === null &&
      row.providerReceipt === null &&
      row.providerLease === null &&
      row.requestKey === null;
    if (
      ![
        "cancellation_pending",
        "requested",
        "rejected",
        "pending_provider",
        "confirmed",
        "sandbox_confirmed",
      ].includes(row.status) &&
      !(localOnly && ["reserved", "checked_in", "no_show"].includes(row.status))
    )
      throw new Error(
        "Reconcile hotel outcome before cancellation; legacy reservations require operator verification"
      );
    const sent =
      row.status === "confirmed" ||
      row.status === "sandbox_confirmed" ||
      row.status === "cancellation_pending";
    const status: "cancellation_pending" | "cancelled" = sent
      ? "cancellation_pending"
      : "cancelled";
    const request = row.providerRequest
      ? hotelRequest.parse(row.providerRequest)
      : null;
    if (request)
      request.maxCancellationCost = z
        .number()
        .int()
        .min(0)
        .max(request.quote.totalCost)
        .parse(maxCancellationCost);
    await tx
      .update(emergencyHotelBookings)
      .set({
        status,
        providerRequest: request,
        providerNextAttemptAt: new Date(),
      })
      .where(eq(emergencyHotelBookings.id, id));
    await recordEvent(tx, {
      aggregateType: "hotel_booking",
      aggregateId: id,
      eventType: "hotel.cancellation_requested",
      tenantId: row.tenantId,
      payload: {
        hotelBookingId: id,
        requestedBy: adminUserId,
        maxCancellationCost,
      },
    });
    return {
      success: true,
      status,
      confirmationNumber: row.confirmationNumber,
    };
  });
}

/** Claim first, mark unknown before writes, then reconcile indefinitely using the same identity.
 * A crash before POST may need manual resolution; it can never trigger a second POST.
 */
export async function fulfillHotelRequest(
  db: SettlementTx,
  id: number,
  provider: HotelProvider
) {
  const token = randomUUID();
  const claim = await db.transaction(async tx => {
    const [row] = await tx
      .select()
      .from(emergencyHotelBookings)
      .where(eq(emergencyHotelBookings.id, id))
      .for("update");
    if (
      !row ||
      ![
        "pending_provider",
        "outcome_unknown",
        "cancellation_pending",
        "cancellation_unknown",
      ].includes(row.status) ||
      (row.providerLeaseUntil && row.providerLeaseUntil.getTime() > Date.now())
    )
      return null;
    const request = hotelRequest.parse(row.providerRequest);
    if (
      request.quote.mode !== provider.mode ||
      request.quote.account !== provider.account ||
      !request.approvedAt ||
      !row.requestReference
    )
      throw new Error("Hotel provider account or approval mismatch");
    const action =
      row.status === "pending_provider"
        ? "book"
        : row.status === "cancellation_pending"
          ? "cancel"
          : "lookup";
    if (
      action === "book" &&
      Date.parse(request.quote.expiresAt) <= Date.now()
    ) {
      await tx
        .update(emergencyHotelBookings)
        .set({
          status: "rejected",
          providerLastError: "Quote expired before provider submission",
        })
        .where(eq(emergencyHotelBookings.id, id));
      return null;
    }
    await tx
      .update(emergencyHotelBookings)
      .set({
        status: action === "book" ? "outcome_unknown" : row.status,
        providerLease: token,
        providerLeaseUntil: new Date(Date.now() + 120000),
      })
      .where(eq(emergencyHotelBookings.id, id));
    return { row, request, action, reference: row.requestReference };
  });
  if (!claim) return;
  const { row, request, action, reference } = claim;
  try {
    let receipt: HotelReceipt | null;
    if (action === "book") receipt = await provider.book(request, reference);
    else if (action === "cancel") {
      if (!row.confirmationNumber)
        throw new Error("Missing provider confirmation for cancellation");
      const simulation = await provider.cancel(
        request,
        reference,
        row.confirmationNumber,
        true
      );
      if (
        simulation.cancellationCost === null ||
        simulation.cancellationCost > request.maxCancellationCost
      )
        throw new Error(
          "Cancellation fee exceeds operator approval or is unknown"
        );
      const [updated] = await db
        .update(emergencyHotelBookings)
        .set({ status: "cancellation_unknown" })
        .where(
          and(
            eq(emergencyHotelBookings.id, id),
            eq(emergencyHotelBookings.providerLease, token)
          )
        );
      if (updated.affectedRows !== 1)
        throw new Error("Hotel cancellation lease lost");
      receipt = await provider.cancel(
        request,
        reference,
        row.confirmationNumber,
        false
      );
    } else receipt = await provider.lookup(request, reference);
    if (!receipt)
      throw new Error(
        "Provider outcome not found; automatic write retry prohibited"
      );
    if (
      receipt.currency !== request.quote.currency ||
      !Number.isSafeInteger(receipt.totalCost) ||
      receipt.totalCost < 0 ||
      receipt.totalCost > request.quote.totalCost
    )
      throw new Error("Hotel receipt exceeds approved amount or currency");
    if (
      receipt.clientReference !== reference ||
      (row.confirmationNumber && receipt.reference !== row.confirmationNumber)
    )
      throw new Error("Hotel receipt identity mismatch");
    const cancelling = row.status.startsWith("cancellation_");
    if (cancelling && receipt.status !== "CANCELLED")
      throw new Error("Provider cancellation not confirmed");
    if (
      receipt.status === "CANCELLED" &&
      (receipt.cancellationCost === null || !receipt.cancellationReference)
    )
      throw new Error("Provider cancellation receipt incomplete");
    await db.transaction(async tx => {
      const [current] = await tx
        .select()
        .from(emergencyHotelBookings)
        .where(eq(emergencyHotelBookings.id, id))
        .for("update");
      if (current?.providerLease !== token)
        throw new Error("Hotel provider lease lost");
      const status =
        receipt.status === "CANCELLED"
          ? "cancelled"
          : provider.mode === "sandbox"
            ? "sandbox_confirmed"
            : "confirmed";
      await tx
        .update(emergencyHotelBookings)
        .set({
          status,
          confirmationNumber: receipt.reference,
          providerReceipt: receipt,
          totalCost:
            receipt.status === "CANCELLED"
              ? (receipt.cancellationCost ?? 0)
              : receipt.totalCost,
          mealIncluded: request.quote.boardCode === "BB",
          providerLease: null,
          providerLeaseUntil: null,
          providerNextAttemptAt: null,
          providerLastError: null,
        })
        .where(eq(emergencyHotelBookings.id, id));
      await recordEvent(tx, {
        aggregateType: "hotel_booking",
        aggregateId: id,
        eventType: `hotel.${status}`,
        tenantId: row.tenantId,
        payload: {
          hotelBookingId: id,
          bookingId: row.bookingId,
          mode: provider.mode,
          currency: receipt.currency,
          totalCost: receipt.totalCost,
        },
      });
    });
  } catch (error) {
    // Never persist raw provider replies, credentials, passenger names or rate keys in diagnostics.
    await db
      .update(emergencyHotelBookings)
      .set({
        providerLease: null,
        providerLeaseUntil: null,
        providerNextAttemptAt: new Date(Date.now() + 5 * 60000),
        providerLastError:
          error instanceof Error &&
          error.message ===
            "Cancellation fee exceeds operator approval or is unknown"
            ? error.message
            : "Provider outcome requires reconciliation or operator review",
      })
      .where(
        and(
          eq(emergencyHotelBookings.id, id),
          eq(emergencyHotelBookings.providerLease, token)
        )
      );
    throw error;
  }
}
export async function processHotelFulfillment() {
  const provider = configuredHotelProvider();
  if (!provider) return;
  const db = dbRequired();
  const now = new Date();
  const rows = await db
    .select({ id: emergencyHotelBookings.id })
    .from(emergencyHotelBookings)
    .where(
      and(
        inArray(emergencyHotelBookings.status, [
          "pending_provider",
          "outcome_unknown",
          "cancellation_pending",
          "cancellation_unknown",
        ]),
        or(
          isNull(emergencyHotelBookings.providerNextAttemptAt),
          lte(emergencyHotelBookings.providerNextAttemptAt, now)
        ),
        or(
          isNull(emergencyHotelBookings.providerLeaseUntil),
          lte(emergencyHotelBookings.providerLeaseUntil, now)
        )
      )
    )
    .limit(25);
  const failed: number[] = [];
  for (const row of rows) {
    try {
      await fulfillHotelRequest(db, row.id, provider);
    } catch {
      failed.push(row.id);
    }
  }
  if (failed.length)
    throw new Error(
      `Hotel requests require reconciliation: ${failed.join(",")}`
    );
}
