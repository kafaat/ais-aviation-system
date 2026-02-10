import { TRPCError } from "@trpc/server";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { getDb } from "../db";
import {
  favoriteFlights,
  priceAlertHistory,
  flights,
  airports,
  airlines,
  userFlightFavorites,
  type InsertFavoriteFlight,
  type InsertPriceAlertHistory,
  type InsertUserFlightFavorite,
} from "../../drizzle/schema";

/**
 * Add a favorite flight route
 */
export async function addFavorite(params: {
  userId: number;
  originId: number;
  destinationId: number;
  airlineId?: number;
  cabinClass?: "economy" | "business";
  enablePriceAlert?: boolean;
  maxPrice?: number;
  emailNotifications?: boolean;
  notes?: string;
}) {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  try {
    // Check if already exists
    const existing = await db
      .select()
      .from(favoriteFlights)
      .where(
        and(
          eq(favoriteFlights.userId, params.userId),
          eq(favoriteFlights.originId, params.originId),
          eq(favoriteFlights.destinationId, params.destinationId),
          params.airlineId
            ? eq(favoriteFlights.airlineId, params.airlineId)
            : sql`${favoriteFlights.airlineId} IS NULL`
        )
      )
      .limit(1);

    if (existing.length > 0) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "This route is already in your favorites",
      });
    }

    const favoriteData: InsertFavoriteFlight = {
      userId: params.userId,
      originId: params.originId,
      destinationId: params.destinationId,
      airlineId: params.airlineId,
      cabinClass: params.cabinClass,
      enablePriceAlert: params.enablePriceAlert || false,
      maxPrice: params.maxPrice,
      emailNotifications: params.emailNotifications !== false,
      notes: params.notes,
    };

    const [result] = await db.insert(favoriteFlights).values(favoriteData);

    return {
      id: result.insertId,
      ...favoriteData,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  } catch (error) {
    if (error instanceof TRPCError) throw error;
    console.error("[Favorites Service] Error adding favorite:", error);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to add favorite",
    });
  }
}

/**
 * Get user's favorite flights
 */
export async function getUserFavorites(userId: number) {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  try {
    const favorites = await db
      .select({
        favorite: favoriteFlights,
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
        airline: {
          id: airlines.id,
          code: airlines.code,
          name: airlines.name,
          logo: airlines.logo,
        },
      })
      .from(favoriteFlights)
      .innerJoin(airports, eq(favoriteFlights.originId, airports.id))
      .innerJoin(
        sql`airports as dest`,
        sql`${favoriteFlights.destinationId} = dest.id`
      )
      .leftJoin(airlines, eq(favoriteFlights.airlineId, airlines.id))
      .where(eq(favoriteFlights.userId, userId))
      .orderBy(desc(favoriteFlights.createdAt));

    return favorites;
  } catch (error) {
    console.error("[Favorites Service] Error getting favorites:", error);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to get favorites",
    });
  }
}

/**
 * Update favorite settings
 */
export async function updateFavorite(params: {
  favoriteId: number;
  userId: number;
  enablePriceAlert?: boolean;
  maxPrice?: number;
  emailNotifications?: boolean;
  notes?: string;
  cabinClass?: "economy" | "business";
}) {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  try {
    // Verify ownership
    const [favorite] = await db
      .select()
      .from(favoriteFlights)
      .where(
        and(
          eq(favoriteFlights.id, params.favoriteId),
          eq(favoriteFlights.userId, params.userId)
        )
      )
      .limit(1);

    if (!favorite) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Favorite not found" });
    }

    const updateData: Partial<InsertFavoriteFlight> = {};

    if (params.enablePriceAlert !== undefined)
      updateData.enablePriceAlert = params.enablePriceAlert;
    if (params.maxPrice !== undefined) updateData.maxPrice = params.maxPrice;
    if (params.emailNotifications !== undefined)
      updateData.emailNotifications = params.emailNotifications;
    if (params.notes !== undefined) updateData.notes = params.notes;
    if (params.cabinClass !== undefined)
      updateData.cabinClass = params.cabinClass;

    await db
      .update(favoriteFlights)
      .set(updateData)
      .where(eq(favoriteFlights.id, params.favoriteId));

    return { success: true };
  } catch (error) {
    if (error instanceof TRPCError) throw error;
    console.error("[Favorites Service] Error updating favorite:", error);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to update favorite",
    });
  }
}

