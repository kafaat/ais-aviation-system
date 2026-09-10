import { randomInt } from "node:crypto";
import type { SettlementTx } from "./booking-settlement.service";
import { requireDemoCapability } from "./demo-capability";
import { TRPCError } from "@trpc/server";
import { eq, and, inArray, gt, lt, asc, gte, lte, sql } from "drizzle-orm";
import { getDb } from "../db";
import {
  bookings,
  passengers,
  flights,
  airports,
  bagDropUnits as unitsTable,
  bagDropSessions as sessionsTable,
  bagDropTags as tagsTable,
} from "../../drizzle/schema";

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
  bagWeights: number[];
  version: number;
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

/** Maximum number of bags per session */
const MAX_BAGS_PER_SESSION = 10;

/** Session timeout in milliseconds (10 minutes) */
const SESSION_TIMEOUT_MS = 10 * 60 * 1000;

async function requireDb() {
  const db = await getDb();
  if (!db) throw new Error("Bag drop database unavailable");
  return db;
}
async function getActiveSession(
  tx: SettlementTx,
  sessionId: number,
  allowComplete = false
) {
  const [session] = await tx
    .select()
    .from(sessionsTable)
    .where(eq(sessionsTable.id, sessionId))
    .limit(1)
    .for("update");
  if (!session)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Bag drop session not found",
    });
  if (allowComplete && session.status === "complete") return session;
  if (
    ["complete", "error", "timeout"].includes(session.status) ||
    Date.now() - session.startedAt.getTime() > SESSION_TIMEOUT_MS
  )
    throw new TRPCError({
      code: "CONFLICT",
      message: "Bag drop session is terminal or expired",
    });
  return session;
}
async function saveSession(
  tx: SettlementTx,
  session: typeof sessionsTable.$inferSelect
) {
  const { id, version, ...changes } = session;
  const [result] = await tx
    .update(sessionsTable)
    .set({ ...changes, version: version + 1 })
    .where(and(eq(sessionsTable.id, id), eq(sessionsTable.version, version)));
  if (result.affectedRows !== 1)
    throw new TRPCError({
      code: "CONFLICT",
      message: "Bag drop session changed",
    });
  return { ...session, version: version + 1 };
}

export async function initiateBagDrop(
  bookingId: number,
  passengerId: number
): Promise<BagDropSession> {
  if (
    !Number.isSafeInteger(bookingId) ||
    bookingId <= 0 ||
    !Number.isSafeInteger(passengerId) ||
    passengerId <= 0
  )
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Valid booking and passenger identifiers are required",
    });
  const db = await requireDb();
  return db.transaction(async tx => {
    const [booking] = await tx
      .select()
      .from(bookings)
      .where(eq(bookings.id, bookingId))
      .limit(1)
      .for("update");
    if (!booking || booking.status !== "confirmed")
      throw new TRPCError({
        code: "CONFLICT",
        message: "A confirmed booking is required",
      });
    const [passenger] = await tx
      .select()
      .from(passengers)
      .where(
        and(eq(passengers.id, passengerId), eq(passengers.bookingId, bookingId))
      )
      .limit(1);
    if (!passenger)
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Passenger does not belong to booking",
      });
    const [existing] = await tx
      .select()
      .from(sessionsTable)
      .where(
        and(
          eq(sessionsTable.bookingId, bookingId),
          eq(sessionsTable.passengerId, passengerId),
          inArray(sessionsTable.status, [
            "started",
            "weighing",
            "payment",
            "printing",
          ]),
          gt(sessionsTable.startedAt, new Date(Date.now() - SESSION_TIMEOUT_MS))
        )
      )
      .limit(1)
      .for("update");
    if (existing) return existing; // Retrying admission never creates a second active session.
    const [created] = await tx.insert(sessionsTable).values({
      bookingId,
      passengerId,
      bagWeights: [],
      allowanceWeight:
        CABIN_ALLOWANCE_GRAMS[booking.cabinClass] ??
        CABIN_ALLOWANCE_GRAMS.economy,
    });
    const [session] = await tx
      .select()
      .from(sessionsTable)
      .where(eq(sessionsTable.id, created.insertId))
      .limit(1);
    return session;
  });
}

