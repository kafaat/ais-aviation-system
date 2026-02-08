import { z } from "zod";
import { publicProcedure, protectedProcedure, router } from "../_core/trpc";
import * as multiCityService from "../services/multi-city.service";
import { auditBookingChange } from "../services/audit.service";

/**
 * Multi-City Flights Router
 * Handles search, pricing, and booking for multi-city itineraries
 */
export const multiCityRouter = router({
  /**
   * Search for flights across multiple city segments
   * Returns available flights for each segment independently
   */
  search: publicProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/multi-city/search",
        tags: ["Multi-City"],
        summary: "Search for multi-city flights",
        description:
          "Search for available flights across multiple city segments. Returns flights for each segment independently. Supports 2-5 segments.",
      },
    })
    .input(
      z.object({
        segments: z
          .array(
            z.object({
              originId: z.number().describe("Origin airport ID"),
              destinationId: z.number().describe("Destination airport ID"),
              departureDate: z.date().describe("Departure date"),
            })
          )
          .min(2, "At least 2 segments required")
          .max(5, "Maximum 5 segments allowed")
          .describe("List of flight segments"),
      })
    )
    .mutation(async ({ input }) => {
      return await multiCityService.searchMultiCityFlights(input.segments);
    }),

  /**
   * Calculate total price for a multi-city itinerary
   * Includes any applicable multi-city discounts
   */
  calculatePrice: publicProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/multi-city/calculate-price",
        tags: ["Multi-City"],
        summary: "Calculate multi-city booking price",
        description:
          "Calculate the total price for a multi-city itinerary including applicable discounts. Discounts: 0% (2 segments), 5% (3 segments), 8% (4 segments), 10% (5+ segments).",
      },
    })
    .input(
      z.object({
        segments: z
          .array(
            z.object({
              flightId: z.number().describe("Flight ID for this segment"),
              cabinClass: z
                .enum(["economy", "business"])
                .describe("Cabin class"),
            })
          )
          .min(2, "At least 2 segments required")
          .max(5, "Maximum 5 segments allowed")
          .describe("List of selected flights"),
        passengerCount: z
          .number()
          .min(1)
          .max(9)
          .describe("Number of passengers"),
      })
    )
    .query(async ({ input }) => {
      return await multiCityService.calculateMultiCityPrice(
        input.segments,
        input.passengerCount
      );
    }),

  /**
   * Create a multi-city booking
   * Requires authentication
   */
  create: protectedProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/multi-city/book",
        tags: ["Multi-City"],
        summary: "Create a multi-city booking",
        description:
          "Create a new multi-city booking with multiple flight segments. Requires authentication. The booking will be created in pending status until payment is completed.",
        protect: true,
      },
    })
    .input(
      z.object({
        segments: z
          .array(
            z.object({
              flightId: z.number().describe("Flight ID for this segment"),
              departureDate: z.date().describe("Departure date"),
            })
          )
          .min(2, "At least 2 segments required")
          .max(5, "Maximum 5 segments allowed")
          .describe("List of flight segments to book"),
        cabinClass: z.enum(["economy", "business"]).describe("Cabin class"),
        passengers: z
          .array(
            z.object({
              type: z
                .enum(["adult", "child", "infant"])
                .describe("Passenger type"),
              title: z
                .string()
                .optional()
                .describe("Title (Mr, Mrs, Ms, etc.)"),
              firstName: z.string().describe("First name"),
              lastName: z.string().describe("Last name"),
              dateOfBirth: z.date().optional().describe("Date of birth"),
              passportNumber: z.string().optional().describe("Passport number"),
              nationality: z.string().optional().describe("Nationality code"),
            })
          )
          .min(1)
          .describe("List of passengers"),
        sessionId: z.string().describe("Booking session ID"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const result = await multiCityService.createMultiCityBooking({
        userId: ctx.user.id,
        segments: input.segments,
        cabinClass: input.cabinClass,
        passengers: input.passengers,
        sessionId: input.sessionId,
      });

      // Audit log: Multi-city booking created
      await auditBookingChange(
        result.bookingId,
        result.bookingReference,
        ctx.user.id,
        ctx.user.role,
        "created",
        undefined,
        {
          isMultiCity: true,
          segmentCount: input.segments.length,
          cabinClass: input.cabinClass,
          passengerCount: input.passengers.length,
          totalAmount: result.totalAmount,
        },
        ctx.req.ip,
        ctx.req.headers["x-request-id"] as string
      );

      return result;
    }),

  /**
   * Get segments for a booking
   * Requires authentication and booking ownership
   */
  getSegments: protectedProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/multi-city/bookings/{bookingId}/segments",
        tags: ["Multi-City"],
        summary: "Get booking segments",
        description:
          "Get all flight segments for a multi-city booking with full flight details.",
        protect: true,
      },
    })
    .input(z.object({ bookingId: z.number().describe("Booking ID") }))
    .query(async ({ input }) => {
      return await multiCityService.getBookingSegments(input.bookingId);
    }),

  /**
   * Check if a booking is multi-city
   */
  isMultiCity: protectedProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/multi-city/bookings/{bookingId}/is-multi-city",
        tags: ["Multi-City"],
        summary: "Check if booking is multi-city",
        description:
          "Check whether a booking has multiple flight segments (multi-city).",
        protect: true,
      },
    })
    .input(z.object({ bookingId: z.number().describe("Booking ID") }))
    .query(async ({ input, ctx }) => {
      const isMultiCity = await multiCityService.isMultiCityBooking(
        input.bookingId,
        ctx.user.id
      );
      return { isMultiCity };
    }),
});
