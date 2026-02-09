/**
 * Seat Map & Check-in Service
 *
 * Manages aircraft seat map configurations, per-flight seat inventory,
 * seat selection/assignment, passenger check-in, boarding pass generation,
 * and seat pricing. Core PSS module for departure control integration.
 */

import { getDb } from "../db";
import {
  seatMaps,
  seatInventory,
  flights,
  bookings,
  passengers,
  airlines,
  airports,
  gateAssignments,
  airportGates,
  type SeatMap,
  type InsertSeatMap,
  type SeatInventoryItem,
  type InsertSeatInventoryItem,
} from "../../drizzle/schema";
import { eq, and, sql, asc, inArray, isNull, count } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

// ============================================================================
// Types & Interfaces
// ============================================================================

/** A single seat definition within a cabin layout row */
export interface SeatDefinition {
  column: string; // A, B, C, ...
  seatType:
    | "window"
    | "middle"
    | "aisle"
    | "bulkhead_window"
    | "bulkhead_middle"
    | "bulkhead_aisle"
    | "exit_row_window"
    | "exit_row_middle"
    | "exit_row_aisle";
  hasExtraLegroom?: boolean;
  hasPowerOutlet?: boolean;
  isReclinable?: boolean;
  nearLavatory?: boolean;
  nearGalley?: boolean;
  priceTier?: "free" | "standard" | "preferred" | "premium" | "extra_legroom";
  seatPrice?: number; // SAR cents
  blocked?: boolean; // Pre-blocked (crew seats, equipment)
}

/** A row within the cabin layout */
export interface CabinRow {
  row: number;
  cabinClass: "first" | "business" | "premium_economy" | "economy";
  seats: SeatDefinition[];
}

/** Full parsed cabin layout */
export interface CabinLayout {
  rows: CabinRow[];
}

/** Input for creating a seat map */
export interface CreateSeatMapInput {
  aircraftType: string;
  airlineId: number;
  configName: string;
  cabinLayout: CabinLayout;
  totalSeats: number;
  firstClassSeats?: number;
  businessSeats?: number;
  premiumEconomySeats?: number;
  economySeats?: number;
  seatPitch?: Record<string, number>; // cabin class -> inches
  seatWidth?: Record<string, number>; // cabin class -> inches
  hasWifi?: boolean;
  hasPowerOutlets?: boolean;
  hasIFE?: boolean;
}

/** Input for updating a seat map */
export interface UpdateSeatMapInput {
  aircraftType?: string;
  configName?: string;
  cabinLayout?: CabinLayout;
  totalSeats?: number;
  firstClassSeats?: number;
  businessSeats?: number;
  premiumEconomySeats?: number;
  economySeats?: number;
  seatPitch?: Record<string, number>;
  seatWidth?: Record<string, number>;
  hasWifi?: boolean;
  hasPowerOutlets?: boolean;
  hasIFE?: boolean;
  active?: boolean;
}

/** Seat with real-time status for flight seat map display */
export interface FlightSeat {
  id: number;
  seatNumber: string;
  row: number;
  column: string;
  cabinClass: string;
  seatType: string;
  hasExtraLegroom: boolean;
  hasPowerOutlet: boolean;
  isReclinable: boolean;
  nearLavatory: boolean;
  nearGalley: boolean;
  seatPrice: number;
  priceTier: string;
  status: string;
  isAssigned: boolean;
}

/** Structured flight seat map response */
export interface FlightSeatMapResponse {
  flightId: number;
  seatMapId: number;
  aircraftType: string;
  configName: string;
  features: {
    hasWifi: boolean;
    hasPowerOutlets: boolean;
    hasIFE: boolean;
  };
  cabins: {
    cabinClass: string;
    rows: {
      row: number;
      seats: FlightSeat[];
    }[];
  }[];
  summary: {
    totalSeats: number;
    available: number;
    occupied: number;
    blocked: number;
    checkedIn: number;
  };
}

/** Preferences for auto-assigning seats */
export interface SeatPreferences {
  position?: "window" | "aisle" | "middle";
  location?: "front" | "back" | "any";
  extraLegroom?: boolean;
  nearExit?: boolean;
  avoidLavatory?: boolean;
  avoidGalley?: boolean;
}

/** Boarding pass data */
export interface BoardingPassData {
  flightNumber: string;
  airline: { code: string; name: string };
  origin: { code: string; name: string; city: string };
  destination: { code: string; name: string; city: string };
  departureTime: Date;
  arrivalTime: Date;
  passenger: {
    firstName: string;
    lastName: string;
    title: string | null;
    ticketNumber: string | null;
  };
  seat: {
    seatNumber: string;
    cabinClass: string;
    boardingGroup: string | null;
    boardingSequence: number | null;
  };
  gate: string | null;
  boardingTime: Date | null;
  barcodeData: string;
  issuedAt: Date;
}

/** Check-in statistics for a flight */
export interface CheckInStats {
  flightId: number;
  totalPassengers: number;
  checkedIn: number;
  notCheckedIn: number;
  boardingPassesIssued: number;
  byClass: {
    cabinClass: string;
    total: number;
    checkedIn: number;
  }[];
}

