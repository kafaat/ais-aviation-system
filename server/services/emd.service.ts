/**
 * Electronic Miscellaneous Document (EMD) Service
 *
 * Implements IATA-standard EMD management for ancillary service documentation.
 * Supports EMD-S (standalone) and EMD-A (associated with a flight ticket).
 *
 * EMD lifecycle: issued -> used | void | exchanged | refunded | suspended
 *
 * All monetary amounts are in SAR cents (100 = 1 SAR) unless otherwise noted.
 */

import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import {
  electronicMiscDocs,
  bookings,
  passengers,
  flights,
  airlines,
  type ElectronicMiscDoc,
  type InsertElectronicMiscDoc,
} from "../../drizzle/schema";
import { eq, and, gte, lte, desc, sql, count } from "drizzle-orm";

// ============================================================================
// Types
// ============================================================================

export type EmdType = "EMD-S" | "EMD-A";

export type EmdStatus =
  | "issued"
  | "used"
  | "void"
  | "exchanged"
  | "refunded"
  | "suspended";

export type EmdReasonForIssuance =
  | "baggage"
  | "seat_selection"
  | "meal"
  | "lounge_access"
  | "priority_boarding"
  | "insurance"
  | "pet_transport"
  | "unaccompanied_minor"
  | "sport_equipment"
  | "upgrade"
  | "penalty"
  | "residual_value"
  | "ground_transport"
  | "wifi"
  | "entertainment"
  | "other";

/** Parameters for issuing a new EMD */
export interface IssueEmdParams {
  emdType: EmdType;
  bookingId?: number | null;
  passengerId?: number | null;
  ticketNumber?: string | null;
  issuingAirlineId: number;
  issuingAgentId?: number | null;
  iataNumber?: string | null;
  reasonForIssuance: EmdReasonForIssuance;
  serviceDescription: string;
  rficCode?: string | null;
  rfiscCode?: string | null;
  amount: number;
  currency?: string;
  taxAmount?: number;
  flightId?: number | null;
  flightSegment?: string | null;
  dateOfService?: Date | string | null;
  expiryDate?: Date | string | null;
}

/** Parameters for exchanging an EMD into a new one */
export interface ExchangeEmdParams {
  emdType?: EmdType;
  reasonForIssuance?: EmdReasonForIssuance;
  serviceDescription?: string;
  rficCode?: string | null;
  rfiscCode?: string | null;
  amount: number;
  currency?: string;
  taxAmount?: number;
  flightId?: number | null;
  flightSegment?: string | null;
  dateOfService?: Date | string | null;
  expiryDate?: Date | string | null;
}

/** Filters for listing EMDs */
export interface ListEmdsFilters {
  airlineId?: number;
  bookingId?: number;
  passengerId?: number;
  status?: EmdStatus;
  emdType?: EmdType;
  dateFrom?: Date | string;
  dateTo?: Date | string;
  page?: number;
  limit?: number;
}

/** Date range for statistics queries */
export interface EmdDateRange {
  from: Date | string;
  to: Date | string;
}

/** EMD with related entity details */
export interface EmdWithDetails extends ElectronicMiscDoc {
  booking?: {
    id: number;
    bookingReference: string;
    pnr: string;
    status: string;
  } | null;
  passenger?: {
    id: number;
    firstName: string;
    lastName: string;
    type: string;
  } | null;
  flight?: {
    id: number;
    flightNumber: string;
    departureTime: Date;
    arrivalTime: Date;
  } | null;
  issuingAirline?: {
    id: number;
    code: string;
    name: string;
  } | null;
}

/** Refund result */
export interface EmdRefundResult {
  emdNumber: string;
  originalAmount: number;
  refundAmount: number;
  taxRefund: number;
  totalRefund: number;
  isPartialRefund: boolean;
  status: EmdStatus;
}

/** Exchange result */
export interface EmdExchangeResult {
  originalEmdNumber: string;
  originalStatus: EmdStatus;
  newEmdNumber: string;
  newEmdId: number;
  amountDifference: number;
}

