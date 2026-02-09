/**
 * Self-Service Kiosk Service
 *
 * Handles kiosk device management, passenger authentication at kiosks,
 * check-in processing, seat selection, boarding pass / bag tag generation,
 * ancillary service purchases, and kiosk usage analytics.
 */

import { getDb } from "../db";
import {
  bookings,
  passengers,
  flights,
  airlines,
  airports,
  ancillaryServices,
  bookingAncillaries,
} from "../../drizzle/schema";
import { eq, and, sql, gte, lte } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  int,
  mysqlEnum,
  mysqlTable,
  varchar,
  boolean,
  timestamp,
  text,
  index,
  uniqueIndex,
} from "drizzle-orm/mysql-core";

// ============================================================================
// Schema Definitions (inline)
// ============================================================================

export const kioskDevices = mysqlTable(
  "kiosk_devices",
  {
    id: int("id").autoincrement().primaryKey(),
    kioskCode: varchar("kioskCode", { length: 20 }).notNull().unique(),
    airportId: int("airportId").notNull(),
    terminal: varchar("terminal", { length: 50 }).notNull(),
    location: varchar("location", { length: 255 }).notNull(), // e.g., "Terminal 1, Near Gate A3"
    status: mysqlEnum("status", ["online", "offline", "maintenance"])
      .default("online")
      .notNull(),
    hardwareType: varchar("hardwareType", { length: 100 }),
    hasPrinter: boolean("hasPrinter").default(true).notNull(),
    hasScanner: boolean("hasScanner").default(true).notNull(),
    hasPayment: boolean("hasPayment").default(false).notNull(),
    lastHeartbeat: timestamp("lastHeartbeat"),
    installedAt: timestamp("installedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    airportIdIdx: index("kiosk_devices_airport_id_idx").on(table.airportId),
    statusIdx: index("kiosk_devices_status_idx").on(table.status),
    kioskCodeIdx: uniqueIndex("kiosk_devices_code_unique_idx").on(
      table.kioskCode
    ),
    airportStatusIdx: index("kiosk_devices_airport_status_idx").on(
      table.airportId,
      table.status
    ),
  })
);

export type KioskDevice = typeof kioskDevices.$inferSelect;
export type InsertKioskDevice = typeof kioskDevices.$inferInsert;

export const kioskSessions = mysqlTable(
  "kiosk_sessions",
  {
    id: int("id").autoincrement().primaryKey(),
    kioskId: int("kioskId"),
    bookingId: int("bookingId").notNull(),
    passengerId: int("passengerId"),
    sessionType: mysqlEnum("sessionType", [
      "check_in",
      "seat_change",
      "bag_tag",
      "ancillary",
    ]).notNull(),
    startedAt: timestamp("startedAt").defaultNow().notNull(),
    completedAt: timestamp("completedAt"),
    status: mysqlEnum("status", ["active", "completed", "abandoned", "error"])
      .default("active")
      .notNull(),
    errorMessage: text("errorMessage"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    kioskIdIdx: index("kiosk_sessions_kiosk_id_idx").on(table.kioskId),
    bookingIdIdx: index("kiosk_sessions_booking_id_idx").on(table.bookingId),
    statusIdx: index("kiosk_sessions_status_idx").on(table.status),
    sessionTypeIdx: index("kiosk_sessions_type_idx").on(table.sessionType),
    startedAtIdx: index("kiosk_sessions_started_at_idx").on(table.startedAt),
  })
);

export type KioskSession = typeof kioskSessions.$inferSelect;
export type InsertKioskSession = typeof kioskSessions.$inferInsert;

export const kioskAnalytics = mysqlTable(
  "kiosk_analytics",
  {
    id: int("id").autoincrement().primaryKey(),
    kioskId: int("kioskId").notNull(),
    date: timestamp("date").notNull(),
    totalSessions: int("totalSessions").default(0).notNull(),
    completedSessions: int("completedSessions").default(0).notNull(),
    abandonedSessions: int("abandonedSessions").default(0).notNull(),
    avgSessionDurationSec: int("avgSessionDurationSec").default(0).notNull(),
    boardingPassesPrinted: int("boardingPassesPrinted").default(0).notNull(),
    bagTagsPrinted: int("bagTagsPrinted").default(0).notNull(),
    ancillaryRevenue: int("ancillaryRevenue").default(0).notNull(), // SAR cents
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    kioskIdIdx: index("kiosk_analytics_kiosk_id_idx").on(table.kioskId),
    dateIdx: index("kiosk_analytics_date_idx").on(table.date),
    kioskDateIdx: index("kiosk_analytics_kiosk_date_idx").on(
      table.kioskId,
      table.date
    ),
  })
);

export type KioskAnalytic = typeof kioskAnalytics.$inferSelect;
export type InsertKioskAnalytic = typeof kioskAnalytics.$inferInsert;

// ============================================================================
// Passenger Authentication
// ============================================================================

