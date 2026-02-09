import { z } from "zod";
import { adminProcedure, router } from "../_core/trpc";
import {
  getActiveIROPSDisruptions,
  createDisruptionEvent,
  getDisruptionImpact,
  getAffectedPassengers,
  autoTriggerProtection,
  getIROPSDashboard,
  getRecoveryMetrics,
  sendMassNotification,
  getConnectionsAtRisk,
  escalateDisruption,
  resolveIROPSEvent,
  getIROPSEventDetail,
} from "../services/irops.service";
import { TRPCError } from "@trpc/server";

/**
 * IROPS (Irregular Operations) Router
 * Command center for managing flight disruptions, passenger protection,
 * and recovery operations.
 */
export const iropsRouter = router({
  /**
   * Get IROPS dashboard summary
   * Returns active disruptions count, passengers affected, recovery rate, etc.
   */
  getDashboard: adminProcedure.query(async () => {
    try {
      return await getIROPSDashboard();
    } catch (error) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message:
          error instanceof Error
            ? error.message
            : "Failed to load IROPS dashboard",
      });
    }
  }),

  /**
   * Get all active disruption events
   */
  getActiveDisruptions: adminProcedure.query(async () => {
    try {
      return await getActiveIROPSDisruptions();
    } catch (error) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message:
          error instanceof Error
            ? error.message
            : "Failed to load active disruptions",
      });
    }
  }),

  /**
   * Create a new IROPS disruption event
   */
  createEvent: adminProcedure
    .input(
      z.object({
        flightId: z.number(),
        type: z.enum([
          "delay",
          "cancellation",
          "diversion",
          "equipment_change",
        ]),
        reason: z.string().min(5).max(500),
        severity: z.enum(["low", "medium", "high", "critical"]),
        delayMinutes: z.number().min(0).optional(),
        estimatedRecoveryTime: z.date().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await createDisruptionEvent(input.flightId, input.type, {
          reason: input.reason,
          severity: input.severity,
          delayMinutes: input.delayMinutes,
          estimatedRecoveryTime: input.estimatedRecoveryTime,
          createdBy: ctx.user.id,
        });
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            error instanceof Error
              ? error.message
              : "Failed to create IROPS event",
        });
      }
    }),

  /**
   * Get detailed info for a specific IROPS event
   */
  getEventDetail: adminProcedure
    .input(z.object({ eventId: z.number() }))
    .query(async ({ input }) => {
      try {
        const detail = await getIROPSEventDetail(input.eventId);
        if (!detail) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "IROPS event not found",
          });
        }
        return detail;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error
              ? error.message
              : "Failed to load event detail",
        });
      }
    }),

  /**
   * Get all affected passengers for a disrupted flight
   */
  getAffectedPassengers: adminProcedure
    .input(z.object({ flightId: z.number() }))
    .query(async ({ input }) => {
      try {
        return await getAffectedPassengers(input.flightId);
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error
              ? error.message
              : "Failed to load affected passengers",
        });
      }
    }),

  /**
   * Get passengers with connections at risk
   */
  getConnectionsAtRisk: adminProcedure
    .input(z.object({ flightId: z.number() }))
    .query(async ({ input }) => {
      try {
        return await getConnectionsAtRisk(input.flightId);
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error
              ? error.message
              : "Failed to load connections at risk",
        });
      }
    }),

  /**
   * Trigger automatic passenger protection (rebook, notify, meal voucher)
   */
  triggerAutoProtection: adminProcedure
    .input(z.object({ flightId: z.number() }))
    .mutation(async ({ input }) => {
      try {
        return await autoTriggerProtection(input.flightId);
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error
              ? error.message
              : "Failed to trigger auto protection",
        });
      }
    }),

  /**
   * Send mass notification to all affected passengers
   */
  sendNotification: adminProcedure
    .input(
      z.object({
        flightId: z.number(),
        message: z.string().min(10).max(1000),
      })
    )
    .mutation(async ({ input }) => {
      try {
        return await sendMassNotification(input.flightId, input.message);
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error
              ? error.message
              : "Failed to send notifications",
        });
      }
    }),

  /**
   * Escalate a disruption to a higher severity level
   */
  escalate: adminProcedure
    .input(
      z.object({
        disruptionId: z.number(),
        level: z.enum(["low", "medium", "high", "critical"]),
      })
    )
    .mutation(async ({ input }) => {
      try {
        return await escalateDisruption(input.disruptionId, input.level);
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            error instanceof Error
              ? error.message
              : "Failed to escalate disruption",
        });
      }
    }),

  /**
   * Resolve an IROPS event (mark as resolved, complete pending actions)
   */
  resolveEvent: adminProcedure
    .input(z.object({ eventId: z.number() }))
    .mutation(async ({ input }) => {
      try {
        return await resolveIROPSEvent(input.eventId);
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            error instanceof Error
              ? error.message
              : "Failed to resolve IROPS event",
        });
      }
    }),

  /**
   * Get recovery performance metrics for a date range
   */
  getRecoveryMetrics: adminProcedure
    .input(
      z.object({
        start: z.date(),
        end: z.date(),
      })
    )
    .query(async ({ input }) => {
      try {
        return await getRecoveryMetrics({ start: input.start, end: input.end });
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error
              ? error.message
              : "Failed to load recovery metrics",
        });
      }
    }),
});
