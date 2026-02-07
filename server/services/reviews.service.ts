import { TRPCError } from "@trpc/server";
import { and, avg, count, desc, eq, sql } from "drizzle-orm";
import { getDb } from "../db";
import {
  flightReviews,
  bookings,
  flights,
  type InsertFlightReview,
} from "../../drizzle/schema";

function stripHtmlTags(str: string): string {
  return str.replace(/<[^>]*>/g, "");
}

/**
 * Create a new flight review
 */
export async function createReview(params: {
  userId: number;
  flightId: number;
  bookingId?: number;
  rating: number;
  comfortRating?: number;
  serviceRating?: number;
  valueRating?: number;
  title?: string;
  comment?: string;
}) {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  try {
    // Validate rating
    if (params.rating < 1 || params.rating > 5) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Rating must be between 1 and 5",
      });
    }

    // Check if user already reviewed this flight
    const existingReview = await db
      .select()
      .from(flightReviews)
      .where(
        and(
          eq(flightReviews.userId, params.userId),
          eq(flightReviews.flightId, params.flightId)
        )
      )
      .limit(1);

    if (existingReview.length > 0) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "You have already reviewed this flight",
      });
    }

    // If bookingId provided, verify it belongs to the user and flight
    let isVerified = false;
    if (params.bookingId) {
      const booking = await db
        .select()
        .from(bookings)
        .where(
          and(
            eq(bookings.id, params.bookingId),
            eq(bookings.userId, params.userId),
            eq(bookings.flightId, params.flightId),
            eq(bookings.status, "completed")
          )
        )
        .limit(1);

      if (booking.length > 0) {
        isVerified = true;
      }
    }

    const reviewData: InsertFlightReview = {
      userId: params.userId,
      flightId: params.flightId,
      bookingId: params.bookingId,
      rating: params.rating,
      comfortRating: params.comfortRating,
      serviceRating: params.serviceRating,
      valueRating: params.valueRating,
      title: params.title ? stripHtmlTags(params.title) : params.title,
      comment: params.comment ? stripHtmlTags(params.comment) : params.comment,
      isVerified,
      status: "approved", // Auto-approve for now, can add moderation later
    };

    const [result] = await db.insert(flightReviews).values(reviewData);

    return {
      id: result.insertId,
      ...reviewData,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  } catch (error) {
    if (error instanceof TRPCError) throw error;
    console.error("[Reviews Service] Error creating review:", error);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to create review",
    });
  }
}

/**
 * Get reviews for a flight
 */
export async function getFlightReviews(
  flightId: number,
  options?: {
    limit?: number;
    offset?: number;
    minRating?: number;
  }
) {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  try {
    const limit = options?.limit || 20;
    const offset = options?.offset || 0;

    const query = db
      .select()
      .from(flightReviews)
      .where(
        and(
          eq(flightReviews.flightId, flightId),
          eq(flightReviews.status, "approved"),
          options?.minRating
            ? sql`${flightReviews.rating} >= ${options.minRating}`
            : undefined
        )
      )
      .orderBy(desc(flightReviews.createdAt))
      .limit(limit)
      .offset(offset);

    return await query;
  } catch (error) {
    console.error("[Reviews Service] Error getting flight reviews:", error);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to get flight reviews",
    });
  }
}

/**
 * Get review statistics for a flight
 */
