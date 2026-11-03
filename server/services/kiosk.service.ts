import { createHash } from "node:crypto";
import { getCheckedInPassengerContext } from "./boarding-pass.service";
import { assertTenantOperational } from "./tenant.service";
import { checkInPassengersTx } from "./departure-control.service";
import {
  selectSeat as assignPhysicalSeat,
  getPassengerSeat,
  generateBoardingPass,
} from "./seat-map.service";
export {
  kioskDevices,
  kioskSessions,
  kioskAnalytics,
} from "../../drizzle/schema";
/**
 * Self-Service Kiosk Service
 *
 * Handles kiosk device management, passenger authentication at kiosks,
 * check-in processing, seat selection, boarding pass / bag tag generation,
 * existing ancillary details, and kiosk usage analytics.
 */

import { getDb } from "../db";
import {
  kioskDevices,
  kioskSessions,
  kioskAnalytics,
  baggageItems,
  baggageCustodyEvents,
  bookingSegments,
  bookings,
  passengers,
  flights,
  airlines,
  airports,
  ancillaryServices,
  bookingAncillaries,
} from "../../drizzle/schema";
import { eq, and, desc, inArray, sql, gte, lte } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

// ============================================================================
// Schema Definitions (canonical imports)
// ============================================================================

export type KioskDevice = typeof kioskDevices.$inferSelect;
export type InsertKioskDevice = typeof kioskDevices.$inferInsert;

export type KioskSession = typeof kioskSessions.$inferSelect;
export type InsertKioskSession = typeof kioskSessions.$inferInsert;

export type KioskAnalytic = typeof kioskAnalytics.$inferSelect;
export type InsertKioskAnalytic = typeof kioskAnalytics.$inferInsert;

// ============================================================================
// Passenger Authentication
// ============================================================================

function assertKioskWindow(departureTime: Date) {
  const now = new Date();
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
}

/**
 * Authenticate a passenger at a kiosk using booking reference and last name.
 * Returns a session token (booking ID) and basic passenger/booking info.
 */
