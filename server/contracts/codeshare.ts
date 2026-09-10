// Explicit response field allowlists. Review contract changes with producers and consumers.
import { z } from "zod";
import { outputNumber, structuredValue } from "./primitives";
export const responseContracts = {
  createAgreement: z.object({
    success: z.boolean(),
    data: z.object({
      id: outputNumber,
      agreementReference: z.string(),
      status: z.literal("draft"),
    }),
  }),
  updateAgreement: z.object({
    success: z.boolean(),
    data: z.object({ id: outputNumber, updated: z.boolean() }),
  }),
  getAgreement: z.object({
    success: z.boolean(),
    data: z.object({
      routes: structuredValue,
      id: outputNumber,
      agreementReference: z.string(),
      agreementType: z.enum([
        "free_sale",
        "block_space",
        "hard_block",
        "soft_block",
      ]),
      routeScope: z.enum(["all_routes", "specific_routes"]),
      revenueShareModel: z.enum([
        "percentage",
        "prorate",
        "fixed_amount",
        "free_flow",
      ]),
      revenueShareValue: z.union([z.null(), z.string()]),
      blockSize: z.union([z.null(), outputNumber]),
      validFrom: z.date(),
      validUntil: z.union([z.null(), z.date()]),
      status: z.enum([
        "active",
        "suspended",
        "draft",
        "pending_approval",
        "terminated",
      ]),
      createdAt: z.date(),
      updatedAt: z.date(),
      marketingAirline: z.object({
        id: outputNumber,
        code: z.string(),
        name: z.string(),
        logo: z.union([z.null(), z.string()]),
      }),
      operatingAirline: z.object({
        id: outputNumber,
        code: z.string(),
        name: z.string(),
        logo: z.string(),
      }),
    }),
  }),
  listAgreements: z.object({
    success: z.boolean(),
    data: z.array(
      z.object({
        id: outputNumber,
        agreementReference: z.string(),
        agreementType: z.enum([
          "free_sale",
          "block_space",
          "hard_block",
          "soft_block",
        ]),
        routeScope: z.enum(["all_routes", "specific_routes"]),
        revenueShareModel: z.enum([
          "percentage",
          "prorate",
          "fixed_amount",
          "free_flow",
        ]),
        blockSize: z.union([z.null(), outputNumber]),
        validFrom: z.date(),
        validUntil: z.union([z.null(), z.date()]),
        status: z.enum([
          "active",
          "suspended",
          "draft",
          "pending_approval",
          "terminated",
        ]),
        createdAt: z.date(),
        marketingAirline: z.object({
          id: outputNumber,
          code: z.string(),
          name: z.string(),
        }),
        operatingAirline: z.object({
          id: outputNumber,
          code: z.string(),
          name: z.string(),
        }),
      })
    ),
  }),
  activate: z.object({
    success: z.boolean(),
    data: z.object({
      id: outputNumber,
      status: z.literal("active"),
      agreementReference: z.string(),
    }),
  }),
  terminate: z.object({
    success: z.boolean(),
    data: z.object({
      id: outputNumber,
      status: z.literal("terminated"),
      agreementReference: z.string(),
      terminatedAt: z.date(),
      reason: z.string(),
    }),
  }),
  getCodeshareFlights: z.object({
    success: z.boolean(),
    data: z.array(
      z.object({
        marketingAirline: z.object({
          id: outputNumber,
          code: z.string(),
          name: z.string(),
          logo: z.union([z.null(), z.string()]),
        }),
        agreementReference: z.string(),
        agreementType: z.enum([
          "free_sale",
          "block_space",
          "hard_block",
          "soft_block",
        ]),
        blockSize: z.union([z.null(), outputNumber]),
        flightId: outputNumber,
        flightNumber: z.string(),
        departureTime: z.date(),
        arrivalTime: z.date(),
        aircraftType: z.union([z.null(), z.string()]),
        status: z.enum(["scheduled", "delayed", "cancelled", "completed"]),
        economyPrice: outputNumber,
        businessPrice: outputNumber,
        economyAvailable: outputNumber,
        businessAvailable: outputNumber,
        operatingAirline: z.object({
          id: outputNumber,
          code: z.string(),
          name: z.string(),
          logo: z.union([z.null(), z.string()]),
        }),
        origin: z.object({
          id: outputNumber,
          code: z.string(),
          name: z.string(),
          city: z.string(),
        }),
        destination: z.object({
          id: outputNumber,
          code: z.string(),
          name: z.string(),
          city: z.string(),
        }),
      })
    ),
  }),
  calculateRevenue: z.object({
    success: z.boolean(),
    data: z.object({
      agreementId: outputNumber,
      model: z.string(),
      fareAmount: outputNumber,
      marketingCarrierShare: outputNumber,
      operatingCarrierShare: outputNumber,
      currency: z.string(),
    }),
  }),
};