/** Seat pricing tier info */
export interface SeatPricingTier {
  priceTier: string;
  cabinClass: string;
  seatPrice: number;
  availableCount: number;
  seatNumbers: string[];
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Get database connection or throw
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
 * Parse JSON text fields safely
 */
function safeJsonParse<T>(text: string | null, fallback: T): T {
  if (!text) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

/**
 * Count seats by cabin class in a layout
 */
function countSeatsByClass(layout: CabinLayout): Record<string, number> {
  const counts: Record<string, number> = {
    first: 0,
    business: 0,
    premium_economy: 0,
    economy: 0,
  };
  for (const row of layout.rows) {
    counts[row.cabinClass] = (counts[row.cabinClass] || 0) + row.seats.length;
  }
  return counts;
}

/**
 * Generate IATA-style boarding group based on cabin class and seat row
 */
function determineBoardingGroup(cabinClass: string, _row: number): string {
  switch (cabinClass) {
    case "first":
      return "1";
    case "business":
      return "2";
    case "premium_economy":
      return "3";
    case "economy":
      return "4";
    default:
      return "5";
  }
}

/**
 * Generate a barcode data string for a boarding pass (IATA BCBP format simplified)
 */
function generateBarcodeData(params: {
  passengerName: string;
  pnr: string;
  flightNumber: string;
  originCode: string;
  destinationCode: string;
  departureDate: Date;
  seatNumber: string;
  boardingSequence: number;
}): string {
  const day = Math.floor(
    (params.departureDate.getTime() -
      new Date(params.departureDate.getFullYear(), 0, 0).getTime()) /
      (1000 * 60 * 60 * 24)
  );
  const dayStr = String(day).padStart(3, "0");
  const name = params.passengerName.toUpperCase().padEnd(20, " ").slice(0, 20);
  const pnr = params.pnr.padEnd(7, " ").slice(0, 7);
  const flight = params.flightNumber.padEnd(7, " ").slice(0, 7);
  const seat = params.seatNumber.padEnd(4, " ").slice(0, 4);
  const seq = String(params.boardingSequence).padStart(4, "0");

  // Simplified BCBP format leg
  return `M1${name}E${pnr}${params.originCode}${params.destinationCode}${flight}${dayStr}${seat}${seq}`;
}

// ============================================================================
// Seat Map Configuration
// ============================================================================

/**
 * Create a new aircraft seat map configuration.
 * Validates that total seats match the sum of cabin class seat counts,
 * and that the layout row definitions are consistent.
 */
export async function createSeatMap(
  input: CreateSeatMapInput
): Promise<SeatMap> {
  const db = await requireDb();

  // Validate cabin layout structure
  if (!input.cabinLayout?.rows || input.cabinLayout.rows.length === 0) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Cabin layout must contain at least one row",
    });
  }

  // Count seats from layout
  const layoutCounts = countSeatsByClass(input.cabinLayout);
  const layoutTotal =
    layoutCounts.first +
    layoutCounts.business +
    layoutCounts.premium_economy +
    layoutCounts.economy;

  // Validate totals match
  const providedFirst = input.firstClassSeats ?? 0;
  const providedBusiness = input.businessSeats ?? 0;
  const providedPremiumEconomy = input.premiumEconomySeats ?? 0;
  const providedEconomy = input.economySeats ?? 0;
  const providedTotal =
    providedFirst + providedBusiness + providedPremiumEconomy + providedEconomy;

  if (input.totalSeats !== layoutTotal) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Total seats (${input.totalSeats}) does not match layout seat count (${layoutTotal})`,
    });
  }

  if (providedTotal > 0 && providedTotal !== layoutTotal) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Cabin class breakdown sum (${providedTotal}) does not match layout seat count (${layoutTotal}). Layout counts: first=${layoutCounts.first}, business=${layoutCounts.business}, premium_economy=${layoutCounts.premium_economy}, economy=${layoutCounts.economy}`,
    });
  }

  // Use layout counts if individual cabin counts not provided
  const firstClassSeats = providedFirst || layoutCounts.first;
  const businessSeats = providedBusiness || layoutCounts.business;
  const premiumEconomySeats =
    providedPremiumEconomy || layoutCounts.premium_economy;
  const economySeats = providedEconomy || layoutCounts.economy;

  const [result] = await db.insert(seatMaps).values({
    aircraftType: input.aircraftType,
    airlineId: input.airlineId,
    configName: input.configName,
    cabinLayout: JSON.stringify(input.cabinLayout),
    totalSeats: input.totalSeats,
    firstClassSeats,
    businessSeats,
    premiumEconomySeats,
    economySeats,
    seatPitch: input.seatPitch ? JSON.stringify(input.seatPitch) : null,
    seatWidth: input.seatWidth ? JSON.stringify(input.seatWidth) : null,
    hasWifi: input.hasWifi ?? false,
    hasPowerOutlets: input.hasPowerOutlets ?? false,
    hasIFE: input.hasIFE ?? false,
  });

  const insertId = (result as unknown as { insertId: number }).insertId;
  const created = await db
    .select()
    .from(seatMaps)
    .where(eq(seatMaps.id, insertId))
    .limit(1);

  if (!created[0]) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to retrieve created seat map",
    });
  }

  return created[0];
}

/**
 * Update an existing seat map configuration.
 * If cabinLayout is updated, re-validates totals.
 */