/** Statistics result */
export interface EmdStatistics {
  airlineId: number;
  period: {
    from: string | null;
    to: string | null;
  };
  totals: {
    count: number;
    amount: number;
    taxAmount: number;
    averageAmount: number;
  };
  byStatus: Array<{
    status: string;
    count: number;
    totalAmount: number;
  }>;
  byType: Array<{
    emdType: string;
    count: number;
    totalAmount: number;
  }>;
  byReason: Array<{
    reason: string;
    count: number;
    totalAmount: number;
  }>;
}

// ============================================================================
// Valid Status Transitions
// ============================================================================

/**
 * Allowed EMD status transitions following IATA standard lifecycle.
 *
 *   issued    -> used, void, exchanged, refunded, suspended
 *   suspended -> issued (reactivate), void, refunded
 *
 * Terminal states (no outbound transitions): used, void, exchanged, refunded
 */
const VALID_STATUS_TRANSITIONS: Record<EmdStatus, EmdStatus[]> = {
  issued: ["used", "void", "exchanged", "refunded", "suspended"],
  suspended: ["issued", "void", "refunded"],
  used: [],
  void: [],
  exchanged: [],
  refunded: [],
};

// ============================================================================
// Internal Helpers
// ============================================================================

/**
 * Resolve a database connection or throw a TRPCError.
 */
async function requireDb() {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });
  }
  return db;
}

/**
 * Coerce a Date | string | null | undefined value into a Date or null.
 */
function toDateOrNull(value: Date | string | null | undefined): Date | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value;
  return new Date(value);
}

/**
 * Enrich a raw EMD record with related booking, passenger, flight, and airline data.
 */
async function enrichEmdWithDetails(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  emd: ElectronicMiscDoc
): Promise<EmdWithDetails> {
  const result: EmdWithDetails = { ...emd };

  // Fetch booking details
  if (emd.bookingId) {
    const [booking] = await db
      .select({
        id: bookings.id,
        bookingReference: bookings.bookingReference,
        pnr: bookings.pnr,
        status: bookings.status,
      })
      .from(bookings)
      .where(eq(bookings.id, emd.bookingId))
      .limit(1);

    result.booking = booking ?? null;
  } else {
    result.booking = null;
  }

  // Fetch passenger details
  if (emd.passengerId) {
    const [passenger] = await db
      .select({
        id: passengers.id,
        firstName: passengers.firstName,
        lastName: passengers.lastName,
        type: passengers.type,
      })
      .from(passengers)
      .where(eq(passengers.id, emd.passengerId))
      .limit(1);

    result.passenger = passenger ?? null;
  } else {
    result.passenger = null;
  }

  // Fetch flight details
  if (emd.flightId) {
    const [flight] = await db
      .select({
        id: flights.id,
        flightNumber: flights.flightNumber,
        departureTime: flights.departureTime,
        arrivalTime: flights.arrivalTime,
      })
      .from(flights)
      .where(eq(flights.id, emd.flightId))
      .limit(1);

    result.flight = flight ?? null;
  } else {
    result.flight = null;
  }

  // Fetch issuing airline details
  const [issuingAirline] = await db
    .select({
      id: airlines.id,
      code: airlines.code,
      name: airlines.name,
    })
    .from(airlines)
    .where(eq(airlines.id, emd.issuingAirlineId))
    .limit(1);

  result.issuingAirline = issuingAirline ?? null;

  return result;
}

// ============================================================================
// Exported Helpers
// ============================================================================

/**
 * Compute the Luhn check digit for a numeric string.
 *
 * The Luhn algorithm (mod-10) is the standard check-digit method used by
 * IATA for ticket and EMD numbers. Given a string of digits, it returns a
 * single check digit (0-9) that, when appended, makes the full number pass
 * Luhn validation.
 */
function computeLuhnCheckDigit(digits: string): number {
  let sum = 0;
  // Process from right to left. The rightmost digit (position 0) gets
  // doubled first, matching the convention where the check digit position
  // itself is not yet present.
  for (let i = digits.length - 1; i >= 0; i--) {
    const positionFromRight = digits.length - 1 - i;
    let digit = parseInt(digits[i], 10);

    if (positionFromRight % 2 === 0) {
      digit *= 2;
      if (digit > 9) {
        digit -= 9;
      }
    }

    sum += digit;
  }

  const remainder = sum % 10;
  return remainder === 0 ? 0 : 10 - remainder;
}

