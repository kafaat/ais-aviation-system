import { and, asc, desc, eq, gte, lte, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import * as schema from "../drizzle/schema";
import {
  InsertUser,
  users,
  airlines,
  airports,
  flights,
  bookings,
  passengers,
  payments,
  type InsertAirline,
  type InsertAirport,
  type InsertFlight,
  type InsertBooking,
  type InsertPassenger,
  type InsertPayment,
} from "../drizzle/schema";
import { ENV } from "./_core/env";

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      const connection = await mysql.createConnection(process.env.DATABASE_URL);
      _db = drizzle(connection, { schema, mode: "default" });
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

// ============ User Functions ============
export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = "admin";
      updateSet.role = "admin";
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db
    .select()
    .from(users)
    .where(eq(users.openId, openId))
    .limit(1);

  return result.length > 0 ? result[0] : undefined;
}

// ============ Flight Functions ============
export async function searchFlights(params: {
  originId: number;
  destinationId: number;
  departureDate: Date;
}) {
  const db = await getDb();
  if (!db) return [];

  const startOfDay = new Date(params.departureDate);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(params.departureDate);
  endOfDay.setHours(23, 59, 59, 999);

  const result = await db
    .select({
      id: flights.id,
      flightNumber: flights.flightNumber,
      departureTime: flights.departureTime,
      arrivalTime: flights.arrivalTime,
      aircraftType: flights.aircraftType,
      status: flights.status,
      economyPrice: flights.economyPrice,
      businessPrice: flights.businessPrice,
      economyAvailable: flights.economyAvailable,
      businessAvailable: flights.businessAvailable,
      airline: {
        code: airlines.code,
        name: airlines.name,
        logo: airlines.logo,
      },
      origin: {
        code: airports.code,
        name: airports.name,
        city: airports.city,
      },
      destination: {
        code: sql<string>`dest.code`,
        name: sql<string>`dest.name`,
        city: sql<string>`dest.city`,
      },
    })
    .from(flights)
    .innerJoin(airlines, eq(flights.airlineId, airlines.id))
    .innerJoin(airports, eq(flights.originId, airports.id))
    .innerJoin(sql`airports as dest`, sql`${flights.destinationId} = dest.id`)
    .where(
      and(
        eq(flights.originId, params.originId),
        eq(flights.destinationId, params.destinationId),
        gte(flights.departureTime, startOfDay),
        lte(flights.departureTime, endOfDay),
        eq(flights.status, "scheduled")
      )
    )
    .orderBy(asc(flights.departureTime));

  return result;
}

export async function getFlightById(id: number) {
  const db = await getDb();
  if (!db) return null;

  const result = await db
    .select({
      id: flights.id,
      flightNumber: flights.flightNumber,
      departureTime: flights.departureTime,
      arrivalTime: flights.arrivalTime,
      aircraftType: flights.aircraftType,
      status: flights.status,
      economySeats: flights.economySeats,
      businessSeats: flights.businessSeats,
      economyPrice: flights.economyPrice,
      businessPrice: flights.businessPrice,
      economyAvailable: flights.economyAvailable,
      businessAvailable: flights.businessAvailable,
      airline: {
        id: airlines.id,
        code: airlines.code,
        name: airlines.name,
        logo: airlines.logo,
      },
      origin: {
        id: airports.id,
        code: airports.code,
        name: airports.name,
        city: airports.city,
        country: airports.country,
      },
      destination: {
        id: sql<number>`dest.id`,
        code: sql<string>`dest.code`,
        name: sql<string>`dest.name`,
        city: sql<string>`dest.city`,
        country: sql<string>`dest.country`,
      },
    })
    .from(flights)
    .innerJoin(airlines, eq(flights.airlineId, airlines.id))
    .innerJoin(airports, eq(flights.originId, airports.id))
    .innerJoin(sql`airports as dest`, sql`${flights.destinationId} = dest.id`)
    .where(eq(flights.id, id))
    .limit(1);

  return result.length > 0 ? result[0] : null;
}

// ============ Booking Functions ============
export async function createBooking(data: InsertBooking) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db.insert(bookings).values(data);
  return result;
}