export async function updateSeatMap(
  id: number,
  input: UpdateSeatMapInput
): Promise<SeatMap> {
  const db = await requireDb();

  // Verify seat map exists
  const [existing] = await db
    .select()
    .from(seatMaps)
    .where(eq(seatMaps.id, id))
    .limit(1);

  if (!existing) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: `Seat map with id ${id} not found`,
    });
  }

  const updateData: Partial<InsertSeatMap> = {};

  if (input.aircraftType !== undefined)
    updateData.aircraftType = input.aircraftType;
  if (input.configName !== undefined) updateData.configName = input.configName;
  if (input.hasWifi !== undefined) updateData.hasWifi = input.hasWifi;
  if (input.hasPowerOutlets !== undefined)
    updateData.hasPowerOutlets = input.hasPowerOutlets;
  if (input.hasIFE !== undefined) updateData.hasIFE = input.hasIFE;
  if (input.active !== undefined) updateData.active = input.active;
  if (input.seatPitch !== undefined)
    updateData.seatPitch = JSON.stringify(input.seatPitch);
  if (input.seatWidth !== undefined)
    updateData.seatWidth = JSON.stringify(input.seatWidth);

  if (input.cabinLayout !== undefined) {
    const layoutCounts = countSeatsByClass(input.cabinLayout);
    const layoutTotal =
      layoutCounts.first +
      layoutCounts.business +
      layoutCounts.premium_economy +
      layoutCounts.economy;

    const totalSeats = input.totalSeats ?? layoutTotal;
    if (totalSeats !== layoutTotal) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Total seats (${totalSeats}) does not match layout seat count (${layoutTotal})`,
      });
    }

    updateData.cabinLayout = JSON.stringify(input.cabinLayout);
    updateData.totalSeats = totalSeats;
    updateData.firstClassSeats = input.firstClassSeats ?? layoutCounts.first;
    updateData.businessSeats = input.businessSeats ?? layoutCounts.business;
    updateData.premiumEconomySeats =
      input.premiumEconomySeats ?? layoutCounts.premium_economy;
    updateData.economySeats = input.economySeats ?? layoutCounts.economy;
  } else {
    if (input.totalSeats !== undefined)
      updateData.totalSeats = input.totalSeats;
    if (input.firstClassSeats !== undefined)
      updateData.firstClassSeats = input.firstClassSeats;
    if (input.businessSeats !== undefined)
      updateData.businessSeats = input.businessSeats;
    if (input.premiumEconomySeats !== undefined)
      updateData.premiumEconomySeats = input.premiumEconomySeats;
    if (input.economySeats !== undefined)
      updateData.economySeats = input.economySeats;
  }

  await db.update(seatMaps).set(updateData).where(eq(seatMaps.id, id));

  const [updated] = await db
    .select()
    .from(seatMaps)
    .where(eq(seatMaps.id, id))
    .limit(1);

  if (!updated) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to retrieve updated seat map",
    });
  }

  return updated;
}

/**
 * Get a seat map by id with parsed JSON fields.
 */
export async function getSeatMap(id: number) {
  const db = await requireDb();

  const [seatMap] = await db
    .select()
    .from(seatMaps)
    .where(eq(seatMaps.id, id))
    .limit(1);

  if (!seatMap) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: `Seat map with id ${id} not found`,
    });
  }

  return {
    ...seatMap,
    cabinLayout: safeJsonParse<CabinLayout>(seatMap.cabinLayout, { rows: [] }),
    seatPitch: safeJsonParse<Record<string, number>>(seatMap.seatPitch, {}),
    seatWidth: safeJsonParse<Record<string, number>>(seatMap.seatWidth, {}),
  };
}

/**
 * List seat maps, optionally filtered by airline and/or aircraft type.
 */
export async function listSeatMaps(airlineId?: number, aircraftType?: string) {
  const db = await requireDb();

  const conditions = [eq(seatMaps.active, true)];
  if (airlineId !== undefined) {
    conditions.push(eq(seatMaps.airlineId, airlineId));
  }
  if (aircraftType !== undefined) {
    conditions.push(eq(seatMaps.aircraftType, aircraftType));
  }

  const results = await db
    .select()
    .from(seatMaps)
    .where(and(...conditions))
    .orderBy(asc(seatMaps.aircraftType), asc(seatMaps.configName));

  return results.map(sm => ({
    ...sm,
    cabinLayout: safeJsonParse<CabinLayout>(sm.cabinLayout, { rows: [] }),
    seatPitch: safeJsonParse<Record<string, number>>(sm.seatPitch, {}),
    seatWidth: safeJsonParse<Record<string, number>>(sm.seatWidth, {}),
  }));
}

/**
 * Initialize seat inventory for a flight from a seat map template.
 * Creates individual seatInventory records for every seat defined in the layout.
 * Idempotent: throws if seats already exist for the flight.
 */
export async function initializeFlightSeats(
  flightId: number,
  seatMapId: number
): Promise<{ seatsCreated: number }> {
  const db = await requireDb();

  // Verify flight exists
  const [flight] = await db
    .select()
    .from(flights)
    .where(eq(flights.id, flightId))
    .limit(1);

  if (!flight) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: `Flight with id ${flightId} not found`,
    });
  }

  // Verify seat map exists
  const [seatMap] = await db
    .select()
    .from(seatMaps)
    .where(eq(seatMaps.id, seatMapId))
    .limit(1);

  if (!seatMap) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: `Seat map with id ${seatMapId} not found`,
    });
  }

  // Check if seats already exist for this flight
  const existingSeats = await db
    .select({ cnt: count() })
    .from(seatInventory)
    .where(eq(seatInventory.flightId, flightId));

  if (existingSeats[0] && Number(existingSeats[0].cnt) > 0) {
    throw new TRPCError({
      code: "CONFLICT",
      message: `Seat inventory already exists for flight ${flightId} (${existingSeats[0].cnt} seats). Delete existing inventory first.`,
    });
  }

  // Parse layout
  const layout = safeJsonParse<CabinLayout>(seatMap.cabinLayout, { rows: [] });
  if (layout.rows.length === 0) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Seat map has no rows defined in cabin layout",
    });
  }

  // Generate seat inventory records
  const seatRecords: InsertSeatInventoryItem[] = [];

  for (const cabinRow of layout.rows) {
    for (const seatDef of cabinRow.seats) {
      const seatNumber = `${cabinRow.row}${seatDef.column}`;
      const record: InsertSeatInventoryItem = {
        flightId,
        seatMapId,
        seatNumber,
        row: cabinRow.row,
        column: seatDef.column,
        cabinClass: cabinRow.cabinClass,
        seatType: seatDef.seatType,
        hasExtraLegroom: seatDef.hasExtraLegroom ?? false,
        hasPowerOutlet: seatDef.hasPowerOutlet ?? false,
        isReclinable: seatDef.isReclinable ?? true,
        nearLavatory: seatDef.nearLavatory ?? false,
        nearGalley: seatDef.nearGalley ?? false,
        seatPrice: seatDef.seatPrice ?? 0,
        priceTier: seatDef.priceTier ?? "standard",
        status: seatDef.blocked ? "blocked" : "available",
      };
      seatRecords.push(record);
    }
  }

  if (seatRecords.length === 0) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Cabin layout produced no seats",
    });
  }

  // Insert in batches to avoid query size limits
  const BATCH_SIZE = 100;
  for (let i = 0; i < seatRecords.length; i += BATCH_SIZE) {
    const batch = seatRecords.slice(i, i + BATCH_SIZE);
    await db.insert(seatInventory).values(batch);
  }

  return { seatsCreated: seatRecords.length };
}

// ============================================================================
// Seat Selection
// ============================================================================

/**
 * Get the complete seat map for a flight with real-time availability.
 * Returns a structured response organized by cabin and row for UI rendering.
 */
export async function getFlightSeatMap(
  flightId: number
): Promise<FlightSeatMapResponse> {
  const db = await requireDb();

  // Get all seats for this flight
  const seats = await db
    .select()
    .from(seatInventory)
    .where(eq(seatInventory.flightId, flightId))
    .orderBy(asc(seatInventory.row), asc(seatInventory.column));

  if (seats.length === 0) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: `No seat inventory found for flight ${flightId}. Initialize seats first.`,
    });
  }

  // Get the seat map configuration
  const seatMapId = seats[0].seatMapId;
  const [seatMap] = await db
    .select()
    .from(seatMaps)
    .where(eq(seatMaps.id, seatMapId))
    .limit(1);

  if (!seatMap) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Associated seat map configuration not found",
    });
  }

  // Organize seats by cabin class and row
  const cabinMap = new Map<string, Map<number, FlightSeat[]>>();

  let availableCount = 0;
  let occupiedCount = 0;
  let blockedCount = 0;
  let checkedInCount = 0;

  for (const seat of seats) {
    const flightSeat: FlightSeat = {
      id: seat.id,
      seatNumber: seat.seatNumber,
      row: seat.row,
      column: seat.column,
      cabinClass: seat.cabinClass,
      seatType: seat.seatType,
      hasExtraLegroom: seat.hasExtraLegroom,
      hasPowerOutlet: seat.hasPowerOutlet,
      isReclinable: seat.isReclinable,
      nearLavatory: seat.nearLavatory,
      nearGalley: seat.nearGalley,
      seatPrice: seat.seatPrice,
      priceTier: seat.priceTier,
      status: seat.status,
      isAssigned: seat.bookingId !== null,
    };

    switch (seat.status) {
      case "available":
        availableCount++;
        break;
      case "occupied":
      case "held":
        occupiedCount++;
        break;
      case "blocked":
      case "restricted":
        blockedCount++;
        break;
      case "checked_in":
        checkedInCount++;
        break;
    }

    if (!cabinMap.has(seat.cabinClass)) {
      cabinMap.set(seat.cabinClass, new Map());
    }
    const rowMap = cabinMap.get(seat.cabinClass)!;
    if (!rowMap.has(seat.row)) {
      rowMap.set(seat.row, []);
    }
    rowMap.get(seat.row)!.push(flightSeat);
  }

  // Build structured cabins array in order
  const cabinOrder = ["first", "business", "premium_economy", "economy"];
  const cabins = cabinOrder
    .filter(cc => cabinMap.has(cc))
    .map(cabinClass => {
      const rowMap = cabinMap.get(cabinClass)!;
      const rowNumbers = Array.from(rowMap.keys()).sort((a, b) => a - b);
      return {
        cabinClass,
        rows: rowNumbers.map(rowNum => ({
          row: rowNum,
          seats: rowMap.get(rowNum)!,
        })),
      };
    });

  return {
    flightId,
    seatMapId,
    aircraftType: seatMap.aircraftType,
    configName: seatMap.configName,
    features: {
      hasWifi: seatMap.hasWifi,
      hasPowerOutlets: seatMap.hasPowerOutlets,
      hasIFE: seatMap.hasIFE,
    },
    cabins,
    summary: {
      totalSeats: seats.length,
      available: availableCount,
      occupied: occupiedCount,
      blocked: blockedCount,
      checkedIn: checkedInCount,
    },
  };
}

/**
 * Select/assign a seat to a passenger on a specific flight.
 * Validates that the seat is available and the passenger belongs to the booking.
 */
export async function selectSeat(
  flightId: number,
  seatNumber: string,
  bookingId: number,
  passengerId: number
): Promise<SeatInventoryItem> {
  const db = await requireDb();

  // Verify booking exists, is confirmed/pending, and belongs to this flight
  const [booking] = await db
    .select()
    .from(bookings)
    .where(
      and(
        eq(bookings.id, bookingId),
        eq(bookings.flightId, flightId),
        isNull(bookings.deletedAt)
      )
    )
    .limit(1);

  if (!booking) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: `Booking ${bookingId} not found for flight ${flightId}`,
    });
  }

  if (booking.status === "cancelled") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Cannot select a seat for a cancelled booking",
    });
  }

  // Verify passenger belongs to this booking
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
      message: `Passenger ${passengerId} not found in booking ${bookingId}`,
    });
  }

  // Release any existing seat assignment for this passenger on this flight
  const existingAssignment = await db
    .select()
    .from(seatInventory)
    .where(
      and(
        eq(seatInventory.flightId, flightId),
        eq(seatInventory.passengerId, passengerId)
      )
    )
    .limit(1);

  if (existingAssignment.length > 0) {
    await db
      .update(seatInventory)
      .set({
        status: "available",
        bookingId: null,
        passengerId: null,
        assignedAt: null,
      })
      .where(eq(seatInventory.id, existingAssignment[0].id));
  }

  // Find and validate the target seat
  const [seat] = await db
    .select()
    .from(seatInventory)
    .where(
      and(
        eq(seatInventory.flightId, flightId),
        eq(seatInventory.seatNumber, seatNumber)
      )
    )
    .limit(1);

  if (!seat) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: `Seat ${seatNumber} not found on flight ${flightId}`,
    });
  }

  if (seat.status !== "available") {
    throw new TRPCError({
      code: "CONFLICT",
      message: `Seat ${seatNumber} is not available (current status: ${seat.status})`,
    });
  }

  // Assign the seat
  await db
    .update(seatInventory)
    .set({
      status: "occupied",
      bookingId,
      passengerId,
      assignedAt: new Date(),
    })
    .where(eq(seatInventory.id, seat.id));

  // Update the passenger record with the seat number
  await db
    .update(passengers)
    .set({ seatNumber })
    .where(eq(passengers.id, passengerId));

  // Fetch and return the updated seat
  const [updated] = await db
    .select()
    .from(seatInventory)
    .where(eq(seatInventory.id, seat.id))
    .limit(1);

  return updated;
}

/**
 * Release a previously assigned seat, making it available again.
 */
export async function releaseSeat(
  flightId: number,
  seatNumber: string
): Promise<{ success: true; seatNumber: string }> {
  const db = await requireDb();

  const [seat] = await db
    .select()
    .from(seatInventory)
    .where(
      and(
        eq(seatInventory.flightId, flightId),
        eq(seatInventory.seatNumber, seatNumber)
      )
    )
    .limit(1);

  if (!seat) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: `Seat ${seatNumber} not found on flight ${flightId}`,
    });
  }

  if (seat.status === "available") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Seat ${seatNumber} is already available`,
    });
  }

  if (seat.status === "checked_in") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Cannot release seat ${seatNumber}: passenger is already checked in. Undo check-in first.`,
    });
  }

  const passengerId = seat.passengerId;

  // Release the seat
  await db
    .update(seatInventory)
    .set({
      status: "available",
      bookingId: null,
      passengerId: null,
      assignedAt: null,
      boardingGroup: null,
      boardingSequence: null,
      boardingPassIssued: false,
    })
    .where(eq(seatInventory.id, seat.id));

  // Clear seat number from passenger record
  if (passengerId) {
    await db
      .update(passengers)
      .set({ seatNumber: null })
      .where(eq(passengers.id, passengerId));
  }

  return { success: true, seatNumber };
}

/**
 * Change a passenger's seat assignment from one seat to another.
 */
export async function changeSeat(
  flightId: number,
  oldSeatNumber: string,
  newSeatNumber: string,
  bookingId: number,
  passengerId: number
): Promise<SeatInventoryItem> {
  const db = await requireDb();

  if (oldSeatNumber === newSeatNumber) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Old and new seat numbers are the same",
    });
  }

  // Verify the old seat is actually assigned to this passenger
  const [oldSeat] = await db
    .select()
    .from(seatInventory)
    .where(
      and(
        eq(seatInventory.flightId, flightId),
        eq(seatInventory.seatNumber, oldSeatNumber)
      )
    )
    .limit(1);

  if (!oldSeat) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: `Seat ${oldSeatNumber} not found on flight ${flightId}`,
    });
  }

  if (oldSeat.passengerId !== passengerId || oldSeat.bookingId !== bookingId) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Seat ${oldSeatNumber} is not assigned to passenger ${passengerId} in booking ${bookingId}`,
    });
  }

  // Verify new seat is available
  const [newSeat] = await db
    .select()
    .from(seatInventory)
    .where(
      and(
        eq(seatInventory.flightId, flightId),
        eq(seatInventory.seatNumber, newSeatNumber)
      )
    )
    .limit(1);

  if (!newSeat) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: `Seat ${newSeatNumber} not found on flight ${flightId}`,
    });
  }

  if (newSeat.status !== "available") {
    throw new TRPCError({
      code: "CONFLICT",
      message: `Seat ${newSeatNumber} is not available (current status: ${newSeat.status})`,
    });
  }

  const wasCheckedIn = oldSeat.status === "checked_in";

  // Release old seat
  await db
    .update(seatInventory)
    .set({
      status: "available",
      bookingId: null,
      passengerId: null,
      assignedAt: null,
      checkedInAt: null,
      boardingGroup: null,
      boardingSequence: null,
      boardingPassIssued: false,
    })
    .where(eq(seatInventory.id, oldSeat.id));

  // Assign new seat, preserving checked-in status if applicable
  const newStatus = wasCheckedIn ? "checked_in" : "occupied";
  await db
    .update(seatInventory)
    .set({
      status: newStatus,
      bookingId,
      passengerId,
      assignedAt: new Date(),
      checkedInAt: wasCheckedIn ? new Date() : null,
      boardingGroup: wasCheckedIn
        ? determineBoardingGroup(newSeat.cabinClass, newSeat.row)
        : null,
      boardingSequence: wasCheckedIn ? oldSeat.boardingSequence : null,
      boardingPassIssued: false, // New boarding pass required after seat change
    })
    .where(eq(seatInventory.id, newSeat.id));

  // Update passenger record
  await db
    .update(passengers)
    .set({ seatNumber: newSeatNumber })
    .where(eq(passengers.id, passengerId));

  // Return updated seat
  const [updated] = await db
    .select()
    .from(seatInventory)
    .where(eq(seatInventory.id, newSeat.id))
    .limit(1);

  return updated;
}