export async function getFlightReviewStats(flightId: number) {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  try {
    const [stats] = await db
      .select({
        totalReviews: count(),
        averageRating: avg(flightReviews.rating),
        averageComfort: avg(flightReviews.comfortRating),
        averageService: avg(flightReviews.serviceRating),
        averageValue: avg(flightReviews.valueRating),
      })
      .from(flightReviews)
      .where(
        and(
          eq(flightReviews.flightId, flightId),
          eq(flightReviews.status, "approved")
        )
      );

    // Get rating distribution
    const ratingDistribution = await db
      .select({
        rating: flightReviews.rating,
        count: count(),
      })
      .from(flightReviews)
      .where(
        and(
          eq(flightReviews.flightId, flightId),
          eq(flightReviews.status, "approved")
        )
      )
      .groupBy(flightReviews.rating);

    const distribution: Record<number, number> = {
      1: 0,
      2: 0,
      3: 0,
      4: 0,
      5: 0,
    };

    ratingDistribution.forEach(item => {
      if (item.rating) {
        distribution[item.rating] = Number(item.count) || 0;
      }
    });

    return {
      totalReviews: Number(stats?.totalReviews) || 0,
      averageRating: Number(stats?.averageRating) || 0,
      averageComfort: Number(stats?.averageComfort) || 0,
      averageService: Number(stats?.averageService) || 0,
      averageValue: Number(stats?.averageValue) || 0,
      ratingDistribution: distribution,
    };
  } catch (error) {
    console.error(
      "[Reviews Service] Error getting flight review stats:",
      error
    );
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to get flight review statistics",
    });
  }
}

/**
 * Update a review
 */
export async function updateReview(params: {
  reviewId: number;
  userId: number;
  rating?: number;
  comfortRating?: number;
  serviceRating?: number;
  valueRating?: number;
  title?: string;
  comment?: string;
}) {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  try {
    // Verify ownership
    const [review] = await db
      .select()
      .from(flightReviews)
      .where(
        and(
          eq(flightReviews.id, params.reviewId),
          eq(flightReviews.userId, params.userId)
        )
      )
      .limit(1);

    if (!review) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Review not found or you don't have permission to edit it",
      });
    }

    const updateData: Partial<InsertFlightReview> = {};

    if (params.rating !== undefined) {
      if (params.rating < 1 || params.rating > 5) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Rating must be between 1 and 5",
        });
      }
      updateData.rating = params.rating;
    }

    if (params.comfortRating !== undefined)
      updateData.comfortRating = params.comfortRating;
    if (params.serviceRating !== undefined)
      updateData.serviceRating = params.serviceRating;
    if (params.valueRating !== undefined)
      updateData.valueRating = params.valueRating;
    if (params.title !== undefined)
      updateData.title = stripHtmlTags(params.title);
    if (params.comment !== undefined)
      updateData.comment = stripHtmlTags(params.comment);

    await db
      .update(flightReviews)
      .set(updateData)
      .where(eq(flightReviews.id, params.reviewId));

    return { success: true };
  } catch (error) {
    if (error instanceof TRPCError) throw error;
    console.error("[Reviews Service] Error updating review:", error);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to update review",
    });
  }
}

/**
 * Delete a review
 */
export async function deleteReview(reviewId: number, userId: number) {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  try {
    // Verify ownership
    const [review] = await db
      .select()
      .from(flightReviews)
      .where(
        and(eq(flightReviews.id, reviewId), eq(flightReviews.userId, userId))
      )
      .limit(1);

    if (!review) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Review not found or you don't have permission to delete it",
      });
    }

    await db.delete(flightReviews).where(eq(flightReviews.id, reviewId));

    return { success: true };
  } catch (error) {
    if (error instanceof TRPCError) throw error;
    console.error("[Reviews Service] Error deleting review:", error);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to delete review",
    });
  }
}

/**
 * Get user's reviews
 */
export async function getUserReviews(
  userId: number,
  options?: {
    limit?: number;
    offset?: number;
  }
) {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  try {
    const limit = options?.limit || 20;
    const offset = options?.offset || 0;

    return await db
      .select({
        review: flightReviews,
        flight: flights,
      })
      .from(flightReviews)
      .innerJoin(flights, eq(flightReviews.flightId, flights.id))
      .where(eq(flightReviews.userId, userId))
      .orderBy(desc(flightReviews.createdAt))
      .limit(limit)
      .offset(offset);
  } catch (error) {
    console.error("[Reviews Service] Error getting user reviews:", error);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to get user reviews",
    });
  }
}

/**
 * Mark review as helpful
 */
export async function markReviewHelpful(reviewId: number) {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  try {
    await db
      .update(flightReviews)
      .set({ helpfulCount: sql`${flightReviews.helpfulCount} + 1` })
      .where(eq(flightReviews.id, reviewId));

    return { success: true };
  } catch (error) {
    console.error("[Reviews Service] Error marking review helpful:", error);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to mark review as helpful",
    });
  }
}

