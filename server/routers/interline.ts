import { z } from "zod";
import {
  router,
  publicProcedure,
  protectedProcedure,
  adminProcedure,
} from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import * as codeshareService from "../services/codeshare.service";

/**
 * Interline Router
 * Manages interline ticketing and baggage agreements between airlines
 * (IATA Resolution 780/788 compliance)
 */
export const interlineRouter = router({
  // ============================================================================
  // Agreement Management (Admin)
  // ============================================================================

  /**
   * Create a new interline agreement between two airlines.
   * The agreement starts in "draft" status and must be activated separately.
   */
  createAgreement: adminProcedure
    .input(
      z.object({
        airline1Id: z.number().int().positive().describe("First airline ID"),
        airline2Id: z.number().int().positive().describe("Second airline ID"),
        agreementType: z
          .enum(["ticketing", "baggage", "full"])
          .describe(
            "Type of interline agreement: ticketing only, baggage only, or full (both)"
          ),
        prorateType: z
          .enum(["mileage", "spi", "percentage"])
          .optional()
          .describe(
            "Prorate calculation method: mileage-based, special prorate agreement, or fixed percentage"
          ),
        prorateValue: z
          .number()
          .optional()
          .describe(
            "Prorate value: SPI amount in SAR cents, or percentage (0-100)"
          ),
        baggageThroughCheck: z
          .boolean()
          .describe("Whether baggage is through-checked between carriers"),
        baggageRuleApplied: z
          .enum(["most_significant_carrier", "first_carrier", "each_carrier"])
          .optional()
          .describe("Which carrier's baggage rules apply"),
        settlementMethod: z
          .enum(["bsp", "bilateral", "ich"])
          .describe(
            "Settlement method: IATA BSP, bilateral, or IATA Clearing House"
          ),
        validFrom: z
          .string()
          .describe("Agreement validity start date (ISO 8601)"),
        validUntil: z
          .string()
          .optional()
          .describe("Agreement validity end date (ISO 8601), if applicable"),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const result = await codeshareService.createInterlineAgreement({
          airline1Id: input.airline1Id,
          airline2Id: input.airline2Id,
          agreementType: input.agreementType,
          prorateType: input.prorateType,
          prorateValue: input.prorateValue
            ? String(input.prorateValue)
            : undefined,
          baggageThroughCheck: input.baggageThroughCheck,
          baggageRuleApplied: input.baggageRuleApplied,
          settlementMethod: input.settlementMethod,
          validFrom: new Date(input.validFrom),
          validUntil: input.validUntil ? new Date(input.validUntil) : undefined,
        });

        return {
          success: true,
          data: result,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create interline agreement",
        });
      }
    }),

  /**
   * Update an existing interline agreement.
   * Only draft or pending agreements can be freely updated;
   * terminated agreements cannot be updated.
   */
  updateAgreement: adminProcedure
    .input(
      z.object({
        id: z.number().int().positive().describe("Interline agreement ID"),
        agreementType: z
          .enum(["ticketing", "baggage", "full"])
          .optional()
          .describe("Updated agreement type"),
        prorateType: z
          .enum(["mileage", "spi", "percentage"])
          .optional()
          .describe("Updated prorate calculation method"),
        prorateValue: z.number().optional().describe("Updated prorate value"),
        baggageThroughCheck: z
          .boolean()
          .optional()
          .describe("Updated baggage through-check setting"),
        baggageRuleApplied: z
          .enum(["most_significant_carrier", "first_carrier", "each_carrier"])
          .optional()
          .describe("Updated baggage rule"),
        settlementMethod: z
          .enum(["bsp", "bilateral", "ich"])
          .optional()
          .describe("Updated settlement method"),
        validFrom: z
          .string()
          .optional()
          .describe("Updated validity start date (ISO 8601)"),
        validUntil: z
          .string()
          .optional()
          .describe("Updated validity end date (ISO 8601)"),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const { id, ...fields } = input;

        const updateInput: codeshareService.UpdateInterlineAgreementInput = {};

        if (fields.agreementType !== undefined) {
          updateInput.agreementType = fields.agreementType;
        }
        if (fields.prorateType !== undefined) {
          updateInput.prorateType = fields.prorateType;
        }
        if (fields.prorateValue !== undefined) {
          updateInput.prorateValue = String(fields.prorateValue);
        }
        if (fields.baggageThroughCheck !== undefined) {
          updateInput.baggageThroughCheck = fields.baggageThroughCheck;
        }
        if (fields.baggageRuleApplied !== undefined) {
          updateInput.baggageRuleApplied = fields.baggageRuleApplied;
        }
        if (fields.settlementMethod !== undefined) {
          updateInput.settlementMethod = fields.settlementMethod;
        }
        if (fields.validFrom !== undefined) {
          updateInput.validFrom = new Date(fields.validFrom);
        }
        if (fields.validUntil !== undefined) {
          updateInput.validUntil = new Date(fields.validUntil);
        }

        const result = await codeshareService.updateInterlineAgreement(
          id,
          updateInput
        );

        return {
          success: true,
          data: result,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to update interline agreement",
        });
      }
    }),

  /**
   * Get a single interline agreement by ID with full airline details.
   */
  getAgreement: adminProcedure
    .input(
      z.object({
        id: z.number().int().positive().describe("Interline agreement ID"),
      })
    )
    .query(async ({ input }) => {
      try {
        const data = await codeshareService.getInterlineAgreement(input.id);

        return {
          success: true,
          data,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to get interline agreement",
        });
      }
    }),

  /**
   * List interline agreements with optional filters and pagination.
   * Supports filtering by airline, status, and agreement type.
   */
  listAgreements: adminProcedure
    .input(
      z
        .object({
          airlineId: z
            .number()
            .int()
            .positive()
            .optional()
            .describe("Filter by airline ID (matches either side)"),
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
            .enum(["ticketing", "baggage", "full"])
            .optional()
            .describe("Filter by agreement type"),
          page: z
            .number()
            .int()
            .positive()
            .default(1)
            .describe("Page number (1-indexed)"),
          limit: z
            .number()
            .int()
            .positive()
            .max(100)
            .default(20)
            .describe("Number of results per page (max 100)"),
        })
        .optional()
    )
    .query(async ({ input }) => {
      try {
        const page = input?.page ?? 1;
        const limit = input?.limit ?? 20;
        const offset = (page - 1) * limit;

        const data = await codeshareService.listInterlineAgreements({
          airlineId: input?.airlineId,
          status: input?.status,
          agreementType: input?.type,
          limit,
          offset,
        });

        return {
          success: true,
          data,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to list interline agreements",
        });
      }
    }),

  /**
   * Activate an interline agreement.
   * Validates the agreement is in an activatable status, the validity period
   * is current, and prorate configuration is complete for ticketing/full types.
   */
  activate: adminProcedure
    .input(
      z.object({
        id: z
          .number()
          .int()
          .positive()
          .describe("Interline agreement ID to activate"),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const data = await codeshareService.activateInterlineAgreement(
          input.id
        );

        return {
          success: true,
          data,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to activate interline agreement",
        });
      }
    }),

  /**
   * Terminate an interline agreement with a reason.
   * Sets the validUntil to now and status to terminated.
   */
  terminate: adminProcedure
    .input(
      z.object({
        id: z
          .number()
          .int()
          .positive()
          .describe("Interline agreement ID to terminate"),
        reason: z.string().min(1).max(500).describe("Reason for termination"),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const data = await codeshareService.terminateInterlineAgreement(
          input.id,
          input.reason
        );

        return {
          success: true,
          data,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to terminate interline agreement",
        });
      }
    }),

  // ============================================================================
  // Eligibility & Prorate (Protected / Admin)
  // ============================================================================

  /**
   * Check interline eligibility between two airlines.
   * Returns whether they have an active interline agreement within
   * its validity period.
   */
  checkEligibility: protectedProcedure
    .input(
      z.object({
        airline1Id: z.number().int().positive().describe("First airline ID"),
        airline2Id: z.number().int().positive().describe("Second airline ID"),
      })
    )
    .query(async ({ input }) => {
      try {
        const data = await codeshareService.checkInterlineEligibility(
          input.airline1Id,
          input.airline2Id
        );

        return {
          success: true,
          data,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to check interline eligibility",
        });
      }
    }),

  /**
   * Calculate interline prorate share between two segments.
   * Uses the agreement's prorate model (mileage, SPI, or percentage)
   * to split the total fare between the two carriers.
   * All monetary amounts are in SAR cents.
   */
  calculateProrate: adminProcedure
    .input(
      z.object({
        agreementId: z
          .number()
          .int()
          .positive()
          .describe("Interline agreement ID"),
        totalFare: z
          .number()
          .int()
          .positive()
          .describe("Total fare amount in SAR cents"),
        segment1Distance: z
          .number()
          .int()
          .positive()
          .describe("Distance of segment 1 in miles/km"),
        segment2Distance: z
          .number()
          .int()
          .positive()
          .describe("Distance of segment 2 in miles/km"),
      })
    )
    .query(async ({ input }) => {
      try {
        const data = await codeshareService.calculateProrateShare(
          input.agreementId,
          input.totalFare,
          input.segment1Distance,
          input.segment2Distance
        );

        return {
          success: true,
          data,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to calculate interline prorate",
        });
      }
    }),

  // ============================================================================
  // Public Queries
  // ============================================================================

  /**
   * Get all interline partners for a given airline.
   * Returns airlines that have active interline agreements with the
   * specified airline, within their validity period.
   */
  getPartners: publicProcedure
    .input(
      z.object({
        airlineId: z.number().int().positive().describe("Airline ID"),
      })
    )
    .query(async ({ input }) => {
      try {
        const allPartners = await codeshareService.getPartnerAirlines(
          input.airlineId
        );

        // Filter to only interline partners (exclude codeshare-only partners)
        const interlinePartners = allPartners.filter(
          p => p.partnershipType === "interline"
        );

        return {
          success: true,
          data: interlinePartners,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to get interline partners",
        });
      }
    }),
});
