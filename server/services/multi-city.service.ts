import { TRPCError } from "@trpc/server";
import { eq, and } from "drizzle-orm";
import * as db from "../db";
import {
  bookingSegments,
  bookings,
  flights,
  airports,
  airlines,
} from "../../drizzle/schema";
import {
  checkFlightAvailability,
  calculateFlightPrice,
} from "./flights.service";
import { trackBookingStarted } from "./metrics.service";

/**
 * Multi-City Flights Service
 * Handles search, pricing, and booking for multi-city itineraries
 */

// ============ Types ============

export interface MultiCitySegment {
  originId: number;
  destinationId: number;
  departureDate: Date;
}

export interface MultiCitySearchResult {
  segmentIndex: number;
  flights: Awaited<ReturnType<typeof db.searchFlights>>;
}

export interface MultiCityPriceResult {
  segments: Array<{
    segmentIndex: number;
    flightId: number;
    basePrice: number;
    discountedPrice: number;
    cabinClass: "economy" | "business";
  }>;
  subtotal: number;
  discount: number;
  discountPercentage: number;
  totalPrice: number;
}

export interface MultiCityBookingInput {
  userId: number;
  segments: Array<{
    flightId: number;
    departureDate: Date;
  }>;
  cabinClass: "economy" | "business";
  passengers: Array<{
    type: "adult" | "child" | "infant";
    title?: string;
    firstName: string;
    lastName: string;
    dateOfBirth?: Date;
    passportNumber?: string;
    nationality?: string;
  }>;
  sessionId: string;
}

export interface SegmentDetails {
  id: number;
  segmentOrder: number;
  flightId: number;
  departureDate: Date;
  status: string;
  flight: {
    id: number;
    flightNumber: string;
    departureTime: Date;
    arrivalTime: Date;
    status: string;
    airline: {
      code: string;
      name: string;
      logo: string | null;
    };
    origin: {
      code: string;
      name: string;
      city: string;
    };
    destination: {
      code: string;
      name: string;
      city: string;
    };
  };
}

// ============ Constants ============

/**
 * Multi-city discount tiers based on number of segments
 */
const MULTI_CITY_DISCOUNTS = {
  2: 0, // No discount for 2 segments (minimum)
  3: 5, // 5% discount for 3 segments
  4: 8, // 8% discount for 4 segments
  5: 10, // 10% discount for 5+ segments
} as const;

const MAX_SEGMENTS = 5;
const MIN_SEGMENTS = 2;

// ============ Service Functions ============

/**
 * Search for flights for multiple city segments
 * Returns available flights for each segment independently
 */
export async function searchMultiCityFlights(
  segments: MultiCitySegment[]
): Promise<MultiCitySearchResult[]> {
  // Validate segment count
  if (segments.length < MIN_SEGMENTS) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Multi-city search requires at least ${MIN_SEGMENTS} segments`,
    });
  }

  if (segments.length > MAX_SEGMENTS) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Multi-city search supports maximum ${MAX_SEGMENTS} segments`,
    });
  }

  // Validate segment dates are in order
  for (let i = 1; i < segments.length; i++) {
    if (segments[i].departureDate < segments[i - 1].departureDate) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Departure dates must be in chronological order",
      });
    }
  }

  try {
    // Search for flights for each segment in parallel
    const searchPromises = segments.map(async (segment, index) => {
      const flights = await db.searchFlights({
        originId: segment.originId,
        destinationId: segment.destinationId,
        departureDate: segment.departureDate,
      });

      return {
        segmentIndex: index,
        flights,
      };
    });

    const results = await Promise.all(searchPromises);
    return results;
  } catch (error) {
    if (error instanceof TRPCError) {
      throw error;
    }
    console.error("Error searching multi-city flights:", error);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to search multi-city flights",
    });
  }
}

/**
 * Calculate total price for multi-city booking with applicable discounts
 */
