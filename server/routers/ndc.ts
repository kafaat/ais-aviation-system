import { z } from "zod";
import {
  router,
  publicProcedure,
  protectedProcedure,
  adminProcedure,
} from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import * as ndcService from "../services/ndc.service";

// ============================================================================
// Shared Zod Schemas
// ============================================================================

const cabinClassEnum = z.enum(["economy", "business"]);

const passengerTypeEnum = z.enum(["adult", "child", "infant"]);

const genderEnum = z.enum(["male", "female"]);

const orderStatusEnum = z.enum([
  "pending",
  "confirmed",
  "ticketed",
  "cancelled",
  "expired",
]);

const channelEnum = z.enum([
  "web",
  "mobile",
  "api",
  "agent",
  "corporate",
  "metasearch",
]);

const passengerSchema = z.object({
  firstName: z.string().min(1).describe("Passenger first name"),
  lastName: z.string().min(1).describe("Passenger last name"),
  dateOfBirth: z.string().describe("Date of birth (ISO 8601 format)"),
  gender: genderEnum.describe("Passenger gender"),
  nationality: z.string().min(2).max(3).describe("Nationality country code"),
  passportNumber: z
    .string()
    .min(1)
    .describe("Passport or travel document number"),
  passportExpiry: z.string().describe("Passport expiry date (ISO 8601 format)"),
  type: passengerTypeEnum.describe("Passenger type (adult, child, or infant)"),
});

const contactInfoSchema = z.object({
  emailAddress: z.string().email().describe("Contact email address"),
  phoneNumber: z.string().min(1).describe("Contact phone number"),
  address: z.string().optional().describe("Contact mailing address"),
});

const serviceItemSchema = z.object({
  serviceCode: z
    .string()
    .min(1)
    .describe("Code of ancillary service (e.g., BGAG, MEAL, SEAT)"),
  serviceType: z
    .string()
    .optional()
    .describe("Type of ancillary service (e.g., baggage, meal, seat)"),
  passengerId: z
    .string()
    .optional()
    .describe("Passenger ID this service applies to"),
  segmentId: z
    .string()
    .optional()
    .describe("Flight segment ID this service applies to"),
});

// ============================================================================
// NDC Router
// ============================================================================

/**
 * NDC (New Distribution Capability) Router
 *
 * Implements IATA NDC standard endpoints for airline offer and order management.
 * Supports AirShopping, OfferPrice, OrderCreate, OrderRetrieve, OrderChange,
 * and ancillary service management through a standards-compliant interface.
 */