/**
 * Get the assigned seat for a specific passenger in a booking.
 */
export async function getPassengerSeat(
  bookingId: number,
  passengerId: number
): Promise<SeatInventoryItem | null> {
  const db = await requireDb();

  const [seat] = await db
    .select()
    .from(seatInventory)
    .where(
      and(
        eq(seatInventory.bookingId, bookingId),
        eq(seatInventory.passengerId, passengerId)
      )
    )
    .limit(1);

  return seat ?? null;
}

/**
 * Block a seat (admin operation). Used for crew seats, equipment, or maintenance.
 */
export async function blockSeat(
  flightId: number,
  seatNumber: string,
  _reason?: string
): Promise<{ success: true; seatNumber: string }> {
  const db = await requireDb();

  const [seat] = await db
    .select()
    .from(seatInventory)
    .where(
      and(
        eq(seatInventory.flightId, flightId),
        eq(seatInventory.seatNumber, seatNumber)
      )
    )
    .limit(1);

  if (!seat) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: `Seat ${seatNumber} not found on flight ${flightId}`,
    });
  }

  if (seat.status === "occupied" || seat.status === "checked_in") {
    throw new TRPCError({
      code: "CONFLICT",
      message: `Cannot block seat ${seatNumber}: it is currently ${seat.status}. Release or undo check-in first.`,
    });
  }

  if (seat.status === "blocked") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Seat ${seatNumber} is already blocked`,
    });
  }

  await db
    .update(seatInventory)
    .set({ status: "blocked" })
    .where(eq(seatInventory.id, seat.id));

  return { success: true, seatNumber };
}

/**
 * Unblock a previously blocked seat.
 */
export async function unblockSeat(
  flightId: number,
  seatNumber: string
): Promise<{ success: true; seatNumber: string }> {
  const db = await requireDb();

  const [seat] = await db
    .select()
    .from(seatInventory)
    .where(
      and(
        eq(seatInventory.flightId, flightId),
        eq(seatInventory.seatNumber, seatNumber)
      )
    )
    .limit(1);

  if (!seat) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: `Seat ${seatNumber} not found on flight ${flightId}`,
    });
  }

  if (seat.status !== "blocked" && seat.status !== "restricted") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Seat ${seatNumber} is not blocked (current status: ${seat.status})`,
    });
  }

  await db
    .update(seatInventory)
    .set({ status: "available" })
    .where(eq(seatInventory.id, seat.id));

  return { success: true, seatNumber };
}