export async function weighBag(
  sessionId: number,
  weight: number,
  bagNumber?: number
) {
  requireDemoCapability("Bag-drop scale measurement");
  if (
    !Number.isSafeInteger(weight) ||
    weight <= 0 ||
    weight > MAX_BAG_WEIGHT_GRAMS
  )
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Invalid individual bag weight",
    });
  const db = await requireDb();
  return db.transaction(async tx => {
    const session = await getActiveSession(tx, sessionId);
    const number = bagNumber ?? session.totalBags + 1;
    if (number <= session.totalBags) {
      if (session.bagWeights[number - 1] !== weight)
        throw new TRPCError({
          code: "CONFLICT",
          message: "Bag measurement changed; operator review required",
        });
      return {
        session,
        bagNumber: number,
        weightGrams: weight,
        withinAllowance: session.totalWeight <= session.allowanceWeight,
      };
    }
    if (
      number !== session.totalBags + 1 ||
      number > MAX_BAGS_PER_SESSION ||
      !["started", "weighing"].includes(session.status)
    )
      throw new TRPCError({
        code: "CONFLICT",
        message: "Bag weighing sequence is invalid",
      });
    session.bagWeights = [...session.bagWeights, weight];
    session.totalBags++;
    session.totalWeight += weight;
    session.status = "weighing";
    session.excessWeight = Math.max(
      0,
      session.totalWeight - session.allowanceWeight
    );
    session.excessFee =
      Math.ceil(session.excessWeight / 1000) * EXCESS_FEE_PER_KG_CENTS;
    session.paymentStatus = session.excessFee > 0 ? "pending" : "none";
    return {
      session: await saveSession(tx, session),
      bagNumber: number,
      weightGrams: weight,
      withinAllowance: session.totalWeight <= session.allowanceWeight,
    };
  });
}

/** Only verified PSP settlement may authorize excess baggage payment. */
export function processPayment(_sessionId: number, _amount: number): never {
  throw new TRPCError({
    code: "PRECONDITION_FAILED",
    message: "Verified excess-baggage payment adapter is not installed",
  });
}

export async function printBagTag(
  sessionId: number,
  bagNumber: number
): Promise<BagTag> {
  requireDemoCapability("Bag-tag printer");
  const db = await requireDb();
  return db.transaction(async tx => {
    const session = await getActiveSession(tx, sessionId);
    if (
      !Number.isSafeInteger(bagNumber) ||
      bagNumber < 1 ||
      bagNumber > session.totalBags
    )
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Bag has not been weighed",
      });
    if (session.excessFee > 0 && session.paymentStatus !== "paid")
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Excess baggage has not been paid",
      });
    const [existing] = await tx
      .select()
      .from(tagsTable)
      .where(
        and(
          eq(tagsTable.sessionId, sessionId),
          eq(tagsTable.bagNumber, bagNumber)
        )
      )
      .limit(1);
    if (existing) return existing;
    const [booking] = await tx
      .select()
      .from(bookings)
      .where(eq(bookings.id, session.bookingId))
      .limit(1);
    const [flight] = await tx
      .select()
      .from(flights)
      .where(eq(flights.id, booking.flightId))
      .limit(1);
    const [airport] = await tx
      .select()
      .from(airports)
      .where(eq(airports.id, flight.destinationId))
      .limit(1);
    if (!airport)
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Bag destination unavailable",
      });
    const [created] = await tx.insert(tagsTable).values({
      sessionId,
      bagNumber,
      tagNumber: `BD${String(randomInt(100000000)).padStart(8, "0")}`,
      weight: session.bagWeights[bagNumber - 1],
      destination: airport.code,
      printedAt: new Date(),
      status: "printed",
    });
    session.status = "printing";
    await saveSession(tx, session);
    const [tag] = await tx
      .select()
      .from(tagsTable)
      .where(eq(tagsTable.id, created.insertId))
      .limit(1);
    return tag;
  });
}