/**
 * Authenticate a passenger at a kiosk using booking reference and last name.
 * Returns a session token (booking ID) and basic passenger/booking info.
 */
export async function authenticatePassenger(
  bookingRef: string,
  lastName: string
) {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  // Lookup booking by bookingReference or PNR
  const upperRef = bookingRef.toUpperCase().trim();
  const upperLastName = lastName.toUpperCase().trim();

  const matchedBookings = await db
    .select({
      bookingId: bookings.id,
      bookingReference: bookings.bookingReference,
      pnr: bookings.pnr,
      status: bookings.status,
      cabinClass: bookings.cabinClass,
      flightId: bookings.flightId,
      checkedIn: bookings.checkedIn,
      passengerId: passengers.id,
      passengerFirstName: passengers.firstName,
      passengerLastName: passengers.lastName,
      passengerType: passengers.type,
    })
    .from(bookings)
    .innerJoin(passengers, eq(bookings.id, passengers.bookingId))
    .where(
      and(
        sql`(UPPER(${bookings.bookingReference}) = ${upperRef} OR UPPER(${bookings.pnr}) = ${upperRef})`,
        sql`UPPER(${passengers.lastName}) = ${upperLastName}`
      )
    );

  if (matchedBookings.length === 0) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message:
        "No booking found with the provided reference and last name. Please verify your details.",
    });
  }

  // Use the first matching booking
  const booking = matchedBookings[0];

  if (booking.status === "cancelled") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "This booking has been cancelled.",
    });
  }

  if (booking.status === "pending") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "This booking is pending payment. Please complete payment before checking in.",
    });
  }

  // Verify flight is within check-in window (24 hours before departure)
  const [flight] = await db
    .select({
      id: flights.id,
      flightNumber: flights.flightNumber,
      departureTime: flights.departureTime,
      status: flights.status,
    })
    .from(flights)
    .where(eq(flights.id, booking.flightId))
    .limit(1);

  if (!flight) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Associated flight not found.",
    });
  }

  if (flight.status === "cancelled") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "This flight has been cancelled.",
    });
  }

  const now = new Date();
  const departureTime = new Date(flight.departureTime);
  const hoursUntilDeparture =
    (departureTime.getTime() - now.getTime()) / (1000 * 60 * 60);

  if (hoursUntilDeparture > 24) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Check-in is not yet available. Check-in opens 24 hours before departure (${departureTime.toISOString()}).`,
    });
  }

  if (hoursUntilDeparture < 1) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "Check-in is closed. Check-in closes 1 hour before departure. Please proceed to the airline counter.",
    });
  }

  // Create kiosk session
  const [session] = await db.insert(kioskSessions).values({
    bookingId: booking.bookingId,
    passengerId: booking.passengerId,
    sessionType: "check_in",
  });

  // Return all matched passengers for this booking
  const allPassengers = matchedBookings.map(p => ({
    id: p.passengerId,
    firstName: p.passengerFirstName,
    lastName: p.passengerLastName,
    type: p.passengerType,
  }));

  return {
    sessionId: Number(session.insertId),
    bookingId: booking.bookingId,
    bookingReference: booking.bookingReference,
    pnr: booking.pnr,
    flightNumber: flight.flightNumber,
    departureTime: flight.departureTime,
    cabinClass: booking.cabinClass,
    checkedIn: booking.checkedIn,
    passengers: allPassengers,
  };
}

// ============================================================================
// Check-In Data
// ============================================================================

/**
 * Get all check-in data for kiosk display: flight details, passengers,
 * available seats, and ancillary services.
 */
export async function getCheckInData(bookingId: number) {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  // Get booking with flight info
  const [booking] = await db
    .select({
      id: bookings.id,
      bookingReference: bookings.bookingReference,
      pnr: bookings.pnr,
      status: bookings.status,
      cabinClass: bookings.cabinClass,
      checkedIn: bookings.checkedIn,
      flightId: bookings.flightId,
      numberOfPassengers: bookings.numberOfPassengers,
    })
    .from(bookings)
    .where(eq(bookings.id, bookingId))
    .limit(1);

  if (!booking)
    throw new TRPCError({ code: "NOT_FOUND", message: "Booking not found" });

  // Get flight details with airline and airports
  const [flight] = await db
    .select({
      id: flights.id,
      flightNumber: flights.flightNumber,
      departureTime: flights.departureTime,
      arrivalTime: flights.arrivalTime,
      status: flights.status,
      aircraftType: flights.aircraftType,
      economySeats: flights.economySeats,
      businessSeats: flights.businessSeats,
      economyAvailable: flights.economyAvailable,
      businessAvailable: flights.businessAvailable,
      airlineName: airlines.name,
      airlineCode: airlines.code,
    })
    .from(flights)
    .innerJoin(airlines, eq(flights.airlineId, airlines.id))
    .where(eq(flights.id, booking.flightId))
    .limit(1);

  if (!flight)
    throw new TRPCError({ code: "NOT_FOUND", message: "Flight not found" });

  // Get origin and destination airports
  const [flightRoute] = await db
    .select({
      originId: flights.originId,
      destinationId: flights.destinationId,
    })
    .from(flights)
    .where(eq(flights.id, booking.flightId))
    .limit(1);

  const [originAirport] = await db
    .select({ code: airports.code, name: airports.name, city: airports.city })
    .from(airports)
    .where(eq(airports.id, flightRoute.originId))
    .limit(1);

  const [destAirport] = await db
    .select({ code: airports.code, name: airports.name, city: airports.city })
    .from(airports)
    .where(eq(airports.id, flightRoute.destinationId))
    .limit(1);

  // Get passengers for this booking
  const bookingPassengers = await db
    .select()
    .from(passengers)
    .where(eq(passengers.bookingId, bookingId));

  // Get already-taken seats for this flight
  const takenSeats = await db
    .select({ seatNumber: passengers.seatNumber })
    .from(passengers)
    .innerJoin(bookings, eq(passengers.bookingId, bookings.id))
    .where(
      and(
        eq(bookings.flightId, booking.flightId),
        sql`${passengers.seatNumber} IS NOT NULL`,
        sql`${bookings.status} IN ('confirmed', 'completed')`
      )
    );

  const takenSeatNumbers = takenSeats
    .map(s => s.seatNumber)
    .filter((s): s is string => s !== null);

  // Get available ancillary services
  const availableAncillaries = await db
    .select()
    .from(ancillaryServices)
    .where(eq(ancillaryServices.available, true));

  // Get already purchased ancillaries for this booking
  const purchasedAncillaries = await db
    .select({
      id: bookingAncillaries.id,
      ancillaryServiceId: bookingAncillaries.ancillaryServiceId,
      passengerId: bookingAncillaries.passengerId,
      quantity: bookingAncillaries.quantity,
      totalPrice: bookingAncillaries.totalPrice,
      status: bookingAncillaries.status,
      serviceName: ancillaryServices.name,
      serviceCode: ancillaryServices.code,
      category: ancillaryServices.category,
    })
    .from(bookingAncillaries)
    .innerJoin(
      ancillaryServices,
      eq(bookingAncillaries.ancillaryServiceId, ancillaryServices.id)
    )
    .where(
      and(
        eq(bookingAncillaries.bookingId, bookingId),
        eq(bookingAncillaries.status, "active")
      )
    );

  return {
    booking: {
      id: booking.id,
      bookingReference: booking.bookingReference,
      pnr: booking.pnr,
      status: booking.status,
      cabinClass: booking.cabinClass,
      checkedIn: booking.checkedIn,
      numberOfPassengers: booking.numberOfPassengers,
    },
    flight: {
      id: flight.id,
      flightNumber: flight.flightNumber,
      airline: { name: flight.airlineName, code: flight.airlineCode },
      aircraftType: flight.aircraftType,
      origin: {
        code: originAirport?.code,
        name: originAirport?.name,
        city: originAirport?.city,
      },
      destination: {
        code: destAirport?.code,
        name: destAirport?.name,
        city: destAirport?.city,
      },
      departureTime: flight.departureTime,
      arrivalTime: flight.arrivalTime,
      status: flight.status,
    },
    passengers: bookingPassengers.map(p => ({
      id: p.id,
      type: p.type,
      title: p.title,
      firstName: p.firstName,
      lastName: p.lastName,
      seatNumber: p.seatNumber,
      ticketNumber: p.ticketNumber,
      passportNumber: p.passportNumber,
    })),
    seatMap: {
      totalEconomy: flight.economySeats,
      totalBusiness: flight.businessSeats,
      availableEconomy: flight.economyAvailable,
      availableBusiness: flight.businessAvailable,
      takenSeats: takenSeatNumbers,
    },
    ancillaries: {
      available: availableAncillaries.map(a => ({
        id: a.id,
        code: a.code,
        category: a.category,
        name: a.name,
        description: a.description,
        price: a.price,
        currency: a.currency,
      })),
      purchased: purchasedAncillaries,
    },
  };
}

// ============================================================================
// Check-In Processing
// ============================================================================

/**
 * Process kiosk check-in for a booking and specific passenger.
 */
export async function performCheckIn(
  bookingId: number,
  passengerId: number,
  options: {
    seatNumber?: string;
    baggageCount?: number;
  }
) {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  // Verify booking exists and is confirmed
  const [booking] = await db
    .select()
    .from(bookings)
    .where(eq(bookings.id, bookingId))
    .limit(1);

  if (!booking)
    throw new TRPCError({ code: "NOT_FOUND", message: "Booking not found" });

  if (booking.status !== "confirmed" && booking.status !== "completed") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Cannot check in: booking status is '${booking.status}'`,
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

  if (!passenger)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Passenger not found for this booking",
    });

  // Verify flight is still open for check-in
  const [flight] = await db
    .select({
      id: flights.id,
      departureTime: flights.departureTime,
      status: flights.status,
    })
    .from(flights)
    .where(eq(flights.id, booking.flightId))
    .limit(1);

  if (!flight)
    throw new TRPCError({ code: "NOT_FOUND", message: "Flight not found" });

  if (flight.status === "cancelled") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Cannot check in: flight has been cancelled",
    });
  }

  const now = new Date();
  const departureTime = new Date(flight.departureTime);
  const hoursUntilDeparture =
    (departureTime.getTime() - now.getTime()) / (1000 * 60 * 60);

  if (hoursUntilDeparture < 1) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Check-in is closed (less than 1 hour before departure)",
    });
  }

  // Assign seat if provided
  if (options.seatNumber) {
    // Check seat is not already taken
    const [seatTaken] = await db
      .select({ id: passengers.id })
      .from(passengers)
      .innerJoin(bookings, eq(passengers.bookingId, bookings.id))
      .where(
        and(
          eq(bookings.flightId, booking.flightId),
          eq(passengers.seatNumber, options.seatNumber),
          sql`${bookings.status} IN ('confirmed', 'completed')`
        )
      )
      .limit(1);

    if (seatTaken) {
      throw new TRPCError({
        code: "CONFLICT",
        message: `Seat ${options.seatNumber} is already assigned to another passenger`,
      });
    }

    await db
      .update(passengers)
      .set({ seatNumber: options.seatNumber })
      .where(eq(passengers.id, passengerId));
  }

  // Mark booking as checked in
  await db
    .update(bookings)
    .set({ checkedIn: true })
    .where(eq(bookings.id, bookingId));

  // Record session completion
  await db.insert(kioskSessions).values({
    bookingId,
    passengerId,
    sessionType: "check_in",
    status: "completed",
    completedAt: new Date(),
  });

  return {
    success: true,
    bookingId,
    passengerId,
    passengerName: `${passenger.firstName} ${passenger.lastName}`,
    seatNumber: options.seatNumber ?? passenger.seatNumber,
    checkedIn: true,
    message:
      "Check-in completed successfully. You may now print your boarding pass.",
  };
}

