import { TRPCError } from "@trpc/server";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { getDb } from "../db";
import {
  priceAlerts,
  flights,
  airports,
  type InsertPriceAlert,
} from "../../drizzle/schema";

/**
 * Create a new price alert
 */
export async function createAlert(params: {
  userId: number;
  originId: number;
  destinationId: number;
  targetPrice: number;
  cabinClass?: "economy" | "business";
}) {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  try {
    const cabinClass = params.cabinClass || "economy";

    // Check if alert already exists for this route
    const [existing] = await db
      .select()
      .from(priceAlerts)
      .where(
        and(
          eq(priceAlerts.userId, params.userId),
          eq(priceAlerts.originId, params.originId),
          eq(priceAlerts.destinationId, params.destinationId),
          eq(priceAlerts.cabinClass, cabinClass)
        )
      )
      .limit(1);

    if (existing) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "You already have a price alert for this route",
      });
    }

    // Get current lowest price for the route
    const currentPrice = await getLowestPriceForRoute(
      params.originId,
      params.destinationId,
      cabinClass
    );

    const alertData: InsertPriceAlert = {
      userId: params.userId,
      originId: params.originId,
      destinationId: params.destinationId,
      targetPrice: params.targetPrice,
      currentPrice,
      cabinClass,
      isActive: true,
      lastChecked: new Date(),
    };

    const [result] = await db.insert(priceAlerts).values(alertData);

    return {
      id: result.insertId,
      ...alertData,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  } catch (error) {
    if (error instanceof TRPCError) throw error;
    console.error("[Price Alerts Service] Error creating alert:", error);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to create price alert",
    });
  }
}

/**
 * Get all alerts for a user
 */
export async function getUserAlerts(userId: number) {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  try {
    const alerts = await db
      .select({
        alert: priceAlerts,
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
      .from(priceAlerts)
      .innerJoin(airports, eq(priceAlerts.originId, airports.id))
      .innerJoin(
        sql`airports as dest`,
        sql`${priceAlerts.destinationId} = dest.id`
      )
      .where(eq(priceAlerts.userId, userId))
      .orderBy(desc(priceAlerts.createdAt));

    return alerts;
  } catch (error) {
    console.error("[Price Alerts Service] Error getting user alerts:", error);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to get price alerts",
    });
  }
}

/**
 * Delete a price alert
 */
export async function deleteAlert(alertId: number, userId: number) {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  try {
    // Verify ownership
    const [alert] = await db
      .select()
      .from(priceAlerts)
      .where(and(eq(priceAlerts.id, alertId), eq(priceAlerts.userId, userId)))
      .limit(1);

    if (!alert) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Price alert not found",
      });
    }

    await db.delete(priceAlerts).where(eq(priceAlerts.id, alertId));

    return { success: true };
  } catch (error) {
    if (error instanceof TRPCError) throw error;
    console.error("[Price Alerts Service] Error deleting alert:", error);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to delete price alert",
    });
  }
}

/**
 * Toggle alert active status
 */
export async function toggleAlert(alertId: number, userId: number) {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  try {
    // Verify ownership and get current state
    const [alert] = await db
      .select()
      .from(priceAlerts)
      .where(and(eq(priceAlerts.id, alertId), eq(priceAlerts.userId, userId)))
      .limit(1);

    if (!alert) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Price alert not found",
      });
    }

    await db
      .update(priceAlerts)
      .set({ isActive: !alert.isActive })
      .where(eq(priceAlerts.id, alertId));

    return { success: true, isActive: !alert.isActive };
  } catch (error) {
    if (error instanceof TRPCError) throw error;
    console.error("[Price Alerts Service] Error toggling alert:", error);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to toggle price alert",
    });
  }
}

/**
 * Update alert target price
 */
