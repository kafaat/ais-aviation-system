/**
 * Booking-class (RBD) inventory nested inside the cabin counters. ADR 0002.
 *
 * The cabin counters on `flights` stay the physical authority and keep being
 * decremented by `reserveSeats`. This layer adds, per flight and fare class,
 * an authorization level (AU) and a `sold` counter that moves in the same
 * transaction as the cabin decrement. Held seats are the active
 * `inventory_locks` rows that carry a `fareClassId`, exactly as cabin holds
 * are derived today, so hold expiry needs no counter repair.
 *
 * Nested availability (serial nesting, highest priority on top):
 *   raw(c)       = AU(c) - sum(sold + held) of c and every nested class below c
 *   available(c) = min(raw(k) for every nested class k at or above c)
 * so a sale in a lower class consumes every higher nested class, and a lower
 * class can never show more seats than the class above it. A class with
 * `nested = false` is a discrete bucket: available = AU - sold - held. Every
 * figure is finally capped by the physical cabin count.
 */
import { TRPCError } from "@trpc/server";
import { and, asc, eq, gt, inArray, isNotNull, ne, sql } from "drizzle-orm";
import {
  fareClasses,
  flightFareClassInventory,
  inventoryLocks,
  type FareClass,
  type FlightFareClassInventory,
  type InsertFlightFareClassInventory,
} from "../../drizzle/schema";
import type { getDb } from "../db";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
export type Cabin = "economy" | "business";

/** Expected commercial rejection: the class is closed or oversold. The
 * settlement path converts it to its own `InventoryUnavailableError`. */
export class BookingClassUnavailableError extends TRPCError {
  constructor(message: string) {
    super({ code: "CONFLICT", message });
  }
}

export interface NestedInventoryRow {
  fareClassId: number;
  cabinClass: Cabin;
  priority: number;
  authorizedSeats: number;
  sold: number;
  held: number;
  nested: boolean;
}

/** Pure nested-availability math; see the module comment for the model. */
export function computeNestedAvailability(
  rows: NestedInventoryRow[],
  cabinAvailable: Partial<Record<Cabin, number>> = {}
): Map<number, number> {
  const available = new Map<number, number>();
  const cabins = new Set(rows.map(r => r.cabinClass));
  for (const cabin of cabins) {
    const cap = cabinAvailable[cabin];
    const clamp = (value: number) =>
      Math.max(0, cap === undefined ? value : Math.min(value, cap));
    const inCabin = rows.filter(r => r.cabinClass === cabin);
    const nested = inCabin
      .filter(r => r.nested)
      .sort((a, b) => b.priority - a.priority || a.fareClassId - b.fareClassId);
    // consumption at or below each class, from the bottom of the nest up.
    let below = 0;
    const raw: number[] = new Array(nested.length);
    for (let i = nested.length - 1; i >= 0; i--) {
      below += nested[i].sold + nested[i].held;
      raw[i] = nested[i].authorizedSeats - below;
    }
    let ceiling = Infinity;
    for (let i = 0; i < nested.length; i++) {
      ceiling = Math.min(ceiling, raw[i]);
      available.set(nested[i].fareClassId, clamp(ceiling));
    }
    for (const bucket of inCabin.filter(r => !r.nested))
      available.set(
        bucket.fareClassId,
        clamp(bucket.authorizedSeats - bucket.sold - bucket.held)
      );
  }
  return available;
}

export interface FlightBookingClassState {
  inventory: FlightFareClassInventory;
  fareClass: FareClass | undefined;
  held: number;
}

/** Inventory rows, their fare classes and derived held counts for flights.
 * With `lock`, rows and counted holds are read FOR UPDATE; the caller must
 * already hold the flight row lock, as every cabin writer does. */
