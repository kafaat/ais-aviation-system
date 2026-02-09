/**
 * Flight Tracking Router
 *
 * tRPC endpoints for real-time flight tracking
 *
 * @module routers/flight-tracking.router
 */

import { z } from "zod";
import { router, publicProcedure, adminProcedure } from "../_core/trpc";
import {
  getFlightTrackingByNumber,
  getFlightTrackingById,
  recordFlightPosition,
  getActiveFlights,
} from "../services/flight-tracking.service";
import { TRPCError } from "@trpc/server";

export const flightTrackingRouter = router({
  /**
   * Track a flight by flight number
   */
  trackByNumber: publicProcedure
    .input(
      z.object({
        flightNumber: z.string().min(1).max(20),
      })
    )
    .query(async ({ input }) => {
      const data = await getFlightTrackingByNumber(input.flightNumber);
      if (!data) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Flight not found",
        });
      }
      return data;
    }),

  /**
   * Track a flight by ID
   */
  trackById: publicProcedure
    .input(
      z.object({
        flightId: z.number().int().positive(),
      })
    )
    .query(async ({ input }) => {
      const data = await getFlightTrackingById(input.flightId);
      if (!data) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Flight not found",
        });
      }
      return data;
    }),

  /**
   * Get all currently active flights (for map view)
   */
  activeFlights: publicProcedure.query(async () => {
    return await getActiveFlights();
  }),

  /**
   * Record flight position (admin/system only)
   */
  recordPosition: adminProcedure
    .input(
      z.object({
        flightId: z.number().int().positive(),
        latitude: z.string(),
        longitude: z.string(),
        altitude: z.number().int().min(0),
        heading: z.number().int().min(0).max(360),
        groundSpeed: z.number().int().min(0),
        phase: z.enum([
          "boarding",
          "taxiing",
          "takeoff",
          "climbing",
          "cruising",
          "descending",
          "approach",
          "landing",
          "arrived",
        ]),
        estimatedArrival: z.date().optional(),
        temperature: z.number().int().optional(),
        windSpeed: z.number().int().min(0).optional(),
        windDirection: z.number().int().min(0).max(360).optional(),
        turbulence: z.enum(["none", "light", "moderate", "severe"]).optional(),
        distanceCovered: z.number().int().min(0).optional(),
        distanceRemaining: z.number().int().min(0).optional(),
        progressPercent: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const result = await recordFlightPosition(input);
      return { success: true, id: result.id };
    }),
});

export type FlightTrackingRouter = typeof flightTrackingRouter;
