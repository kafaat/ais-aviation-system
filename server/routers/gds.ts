import { z } from "zod";
import { router, protectedProcedure, adminProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import * as gdsService from "../services/gds.service";

// ============================================================================
// Input Schemas
// ============================================================================

const gdsProviderEnum = z.enum(["amadeus", "sabre", "travelport", "travelsky"]);

const gdsEnvironmentEnum = z.enum(["production", "certification", "test"]);

const gdsConnectionStatusEnum = z.enum([
  "active",
  "inactive",
  "maintenance",
  "error",
]);

const cabinClassEnum = z.enum([
  "economy",
  "premium_economy",
  "business",
  "first",
]);

const createConnectionInput = z.object({
  provider: gdsProviderEnum.describe("GDS provider name"),
  airlineId: z.number().int().positive().describe("Airline ID"),
  connectionName: z
    .string()
    .min(1)
    .max(255)
    .describe("Human-readable connection name"),
  pseudoCityCode: z
    .string()
    .max(20)
    .optional()
    .describe("Pseudo City Code (PCC) for the GDS"),
  officeId: z
    .string()
    .max(50)
    .optional()
    .describe("Office ID for the GDS provider"),
  apiKey: z.string().min(1).describe("API key for authentication"),
  apiSecret: z.string().min(1).describe("API secret for authentication"),
  environment: gdsEnvironmentEnum.describe("Deployment environment"),
  baseUrl: z
    .string()
    .url()
    .optional()
    .describe("Custom base URL for the GDS API"),
});

const updateConnectionInput = z.object({
  id: z.number().int().positive().describe("Connection ID"),
  provider: gdsProviderEnum.optional().describe("GDS provider name"),
  connectionName: z
    .string()
    .min(1)
    .max(255)
    .optional()
    .describe("Human-readable connection name"),
  pseudoCityCode: z
    .string()
    .max(20)
    .optional()
    .describe("Pseudo City Code (PCC) for the GDS"),
  officeId: z
    .string()
    .max(50)
    .optional()
    .describe("Office ID for the GDS provider"),
  apiKey: z.string().min(1).optional().describe("API key for authentication"),
  apiSecret: z
    .string()
    .min(1)
    .optional()
    .describe("API secret for authentication"),
  environment: gdsEnvironmentEnum.optional().describe("Deployment environment"),
  baseUrl: z
    .string()
    .url()
    .optional()
    .describe("Custom base URL for the GDS API"),
  status: gdsConnectionStatusEnum.optional().describe("Connection status"),
});

const getConnectionInput = z.object({
  id: z.number().int().positive().describe("Connection ID"),
});

const listConnectionsInput = z.object({
  airlineId: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Filter by airline ID"),
  provider: gdsProviderEnum.optional().describe("Filter by GDS provider"),
  status: gdsConnectionStatusEnum
    .optional()
    .describe("Filter by connection status"),
});

const testConnectionInput = z.object({
  connectionId: z.number().int().positive().describe("Connection ID to test"),
});

const searchAvailabilityInput = z.object({
  connectionId: z
    .number()
    .int()
    .positive()
    .describe("GDS connection ID to use for the search"),
  originCode: z
    .string()
    .length(3)
    .describe("Origin airport IATA code (e.g., JFK)"),
  destinationCode: z
    .string()
    .length(3)
    .describe("Destination airport IATA code (e.g., LHR)"),
  departureDate: z.string().describe("Departure date (YYYY-MM-DD)"),
  returnDate: z
    .string()
    .optional()
    .describe("Return date for round-trip (YYYY-MM-DD)"),
  cabinClass: cabinClassEnum.optional().describe("Preferred cabin class"),
  passengers: z.number().int().min(1).max(9).describe("Number of passengers"),
});

const passengerSchema = z.object({
  firstName: z.string().min(1).describe("Passenger first name"),
  lastName: z.string().min(1).describe("Passenger last name"),
  dateOfBirth: z.string().describe("Date of birth (YYYY-MM-DD)"),
  gender: z.enum(["male", "female"]).describe("Passenger gender"),
  passportNumber: z
    .string()
    .optional()
    .describe("Passport number for international flights"),
  nationality: z.string().max(3).optional().describe("Nationality ISO code"),
  email: z.string().email().optional().describe("Passenger email"),
  phone: z.string().optional().describe("Passenger phone number"),
});

const createGdsBookingInput = z.object({
  connectionId: z
    .number()
    .int()
    .positive()
    .describe("GDS connection ID to use"),
  flightNumber: z.string().min(1).describe("Flight number (e.g., SV123)"),
  departureDate: z.string().describe("Departure date (YYYY-MM-DD)"),
  passengers: z
    .array(passengerSchema)
    .min(1)
    .max(9)
    .describe("Passenger details"),
  cabinClass: z.string().min(1).describe("Cabin class code"),
});

const getMessageLogInput = z.object({
  connectionId: z.number().int().positive().describe("GDS connection ID"),
  messageType: z
    .string()
    .optional()
    .describe("Filter by message type (e.g., SEARCH, BOOK, CANCEL)"),
  status: z
    .enum(["sent", "received", "error", "timeout"])
    .optional()
    .describe("Filter by message status"),
  page: z.number().int().min(1).default(1).describe("Page number"),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(20)
    .describe("Items per page"),
});

const getStatisticsInput = z.object({
  connectionId: z.number().int().positive().describe("GDS connection ID"),
  dateFrom: z
    .string()
    .optional()
    .describe("Start date for statistics (YYYY-MM-DD)"),
  dateTo: z
    .string()
    .optional()
    .describe("End date for statistics (YYYY-MM-DD)"),
});

// ============================================================================
// Router Definition
// ============================================================================

/**
 * GDS (Global Distribution System) Router
 * Handles GDS provider connections, availability searches,
 * booking creation, message logging, and provider statistics.
 */
export const gdsRouter = router({
  // ============================================================================
  // Connection Management (Admin)
  // ============================================================================

  /**
   * Register a new GDS connection
   */
  createConnection: adminProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/gds/connections",
        tags: ["GDS"],
        summary: "Register a new GDS connection",
        description:
          "Register a new GDS provider connection with credentials and configuration. Supports Amadeus, Sabre, Travelport, and TravelSky.",
        protect: true,
      },
    })
    .input(createConnectionInput)
    .mutation(async ({ input, ctx }) => {
      try {
        const connection = await gdsService.createConnection({
          ...input,
          createdBy: ctx.user.id,
        });

        return {
          success: true,
          data: connection,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error
              ? error.message
              : "Failed to create GDS connection",
        });
      }
    }),

  /**
   * Update an existing GDS connection
   */
  updateConnection: adminProcedure
    .meta({
      openapi: {
        method: "PUT",
        path: "/gds/connections/{id}",
        tags: ["GDS"],
        summary: "Update a GDS connection",
        description:
          "Update configuration, credentials, or status of an existing GDS connection.",
        protect: true,
      },
    })
    .input(updateConnectionInput)
    .mutation(async ({ input }) => {
      try {
        const { id, ...updates } = input;
        const connection = await gdsService.updateConnection(
          id,
          updates as Parameters<typeof gdsService.updateConnection>[1]
        );

        return {
          success: true,
          data: connection,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error
              ? error.message
              : "Failed to update GDS connection",
        });
      }
    }),

  /**
   * Get details of a specific GDS connection
   */
  getConnection: adminProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/gds/connections/{id}",
        tags: ["GDS"],
        summary: "Get GDS connection details",
        description:
          "Retrieve full details of a GDS connection, including configuration and current status. API secrets are masked in the response.",
        protect: true,
      },
    })
    .input(getConnectionInput)
    .query(async ({ input }) => {
      try {
        const connection = await gdsService.getConnection(input.id);

        if (!connection) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: `GDS connection with ID ${input.id} not found`,
          });
        }

        return {
          success: true,
          data: connection,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error
              ? error.message
              : "Failed to get GDS connection",
        });
      }
    }),

  /**
   * List all GDS connections with optional filters
   */
  listConnections: adminProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/gds/connections",
        tags: ["GDS"],
        summary: "List GDS connections",
        description:
          "List all registered GDS connections with optional filtering by airline, provider, or status.",
        protect: true,
      },
    })
    .input(listConnectionsInput)
    .query(async ({ input }) => {
      try {
        const connections = await gdsService.listConnections(input);

        return {
          success: true,
          data: connections,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error
              ? error.message
              : "Failed to list GDS connections",
        });
      }
    }),

  /**
   * Test a GDS connection's health and connectivity
   */
  testConnection: adminProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/gds/connections/{connectionId}/test",
        tags: ["GDS"],
        summary: "Test GDS connection health",
        description:
          "Send a health check request to the GDS provider to verify the connection is active and credentials are valid.",
        protect: true,
      },
    })
    .input(testConnectionInput)
    .mutation(async ({ input }) => {
      try {
        const result = await gdsService.testConnection(input.connectionId);

        return {
          success: true,
          data: result,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error
              ? error.message
              : "Failed to test GDS connection",
        });
      }
    }),

  // ============================================================================
  // Availability & Booking (Protected)
  // ============================================================================

  /**
   * Search flight availability via a GDS provider
   */
  searchAvailability: protectedProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/gds/search",
        tags: ["GDS"],
        summary: "Search flight availability via GDS",
        description:
          "Search for available flights through a GDS provider connection. Returns pricing, availability, and schedule information from the GDS.",
        protect: true,
      },
    })
    .input(searchAvailabilityInput)
    .query(async ({ input, ctx }) => {
      try {
        const results = await gdsService.searchAvailability({
          ...input,
          userId: ctx.user.id,
        });

        return {
          success: true,
          data: results,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error
              ? error.message
              : "Failed to search GDS availability",
        });
      }
    }),

  /**
   * Create a booking via a GDS provider
   */
  createGdsBooking: protectedProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/gds/bookings",
        tags: ["GDS"],
        summary: "Create a booking via GDS",
        description:
          "Create a new booking through a GDS provider. Sends a PNR creation request to the GDS and returns the confirmation details including the GDS PNR locator.",
        protect: true,
      },
    })
    .input(createGdsBookingInput)
    .mutation(async ({ input, ctx }) => {
      try {
        const booking = await gdsService.createGdsBooking({
          ...input,
          userId: ctx.user.id,
        });

        return {
          success: true,
          data: booking,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error
              ? error.message
              : "Failed to create GDS booking",
        });
      }
    }),

  // ============================================================================
  // Logging & Statistics (Admin)
  // ============================================================================

  /**
   * Get GDS message log for a connection
   */
  getMessageLog: adminProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/gds/connections/{connectionId}/messages",
        tags: ["GDS"],
        summary: "Get GDS message log",
        description:
          "Retrieve the message log for a GDS connection, including request/response payloads, timestamps, and error details. Supports filtering by message type and status.",
        protect: true,
      },
    })
    .input(getMessageLogInput)
    .query(async ({ input }) => {
      try {
        const { connectionId, messageType, status, page, limit } = input;
        const messages = await gdsService.getMessageLog({
          connectionId,
          messageType,
          status,
          page,
          limit,
        });

        return {
          success: true,
          data: messages,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error
              ? error.message
              : "Failed to get GDS message log",
        });
      }
    }),

  /**
   * Get usage statistics for a GDS connection
   */
  getStatistics: adminProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/gds/connections/{connectionId}/statistics",
        tags: ["GDS"],
        summary: "Get GDS provider statistics",
        description:
          "Retrieve usage statistics for a GDS connection including request counts, response times, error rates, and booking volumes over a date range.",
        protect: true,
      },
    })
    .input(getStatisticsInput)
    .query(async ({ input }) => {
      try {
        const { connectionId, dateFrom, dateTo } = input;
        const statistics = await gdsService.getStatistics({
          connectionId,
          dateFrom,
          dateTo,
        });

        return {
          success: true,
          data: statistics,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error
              ? error.message
              : "Failed to get GDS statistics",
        });
      }
    }),
});
