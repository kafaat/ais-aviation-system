import { responseContracts } from "../contracts/apis";
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
  airlineOpsProcedure,
  router,
} from "../_core/trpc";
import * as apisService from "../services/apis.service";
import * as transmissions from "../services/apis-transmission.service";
import * as documentVerification from "../services/travel-documents/document-verification.service";
import { entryRuleInputSchema } from "../services/travel-documents/entry-rules";
import { pnrgovScheduleInputSchema } from "../services/apis-pnrgov-schedule";
import { assertPassengerOwnership } from "../services/access-control.service";

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
    .output(responseContracts["submitInfo"])
    .mutation(async ({ input, ctx }) => {
      const { passengerId, ...data } = input;
      await assertPassengerOwnership(passengerId, ctx.user.id, ctx.user.role);
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
    .output(responseContracts["getMyAPISStatus"])
    .query(async ({ input, ctx }) => {
      await assertPassengerOwnership(
        input.passengerId,
        ctx.user.id,
        ctx.user.role
      );
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
    .output(responseContracts["getFlightStatus"])
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
    .output(responseContracts["validatePassenger"])
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
    .output(responseContracts["generateMessage"])
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
    .output(responseContracts["submitToAuthorities"])
    .mutation(async ({ input, ctx }) => {
      return await apisService.submitToAuthorities(
        input.flightId,
        input.destination ?? "",
        { userId: ctx.user.id, tenantId: ctx.tenantId ?? null }
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
    .output(responseContracts["getRequirements"])
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
    .output(responseContracts["flagIncomplete"])
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
    .output(responseContracts["getSubmissions"])
    .query(async ({ input }) => {
      return await apisService.getFlightSubmissions(input.flightId);
    }),

  // ========================================================================
  // Transmission layer: queue, dispatch log, acknowledgements, schedules
  // ========================================================================

  /** Transmission log for a flight (or the latest overall): the inspection evidence. */
  listTransmissions: adminProcedure
    .input(
      z.object({
        flightId: z.number().int().positive().optional(),
        limit: z.number().int().min(1).max(500).optional(),
      })
    )
    .output(responseContracts["listTransmissions"])
    .query(({ input, ctx }) =>
      transmissions.listTransmissions({
        flightId: input.flightId,
        limit: input.limit,
        tenantId: ctx.tenantId ?? null,
      })
    ),

  /** The exact body that was sent (passenger data: admin only). */
  getTransmissionBody: adminProcedure
    .input(z.object({ transmissionId: z.number().int().positive() }))
    .output(responseContracts["getTransmissionBody"])
    .query(({ input, ctx }) =>
      transmissions.getTransmissionBody({
        transmissionId: input.transmissionId,
        tenantId: ctx.tenantId ?? null,
      })
    ),

  /** Queue the configured pushes for a flight, or one immediate push. */
  queueTransmissions: adminProcedure
    .input(
      z.object({
        flightId: z.number().int().positive(),
        messageType: z.enum(["PNRGOV", "PAXLST"]).default("PNRGOV"),
        immediate: z.boolean().default(false),
      })
    )
    .output(responseContracts["queueTransmissions"])
    .mutation(({ input, ctx }) =>
      transmissions.queueFlightTransmissions({
        flightId: input.flightId,
        messageType: input.messageType,
        immediate: input.immediate,
        requestedBy: ctx.user.id,
        tenantId: ctx.tenantId ?? null,
      })
    ),

  /** Re-queue a failed, dead-letter or rejected transmission. */
  retryTransmission: adminProcedure
    .input(z.object({ transmissionId: z.number().int().positive() }))
    .output(responseContracts["retryTransmission"])
    .mutation(({ input, ctx }) =>
      transmissions.retryTransmission({
        transmissionId: input.transmissionId,
        tenantId: ctx.tenantId ?? null,
        requestedBy: ctx.user.id,
      })
    ),

  /** Record a CUSRES/CONTRL acknowledgement received out of band (bridge, e-mail, portal). */
  ingestAcknowledgement: adminProcedure
    .input(
      z.object({
        body: z.string().min(10).max(60000),
        correlationId: z
          .string()
          .regex(/^[A-Za-z0-9]{1,14}$/)
          .optional(),
      })
    )
    .output(responseContracts["ingestAcknowledgement"])
    .mutation(async ({ input, ctx }) => {
      const result = await transmissions.applyAcknowledgement({
        body: input.body,
        correlationId: input.correlationId,
        source: `operator:${ctx.user.id}`,
      });
      return {
        matched: result.matched,
        transmissionId: result.matched ? result.transmissionId : null,
        disposition: result.disposition,
        applied: result.matched ? result.applied : false,
        messageType: result.parsed.messageType,
        errors: result.parsed.errors,
      };
    }),

  listPnrgovSchedules: adminProcedure
    .output(responseContracts["listPnrgovSchedules"])
    .query(({ ctx }) =>
      transmissions.listPnrgovSchedules(ctx.tenantId ?? null)
    ),

  upsertPnrgovSchedule: adminProcedure
    .input(pnrgovScheduleInputSchema)
    .output(responseContracts["upsertPnrgovSchedule"])
    .mutation(({ input, ctx }) =>
      transmissions.upsertPnrgovSchedule(input, {
        userId: ctx.user.id,
        tenantId: ctx.tenantId ?? null,
      })
    ),

  // ========================================================================
  // Pre-boarding document verification (GACA circular, August 2026)
  // ========================================================================

  listEntryRules: adminProcedure
    .input(
      z.object({
        destinationCountry: z
          .string()
          .regex(/^[A-Za-z]{2,3}$/)
          .transform(v => v.toUpperCase())
          .optional(),
      })
    )
    .output(responseContracts["listEntryRules"])
    .query(({ input, ctx }) =>
      documentVerification.listEntryRules(
        ctx.tenantId ?? null,
        input.destinationCountry
      )
    ),

  /** Validated import from a named source; nothing is seeded as truth. */
  importEntryRules: adminProcedure
    .input(z.object({ rules: z.array(entryRuleInputSchema).min(1).max(500) }))
    .output(responseContracts["importEntryRules"])
    .mutation(({ input, ctx }) =>
      documentVerification.importEntryRules(input.rules, {
        userId: ctx.user.id,
        tenantId: ctx.tenantId ?? null,
      })
    ),

  /** Evaluate and record a passenger's verdict for a flight (preview; the
   * check-in hook records the enforcing evaluation). */
  getDocumentVerification: protectedProcedure
    .input(
      z.object({
        bookingId: z.number().int().positive(),
        passengerId: z.number().int().positive(),
        flightId: z.number().int().positive(),
      })
    )
    .output(responseContracts["getDocumentVerification"])
    .query(async ({ input, ctx }) => {
      await assertPassengerOwnership(
        input.passengerId,
        ctx.user.id,
        ctx.user.role
      );
      return documentVerification.previewVerification({
        ...input,
        evaluatedBy: ctx.user.id,
        tenantId: ctx.tenantId ?? null,
      });
    }),

  /** Authorised override with a recorded reason (admin, airline_admin, ops). */
  overrideDocumentVerification: airlineOpsProcedure
    .input(
      z.object({
        resultId: z.number().int().positive(),
        reason: z.string().min(10).max(1000),
      })
    )
    .output(responseContracts["overrideDocumentVerification"])
    .mutation(({ input, ctx }) =>
      documentVerification.overrideVerification({
        resultId: input.resultId,
        reason: input.reason,
        actor: {
          userId: ctx.user.id,
          role: ctx.user.role,
          tenantId: ctx.tenantId ?? null,
        },
      })
    ),

  listDocumentVerifications: adminProcedure
    .input(
      z.object({
        flightId: z.number().int().positive().optional(),
        bookingId: z.number().int().positive().optional(),
        limit: z.number().int().min(1).max(500).optional(),
      })
    )
    .output(responseContracts["listDocumentVerifications"])
    .query(({ input, ctx }) =>
      documentVerification.listVerificationResults({
        ...input,
        tenantId: ctx.tenantId ?? null,
      })
    ),
});