/**
 * Delete a favorite
 */
export async function deleteFavorite(favoriteId: number, userId: number) {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  try {
    // Verify ownership
    const [favorite] = await db
      .select()
      .from(favoriteFlights)
      .where(
        and(
          eq(favoriteFlights.id, favoriteId),
          eq(favoriteFlights.userId, userId)
        )
      )
      .limit(1);

    if (!favorite) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Favorite not found" });
    }

    await db.delete(favoriteFlights).where(eq(favoriteFlights.id, favoriteId));

    return { success: true };
  } catch (error) {
    if (error instanceof TRPCError) throw error;
    console.error("[Favorites Service] Error deleting favorite:", error);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to delete favorite",
    });
  }
}

/**
 * Check if a route is favorited
 */
export async function isFavorited(params: {
  userId: number;
  originId: number;
  destinationId: number;
  airlineId?: number;
}) {
  const db = await getDb();
  if (!db) return false;

  try {
    const [favorite] = await db
      .select({ id: favoriteFlights.id })
      .from(favoriteFlights)
      .where(
        and(
          eq(favoriteFlights.userId, params.userId),
          eq(favoriteFlights.originId, params.originId),
          eq(favoriteFlights.destinationId, params.destinationId),
          params.airlineId
            ? eq(favoriteFlights.airlineId, params.airlineId)
            : sql`${favoriteFlights.airlineId} IS NULL`
        )
      )
      .limit(1);

    return !!favorite;
  } catch (error) {
    console.error("[Favorites Service] Error checking if favorited:", error);
    return false;
  }
}

/**
 * Check for price drops and send alerts
 * This function should be called periodically (e.g., daily cron job)
 */
export async function checkPriceAlertsAndNotify() {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  try {
    // Get all favorites with price alerts enabled
    const favoritesWithAlerts = await db
      .select()
      .from(favoriteFlights)
      .where(
        and(
          eq(favoriteFlights.enablePriceAlert, true),
          sql`${favoriteFlights.maxPrice} IS NOT NULL`
        )
      );

    const alertsToSend: Array<{
      favoriteId: number;
      flightId: number;
      userId: number;
      previousPrice: number;
      newPrice: number;
      priceChange: number;
    }> = [];

    // Check each favorite
    for (const favorite of favoritesWithAlerts) {
      if (!favorite.maxPrice) continue;

      // Get upcoming flights for this route
      const upcomingFlights = await db
        .select()
        .from(flights)
        .where(
          and(
            eq(flights.originId, favorite.originId),
            eq(flights.destinationId, favorite.destinationId),
            favorite.airlineId
              ? eq(flights.airlineId, favorite.airlineId)
              : undefined,
            eq(flights.status, "scheduled"),
            gte(flights.departureTime, new Date()) // Only future flights
          )
        )
        .limit(10);

      // Check prices based on cabin class
      for (const flight of upcomingFlights) {
        const currentPrice =
          favorite.cabinClass === "business"
            ? flight.businessPrice
            : flight.economyPrice;

        // If price is below threshold and at least 24 hours since last alert
        const shouldAlert =
          currentPrice <= favorite.maxPrice &&
          (!favorite.lastAlertSent ||
            new Date().getTime() - favorite.lastAlertSent.getTime() >
              24 * 60 * 60 * 1000);

        if (shouldAlert) {
          // Get the most recent alert for this favorite to calculate price change
          const [recentAlert] = await db
            .select()
            .from(priceAlertHistory)
            .where(eq(priceAlertHistory.favoriteFlightId, favorite.id))
            .orderBy(desc(priceAlertHistory.createdAt))
            .limit(1);

          const previousPrice = recentAlert?.newPrice || currentPrice;
          const priceChange = currentPrice - previousPrice;

          if (priceChange < 0) {
            // Only alert on price drops
            alertsToSend.push({
              favoriteId: favorite.id,
              flightId: flight.id,
              userId: favorite.userId,
              previousPrice,
              newPrice: currentPrice,
              priceChange,
            });
          }
        }
      }
    }

    // Record alerts in history
    for (const alert of alertsToSend) {
      const historyData: InsertPriceAlertHistory = {
        favoriteFlightId: alert.favoriteId,
        flightId: alert.flightId,
        previousPrice: alert.previousPrice,
        newPrice: alert.newPrice,
        priceChange: alert.priceChange,
        alertSent: false, // Will be updated after email is sent
      };

      await db.insert(priceAlertHistory).values(historyData);

      // Update last alert sent time
      await db
        .update(favoriteFlights)
        .set({ lastAlertSent: new Date() })
        .where(eq(favoriteFlights.id, alert.favoriteId));
    }

    return {
      alertsFound: alertsToSend.length,
      alerts: alertsToSend,
    };
  } catch (error) {
    console.error("[Favorites Service] Error checking price alerts:", error);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to check price alerts",
    });
  }
}

