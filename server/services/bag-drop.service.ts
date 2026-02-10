import { TRPCError } from "@trpc/server";
import { eq, and } from "drizzle-orm";
import { getDb } from "../db";
import { bookings, passengers, flights, airports } from "../../drizzle/schema";

// ============================================================================
// Automated Bag Drop Service
// Self-service bag drop kiosk operations: weigh, tag, pay excess, and confirm
// ============================================================================

// ─── Inline Schema Types ────────────────────────────────────────────────────

/** Bag drop unit hardware status */
export type BagDropUnitStatus = "online" | "offline" | "jam" | "maintenance";

/** Bag drop session status */
export type BagDropSessionStatus =
  | "started"
  | "weighing"
  | "payment"
  | "printing"
  | "complete"
  | "error"
  | "timeout";

/** Bag drop session payment status */
export type BagDropPaymentStatus = "none" | "pending" | "paid";

/** Bag tag tracking status */
export type BagTagStatus =
  | "printed"
  | "attached"
  | "loaded"
  | "transferred"
  | "arrived"
  | "lost";

/** Bag drop unit definition */
export interface BagDropUnit {
  id: number;
  unitCode: string;
  airportId: number;
  terminal: string;
  zone: string;
  status: BagDropUnitStatus;
  hasPrinter: boolean;
  hasScale: boolean;
  hasPayment: boolean;
  beltConnected: boolean;
  lastMaintenance: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Bag drop session record */
export interface BagDropSession {
  id: number;
  unitId: number;
  bookingId: number;
  passengerId: number;
  totalBags: number;
  totalWeight: number; // grams
  allowanceWeight: number; // grams
  excessWeight: number; // grams
  excessFee: number; // SAR cents
  paymentStatus: BagDropPaymentStatus;
  status: BagDropSessionStatus;
  startedAt: Date;
  completedAt: Date | null;
  errorMessage: string | null;
  createdAt: Date;
}

/** Bag tag record */
export interface BagTag {
  id: number;
  sessionId: number;
  bagNumber: number;
  tagNumber: string; // varchar 10
  weight: number; // grams
  destination: string;
  connectionTags: string[] | null; // JSON array of tag numbers for connections
  printedAt: Date | null;
  status: BagTagStatus;
  createdAt: Date;
}

// ─── Constants ──────────────────────────────────────────────────────────────

/** Default baggage allowance by cabin class (in grams) */
const CABIN_ALLOWANCE_GRAMS: Record<string, number> = {
  economy: 23000, // 23 kg
  business: 32000, // 32 kg
};

/** Maximum single bag weight in grams */
const MAX_BAG_WEIGHT_GRAMS = 32000; // 32 kg

/** Excess baggage fee per kilogram in SAR cents */
const EXCESS_FEE_PER_KG_CENTS = 5000; // 50 SAR per kg

/** Session timeout in milliseconds (10 minutes) */
const SESSION_TIMEOUT_MS = 10 * 60 * 1000;

// ─── In-memory stores (production would use DB tables) ──────────────────────

let _unitIdSeq = 0;
let _sessionIdSeq = 0;
let _tagIdSeq = 0;

const bagDropUnits: Map<number, BagDropUnit> = new Map();
const bagDropSessions: Map<number, BagDropSession> = new Map();
const bagTags: Map<number, BagTag> = new Map();

// ─── Helper Functions ───────────────────────────────────────────────────────

/**
 * Generate a unique 10-character bag tag number.
 * Format: BD + 8 alphanumeric characters (e.g., "BD4A7K29XN")
 */
function generateTagNumber(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let tag = "BD";
  for (let i = 0; i < 8; i++) {
    tag += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return tag;
}

/**
 * Ensure the tag number is unique within existing tags.
 */
function generateUniqueTagNumber(): string {
  const existingTags = new Set<string>();
  for (const tag of bagTags.values()) {
    existingTags.add(tag.tagNumber);
  }
  let tagNumber = generateTagNumber();
  let attempts = 0;
  while (existingTags.has(tagNumber) && attempts < 20) {
    tagNumber = generateTagNumber();
    attempts++;
  }
  if (attempts >= 20) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to generate unique bag tag number",
    });
  }
  return tagNumber;
}