// ============================================================================
// Check-in
// ============================================================================

/**
 * Check in a passenger for a flight.
 * If no seat is specified, auto-assigns the best available seat.
 * Generates boarding group and sequence number.
 */
export async function checkIn(
  flightId: number,
  bookingId: number,
  passengerId: number,
  seatNumber?: string
): Promise<{
  seat: SeatInventoryItem;
  boardingGroup: string;
  boardingSequence: number;
}> {
  const db = await requireDb();

  // Verify booking
  const [booking] = await db
    .select()
    .from(bookings)
    .where(
      and(
        eq(bookings.id, bookingId),
        eq(bookings.flightId, flightId),
        isNull(bookings.deletedAt)
      )
    )
    .limit(1);

  if (!booking) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: `Booking ${bookingId} not found for flight ${flightId}`,
    });
  }

  if (booking.status !== "confirmed" && booking.status !== "completed") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Cannot check in: booking status is '${booking.status}'. Only confirmed bookings can be checked in.`,
    });
  }

  if (booking.paymentStatus !== "paid") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Cannot check in: payment is not completed",
    });
  }

  // Verify passenger belongs to booking
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
      message: `Passenger ${passengerId} not found in booking ${bookingId}`,
    });
  }

  // Check if already checked in
  const existingCheckIn = await db
    .select()
    .from(seatInventory)
    .where(
      and(
        eq(seatInventory.flightId, flightId),
        eq(seatInventory.passengerId, passengerId),
        eq(seatInventory.status, "checked_in")
      )
    )
    .limit(1);

  if (existingCheckIn.length > 0) {
    throw new TRPCError({
      code: "CONFLICT",
      message: `Passenger ${passengerId} is already checked in on seat ${existingCheckIn[0].seatNumber}`,
    });
  }

  // Determine which seat to use
  let targetSeatNumber = seatNumber;

  if (!targetSeatNumber) {
    // Check if passenger already has a seat assigned (occupied but not checked in)
    const assignedSeat = await db
      .select()
      .from(seatInventory)
      .where(
        and(
          eq(seatInventory.flightId, flightId),
          eq(seatInventory.passengerId, passengerId),
          eq(seatInventory.status, "occupied")
        )
      )
      .limit(1);

    if (assignedSeat.length > 0) {
      targetSeatNumber = assignedSeat[0].seatNumber;
    } else {
      // Auto-assign a seat based on cabin class
      const cabinClass =
        booking.cabinClass === "business" ? "business" : "economy";
      const autoAssigned = await autoAssignSeat(flightId, cabinClass);
      targetSeatNumber = autoAssigned.seatNumber;
    }
  }

  // If seat is not yet assigned to this passenger, assign it first
  const [currentSeat] = await db
    .select()
    .from(seatInventory)
    .where(
      and(
        eq(seatInventory.flightId, flightId),
        eq(seatInventory.seatNumber, targetSeatNumber)
      )
    )
    .limit(1);

  if (!currentSeat) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: `Seat ${targetSeatNumber} not found on flight ${flightId}`,
    });
  }

  // If seat is assigned to a different passenger, reject
  if (
    currentSeat.passengerId !== null &&
    currentSeat.passengerId !== passengerId
  ) {
    throw new TRPCError({
      code: "CONFLICT",
      message: `Seat ${targetSeatNumber} is assigned to a different passenger`,
    });
  }

  if (currentSeat.status === "blocked" || currentSeat.status === "restricted") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Seat ${targetSeatNumber} is ${currentSeat.status} and cannot be used for check-in`,
    });
  }

  // Generate boarding sequence (next sequential number for this flight)
  const [seqResult] = await db
    .select({
      maxSeq: sql<number>`COALESCE(MAX(${seatInventory.boardingSequence}), 0)`,
    })
    .from(seatInventory)
    .where(eq(seatInventory.flightId, flightId));

  const boardingSequence = (seqResult?.maxSeq ?? 0) + 1;
  const boardingGroup = determineBoardingGroup(
    currentSeat.cabinClass,
    currentSeat.row
  );

  // Perform check-in update
  await db
    .update(seatInventory)
    .set({
      status: "checked_in",
      bookingId,
      passengerId,
      assignedAt: currentSeat.assignedAt ?? new Date(),
      checkedInAt: new Date(),
      boardingGroup,
      boardingSequence,
    })
    .where(eq(seatInventory.id, currentSeat.id));

  // Update passenger seat number
  await db
    .update(passengers)
    .set({ seatNumber: targetSeatNumber })
    .where(eq(passengers.id, passengerId));

  // Mark booking as checked in if all passengers are now checked in
  const allPassengers = await db
    .select({ id: passengers.id })
    .from(passengers)
    .where(eq(passengers.bookingId, bookingId));

  const checkedInPassengers = await db
    .select({ cnt: count() })
    .from(seatInventory)
    .where(
      and(
        eq(seatInventory.flightId, flightId),
        eq(seatInventory.bookingId, bookingId),
        eq(seatInventory.status, "checked_in")
      )
    );

  // +1 for the passenger we just checked in (if the count doesn't yet reflect it due to timing)
  const checkedInCount = Number(checkedInPassengers[0]?.cnt ?? 0);
  if (checkedInCount >= allPassengers.length) {
    await db
      .update(bookings)
      .set({ checkedIn: true, updatedAt: new Date() })
      .where(eq(bookings.id, bookingId));
  }

  // Fetch updated seat
  const [updatedSeat] = await db
    .select()
    .from(seatInventory)
    .where(eq(seatInventory.id, currentSeat.id))
    .limit(1);

  return {
    seat: updatedSeat,
    boardingGroup,
    boardingSequence,
  };
}

