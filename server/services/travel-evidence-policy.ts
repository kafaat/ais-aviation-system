import { z } from "zod";
export const carbonEvidenceSchema = z
  .object({
    method: z.string().min(1).max(100),
    version: z.string().min(1).max(50),
    reference: z.string().url(),
    basis: z.enum(["measured", "estimated"]),
    validUntil: z.iso.datetime(),
    originId: z.number().int().positive(),
    destinationId: z.number().int().positive(),
    departureTime: z.iso.datetime(),
    distanceKm: z.number().positive().max(25000),
    fuelKg: z.number().positive().max(500000),
    co2KgPerFuelKg: z.number().positive().max(10),
    passengerFuelShare: z.number().positive().max(1),
    economyEquivalentPassengers: z.number().positive().max(3000),
    businessWeight: z.number().min(1).max(20),
    offsetQuote: z
      .object({
        id: z.string().min(1).max(100),
        reference: z.string().url(),
        currency: z.literal("SAR"),
        economyAmountMinor: z.number().int().nonnegative().max(10000000),
        businessAmountMinor: z.number().int().nonnegative().max(10000000),
        validUntil: z.iso.datetime(),
      })
      .optional(),
  })
  .strict();
export function carbonFromEvidence(raw: z.infer<typeof carbonEvidenceSchema>) {
  const p = carbonEvidenceSchema.parse(raw);
  const co2Economy =
    (p.fuelKg * p.co2KgPerFuelKg * p.passengerFuelShare) /
    p.economyEquivalentPassengers;
  return {
    co2Economy: Math.round(co2Economy * 100) / 100,
    co2Business: Math.round(co2Economy * p.businessWeight * 100) / 100,
  };
}
export const travelProfileSchema = z
  .object({
    nationality: z.string().regex(/^[A-Z]{2,3}$/),
    residenceCountry: z
      .string()
      .regex(/^[A-Z]{2,3}$/)
      .nullable(),
    documentType: z.enum(["passport", "national_id"]),
    purpose: z.enum(["tourism", "business", "transit"]),
    stayDays: z.number().int().min(0).max(365),
    dateOfBirth: z.iso.date().nullable(),
    transitAirportIds: z.array(z.number().int().positive()).max(10),
  })
  .strict();
export const travelRuleSchema = z
  .object({
    profile: travelProfileSchema,
    version: z.string().min(1).max(50),
    reference: z.string().url(),
    providerTransactionId: z.string().min(1).max(100),
    validUntil: z.iso.datetime(),
    departureTime: z.iso.datetime(),
    destinationId: z.number().int().positive(),
    visaRequired: z.boolean(),
    visaOnArrival: z.boolean(),
    passportValidUntil: z.iso.date().nullable(),
    covidTestRequired: z.boolean(),
    notes: z.array(z.string().min(1).max(1000)).max(20),
  })
  .strict();
