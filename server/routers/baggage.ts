import { getBaggageCustody } from "../services/baggage-custody.service";
import {
  LICENSE_PLATE_PATTERN,
  TRACKING_POINTS,
  findBagByIdentifier,
  readBagTrackingByIdentifier,
  recordBagTrackingEvent,
  requiredPointsTimeline,
  trackByLicensePlate,
} from "../services/baggage-tracking.service";
import { getDb } from "../db";
import { airports, flights } from "../../drizzle/schema";
import { eq } from "drizzle-orm";
import { responseContracts } from "../contracts/baggage";
import { z } from "zod";
import {
  publicProcedure,
  protectedProcedure,
  adminProcedure,
  router,
} from "../_core/trpc";
import * as baggageService from "../services/baggage.service";
import { TRPCError } from "@trpc/server";
import {
  assertBookingOwnership,
  assertPassengerOwnership,
} from "../services/access-control.service";

// Baggage status enum for validation
const baggageStatusEnum = z.enum([
  "checked_in",
  "security_screening",
  "loading",
  "in_transit",
  "arrived",
  "customs",
  "ready_for_pickup",
  "claimed",
  "lost",
  "found",
  "damaged",
]);

/**
 * Baggage Router
 * Handles baggage registration, tracking, and management
 */
const custodyStage = z.enum(["acceptance", "loading", "transfer", "arrival"]);
const licensePlateInput = z.string().regex(LICENSE_PLATE_PATTERN);
export const baggageRouter = router({
  /**
   * Public Resolution 753 tracker. A licence plate is printed on the bag, so
   * it must be paired with the passenger's surname or booking reference, and
   * the response is the allow-list in the contract (no identifiers).
   */
  trackByLicensePlate: publicProcedure
    .input(
      z
        .object({
          licensePlate: licensePlateInput,
          surname: z.string().trim().min(2).max(100).optional(),
          bookingReference: z.string().trim().min(4).max(6).optional(),
        })
        .refine(v => v.surname || v.bookingReference, {
          message: "Surname or booking reference is required",
        })
    )
    .output(responseContracts["trackByLicensePlate"])
    .query(async ({ input }) => {
      const result = await trackByLicensePlate(input);
      if (!result)
        throw new TRPCError({ code: "NOT_FOUND", message: "Bag not found" });
      return result;
    }),

  /** Admin: licence plate, four Resolution 753 points per leg and every event. */
  adminTimeline: adminProcedure
    .input(z.object({ identifier: z.string().trim().min(1).max(20) }))
    .output(responseContracts["adminTimeline"])
    .query(async ({ input }) => {
      const record = await readBagTrackingByIdentifier(input.identifier);
      if (!record)
        throw new TRPCError({ code: "NOT_FOUND", message: "Bag not found" });
      return {
        bag: record.bag,
        legs: requiredPointsTimeline(record.bag.flightIds, record.events),
        events: record.events,
      };
    }),

  /**
   * Admin: record a tracking point captured by AIS (counter, ramp supervisor,
   * arrival hall). Stored with origin "system" and the operator as actor; a
   * handler scan arrives through aviationIntegrations.ingestBaggage instead.
   */
  adminRecordTrackingPoint: adminProcedure
    .input(
      z.object({
        identifier: z.string().trim().min(1).max(20),
        flightId: z.number().int().positive(),
        trackingPoint: z.enum(TRACKING_POINTS),
        stationCode: z.string().trim().length(3),
        observedAt: z.string().datetime().optional(),
        deviceId: z.string().trim().min(1).max(100).optional(),
        containerId: z.string().trim().min(1).max(20).optional(),
        scanMethod: z.enum(["manual", "scanner"]).default("manual"),
      })
    )
    .output(responseContracts["adminRecordTrackingPoint"])
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      if (!db)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Database not available",
        });
      const bag = await findBagByIdentifier(input.identifier);
      if (!bag)
        throw new TRPCError({ code: "NOT_FOUND", message: "Bag not found" });
      const [flight] = await db
        .select()
        .from(flights)
        .where(eq(flights.id, input.flightId))
        .limit(1);
      if (!flight)
        throw new TRPCError({ code: "NOT_FOUND", message: "Flight not found" });
      const stationCode = input.stationCode.toUpperCase();
      const [station] = await db
        .select({ id: airports.id })
        .from(airports)
        .where(eq(airports.code, stationCode))
        .limit(1);
      const observedAt = input.observedAt
        ? new Date(input.observedAt)
        : new Date();
      if (Math.abs(observedAt.getTime() - Date.now()) > 7 * 86400000)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Observation time must be within seven days of now",
        });
      const result = await db.transaction(tx =>
        recordBagTrackingEvent(tx, {
          baggageId: bag.id,
          flightId: flight.id,
          trackingPoint: input.trackingPoint,
          stationCode,
          airportId: station?.id ?? null,
          observedAt,
          sourceId: `ais-admin:${ctx.user.id}`,
          deviceId: input.deviceId ?? null,
          actorType: "user",
          actorId: String(ctx.user.id),
          scanMethod: input.scanMethod,
          origin: "system",
          containerId: input.containerId ?? null,
        })
      );
      return { success: true, ...result };
    }),

  custody: protectedProcedure
    .input(z.object({ tagNumber: z.string().min(1).max(20) }))
    .output(
      z.object({
        tagNumber: z.string(),
        complete: z.boolean(),
        verifiedPoints: z.number().int(),
        requiredPoints: z.number().int(),
        required: z.array(
          z.object({
            flightId: z.number().int(),
            stage: custodyStage,
            observed: z.boolean(),
          })
        ),
        events: z.array(
          z.object({
            id: z.number().int(),
            baggageId: z.number().int(),
            flightId: z.number().int(),
            stage: custodyStage,
            evidenceId: z.number().int(),
            previousEvidenceId: z.number().int().nullable(),
            airportId: z.number().int(),
            deviceId: z.string(),
            sourceId: z.string(),
            observedAt: z.date(),
          })
        ),
      })
    )
    .query(({ input, ctx }) =>
      getBaggageCustody(input.tagNumber, {
        id: ctx.user.id,
        role: ctx.user.role,
        tenantId: ctx.tenantId,
      })
    ),
  /**
   * Track baggage by tag number (public - no auth required for passengers to track)
   */
  track: publicProcedure
    .input(
      z.object({
        tagNumber: z.string().min(1).max(20),
      })
    )
    .output(responseContracts["track"])
    .query(async ({ input }) => {
      try {
        // The public response contract projects only the tracking timeline.
        return await baggageService.trackBaggage(input.tagNumber);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to track baggage";
        throw new TRPCError({
          code: "NOT_FOUND",
          message,
        });
      }
    }),

  /**
   * Get baggage by tag number
   */
  getByTag: publicProcedure
    .input(
      z.object({
        tagNumber: z.string().min(1).max(20),
      })
    )
    .output(responseContracts["getByTag"])
    .query(async ({ input }) => {
      const baggage = await baggageService.getBaggageByTag(input.tagNumber);
      if (!baggage) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Baggage not found",
        });
      }
      return baggage;
    }),

  /**
   * Register new baggage for a booking
   * Protected - requires authenticated user
   */
  register: protectedProcedure
    .input(
      z.object({
        bookingId: z.number(),
        passengerId: z.number(),
        weight: z.number().positive().max(32),
        description: z.string().max(500).optional(),
        specialHandling: z.string().max(255).optional(),
      })
    )
    .output(responseContracts["register"])
    .mutation(async ({ input, ctx }) => {
      // Ownership check: only register baggage on your own booking (IDOR)
      await assertBookingOwnership(input.bookingId, ctx.user.id, ctx.user.role);
      // Ensure the passenger actually belongs to this booking
      const passengerBookingId = await assertPassengerOwnership(
        input.passengerId,
        ctx.user.id,
        ctx.user.role
      );
      if (passengerBookingId !== input.bookingId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Passenger does not belong to the specified booking",
        });
      }
      try {
        const baggage = await baggageService.registerBaggage({
          bookingId: input.bookingId,
          passengerId: input.passengerId,
          weight: input.weight,
          description: input.description,
          specialHandling: input.specialHandling,
          recordedByUserId: ctx.user.id,
        });

        return {
          success: true,
          baggage,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        const message =
          error instanceof Error ? error.message : "Failed to register baggage";
        throw new TRPCError({
          code: "BAD_REQUEST",
          message,
        });
      }
    }),

  /**
   * Get all baggage for a booking
   * Protected - requires authenticated user
   */
  getBookingBaggage: protectedProcedure
    .input(
      z.object({
        bookingId: z.number(),
      })
    )
    .output(responseContracts["getBookingBaggage"])
    .query(async ({ input, ctx }) => {
      // Ownership check: prevent reading another user's baggage (IDOR)
      await assertBookingOwnership(input.bookingId, ctx.user.id, ctx.user.role);
      try {
        const baggage = await baggageService.getBookingBaggage(input.bookingId);
        return baggage;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        const message =
          error instanceof Error ? error.message : "Failed to get baggage";
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message,
        });
      }
    }),

  /**
   * Get all baggage for a passenger
   * Protected - requires authenticated user
   */
  getPassengerBaggage: protectedProcedure
    .input(
      z.object({
        passengerId: z.number(),
      })
    )
    .output(responseContracts["getPassengerBaggage"])
    .query(async ({ input, ctx }) => {
      // Ownership check: passenger must belong to a booking owned by caller (IDOR)
      await assertPassengerOwnership(
        input.passengerId,
        ctx.user.id,
        ctx.user.role
      );
      try {
        const baggage = await baggageService.getPassengerBaggage(
          input.passengerId
        );
        return baggage;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        const message =
          error instanceof Error ? error.message : "Failed to get baggage";
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message,
        });
      }
    }),

  /**
   * Report lost baggage
   * Protected - requires authenticated user
   */
  reportLost: protectedProcedure
    .input(
      z.object({
        tagNumber: z.string().min(1).max(20),
        description: z.string().min(10).max(1000),
        contactEmail: z.string().email().optional(),
        contactPhone: z.string().max(20).optional(),
      })
    )
    .output(responseContracts["reportLost"])
    .mutation(async ({ input, ctx }) => {
      // A tag number is printed on the physical bag and shown by the public
      // tracker, so it is not a credential: only the booking owner (or an
      // admin) may change the bag's status and attach contact details.
      const owned = await baggageService.getBaggageByTag(input.tagNumber);
      if (!owned)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Baggage not found",
        });
      await assertBookingOwnership(owned.bookingId, ctx.user.id, ctx.user.role);
      try {
        const result = await baggageService.reportLostBaggage({
          tagNumber: input.tagNumber,
          description: input.description,
          contactEmail: input.contactEmail,
          contactPhone: input.contactPhone,
        });

        return result;
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Failed to report lost baggage";
        throw new TRPCError({
          code: "BAD_REQUEST",
          message,
        });
      }
    }),

  /**
   * Get status labels
   * Public endpoint for UI
   */
  getStatusLabels: publicProcedure
    .output(responseContracts["getStatusLabels"])
    .query(() => {
      return baggageService.BAGGAGE_STATUS_LABELS;
    }),

  // =================== Admin Endpoints ===================

  adminTrack: adminProcedure
    .input(z.object({ tagNumber: z.string().min(1).max(20) }))
    .output(responseContracts["adminTrack"])
    .query(({ input }) => baggageService.trackBaggage(input.tagNumber)),

  /**
   * Admin: Update baggage status
   */
  adminUpdateStatus: adminProcedure
    .input(
      z.object({
        tagNumber: z.string().min(1).max(20),
        location: z.string().min(1).max(255),
        status: baggageStatusEnum,
        notes: z.string().max(500).optional(),
      })
    )
    .output(responseContracts["adminUpdateStatus"])
    .mutation(async ({ input, ctx }) => {
      try {
        const result = await baggageService.updateBaggageStatus({
          tagNumber: input.tagNumber,
          location: input.location,
          status: input.status,
          scannedBy: ctx.user.id,
          notes: input.notes,
        });

        return result;
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Failed to update baggage status";
        throw new TRPCError({
          code: "BAD_REQUEST",
          message,
        });
      }
    }),

  /**
   * Admin: Get all baggage with optional filters
   */
  adminGetAll: adminProcedure
    .input(
      z
        .object({
          status: baggageStatusEnum.optional(),
          bookingId: z.number().optional(),
        })
        .optional()
    )
    .output(responseContracts["adminGetAll"])
    .query(async ({ input }) => {
      try {
        const baggage = await baggageService.getAllBaggage(input);
        return baggage;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to get baggage";
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message,
        });
      }
    }),

  /**
   * Admin: Get lost baggage
   */
  adminGetLost: adminProcedure
    .output(responseContracts["adminGetLost"])
    .query(async () => {
      try {
        const baggage = await baggageService.getLostBaggage();
        return baggage;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to get lost baggage";
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message,
        });
      }
    }),

  /**
   * Admin: Mark baggage as found
   */
  adminMarkFound: adminProcedure
    .input(
      z.object({
        tagNumber: z.string().min(1).max(20),
        foundLocation: z.string().min(1).max(255),
        notes: z.string().max(500).optional(),
      })
    )
    .output(responseContracts["adminMarkFound"])
    .mutation(async ({ input, ctx }) => {
      try {
        const result = await baggageService.markBaggageFound({
          tagNumber: input.tagNumber,
          foundLocation: input.foundLocation,
          scannedBy: ctx.user.id,
          notes: input.notes,
        });

        return result;
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Failed to mark baggage as found";
        throw new TRPCError({
          code: "BAD_REQUEST",
          message,
        });
      }
    }),

  /**
   * Admin: Get baggage statistics
   */
  adminGetStats: adminProcedure
    .output(responseContracts["adminGetStats"])
    .query(async () => {
      try {
        const stats = await baggageService.getBaggageStats();
        return stats;
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Failed to get baggage statistics";
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message,
        });
      }
    }),

  /**
   * Admin: Get baggage by status
   */
  adminGetByStatus: adminProcedure
    .input(
      z.object({
        status: baggageStatusEnum,
      })
    )
    .output(responseContracts["adminGetByStatus"])
    .query(async ({ input }) => {
      try {
        const baggage = await baggageService.getBaggageByStatus(input.status);
        return baggage;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to get baggage";
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message,
        });
      }
    }),
});