export async function confirmBagDrop(sessionId: number) {
  requireDemoCapability("Bag-drop belt acceptance");
  const db = await requireDb();
  return db.transaction(async tx => {
    const session = await getActiveSession(tx, sessionId, true);
    const tags = await tx
      .select()
      .from(tagsTable)
      .where(eq(tagsTable.sessionId, sessionId));
    if (session.status === "complete") return { session, tags };
    if (
      session.totalBags === 0 ||
      tags.length !== session.totalBags ||
      (session.excessFee > 0 && session.paymentStatus !== "paid")
    )
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "All bags must be tagged and excess fees settled",
      });
    await tx
      .update(tagsTable)
      .set({ status: "attached" })
      .where(eq(tagsTable.sessionId, sessionId));
    session.status = "complete";
    session.completedAt = new Date();
    return {
      session: await saveSession(tx, session),
      tags: tags.map(tag => ({ ...tag, status: "attached" as const })),
    };
  });
}

export async function getAllBagDropUnits(
  airportId?: number
): Promise<BagDropUnit[]> {
  const db = await requireDb();
  return db
    .select()
    .from(unitsTable)
    .where(airportId == null ? undefined : eq(unitsTable.airportId, airportId))
    .orderBy(asc(unitsTable.id));
}
export async function getBagDropStatus(unitId: number) {
  const db = await requireDb();
  const [unit] = await db
    .select()
    .from(unitsTable)
    .where(eq(unitsTable.id, unitId))
    .limit(1);
  if (!unit)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Bag drop unit not found",
    });
  const active = await db
    .select({ id: sessionsTable.id })
    .from(sessionsTable)
    .where(
      and(
        eq(sessionsTable.unitId, unitId),
        inArray(sessionsTable.status, [
          "started",
          "weighing",
          "payment",
          "printing",
        ]),
        gt(sessionsTable.startedAt, new Date(Date.now() - SESSION_TIMEOUT_MS))
      )
    );
  return {
    unit,
    activeSessions: active.length,
    isOperational: false,
    unavailableReason:
      "Device heartbeat and certified scale/printer/belt adapters are not installed",
  };
}
export async function registerBagDropUnit(data: {
  unitCode: string;
  airportId: number;
  terminal: string;
  zone: string;
  hasPrinter?: boolean;
  hasScale?: boolean;
  hasPayment?: boolean;
  beltConnected?: boolean;
}): Promise<BagDropUnit> {
  const db = await requireDb();
  const [created] = await db
    .insert(unitsTable)
    .values({ ...data, status: "offline" });
  const [unit] = await db
    .select()
    .from(unitsTable)
    .where(eq(unitsTable.id, created.insertId))
    .limit(1);
  return unit;
}
export async function expireBagDropSessions() {
  const db = await requireDb();
  await db
    .update(sessionsTable)
    .set({
      status: "timeout",
      errorMessage: "Session timed out",
      version: sql`${sessionsTable.version} + 1`,
    })
    .where(
      and(
        inArray(sessionsTable.status, [
          "started",
          "weighing",
          "payment",
          "printing",
        ]),
        lt(sessionsTable.startedAt, new Date(Date.now() - SESSION_TIMEOUT_MS))
      )
    );
}

export async function scanBoardingPass(barcode: string): Promise<{
  bookingId: number;
  passengerId: number;
  passengerName: string;
  flightNumber: string;
  destination: string;
  cabinClass: string;
}> {
  const db = await getDb();
  requireDemoCapability("Unsigned legacy boarding-pass parser");
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

  if (isNaN(passengerId) || passengerId <= 0) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Invalid passenger ID in barcode: must be a positive integer",
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

export async function checkBagAllowance(
  bookingId: number,
  passengerId: number
): Promise<{
  allowanceWeightGrams: number;
  cabinClass: string;
  maxBagWeightGrams: number;
  excessFeePerKgCents: number;
}> {
  if (bookingId <= 0) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "bookingId must be greater than 0",
    });
  }

  if (passengerId <= 0) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "passengerId must be greater than 0",
    });
  }

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

export async function getBagDropAnalytics(
  airportId: number,
  dateRange: { start: Date; end: Date }
) {
  const { start, end } = dateRange;

  const db = await requireDb();
  const airportUnits = await getAllBagDropUnits(airportId);
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

  const sessions = unitIds.size
    ? await db
        .select()
        .from(sessionsTable)
        .where(
          and(
            inArray(sessionsTable.unitId, [...unitIds]),
            gte(sessionsTable.startedAt, start),
            lte(sessionsTable.startedAt, end)
          )
        )
    : [];
  for (const session of sessions) {
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
    if (session.paymentStatus === "paid")
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