export async function loadBookingClassState(
  db: Db,
  flightIds: number[],
  options: { now?: Date; lock?: boolean; ownLockId?: number | null } = {}
): Promise<FlightBookingClassState[]> {
  if (!flightIds.length) return [];
  const now = options.now ?? new Date();
  const inventoryQuery = db
    .select()
    .from(flightFareClassInventory)
    .where(inArray(flightFareClassInventory.flightId, flightIds))
    .orderBy(
      asc(flightFareClassInventory.flightId),
      asc(flightFareClassInventory.id)
    );
  const inventory = await (options.lock
    ? inventoryQuery.for("update")
    : inventoryQuery);
  if (!inventory.length) return [];
  const classes = await db
    .select()
    .from(fareClasses)
    .where(
      inArray(fareClasses.id, [...new Set(inventory.map(r => r.fareClassId))])
    );
  const holdsQuery = db
    .select({
      flightId: inventoryLocks.flightId,
      fareClassId: inventoryLocks.fareClassId,
      numberOfSeats: inventoryLocks.numberOfSeats,
    })
    .from(inventoryLocks)
    .where(
      and(
        inArray(inventoryLocks.flightId, flightIds),
        isNotNull(inventoryLocks.fareClassId),
        eq(inventoryLocks.status, "active"),
        gt(inventoryLocks.expiresAt, now),
        options.ownLockId ? ne(inventoryLocks.id, options.ownLockId) : undefined
      )
    );
  const holds = await (options.lock ? holdsQuery.for("update") : holdsQuery);
  const held = new Map<string, number>();
  for (const hold of holds) {
    const key = `${hold.flightId}:${hold.fareClassId}`;
    held.set(key, (held.get(key) ?? 0) + Number(hold.numberOfSeats));
  }
  return inventory.map(row => ({
    inventory: row,
    fareClass: classes.find(c => c.id === row.fareClassId),
    held: held.get(`${row.flightId}:${row.fareClassId}`) ?? 0,
  }));
}

function toNestedRows(state: FlightBookingClassState[]): NestedInventoryRow[] {
  return state.map(({ inventory, fareClass, held }) => ({
    fareClassId: inventory.fareClassId,
    cabinClass: inventory.cabinClass,
    priority: fareClass?.priority ?? 0,
    authorizedSeats: inventory.authorizedSeats,
    sold: inventory.sold,
    held,
    nested: inventory.nested,
  }));
}

export interface BookingClassAvailability {
  fareClassId: number;
  code: string;
  name: string;
  cabinClass: Cabin;
  fareFamily: string | null;
  priority: number;
  /** Fare class multiplier over the cabin base fare (fare_classes.basePriceMultiplier). */
  priceMultiplier: number;
  /** Cabin list fare x multiplier before dynamic pricing; the quoted price is the offer's. */
  baseFare: number;
  available: number;
  authorized: number;
  sold: number;
  held: number;
  nested: boolean;
  rules: {
    refundable: boolean;
    changeable: boolean;
    changeFee: number;
    upgradeable: boolean;
    baggageAllowance: number;
    baggagePieces: number;
    carryOnAllowance: number;
    seatSelection: "free" | "paid" | "none";
    mealIncluded: boolean;
    loungeAccess: boolean;
    priorityBoarding: boolean;
  };
}

export interface FlightCounters {
  id: number;
  economyAvailable: number;
  businessAvailable: number;
  economyPrice: number;
  businessPrice: number;
}

/** Per-flight sellable booking classes for search and detail. Sold-out and
 * inactive classes are omitted unless `includeSoldOut`. */