/**
 * Look up a session and validate it is not timed-out or completed.
 */
function getActiveSession(sessionId: number): BagDropSession {
  const session = bagDropSessions.get(sessionId);
  if (!session) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Bag drop session not found",
    });
  }

  if (session.status === "complete") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Session already completed",
    });
  }

  if (session.status === "error") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Session in error state: ${session.errorMessage}`,
    });
  }

  // Check for timeout
  const elapsed = Date.now() - session.startedAt.getTime();
  if (elapsed > SESSION_TIMEOUT_MS) {
    session.status = "timeout";
    session.errorMessage = "Session timed out after 10 minutes";
    bagDropSessions.set(sessionId, session);
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Session timed out. Please start a new bag drop session.",
    });
  }

  return session;
}

// ─── Service Functions ──────────────────────────────────────────────────────

/**
 * Initiate a bag drop session for a booking and passenger.
 * Validates the booking exists and is confirmed, passenger belongs to booking.
 */
export async function initiateBagDrop(
  bookingId: number,
  passengerId: number
): Promise<BagDropSession> {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  // Validate booking exists and is confirmed
  const [booking] = await db
    .select()
    .from(bookings)
    .where(eq(bookings.id, bookingId))
    .limit(1);

  if (!booking) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Booking not found",
    });
  }

  if (booking.status !== "confirmed") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Booking is not confirmed (status: ${booking.status})`,
    });
  }

  // Validate passenger belongs to booking
  const [passenger] = await db
    .select()
    .from(passengers)
    .where(
      and(eq(passengers.id, passengerId), eq(passengers.bookingId, bookingId))
    )
    .limit(1);

  if (!passenger) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Passenger not found or does not belong to this booking",
    });
  }

  // Check for active sessions for this passenger
  for (const session of bagDropSessions.values()) {
    if (
      session.passengerId === passengerId &&
      session.bookingId === bookingId &&
      session.status !== "complete" &&
      session.status !== "error" &&
      session.status !== "timeout"
    ) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message:
          "An active bag drop session already exists for this passenger. Please complete or cancel it first.",
      });
    }
  }

  // Determine allowance based on cabin class
  const allowanceWeight =
    CABIN_ALLOWANCE_GRAMS[booking.cabinClass] ?? CABIN_ALLOWANCE_GRAMS.economy;

  // Create session
  const sessionId = ++_sessionIdSeq;
  const now = new Date();

  const session: BagDropSession = {
    id: sessionId,
    unitId: 0, // Will be assigned when a unit is available
    bookingId,
    passengerId,
    totalBags: 0,
    totalWeight: 0,
    allowanceWeight,
    excessWeight: 0,
    excessFee: 0,
    paymentStatus: "none",
    status: "started",
    startedAt: now,
    completedAt: null,
    errorMessage: null,
    createdAt: now,
  };

  bagDropSessions.set(sessionId, session);

  return session;
}

/**
 * Scan a boarding pass barcode to identify the passenger.
 * Barcode format assumed: PNR-PASSENGER_ID (e.g., "ABC123-5")
 */
