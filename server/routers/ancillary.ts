import { z } from "zod";
import { publicProcedure, protectedProcedure, router } from "../_core/trpc";
import * as ancillaryService from "../services/ancillary-services.service";
import { TRPCError } from "@trpc/server";

/**
 * Ancillary Services Router
 * Handles ancillary services (baggage, meals, seats, insurance)
 */
export const ancillaryRouter = router({
  /**
   * Get all available ancillary services
   */
  getAvailable: publicProcedure
    .input(
      z.object({
        category: z
          .enum([
            "baggage",
            "meal",
            "seat",
            "insurance",
            "lounge",
            "priority_boarding",
          ])
          .optional(),
      })
    )
    .query(async ({ input }) => {
      return await ancillaryService.getAvailableAncillaries(input.category);
    }),

  /**
   * Get ancillaries by category with filters
   */
  getByCategory: publicProcedure
    .input(
      z.object({
        category: z.enum([
          "baggage",
          "meal",
          "seat",
          "insurance",
          "lounge",
          "priority_boarding",
        ]),
        cabinClass: z.enum(["economy", "business"]).optional(),
        airlineId: z.number().optional(),
      })
    )
    .query(async ({ input }) => {
      return await ancillaryService.getAncillariesByCategory(input);
    }),

  /**
   * Get ancillary service by ID
   */
  getById: publicProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const service = await ancillaryService.getAncillaryById(input.id);
      if (!service) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Ancillary service not found",
        });
      }
      return service;
    }),

  /**
   * Add ancillary to booking (protected)
   */
  addToBooking: protectedProcedure
    .input(
      z.object({
        bookingId: z.number(),
        passengerId: z.number().optional(),
        ancillaryServiceId: z.number(),
        quantity: z.number().min(1).max(10).optional(),
        metadata: z.any().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      // TODO: Verify booking belongs to user
      return await ancillaryService.addAncillaryToBooking(input);
    }),

  /**
   * Get booking ancillaries (protected)
   */
  getBookingAncillaries: protectedProcedure
    .input(z.object({ bookingId: z.number() }))
    .query(async ({ input, ctx }) => {
      // TODO: Verify booking belongs to user
      return await ancillaryService.getBookingAncillaries(input.bookingId);
    }),

  /**
   * Remove ancillary from booking (protected)
   */
  removeFromBooking: protectedProcedure
    .input(z.object({ ancillaryId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      // TODO: Verify ancillary belongs to user's booking
      return await ancillaryService.removeAncillaryFromBooking(
        input.ancillaryId
      );
    }),

  /**
   * Calculate ancillaries total cost
   */
  calculateTotal: protectedProcedure
    .input(z.object({ bookingId: z.number() }))
    .query(async ({ input }) => {
      const total = await ancillaryService.calculateAncillariesTotalCost(
        input.bookingId
      );
      return { total };
    }),

  /**
   * Admin: Create ancillary service
   */
  adminCreate: protectedProcedure
    .input(
      z.object({
        code: z.string().max(50),
        category: z.enum([
          "baggage",
          "meal",
          "seat",
          "insurance",
          "lounge",
          "priority_boarding",
        ]),
        name: z.string().max(255),
        description: z.string().optional(),
        price: z.number().min(0),
        currency: z.string().max(3).default("SAR"),
        available: z.boolean().default(true),
        applicableCabinClasses: z.string().optional(),
        applicableAirlines: z.string().optional(),
        icon: z.string().max(255).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      // Check admin role
      if (ctx.user.role !== "admin") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Admin access required",
        });
      }

      const id = await ancillaryService.createAncillaryService(input);
      return { id, success: true };
    }),

  /**
   * Admin: Update ancillary service
   */
  adminUpdate: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        code: z.string().max(50).optional(),
        category: z
          .enum([
            "baggage",
            "meal",
            "seat",
            "insurance",
            "lounge",
            "priority_boarding",
          ])
          .optional(),
        name: z.string().max(255).optional(),
        description: z.string().optional(),
        price: z.number().min(0).optional(),
        available: z.boolean().optional(),
        applicableCabinClasses: z.string().optional(),
        applicableAirlines: z.string().optional(),
        icon: z.string().max(255).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      // Check admin role
      if (ctx.user.role !== "admin") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Admin access required",
        });
      }

      const { id, ...data } = input;
      await ancillaryService.updateAncillaryService(id, data);
      return { success: true };
    }),

  /**
   * Admin: Deactivate ancillary service
   */
  adminDeactivate: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      // Check admin role
      if (ctx.user.role !== "admin") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Admin access required",
        });
      }

      await ancillaryService.deactivateAncillaryService(input.id);
      return { success: true };
    }),
});
