/**
 * Smart Flight Suggestions Service
 *
 * Provides personalized flight suggestions based on:
 * - User booking history (previously visited destinations)
 * - Popular routes and trending destinations
 * - Seasonal patterns
 *
 * @version 1.0.0
 */

import { getDb } from "../db";
import { bookings, flights, airports } from "../../drizzle/schema";
import { eq, desc, sql, and, gte, ne, isNull } from "drizzle-orm";
import { logger } from "../_core/logger";

export interface SuggestedFlight {
  flightId: number;
  flightNumber: string;
  originId: number;
  originCode: string;
  originCity: string;
  destinationId: number;
  destinationCode: string;
  destinationCity: string;
  departureTime: Date;
  arrivalTime: Date;
  economyPrice: number;
  businessPrice: number;
  economyAvailable: number;
  businessAvailable: number;
  airlineName: string;
  airlineCode: string;
  reason: "history" | "popular" | "deal" | "trending";
  score: number;
}

/**
 * Get personalized flight suggestions for a user
 * based on their booking history
 */
export async function getUserSuggestions(
  userId: number,
  limit: number = 6
): Promise<SuggestedFlight[]> {
  const db = await getDb();
  if (!db) return [];

  try {
    // Get destinations the user has previously booked
    const userBookedDestinations = await db
      .select({
        destinationId: flights.destinationId,
        originId: flights.originId,
        bookingCount: sql<number>`COUNT(*)`,
      })
      .from(bookings)
      .innerJoin(flights, eq(bookings.flightId, flights.id))
      .where(and(eq(bookings.userId, userId), isNull(bookings.deletedAt)))
      .groupBy(flights.destinationId, flights.originId)
      .orderBy(desc(sql`COUNT(*)`))
      .limit(5);

    if (userBookedDestinations.length === 0) {
      // No history - fall back to popular flights
      return getPopularFlightSuggestions(limit);
    }

    // Get upcoming flights to destinations the user has visited before
    const now = new Date();
    const suggestions: SuggestedFlight[] = [];

    for (const dest of userBookedDestinations) {
      const upcomingFlights = await db
        .select({
          flightId: flights.id,
          flightNumber: flights.flightNumber,
          originId: flights.originId,
          originCode: sql<string>`origin.code`,
          originCity: sql<string>`origin.city`,
          destinationId: flights.destinationId,
          destinationCode: sql<string>`dest.code`,
          destinationCity: sql<string>`dest.city`,
          departureTime: flights.departureTime,
          arrivalTime: flights.arrivalTime,
          economyPrice: flights.economyPrice,
          businessPrice: flights.businessPrice,
          economyAvailable: flights.economyAvailable,
          businessAvailable: flights.businessAvailable,
          airlineName: sql<string>`airline.name`,
          airlineCode: sql<string>`airline.code`,
        })
        .from(flights)
        .innerJoin(
          sql`${airports} as origin`,
          sql`${flights.originId} = origin.id`
        )
        .innerJoin(
          sql`${airports} as dest`,
          sql`${flights.destinationId} = dest.id`
        )
        .innerJoin(
          sql`airlines as airline`,
          sql`${flights.airlineId} = airline.id`
        )
        .where(
          and(
            eq(flights.destinationId, dest.destinationId),
            gte(flights.departureTime, now),
            eq(flights.status, "scheduled")
          )
        )
        .orderBy(flights.economyPrice)
        .limit(2);

      for (const f of upcomingFlights) {
        suggestions.push({
          ...f,
          reason: "history",
          score: 100 + dest.bookingCount * 10,
        });
      }
    }

    // Fill remaining slots with popular flights
    if (suggestions.length < limit) {
      const popular = await getPopularFlightSuggestions(
        limit - suggestions.length
      );
      const existingIds = new Set(suggestions.map(s => s.flightId));
      for (const p of popular) {
        if (!existingIds.has(p.flightId)) {
          suggestions.push(p);
        }
      }
    }

    // Sort by score descending and limit
    return suggestions.sort((a, b) => b.score - a.score).slice(0, limit);
  } catch (error) {
    logger.error({ userId, error }, "Failed to get user suggestions");
    return [];
  }
}

/**
 * Get popular flight suggestions (not user-specific)
 */