// ============================================================================
// Seat Selection
// ============================================================================

/**
 * Select or change seat at kiosk for a specific passenger.
 */
export async function selectSeat(
  bookingId: number,
  passengerId: number,
  seatNumber: string
) {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  // Verify booking
  const [booking] = await db
    .select()
    .from(bookings)
    .where(eq(bookings.id, bookingId))
    .limit(1);

  if (!booking)
    throw new TRPCError({ code: "NOT_FOUND", message: "Booking not found" });

  if (booking.status !== "confirmed" && booking.status !== "completed") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Cannot select seat: booking is not confirmed",
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

  if (!passenger)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Passenger not found for this booking",
    });

  // Check seat availability on this flight
  const [seatTaken] = await db
    .select({ id: passengers.id })
    .from(passengers)
    .innerJoin(bookings, eq(passengers.bookingId, bookings.id))
    .where(
      and(
        eq(bookings.flightId, booking.flightId),
        eq(passengers.seatNumber, seatNumber),
        sql`${bookings.status} IN ('confirmed', 'completed')`,
        sql`${passengers.id} != ${passengerId}`
      )
    )
    .limit(1);

  if (seatTaken) {
    throw new TRPCError({
      code: "CONFLICT",
      message: `Seat ${seatNumber} is already taken`,
    });
  }

  const oldSeat = passenger.seatNumber;

  // Update the seat assignment
  await db
    .update(passengers)
    .set({ seatNumber })
    .where(eq(passengers.id, passengerId));

  // Track session
  await db.insert(kioskSessions).values({
    bookingId,
    passengerId,
    sessionType: "seat_change",
    status: "completed",
    completedAt: new Date(),
  });

  return {
    success: true,
    passengerId,
    passengerName: `${passenger.firstName} ${passenger.lastName}`,
    previousSeat: oldSeat,
    newSeat: seatNumber,
  };
}