export async function authenticatePassenger(
  bookingRef: string,
  lastName: string,
  flightId?: number
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

  const selectedFlightId = flightId ?? booking.flightId;
  if (flightId !== undefined) {
    const legs = await db
      .select()
      .from(bookingSegments)
      .where(eq(bookingSegments.bookingId, booking.bookingId));
    if (
      legs.length
        ? legs.filter(
            leg => leg.flightId === flightId && leg.status === "confirmed"
          ).length !== 1
        : flightId !== booking.flightId
    ) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Active booked sector not found",
      });
    }
  }

  // Verify the selected sector is within the kiosk window.
  const [flight] = await db
    .select({
      id: flights.id,
      flightNumber: flights.flightNumber,
      departureTime: flights.departureTime,
      status: flights.status,
    })
    .from(flights)
    .where(eq(flights.id, selectedFlightId))
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

  assertKioskWindow(new Date(flight.departureTime));

  // Create kiosk session
  const [session] = await db.insert(kioskSessions).values({
    bookingId: booking.bookingId,
    passengerId: booking.passengerId,
    sessionType: "check_in",
  });

  // Return all matched passengers for this booking
  const allPassengers = matchedBookings
    .filter(p => p.bookingId === booking.bookingId)
    .map(p => ({
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
export async function getCheckInData(
  bookingId: number,
  passengerIds: number[]
) {
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

  // A reference/surname session may cover only part of a family booking.
  const bookingPassengers = await db
    .select()
    .from(passengers)
    .where(
      and(
        eq(passengers.bookingId, bookingId),
        inArray(passengers.id, passengerIds)
      )
    );

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
        inArray(bookingAncillaries.passengerId, passengerIds),
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
      // A kiosk session has no collection or no-charge authorization for a sale.
      available: [],
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
    flightId?: number;
  }
) {
  const database = getDb();
  if (!database) throw new Error("Database unavailable");
  return await database.transaction(async tx => {
    const [result] = await checkInPassengersTx(tx, {
      bookingId,
      flightId: options.flightId,
      assignments: [{ passengerId, seatNumber: options.seatNumber }],
    });
    if (!result) throw new Error("Check-in did not return a seat");
    const [p] = await tx
      .select()
      .from(passengers)
      .where(eq(passengers.id, passengerId));
    await tx.insert(kioskSessions).values({
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
      passengerName: `${p.firstName} ${p.lastName}`,
      seatNumber: result.seat.seatNumber,
      checkedIn: true,
      message:
        "Check-in completed successfully. You may now print your boarding pass.",
    };
  });
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
  seatNumber: string,
  flightId?: number
) {
  const db = getDb();
  if (!db) throw new Error("Database unavailable");
  const [b] = await db
    .select()
    .from(bookings)
    .where(eq(bookings.id, bookingId));
  if (!b)
    throw new TRPCError({ code: "NOT_FOUND", message: "Booking not found" });
  const previous = await getPassengerSeat(bookingId, passengerId, flightId);
  const seat = await assignPhysicalSeat(
    flightId ?? b.flightId,
    seatNumber,
    bookingId,
    passengerId
  );
  const [p] = await db
    .select()
    .from(passengers)
    .where(eq(passengers.id, passengerId));
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
    passengerName: `${p.firstName} ${p.lastName}`,
    previousSeat: previous?.seatNumber ?? null,
    newSeat: seat.seatNumber,
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
  passengerId: number,
  flightId?: number
) {
  const db = getDb();
  if (!db) throw new Error("Database unavailable");
  const [b] = await db
    .select()
    .from(bookings)
    .where(eq(bookings.id, bookingId));
  const [p] = await db
    .select()
    .from(passengers)
    .where(
      and(eq(passengers.id, passengerId), eq(passengers.bookingId, bookingId))
    );
  if (!b || !p)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Passenger booking unavailable",
    });
  const data = await generateBoardingPass(flightId ?? b.flightId, passengerId);
  const [flight] = await db
    .select()
    .from(flights)
    .where(eq(flights.id, flightId ?? b.flightId));
  return {
    boardingPass: {
      passengerName: `${p.firstName} ${p.lastName}`,
      ticketNumber: p.ticketNumber,
      bookingReference: b.bookingReference,
      pnr: b.pnr,
      flight: {
        number: data.flightNumber,
        airline: data.airline.name,
        airlineCode: data.airline.code,
        date: data.departureTime.toISOString().split("T")[0],
        departureTime: data.departureTime,
        arrivalTime: data.arrivalTime,
        aircraftType: flight.aircraftType,
      },
      origin: data.origin,
      destination: data.destination,
      seat: data.seat.seatNumber,
      cabinClass: b.cabinClass,
      boardingTime: (
        data.boardingTime ?? new Date(data.departureTime.getTime() - 1800000)
      ).toISOString(),
      sequence: String(data.seat.boardingSequence).padStart(4, "0"),
      gate: data.gate,
      barcodeData: data.barcodeData,
      bcbp: data.bcbp,
      printedAt: data.issuedAt.toISOString(),
    },
  };
}

// ============================================================================
// Bag Tag Generation
// ============================================================================

type TagReceipt = { bookingRef: string; lastName: string; tagNumber: string };

function missingReceipt() {
  return new TRPCError({
    code: "NOT_FOUND",
    message: "Registered tag unavailable for this passenger.",
  });
}

/** Resolve just the bag identified by a passenger's receipt. No kiosk session is issued. */
export async function reprintRegisteredTag(
  receipt: TagReceipt & { expectedVersion?: string }
) {
  const db = getDb();
  if (!db) throw new Error("Database unavailable");
  const reference = receipt.bookingRef.trim().toUpperCase();
  const surname = receipt.lastName.trim().toUpperCase();
  const [observed] = await db
    .select({
      bookingId: baggageItems.bookingId,
      passengerId: baggageItems.passengerId,
      flightId: baggageCustodyEvents.flightId,
    })
    .from(baggageItems)
    .innerJoin(bookings, eq(bookings.id, baggageItems.bookingId))
    .innerJoin(
      passengers,
      and(
        eq(passengers.id, baggageItems.passengerId),
        eq(passengers.bookingId, bookings.id)
      )
    )
    .innerJoin(
      baggageCustodyEvents,
      eq(baggageCustodyEvents.baggageId, baggageItems.id)
    )
    .where(
      and(
        eq(baggageItems.tagNumber, receipt.tagNumber),
        sql`(UPPER(${bookings.bookingReference}) = ${reference} OR UPPER(${bookings.pnr}) = ${reference})`,
        sql`UPPER(${passengers.lastName}) = ${surname}`
      )
    )
    .orderBy(
      desc(baggageCustodyEvents.observedAt),
      desc(baggageCustodyEvents.id)
    )
    .limit(1);
  if (!observed) throw missingReceipt();
  const document = await printBagTag(
    observed.bookingId,
    observed.passengerId,
    1,
    observed.flightId,
    [receipt.tagNumber],
    receipt
  );
  // This version is an optimistic concurrency check, never an authorization.
  // A custody move to another identically named flight requires a fresh lookup.
  const documentVersion = createHash("sha256")
    .update(
      JSON.stringify([
        observed.bookingId,
        observed.passengerId,
        observed.flightId,
        document,
      ])
    )
    .digest("hex");
  if (receipt.expectedVersion && receipt.expectedVersion !== documentVersion)
    throw new TRPCError({
      code: "CONFLICT",
      message:
        "The bag tag has changed. Review the current passenger and sector before reprinting.",
    });
  return { ...document, documentVersion };
}

/** Prepare copies of identified physical tags. Only the printer can confirm output. */
export async function printBagTag(
  bookingId: number,
  passengerId: number,
  bagCount: number,
  flightId?: number,
  tagNumbers?: string[],
  receipt?: TagReceipt
) {
  const db = getDb();
  if (!db) throw new Error("Database unavailable");
  if (
    !Number.isInteger(bagCount) ||
    bagCount < 1 ||
    bagCount > 10 ||
    !tagNumbers ||
    tagNumbers.length !== bagCount ||
    new Set(tagNumbers).size !== bagCount
  ) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "Provide the distinct registered tag number for each bag to reprint.",
    });
  }

  return await db.transaction(async tx => {
    const {
      context: { booking, flight, legs },
      passenger,
    } = await getCheckedInPassengerContext(tx, {
      bookingId,
      passengerId,
      flightId,
    });
    if (receipt) {
      // Recheck identity under the same locks as the actual document. The
      // lookup can race a correction to the booking, passenger or station data.
      const reference = receipt.bookingRef.trim().toUpperCase();
      if (
        (booking.bookingReference.toUpperCase() !== reference &&
          booking.pnr.toUpperCase() !== reference) ||
        passenger.lastName.toUpperCase() !==
          receipt.lastName.trim().toUpperCase()
      )
        throw missingReceipt();
      assertKioskWindow(new Date(flight.departureTime));
    }
    if (
      (legs.length &&
        legs.filter(
          leg => leg.flightId === flight.id && leg.status === "confirmed"
        ).length !== 1) ||
      flight.tenantId !== booking.tenantId ||
      passenger.tenantId !== booking.tenantId
    ) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Passenger sector requires airline review",
      });
    }
    await assertTenantOperational(tx, booking.tenantId);

    const route = await tx
      .select()
      .from(airports)
      .where(inArray(airports.id, [flight.originId, flight.destinationId]));
    const origin = route.find(airport => airport.id === flight.originId)?.code;
    const destination = route.find(
      airport => airport.id === flight.destinationId
    )?.code;
    if (!origin || !destination)
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Airport routing unavailable",
      });

    // Custody ingestion takes the same booking lock. A later load or arrival
    // invalidates earlier acceptance even if that earlier event matches the flight.
    const bags = await tx
      .select()
      .from(baggageItems)
      .where(
        and(
          eq(baggageItems.bookingId, bookingId),
          eq(baggageItems.passengerId, passengerId),
          inArray(baggageItems.tagNumber, tagNumbers)
        )
      )
      .for("update");
    const bagTags = [];
    const unavailable = () =>
      new TRPCError({
        code: "PRECONDITION_FAILED",
        message:
          "Registered baggage is unavailable for reprint on this sector. Contact the airline desk.",
      });
    for (const tagNumber of tagNumbers) {
      const bag = bags.find(item => item.tagNumber === tagNumber);
      if (!bag || bag.returnEventId != null) throw unavailable();
      const [latest] = await tx
        .select()
        .from(baggageCustodyEvents)
        .where(eq(baggageCustodyEvents.baggageId, bag.id))
        .orderBy(
          desc(baggageCustodyEvents.observedAt),
          desc(baggageCustodyEvents.id)
        )
        .limit(1);
      const eligible =
        latest?.stage === "transfer"
          ? bag.status === "loading"
          : latest?.stage === "acceptance" && bag.status === "checked_in";
      if (
        !eligible ||
        latest.flightId !== flight.id ||
        latest.airportId !== flight.originId
      )
        throw unavailable();
      bagTags.push({
        tagNumber: bag.tagNumber,
        passengerName: `${passenger.lastName}/${passenger.firstName.charAt(0)}`,
        flightNumber: flight.flightNumber,
        origin,
        destination,
        bookingReference: booking.bookingReference,
        sequence: `${bagTags.length + 1}/${bagCount}`,
        barcodeData: bag.tagNumber,
        printedAt: null,
      });
    }
    return {
      bagTags,
      totalBags: bagTags.length,
      passengerName: `${passenger.firstName} ${passenger.lastName}`,
      printStatus: "document_ready" as const,
    };
  });
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
    hasPrinter: options?.hasPrinter ?? false,
    hasScanner: options?.hasScanner ?? false,
    hasPayment: options?.hasPayment ?? false,
    status: "offline",
    installedAt: new Date(),
    lastHeartbeat: null,
  });

  return {
    id: Number(result.insertId),
    kioskCode,
    airportId,
    terminal,
    location,
    status: "offline" as const,
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