/**
 * Generate a unique EMD number with Luhn check digit.
 *
 * Format: PPP SSSSSSSSSS C  (14 characters total, stored without spaces)
 *   PPP          = 3-digit airline accounting prefix (numeric)
 *   SSSSSSSSSS   = 10-digit random serial
 *   C            = 1-digit Luhn check digit
 *
 * Retries up to 10 times to guarantee uniqueness against existing records.
 *
 * @param airlinePrefix - 3-digit airline accounting code (e.g., "065" for Saudia).
 *                        Non-numeric characters are converted to their char-code
 *                        last digit. Padded/truncated to exactly 3 digits.
 * @returns A unique 14-character EMD number string
 */
export async function generateEmdNumber(
  airlinePrefix: string
): Promise<string> {
  const db = await requireDb();

  // Normalize prefix to exactly 3 numeric digits
  const prefix = airlinePrefix
    .replace(/[^0-9]/g, ch => (ch.charCodeAt(0) % 10).toString())
    .padStart(3, "0")
    .slice(0, 3);

  const MAX_ATTEMPTS = 10;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    // Generate a 10-digit serial number
    const serial = Math.floor(Math.random() * 10_000_000_000)
      .toString()
      .padStart(10, "0");

    const withoutCheck = `${prefix}${serial}`;
    const checkDigit = computeLuhnCheckDigit(withoutCheck);
    const emdNumber = `${withoutCheck}${checkDigit}`;

    // Verify uniqueness
    const [existing] = await db
      .select({ id: electronicMiscDocs.id })
      .from(electronicMiscDocs)
      .where(eq(electronicMiscDocs.emdNumber, emdNumber))
      .limit(1);

    if (!existing) {
      return emdNumber;
    }
  }

  throw new TRPCError({
    code: "INTERNAL_SERVER_ERROR",
    message: `Failed to generate unique EMD number after ${MAX_ATTEMPTS} attempts`,
  });
}

/**
 * Validate whether a status transition is permitted.
 *
 * @param currentStatus - The current EMD status
 * @param newStatus     - The desired target status
 * @returns true if the transition is valid, false otherwise
 */
export function validateEmdTransition(
  currentStatus: EmdStatus,
  newStatus: EmdStatus
): boolean {
  const allowed = VALID_STATUS_TRANSITIONS[currentStatus];
  if (!allowed) return false;
  return allowed.includes(newStatus);
}

/**
 * Calculate tax on an EMD amount.
 *
 * @param amount  - Base amount in SAR cents
 * @param taxRate - Tax rate as a decimal (e.g., 0.15 for 15% VAT). Defaults to 0.15.
 * @returns Tax amount in SAR cents, rounded to the nearest cent
 */
export function calculateEmdTax(
  amount: number,
  taxRate: number = 0.15
): number {
  return Math.round(amount * taxRate);
}

// ============================================================================
// Core EMD Operations
// ============================================================================

/**
 * Issue a new Electronic Miscellaneous Document.
 *
 * Generates a unique EMD number (airline prefix + serial + Luhn check digit),
 * validates the issuing airline, associated booking, and passenger if provided,
 * and persists the document with status "issued".
 *
 * @param params - EMD issuance parameters
 * @returns The newly created EMD record
 */