export async function calculateMultiCityPrice(
  segments: Array<{ flightId: number; cabinClass: "economy" | "business" }>,
  passengerCount: number
): Promise<MultiCityPriceResult> {
  if (segments.length < MIN_SEGMENTS) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Multi-city booking requires at least ${MIN_SEGMENTS} segments`,
    });
  }

  if (segments.length > MAX_SEGMENTS) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Multi-city booking supports maximum ${MAX_SEGMENTS} segments`,
    });
  }

  try {
    // Calculate price for each segment
    const segmentPrices = await Promise.all(
      segments.map(async (segment, index) => {
        const { available, flight } = await checkFlightAvailability(
          segment.flightId,
          segment.cabinClass,
          passengerCount
        );

        if (!available || !flight) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Not enough seats available for segment ${index + 1}`,
          });
        }

        const pricingResult = await calculateFlightPrice(
          flight,
          segment.cabinClass,
          passengerCount
        );

        return {
          segmentIndex: index,
          flightId: segment.flightId,
          basePrice: pricingResult.price,
          cabinClass: segment.cabinClass,
        };
      })
    );

    // Calculate subtotal
    const subtotal = segmentPrices.reduce(
      (sum, segment) => sum + segment.basePrice,
      0
    );

    // Determine discount percentage based on segment count
    const discountPercentage = getMultiCityDiscount(segments.length);

    // Calculate discount amount
    const discount = Math.round(subtotal * (discountPercentage / 100));

    // Calculate total price
    const totalPrice = subtotal - discount;

    return {
      segments: segmentPrices.map(segment => ({
        ...segment,
        discountedPrice: Math.round(
          segment.basePrice * (1 - discountPercentage / 100)
        ),
      })),
      subtotal,
      discount,
      discountPercentage,
      totalPrice,
    };
  } catch (error) {
    if (error instanceof TRPCError) {
      throw error;
    }
    console.error("Error calculating multi-city price:", error);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to calculate multi-city price",
    });
  }
}

/**
 * Create a multi-city booking with multiple segments
 */
export async function createMultiCityBooking(
  input: MultiCityBookingInput
): Promise<{
  bookingId: number;
  bookingReference: string;
  pnr: string;
  totalAmount: number;
  segments: Array<{ segmentId: number; flightId: number }>;
}> {
  const database = await db.getDb();
  if (!database) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });
  }

  try {
    // Validate and calculate pricing
    const priceResult = await calculateMultiCityPrice(
      input.segments.map(s => ({
        flightId: s.flightId,
        cabinClass: input.cabinClass,
      })),
      input.passengers.length
    );

    // Generate booking reference and PNR
    const bookingReference = db.generateBookingReference();
    const pnr = db.generateBookingReference();

    // Create the main booking record
    // For multi-city, we use the first segment's flight as the primary flightId
    const bookingResult = await database.insert(bookings).values({
      userId: input.userId,
      flightId: input.segments[0].flightId, // Primary flight (first segment)
      bookingReference,
      pnr,
      status: "pending",
      totalAmount: priceResult.totalPrice,
      cabinClass: input.cabinClass,
      numberOfPassengers: input.passengers.length,
    });

    const bookingId =
      (bookingResult as unknown as { insertId: number }).insertId ||
      (bookingResult as unknown as Array<{ insertId: number }>)[0]?.insertId;

    if (!bookingId) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to create booking",
      });
    }

    // Create booking segments
    const segmentResults: Array<{ segmentId: number; flightId: number }> = [];

    for (let i = 0; i < input.segments.length; i++) {
      const segment = input.segments[i];
      const segmentResult = await database.insert(bookingSegments).values({
        bookingId,
        segmentOrder: i + 1,
        flightId: segment.flightId,
        departureDate: segment.departureDate,
        status: "pending",
      });

      const segmentId =
        (segmentResult as unknown as { insertId: number }).insertId ||
        (segmentResult as unknown as Array<{ insertId: number }>)[0]?.insertId;

      segmentResults.push({
        segmentId,
        flightId: segment.flightId,
      });
    }

    // Create passengers
    const passengersData = input.passengers.map(p => ({
      bookingId,
      type: p.type,
      title: p.title,
      firstName: p.firstName,
      lastName: p.lastName,
      dateOfBirth: p.dateOfBirth,
      passportNumber: p.passportNumber,
      nationality: p.nationality,
    }));

    await db.createPassengers(passengersData);

    // Track booking started event
    trackBookingStarted({
      userId: input.userId,
      sessionId: input.sessionId,
      bookingId,
      flightId: input.segments[0].flightId,
      cabinClass: input.cabinClass,
      passengerCount: input.passengers.length,
      totalAmount: priceResult.totalPrice,
    });

    return {
      bookingId,
      bookingReference,
      pnr,
      totalAmount: priceResult.totalPrice,
      segments: segmentResults,
    };
  } catch (error) {
    if (error instanceof TRPCError) {
      throw error;
    }
    console.error("Error creating multi-city booking:", error);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to create multi-city booking",
    });
  }
}

/**
 * Get all segments for a booking
 */
export async function getBookingSegments(
  bookingId: number
): Promise<SegmentDetails[]> {
  const database = await db.getDb();
  if (!database) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });
  }

  try {
    // Get segments with flight details
    const segments = await database
      .select({
        id: bookingSegments.id,
        segmentOrder: bookingSegments.segmentOrder,
        flightId: bookingSegments.flightId,
        departureDate: bookingSegments.departureDate,
        status: bookingSegments.status,
        flight: {
          id: flights.id,
          flightNumber: flights.flightNumber,
          departureTime: flights.departureTime,
          arrivalTime: flights.arrivalTime,
          status: flights.status,
        },
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
      })
      .from(bookingSegments)
      .innerJoin(flights, eq(bookingSegments.flightId, flights.id))
      .innerJoin(airlines, eq(flights.airlineId, airlines.id))
      .innerJoin(airports, eq(flights.originId, airports.id))
      .where(eq(bookingSegments.bookingId, bookingId))
      .orderBy(bookingSegments.segmentOrder);

    // We need to get destination info separately due to self-join limitation
    const result: SegmentDetails[] = [];

    for (const segment of segments) {
      const destResult = await database
        .select({
          code: airports.code,
          name: airports.name,
          city: airports.city,
        })
        .from(flights)
        .innerJoin(airports, eq(flights.destinationId, airports.id))
        .where(eq(flights.id, segment.flightId))
        .limit(1);

      const destination = destResult[0] || {
        code: "---",
        name: "Unknown",
        city: "Unknown",
      };

      result.push({
        id: segment.id,
        segmentOrder: segment.segmentOrder,
        flightId: segment.flightId,
        departureDate: segment.departureDate,
        status: segment.status,
        flight: {
          id: segment.flight.id,
          flightNumber: segment.flight.flightNumber,
          departureTime: segment.flight.departureTime,
          arrivalTime: segment.flight.arrivalTime,
          status: segment.flight.status,
          airline: segment.airline,
          origin: segment.origin,
          destination,
        },
      });
    }

    return result;
  } catch (error) {
    console.error("Error getting booking segments:", error);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to get booking segments",
    });
  }
}

/**
 * Check if a booking is a multi-city booking
 */
export async function isMultiCityBooking(
  bookingId: number,
  userId: number
): Promise<boolean> {
  const database = await db.getDb();
  if (!database) return false;

  try {
    const [booking] = await database
      .select({ id: bookings.id, userId: bookings.userId })
      .from(bookings)
      .where(eq(bookings.id, bookingId))
      .limit(1);

    if (!booking) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Booking not found",
      });
    }

    if (booking.userId !== userId) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "You do not have access to this booking",
      });
    }

    const segments = await database
      .select({ id: bookingSegments.id })
      .from(bookingSegments)
      .where(eq(bookingSegments.bookingId, bookingId))
      .limit(2);

    return segments.length > 1;
  } catch (error) {
    if (error instanceof TRPCError) throw error;
    console.error("Error checking multi-city booking:", error);
    return false;
  }
}

/**
 * Update segment status
 */
export async function updateSegmentStatus(
  segmentId: number,
  status: "pending" | "confirmed" | "cancelled" | "completed"
): Promise<void> {
  const database = await db.getDb();
  if (!database) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });
  }

  try {
    await database
      .update(bookingSegments)
      .set({ status, updatedAt: new Date() })
      .where(eq(bookingSegments.id, segmentId));
  } catch (error) {
    console.error("Error updating segment status:", error);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to update segment status",
    });
  }
}

/**
 * Update all segments for a booking
 */
export async function updateAllSegmentsStatus(
  bookingId: number,
  status: "pending" | "confirmed" | "cancelled" | "completed"
): Promise<void> {
  const database = await db.getDb();
  if (!database) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });
  }

  try {
    await database
      .update(bookingSegments)
      .set({ status, updatedAt: new Date() })
      .where(eq(bookingSegments.bookingId, bookingId));
  } catch (error) {
    console.error("Error updating all segments status:", error);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to update segments status",
    });
  }
}

// ============ Helper Functions ============

/**
 * Get discount percentage based on number of segments
 */
function getMultiCityDiscount(segmentCount: number): number {
  if (segmentCount >= 5) return MULTI_CITY_DISCOUNTS[5];
  if (segmentCount === 4) return MULTI_CITY_DISCOUNTS[4];
  if (segmentCount === 3) return MULTI_CITY_DISCOUNTS[3];
  return MULTI_CITY_DISCOUNTS[2];
}
