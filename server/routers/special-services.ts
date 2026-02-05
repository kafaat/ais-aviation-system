import { z } from "zod";
import {
  publicProcedure,
  protectedProcedure,
  adminProcedure,
  router,
} from "../_core/trpc";
import * as specialServicesService from "../services/special-services.service";
import { TRPCError } from "@trpc/server";

/**
 * Special Services Router
 * Handles special service requests (meals, wheelchair, UMNR, etc.)
 */
export const specialServicesRouter = router({
  /**
   * Get available special services by type
   * Public endpoint for displaying available options
   */
  getAvailableServices: publicProcedure.query(() => {
    return specialServicesService.getAvailableServices();
  }),

  /**
   * Request a special service for a passenger
   * Protected - requires authenticated user
   */
  requestService: protectedProcedure
    .input(
      z.object({
        bookingId: z.number(),
        passengerId: z.number(),
        serviceType: z.enum([
          "meal",
          "wheelchair",
          "unaccompanied_minor",
          "extra_legroom",
          "pet_in_cabin",
          "medical_assistance",
        ]),
        serviceCode: z.string().max(20),
        details: z.any().optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const service = await specialServicesService.requestService({
          bookingId: input.bookingId,
          passengerId: input.passengerId,
          serviceType: input.serviceType,
          serviceCode: input.serviceCode,
          details: input.details,
        });

        return {
          success: true,
          service,
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to request service";
        throw new TRPCError({
          code: "BAD_REQUEST",
          message,
        });
      }
    }),

  /**
   * Get all special services for a booking
   * Protected - requires authenticated user
   */
  getBookingServices: protectedProcedure
    .input(
      z.object({
        bookingId: z.number(),
      })
    )
    .query(async ({ input }) => {
      try {
        const services = await specialServicesService.getBookingServices(
          input.bookingId
        );
        return services;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to get services";
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message,
        });
      }
    }),

  /**
   * Cancel a special service request
   * Protected - requires authenticated user who owns the booking
   */
  cancelService: protectedProcedure
    .input(
      z.object({
        serviceId: z.number(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const result = await specialServicesService.cancelService(
          input.serviceId,
          ctx.user.id
        );
        return result;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to cancel service";
        throw new TRPCError({
          code: "BAD_REQUEST",
          message,
        });
      }
    }),

  /**
   * Get service details by ID
   * Protected - requires authenticated user
   */
  getServiceById: protectedProcedure
    .input(
      z.object({
        serviceId: z.number(),
      })
    )
    .query(async ({ input }) => {
      const service = await specialServicesService.getServiceById(
        input.serviceId
      );

      if (!service) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Special service not found",
        });
      }

      return service;
    }),

  /**
   * Get services for a specific passenger
   * Protected - requires authenticated user
   */
  getPassengerServices: protectedProcedure
    .input(
      z.object({
        passengerId: z.number(),
      })
    )
    .query(async ({ input }) => {
      try {
        const services = await specialServicesService.getPassengerServices(
          input.passengerId
        );
        return services;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to get services";
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message,
        });
      }
    }),

  /**
   * Admin: Get all pending service requests
   */
  adminGetPending: adminProcedure.query(async () => {
    try {
      const services = await specialServicesService.getPendingServices();
      return services;
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to get pending services";
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message,
      });
    }
  }),

  /**
   * Admin: Update service status
   */
  adminUpdateStatus: adminProcedure
    .input(
      z.object({
        serviceId: z.number(),
        status: z.enum(["pending", "confirmed", "rejected", "cancelled"]),
        adminNotes: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const result = await specialServicesService.updateServiceStatus(
          input.serviceId,
          input.status,
          input.adminNotes
        );
        return result;
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Failed to update service status";
        throw new TRPCError({
          code: "BAD_REQUEST",
          message,
        });
      }
    }),

  /**
   * Admin: Bulk update service statuses
   */
  adminBulkUpdateStatus: adminProcedure
    .input(
      z.object({
        serviceIds: z.array(z.number()),
        status: z.enum(["pending", "confirmed", "rejected", "cancelled"]),
        adminNotes: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const result = await specialServicesService.bulkUpdateServiceStatus(
          input.serviceIds,
          input.status,
          input.adminNotes
        );
        return result;
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Failed to update service statuses";
        throw new TRPCError({
          code: "BAD_REQUEST",
          message,
        });
      }
    }),
});