export async function getPopularFlightSuggestions(
  limit: number = 6
): Promise<SuggestedFlight[]> {
  const db = await getDb();
  if (!db) return [];

  try {
    const now = new Date();

    // Get flights with the most bookings in the last 30 days
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const popularFlights = await db
      .select({
        flightId: flights.id,
        flightNumber: flights.flightNumber,
        originId: flights.originId,
        originCode: sql<string>`origin.code`,
        originCity: sql<string>`origin.city`,
        destinationId: flights.destinationId,
        destinationCode: sql<string>`dest.code`,
        destinationCity: sql<string>`dest.city`,
        departureTime: flights.departureTime,
        arrivalTime: flights.arrivalTime,
        economyPrice: flights.economyPrice,
        businessPrice: flights.businessPrice,
        economyAvailable: flights.economyAvailable,
        businessAvailable: flights.businessAvailable,
        airlineName: sql<string>`airline.name`,
        airlineCode: sql<string>`airline.code`,
        bookingCount: sql<number>`COUNT(${bookings.id})`,
      })
      .from(flights)
      .leftJoin(bookings, eq(bookings.flightId, flights.id))
      .innerJoin(
        sql`${airports} as origin`,
        sql`${flights.originId} = origin.id`
      )
      .innerJoin(
        sql`${airports} as dest`,
        sql`${flights.destinationId} = dest.id`
      )
      .innerJoin(
        sql`airlines as airline`,
        sql`${flights.airlineId} = airline.id`
      )
      .where(
        and(gte(flights.departureTime, now), eq(flights.status, "scheduled"))
      )
      .groupBy(
        flights.id,
        flights.flightNumber,
        flights.originId,
        flights.destinationId,
        flights.departureTime,
        flights.arrivalTime,
        flights.economyPrice,
        flights.businessPrice,
        flights.economyAvailable,
        flights.businessAvailable,
        sql`origin.code`,
        sql`origin.city`,
        sql`dest.code`,
        sql`dest.city`,
        sql`airline.name`,
        sql`airline.code`
      )
      .orderBy(desc(sql`COUNT(${bookings.id})`))
      .limit(limit);

    return popularFlights.map(f => ({
      ...f,
      reason: "popular" as const,
      score: 50 + f.bookingCount * 5,
    }));
  } catch (error) {
    logger.error({ error }, "Failed to get popular flight suggestions");
    return [];
  }
}

/**
 * Get deal/discount flight suggestions
 * Returns flights with the lowest prices per route
 */
export async function getDealSuggestions(
  limit: number = 4
): Promise<SuggestedFlight[]> {
  const db = await getDb();
  if (!db) return [];

  try {
    const now = new Date();

    const deals = await db
      .select({
        flightId: flights.id,
        flightNumber: flights.flightNumber,
        originId: flights.originId,
        originCode: sql<string>`origin.code`,
        originCity: sql<string>`origin.city`,
        destinationId: flights.destinationId,
        destinationCode: sql<string>`dest.code`,
        destinationCity: sql<string>`dest.city`,
        departureTime: flights.departureTime,
        arrivalTime: flights.arrivalTime,
        economyPrice: flights.economyPrice,
        businessPrice: flights.businessPrice,
        economyAvailable: flights.economyAvailable,
        businessAvailable: flights.businessAvailable,
        airlineName: sql<string>`airline.name`,
        airlineCode: sql<string>`airline.code`,
      })
      .from(flights)
      .innerJoin(
        sql`${airports} as origin`,
        sql`${flights.originId} = origin.id`
      )
      .innerJoin(
        sql`${airports} as dest`,
        sql`${flights.destinationId} = dest.id`
      )
      .innerJoin(
        sql`airlines as airline`,
        sql`${flights.airlineId} = airline.id`
      )
      .where(
        and(
          gte(flights.departureTime, now),
          eq(flights.status, "scheduled"),
          sql`${flights.economyAvailable} > 0`
        )
      )
      .orderBy(flights.economyPrice)
      .limit(limit);

    return deals.map(f => ({
      ...f,
      reason: "deal" as const,
      score: 80,
    }));
  } catch (error) {
    logger.error({ error }, "Failed to get deal suggestions");
    return [];
  }
}
