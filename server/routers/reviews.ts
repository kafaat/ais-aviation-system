import { responseContracts } from "../contracts/reviews";
import { z } from "zod";
import { router, protectedProcedure, publicProcedure } from "../_core/trpc";
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
        comment: z.string().max(5000).optional(),
      })
    )
    .output(responseContracts["create"])
    .mutation(async ({ ctx, input }) => {
      return await reviewsService.createReview({
        userId: ctx.user.id,
        ...input,
      });
    }),

  /**
   * Get reviews for a flight (public - anyone can view reviews)
   */
  getFlightReviews: publicProcedure
    .input(
      z.object({
        flightId: z.number().int().positive(),
        limit: z.number().int().min(1).max(100).optional(),
        offset: z.number().int().min(0).optional(),
        minRating: z.number().int().min(1).max(5).optional(),
      })
    )
    .output(responseContracts["getFlightReviews"])
    .query(async ({ input }) => {
      return await reviewsService.getFlightReviews(input.flightId, {
        limit: input.limit,
        offset: input.offset,
        minRating: input.minRating,
      });
    }),

  /**
   * Get review statistics for a flight (public)
   */
  getFlightStats: publicProcedure
    .input(
      z.object({
        flightId: z.number().int().positive(),
      })
    )
    .output(responseContracts["getFlightStats"])
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
        comment: z.string().max(5000).optional(),
      })
    )
    .output(responseContracts["update"])
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
    .output(responseContracts["delete"])
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
    .output(responseContracts["getUserReviews"])
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
    .output(responseContracts["markHelpful"])
    .mutation(async ({ input }) => {
      return await reviewsService.markReviewHelpful(input.reviewId);
    }),

  /**
   * Get reviews for an airline (aggregated from all flights)
   */
  getAirlineReviews: publicProcedure
    .input(
      z.object({
        airlineId: z.number().int().positive(),
        limit: z.number().int().min(1).max(100).optional(),
        offset: z.number().int().min(0).optional(),
        minRating: z.number().int().min(1).max(5).optional(),
      })
    )
    .output(responseContracts["getAirlineReviews"])
    .query(async ({ input }) => {
      return await reviewsService.getAirlineReviews(input.airlineId, {
        limit: input.limit,
        offset: input.offset,
        minRating: input.minRating,
      });
    }),

  /**
   * Get review statistics for an airline
   */
  getAirlineStats: publicProcedure
    .input(
      z.object({
        airlineId: z.number().int().positive(),
      })
    )
    .output(responseContracts["getAirlineStats"])
    .query(async ({ input }) => {
      return await reviewsService.getAirlineReviewStats(input.airlineId);
    }),

  /**
   * Check if user can review a flight
   */
  canReview: protectedProcedure
    .input(
      z.object({
        flightId: z.number().int().positive(),
      })
    )
    .output(responseContracts["canReview"])
    .query(async ({ ctx, input }) => {
      return await reviewsService.canUserReviewFlight(
        ctx.user.id,
        input.flightId
      );
    }),
});