// ============================================================================
// Boarding Pass Generation
// ============================================================================

/**
 * Generate boarding pass data for kiosk printing.
 */
export async function printBoardingPass(
  bookingId: number,
  passengerId: number
) {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  // Get booking
  const [booking] = await db
    .select()
    .from(bookings)
    .where(eq(bookings.id, bookingId))
    .limit(1);

  if (!booking)
    throw new TRPCError({ code: "NOT_FOUND", message: "Booking not found" });

  if (!booking.checkedIn) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Passenger must be checked in before printing a boarding pass",
    });
  }

  // Get passenger
  const [passenger] = await db
    .select()
    .from(passengers)
    .where(
      and(eq(passengers.id, passengerId), eq(passengers.bookingId, bookingId))
    )
    .limit(1);

  if (!passenger)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Passenger not found for this booking",
    });

  // Get flight details
  const [flight] = await db
    .select({
      id: flights.id,
      flightNumber: flights.flightNumber,
      departureTime: flights.departureTime,
      arrivalTime: flights.arrivalTime,
      aircraftType: flights.aircraftType,
      airlineName: airlines.name,
      airlineCode: airlines.code,
    })
    .from(flights)
    .innerJoin(airlines, eq(flights.airlineId, airlines.id))
    .where(eq(flights.id, booking.flightId))
    .limit(1);

  if (!flight)
    throw new TRPCError({ code: "NOT_FOUND", message: "Flight not found" });

  // Get airports
  const [flightRoute] = await db
    .select({
      originId: flights.originId,
      destinationId: flights.destinationId,
    })
    .from(flights)
    .where(eq(flights.id, booking.flightId))
    .limit(1);

  const [origin] = await db
    .select({ code: airports.code, name: airports.name, city: airports.city })
    .from(airports)
    .where(eq(airports.id, flightRoute.originId))
    .limit(1);

  const [destination] = await db
    .select({ code: airports.code, name: airports.name, city: airports.city })
    .from(airports)
    .where(eq(airports.id, flightRoute.destinationId))
    .limit(1);

  // Generate a boarding sequence number
  const sequenceResult = await db
    .select({
      count: sql<number>`COUNT(*)`,
    })
    .from(passengers)
    .innerJoin(bookings, eq(passengers.bookingId, bookings.id))
    .where(
      and(
        eq(bookings.flightId, booking.flightId),
        eq(bookings.checkedIn, true),
        sql`${bookings.status} IN ('confirmed', 'completed')`
      )
    );

  const sequence = Number(sequenceResult[0]?.count ?? 1);

  // Compute boarding time (typically 30 minutes before departure)
  const departureTime = new Date(flight.departureTime);
  const boardingTime = new Date(departureTime.getTime() - 30 * 60 * 1000);

  // Generate barcode data (IATA BCBP format simplified)
  const barcodeData = [
    passenger.firstName.charAt(0) + "/" + passenger.lastName,
    booking.pnr,
    flight.flightNumber,
    passenger.seatNumber ?? "---",
    String(sequence).padStart(4, "0"),
  ].join("|");

  // Track boarding pass printing in session
  await db.insert(kioskSessions).values({
    bookingId,
    passengerId,
    sessionType: "check_in",
    status: "completed",
    completedAt: new Date(),
  });

  return {
    boardingPass: {
      passengerName:
        `${passenger.title ?? ""} ${passenger.firstName} ${passenger.lastName}`.trim(),
      ticketNumber: passenger.ticketNumber,
      bookingReference: booking.bookingReference,
      pnr: booking.pnr,
      flight: {
        number: flight.flightNumber,
        airline: flight.airlineName,
        airlineCode: flight.airlineCode,
        date: departureTime.toISOString().split("T")[0],
        departureTime: flight.departureTime,
        arrivalTime: flight.arrivalTime,
        aircraftType: flight.aircraftType,
      },
      origin: {
        code: origin?.code ?? "???",
        name: origin?.name ?? "",
        city: origin?.city ?? "",
      },
      destination: {
        code: destination?.code ?? "???",
        name: destination?.name ?? "",
        city: destination?.city ?? "",
      },
      seat: passenger.seatNumber ?? "N/A",
      cabinClass: booking.cabinClass,
      boardingTime: boardingTime.toISOString(),
      sequence: String(sequence).padStart(4, "0"),
      gate: null, // To be assigned at gate management level
      barcodeData,
      printedAt: new Date().toISOString(),
    },
  };
}