export async function listBookingClasses(
  db: Db,
  flights: FlightCounters[],
  options: { now?: Date; includeSoldOut?: boolean } = {}
): Promise<Map<number, BookingClassAvailability[]>> {
  const result = new Map<number, BookingClassAvailability[]>();
  for (const flight of flights) result.set(flight.id, []);
  if (!flights.length) return result;
  const state = await loadBookingClassState(
    db,
    flights.map(f => f.id),
    { now: options.now }
  );
  for (const flight of flights) {
    const rows = state.filter(
      s => s.inventory.flightId === flight.id && s.fareClass?.active
    );
    if (!rows.length) continue;
    const availability = computeNestedAvailability(toNestedRows(rows), {
      economy: flight.economyAvailable,
      business: flight.businessAvailable,
    });
    const classes = rows
      .map(({ inventory, fareClass, held }) => {
        const fc = fareClass as FareClass;
        const multiplier = Number(fc.basePriceMultiplier);
        const cabinFare =
          inventory.cabinClass === "business"
            ? flight.businessPrice
            : flight.economyPrice;
        return {
          fareClassId: fc.id,
          code: fc.code,
          name: fc.name,
          cabinClass: inventory.cabinClass,
          fareFamily: fc.fareFamily,
          priority: fc.priority,
          priceMultiplier: multiplier,
          baseFare: Math.round(cabinFare * multiplier),
          available: availability.get(fc.id) ?? 0,
          authorized: inventory.authorizedSeats,
          sold: inventory.sold,
          held,
          nested: inventory.nested,
          rules: {
            refundable: fc.refundable,
            changeable: fc.changeable,
            changeFee: fc.changeFee ?? 0,
            upgradeable: fc.upgradeable,
            baggageAllowance: fc.baggageAllowance ?? 23,
            baggagePieces: fc.baggagePieces ?? 1,
            carryOnAllowance: fc.carryOnAllowance ?? 7,
            seatSelection: fc.seatSelection ?? "paid",
            mealIncluded: fc.mealIncluded,
            loungeAccess: fc.loungeAccess,
            priorityBoarding: fc.priorityBoarding,
          },
        } satisfies BookingClassAvailability;
      })
      .filter(c => options.includeSoldOut || c.available > 0)
      .sort(
        (a, b) =>
          a.cabinClass.localeCompare(b.cabinClass) ||
          b.priority - a.priority ||
          a.fareClassId - b.fareClassId
      );
    result.set(flight.id, classes);
  }
  return result;
}

/** The fare class a customer may name on a booking: active, the flight's
 * airline, and the booked cabin. */
export async function resolveSellableFareClass(
  db: Db,
  fareClassId: number,
  airlineId: number,
  cabinClass: Cabin
): Promise<FareClass> {
  const [fareClass] = await db
    .select()
    .from(fareClasses)
    .where(eq(fareClasses.id, fareClassId))
    .limit(1);
  if (
    !fareClass ||
    !fareClass.active ||
    fareClass.airlineId !== airlineId ||
    fareClass.cabinClass !== cabinClass
  )
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Booking class is not sold in this cabin on this flight",
    });
  return fareClass;
}

export interface BookingClassSale {
  flightId: number;
  cabinClass: Cabin;
  fareClassId: number;
  seats: number;
  /** This booking's own hold, excluded from the held count like cabin holds. */
  ownLockId?: number | null;
}

/** Locks the flight's RBD rows and rejects a closed or oversold class. The
 * caller holds the flight row lock, so concurrent sellers serialize here. */
export async function assertBookingClassAvailable(
  tx: Db,
  sale: BookingClassSale,
  now = new Date()
): Promise<FlightBookingClassState> {
  if (!Number.isSafeInteger(sale.seats) || sale.seats <= 0)
    throw new BookingClassUnavailableError("Seat count must be positive");
  const state = await loadBookingClassState(tx, [sale.flightId], {
    now,
    lock: true,
    ownLockId: sale.ownLockId,
  });
  const target = state.find(s => s.inventory.fareClassId === sale.fareClassId);
  if (
    !target ||
    !target.fareClass?.active ||
    target.inventory.cabinClass !== sale.cabinClass ||
    target.fareClass.cabinClass !== sale.cabinClass
  )
    throw new BookingClassUnavailableError(
      "Booking class is not open for sale on this flight"
    );
  const available =
    computeNestedAvailability(toNestedRows(state)).get(sale.fareClassId) ?? 0;
  if (available < sale.seats)
    throw new BookingClassUnavailableError(
      `Only ${available} ${target.fareClass.code} seats available. Requested: ${sale.seats}`
    );
  return target;
}