/**
 * Get price alert history for a favorite
 */
export async function getPriceAlertHistory(favoriteId: number, userId: number) {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  try {
    // Verify ownership
    const [favorite] = await db
      .select()
      .from(favoriteFlights)
      .where(
        and(
          eq(favoriteFlights.id, favoriteId),
          eq(favoriteFlights.userId, userId)
        )
      )
      .limit(1);

    if (!favorite) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Favorite not found" });
    }

    const history = await db
      .select({
        alert: priceAlertHistory,
        flight: flights,
      })
      .from(priceAlertHistory)
      .innerJoin(flights, eq(priceAlertHistory.flightId, flights.id))
      .where(eq(priceAlertHistory.favoriteFlightId, favoriteId))
      .orderBy(desc(priceAlertHistory.createdAt))
      .limit(50);

    return history;
  } catch (error) {
    if (error instanceof TRPCError) throw error;
    console.error(
      "[Favorites Service] Error getting price alert history:",
      error
    );
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to get price alert history",
    });
  }
}

/**
 * Get current best prices for a favorite route
 */
export async function getBestPricesForFavorite(
  favoriteId: number,
  userId: number
) {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  try {
    // Verify ownership and get favorite details
    const [favorite] = await db
      .select()
      .from(favoriteFlights)
      .where(
        and(
          eq(favoriteFlights.id, favoriteId),
          eq(favoriteFlights.userId, userId)
        )
      )
      .limit(1);

    if (!favorite) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Favorite not found" });
    }

    // Get all upcoming flights for this route
    const upcomingFlights = await db
      .select()
      .from(flights)
      .innerJoin(airlines, eq(flights.airlineId, airlines.id))
      .where(
        and(
          eq(flights.originId, favorite.originId),
          eq(flights.destinationId, favorite.destinationId),
          favorite.airlineId
            ? eq(flights.airlineId, favorite.airlineId)
            : undefined,
          eq(flights.status, "scheduled"),
          gte(flights.departureTime, new Date())
        )
      )
      .orderBy(flights.departureTime)
      .limit(20);

    // Find the lowest price
    let lowestPrice = Infinity;
    let lowestPriceFlight = null;

    for (const flight of upcomingFlights) {
      const price =
        favorite.cabinClass === "business"
          ? flight.flights.businessPrice
          : flight.flights.economyPrice;
      if (price < lowestPrice) {
        lowestPrice = price;
        lowestPriceFlight = flight;
      }
    }

    return {
      lowestPrice,
      lowestPriceFlight,
      totalFlights: upcomingFlights.length,
      favoriteMaxPrice: favorite.maxPrice,
      priceAlertActive:
        favorite.enablePriceAlert &&
        lowestPrice <= (favorite.maxPrice || Infinity),
    };
  } catch (error) {
    if (error instanceof TRPCError) throw error;
    console.error("[Favorites Service] Error getting best prices:", error);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to get best prices",
    });
  }
}