export async function issueEmd(
  params: IssueEmdParams
): Promise<ElectronicMiscDoc> {
  const db = await requireDb();

  // Validate the issuing airline exists
  const [airline] = await db
    .select({ id: airlines.id, code: airlines.code })
    .from(airlines)
    .where(eq(airlines.id, params.issuingAirlineId))
    .limit(1);

  if (!airline) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: `Airline with ID ${params.issuingAirlineId} not found`,
    });
  }

  // Validate booking if provided
  if (params.bookingId) {
    const [booking] = await db
      .select({ id: bookings.id })
      .from(bookings)
      .where(eq(bookings.id, params.bookingId))
      .limit(1);

    if (!booking) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: `Booking with ID ${params.bookingId} not found`,
      });
    }
  }

  // Validate passenger if provided
  if (params.passengerId) {
    const [passenger] = await db
      .select({ id: passengers.id, bookingId: passengers.bookingId })
      .from(passengers)
      .where(eq(passengers.id, params.passengerId))
      .limit(1);

    if (!passenger) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: `Passenger with ID ${params.passengerId} not found`,
      });
    }

    // If both booking and passenger are provided, verify they match
    if (params.bookingId && passenger.bookingId !== params.bookingId) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Passenger does not belong to the specified booking",
      });
    }
  }

  // Validate flight if provided
  if (params.flightId) {
    const [flight] = await db
      .select({ id: flights.id })
      .from(flights)
      .where(eq(flights.id, params.flightId))
      .limit(1);

    if (!flight) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: `Flight with ID ${params.flightId} not found`,
      });
    }
  }

  // EMD-A requires a ticket number
  if (params.emdType === "EMD-A" && !params.ticketNumber) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "EMD-A (associated) requires a ticket number",
    });
  }

  // Validate amount is positive
  if (params.amount <= 0) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "EMD amount must be greater than zero",
    });
  }

  // Generate a unique EMD number using the airline code as prefix source
  const emdNumber = await generateEmdNumber(airline.code);

  const insertData: InsertElectronicMiscDoc = {
    emdNumber,
    emdType: params.emdType,
    bookingId: params.bookingId ?? null,
    passengerId: params.passengerId ?? null,
    ticketNumber: params.ticketNumber ?? null,
    issuingAirlineId: params.issuingAirlineId,
    issuingAgentId: params.issuingAgentId ?? null,
    iataNumber: params.iataNumber ?? null,
    reasonForIssuance: params.reasonForIssuance,
    serviceDescription: params.serviceDescription,
    rficCode: params.rficCode ?? null,
    rfiscCode: params.rfiscCode ?? null,
    amount: params.amount,
    currency: params.currency ?? "SAR",
    taxAmount: params.taxAmount ?? 0,
    status: "issued",
    flightId: params.flightId ?? null,
    flightSegment: params.flightSegment ?? null,
    dateOfIssuance: new Date(),
    dateOfService: toDateOrNull(params.dateOfService),
    expiryDate: toDateOrNull(params.expiryDate),
  };

  try {
    const [result] = await db.insert(electronicMiscDocs).values(insertData);
    const insertId =
      (result as unknown as { insertId: number }).insertId ||
      (result as unknown as Array<{ insertId: number }>)[0]?.insertId;

    const [newEmd] = await db
      .select()
      .from(electronicMiscDocs)
      .where(eq(electronicMiscDocs.id, insertId))
      .limit(1);

    return newEmd;
  } catch (error) {
    if (error instanceof TRPCError) throw error;
    console.error("Error issuing EMD:", error);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to issue EMD",
    });
  }
}

// ============================================================================
// Retrieval Operations
// ============================================================================

/**
 * Get an EMD by its document number with related booking/passenger/flight info.
 *
 * @param emdNumber - The 14-character EMD document number
 * @returns EMD with enriched details, or null if not found
 */
export async function getEmd(
  emdNumber: string
): Promise<EmdWithDetails | null> {
  const db = await requireDb();

  const [emd] = await db
    .select()
    .from(electronicMiscDocs)
    .where(eq(electronicMiscDocs.emdNumber, emdNumber))
    .limit(1);

  if (!emd) return null;

  return enrichEmdWithDetails(db, emd);
}

/**
 * Get an EMD by its internal database ID with related details.
 *
 * @param id - The internal auto-increment ID
 * @returns EMD with enriched details, or null if not found
 */
export async function getEmdById(id: number): Promise<EmdWithDetails | null> {
  const db = await requireDb();

  const [emd] = await db
    .select()
    .from(electronicMiscDocs)
    .where(eq(electronicMiscDocs.id, id))
    .limit(1);

  if (!emd) return null;

  return enrichEmdWithDetails(db, emd);
}