export async function updateAlertPrice(
  alertId: number,
  userId: number,
  newTargetPrice: number
) {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  try {
    // Verify ownership
    const [alert] = await db
      .select()
      .from(priceAlerts)
      .where(and(eq(priceAlerts.id, alertId), eq(priceAlerts.userId, userId)))
      .limit(1);

    if (!alert) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Price alert not found",
      });
    }

    await db
      .update(priceAlerts)
      .set({ targetPrice: newTargetPrice })
      .where(eq(priceAlerts.id, alertId));

    return { success: true };
  } catch (error) {
    if (error instanceof TRPCError) throw error;
    console.error("[Price Alerts Service] Error updating alert price:", error);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to update price alert",
    });
  }
}

/**
 * Get lowest price for a route
 */
async function getLowestPriceForRoute(
  originId: number,
  destinationId: number,
  cabinClass: "economy" | "business"
): Promise<number | null> {
  const db = await getDb();
  if (!db) return null;

  try {
    const priceColumn =
      cabinClass === "business" ? flights.businessPrice : flights.economyPrice;

    const [result] = await db
      .select({
        minPrice: sql<number>`MIN(${priceColumn})`,
      })
      .from(flights)
      .where(
        and(
          eq(flights.originId, originId),
          eq(flights.destinationId, destinationId),
          eq(flights.status, "scheduled"),
          gte(flights.departureTime, new Date())
        )
      );

    return result?.minPrice || null;
  } catch (error) {
    console.error("[Price Alerts Service] Error getting lowest price:", error);
    return null;
  }
}

/**
 * Check all active alerts and update prices
 * This function should be called periodically (e.g., hourly cron job)
 */
export async function checkAlerts() {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  try {
    // Get all active alerts
    const activeAlerts = await db
      .select()
      .from(priceAlerts)
      .where(eq(priceAlerts.isActive, true));

    const alertsTriggered: Array<{
      alertId: number;
      userId: number;
      originId: number;
      destinationId: number;
      targetPrice: number;
      currentPrice: number;
      previousPrice: number | null;
    }> = [];

    for (const alert of activeAlerts) {
      // Get current lowest price
      const currentPrice = await getLowestPriceForRoute(
        alert.originId,
        alert.destinationId,
        alert.cabinClass
      );

      if (currentPrice !== null) {
        // Update the current price and last checked time
        await db
          .update(priceAlerts)
          .set({
            currentPrice,
            lastChecked: new Date(),
          })
          .where(eq(priceAlerts.id, alert.id));

        // Check if price is at or below target
        // Only notify if not already notified in the last 24 hours
        const shouldNotify =
          currentPrice <= alert.targetPrice &&
          (!alert.notifiedAt ||
            new Date().getTime() - alert.notifiedAt.getTime() >
              24 * 60 * 60 * 1000);

        if (shouldNotify) {
          alertsTriggered.push({
            alertId: alert.id,
            userId: alert.userId,
            originId: alert.originId,
            destinationId: alert.destinationId,
            targetPrice: alert.targetPrice,
            currentPrice,
            previousPrice: alert.currentPrice,
          });

          // Update notification timestamp
          await db
            .update(priceAlerts)
            .set({ notifiedAt: new Date() })
            .where(eq(priceAlerts.id, alert.id));
        }
      }
    }

    return {
      totalChecked: activeAlerts.length,
      alertsTriggered: alertsTriggered.length,
      alerts: alertsTriggered,
    };
  } catch (error) {
    console.error("[Price Alerts Service] Error checking alerts:", error);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to check price alerts",
    });
  }
}

/**
 * Get a single alert by ID
 */
export async function getAlertById(alertId: number, userId: number) {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  try {
    const [alert] = await db
      .select({
        alert: priceAlerts,
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
      .from(priceAlerts)
      .innerJoin(airports, eq(priceAlerts.originId, airports.id))
      .innerJoin(
        sql`airports as dest`,
        sql`${priceAlerts.destinationId} = dest.id`
      )
      .where(and(eq(priceAlerts.id, alertId), eq(priceAlerts.userId, userId)))
      .limit(1);

    if (!alert) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Price alert not found",
      });
    }

    return alert;
  } catch (error) {
    if (error instanceof TRPCError) throw error;
    console.error("[Price Alerts Service] Error getting alert:", error);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to get price alert",
    });
  }
}
