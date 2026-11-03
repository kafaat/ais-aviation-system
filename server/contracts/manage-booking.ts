import { z } from "zod";

export const PUBLIC_BOOKING_LOOKUP_FAILURE =
  "Unable to retrieve a booking with those details. Check the details or try again later.";

export function normalizeBookingSurname(value: string): string {
  // Preserve accents and punctuation: stripping them would broaden access to
  // other surnames. Normalize only Unicode composition, spacing and case.
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();
}

export const publicBookingLookupInput = z
  .object({
    bookingReference: z
      .string()
      .max(64)
      .transform(value => value.normalize("NFKC").trim().toUpperCase())
      // This is the AIS bookingReference format, not a PNR alias.
      .pipe(z.string().regex(/^[A-Z0-9]{6}$/)),
    surname: z
      .string()
      .min(1)
      .max(100)
      .refine(value => !/[\p{Cc}\p{Cf}]/u.test(value))
      .transform(normalizeBookingSurname)
      .pipe(z.string().min(1).max(100)),
  })
  .strict();

const bookingStatus = z.enum([
  "pending",
  "confirmed",
  "cancelled",
  "completed",
]);
const airport = z
  .object({
    code: z.string(),
    city: z.string(),
    timezone: z.string().nullable(),
  })
  .strict();

// Deliberately independent of the account booking DTO. No IDs, passenger
// names, contact/document fields, prices, payment state or account metadata.
export const publicBookingLookupResult = z
  .object({
    bookingReference: z.string(),
    status: bookingStatus,
    itinerary: z.array(
      z
        .object({
          flightNumber: z.string(),
          departureTime: z.string().datetime(),
          arrivalTime: z.string().datetime(),
          origin: airport,
          destination: airport,
          flightStatus: z.enum([
            "scheduled",
            "delayed",
            "cancelled",
            "completed",
          ]),
          segmentStatus: bookingStatus,
        })
        .strict()
    ),
  })
  .strict();

export type PublicBookingLookupInput = z.infer<typeof publicBookingLookupInput>;
export type PublicBookingLookupResult = z.infer<
  typeof publicBookingLookupResult
>;
