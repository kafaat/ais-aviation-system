// Explicit response field allowlists. Review contract changes with producers and consumers.
import { z } from "zod";
import { outputNumber } from "./primitives";
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
      id: outputNumber,
      agreementReference: z.string(),
      agreementType: z.enum(["baggage", "full", "ticketing"]),
      prorateType: z.union([
        z.null(),
        z.literal("percentage"),
        z.literal("mileage"),
        z.literal("spi"),
      ]),
      prorateValue: z.union([z.null(), z.string()]),
      baggageThroughCheck: z.boolean(),
      baggageRuleApplied: z.union([
        z.null(),
        z.literal("most_significant_carrier"),
        z.literal("first_carrier"),
        z.literal("each_carrier"),
      ]),
      settlementMethod: z.union([
        z.null(),
        z.literal("bsp"),
        z.literal("bilateral"),
        z.literal("ich"),
      ]),
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
      airline1: z.object({
        id: outputNumber,
        code: z.string(),
        name: z.string(),
        logo: z.union([z.null(), z.string()]),
      }),
      airline2: z.object({
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
        agreementType: z.enum(["baggage", "full", "ticketing"]),
        prorateType: z.union([
          z.null(),
          z.literal("percentage"),
          z.literal("mileage"),
          z.literal("spi"),
        ]),
        baggageThroughCheck: z.boolean(),
        baggageRuleApplied: z.union([
          z.null(),
          z.literal("most_significant_carrier"),
          z.literal("first_carrier"),
          z.literal("each_carrier"),
        ]),
        settlementMethod: z.union([
          z.null(),
          z.literal("bsp"),
          z.literal("bilateral"),
          z.literal("ich"),
        ]),
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
        airline1: z.object({
          id: outputNumber,
          code: z.string(),
          name: z.string(),
        }),
        airline2: z.object({
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
  checkEligibility: z.object({
    success: z.boolean(),
    data: z.union([
      z.object({
        eligible: z.boolean(),
        reason: z.string(),
        agreement: z.null(),
      }),
      z.object({
        eligible: z.boolean(),
        reason: z.null(),
        agreement: z.object({
          id: outputNumber,
          agreementReference: z.string(),
          agreementType: z.enum(["baggage", "full", "ticketing"]),
          prorateType: z.union([
            z.null(),
            z.literal("percentage"),
            z.literal("mileage"),
            z.literal("spi"),
          ]),
          baggageThroughCheck: z.boolean(),
          baggageRuleApplied: z.union([
            z.null(),
            z.literal("most_significant_carrier"),
            z.literal("first_carrier"),
            z.literal("each_carrier"),
          ]),
          settlementMethod: z.union([
            z.null(),
            z.literal("bsp"),
            z.literal("bilateral"),
            z.literal("ich"),
          ]),
          validFrom: z.date(),
          validUntil: z.union([z.null(), z.date()]),
          status: z.enum([
            "active",
            "suspended",
            "draft",
            "pending_approval",
            "terminated",
          ]),
        }),
      }),
    ]),
  }),
  calculateProrate: z.object({
    success: z.boolean(),
    data: z.object({
      agreementId: outputNumber,
      prorateType: z.string(),
      totalFare: outputNumber,
      segment1Share: outputNumber,
      segment2Share: outputNumber,
      segment1Distance: outputNumber,
      segment2Distance: outputNumber,
    }),
  }),
  getPartners: z.object({
    success: z.boolean(),
    data: z.array(
      z.object({
        airlineId: outputNumber,
        airlineCode: z.string(),
        airlineName: z.string(),
        partnershipType: z.enum(["codeshare", "interline"]),
        agreementReference: z.string(),
        agreementStatus: z.string(),
      })
    ),
  }),
};
