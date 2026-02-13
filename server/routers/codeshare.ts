import { z } from "zod";
import { router, publicProcedure, adminProcedure } from "../_core/trpc";
import * as codeshareService from "../services/codeshare.service";

/**
 * Codeshare Router
 * Handles codeshare agreement management between airlines
 */
export const codeshareRouter = router({
  // ============================================================================
  // Admin Procedures
  // ============================================================================

  /**
   * Create a new codeshare agreement between a marketing and operating airline.
   * Generates a unique reference, validates both airlines exist and are active.
   */
  createAgreement: adminProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/admin/codeshare/agreements",
        tags: ["Codeshare", "Admin"],
        summary: "Create codeshare agreement",
        description:
          "Create a new codeshare agreement between a marketing carrier and an operating carrier. The agreement starts in 'draft' status.",
        protect: true,
      },
    })
    .input(
      z.object({
        marketingAirlineId: z
          .number()
          .int()
          .positive()
          .describe("ID of the marketing airline (selling tickets)"),
        operatingAirlineId: z
          .number()
          .int()
          .positive()
          .describe("ID of the operating airline (flying the aircraft)"),
        agreementType: z
          .enum(["free_sale", "block_space", "hard_block", "soft_block"])
          .describe(
            "Type of codeshare: free_sale (sell freely), block_space (fixed allocation), hard_block (guaranteed seats), soft_block (recallable seats)"
          ),
        routeScope: z
          .enum(["all_routes", "specific_routes"])
          .describe(
            "Whether the agreement covers all routes or specific route pairs"
          ),
        routes: z
          .array(
            z.object({
              originId: z
                .number()
                .int()
                .positive()
                .describe("Origin airport ID"),
              destinationId: z
                .number()
                .int()
                .positive()
                .describe("Destination airport ID"),
            })
          )
          .optional()
          .describe(
            "Array of route pairs (required when routeScope is specific_routes)"
          ),
        revenueShareModel: z
          .enum(["prorate", "fixed_amount", "percentage", "free_flow"])
          .describe(
            "Revenue sharing model: prorate (by distance), fixed_amount (per segment), percentage (of fare), free_flow (each keeps own)"
          ),
        revenueShareValue: z
          .number()
          .optional()
          .describe(
            "Revenue share value: percentage (0-100), fixed amount in SAR, or total route distance for prorate"
          ),
        blockSize: z
          .number()
          .int()
          .positive()
          .optional()
          .describe(
            "Number of seats in block (required for block_space, hard_block, soft_block)"
          ),
        validFrom: z
          .string()
          .describe("Agreement validity start date (ISO 8601 string)"),
        validUntil: z
          .string()
          .optional()
          .describe("Agreement validity end date (ISO 8601 string)"),
      })
    )
    .mutation(async ({ input }) => {
      const data = await codeshareService.createCodeshareAgreement({
        marketingAirlineId: input.marketingAirlineId,
        operatingAirlineId: input.operatingAirlineId,
        agreementType: input.agreementType,
        routeScope: input.routeScope,
        routes: input.routes,
        revenueShareModel: input.revenueShareModel,
        revenueShareValue: input.revenueShareValue
          ? String(input.revenueShareValue)
          : undefined,
        blockSize: input.blockSize,
        validFrom: new Date(input.validFrom),
        validUntil: input.validUntil ? new Date(input.validUntil) : undefined,
      });

      return {
        success: true,
        data,
      };
    }),

  /**
   * Update an existing codeshare agreement.
   * Only draft or pending_approval agreements can be freely updated.
   */
  updateAgreement: adminProcedure
    .meta({
      openapi: {
        method: "PUT",
        path: "/admin/codeshare/agreements/{id}",
        tags: ["Codeshare", "Admin"],
        summary: "Update codeshare agreement",
        description:
          "Update fields on an existing codeshare agreement. Terminated agreements cannot be updated.",
        protect: true,
      },
    })
    .input(
      z.object({
        id: z.number().int().positive().describe("Codeshare agreement ID"),
        agreementType: z
          .enum(["free_sale", "block_space", "hard_block", "soft_block"])
          .optional()
          .describe("Updated agreement type"),
        routeScope: z
          .enum(["all_routes", "specific_routes"])
          .optional()
          .describe("Updated route scope"),
        routes: z
          .array(
            z.object({
              originId: z.number().int().positive(),
              destinationId: z.number().int().positive(),
            })
          )
          .optional()
          .describe("Updated route pairs"),
        revenueShareModel: z
          .enum(["prorate", "fixed_amount", "percentage", "free_flow"])
          .optional()
          .describe("Updated revenue sharing model"),
        revenueShareValue: z
          .number()
          .optional()
          .describe("Updated revenue share value"),
        blockSize: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Updated block size"),
        validFrom: z
          .string()
          .optional()
          .describe("Updated validity start date"),
        validUntil: z.string().optional().describe("Updated validity end date"),
      })
    )
    .mutation(async ({ input }) => {
      const { id, ...fields } = input;

      const updateInput: codeshareService.UpdateCodeshareAgreementInput = {};

      if (fields.agreementType !== undefined) {
        updateInput.agreementType = fields.agreementType;
      }
      if (fields.routeScope !== undefined) {
        updateInput.routeScope = fields.routeScope;
      }
      if (fields.routes !== undefined) {
        updateInput.routes = fields.routes;
      }
      if (fields.revenueShareModel !== undefined) {
        updateInput.revenueShareModel = fields.revenueShareModel;
      }
      if (fields.revenueShareValue !== undefined) {
        updateInput.revenueShareValue = String(fields.revenueShareValue);
      }
      if (fields.blockSize !== undefined) {
        updateInput.blockSize = fields.blockSize;
      }
      if (fields.validFrom !== undefined) {
        updateInput.validFrom = new Date(fields.validFrom);
      }
      if (fields.validUntil !== undefined) {
        updateInput.validUntil = new Date(fields.validUntil);
      }

      const data = await codeshareService.updateCodeshareAgreement(
        id,
        updateInput
      );

      return {
        success: true,
        data,
      };
    }),

  /**
   * Get a single codeshare agreement by ID with full airline details.
   */
  getAgreement: adminProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/admin/codeshare/agreements/{id}",
        tags: ["Codeshare", "Admin"],
        summary: "Get codeshare agreement by ID",
        description:
          "Retrieve a codeshare agreement with marketing and operating airline details.",
        protect: true,
      },
    })
    .input(
      z.object({
        id: z.number().int().positive().describe("Codeshare agreement ID"),
      })
    )
    .query(async ({ input }) => {
      const data = await codeshareService.getCodeshareAgreement(input.id);

      return {
        success: true,
        data,
      };
    }),

  /**
   * List codeshare agreements with optional filters and pagination.
   */
  listAgreements: adminProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/admin/codeshare/agreements",
        tags: ["Codeshare", "Admin"],
        summary: "List codeshare agreements",
        description:
          "List codeshare agreements with optional filters for airline, status, and type. Supports pagination.",
        protect: true,
      },
    })
    .input(
      z.object({
        airlineId: z
          .number()
          .int()
          .positive()
          .optional()
          .describe(
            "Filter by airline ID (matches either marketing or operating carrier)"
          ),
        status: z
          .enum([
            "draft",
            "pending_approval",
            "active",
            "suspended",
            "terminated",
          ])
          .optional()
          .describe("Filter by agreement status"),
        type: z
          .enum(["free_sale", "block_space", "hard_block", "soft_block"])
          .optional()
          .describe("Filter by agreement type"),
        page: z
          .number()
          .int()
          .positive()
          .default(1)
          .describe("Page number (1-based)"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .default(20)
          .describe("Number of results per page (max 100)"),
      })
    )
    .query(async ({ input }) => {
      const offset = (input.page - 1) * input.limit;

      const data = await codeshareService.listCodeshareAgreements({
        airlineId: input.airlineId,
        status: input.status,
        agreementType: input.type,
        limit: input.limit,
        offset,
      });

      return {
        success: true,
        data,
      };
    }),

  /**
   * Activate a codeshare agreement.
   * Validates status, validity period, revenue share config, and block size.
   */
  activate: adminProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/admin/codeshare/agreements/{id}/activate",
        tags: ["Codeshare", "Admin"],
        summary: "Activate codeshare agreement",
        description:
          "Activate a codeshare agreement. The agreement must be in draft, pending_approval, or suspended status. Validates validity period and required configuration.",
        protect: true,
      },
    })
    .input(
      z.object({
        id: z
          .number()
          .int()
          .positive()
          .describe("Codeshare agreement ID to activate"),
      })
    )
    .mutation(async ({ input }) => {
      const data = await codeshareService.activateCodeshareAgreement(input.id);

      return {
        success: true,
        data,
      };
    }),

  /**
   * Terminate a codeshare agreement with a reason.
   * Sets validity end date to now and status to terminated.
   */
  terminate: adminProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/admin/codeshare/agreements/{id}/terminate",
        tags: ["Codeshare", "Admin"],
        summary: "Terminate codeshare agreement",
        description:
          "Terminate an active or suspended codeshare agreement. Records the termination reason and sets the end date to now.",
        protect: true,
      },
    })
    .input(
      z.object({
        id: z
          .number()
          .int()
          .positive()
          .describe("Codeshare agreement ID to terminate"),
        reason: z
          .string()
          .min(1)
          .max(500)
          .describe("Reason for terminating the agreement"),
      })
    )
    .mutation(async ({ input }) => {
      const data = await codeshareService.terminateCodeshareAgreement(
        input.id,
        input.reason
      );

      return {
        success: true,
        data,
      };
    }),

  // ============================================================================
  // Public Procedures
  // ============================================================================

  /**
   * Get codeshare flights available for a marketing airline.
   * Returns flights operated by partner airlines under active codeshare agreements.
   */
  getCodeshareFlights: publicProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/codeshare/flights/{airlineId}",
        tags: ["Codeshare"],
        summary: "Get codeshare flights for an airline",
        description:
          "Retrieve flights available through codeshare agreements for the specified marketing airline. Only returns flights from active agreements within their validity period.",
      },
    })
    .input(
      z.object({
        airlineId: z
          .number()
          .int()
          .positive()
          .describe("Marketing airline ID to get codeshare flights for"),
      })
    )
    .query(async ({ input }) => {
      const data = await codeshareService.getCodeshareFlights(input.airlineId);

      return {
        success: true,
        data,
      };
    }),

  // ============================================================================
  // Revenue Calculation
  // ============================================================================

  /**
   * Calculate revenue share between marketing and operating carriers
   * based on the agreement's revenue share model.
   */
  calculateRevenue: adminProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/admin/codeshare/agreements/{agreementId}/revenue",
        tags: ["Codeshare", "Admin"],
        summary: "Calculate codeshare revenue share",
        description:
          "Calculate the revenue split between marketing and operating carriers based on the agreement's configured model. All amounts are in SAR cents.",
        protect: true,
      },
    })
    .input(
      z.object({
        agreementId: z
          .number()
          .int()
          .positive()
          .describe("Codeshare agreement ID"),
        fareAmount: z
          .number()
          .int()
          .min(0)
          .describe("Total fare amount in SAR cents (100 = 1 SAR)"),
        segmentDistance: z
          .number()
          .int()
          .positive()
          .optional()
          .describe(
            "Segment distance in kilometers (required for prorate model)"
          ),
      })
    )
    .mutation(async ({ input }) => {
      const data = await codeshareService.calculateRevenueShare(
        input.agreementId,
        input.fareAmount,
        input.segmentDistance ?? 0
      );

      return {
        success: true,
        data,
      };
    }),
});