export const ndcRouter = router({
  // ==========================================================================
  // Shopping & Offers
  // ==========================================================================

  /**
   * NDC AirShopping - Search for flight offers
   *
   * Performs an NDC-compliant air shopping request, returning available offers
   * with pricing for the requested origin, destination, dates, and passengers.
   */
  airShopping: publicProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/ndc/air-shopping",
        tags: ["NDC"],
        summary: "NDC AirShopping request",
        description:
          "Search for available flight offers using the NDC AirShopping standard. Returns priced offers including fare details, cabin class, and ancillary bundles.",
      },
    })
    .input(
      z.object({
        originId: z.number().int().positive().describe("Origin airport ID"),
        destinationId: z
          .number()
          .int()
          .positive()
          .describe("Destination airport ID"),
        departureDate: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/, "Must be ISO date format YYYY-MM-DD")
          .describe("Departure date in ISO 8601 format (YYYY-MM-DD)"),
        returnDate: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/, "Must be ISO date format YYYY-MM-DD")
          .optional()
          .describe("Return date for round-trip (ISO 8601 format, optional)"),
        passengerCount: z
          .number()
          .int()
          .min(1)
          .max(9)
          .describe("Number of passengers (1-9)"),
        cabinClass: cabinClassEnum.describe("Preferred cabin class"),
      })
    )
    .query(async ({ input }) => {
      try {
        const offers = await ndcService.searchOffers({
          originId: input.originId,
          destinationId: input.destinationId,
          departureDate: input.departureDate,
          returnDate: input.returnDate,
          passengerCount: input.passengerCount,
          cabinClass: input.cabinClass,
        });

        return {
          success: true,
          data: offers,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to search NDC offers",
          cause: error,
        });
      }
    }),

  /**
   * NDC OfferPrice - Get detailed pricing for a specific offer
   *
   * Returns the full price breakdown for an offer including base fare, taxes,
   * surcharges, and applicable discounts.
   */
  offerPrice: publicProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/ndc/offer-price",
        tags: ["NDC"],
        summary: "Get detailed offer pricing",
        description:
          "Retrieve the full price breakdown for a specific NDC offer, including base fare, taxes, surcharges, and available ancillary service prices.",
      },
    })
    .input(
      z.object({
        offerId: z.string().min(1).describe("NDC offer identifier"),
      })
    )
    .query(async ({ input }) => {
      try {
        const pricing = await ndcService.getOfferPrice(input.offerId);

        if (!pricing) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: `Offer not found or expired: ${input.offerId}`,
          });
        }

        return {
          success: true,
          data: pricing,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to retrieve offer pricing",
          cause: error,
        });
      }
    }),

  // ==========================================================================
  // Order Management
  // ==========================================================================

  /**
   * NDC OrderCreate - Create an order from a selected offer
   *
   * Converts a shopping offer into a confirmed order with passenger details,
   * contact information, and payment method.
   */
  createOrder: protectedProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/ndc/orders",
        tags: ["NDC"],
        summary: "Create order from offer",
        description:
          "Create an NDC order from a previously retrieved offer. Requires passenger details, contact information, and payment method. The offer must still be valid and not expired.",
        protect: true,
      },
    })
    .input(
      z.object({
        offerId: z
          .string()
          .min(1)
          .describe("NDC offer identifier to convert to order"),
        passengers: z
          .array(passengerSchema)
          .min(1)
          .max(9)
          .describe("Passenger details for the order"),
        contactInfo: contactInfoSchema.describe("Primary contact information"),
        paymentMethod: z
          .string()
          .min(1)
          .describe(
            "Payment method identifier (e.g., stripe, corporate_credit)"
          ),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const order = await ndcService.createOrder({
          userId: ctx.user.id,
          offerId: input.offerId,
          passengers: input.passengers,
          contactInfo: input.contactInfo,
          paymentMethod: input.paymentMethod,
        });

        return {
          success: true,
          data: order,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            error instanceof Error
              ? error.message
              : "Failed to create NDC order",
          cause: error,
        });
      }
    }),

  /**
   * NDC OrderRetrieve - Get order details by order ID
   *
   * Returns the full order details including passenger information, itinerary,
   * pricing, and current status. Only the order owner or an admin can access.
   */
  retrieveOrder: protectedProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/ndc/orders/{orderId}",
        tags: ["NDC"],
        summary: "Retrieve order details",
        description:
          "Retrieve complete NDC order details including passengers, itinerary, pricing, payment status, and ticket information. Only accessible by the order owner or admin users.",
        protect: true,
      },
    })
    .input(
      z.object({
        orderId: z.string().min(1).describe("NDC order identifier"),
      })
    )
    .query(async ({ ctx, input }) => {
      try {
        const order = await ndcService.getOrder(input.orderId);

        if (!order) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: `Order not found: ${input.orderId}`,
          });
        }

        // Verify ownership: user must own the order or be an admin
        if (order.userId !== ctx.user.id && ctx.user.role !== "admin") {
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "You do not have permission to view this order",
          });
        }

        return {
          success: true,
          data: order,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to retrieve NDC order",
          cause: error,
        });
      }
    }),

  /**
   * NDC OrderCancel - Cancel an existing order
   *
   * Cancels the order and initiates any applicable refund processing.
   * A reason must be provided for audit and compliance purposes.
   */
  cancelOrder: protectedProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/ndc/orders/{orderId}/cancel",
        tags: ["NDC"],
        summary: "Cancel an order",
        description:
          "Cancel an NDC order. Cancellation fees and refund eligibility depend on the fare rules and timing. A cancellation reason is required for compliance tracking.",
        protect: true,
      },
    })
    .input(
      z.object({
        orderId: z.string().min(1).describe("NDC order identifier to cancel"),
        reason: z.string().min(1).max(1000).describe("Reason for cancellation"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const result = await ndcService.cancelOrder({
          orderId: input.orderId,
          userId: ctx.user.id,
          reason: input.reason,
        });

        return {
          success: true,
          data: result,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            error instanceof Error
              ? error.message
              : "Failed to cancel NDC order",
          cause: error,
        });
      }
    }),

  /**
   * NDC OrderChange - Modify an existing order
   *
   * Supports changes to departure date, cabin class, and passenger details
   * subject to fare rules and availability.
   */
  changeOrder: protectedProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/ndc/orders/{orderId}/change",
        tags: ["NDC"],
        summary: "Modify an order",
        description:
          "Modify an existing NDC order. Supports date changes, cabin class upgrades/downgrades, and passenger detail updates. Change fees and fare differences may apply based on fare rules.",
        protect: true,
      },
    })
    .input(
      z.object({
        orderId: z.string().min(1).describe("NDC order identifier to modify"),
        changes: z
          .object({
            newDepartureDate: z
              .string()
              .regex(
                /^\d{4}-\d{2}-\d{2}$/,
                "Must be ISO date format YYYY-MM-DD"
              )
              .optional()
              .describe("New departure date (ISO 8601 format)"),
            newCabinClass: cabinClassEnum
              .optional()
              .describe("New cabin class"),
            passengerUpdates: z
              .array(
                z.object({
                  passengerId: z
                    .string()
                    .min(1)
                    .describe("Passenger ID to update"),
                  firstName: z
                    .string()
                    .optional()
                    .describe("Updated first name"),
                  lastName: z.string().optional().describe("Updated last name"),
                  passportNumber: z
                    .string()
                    .optional()
                    .describe("Updated passport number"),
                  passportExpiry: z
                    .string()
                    .optional()
                    .describe("Updated passport expiry date (ISO 8601)"),
                })
              )
              .optional()
              .describe("Passenger detail updates"),
          })
          .describe("Order changes to apply"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const result = await ndcService.changeOrder({
          orderId: input.orderId,
          userId: ctx.user.id,
          changes: input.changes,
        });

        return {
          success: true,
          data: result,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            error instanceof Error
              ? error.message
              : "Failed to modify NDC order",
          cause: error,
        });
      }
    }),

  // ==========================================================================
  // Ancillary Services
  // ==========================================================================

  /**
   * Add ancillary services to an existing order
   *
   * Attaches additional services (baggage, meals, seat selection, etc.)
   * to an existing NDC order, optionally scoped to a passenger or segment.
   */
  addServices: protectedProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/ndc/orders/{orderId}/services",
        tags: ["NDC"],
        summary: "Add ancillary services to order",
        description:
          "Add ancillary services such as extra baggage, meal preferences, seat upgrades, or lounge access to an existing NDC order. Services can be scoped to specific passengers or flight segments.",
        protect: true,
      },
    })
    .input(
      z.object({
        orderId: z.string().min(1).describe("NDC order identifier"),
        services: z
          .array(serviceItemSchema)
          .min(1)
          .describe("Ancillary services to add"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const result = await ndcService.addServices({
          orderId: input.orderId,
          userId: ctx.user.id,
          services: input.services,
        });

        return {
          success: true,
          data: result,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            error instanceof Error
              ? error.message
              : "Failed to add ancillary services",
          cause: error,
        });
      }
    }),

  // ==========================================================================
  // Order History & Queries
  // ==========================================================================

  /**
   * List orders with filters (admin only)
   *
   * Administrative endpoint to query all NDC orders with filtering by airline,
   * status, distribution channel, and date range. Supports pagination.
   */
  listOrders: adminProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/ndc/admin/orders",
        tags: ["NDC", "Admin"],
        summary: "List NDC orders with filters",
        description:
          "Admin endpoint to list all NDC orders with optional filters for airline, status, distribution channel, and date range. Supports pagination for large result sets.",
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
          .describe("Filter by airline ID"),
        status: orderStatusEnum.optional().describe("Filter by order status"),
        channel: channelEnum
          .optional()
          .describe("Filter by distribution channel"),
        dateFrom: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/, "Must be ISO date format YYYY-MM-DD")
          .optional()
          .describe("Filter orders from this date (inclusive)"),
        dateTo: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/, "Must be ISO date format YYYY-MM-DD")
          .optional()
          .describe("Filter orders up to this date (inclusive)"),
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
          .describe("Results per page (max 100)"),
      })
    )
    .query(async ({ input }) => {
      try {
        const result = await ndcService.listOrders({
          airlineId: input.airlineId,
          status: input.status,
          channel: input.channel,
          dateFrom: input.dateFrom,
          dateTo: input.dateTo,
          page: input.page,
          limit: input.limit,
        });

        return {
          success: true,
          data: result,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to list NDC orders",
          cause: error,
        });
      }
    }),

  /**
   * Get the authenticated user's NDC order history
   *
   * Returns all NDC orders placed by the current user, sorted by creation
   * date descending.
   */
  getOrderHistory: protectedProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/ndc/orders/history",
        tags: ["NDC"],
        summary: "Get my NDC order history",
        description:
          "Retrieve the full NDC order history for the authenticated user, sorted by most recent first. Includes order status, itinerary summaries, and pricing.",
        protect: true,
      },
    })
    .query(async ({ ctx }) => {
      try {
        const orders = await ndcService.getOrderHistory(ctx.user.id);

        return {
          success: true,
          data: orders,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to retrieve NDC order history",
          cause: error,
        });
      }
    }),

  // ==========================================================================
  // Admin Operations
  // ==========================================================================

  /**
   * Expire stale offers (admin only)
   *
   * Triggers a cleanup process that marks expired NDC offers as no longer valid.
   * Offers typically expire after a configurable TTL (e.g., 30 minutes).
   */
  expireOffers: adminProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/ndc/admin/expire-offers",
        tags: ["NDC", "Admin"],
        summary: "Trigger offer expiration cleanup",
        description:
          "Admin endpoint to manually trigger cleanup of expired NDC offers. Offers past their time-to-live are marked as expired and can no longer be used to create orders.",
        protect: true,
      },
    })
    .mutation(async () => {
      try {
        const result = await ndcService.expireOffers();

        return {
          success: true,
          data: result,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to process offer expiration",
          cause: error,
        });
      }
    }),

  /**
   * Get NDC channel statistics (admin only)
   *
   * Returns aggregated statistics for NDC operations including order counts
   * by channel, revenue breakdowns, and conversion metrics.
   */
  getStatistics: adminProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/ndc/admin/statistics",
        tags: ["NDC", "Admin"],
        summary: "Get NDC channel statistics",
        description:
          "Admin endpoint to retrieve NDC distribution statistics including total orders by channel, revenue by channel, conversion rates, and offer expiration metrics.",
        protect: true,
      },
    })
    .query(async () => {
      try {
        const stats = await ndcService.getStatistics();

        return {
          success: true,
          data: stats,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to retrieve NDC statistics",
          cause: error,
        });
      }
    }),
});
