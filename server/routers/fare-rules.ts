import { z } from "zod";
import {
  router,
  publicProcedure,
  protectedProcedure,
  adminProcedure,
} from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import * as fareRulesService from "../services/fare-rules.service";

// ============================================================================
// Shared Zod Enums
// ============================================================================

const cabinClassEnum = z.enum([
  "first",
  "business",
  "premium_economy",
  "economy",
]);

const seatSelectionEnum = z.enum(["free", "paid", "none"]);

const ruleCategoryEnum = z.enum([
  "eligibility",
  "day_time",
  "seasonality",
  "flight_application",
  "advance_purchase",
  "minimum_stay",
  "maximum_stay",
  "stopovers",
  "transfers",
  "combinations",
  "blackout_dates",
  "surcharges",
  "penalties",
  "children_discount",
  "group_discount",
]);

const passengerTypeEnum = z.enum(["adult", "child", "infant"]);

// ============================================================================
// Fare Rules Router
// ============================================================================

/**
 * Fare Rules Router
 * Handles fare class management, fare rule configuration, fare calculation,
 * rule validation, fare comparison, and change fee computation.
 */
export const fareRulesRouter = router({
  // ============================================================================
  // Fare Class Endpoints
  // ============================================================================

  /**
   * Create a new fare class (RBD - Reservation Booking Designator)
   * Admin only
   */
  createFareClass: adminProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/admin/fare-classes",
        tags: ["Fare Rules", "Admin"],
        summary: "Create a new fare class",
        description:
          "Create a new fare class (RBD) for an airline with cabin, pricing, and service attributes.",
        protect: true,
      },
    })
    .input(
      z.object({
        airlineId: z.number().int().describe("Airline ID"),
        code: z
          .string()
          .min(1)
          .max(2)
          .describe("IATA fare class code (e.g., Y, J, C, F)"),
        name: z
          .string()
          .min(1)
          .max(100)
          .describe('Fare class display name (e.g., "Economy Full Fare")'),
        cabinClass: cabinClassEnum.describe("Cabin class category"),
        fareFamily: z
          .string()
          .max(50)
          .optional()
          .describe('Fare family grouping (e.g., "Flex", "Light", "Value")'),
        priority: z
          .number()
          .int()
          .describe(
            "Selling priority (higher = sells first in nested availability)"
          ),
        basePriceMultiplier: z
          .number()
          .positive()
          .describe(
            "Price multiplier relative to base fare (e.g., 1.5 = 150%)"
          ),
        seatsAllocated: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe("Number of seats allocated to this class"),
        refundable: z.boolean().describe("Whether fare is fully refundable"),
        changeable: z
          .boolean()
          .describe("Whether date/flight changes are allowed"),
        changeFee: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe("Change fee in SAR cents"),
        upgradeable: z.boolean().describe("Whether upgrade is permitted"),
        baggageAllowance: z
          .number()
          .int()
          .min(0)
          .describe("Checked baggage allowance in kg"),
        baggagePieces: z
          .number()
          .int()
          .min(0)
          .describe("Number of checked baggage pieces"),
        carryOnAllowance: z
          .number()
          .int()
          .min(0)
          .describe("Carry-on baggage allowance in kg"),
        mileageEarningRate: z
          .number()
          .min(0)
          .optional()
          .describe("Mileage earning rate (1.0 = 100%)"),
        seatSelection: seatSelectionEnum.describe("Seat selection policy"),
        loungeAccess: z.boolean().describe("Lounge access included"),
        priorityBoarding: z.boolean().describe("Priority boarding included"),
        mealIncluded: z.boolean().describe("Meal service included"),
      })
    )
    .mutation(async ({ input }) => {
      try {
        return await fareRulesService.createFareClass({
          ...input,
          basePriceMultiplier: input.basePriceMultiplier.toFixed(3),
          mileageEarningRate: input.mileageEarningRate?.toFixed(2),
        });
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error
              ? error.message
              : "Failed to create fare class",
        });
      }
    }),

  /**
   * Update an existing fare class
   * Admin only
   */
  updateFareClass: adminProcedure
    .meta({
      openapi: {
        method: "PATCH",
        path: "/admin/fare-classes/{id}",
        tags: ["Fare Rules", "Admin"],
        summary: "Update a fare class",
        description:
          "Update one or more fields on an existing fare class. Only provided fields are modified.",
        protect: true,
      },
    })
    .input(
      z.object({
        id: z.number().int().describe("Fare class ID"),
        airlineId: z.number().int().optional().describe("Airline ID"),
        code: z
          .string()
          .min(1)
          .max(2)
          .optional()
          .describe("IATA fare class code"),
        name: z
          .string()
          .min(1)
          .max(100)
          .optional()
          .describe("Fare class display name"),
        cabinClass: cabinClassEnum.optional().describe("Cabin class category"),
        fareFamily: z
          .string()
          .max(50)
          .optional()
          .nullable()
          .describe("Fare family grouping"),
        priority: z.number().int().optional().describe("Selling priority"),
        basePriceMultiplier: z
          .number()
          .positive()
          .optional()
          .describe("Price multiplier"),
        seatsAllocated: z
          .number()
          .int()
          .min(0)
          .optional()
          .nullable()
          .describe("Seats allocated"),
        refundable: z.boolean().optional().describe("Refundable"),
        changeable: z.boolean().optional().describe("Changeable"),
        changeFee: z
          .number()
          .int()
          .min(0)
          .optional()
          .nullable()
          .describe("Change fee in SAR cents"),
        upgradeable: z.boolean().optional().describe("Upgradeable"),
        baggageAllowance: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe("Baggage allowance in kg"),
        baggagePieces: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe("Baggage pieces"),
        carryOnAllowance: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe("Carry-on allowance in kg"),
        mileageEarningRate: z
          .number()
          .min(0)
          .optional()
          .nullable()
          .describe("Mileage earning rate"),
        seatSelection: seatSelectionEnum.optional().describe("Seat selection"),
        loungeAccess: z.boolean().optional().describe("Lounge access"),
        priorityBoarding: z.boolean().optional().describe("Priority boarding"),
        mealIncluded: z.boolean().optional().describe("Meal included"),
        active: z.boolean().optional().describe("Active status"),
      })
    )
    .mutation(async ({ input }) => {
      const { id, basePriceMultiplier, mileageEarningRate, ...rest } = input;

      const updateData: Record<string, unknown> = { ...rest };
      if (basePriceMultiplier !== undefined) {
        updateData.basePriceMultiplier = basePriceMultiplier.toFixed(3);
      }
      if (mileageEarningRate !== undefined) {
        updateData.mileageEarningRate =
          mileageEarningRate !== null ? mileageEarningRate.toFixed(2) : null;
      }

      try {
        return await fareRulesService.updateFareClass(id, updateData);
      } catch (error) {
        if (error instanceof Error && error.message.includes("not found")) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: error.message,
          });
        }
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error
              ? error.message
              : "Failed to update fare class",
        });
      }
    }),

  /**
   * Get a single fare class by ID
   * Public
   */
  getFareClass: publicProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/fare-classes/{id}",
        tags: ["Fare Rules"],
        summary: "Get fare class by ID",
        description:
          "Retrieve a single fare class with all its attributes and service features.",
      },
    })
    .input(
      z.object({
        id: z.number().int().describe("Fare class ID"),
      })
    )
    .query(async ({ input }) => {
      const fareClass = await fareRulesService.getFareClass(input.id);

      if (!fareClass) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `Fare class with id ${input.id} not found`,
        });
      }

      return fareClass;
    }),

  /**
   * List fare classes for an airline
   * Public
   */
  listFareClasses: publicProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/fare-classes",
        tags: ["Fare Rules"],
        summary: "List fare classes for an airline",
        description:
          "Get all active fare classes for an airline, optionally filtered by cabin class. Ordered by priority.",
      },
    })
    .input(
      z.object({
        airlineId: z.number().int().describe("Airline ID"),
        cabinClass: cabinClassEnum.optional().describe("Filter by cabin class"),
      })
    )
    .query(async ({ input }) => {
      try {
        return await fareRulesService.listFareClasses(
          input.airlineId,
          input.cabinClass
        );
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error
              ? error.message
              : "Failed to list fare classes",
        });
      }
    }),

  /**
   * Get fare class availability for a flight
   * Public
   */
  getFareClassAvailability: publicProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/fare-classes/availability/{flightId}",
        tags: ["Fare Rules"],
        summary: "Get fare class availability for a flight",
        description:
          "Retrieve all available fare classes for a specific flight with seat availability information.",
      },
    })
    .input(
      z.object({
        flightId: z.number().int().describe("Flight ID"),
      })
    )
    .query(async ({ input }) => {
      try {
        return await fareRulesService.getFareClassAvailability(input.flightId);
      } catch (error) {
        if (error instanceof Error && error.message.includes("not found")) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: error.message,
          });
        }
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error
              ? error.message
              : "Failed to get fare class availability",
        });
      }
    }),

  // ============================================================================
  // Fare Rule Endpoints
  // ============================================================================

  /**
   * Create a new fare rule
   * Admin only
   */
  createFareRule: adminProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/admin/fare-rules",
        tags: ["Fare Rules", "Admin"],
        summary: "Create a new fare rule",
        description:
          "Create a new ATPCO-style fare rule with category, conditions, route restrictions, and pricing adjustments.",
        protect: true,
      },
    })
    .input(
      z.object({
        fareClassId: z
          .number()
          .int()
          .describe("Fare class ID this rule applies to"),
        airlineId: z.number().int().describe("Airline ID"),
        ruleName: z.string().min(1).max(100).describe("Descriptive rule name"),
        ruleCategory: ruleCategoryEnum.describe("ATPCO-style rule category"),
        conditions: z
          .string()
          .min(2)
          .describe("JSON string of rule-specific conditions and parameters"),
        validFrom: z.string().describe("Rule validity start date (ISO 8601)"),
        validUntil: z
          .string()
          .optional()
          .describe("Rule validity end date (ISO 8601), null for indefinite"),
        originAirportId: z
          .number()
          .int()
          .optional()
          .describe("Origin airport restriction (null = all origins)"),
        destinationAirportId: z
          .number()
          .int()
          .optional()
          .describe(
            "Destination airport restriction (null = all destinations)"
          ),
        priceAdjustment: z
          .number()
          .int()
          .optional()
          .describe("Flat price adjustment in SAR cents (+/-)"),
        priceMultiplier: z
          .number()
          .optional()
          .describe("Price multiplier (1.0 = no change, 1.1 = +10%)"),
      })
    )
    .mutation(async ({ input }) => {
      // Validate conditions is valid JSON
      try {
        JSON.parse(input.conditions);
      } catch {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "conditions must be a valid JSON string",
        });
      }

      try {
        return await fareRulesService.createFareRule({
          ...input,
          validFrom: new Date(input.validFrom),
          validUntil: input.validUntil ? new Date(input.validUntil) : undefined,
          priceMultiplier: input.priceMultiplier?.toFixed(3),
        });
      } catch (error) {
        if (error instanceof Error && error.message.includes("not found")) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: error.message,
          });
        }
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error
              ? error.message
              : "Failed to create fare rule",
        });
      }
    }),

  /**
   * Update an existing fare rule
   * Admin only
   */
  updateFareRule: adminProcedure
    .meta({
      openapi: {
        method: "PATCH",
        path: "/admin/fare-rules/{id}",
        tags: ["Fare Rules", "Admin"],
        summary: "Update a fare rule",
        description:
          "Update one or more fields on an existing fare rule. Only provided fields are modified.",
        protect: true,
      },
    })
    .input(
      z.object({
        id: z.number().int().describe("Fare rule ID"),
        fareClassId: z.number().int().optional().describe("Fare class ID"),
        airlineId: z.number().int().optional().describe("Airline ID"),
        ruleName: z.string().min(1).max(100).optional().describe("Rule name"),
        ruleCategory: ruleCategoryEnum.optional().describe("Rule category"),
        conditions: z.string().min(2).optional().describe("JSON conditions"),
        validFrom: z
          .string()
          .optional()
          .describe("Validity start date (ISO 8601)"),
        validUntil: z
          .string()
          .optional()
          .nullable()
          .describe("Validity end date (ISO 8601)"),
        originAirportId: z
          .number()
          .int()
          .optional()
          .nullable()
          .describe("Origin airport ID"),
        destinationAirportId: z
          .number()
          .int()
          .optional()
          .nullable()
          .describe("Destination airport ID"),
        priceAdjustment: z
          .number()
          .int()
          .optional()
          .describe("Price adjustment in SAR cents"),
        priceMultiplier: z.number().optional().describe("Price multiplier"),
        active: z.boolean().optional().describe("Active status"),
      })
    )
    .mutation(async ({ input }) => {
      // Validate conditions JSON if provided
      if (input.conditions !== undefined) {
        try {
          JSON.parse(input.conditions);
        } catch {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "conditions must be a valid JSON string",
          });
        }
      }

      const { id, validFrom, validUntil, priceMultiplier, ...rest } = input;

      const updateData: Record<string, unknown> = { ...rest };
      if (validFrom !== undefined) {
        updateData.validFrom = new Date(validFrom);
      }
      if (validUntil !== undefined) {
        updateData.validUntil =
          validUntil !== null ? new Date(validUntil) : null;
      }
      if (priceMultiplier !== undefined) {
        updateData.priceMultiplier = priceMultiplier.toFixed(3);
      }

      try {
        return await fareRulesService.updateFareRule(id, updateData);
      } catch (error) {
        if (error instanceof Error && error.message.includes("not found")) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: error.message,
          });
        }
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error
              ? error.message
              : "Failed to update fare rule",
        });
      }
    }),

  /**
   * Get a single fare rule by ID
   * Admin only
   */
  getFareRule: adminProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/admin/fare-rules/{id}",
        tags: ["Fare Rules", "Admin"],
        summary: "Get fare rule by ID",
        description:
          "Retrieve a single fare rule with all conditions and pricing parameters.",
        protect: true,
      },
    })
    .input(
      z.object({
        id: z.number().int().describe("Fare rule ID"),
      })
    )
    .query(async ({ input }) => {
      const rule = await fareRulesService.getFareRule(input.id);

      if (!rule) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `Fare rule with id ${input.id} not found`,
        });
      }

      return rule;
    }),

  /**
   * List fare rules with filters and pagination
   * Admin only
   */
  listFareRules: adminProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/admin/fare-rules",
        tags: ["Fare Rules", "Admin"],
        summary: "List fare rules",
        description:
          "List fare rules with optional filters by fare class, airline, category, and active status. Supports pagination.",
        protect: true,
      },
    })
    .input(
      z.object({
        fareClassId: z
          .number()
          .int()
          .optional()
          .describe("Filter by fare class ID"),
        airlineId: z.number().int().optional().describe("Filter by airline ID"),
        category: ruleCategoryEnum
          .optional()
          .describe("Filter by rule category"),
        active: z.boolean().optional().describe("Filter by active status"),
        page: z
          .number()
          .int()
          .min(1)
          .default(1)
          .describe("Page number (1-indexed)"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .default(20)
          .describe("Items per page"),
      })
    )
    .query(async ({ input }) => {
      try {
        return await fareRulesService.listFareRules(input);
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error
              ? error.message
              : "Failed to list fare rules",
        });
      }
    }),

  // ============================================================================
  // Fare Calculation Endpoints
  // ============================================================================

  /**
   * Calculate fare for a flight and fare class combination
   * Public - used during booking flow
   */
  calculateFare: publicProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/fare-rules/calculate",
        tags: ["Fare Rules"],
        summary: "Calculate fare",
        description:
          "Calculate the total fare for a flight, fare class, route, and passenger configuration. " +
          "Applies all active fare rules including advance purchase, seasonality, surcharges, and passenger type discounts.",
      },
    })
    .input(
      z.object({
        flightId: z.number().int().describe("Flight ID"),
        fareClassId: z.number().int().describe("Fare class ID"),
        originId: z.number().int().describe("Origin airport ID"),
        destinationId: z.number().int().describe("Destination airport ID"),
        departureDate: z.string().describe("Departure date (ISO 8601)"),
        returnDate: z
          .string()
          .optional()
          .describe("Return date for round-trip (ISO 8601)"),
        passengerType: passengerTypeEnum.describe(
          "Passenger type (adult/child/infant)"
        ),
        passengerCount: z
          .number()
          .int()
          .min(1)
          .max(9)
          .describe("Number of passengers (1-9)"),
      })
    )
    .query(async ({ input }) => {
      try {
        return await fareRulesService.calculateFare(input);
      } catch (error) {
        if (error instanceof Error && error.message.includes("not found")) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: error.message,
          });
        }
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Failed to calculate fare",
        });
      }
    }),

  /**
   * Validate fare rules for a booking
   * Protected - requires authentication
   */
  validateRules: protectedProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/fare-rules/validate",
        tags: ["Fare Rules"],
        summary: "Validate fare rules",
        description:
          "Validate all fare rules for a specific fare class against booking parameters. " +
          "Checks advance purchase requirements, min/max stay, blackout dates, day-of-week restrictions, and group size limits.",
        protect: true,
      },
    })
    .input(
      z.object({
        fareClassId: z.number().int().describe("Fare class ID"),
        departureDate: z.string().describe("Departure date (ISO 8601)"),
        returnDate: z.string().optional().describe("Return date (ISO 8601)"),
        bookingDate: z.string().describe("Date of booking (ISO 8601)"),
        originId: z.number().int().describe("Origin airport ID"),
        destinationId: z.number().int().describe("Destination airport ID"),
        passengerCount: z
          .number()
          .int()
          .min(1)
          .describe("Number of passengers"),
      })
    )
    .query(async ({ input }) => {
      try {
        return await fareRulesService.validateRules(input);
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error
              ? error.message
              : "Failed to validate fare rules",
        });
      }
    }),

  /**
   * Compare fare classes for a flight
   * Public - used during search/booking to show comparison
   */
  compareFareClasses: publicProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/fare-rules/compare",
        tags: ["Fare Rules"],
        summary: "Compare fare classes for a flight",
        description:
          "Get a side-by-side comparison of all available fare classes for a flight, " +
          "including estimated prices, service features, and applied rules.",
      },
    })
    .input(
      z.object({
        flightId: z.number().int().describe("Flight ID"),
        originId: z.number().int().describe("Origin airport ID"),
        destinationId: z.number().int().describe("Destination airport ID"),
        departureDate: z.string().describe("Departure date (ISO 8601)"),
      })
    )
    .query(async ({ input }) => {
      try {
        return await fareRulesService.compareFareClasses(input);
      } catch (error) {
        if (error instanceof Error && error.message.includes("not found")) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: error.message,
          });
        }
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error
              ? error.message
              : "Failed to compare fare classes",
        });
      }
    }),

  /**
   * Calculate change fee for a fare class
   * Protected - requires authentication
   */
  calculateChangeFee: protectedProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/fare-rules/change-fee",
        tags: ["Fare Rules"],
        summary: "Calculate change fee",
        description:
          "Calculate the total change/modification fee for a fare class, " +
          "considering the base change fee and any time-based penalty rules.",
        protect: true,
      },
    })
    .input(
      z.object({
        fareClassId: z.number().int().describe("Fare class ID"),
        bookingDate: z.string().describe("Original booking date (ISO 8601)"),
        changeDate: z.string().describe("Requested change date (ISO 8601)"),
      })
    )
    .query(async ({ input }) => {
      try {
        return await fareRulesService.calculateChangeFee(input);
      } catch (error) {
        if (error instanceof Error && error.message.includes("not found")) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: error.message,
          });
        }
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error
              ? error.message
              : "Failed to calculate change fee",
        });
      }
    }),
});