/**
 * Undo a passenger's check-in, reverting seat status to 'occupied'.
 */
export async function undoCheckIn(
  flightId: number,
  bookingId: number,
  passengerId: number
): Promise<{ success: true; seatNumber: string }> {
  const db = await requireDb();

  // Find the checked-in seat
  const [seat] = await db
    .select()
    .from(seatInventory)
    .where(
      and(
        eq(seatInventory.flightId, flightId),
        eq(seatInventory.bookingId, bookingId),
        eq(seatInventory.passengerId, passengerId),
        eq(seatInventory.status, "checked_in")
      )
    )
    .limit(1);

  if (!seat) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: `No checked-in seat found for passenger ${passengerId} on flight ${flightId}`,
    });
  }

  // Revert to occupied status
  await db
    .update(seatInventory)
    .set({
      status: "occupied",
      checkedInAt: null,
      boardingGroup: null,
      boardingSequence: null,
      boardingPassIssued: false,
    })
    .where(eq(seatInventory.id, seat.id));

  // Unmark booking check-in status
  await db
    .update(bookings)
    .set({ checkedIn: false, updatedAt: new Date() })
    .where(eq(bookings.id, bookingId));

  return { success: true, seatNumber: seat.seatNumber };
}

/**
 * Generate boarding pass data for a checked-in passenger.
 * Includes flight details, gate info, seat, and barcode data.
 */