// ============================================================================
// Individual Flight Favorites (specific flights, not routes)
// ============================================================================

/**
 * Add a specific flight to favorites
 */
export async function addFlightFavorite(userId: number, flightId: number) {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  try {
    // Check if already favorited
    const [existing] = await db
      .select()
      .from(userFlightFavorites)
      .where(
        and(
          eq(userFlightFavorites.userId, userId),
          eq(userFlightFavorites.flightId, flightId)
        )
      )
      .limit(1);

    if (existing) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "This flight is already in your favorites",
      });
    }

    // Verify flight exists
    const [flight] = await db
      .select()
      .from(flights)
      .where(eq(flights.id, flightId))
      .limit(1);

    if (!flight) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Flight not found",
      });
    }

    const favoriteData: InsertUserFlightFavorite = {
      userId,
      flightId,
    };

    const [result] = await db.insert(userFlightFavorites).values(favoriteData);

    return {
      id: result.insertId,
      ...favoriteData,
      createdAt: new Date(),
    };
  } catch (error) {
    if (error instanceof TRPCError) throw error;
    console.error("[Favorites Service] Error adding flight favorite:", error);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to add flight to favorites",
    });
  }
}

/**
 * Remove a specific flight from favorites
 */
export async function removeFlightFavorite(userId: number, flightId: number) {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  try {
    // Verify ownership
    const [favorite] = await db
      .select()
      .from(userFlightFavorites)
      .where(
        and(
          eq(userFlightFavorites.userId, userId),
          eq(userFlightFavorites.flightId, flightId)
        )
      )
      .limit(1);

    if (!favorite) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Favorite not found",
      });
    }

    await db
      .delete(userFlightFavorites)
      .where(eq(userFlightFavorites.id, favorite.id));

    return { success: true };
  } catch (error) {
    if (error instanceof TRPCError) throw error;
    console.error("[Favorites Service] Error removing flight favorite:", error);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to remove flight from favorites",
    });
  }
}

/**
 * Get all flight favorites for a user
 */
export async function getUserFlightFavorites(userId: number) {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  try {
    const favorites = await db
      .select({
        favorite: userFlightFavorites,
        flight: flights,
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
        airline: {
          id: airlines.id,
          code: airlines.code,
          name: airlines.name,
          logo: airlines.logo,
        },
      })
      .from(userFlightFavorites)
      .innerJoin(flights, eq(userFlightFavorites.flightId, flights.id))
      .innerJoin(airports, eq(flights.originId, airports.id))
      .innerJoin(sql`airports as dest`, sql`${flights.destinationId} = dest.id`)
      .innerJoin(airlines, eq(flights.airlineId, airlines.id))
      .where(eq(userFlightFavorites.userId, userId))
      .orderBy(desc(userFlightFavorites.createdAt));

    return favorites;
  } catch (error) {
    console.error("[Favorites Service] Error getting flight favorites:", error);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to get flight favorites",
    });
  }
}

/**
 * Check if a specific flight is favorited
 */
export async function isFlightFavorited(userId: number, flightId: number) {
  const db = await getDb();
  if (!db) return false;

  try {
    const [favorite] = await db
      .select({ id: userFlightFavorites.id })
      .from(userFlightFavorites)
      .where(
        and(
          eq(userFlightFavorites.userId, userId),
          eq(userFlightFavorites.flightId, flightId)
        )
      )
      .limit(1);

    return !!favorite;
  } catch (error) {
    console.error(
      "[Favorites Service] Error checking if flight favorited:",
      error
    );
    return false;
  }
}