// ============================================================================
// Bag Tag Generation
// ============================================================================

/**
 * Generate bag tag data for kiosk printing.
 */
export async function printBagTag(
  bookingId: number,
  passengerId: number,
  bagCount: number
) {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  if (bagCount < 1 || bagCount > 10) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Bag count must be between 1 and 10",
    });
  }

  // Get booking
  const [booking] = await db
    .select()
    .from(bookings)
    .where(eq(bookings.id, bookingId))
    .limit(1);

  if (!booking)
    throw new TRPCError({ code: "NOT_FOUND", message: "Booking not found" });

  if (!booking.checkedIn) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Passenger must be checked in before printing bag tags",
    });
  }

  // Get passenger
  const [passenger] = await db
    .select()
    .from(passengers)
    .where(
      and(eq(passengers.id, passengerId), eq(passengers.bookingId, bookingId))
    )
    .limit(1);

  if (!passenger)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Passenger not found for this booking",
    });

  // Get flight info for routing
  const [flight] = await db
    .select({
      flightNumber: flights.flightNumber,
      originId: flights.originId,
      destinationId: flights.destinationId,
    })
    .from(flights)
    .where(eq(flights.id, booking.flightId))
    .limit(1);

  if (!flight)
    throw new TRPCError({ code: "NOT_FOUND", message: "Flight not found" });

  const [origin] = await db
    .select({ code: airports.code })
    .from(airports)
    .where(eq(airports.id, flight.originId))
    .limit(1);

  const [destination] = await db
    .select({ code: airports.code })
    .from(airports)
    .where(eq(airports.id, flight.destinationId))
    .limit(1);

  // Generate bag tags (IATA 10-digit license plate format)
  const bagTags = [];
  for (let i = 0; i < bagCount; i++) {
    const tagNumber = `0${Math.floor(1000000000 + Math.random() * 9000000000)
      .toString()
      .slice(0, 9)}`;

    bagTags.push({
      tagNumber,
      passengerName: `${passenger.lastName}/${passenger.firstName.charAt(0)}`,
      flightNumber: flight.flightNumber,
      origin: origin?.code ?? "???",
      destination: destination?.code ?? "???",
      bookingReference: booking.bookingReference,
      sequence: `${i + 1}/${bagCount}`,
      barcodeData: tagNumber,
      printedAt: new Date().toISOString(),
    });
  }

  // Track bag tag session
  await db.insert(kioskSessions).values({
    bookingId,
    passengerId,
    sessionType: "bag_tag",
    status: "completed",
    completedAt: new Date(),
  });

  return {
    bagTags,
    totalBags: bagCount,
    passengerName: `${passenger.firstName} ${passenger.lastName}`,
  };
}

