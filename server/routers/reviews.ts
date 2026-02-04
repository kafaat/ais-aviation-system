import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import * as reviewsService from "../services/reviews.service";

export const reviewsRouter = router({
  /**
   * Create a new review
   */
  create: protectedProcedure
    .input(
      z.object({
        flightId: z.number().int().positive(),
        bookingId: z.number().int().positive().optional(),
        rating: z.number().int().min(1).max(5),
        comfortRating: z.number().int().min(1).max(5).optional(),
        serviceRating: z.number().int().min(1).max(5).optional(),
        valueRating: z.number().int().min(1).max(5).optional(),
        title: z.string().max(200).optional(),
        comment: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return await reviewsService.createReview({
        userId: ctx.user.id,
        ...input,
      });
    }),

  /**
   * Get reviews for a flight
   */
  getFlightReviews: protectedProcedure
    .input(
      z.object({
        flightId: z.number().int().positive(),
        limit: z.number().int().min(1).max(100).optional(),
        offset: z.number().int().min(0).optional(),
        minRating: z.number().int().min(1).max(5).optional(),
      })
    )
    .query(async ({ input }) => {
      return await reviewsService.getFlightReviews(input.flightId, {
        limit: input.limit,
        offset: input.offset,
        minRating: input.minRating,
      });
    }),

  /**
   * Get review statistics for a flight
   */
  getFlightStats: protectedProcedure
    .input(
      z.object({
        flightId: z.number().int().positive(),
      })
    )
    .query(async ({ input }) => {
      return await reviewsService.getFlightReviewStats(input.flightId);
    }),

  /**
   * Update a review
   */
  update: protectedProcedure
    .input(
      z.object({
        reviewId: z.number().int().positive(),
        rating: z.number().int().min(1).max(5).optional(),
        comfortRating: z.number().int().min(1).max(5).optional(),
        serviceRating: z.number().int().min(1).max(5).optional(),
        valueRating: z.number().int().min(1).max(5).optional(),
        title: z.string().max(200).optional(),
        comment: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { reviewId, ...updateData } = input;
      return await reviewsService.updateReview({
        reviewId,
        userId: ctx.user.id,
        ...updateData,
      });
    }),

  /**
   * Delete a review
   */
  delete: protectedProcedure
    .input(
      z.object({
        reviewId: z.number().int().positive(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return await reviewsService.deleteReview(input.reviewId, ctx.user.id);
    }),

  /**
   * Get user's reviews
   */
  getUserReviews: protectedProcedure
    .input(
      z.object({
        limit: z.number().int().min(1).max(100).optional(),
        offset: z.number().int().min(0).optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      return await reviewsService.getUserReviews(ctx.user.id, {
        limit: input.limit,
        offset: input.offset,
      });
    }),

  /**
   * Mark review as helpful
   */
  markHelpful: protectedProcedure
    .input(
      z.object({
        reviewId: z.number().int().positive(),
      })
    )
    .mutation(async ({ input }) => {
      return await reviewsService.markReviewHelpful(input.reviewId);
    }),
});
