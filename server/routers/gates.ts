import { z } from "zod";
import {
  publicProcedure,
  protectedProcedure,
  adminProcedure,
  router,
} from "../_core/trpc";
import * as gateService from "../services/gate.service";

/**
 * Gates Router
 * Handles all gate-related operations
 */
export const gatesRouter = router({
  // ============================================================================
  // Public Procedures
  // ============================================================================

  /**
   * Get gate assignment for a specific flight
   */
  getFlightGate: publicProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/gates/flight/{flightId}",
        tags: ["Gates"],
        summary: "Get gate assignment for a flight",
        description:
          "Retrieve the current gate assignment for a specific flight, including gate number, terminal, and boarding times.",
      },
    })
    .input(
      z.object({
        flightId: z.number().describe("Flight ID"),
      })
    )
    .query(async ({ input }) => {
      return await gateService.getFlightGate(input.flightId);
    }),

  /**
   * Get all gates for an airport (for display purposes)
   */
  getAirportGates: publicProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/gates/airport/{airportId}",
        tags: ["Gates"],
        summary: "Get all gates at an airport",
        description:
          "Retrieve a list of all gates at a specific airport, ordered by terminal and gate number.",
      },
    })
    .input(
      z.object({
        airportId: z.number().describe("Airport ID"),
      })
    )
    .query(async ({ input }) => {
      return await gateService.getAirportGates(input.airportId);
    }),

  // ============================================================================
  // Admin Procedures
  // ============================================================================

  /**
   * Get available gates at an airport for a specific time
   */
  getAvailableGates: adminProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/gates/available",
        tags: ["Gates", "Admin"],
        summary: "Get available gates",
        description:
          "Get a list of available gates at an airport for a specific date/time. Considers gate type (domestic/international) and current assignments.",
      },
    })
    .input(
      z.object({
        airportId: z.number().describe("Airport ID"),
        dateTime: z.date().describe("Date and time for the assignment"),
        flightType: z
          .enum(["domestic", "international"])
          .optional()
          .describe("Type of flight for filtering gates"),
      })
    )
    .query(async ({ input }) => {
      return await gateService.getAvailableGates(input);
    }),

  /**
   * Assign a gate to a flight
   */
  assignGate: adminProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/gates/assign",
        tags: ["Gates", "Admin"],
        summary: "Assign gate to flight",
        description:
          "Assign a gate to a flight with optional boarding times. Creates a new gate assignment record.",
      },
    })
    .input(
      z.object({
        flightId: z.number().describe("Flight ID"),
        gateId: z.number().describe("Gate ID to assign"),
        boardingStartTime: z.date().optional().describe("Boarding start time"),
        boardingEndTime: z.date().optional().describe("Boarding end time"),
      })
    )
    .mutation(async ({ input, ctx }) => {
      return await gateService.assignGate({
        ...input,
        assignedBy: ctx.user?.id,
      });
    }),

  /**
   * Update gate assignment (change gate)
   */
  updateGateAssignment: adminProcedure
    .meta({
      openapi: {
        method: "PUT",
        path: "/gates/assignment",
        tags: ["Gates", "Admin"],
        summary: "Change gate assignment",
        description:
          "Update the gate assignment for a flight. Sends notifications to affected passengers.",
      },
    })
    .input(
      z.object({
        flightId: z.number().describe("Flight ID"),
        newGateId: z.number().describe("New gate ID"),
        changeReason: z
          .string()
          .optional()
          .describe("Reason for the gate change"),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const result = await gateService.updateGateAssignment({
        ...input,
        assignedBy: ctx.user?.id,
      });

      // Get old gate info for notification
      if (result.oldGateId) {
        const oldGates = await gateService.getAirportGates(
          (await gateService.getFlightGate(input.flightId))?.gateId || 0
        );
        const oldGate = oldGates.find(g => g.id === result.oldGateId);
        if (oldGate) {
          // Send notifications asynchronously
          gateService
            .notifyGateChange(
              input.flightId,
              oldGate.gateNumber,
              result.newGateNumber,
              result.newTerminal
            )
            .catch(err =>
              console.error("Failed to send gate change notifications:", err)
            );
        }
      }

      return result;
    }),

  /**
   * Release gate from flight
   */
  releaseGate: adminProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/gates/release",
        tags: ["Gates", "Admin"],
        summary: "Release gate from flight",
        description:
          "Release a gate assignment when a flight departs or is cancelled.",
      },
    })
    .input(
      z.object({
        flightId: z.number().describe("Flight ID"),
      })
    )
    .mutation(async ({ input }) => {
      return await gateService.releaseGate(input.flightId);
    }),

  /**
   * Get gate schedule for an airport
   */
  getGateSchedule: adminProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/gates/schedule",
        tags: ["Gates", "Admin"],
        summary: "Get gate schedule",
        description:
          "Get the complete gate schedule for an airport on a specific date, showing all gates and their assignments.",
      },
    })
    .input(
      z.object({
        airportId: z.number().describe("Airport ID"),
        date: z.date().describe("Date for the schedule"),
      })
    )
    .query(async ({ input }) => {
      return await gateService.getGateSchedule(input);
    }),

  /**
   * Create a new gate
   */
  createGate: adminProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/gates",
        tags: ["Gates", "Admin"],
        summary: "Create a new gate",
        description: "Create a new gate at an airport.",
      },
    })
    .input(
      z.object({
        airportId: z.number().describe("Airport ID"),
        gateNumber: z
          .string()
          .min(1)
          .max(10)
          .describe("Gate number (e.g., A1, B12)"),
        terminal: z
          .string()
          .max(50)
          .optional()
          .describe("Terminal name or number"),
        type: z
          .enum(["domestic", "international", "both"])
          .optional()
          .describe("Gate type"),
        capacity: z
          .string()
          .max(50)
          .optional()
          .describe("Aircraft capacity (e.g., narrow-body, wide-body)"),
        amenities: z.array(z.string()).optional().describe("List of amenities"),
      })
    )
    .mutation(async ({ input }) => {
      return await gateService.createGate(input);
    }),

  /**
   * Update gate status
   */
  updateGateStatus: adminProcedure
    .meta({
      openapi: {
        method: "PATCH",
        path: "/gates/{gateId}/status",
        tags: ["Gates", "Admin"],
        summary: "Update gate status",
        description:
          "Update the status of a gate (available, occupied, maintenance).",
      },
    })
    .input(
      z.object({
        gateId: z.number().describe("Gate ID"),
        status: z
          .enum(["available", "occupied", "maintenance"])
          .describe("New status"),
      })
    )
    .mutation(async ({ input }) => {
      return await gateService.updateGateStatus(input);
    }),

  /**
   * Delete a gate
   */
  deleteGate: adminProcedure
    .meta({
      openapi: {
        method: "DELETE",
        path: "/gates/{gateId}",
        tags: ["Gates", "Admin"],
        summary: "Delete a gate",
        description:
          "Delete a gate. Cannot delete gates with active assignments.",
      },
    })
    .input(
      z.object({
        gateId: z.number().describe("Gate ID to delete"),
      })
    )
    .mutation(async ({ input }) => {
      return await gateService.deleteGate(input.gateId);
    }),

  /**
   * Get gate statistics
   */
  getStats: adminProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/gates/stats",
        tags: ["Gates", "Admin"],
        summary: "Get gate statistics",
        description:
          "Get statistics about gates including availability, occupancy, and daily assignment counts.",
      },
    })
    .input(
      z
        .object({
          airportId: z
            .number()
            .optional()
            .describe("Optional airport ID to filter stats"),
        })
        .optional()
    )
    .query(async ({ input }) => {
      return await gateService.getGateStats(input?.airportId);
    }),

  /**
   * Send gate change notification manually
   */
  notifyGateChange: adminProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/gates/notify",
        tags: ["Gates", "Admin"],
        summary: "Send gate change notification",
        description: "Manually trigger gate change notifications for a flight.",
      },
    })
    .input(
      z.object({
        flightId: z.number().describe("Flight ID"),
        oldGateNumber: z.string().describe("Old gate number"),
        newGateNumber: z.string().describe("New gate number"),
        newTerminal: z.string().nullable().describe("New terminal (optional)"),
      })
    )
    .mutation(async ({ input }) => {
      return await gateService.notifyGateChange(
        input.flightId,
        input.oldGateNumber,
        input.newGateNumber,
        input.newTerminal
      );
    }),
});