export async function generateBoardingPass(
  flightId: number,
  passengerId: number
): Promise<BoardingPassData> {
  const db = await requireDb();

  // Get the checked-in seat
  const [seat] = await db
    .select()
    .from(seatInventory)
    .where(
      and(
        eq(seatInventory.flightId, flightId),
        eq(seatInventory.passengerId, passengerId),
        eq(seatInventory.status, "checked_in")
      )
    )
    .limit(1);

  if (!seat) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: `Passenger ${passengerId} is not checked in on flight ${flightId}`,
    });
  }

  // Get passenger details
  const [passenger] = await db
    .select()
    .from(passengers)
    .where(eq(passengers.id, passengerId))
    .limit(1);

  if (!passenger) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: `Passenger ${passengerId} not found`,
    });
  }

  // Get booking for PNR
  const [booking] = await db
    .select()
    .from(bookings)
    .where(eq(bookings.id, seat.bookingId!))
    .limit(1);

  if (!booking) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Booking not found for this seat assignment",
    });
  }

  // Get flight with airline and airport details
  const flightDetails = await db
    .select({
      flightNumber: flights.flightNumber,
      departureTime: flights.departureTime,
      arrivalTime: flights.arrivalTime,
      airlineCode: airlines.code,
      airlineName: airlines.name,
      originCode: airports.code,
      originName: airports.name,
      originCity: airports.city,
      destinationCode: sql<string>`dest.code`,
      destinationName: sql<string>`dest.name`,
      destinationCity: sql<string>`dest.city`,
    })
    .from(flights)
    .innerJoin(airlines, eq(flights.airlineId, airlines.id))
    .innerJoin(airports, eq(flights.originId, airports.id))
    .innerJoin(sql`airports as dest`, sql`${flights.destinationId} = dest.id`)
    .where(eq(flights.id, flightId))
    .limit(1);

  if (flightDetails.length === 0) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: `Flight ${flightId} details not found`,
    });
  }

  const fd = flightDetails[0];

  // Try to get gate assignment
  let gateNumber: string | null = null;
  let boardingTime: Date | null = null;

  try {
    const gateInfo = await db
      .select({
        gateNumber: airportGates.gateNumber,
        boardingStartTime: gateAssignments.boardingStartTime,
      })
      .from(gateAssignments)
      .innerJoin(airportGates, eq(gateAssignments.gateId, airportGates.id))
      .where(
        and(
          eq(gateAssignments.flightId, flightId),
          eq(gateAssignments.status, "assigned")
        )
      )
      .limit(1);

    if (gateInfo.length > 0) {
      gateNumber = gateInfo[0].gateNumber;
      boardingTime = gateInfo[0].boardingStartTime;
    }
  } catch {
    // Gate tables may not exist; boarding pass still valid without gate info
  }

  // Generate barcode
  const passengerName = `${passenger.lastName}/${passenger.firstName}`;
  const barcodeData = generateBarcodeData({
    passengerName,
    pnr: booking.pnr,
    flightNumber: fd.flightNumber,
    originCode: fd.originCode,
    destinationCode: fd.destinationCode,
    departureDate: fd.departureTime,
    seatNumber: seat.seatNumber,
    boardingSequence: seat.boardingSequence ?? 0,
  });

  // Mark boarding pass as issued
  await db
    .update(seatInventory)
    .set({ boardingPassIssued: true })
    .where(eq(seatInventory.id, seat.id));

  return {
    flightNumber: fd.flightNumber,
    airline: {
      code: fd.airlineCode,
      name: fd.airlineName,
    },
    origin: {
      code: fd.originCode,
      name: fd.originName,
      city: fd.originCity,
    },
    destination: {
      code: fd.destinationCode,
      name: fd.destinationName,
      city: fd.destinationCity,
    },
    departureTime: fd.departureTime,
    arrivalTime: fd.arrivalTime,
    passenger: {
      firstName: passenger.firstName,
      lastName: passenger.lastName,
      title: passenger.title,
      ticketNumber: passenger.ticketNumber,
    },
    seat: {
      seatNumber: seat.seatNumber,
      cabinClass: seat.cabinClass,
      boardingGroup: seat.boardingGroup,
      boardingSequence: seat.boardingSequence,
    },
    gate: gateNumber,
    boardingTime,
    barcodeData,
    issuedAt: new Date(),
  };
}

/**
 * Get check-in statistics for a flight: total passengers, checked-in count,
 * boarding passes issued, broken down by cabin class.
 */
export async function getCheckInStatus(
  flightId: number
): Promise<CheckInStats> {
  const db = await requireDb();

  // Verify flight exists
  const [flight] = await db
    .select({ id: flights.id })
    .from(flights)
    .where(eq(flights.id, flightId))
    .limit(1);

  if (!flight) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: `Flight ${flightId} not found`,
    });
  }

  // Total passengers booked on this flight (from confirmed/completed bookings)
  const confirmedBookings = await db
    .select({
      id: bookings.id,
      numberOfPassengers: bookings.numberOfPassengers,
    })
    .from(bookings)
    .where(
      and(
        eq(bookings.flightId, flightId),
        inArray(bookings.status, ["confirmed", "completed"]),
        isNull(bookings.deletedAt)
      )
    );

  const totalPassengers = confirmedBookings.reduce(
    (sum, b) => sum + b.numberOfPassengers,
    0
  );

  // Get seat status breakdown
  const seatStats = await db
    .select({
      status: seatInventory.status,
      cabinClass: seatInventory.cabinClass,
      cnt: count(),
    })
    .from(seatInventory)
    .where(eq(seatInventory.flightId, flightId))
    .groupBy(seatInventory.status, seatInventory.cabinClass);

  // Count checked-in passengers
  let checkedIn = 0;
  let boardingPassesIssued = 0;

  // Get boarding pass count
  const [bpCount] = await db
    .select({ cnt: count() })
    .from(seatInventory)
    .where(
      and(
        eq(seatInventory.flightId, flightId),
        eq(seatInventory.boardingPassIssued, true)
      )
    );

  boardingPassesIssued = Number(bpCount?.cnt ?? 0);

  // Build by-class breakdown
  const classTotals = new Map<string, { total: number; checkedIn: number }>();

  for (const stat of seatStats) {
    const cls = stat.cabinClass;
    if (!classTotals.has(cls)) {
      classTotals.set(cls, { total: 0, checkedIn: 0 });
    }
    const entry = classTotals.get(cls)!;

    const statCount = Number(stat.cnt);
    if (stat.status === "occupied" || stat.status === "checked_in") {
      entry.total += statCount;
    }
    if (stat.status === "checked_in") {
      entry.checkedIn += statCount;
      checkedIn += statCount;
    }
  }

  const byClass = Array.from(classTotals.entries()).map(
    ([cabinClass, data]) => ({
      cabinClass,
      total: data.total,
      checkedIn: data.checkedIn,
    })
  );

  return {
    flightId,
    totalPassengers,
    checkedIn,
    notCheckedIn: totalPassengers - checkedIn,
    boardingPassesIssued,
    byClass,
  };
}

/**
 * Auto-assign the best available seat based on cabin class and optional preferences.
 * Preference-based scoring: window/aisle preferred, extra legroom, avoid galley/lavatory.
 */