/**
 * List EMDs with filtering, sorting, and offset-based pagination.
 *
 * Supports filtering by airline, booking, passenger, status, type, and date range.
 * Returns results ordered by issuance date (newest first) with total count.
 *
 * @param filters - Optional filter and pagination parameters
 * @returns Object with data array and pagination metadata
 */
export async function listEmds(filters: ListEmdsFilters = {}) {
  const db = await requireDb();

  const page = Math.max(1, filters.page ?? 1);
  const limit = Math.min(100, Math.max(1, filters.limit ?? 20));
  const offset = (page - 1) * limit;

  // Build filter conditions
  const conditions = [];

  if (filters.airlineId) {
    conditions.push(eq(electronicMiscDocs.issuingAirlineId, filters.airlineId));
  }
  if (filters.bookingId) {
    conditions.push(eq(electronicMiscDocs.bookingId, filters.bookingId));
  }
  if (filters.passengerId) {
    conditions.push(eq(electronicMiscDocs.passengerId, filters.passengerId));
  }
  if (filters.status) {
    conditions.push(eq(electronicMiscDocs.status, filters.status));
  }
  if (filters.emdType) {
    conditions.push(eq(electronicMiscDocs.emdType, filters.emdType));
  }
  if (filters.dateFrom) {
    const from =
      filters.dateFrom instanceof Date
        ? filters.dateFrom
        : new Date(filters.dateFrom);
    conditions.push(gte(electronicMiscDocs.dateOfIssuance, from));
  }
  if (filters.dateTo) {
    const to =
      filters.dateTo instanceof Date
        ? filters.dateTo
        : new Date(filters.dateTo);
    conditions.push(lte(electronicMiscDocs.dateOfIssuance, to));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  // Run data fetch and count in parallel
  const [items, totalResult] = await Promise.all([
    db
      .select()
      .from(electronicMiscDocs)
      .where(whereClause)
      .orderBy(desc(electronicMiscDocs.dateOfIssuance))
      .limit(limit)
      .offset(offset),
    db.select({ total: count() }).from(electronicMiscDocs).where(whereClause),
  ]);

  const total = totalResult[0]?.total ?? 0;
  const totalPages = Math.ceil(total / limit);

  return {
    items,
    total,
    page,
    limit,
    totalPages,
    hasMore: page < totalPages,
  };
}

// ============================================================================
// Status Transition Operations
// ============================================================================

/**
 * Mark an EMD as used (service has been consumed).
 *
 * Only valid when the EMD is currently in "issued" status.
 * Also checks that the EMD has not expired.
 *
 * @param emdNumber - The 14-character EMD number
 * @returns The updated EMD record
 */
export async function useEmd(emdNumber: string): Promise<ElectronicMiscDoc> {
  const db = await requireDb();

  const [emd] = await db
    .select()
    .from(electronicMiscDocs)
    .where(eq(electronicMiscDocs.emdNumber, emdNumber))
    .limit(1);

  if (!emd) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: `EMD ${emdNumber} not found`,
    });
  }

  if (!validateEmdTransition(emd.status as EmdStatus, "used")) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Cannot mark EMD as used: current status is "${emd.status}". Only EMDs with status "issued" can be marked as used.`,
    });
  }

  // Check expiry
  if (emd.expiryDate && new Date(emd.expiryDate) < new Date()) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `EMD ${emdNumber} has expired and cannot be used`,
    });
  }

  await db
    .update(electronicMiscDocs)
    .set({
      status: "used",
      dateOfService: new Date(),
    })
    .where(eq(electronicMiscDocs.id, emd.id));

  const [updated] = await db
    .select()
    .from(electronicMiscDocs)
    .where(eq(electronicMiscDocs.id, emd.id))
    .limit(1);

  return updated;
}

/**
 * Void an EMD (cancel before use).
 *
 * Sets the status to "void" and records the void timestamp and reason.
 * Only valid from "issued" or "suspended" status.
 *
 * @param emdNumber - The 14-character EMD number
 * @param reason    - Reason for voiding the EMD
 * @returns The updated EMD record
 */
export async function voidEmd(
  emdNumber: string,
  reason: string
): Promise<ElectronicMiscDoc> {
  const db = await requireDb();

  const [emd] = await db
    .select()
    .from(electronicMiscDocs)
    .where(eq(electronicMiscDocs.emdNumber, emdNumber))
    .limit(1);

  if (!emd) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: `EMD ${emdNumber} not found`,
    });
  }

  if (!validateEmdTransition(emd.status as EmdStatus, "void")) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Cannot void EMD: current status is "${emd.status}". Only EMDs with status "issued" or "suspended" can be voided.`,
    });
  }

  if (!reason || reason.trim().length === 0) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "A void reason is required",
    });
  }

  await db
    .update(electronicMiscDocs)
    .set({
      status: "void",
      voidedAt: new Date(),
      voidReason: reason.trim(),
    })
    .where(eq(electronicMiscDocs.id, emd.id));

  const [updated] = await db
    .select()
    .from(electronicMiscDocs)
    .where(eq(electronicMiscDocs.id, emd.id))
    .limit(1);

  return updated;
}