export async function scanBoardingPass(barcode: string): Promise<{
  bookingId: number;
  passengerId: number;
  passengerName: string;
  flightNumber: string;
  destination: string;
  cabinClass: string;
}> {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  if (!barcode || barcode.trim().length === 0) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Invalid barcode: barcode cannot be empty",
    });
  }

  // Parse barcode (PNR-PASSENGER_ID format)
  const parts = barcode.split("-");
  if (parts.length < 2) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Invalid barcode format. Expected PNR-PASSENGER_ID.",
    });
  }

  const pnr = parts[0];
  const passengerIdStr = parts[1];
  const passengerId = parseInt(passengerIdStr, 10);

  if (isNaN(passengerId)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Invalid passenger ID in barcode",
    });
  }

  // Look up booking by PNR
  const [booking] = await db
    .select()
    .from(bookings)
    .where(eq(bookings.pnr, pnr))
    .limit(1);

  if (!booking) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Booking not found for the scanned boarding pass",
    });
  }

  // Validate passenger belongs to this booking
  const [passenger] = await db
    .select()
    .from(passengers)
    .where(
      and(eq(passengers.id, passengerId), eq(passengers.bookingId, booking.id))
    )
    .limit(1);

  if (!passenger) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Passenger not found for this booking",
    });
  }

  // Get flight details for destination
  const [flight] = await db
    .select({
      flightNumber: flights.flightNumber,
      destinationId: flights.destinationId,
    })
    .from(flights)
    .where(eq(flights.id, booking.flightId))
    .limit(1);

  let destinationCode = "N/A";
  if (flight) {
    const [destAirport] = await db
      .select({ code: airports.code })
      .from(airports)
      .where(eq(airports.id, flight.destinationId))
      .limit(1);
    if (destAirport) {
      destinationCode = destAirport.code;
    }
  }

  return {
    bookingId: booking.id,
    passengerId: passenger.id,
    passengerName: `${passenger.firstName} ${passenger.lastName}`,
    flightNumber: flight?.flightNumber ?? "N/A",
    destination: destinationCode,
    cabinClass: booking.cabinClass,
  };
}

/**
 * Record a bag weight for an active session.
 * Validates weight limits and updates session totals.
 */