// ============================================================================
// Ancillary Service Purchase at Kiosk
// ============================================================================

/**
 * Add an ancillary service at the kiosk (e.g., extra baggage, meal, lounge).
 */
export async function addAncillary(
  bookingId: number,
  serviceType: string,
  passengerId: number
) {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  // Verify booking
  const [booking] = await db
    .select()
    .from(bookings)
    .where(eq(bookings.id, bookingId))
    .limit(1);

  if (!booking)
    throw new TRPCError({ code: "NOT_FOUND", message: "Booking not found" });

  if (booking.status !== "confirmed" && booking.status !== "completed") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Cannot add ancillary: booking is not confirmed",
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

  if (!passenger)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Passenger not found for this booking",
    });

  // Find the ancillary service by code
  const [service] = await db
    .select()
    .from(ancillaryServices)
    .where(
      and(
        eq(ancillaryServices.code, serviceType),
        eq(ancillaryServices.available, true)
      )
    )
    .limit(1);

  if (!service) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: `Ancillary service '${serviceType}' not found or unavailable`,
    });
  }

  // Check cabin class restrictions
  if (service.applicableCabinClasses) {
    const allowedClasses: string[] = JSON.parse(service.applicableCabinClasses);
    if (!allowedClasses.includes(booking.cabinClass)) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Service '${service.name}' is not available for ${booking.cabinClass} class`,
      });
    }
  }

  // Check for duplicate purchase (same service for same passenger on same booking)
  const [existing] = await db
    .select({ id: bookingAncillaries.id })
    .from(bookingAncillaries)
    .where(
      and(
        eq(bookingAncillaries.bookingId, bookingId),
        eq(bookingAncillaries.passengerId, passengerId),
        eq(bookingAncillaries.ancillaryServiceId, service.id),
        eq(bookingAncillaries.status, "active")
      )
    )
    .limit(1);

  if (existing) {
    throw new TRPCError({
      code: "CONFLICT",
      message: `Service '${service.name}' is already added for this passenger`,
    });
  }

  // Add the ancillary
  const [result] = await db.insert(bookingAncillaries).values({
    bookingId,
    passengerId,
    ancillaryServiceId: service.id,
    quantity: 1,
    unitPrice: service.price,
    totalPrice: service.price,
  });

  // Track session
  await db.insert(kioskSessions).values({
    bookingId,
    passengerId,
    sessionType: "ancillary",
    status: "completed",
    completedAt: new Date(),
  });

  return {
    success: true,
    ancillaryId: Number(result.insertId),
    serviceName: service.name,
    serviceCode: service.code,
    category: service.category,
    price: service.price,
    currency: service.currency,
    passengerName: `${passenger.firstName} ${passenger.lastName}`,
  };
}

// ============================================================================
// Kiosk Device Management
// ============================================================================

/**
 * Get health/status of a specific kiosk device.
 */
export async function getKioskStatus(kioskId: number) {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  const [device] = await db
    .select()
    .from(kioskDevices)
    .where(eq(kioskDevices.id, kioskId))
    .limit(1);

  if (!device)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Kiosk device not found",
    });

  // Get today's session stats for this kiosk
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [sessionStats] = await db
    .select({
      totalSessions: sql<number>`COUNT(*)`,
      completedSessions: sql<number>`SUM(CASE WHEN ${kioskSessions.status} = 'completed' THEN 1 ELSE 0 END)`,
      abandonedSessions: sql<number>`SUM(CASE WHEN ${kioskSessions.status} = 'abandoned' THEN 1 ELSE 0 END)`,
      errorSessions: sql<number>`SUM(CASE WHEN ${kioskSessions.status} = 'error' THEN 1 ELSE 0 END)`,
    })
    .from(kioskSessions)
    .where(
      and(
        eq(kioskSessions.kioskId, kioskId),
        gte(kioskSessions.startedAt, today)
      )
    );

  // Determine if device is responsive
  const lastHeartbeat = device.lastHeartbeat
    ? new Date(device.lastHeartbeat)
    : null;
  const isResponsive = lastHeartbeat
    ? new Date().getTime() - lastHeartbeat.getTime() < 5 * 60 * 1000 // 5 min threshold
    : false;

  return {
    device: {
      id: device.id,
      kioskCode: device.kioskCode,
      airportId: device.airportId,
      terminal: device.terminal,
      location: device.location,
      status: device.status,
      hardwareType: device.hardwareType,
      hasPrinter: device.hasPrinter,
      hasScanner: device.hasScanner,
      hasPayment: device.hasPayment,
      lastHeartbeat: device.lastHeartbeat,
      installedAt: device.installedAt,
      isResponsive,
    },
    todayStats: {
      totalSessions: Number(sessionStats?.totalSessions ?? 0),
      completedSessions: Number(sessionStats?.completedSessions ?? 0),
      abandonedSessions: Number(sessionStats?.abandonedSessions ?? 0),
      errorSessions: Number(sessionStats?.errorSessions ?? 0),
    },
  };
}

/**
 * Register a new kiosk device at an airport.
 */
export async function registerKiosk(
  airportId: number,
  terminal: string,
  location: string,
  options?: {
    hardwareType?: string;
    hasPrinter?: boolean;
    hasScanner?: boolean;
    hasPayment?: boolean;
  }
) {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  // Verify airport exists
  const [airport] = await db
    .select({ id: airports.id, code: airports.code })
    .from(airports)
    .where(eq(airports.id, airportId))
    .limit(1);

  if (!airport)
    throw new TRPCError({ code: "NOT_FOUND", message: "Airport not found" });

  // Generate unique kiosk code: airport code + terminal abbreviation + sequence
  const existingKiosks = await db
    .select({ id: kioskDevices.id })
    .from(kioskDevices)
    .where(eq(kioskDevices.airportId, airportId));

  const sequenceNumber = existingKiosks.length + 1;
  const terminalAbbrev = terminal
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(0, 3)
    .toUpperCase();
  const kioskCode = `${airport.code}-${terminalAbbrev}-${String(sequenceNumber).padStart(3, "0")}`;

  const [result] = await db.insert(kioskDevices).values({
    kioskCode,
    airportId,
    terminal,
    location,
    hardwareType: options?.hardwareType ?? null,
    hasPrinter: options?.hasPrinter ?? true,
    hasScanner: options?.hasScanner ?? true,
    hasPayment: options?.hasPayment ?? false,
    status: "online",
    installedAt: new Date(),
    lastHeartbeat: new Date(),
  });

  return {
    id: Number(result.insertId),
    kioskCode,
    airportId,
    terminal,
    location,
    status: "online" as const,
  };
}

/**
 * Get all kiosk devices, optionally filtered by airport.
 */
export async function getKioskDevices(filters?: {
  airportId?: number;
  status?: "online" | "offline" | "maintenance";
}) {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  const conditions = [];
  if (filters?.airportId)
    conditions.push(eq(kioskDevices.airportId, filters.airportId));
  if (filters?.status) conditions.push(eq(kioskDevices.status, filters.status));

  if (conditions.length > 0) {
    return await db
      .select({
        id: kioskDevices.id,
        kioskCode: kioskDevices.kioskCode,
        airportId: kioskDevices.airportId,
        terminal: kioskDevices.terminal,
        location: kioskDevices.location,
        status: kioskDevices.status,
        hardwareType: kioskDevices.hardwareType,
        hasPrinter: kioskDevices.hasPrinter,
        hasScanner: kioskDevices.hasScanner,
        hasPayment: kioskDevices.hasPayment,
        lastHeartbeat: kioskDevices.lastHeartbeat,
        installedAt: kioskDevices.installedAt,
        airportCode: airports.code,
        airportName: airports.name,
      })
      .from(kioskDevices)
      .innerJoin(airports, eq(kioskDevices.airportId, airports.id))
      .where(and(...conditions));
  }

  return await db
    .select({
      id: kioskDevices.id,
      kioskCode: kioskDevices.kioskCode,
      airportId: kioskDevices.airportId,
      terminal: kioskDevices.terminal,
      location: kioskDevices.location,
      status: kioskDevices.status,
      hardwareType: kioskDevices.hardwareType,
      hasPrinter: kioskDevices.hasPrinter,
      hasScanner: kioskDevices.hasScanner,
      hasPayment: kioskDevices.hasPayment,
      lastHeartbeat: kioskDevices.lastHeartbeat,
      installedAt: kioskDevices.installedAt,
      airportCode: airports.code,
      airportName: airports.name,
    })
    .from(kioskDevices)
    .innerJoin(airports, eq(kioskDevices.airportId, airports.id));
}

// ============================================================================
// Kiosk Analytics
// ============================================================================

/**
 * Get kiosk usage analytics for an airport within a date range.
 */
export async function getKioskAnalytics(
  airportId: number,
  dateRange: { from: Date; to: Date }
) {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  // Get all kiosks at the airport
  const airportKiosks = await db
    .select({
      id: kioskDevices.id,
      kioskCode: kioskDevices.kioskCode,
      terminal: kioskDevices.terminal,
      location: kioskDevices.location,
      status: kioskDevices.status,
    })
    .from(kioskDevices)
    .where(eq(kioskDevices.airportId, airportId));

  if (airportKiosks.length === 0) {
    return {
      airportId,
      dateRange,
      kiosks: [],
      totals: {
        totalSessions: 0,
        completedSessions: 0,
        abandonedSessions: 0,
        errorSessions: 0,
        avgCompletionRate: 0,
        boardingPassesPrinted: 0,
        bagTagsPrinted: 0,
      },
    };
  }

  const kioskIds = airportKiosks.map(k => k.id);

  // Get session stats per kiosk from kioskSessions table
  const sessionStats = await db
    .select({
      kioskId: kioskSessions.kioskId,
      totalSessions: sql<number>`COUNT(*)`,
      completedSessions: sql<number>`SUM(CASE WHEN ${kioskSessions.status} = 'completed' THEN 1 ELSE 0 END)`,
      abandonedSessions: sql<number>`SUM(CASE WHEN ${kioskSessions.status} = 'abandoned' THEN 1 ELSE 0 END)`,
      errorSessions: sql<number>`SUM(CASE WHEN ${kioskSessions.status} = 'error' THEN 1 ELSE 0 END)`,
      checkInSessions: sql<number>`SUM(CASE WHEN ${kioskSessions.sessionType} = 'check_in' THEN 1 ELSE 0 END)`,
      bagTagSessions: sql<number>`SUM(CASE WHEN ${kioskSessions.sessionType} = 'bag_tag' THEN 1 ELSE 0 END)`,
      ancillarySessions: sql<number>`SUM(CASE WHEN ${kioskSessions.sessionType} = 'ancillary' THEN 1 ELSE 0 END)`,
      avgDuration: sql<number>`AVG(TIMESTAMPDIFF(SECOND, ${kioskSessions.startedAt}, ${kioskSessions.completedAt}))`,
    })
    .from(kioskSessions)
    .where(
      and(
        sql`${kioskSessions.kioskId} IN (${sql.raw(kioskIds.join(","))})`,
        gte(kioskSessions.startedAt, dateRange.from),
        lte(kioskSessions.startedAt, dateRange.to)
      )
    )
    .groupBy(kioskSessions.kioskId);

  // Build per-kiosk analytics
  const kioskAnalyticsData = airportKiosks.map(kiosk => {
    const stats = sessionStats.find(s => s.kioskId === kiosk.id);
    const total = Number(stats?.totalSessions ?? 0);
    const completed = Number(stats?.completedSessions ?? 0);

    return {
      kioskId: kiosk.id,
      kioskCode: kiosk.kioskCode,
      terminal: kiosk.terminal,
      location: kiosk.location,
      status: kiosk.status,
      totalSessions: total,
      completedSessions: completed,
      abandonedSessions: Number(stats?.abandonedSessions ?? 0),
      errorSessions: Number(stats?.errorSessions ?? 0),
      completionRate: total > 0 ? Math.round((completed / total) * 100) : 0,
      checkInSessions: Number(stats?.checkInSessions ?? 0),
      bagTagSessions: Number(stats?.bagTagSessions ?? 0),
      ancillarySessions: Number(stats?.ancillarySessions ?? 0),
      avgSessionDurationSec: Number(stats?.avgDuration ?? 0),
    };
  });

  // Calculate totals
  const totalSessions = kioskAnalyticsData.reduce(
    (sum, k) => sum + k.totalSessions,
    0
  );
  const completedSessions = kioskAnalyticsData.reduce(
    (sum, k) => sum + k.completedSessions,
    0
  );
  const abandonedSessions = kioskAnalyticsData.reduce(
    (sum, k) => sum + k.abandonedSessions,
    0
  );
  const errorSessions = kioskAnalyticsData.reduce(
    (sum, k) => sum + k.errorSessions,
    0
  );
  const boardingPassesPrinted = kioskAnalyticsData.reduce(
    (sum, k) => sum + k.checkInSessions,
    0
  );
  const bagTagsPrinted = kioskAnalyticsData.reduce(
    (sum, k) => sum + k.bagTagSessions,
    0
  );

  return {
    airportId,
    dateRange: {
      from: dateRange.from.toISOString(),
      to: dateRange.to.toISOString(),
    },
    kiosks: kioskAnalyticsData,
    totals: {
      totalSessions,
      completedSessions,
      abandonedSessions,
      errorSessions,
      avgCompletionRate:
        totalSessions > 0
          ? Math.round((completedSessions / totalSessions) * 100)
          : 0,
      boardingPassesPrinted,
      bagTagsPrinted,
    },
  };
}