export async function autoAssignSeat(
  flightId: number,
  cabinClass: string,
  preferences?: SeatPreferences
): Promise<SeatInventoryItem> {
  const db = await requireDb();

  // Get all available seats in the requested cabin class
  const availableSeats = await db
    .select()
    .from(seatInventory)
    .where(
      and(
        eq(seatInventory.flightId, flightId),
        eq(
          seatInventory.cabinClass,
          cabinClass as "first" | "business" | "premium_economy" | "economy"
        ),
        eq(seatInventory.status, "available")
      )
    )
    .orderBy(asc(seatInventory.row), asc(seatInventory.column));

  if (availableSeats.length === 0) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: `No available seats in ${cabinClass} class on flight ${flightId}`,
    });
  }

  if (!preferences) {
    // Default: return first available seat (front rows first)
    return availableSeats[0];
  }

  // Score each seat based on preferences
  const scored = availableSeats.map(seat => {
    let score = 0;

    // Position preference
    if (preferences.position) {
      const isWindow =
        seat.seatType === "window" ||
        seat.seatType === "bulkhead_window" ||
        seat.seatType === "exit_row_window";
      const isAisle =
        seat.seatType === "aisle" ||
        seat.seatType === "bulkhead_aisle" ||
        seat.seatType === "exit_row_aisle";
      const isMiddle =
        seat.seatType === "middle" ||
        seat.seatType === "bulkhead_middle" ||
        seat.seatType === "exit_row_middle";

      if (preferences.position === "window" && isWindow) score += 10;
      else if (preferences.position === "aisle" && isAisle) score += 10;
      else if (preferences.position === "middle" && isMiddle) score += 10;
    }

    // Location preference (front vs back)
    if (preferences.location === "front") {
      // Lower row numbers get higher scores
      score += Math.max(0, 50 - seat.row);
    } else if (preferences.location === "back") {
      // Higher row numbers get higher scores
      score += seat.row;
    }

    // Extra legroom preference
    if (preferences.extraLegroom && seat.hasExtraLegroom) {
      score += 8;
    }

    // Near exit preference
    if (preferences.nearExit) {
      const isExitRow =
        seat.seatType === "exit_row_window" ||
        seat.seatType === "exit_row_middle" ||
        seat.seatType === "exit_row_aisle";
      if (isExitRow) score += 7;
    }

    // Avoid lavatory
    if (preferences.avoidLavatory && seat.nearLavatory) {
      score -= 5;
    }

    // Avoid galley
    if (preferences.avoidGalley && seat.nearGalley) {
      score -= 5;
    }

    return { seat, score };
  });

  // Sort by score descending, then by row ascending for tie-breaking
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.seat.row !== b.seat.row) return a.seat.row - b.seat.row;
    return a.seat.column.localeCompare(b.seat.column);
  });

  return scored[0].seat;
}

// ============================================================================
// Pricing
// ============================================================================

/**
 * Get seat pricing tiers for a flight, optionally filtered by cabin class.
 * Returns available seats grouped by price tier with counts.
 */
export async function getSeatPricing(
  flightId: number,
  cabinClass?: string
): Promise<SeatPricingTier[]> {
  const db = await requireDb();

  const conditions = [
    eq(seatInventory.flightId, flightId),
    eq(seatInventory.status, "available"),
  ];

  if (cabinClass) {
    conditions.push(
      eq(
        seatInventory.cabinClass,
        cabinClass as "first" | "business" | "premium_economy" | "economy"
      )
    );
  }

  const seats = await db
    .select({
      priceTier: seatInventory.priceTier,
      cabinClass: seatInventory.cabinClass,
      seatPrice: seatInventory.seatPrice,
      seatNumber: seatInventory.seatNumber,
    })
    .from(seatInventory)
    .where(and(...conditions))
    .orderBy(asc(seatInventory.seatPrice));

  // Group by priceTier + cabinClass + seatPrice
  const tierMap = new Map<
    string,
    {
      priceTier: string;
      cabinClass: string;
      seatPrice: number;
      seatNumbers: string[];
    }
  >();

  for (const seat of seats) {
    const key = `${seat.cabinClass}:${seat.priceTier}:${seat.seatPrice}`;
    if (!tierMap.has(key)) {
      tierMap.set(key, {
        priceTier: seat.priceTier,
        cabinClass: seat.cabinClass,
        seatPrice: seat.seatPrice,
        seatNumbers: [],
      });
    }
    tierMap.get(key)!.seatNumbers.push(seat.seatNumber);
  }

  return Array.from(tierMap.values()).map(t => ({
    priceTier: t.priceTier,
    cabinClass: t.cabinClass,
    seatPrice: t.seatPrice,
    availableCount: t.seatNumbers.length,
    seatNumbers: t.seatNumbers,
  }));
}

/**
 * Calculate the price difference for changing from one seat to another.
 * Returns the additional charge (positive) or refund amount (negative) in SAR cents.
 */
export async function calculateSeatUpgradePrice(
  flightId: number,
  currentSeatNumber: string,
  newSeatNumber: string
): Promise<{
  currentSeat: {
    seatNumber: string;
    seatPrice: number;
    priceTier: string;
    cabinClass: string;
  };
  newSeat: {
    seatNumber: string;
    seatPrice: number;
    priceTier: string;
    cabinClass: string;
  };
  priceDifference: number;
  isUpgrade: boolean;
}> {
  const db = await requireDb();

  // Get current seat
  const [currentSeat] = await db
    .select()
    .from(seatInventory)
    .where(
      and(
        eq(seatInventory.flightId, flightId),
        eq(seatInventory.seatNumber, currentSeatNumber)
      )
    )
    .limit(1);

  if (!currentSeat) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: `Current seat ${currentSeatNumber} not found on flight ${flightId}`,
    });
  }

  // Get new seat
  const [newSeat] = await db
    .select()
    .from(seatInventory)
    .where(
      and(
        eq(seatInventory.flightId, flightId),
        eq(seatInventory.seatNumber, newSeatNumber)
      )
    )
    .limit(1);

  if (!newSeat) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: `New seat ${newSeatNumber} not found on flight ${flightId}`,
    });
  }

  if (newSeat.status !== "available") {
    throw new TRPCError({
      code: "CONFLICT",
      message: `Seat ${newSeatNumber} is not available (status: ${newSeat.status})`,
    });
  }

  const priceDifference = newSeat.seatPrice - currentSeat.seatPrice;

  return {
    currentSeat: {
      seatNumber: currentSeat.seatNumber,
      seatPrice: currentSeat.seatPrice,
      priceTier: currentSeat.priceTier,
      cabinClass: currentSeat.cabinClass,
    },
    newSeat: {
      seatNumber: newSeat.seatNumber,
      seatPrice: newSeat.seatPrice,
      priceTier: newSeat.priceTier,
      cabinClass: newSeat.cabinClass,
    },
    priceDifference,
    isUpgrade: priceDifference > 0,
  };
}