export function weighBag(
  sessionId: number,
  weight: number
): {
  session: BagDropSession;
  bagNumber: number;
  weightGrams: number;
  withinAllowance: boolean;
} {
  const session = getActiveSession(sessionId);

  if (weight <= 0) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Weight must be greater than 0 grams",
    });
  }

  if (weight > MAX_BAG_WEIGHT_GRAMS) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Single bag weight (${(weight / 1000).toFixed(1)} kg) exceeds maximum limit of ${MAX_BAG_WEIGHT_GRAMS / 1000} kg`,
    });
  }

  // Update session
  session.totalBags += 1;
  session.totalWeight += weight;
  session.status = "weighing";

  // Calculate excess
  const excess = Math.max(0, session.totalWeight - session.allowanceWeight);
  session.excessWeight = excess;

  if (excess > 0) {
    const excessKg = Math.ceil(excess / 1000); // Round up to next kg
    session.excessFee = excessKg * EXCESS_FEE_PER_KG_CENTS;
    session.paymentStatus = "pending";
  }

  bagDropSessions.set(sessionId, session);

  const withinAllowance = session.totalWeight <= session.allowanceWeight;

  return {
    session,
    bagNumber: session.totalBags,
    weightGrams: weight,
    withinAllowance,
  };
}

/**
 * Check the baggage allowance for a booking and passenger.
 * Returns allowance details based on cabin class and any purchased extras.
 */
export async function checkBagAllowance(
  bookingId: number,
  passengerId: number
): Promise<{
  allowanceWeightGrams: number;
  cabinClass: string;
  maxBagWeightGrams: number;
  excessFeePerKgCents: number;
}> {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  // Validate booking
  const [booking] = await db
    .select()
    .from(bookings)
    .where(eq(bookings.id, bookingId))
    .limit(1);

  if (!booking) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Booking not found",
    });
  }

  // Validate passenger belongs to booking
  const [passenger] = await db
    .select()
    .from(passengers)
    .where(
      and(eq(passengers.id, passengerId), eq(passengers.bookingId, bookingId))
    )
    .limit(1);

  if (!passenger) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Passenger not found or does not belong to this booking",
    });
  }

  const allowanceWeight =
    CABIN_ALLOWANCE_GRAMS[booking.cabinClass] ?? CABIN_ALLOWANCE_GRAMS.economy;

  return {
    allowanceWeightGrams: allowanceWeight,
    cabinClass: booking.cabinClass,
    maxBagWeightGrams: MAX_BAG_WEIGHT_GRAMS,
    excessFeePerKgCents: EXCESS_FEE_PER_KG_CENTS,
  };
}

/**
 * Calculate the excess baggage fee for a given total weight.
 * Returns 0 if within allowance.
 */
export async function calculateExcessFee(
  bookingId: number,
  totalWeight: number
): Promise<{
  allowanceWeightGrams: number;
  totalWeightGrams: number;
  excessWeightGrams: number;
  excessFeeCents: number;
  currency: string;
}> {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  // Get booking for cabin class
  const [booking] = await db
    .select()
    .from(bookings)
    .where(eq(bookings.id, bookingId))
    .limit(1);

  if (!booking) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Booking not found",
    });
  }

  const allowanceWeight =
    CABIN_ALLOWANCE_GRAMS[booking.cabinClass] ?? CABIN_ALLOWANCE_GRAMS.economy;

  const excessWeight = Math.max(0, totalWeight - allowanceWeight);
  const excessKg = Math.ceil(excessWeight / 1000);
  const excessFee = excessKg * EXCESS_FEE_PER_KG_CENTS;

  return {
    allowanceWeightGrams: allowanceWeight,
    totalWeightGrams: totalWeight,
    excessWeightGrams: excessWeight,
    excessFeeCents: excessFee,
    currency: "SAR",
  };
}

/**
 * Process payment for excess baggage on a bag drop session.
 * In production this would integrate with Stripe or another payment gateway.
 */
export function processPayment(
  sessionId: number,
  amount: number
): {
  session: BagDropSession;
  paymentConfirmed: boolean;
  transactionId: string;
} {
  const session = getActiveSession(sessionId);

  if (session.excessFee === 0) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "No excess fee to pay. Baggage is within allowance.",
    });
  }

  if (amount < session.excessFee) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Insufficient payment amount. Required: ${session.excessFee} SAR cents, provided: ${amount} SAR cents.`,
    });
  }

  // Simulate payment processing (in production, integrate with Stripe)
  const transactionId = `BD-TXN-${Date.now()}-${sessionId}`;

  session.paymentStatus = "paid";
  session.status = "payment";
  bagDropSessions.set(sessionId, session);

  return {
    session,
    paymentConfirmed: true,
    transactionId,
  };
}

/**
 * Print a bag tag for a specific bag in the session.
 * Returns the generated tag details.
 */
export async function printBagTag(
  sessionId: number,
  bagNumber: number
): Promise<BagTag> {
  const session = getActiveSession(sessionId);

  if (bagNumber < 1 || bagNumber > session.totalBags) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Invalid bag number. Session has ${session.totalBags} bag(s). Requested bag #${bagNumber}.`,
    });
  }

  // Check if excess fee needs to be paid first
  if (session.excessFee > 0 && session.paymentStatus !== "paid") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "Excess baggage fee must be paid before printing tags. Please process payment first.",
    });
  }

  // Check if tag already printed for this bag number in this session
  for (const tag of bagTags.values()) {
    if (tag.sessionId === sessionId && tag.bagNumber === bagNumber) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Tag already printed for bag #${bagNumber} in this session`,
      });
    }
  }

  // Get destination from booking
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  let destination = "N/A";
  const [booking] = await db
    .select()
    .from(bookings)
    .where(eq(bookings.id, session.bookingId))
    .limit(1);

  if (booking) {
    const [flight] = await db
      .select({ destinationId: flights.destinationId })
      .from(flights)
      .where(eq(flights.id, booking.flightId))
      .limit(1);

    if (flight) {
      const [destAirport] = await db
        .select({ code: airports.code })
        .from(airports)
        .where(eq(airports.id, flight.destinationId))
        .limit(1);
      if (destAirport) {
        destination = destAirport.code;
      }
    }
  }

  // Estimate bag weight (distribute total evenly if individual weights not stored)
  const bagWeight = Math.round(session.totalWeight / session.totalBags);

  const tagId = ++_tagIdSeq;
  const tagNumber = generateUniqueTagNumber();
  const now = new Date();

  const tag: BagTag = {
    id: tagId,
    sessionId,
    bagNumber,
    tagNumber,
    weight: bagWeight,
    destination,
    connectionTags: null,
    printedAt: now,
    status: "printed",
    createdAt: now,
  };

  bagTags.set(tagId, tag);

  // Update session status to printing
  session.status = "printing";
  bagDropSessions.set(sessionId, session);

  return tag;
}