/** Attach a booking class to a cabin hold inside the booking transaction.
 * From then on the hold counts against the class as well as the cabin. */
export async function holdBookingClass(
  tx: Db,
  sale: BookingClassSale & { lockId: number }
): Promise<void> {
  const [hold] = await tx
    .select({
      id: inventoryLocks.id,
      fareClassId: inventoryLocks.fareClassId,
      numberOfSeats: inventoryLocks.numberOfSeats,
    })
    .from(inventoryLocks)
    .where(eq(inventoryLocks.id, sale.lockId))
    .limit(1)
    .for("update");
  if (!hold || Number(hold.numberOfSeats) !== sale.seats)
    throw new BookingClassUnavailableError(
      "Inventory hold does not match this booking"
    );
  if (hold.fareClassId != null && hold.fareClassId !== sale.fareClassId)
    throw new BookingClassUnavailableError(
      "Inventory hold belongs to a different booking class"
    );
  await assertBookingClassAvailable(tx, { ...sale, ownLockId: sale.lockId });
  await tx
    .update(inventoryLocks)
    .set({ fareClassId: sale.fareClassId })
    .where(eq(inventoryLocks.id, sale.lockId));
}

/** Consume RBD inventory in the same transaction as the cabin decrement. */
export async function sellBookingClass(
  tx: Db,
  sale: BookingClassSale
): Promise<void> {
  const target = await assertBookingClassAvailable(tx, sale);
  const [updated] = await tx
    .update(flightFareClassInventory)
    .set({ sold: sql`${flightFareClassInventory.sold} + ${sale.seats}` })
    .where(
      and(
        eq(flightFareClassInventory.id, target.inventory.id),
        eq(flightFareClassInventory.sold, target.inventory.sold)
      )
    );
  if (updated.affectedRows !== 1)
    throw new BookingClassUnavailableError(
      "Booking class inventory changed during settlement"
    );
}

/** Return sold RBD seats on cancellation or refund, never below zero. */
export async function releaseBookingClassSale(
  tx: Db,
  flightId: number,
  fareClassId: number,
  seats: number
): Promise<void> {
  if (!Number.isSafeInteger(seats) || seats <= 0) return;
  await tx
    .update(flightFareClassInventory)
    .set({
      sold: sql`greatest(0, ${flightFareClassInventory.sold} - ${seats})`,
    })
    .where(
      and(
        eq(flightFareClassInventory.flightId, flightId),
        eq(flightFareClassInventory.fareClassId, fareClassId)
      )
    );
}

/** Backfill: one default class per cabin, authorized to the cabin capacity,
 * with `sold` derived from the cabin counters so a flight that already sold
 * seats keeps the same availability through the new layer. */
export function deriveDefaultInventory(
  flight: {
    id: number;
    economySeats: number;
    businessSeats: number;
    economyAvailable: number;
    businessAvailable: number;
  },
  defaults: Partial<Record<Cabin, number>>
): InsertFlightFareClassInventory[] {
  const rows: InsertFlightFareClassInventory[] = [];
  const cabins: Array<[Cabin, number, number]> = [
    ["economy", flight.economySeats, flight.economyAvailable],
    ["business", flight.businessSeats, flight.businessAvailable],
  ];
  for (const [cabin, seats, available] of cabins) {
    const fareClassId = defaults[cabin];
    if (fareClassId === undefined || seats <= 0) continue;
    rows.push({
      flightId: flight.id,
      fareClassId,
      cabinClass: cabin,
      authorizedSeats: seats,
      sold: Math.min(seats, Math.max(0, seats - available)),
      nested: true,
    });
  }
  return rows;
}