/**
 * Exchange an EMD for a new one.
 *
 * Marks the original EMD as "exchanged" and issues a new EMD with the
 * `exchangedFromEmd` field referencing the original document number.
 * Properties not specified in newParams are inherited from the original EMD.
 *
 * @param emdNumber - The EMD number of the original document to exchange
 * @param newParams - Parameters for the replacement EMD (amount is required)
 * @returns Exchange result with both original and new EMD references
 */
export async function exchangeEmd(
  emdNumber: string,
  newParams: ExchangeEmdParams
): Promise<EmdExchangeResult> {
  const db = await requireDb();

  // Fetch the original EMD
  const [originalEmd] = await db
    .select()
    .from(electronicMiscDocs)
    .where(eq(electronicMiscDocs.emdNumber, emdNumber))
    .limit(1);

  if (!originalEmd) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: `EMD ${emdNumber} not found`,
    });
  }

  if (!validateEmdTransition(originalEmd.status as EmdStatus, "exchanged")) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Cannot exchange EMD: current status is "${originalEmd.status}". Only EMDs with status "issued" can be exchanged.`,
    });
  }

  if (newParams.amount <= 0) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "New EMD amount must be greater than zero",
    });
  }

  // Get airline code for EMD number generation
  const [airline] = await db
    .select({ code: airlines.code })
    .from(airlines)
    .where(eq(airlines.id, originalEmd.issuingAirlineId))
    .limit(1);

  const airlineCode = airline?.code ?? "000";

  // Mark the original EMD as exchanged
  await db
    .update(electronicMiscDocs)
    .set({
      status: "exchanged",
      voidedAt: new Date(),
      voidReason: "Exchanged for a new EMD",
    })
    .where(eq(electronicMiscDocs.id, originalEmd.id));

  // Issue the replacement EMD, inheriting properties from the original
  const newEmdNumber = await generateEmdNumber(airlineCode);

  const insertData: InsertElectronicMiscDoc = {
    emdNumber: newEmdNumber,
    emdType: newParams.emdType ?? originalEmd.emdType,
    bookingId: originalEmd.bookingId,
    passengerId: originalEmd.passengerId,
    ticketNumber: originalEmd.ticketNumber,
    issuingAirlineId: originalEmd.issuingAirlineId,
    issuingAgentId: originalEmd.issuingAgentId,
    iataNumber: originalEmd.iataNumber,
    reasonForIssuance:
      newParams.reasonForIssuance ?? originalEmd.reasonForIssuance,
    serviceDescription:
      newParams.serviceDescription ?? originalEmd.serviceDescription,
    rficCode:
      newParams.rficCode !== undefined
        ? newParams.rficCode
        : originalEmd.rficCode,
    rfiscCode:
      newParams.rfiscCode !== undefined
        ? newParams.rfiscCode
        : originalEmd.rfiscCode,
    amount: newParams.amount,
    currency: newParams.currency ?? originalEmd.currency,
    taxAmount: newParams.taxAmount ?? originalEmd.taxAmount,
    status: "issued",
    flightId:
      newParams.flightId !== undefined
        ? newParams.flightId
        : originalEmd.flightId,
    flightSegment:
      newParams.flightSegment !== undefined
        ? newParams.flightSegment
        : originalEmd.flightSegment,
    dateOfIssuance: new Date(),
    dateOfService: toDateOrNull(newParams.dateOfService),
    expiryDate:
      newParams.expiryDate !== undefined
        ? toDateOrNull(newParams.expiryDate)
        : originalEmd.expiryDate,
    exchangedFromEmd: emdNumber,
  };

  const [result] = await db.insert(electronicMiscDocs).values(insertData);
  const insertId =
    (result as unknown as { insertId: number }).insertId ||
    (result as unknown as Array<{ insertId: number }>)[0]?.insertId;

  return {
    originalEmdNumber: emdNumber,
    originalStatus: "exchanged",
    newEmdNumber,
    newEmdId: insertId,
    amountDifference: newParams.amount - originalEmd.amount,
  };
}

/**
 * Refund an EMD (full or partial).
 *
 * When no refundAmount is specified, a full refund of the original amount is
 * processed. For partial refunds, the tax portion is prorated proportionally.
 *
 * Only valid from "issued" or "suspended" status.
 *
 * @param emdNumber    - The 14-character EMD number
 * @param refundAmount - Optional partial refund amount in SAR cents (base amount,
 *                       excluding tax). If omitted, a full refund is processed.
 * @returns Refund summary with amounts
 */
export async function refundEmd(
  emdNumber: string,
  refundAmount?: number
): Promise<EmdRefundResult> {
  const db = await requireDb();

  const [emd] = await db
    .select()
    .from(electronicMiscDocs)
    .where(eq(electronicMiscDocs.emdNumber, emdNumber))
    .limit(1);

  if (!emd) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: `EMD ${emdNumber} not found`,
    });
  }

  if (!validateEmdTransition(emd.status as EmdStatus, "refunded")) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Cannot refund EMD: current status is "${emd.status}". Only EMDs with status "issued" or "suspended" can be refunded.`,
    });
  }

  // Determine the refund base amount
  const isFullRefund =
    refundAmount === undefined ||
    refundAmount === null ||
    refundAmount >= emd.amount;
  const baseRefund = isFullRefund ? emd.amount : refundAmount;

  if (baseRefund <= 0) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Refund amount must be greater than zero",
    });
  }

  if (baseRefund > emd.amount) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Refund amount (${baseRefund}) cannot exceed the original EMD amount (${emd.amount})`,
    });
  }

  // Prorate tax refund proportionally
  const taxRefund =
    emd.amount > 0 ? Math.round((baseRefund / emd.amount) * emd.taxAmount) : 0;

  const totalRefund = baseRefund + taxRefund;

  await db
    .update(electronicMiscDocs)
    .set({
      status: "refunded",
      voidedAt: new Date(),
      voidReason: isFullRefund
        ? "Full refund processed"
        : `Partial refund: ${baseRefund} of ${emd.amount} SAR cents`,
    })
    .where(eq(electronicMiscDocs.id, emd.id));

  return {
    emdNumber: emd.emdNumber,
    originalAmount: emd.amount,
    refundAmount: baseRefund,
    taxRefund,
    totalRefund,
    isPartialRefund: !isFullRefund,
    status: "refunded",
  };
}

// ============================================================================
// Lookup Queries
// ============================================================================

/**
 * Get all EMDs associated with a specific booking.
 *
 * @param bookingId - The booking ID
 * @returns Array of EMD records for the booking, ordered by issuance date (newest first)
 */
export async function getEmdsByBooking(
  bookingId: number
): Promise<ElectronicMiscDoc[]> {
  const db = await requireDb();

  return await db
    .select()
    .from(electronicMiscDocs)
    .where(eq(electronicMiscDocs.bookingId, bookingId))
    .orderBy(desc(electronicMiscDocs.dateOfIssuance));
}

/**
 * Get all EMDs associated with a specific passenger.
 *
 * @param passengerId - The passenger ID
 * @returns Array of EMD records for the passenger, ordered by issuance date (newest first)
 */
export async function getEmdsByPassenger(
  passengerId: number
): Promise<ElectronicMiscDoc[]> {
  const db = await requireDb();

  return await db
    .select()
    .from(electronicMiscDocs)
    .where(eq(electronicMiscDocs.passengerId, passengerId))
    .orderBy(desc(electronicMiscDocs.dateOfIssuance));
}

// ============================================================================
// Statistics & Reporting
// ============================================================================

/**
 * Get EMD statistics for an airline within an optional date range.
 *
 * Returns aggregate counts by EMD type, status, and reason for issuance,
 * along with revenue totals (amount + tax) and the average document amount.
 *
 * @param airlineId - The issuing airline ID
 * @param dateRange - Optional date range to scope the statistics
 * @returns Aggregated EMD statistics
 */
export async function getEmdStatistics(
  airlineId: number,
  dateRange?: EmdDateRange
): Promise<EmdStatistics> {
  const db = await requireDb();

  // Build base conditions
  const conditions = [eq(electronicMiscDocs.issuingAirlineId, airlineId)];

  const fromDate = dateRange ? toDateOrNull(dateRange.from) : null;
  const toDate = dateRange ? toDateOrNull(dateRange.to) : null;

  if (fromDate) {
    conditions.push(gte(electronicMiscDocs.dateOfIssuance, fromDate));
  }
  if (toDate) {
    conditions.push(lte(electronicMiscDocs.dateOfIssuance, toDate));
  }

  const whereClause = and(...conditions);

  // Run all aggregation queries in parallel for performance
  const [totalsResult, statusRows, typeRows, reasonRows] = await Promise.all([
    // Overall totals
    db
      .select({
        totalCount: count(),
        totalAmount: sql<number>`COALESCE(SUM(${electronicMiscDocs.amount}), 0)`,
        totalTax: sql<number>`COALESCE(SUM(${electronicMiscDocs.taxAmount}), 0)`,
        averageAmount: sql<number>`COALESCE(AVG(${electronicMiscDocs.amount}), 0)`,
      })
      .from(electronicMiscDocs)
      .where(whereClause),

    // Count by status
    db
      .select({
        status: electronicMiscDocs.status,
        count: count(),
        totalAmount: sql<number>`COALESCE(SUM(${electronicMiscDocs.amount}), 0)`,
      })
      .from(electronicMiscDocs)
      .where(whereClause)
      .groupBy(electronicMiscDocs.status),

    // Count by type
    db
      .select({
        emdType: electronicMiscDocs.emdType,
        count: count(),
        totalAmount: sql<number>`COALESCE(SUM(${electronicMiscDocs.amount}), 0)`,
      })
      .from(electronicMiscDocs)
      .where(whereClause)
      .groupBy(electronicMiscDocs.emdType),

    // Count by reason for issuance
    db
      .select({
        reason: electronicMiscDocs.reasonForIssuance,
        count: count(),
        totalAmount: sql<number>`COALESCE(SUM(${electronicMiscDocs.amount}), 0)`,
      })
      .from(electronicMiscDocs)
      .where(whereClause)
      .groupBy(electronicMiscDocs.reasonForIssuance),
  ]);

  const totals = totalsResult[0];

  return {
    airlineId,
    period: {
      from: fromDate ? fromDate.toISOString() : null,
      to: toDate ? toDate.toISOString() : null,
    },
    totals: {
      count: Number(totals?.totalCount ?? 0),
      amount: Number(totals?.totalAmount ?? 0),
      taxAmount: Number(totals?.totalTax ?? 0),
      averageAmount: Math.round(Number(totals?.averageAmount ?? 0)),
    },
    byStatus: statusRows.map(row => ({
      status: row.status,
      count: Number(row.count),
      totalAmount: Number(row.totalAmount),
    })),
    byType: typeRows.map(row => ({
      emdType: row.emdType,
      count: Number(row.count),
      totalAmount: Number(row.totalAmount),
    })),
    byReason: reasonRows.map(row => ({
      reason: row.reason,
      count: Number(row.count),
      totalAmount: Number(row.totalAmount),
    })),
  };
}