export async function getBookingsByUserId(userId: number) {
  const db = await getDb();
  if (!db) return [];

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
      checkedIn: bookings.checkedIn,
      createdAt: bookings.createdAt,
      flight: {
        flightNumber: flights.flightNumber,
        departureTime: flights.departureTime,
        arrivalTime: flights.arrivalTime,
        origin: airports.code,
        destination: sql<string>`dest.code`,
      },
    })
    .from(bookings)
    .innerJoin(flights, eq(bookings.flightId, flights.id))
    .innerJoin(airports, eq(flights.originId, airports.id))
    .innerJoin(sql`airports as dest`, sql`${flights.destinationId} = dest.id`)
    .where(eq(bookings.userId, userId))
    .orderBy(desc(bookings.createdAt));

  // Fetch passengers for each booking
  const bookingsWithPassengers = await Promise.all(
    result.map(async booking => {
      const bookingPassengers = await db
        .select()
        .from(passengers)
        .where(eq(passengers.bookingId, booking.id));
      return {
        ...booking,
        passengers: bookingPassengers,
      };
    })
  );

  return bookingsWithPassengers;
}

export async function getBookingByPNR(pnr: string) {
  const db = await getDb();
  if (!db) return null;

  const result = await db
    .select()
    .from(bookings)
    .where(eq(bookings.pnr, pnr))
    .limit(1);

  return result.length > 0 ? result[0] : null;
}

export async function getBookingByIdWithDetails(id: number) {
  const db = await getDb();
  if (!db) return null;

  const result = await db
    .select()
    .from(bookings)
    .where(eq(bookings.id, id))
    .limit(1);

  return result.length > 0 ? result[0] : null;
}

export async function updateBookingStatus(id: number, status: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db
    .update(bookings)
    .set({ status: status as any, updatedAt: new Date() })
    .where(eq(bookings.id, id));
}

// ============ Passenger Functions ============
export async function createPassengers(passengerList: InsertPassenger[]) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.insert(passengers).values(passengerList);
}

export async function getPassengersByBookingId(bookingId: number) {
  const db = await getDb();
  if (!db) return [];

  return await db
    .select()
    .from(passengers)
    .where(eq(passengers.bookingId, bookingId));
}

// ============ Payment Functions ============
export async function createPayment(data: InsertPayment) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db.insert(payments).values(data);
  return result;
}

export async function updatePaymentStatus(
  id: number,
  status: string,
  transactionId?: string
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const updateData: any = { status, updatedAt: new Date() };
  if (transactionId) {
    updateData.transactionId = transactionId;
  }

  await db.update(payments).set(updateData).where(eq(payments.id, id));
}

export async function getPaymentByIdempotencyKey(idempotencyKey: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db
    .select()
    .from(payments)
    .where(eq(payments.idempotencyKey, idempotencyKey))
    .limit(1);

  return result.length > 0 ? result[0] : null;
}

// ============ Admin Functions ============
export async function getAllAirlines() {
  const db = await getDb();
  if (!db) return [];

  return await db.select().from(airlines).where(eq(airlines.active, true));
}

export async function getAllAirports() {
  const db = await getDb();
  if (!db) return [];

  return await db.select().from(airports);
}

export async function createFlight(data: InsertFlight) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db.insert(flights).values(data);
  return result;
}

export async function updateFlightAvailability(
  flightId: number,
  cabinClass: string,
  seats: number
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  if (cabinClass === "economy") {
    await db
      .update(flights)
      .set({ economyAvailable: seats, updatedAt: new Date() })
      .where(eq(flights.id, flightId));
  } else {
    await db
      .update(flights)
      .set({ businessAvailable: seats, updatedAt: new Date() })
      .where(eq(flights.id, flightId));
  }
}

// Helper function to generate unique booking reference
export function generateBookingReference(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let result = "";
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// ============ Stripe-related Functions ============
export async function getBookingByPaymentIntentId(paymentIntentId: string) {
  const db = await getDb();
  if (!db) return null;

  const result = await db
    .select()
    .from(bookings)
    .where(eq(bookings.stripePaymentIntentId, paymentIntentId))
    .limit(1);

  return result.length > 0 ? result[0] : null;
}

export async function getBookingByCheckoutSessionId(sessionId: string) {
  const db = await getDb();
  if (!db) return null;

  const result = await db
    .select()
    .from(bookings)
    .where(eq(bookings.stripeCheckoutSessionId, sessionId))
    .limit(1);

  return result.length > 0 ? result[0] : null;
}

// Export the db instance for direct access when needed
export { getDb as db };