/**
 * Get aggregated reviews for an airline
 */
export async function getAirlineReviews(
  airlineId: number,
  options?: {
    limit?: number;
    offset?: number;
    minRating?: number;
  }
) {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  try {
    const limit = options?.limit || 20;
    const offset = options?.offset || 0;

    // Join flight_reviews with flights to get reviews for flights by this airline
    const reviews = await db
      .select({
        review: flightReviews,
        flight: flights,
      })
      .from(flightReviews)
      .innerJoin(flights, eq(flightReviews.flightId, flights.id))
      .where(
        and(
          eq(flights.airlineId, airlineId),
          eq(flightReviews.status, "approved"),
          options?.minRating
            ? sql`${flightReviews.rating} >= ${options.minRating}`
            : undefined
        )
      )
      .orderBy(desc(flightReviews.createdAt))
      .limit(limit)
      .offset(offset);

    return reviews;
  } catch (error) {
    console.error("[Reviews Service] Error getting airline reviews:", error);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to get airline reviews",
    });
  }
}

/**
 * Get aggregated statistics for an airline
 */
export async function getAirlineReviewStats(airlineId: number) {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  try {
    const [stats] = await db
      .select({
        totalReviews: count(),
        averageRating: avg(flightReviews.rating),
        averageComfort: avg(flightReviews.comfortRating),
        averageService: avg(flightReviews.serviceRating),
        averageValue: avg(flightReviews.valueRating),
      })
      .from(flightReviews)
      .innerJoin(flights, eq(flightReviews.flightId, flights.id))
      .where(
        and(
          eq(flights.airlineId, airlineId),
          eq(flightReviews.status, "approved")
        )
      );

    // Get rating distribution
    const ratingDistribution = await db
      .select({
        rating: flightReviews.rating,
        count: count(),
      })
      .from(flightReviews)
      .innerJoin(flights, eq(flightReviews.flightId, flights.id))
      .where(
        and(
          eq(flights.airlineId, airlineId),
          eq(flightReviews.status, "approved")
        )
      )
      .groupBy(flightReviews.rating);

    const distribution: Record<number, number> = {
      1: 0,
      2: 0,
      3: 0,
      4: 0,
      5: 0,
    };

    ratingDistribution.forEach(item => {
      if (item.rating) {
        distribution[item.rating] = Number(item.count) || 0;
      }
    });

    return {
      totalReviews: Number(stats?.totalReviews) || 0,
      averageRating: Number(stats?.averageRating) || 0,
      averageComfort: Number(stats?.averageComfort) || 0,
      averageService: Number(stats?.averageService) || 0,
      averageValue: Number(stats?.averageValue) || 0,
      ratingDistribution: distribution,
    };
  } catch (error) {
    console.error(
      "[Reviews Service] Error getting airline review stats:",
      error
    );
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to get airline review statistics",
    });
  }
}

/**
 * Check if user can review a flight (must have completed booking)
 */
export async function canUserReviewFlight(
  userId: number,
  flightId: number
): Promise<{ canReview: boolean; bookingId?: number; reason?: string }> {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  try {
    // Check if user already has a review for this flight
    const existingReview = await db
      .select()
      .from(flightReviews)
      .where(
        and(
          eq(flightReviews.userId, userId),
          eq(flightReviews.flightId, flightId)
        )
      )
      .limit(1);

    if (existingReview.length > 0) {
      return { canReview: false, reason: "already_reviewed" };
    }

    // Check if user has a completed booking for this flight
    const completedBooking = await db
      .select()
      .from(bookings)
      .where(
        and(
          eq(bookings.userId, userId),
          eq(bookings.flightId, flightId),
          eq(bookings.status, "completed")
        )
      )
      .limit(1);

    if (completedBooking.length > 0) {
      return { canReview: true, bookingId: completedBooking[0].id };
    }

    return { canReview: false, reason: "no_completed_booking" };
  } catch (error) {
    console.error(
      "[Reviews Service] Error checking if user can review:",
      error
    );
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to check review eligibility",
    });
  }
}
