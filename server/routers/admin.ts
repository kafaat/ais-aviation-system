import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { adminProcedure, router } from "../_core/trpc";
import * as db from "../db";
import * as flightStatusService from "../services/flight-status.service";
import * as metricsService from "../services/metrics.service";
import {
  auditFlightChange,
  auditAdminAccess,
  queryAuditLogs,
  getAuditLogById,
  getAuditLogsForResource,
  getAuditLogsForUser,
  getHighSeverityEvents,
  getAuditLogStats,
  type AuditEventCategory,
  type AuditOutcome,
  type AuditSeverity,
} from "../services/audit.service";

/**
 * Admin Router
 * Handles all admin-only operations
 */
export const adminRouter = router({
  /**
   * Create a new flight
   */
  createFlight: adminProcedure
    .input(
      z.object({
        flightNumber: z.string(),
        airlineId: z.number(),
        originId: z.number(),
        destinationId: z.number(),
        departureTime: z.date(),
        arrivalTime: z.date(),
        aircraftType: z.string().optional(),
        economySeats: z.number(),
        businessSeats: z.number(),
        economyPrice: z.number(),
        businessPrice: z.number(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const result = await db.createFlight({
        ...input,
        aircraftType: input.aircraftType || null,
        status: "scheduled",
        economyAvailable: input.economySeats,
        businessAvailable: input.businessSeats,
      });

      const flightId = Number(result[0].insertId);

      // Audit log: Flight created
      await auditFlightChange(
        flightId,
        input.flightNumber,
        ctx.user.id,
        ctx.user.role,
        "created",
        undefined,
        input,
        ctx.req.ip,
        ctx.req.headers["x-request-id"] as string
      );

      return { success: true, flightId };
    }),

  /**
   * Update flight availability
   */
  updateFlightAvailability: adminProcedure
    .input(
      z.object({
        flightId: z.number(),
        cabinClass: z.enum(["economy", "business"]),
        seats: z.number(),
      })
    )
    .mutation(async ({ input }) => {
      await db.updateFlightAvailability(
        input.flightId,
        input.cabinClass,
        input.seats
      );
      return { success: true };
    }),

  /**
   * Get all bookings (admin view)
   */
  getAllBookings: adminProcedure.query(async () => {
    const database = await db.getDb();
    if (!database)
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Database not available",
      });

    const { bookings, flights, airports, users } =
      await import("../../drizzle/schema");
    const { eq, desc, sql } = await import("drizzle-orm");

    const result = await database
      .select({
        id: bookings.id,
        bookingReference: bookings.bookingReference,
        pnr: bookings.pnr,
        status: bookings.status,
        totalAmount: bookings.totalAmount,
        paymentStatus: bookings.paymentStatus,
        cabinClass: bookings.cabinClass,
        numberOfPassengers: bookings.numberOfPassengers,
        createdAt: bookings.createdAt,
        user: {
          name: users.name,
          email: users.email,
        },
        flight: {
          flightNumber: flights.flightNumber,
          departureTime: flights.departureTime,
          origin: airports.code,
          destination: sql<string>`dest.code`,
        },
      })
      .from(bookings)
      .innerJoin(users, eq(bookings.userId, users.id))
      .innerJoin(flights, eq(bookings.flightId, flights.id))
      .innerJoin(airports, eq(flights.originId, airports.id))
      .innerJoin(sql`airports as dest`, sql`${flights.destinationId} = dest.id`)
      .orderBy(desc(bookings.createdAt));

    return result;
  }),

  /**
   * Update booking status
   */
  updateBookingStatus: adminProcedure
    .input(
      z.object({
        bookingId: z.number(),
        status: z.enum(["pending", "confirmed", "cancelled", "completed"]),
      })
    )
    .mutation(async ({ input }) => {
      await db.updateBookingStatus(input.bookingId, input.status);
      return { success: true };
    }),

  /**
   * Update flight status
   */
  updateFlightStatus: adminProcedure
    .input(
      z.object({
        flightId: z.number(),
        status: z.enum(["scheduled", "delayed", "cancelled", "completed"]),
        delayMinutes: z.number().optional(),
        reason: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Get flight details before update for audit
      const database = await db.getDb();
      if (!database)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Database not available",
        });

      const { flights } = await import("../../drizzle/schema");
      const { eq } = await import("drizzle-orm");

      const [existingFlight] = await database
        .select({ flightNumber: flights.flightNumber, status: flights.status })
        .from(flights)
        .where(eq(flights.id, input.flightId))
        .limit(1);

      const result = await flightStatusService.updateFlightStatus(input);

      // Audit log: Flight status updated
      if (existingFlight) {
        await auditFlightChange(
          input.flightId,
          existingFlight.flightNumber,
          ctx.user.id,
          ctx.user.role,
          input.status === "cancelled" ? "cancelled" : "updated",
          { status: existingFlight.status },
          {
            status: input.status,
            delayMinutes: input.delayMinutes,
            reason: input.reason,
          },
          ctx.req.ip,
          ctx.req.headers["x-request-id"] as string
        );
      }

      return result;
    }),

  /**
   * Cancel flight and refund all bookings
   */
  cancelFlightAndRefund: adminProcedure
    .input(
      z.object({
        flightId: z.number(),
        reason: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Get flight details for audit
      const database = await db.getDb();
      if (!database)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Database not available",
        });

      const { flights } = await import("../../drizzle/schema");
      const { eq } = await import("drizzle-orm");

      const [existingFlight] = await database
        .select({ flightNumber: flights.flightNumber, status: flights.status })
        .from(flights)
        .where(eq(flights.id, input.flightId))
        .limit(1);

      const result = await flightStatusService.cancelFlightAndRefund(input);

      // Audit log: Flight cancelled with refunds
      if (existingFlight) {
        await auditFlightChange(
          input.flightId,
          existingFlight.flightNumber,
          ctx.user.id,
          ctx.user.role,
          "cancelled",
          { status: existingFlight.status },
          { status: "cancelled", reason: input.reason, refundsProcessed: true },
          ctx.req.ip,
          ctx.req.headers["x-request-id"] as string
        );
      }

      return result;
    }),

  /**
   * Get comprehensive business metrics
   * Returns detailed metrics including conversion funnel, payments, revenue, and user engagement
   */
  getMetrics: adminProcedure
    .input(
      z
        .object({
          hoursBack: z.number().min(1).max(168).default(24), // 1 hour to 7 days
        })
        .optional()
    )
    .query(async ({ input }) => {
      const hoursBack = input?.hoursBack ?? 24;
      return metricsService.getBusinessMetrics(hoursBack);
    }),

  /**
   * Get lightweight metrics summary
   * Returns a quick overview of key metrics for dashboard widgets
   */
  getMetricsSummary: adminProcedure
    .input(
      z
        .object({
          hoursBack: z.number().min(1).max(24).default(1),
        })
        .optional()
    )
    .query(async ({ input }) => {
      const hoursBack = input?.hoursBack ?? 1;
      return metricsService.getMetricsSummary(hoursBack);
    }),

  /**
   * Get real-time statistics
   * Returns metrics from the last 5 minutes for live monitoring
   */
  getRealTimeStats: adminProcedure.query(async () => {
    return metricsService.getRealTimeStats();
  }),

  /**
   * Get current metrics storage info
   */
  getMetricsInfo: adminProcedure.query(async () => {
    return {
      eventCount: metricsService.getEventCount(),
      timestamp: new Date(),
    };
  }),

  /**
   * Manually flush old metrics events
   */
  flushMetrics: adminProcedure.mutation(async () => {
    const flushedCount = await metricsService.flushOldEvents();
    return {
      success: true,
      flushedEvents: flushedCount,
    };
  }),

  // ============================================================================
  // Audit Log Endpoints
  // ============================================================================

  /**
   * Query audit logs with filters
   */
  getAuditLogs: adminProcedure
    .input(
      z.object({
        userId: z.number().optional(),
        eventType: z.string().optional(),
        eventCategory: z
          .enum([
            "auth",
            "booking",
            "payment",
            "user_management",
            "flight_management",
            "refund",
            "modification",
            "access",
            "system",
          ])
          .optional(),
        outcome: z.enum(["success", "failure", "error"]).optional(),
        severity: z.enum(["low", "medium", "high", "critical"]).optional(),
        resourceType: z.string().optional(),
        resourceId: z.string().optional(),
        startDate: z.date().optional(),
        endDate: z.date().optional(),
        searchTerm: z.string().optional(),
        limit: z.number().min(1).max(500).default(50),
        offset: z.number().min(0).default(0),
      })
    )
    .query(async ({ ctx, input }) => {
      // Audit the access to audit logs
      await auditAdminAccess(
        ctx.user.id,
        ctx.user.role,
        "query_audit_logs",
        "audit_logs",
        undefined,
        ctx.req.ip,
        ctx.req.headers["x-request-id"] as string
      );

      return await queryAuditLogs({
        userId: input.userId,
        eventType: input.eventType,
        eventCategory: input.eventCategory as AuditEventCategory | undefined,
        outcome: input.outcome as AuditOutcome | undefined,
        severity: input.severity as AuditSeverity | undefined,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        startDate: input.startDate,
        endDate: input.endDate,
        searchTerm: input.searchTerm,
        limit: input.limit,
        offset: input.offset,
      });
    }),

  /**
   * Get single audit log by ID
   */
  getAuditLogById: adminProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const log = await getAuditLogById(input.id);
      if (!log) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Audit log not found",
        });
      }
      return log;
    }),

  /**
   * Get audit logs for a specific resource
   */
  getAuditLogsForResource: adminProcedure
    .input(
      z.object({
        resourceType: z.string(),
        resourceId: z.string(),
        limit: z.number().min(1).max(500).default(100),
      })
    )
    .query(async ({ input }) => {
      return await getAuditLogsForResource(
        input.resourceType,
        input.resourceId,
        input.limit
      );
    }),

  /**
   * Get audit logs for a specific user
   */
  getAuditLogsForUser: adminProcedure
    .input(
      z.object({
        userId: z.number(),
        limit: z.number().min(1).max(500).default(100),
      })
    )
    .query(async ({ input }) => {
      return await getAuditLogsForUser(input.userId, input.limit);
    }),

  /**
   * Get high severity audit events
   */
  getHighSeverityEvents: adminProcedure
    .input(
      z
        .object({
          limit: z.number().min(1).max(500).default(50),
        })
        .optional()
    )
    .query(async ({ input }) => {
      return await getHighSeverityEvents(input?.limit ?? 50);
    }),

  /**
   * Get audit log statistics
   */
  getAuditLogStats: adminProcedure
    .input(
      z
        .object({
          days: z.number().min(1).max(365).default(30),
        })
        .optional()
    )
    .query(async ({ input }) => {
      return await getAuditLogStats(input?.days ?? 30);
    }),
});