/**
 * Confirm that all bags have been dropped onto the belt.
 * Marks the session as complete.
 */
export function confirmBagDrop(sessionId: number): {
  session: BagDropSession;
  tags: BagTag[];
} {
  const session = getActiveSession(sessionId);

  if (session.totalBags === 0) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "No bags have been weighed in this session",
    });
  }

  // Check that excess fee has been paid if applicable
  if (session.excessFee > 0 && session.paymentStatus !== "paid") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Excess baggage fee must be paid before confirming bag drop",
    });
  }

  // Collect all tags for this session
  const sessionTags: BagTag[] = [];
  for (const tag of bagTags.values()) {
    if (tag.sessionId === sessionId) {
      sessionTags.push(tag);
    }
  }

  // Verify all bags have printed tags
  if (sessionTags.length < session.totalBags) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Not all bags have tags printed. ${sessionTags.length}/${session.totalBags} tags printed.`,
    });
  }

  // Mark all tags as attached (accepted to belt)
  for (const tag of sessionTags) {
    tag.status = "attached";
    bagTags.set(tag.id, tag);
  }

  // Complete session
  session.status = "complete";
  session.completedAt = new Date();
  bagDropSessions.set(sessionId, session);

  return {
    session,
    tags: sessionTags,
  };
}

/**
 * Get the health/status of a bag drop unit.
 * Returns the unit details and its current operational state.
 */
export function getBagDropStatus(unitId: number): {
  unit: BagDropUnit;
  activeSessions: number;
  isOperational: boolean;
} {
  const unit = bagDropUnits.get(unitId);
  if (!unit) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: `Bag drop unit #${unitId} not found`,
    });
  }

  // Count active sessions for this unit
  let activeSessions = 0;
  for (const session of bagDropSessions.values()) {
    if (
      session.unitId === unitId &&
      session.status !== "complete" &&
      session.status !== "error" &&
      session.status !== "timeout"
    ) {
      activeSessions++;
    }
  }

  const isOperational =
    unit.status === "online" &&
    unit.hasPrinter &&
    unit.hasScale &&
    unit.beltConnected;

  return {
    unit,
    activeSessions,
    isOperational,
  };
}

/**
 * Get analytics and performance stats for bag drop units at an airport.
 */
