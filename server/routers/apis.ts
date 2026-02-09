/**
 * Advance Passenger Information System (APIS) Router
 *
 * Endpoints for APIS data collection, validation, and submission:
 * - Passengers submit travel document info (protected)
 * - Admin validates, generates messages, and submits to authorities
 * - Public endpoint to check route requirements
 */

import { z } from "zod";
import {
  publicProcedure,
  protectedProcedure,
  adminProcedure,
  router,
} from "../_core/trpc";
import * as apisService from "../services/apis.service";

export const apisRouter = router({
  // ========================================================================
  // Passenger-facing (protected)
  // ========================================================================

  /**
   * Submit or update APIS (travel document) information for a passenger.
   * Used by passengers during the pre-departure process.
   */
  submitInfo: protectedProcedure
    .input(
      z.object({
        passengerId: z.number(),
        documentType: z.enum(["passport", "national_id", "visa"]),
        documentNumber: z
          .string()
          .min(5, "Document number must be at least 5 characters")
          .max(20, "Document number must be at most 20 characters"),
        issuingCountry: z
          .string()
          .min(2)
          .max(3)
          .transform(v => v.toUpperCase()),
        nationality: z
          .string()
          .min(2)
          .max(3)
          .transform(v => v.toUpperCase()),
        dateOfBirth: z.string().refine(val => !isNaN(Date.parse(val)), {
          message: "Invalid date format for date of birth",
        }),
        gender: z.enum(["M", "F", "U"]),
        expiryDate: z.string().refine(val => !isNaN(Date.parse(val)), {
          message: "Invalid date format for expiry date",
        }),
        givenNames: z.string().min(1, "Given names are required").max(100),
        surname: z.string().min(1, "Surname is required").max(100),
        residenceCountry: z
          .string()
          .min(2)
          .max(3)
          .transform(v => v.toUpperCase())
          .optional(),
        residenceAddress: z.string().max(500).optional(),
        destinationAddress: z.string().max(500).optional(),
        redressNumber: z.string().max(20).optional(),
        knownTravelerNumber: z.string().max(25).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const { passengerId, ...data } = input;
      return await apisService.collectPassengerInfo(passengerId, data);
    }),

  /**
   * Get the current APIS status for the logged-in user's passenger record.
   */
  getMyAPISStatus: protectedProcedure
    .input(
      z.object({
        passengerId: z.number(),
      })
    )
    .query(async ({ input }) => {
      return await apisService.getPassengerAPISStatus(input.passengerId);
    }),

  // ========================================================================
  // Admin operations
  // ========================================================================

  /**
   * Get APIS status for all passengers on a flight.
   */
  getFlightStatus: adminProcedure
    .input(
      z.object({
        flightId: z.number(),
      })
    )
    .query(async ({ input }) => {
      return await apisService.getFlightAPISStatus(input.flightId);
    }),

  /**
   * Validate APIS data for a specific passenger.
   * Checks completeness, format, and document validity.
   */
  validatePassenger: adminProcedure
    .input(
      z.object({
        passengerId: z.number(),
      })
    )
    .mutation(async ({ input }) => {
      return await apisService.validateAPISData(input.passengerId);
    }),

  /**
   * Generate an APIS message (PAXLST or PNR/GOV) for a flight.
   */
  generateMessage: adminProcedure
    .input(
      z.object({
        flightId: z.number(),
        format: z.enum(["paxlst", "pnrgov"]),
      })
    )
    .mutation(async ({ input }) => {
      return await apisService.generateAPISMessage(
        input.flightId,
        input.format
      );
    }),

  /**
   * Submit APIS data to destination country authorities.
   */
  submitToAuthorities: adminProcedure
    .input(
      z.object({
        flightId: z.number(),
        destination: z.string().min(2).max(3).optional(),
      })
    )
    .mutation(async ({ input }) => {
      return await apisService.submitToAuthorities(
        input.flightId,
        input.destination ?? ""
      );
    }),

  // ========================================================================
  // Public
  // ========================================================================

  /**
   * Get APIS requirements for a route (required fields, deadline, format).
   * Public endpoint so passengers can see what information they need.
   */
  getRequirements: publicProcedure
    .input(
      z.object({
        originCountry: z
          .string()
          .min(2)
          .max(3)
          .transform(v => v.toUpperCase()),
        destinationCountry: z
          .string()
          .min(2)
          .max(3)
          .transform(v => v.toUpperCase()),
      })
    )
    .query(async ({ input }) => {
      return await apisService.getAPISRequirements(
        input.originCountry,
        input.destinationCountry
      );
    }),

  // ========================================================================
  // Admin queries
  // ========================================================================

  /**
   * List passengers with incomplete APIS data for a flight.
   */
  flagIncomplete: adminProcedure
    .input(
      z.object({
        flightId: z.number(),
      })
    )
    .query(async ({ input }) => {
      return await apisService.flagIncompletePassengers(input.flightId);
    }),

  /**
   * Get all APIS submissions for a flight.
   */
  getSubmissions: adminProcedure
    .input(
      z.object({
        flightId: z.number(),
      })
    )
    .query(async ({ input }) => {
      return await apisService.getFlightSubmissions(input.flightId);
    }),
});
