/**
 * Travel Agent Router
 *
 * Provides API endpoints for:
 * - Admin: Agent management, commission approval
 * - Agent API: Flight search, bookings, statistics
 *
 * @version 1.0.0
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  publicProcedure,
  protectedProcedure,
  adminProcedure,
  router,
} from "../_core/trpc";
import * as travelAgentService from "../services/travel-agent.service";

// ============ Input Schemas ============

const registerAgentSchema = z.object({
  agencyName: z.string().min(1).max(255),
  iataNumber: z.string().min(1).max(20),
  contactName: z.string().min(1).max(255),
  email: z.string().email().max(320),
  phone: z.string().min(1).max(50),
  commissionRate: z.number().min(0).max(50).optional(),
  dailyBookingLimit: z.number().int().positive().optional(),
  monthlyBookingLimit: z.number().int().positive().optional(),
});

const searchFlightsSchema = z.object({
  originCode: z.string().length(3),
  destinationCode: z.string().length(3),
  departureDate: z.date(),
  returnDate: z.date().optional(),
  cabinClass: z.enum(["economy", "business"]).optional(),
  passengers: z.number().int().positive().optional(),
});

const passengerSchema = z.object({
  type: z.enum(["adult", "child", "infant"]),
  title: z.string().optional(),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  dateOfBirth: z.date().optional(),
  passportNumber: z.string().optional(),
  nationality: z.string().optional(),
});

const createBookingSchema = z.object({
  flightId: z.number().int().positive(),
  cabinClass: z.enum(["economy", "business"]),
  passengers: z.array(passengerSchema).min(1).max(9),
  externalReference: z.string().max(100).optional(),
  contactEmail: z.string().email(),
  contactPhone: z.string().min(1),
});

const bookingFiltersSchema = z.object({
  status: z.enum(["pending", "confirmed", "cancelled", "completed"]).optional(),
  startDate: z.date().optional(),
  endDate: z.date().optional(),
  page: z.number().int().positive().optional(),
  limit: z.number().int().positive().max(100).optional(),
});

const apiCredentialsSchema = z.object({
  apiKey: z.string().min(1),
  apiSecret: z.string().min(1),
});

// ============ Router ============

export const travelAgentRouter = router({
  // ==================== Admin Endpoints ====================

  /**
   * Register a new travel agent (Admin only)
   */
  register: adminProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/admin/travel-agents",
        tags: ["Travel Agents - Admin"],
        summary: "Register a new travel agent",
        description:
          "Register a new travel agency with IATA credentials. Returns API keys for authentication.",
        protect: true,
      },
    })
    .input(registerAgentSchema)
    .mutation(async ({ input }) => {
      return await travelAgentService.registerAgent(input);
    }),

  /**
   * List all travel agents (Admin only)
   */
  list: adminProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/admin/travel-agents",
        tags: ["Travel Agents - Admin"],
        summary: "List all travel agents",
        description: "Get a paginated list of all registered travel agents.",
        protect: true,
      },
    })
    .input(
      z
        .object({
          isActive: z.boolean().optional(),
          page: z.number().int().positive().optional(),
          limit: z.number().int().positive().max(100).optional(),
        })
        .optional()
    )
    .query(async ({ input }) => {
      return await travelAgentService.listAgents(input ?? {});
    }),

  /**
   * Get agent details (Admin only)
   */
  getById: adminProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/admin/travel-agents/{id}",
        tags: ["Travel Agents - Admin"],
        summary: "Get travel agent details",
        description: "Get detailed information about a specific travel agent.",
        protect: true,
      },
    })
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input }) => {
      const agent = await travelAgentService.getAgentById(input.id);
      if (!agent) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Agent not found" });
      }
      return agent;
    }),

  /**
   * Regenerate API credentials (Admin only)
   */
  regenerateCredentials: adminProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/admin/travel-agents/{id}/regenerate-credentials",
        tags: ["Travel Agents - Admin"],
        summary: "Regenerate API credentials",
        description:
          "Generate new API key and secret for an agent. Old credentials will be invalidated.",
        protect: true,
      },
    })
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      return await travelAgentService.generateApiCredentials(input.id);
    }),

  /**
   * Update agent status (Admin only)
   */
  updateStatus: adminProcedure
    .meta({
      openapi: {
        method: "PATCH",
        path: "/admin/travel-agents/{id}/status",
        tags: ["Travel Agents - Admin"],
        summary: "Update agent status",
        description: "Activate or deactivate a travel agent account.",
        protect: true,
      },
    })
    .input(
      z.object({
        id: z.number().int().positive(),
        isActive: z.boolean(),
      })
    )
    .mutation(async ({ input }) => {
      await travelAgentService.updateAgentStatus(input.id, input.isActive);
      return { success: true };
    }),

  /**
   * Update commission rate (Admin only)
   */
  updateCommissionRate: adminProcedure
    .meta({
      openapi: {
        method: "PATCH",
        path: "/admin/travel-agents/{id}/commission",
        tags: ["Travel Agents - Admin"],
        summary: "Update commission rate",
        description: "Update the commission rate for a travel agent (0-50%).",
        protect: true,
      },
    })
    .input(
      z.object({
        id: z.number().int().positive(),
        commissionRate: z.number().min(0).max(50),
      })
    )
    .mutation(async ({ input }) => {
      await travelAgentService.updateAgentCommissionRate(
        input.id,
        input.commissionRate
      );
      return { success: true };
    }),

  /**
   * Get agent statistics (Admin only)
   */
  getAgentStats: adminProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/admin/travel-agents/{id}/stats",
        tags: ["Travel Agents - Admin"],
        summary: "Get agent statistics",
        description:
          "Get booking and commission statistics for a travel agent.",
        protect: true,
      },
    })
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input }) => {
      return await travelAgentService.getAgentStats(input.id);
    }),

  /**
   * Get pending commissions (Admin only)
   */
  getPendingCommissions: adminProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/admin/travel-agents/commissions/pending",
        tags: ["Travel Agents - Admin"],
        summary: "Get pending commissions",
        description: "Get all pending commission payments awaiting approval.",
        protect: true,
      },
    })
    .query(async () => {
      return await travelAgentService.getPendingCommissions();
    }),

  /**
   * Update commission status (Admin only)
   */
  updateCommissionStatus: adminProcedure
    .meta({
      openapi: {
        method: "PATCH",
        path: "/admin/travel-agents/commissions/{id}/status",
        tags: ["Travel Agents - Admin"],
        summary: "Update commission status",
        description: "Approve or mark commission as paid.",
        protect: true,
      },
    })
    .input(
      z.object({
        id: z.number().int().positive(),
        status: z.enum(["pending", "approved", "paid", "cancelled"]),
      })
    )
    .mutation(async ({ input }) => {
      await travelAgentService.updateCommissionStatus(input.id, input.status);
      return { success: true };
    }),

  // ==================== Agent API Endpoints ====================

  /**
   * Validate agent credentials
   * Used internally by the agent API middleware
   */
  validateCredentials: publicProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/agent-api/auth/validate",
        tags: ["Travel Agents - API"],
        summary: "Validate API credentials",
        description: "Validate API key and secret for agent authentication.",
      },
    })
    .input(apiCredentialsSchema)
    .mutation(async ({ input }) => {
      const agent = await travelAgentService.validateApiKey(
        input.apiKey,
        input.apiSecret
      );

      if (!agent) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Invalid API credentials",
        });
      }

      return {
        valid: true,
        agentId: agent.id,
        agencyName: agent.agencyName,
      };
    }),

  /**
   * Search flights (Agent API)
   */
  searchFlights: publicProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/agent-api/flights/search",
        tags: ["Travel Agents - API"],
        summary: "Search available flights",
        description:
          "Search for available flights by route and date. Requires API authentication via headers.",
      },
    })
    .input(
      z.object({
        credentials: apiCredentialsSchema,
        search: searchFlightsSchema,
      })
    )
    .mutation(async ({ input }) => {
      const agent = await travelAgentService.validateApiKey(
        input.credentials.apiKey,
        input.credentials.apiSecret
      );

      if (!agent) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Invalid API credentials",
        });
      }

      return await travelAgentService.searchFlightsForAgent(
        agent.id,
        input.search
      );
    }),

  /**
   * Create booking (Agent API)
   */
  createBooking: publicProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/agent-api/bookings",
        tags: ["Travel Agents - API"],
        summary: "Create a new booking",
        description:
          "Create a flight booking on behalf of a customer. Requires API authentication.",
      },
    })
    .input(
      z.object({
        credentials: apiCredentialsSchema,
        booking: createBookingSchema,
      })
    )
    .mutation(async ({ input }) => {
      const agent = await travelAgentService.validateApiKey(
        input.credentials.apiKey,
        input.credentials.apiSecret
      );

      if (!agent) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Invalid API credentials",
        });
      }

      return await travelAgentService.createAgentBooking(
        agent.id,
        input.booking
      );
    }),

  /**
   * Get agent's bookings (Agent API)
   */
  getBookings: publicProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/agent-api/bookings/list",
        tags: ["Travel Agents - API"],
        summary: "Get agent bookings",
        description:
          "Get a list of bookings made by the agent with optional filters.",
      },
    })
    .input(
      z.object({
        credentials: apiCredentialsSchema,
        filters: bookingFiltersSchema.optional(),
      })
    )
    .mutation(async ({ input }) => {
      const agent = await travelAgentService.validateApiKey(
        input.credentials.apiKey,
        input.credentials.apiSecret
      );

      if (!agent) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Invalid API credentials",
        });
      }

      return await travelAgentService.getAgentBookings(
        agent.id,
        input.filters ?? {}
      );
    }),

  /**
   * Calculate commission (Agent API)
   */
  calculateCommission: publicProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/agent-api/commission/calculate",
        tags: ["Travel Agents - API"],
        summary: "Calculate commission",
        description:
          "Calculate the commission amount for a given booking amount.",
      },
    })
    .input(
      z.object({
        credentials: apiCredentialsSchema,
        bookingAmount: z.number().int().positive(),
      })
    )
    .mutation(async ({ input }) => {
      const agent = await travelAgentService.validateApiKey(
        input.credentials.apiKey,
        input.credentials.apiSecret
      );

      if (!agent) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Invalid API credentials",
        });
      }

      return await travelAgentService.calculateCommission(
        agent.id,
        input.bookingAmount
      );
    }),

  /**
   * Get agent statistics (Agent API)
   */
  getStats: publicProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/agent-api/stats",
        tags: ["Travel Agents - API"],
        summary: "Get agent statistics",
        description:
          "Get booking and commission statistics for the authenticated agent.",
      },
    })
    .input(
      z.object({
        credentials: apiCredentialsSchema,
      })
    )
    .mutation(async ({ input }) => {
      const agent = await travelAgentService.validateApiKey(
        input.credentials.apiKey,
        input.credentials.apiSecret
      );

      if (!agent) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Invalid API credentials",
        });
      }

      return await travelAgentService.getAgentStats(agent.id);
    }),

  // ==================== API Documentation ====================

  /**
   * Get API documentation
   */
  getApiDocumentation: publicProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/agent-api/docs",
        tags: ["Travel Agents - API"],
        summary: "Get API documentation",
        description: "Get documentation for the Travel Agent API.",
      },
    })
    .query(() => {
      return {
        version: "1.0.0",
        baseUrl: "/api/trpc/travelAgent",
        authentication: {
          type: "API Key + Secret",
          description: "Include credentials in request body for all API calls",
          example: {
            apiKey: "ais_agent_xxxxxxxxxxxx",
            apiSecret: "your_secret_here",
          },
        },
        endpoints: [
          {
            name: "Validate Credentials",
            method: "POST",
            path: "validateCredentials",
            description: "Validate API credentials and get agent info",
            input: {
              apiKey: "string (required)",
              apiSecret: "string (required)",
            },
          },
          {
            name: "Search Flights",
            method: "POST",
            path: "searchFlights",
            description: "Search for available flights",
            input: {
              credentials: "{ apiKey, apiSecret }",
              search: {
                originCode: "string (3-letter IATA code)",
                destinationCode: "string (3-letter IATA code)",
                departureDate: "date (ISO 8601)",
                returnDate: "date (optional)",
                cabinClass: "economy | business (optional)",
                passengers: "number (optional, default 1)",
              },
            },
          },
          {
            name: "Create Booking",
            method: "POST",
            path: "createBooking",
            description: "Create a new flight booking",
            input: {
              credentials: "{ apiKey, apiSecret }",
              booking: {
                flightId: "number (from search results)",
                cabinClass: "economy | business",
                passengers: "array of passenger objects",
                externalReference: "string (optional, your reference)",
                contactEmail: "string (customer email)",
                contactPhone: "string (customer phone)",
              },
            },
          },
          {
            name: "Get Bookings",
            method: "POST",
            path: "getBookings",
            description: "Get list of your bookings",
            input: {
              credentials: "{ apiKey, apiSecret }",
              filters: {
                status:
                  "pending | confirmed | cancelled | completed (optional)",
                startDate: "date (optional)",
                endDate: "date (optional)",
                page: "number (optional, default 1)",
                limit: "number (optional, max 100)",
              },
            },
          },
          {
            name: "Calculate Commission",
            method: "POST",
            path: "calculateCommission",
            description: "Calculate commission for a booking amount",
            input: {
              credentials: "{ apiKey, apiSecret }",
              bookingAmount: "number (in SAR cents)",
            },
          },
          {
            name: "Get Statistics",
            method: "POST",
            path: "getStats",
            description: "Get your booking and commission statistics",
            input: {
              credentials: "{ apiKey, apiSecret }",
            },
          },
        ],
        rateLimits: {
          daily: "100 bookings per day (default)",
          monthly: "2000 bookings per month (default)",
          api: "60 requests per minute",
        },
        errors: {
          UNAUTHORIZED: "Invalid API credentials",
          NOT_FOUND: "Resource not found",
          BAD_REQUEST: "Invalid input data",
          TOO_MANY_REQUESTS: "Rate limit exceeded",
        },
      };
    }),
});