export function getBagDropAnalytics(
  airportId: number,
  dateRange: { start: Date; end: Date }
): {
  airportId: number;
  period: { start: Date; end: Date };
  totalSessions: number;
  completedSessions: number;
  errorSessions: number;
  timeoutSessions: number;
  averageSessionDurationMs: number;
  totalBagsProcessed: number;
  totalWeightGrams: number;
  totalExcessFeeCents: number;
  units: Array<{
    unitId: number;
    unitCode: string;
    status: BagDropUnitStatus;
    sessionsProcessed: number;
  }>;
} {
  const { start, end } = dateRange;

  // Get units for this airport
  const airportUnits: BagDropUnit[] = [];
  for (const unit of bagDropUnits.values()) {
    if (unit.airportId === airportId) {
      airportUnits.push(unit);
    }
  }

  const unitIds = new Set(airportUnits.map(u => u.id));

  // Aggregate session data
  let totalSessions = 0;
  let completedSessions = 0;
  let errorSessions = 0;
  let timeoutSessions = 0;
  let totalDurationMs = 0;
  let completedDurationCount = 0;
  let totalBagsProcessed = 0;
  let totalWeightGrams = 0;
  let totalExcessFeeCents = 0;

  const unitSessionCounts = new Map<number, number>();
  for (const unitId of unitIds) {
    unitSessionCounts.set(unitId, 0);
  }

  for (const session of bagDropSessions.values()) {
    if (!unitIds.has(session.unitId)) continue;

    const sessionTime = session.startedAt.getTime();
    if (sessionTime < start.getTime() || sessionTime > end.getTime()) continue;

    totalSessions++;

    switch (session.status) {
      case "complete":
        completedSessions++;
        if (session.completedAt) {
          totalDurationMs +=
            session.completedAt.getTime() - session.startedAt.getTime();
          completedDurationCount++;
        }
        break;
      case "error":
        errorSessions++;
        break;
      case "timeout":
        timeoutSessions++;
        break;
    }

    totalBagsProcessed += session.totalBags;
    totalWeightGrams += session.totalWeight;
    totalExcessFeeCents += session.excessFee;

    const count = unitSessionCounts.get(session.unitId) ?? 0;
    unitSessionCounts.set(session.unitId, count + 1);
  }

  const averageSessionDurationMs =
    completedDurationCount > 0
      ? Math.round(totalDurationMs / completedDurationCount)
      : 0;

  const units = airportUnits.map(unit => ({
    unitId: unit.id,
    unitCode: unit.unitCode,
    status: unit.status,
    sessionsProcessed: unitSessionCounts.get(unit.id) ?? 0,
  }));

  return {
    airportId,
    period: { start, end },
    totalSessions,
    completedSessions,
    errorSessions,
    timeoutSessions,
    averageSessionDurationMs,
    totalBagsProcessed,
    totalWeightGrams,
    totalExcessFeeCents,
    units,
  };
}

// ─── Admin Helpers ──────────────────────────────────────────────────────────

/**
 * Get all bag drop units, optionally filtered by airport.
 */
export function getAllBagDropUnits(airportId?: number): BagDropUnit[] {
  const allUnits: BagDropUnit[] = [];
  for (const unit of bagDropUnits.values()) {
    if (airportId !== undefined && unit.airportId !== airportId) continue;
    allUnits.push(unit);
  }
  return allUnits.sort((a, b) => a.id - b.id);
}

/**
 * Register a new bag drop unit (admin utility).
 */
export function registerBagDropUnit(data: {
  unitCode: string;
  airportId: number;
  terminal: string;
  zone: string;
  hasPrinter?: boolean;
  hasScale?: boolean;
  hasPayment?: boolean;
  beltConnected?: boolean;
}): BagDropUnit {
  // Validate uniqueness of unit code
  for (const unit of bagDropUnits.values()) {
    if (unit.unitCode === data.unitCode) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Unit code "${data.unitCode}" is already in use`,
      });
    }
  }

  const unitId = ++_unitIdSeq;
  const now = new Date();

  const unit: BagDropUnit = {
    id: unitId,
    unitCode: data.unitCode,
    airportId: data.airportId,
    terminal: data.terminal,
    zone: data.zone,
    status: "online",
    hasPrinter: data.hasPrinter ?? true,
    hasScale: data.hasScale ?? true,
    hasPayment: data.hasPayment ?? true,
    beltConnected: data.beltConnected ?? true,
    lastMaintenance: null,
    createdAt: now,
    updatedAt: now,
  };

  bagDropUnits.set(unitId, unit);
  return unit;
}
