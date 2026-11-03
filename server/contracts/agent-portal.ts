import { z } from "zod";

const id = z.number().int().positive();
const cabinClass = z.enum(["economy", "business"]);
const bookingStatus = z.enum([
  "pending",
  "confirmed",
  "cancelled",
  "completed",
]);
const airportCode = z
  .string()
  .trim()
  .length(3)
  .regex(/^[a-zA-Z]{3}$/)
  .transform(value => value.toUpperCase());
const civilDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(value => {
    const date = new Date(`${value}T00:00:00Z`);
    return (
      Number.isFinite(date.getTime()) &&
      date.toISOString().slice(0, 10) === value
    );
  });

export const agentPortalSearchInput = z
  .object({
    agencyId: id,
    originCode: airportCode,
    destinationCode: airportCode,
    departureDate: civilDate,
    cabinClass,
    passengers: z.number().int().min(1).max(9),
  })
  .strict()
  .refine(value => value.originCode !== value.destinationCode, {
    message: "Choose different airports",
  });

export const agentPortalBookingInput = z
  .object({
    agencyId: id,
    idempotencyKey: z.string().uuid(),
    flightId: id,
    cabinClass,
    passengers: z
      .array(
        z
          .object({
            type: z.enum(["adult", "child", "infant"]),
            firstName: z.string().trim().min(1).max(100),
            lastName: z.string().trim().min(1).max(100),
          })
          .strict()
      )
      .min(1)
      .max(9),
    contactEmail: z.string().trim().email().max(320),
    contactPhone: z.string().trim().min(1).max(50),
    externalReference: z.string().trim().max(100).optional(),
  })
  .strict();

export const agentPortalAgency = z
  .object({
    id,
    agencyName: z.string(),
    iataNumber: z.string(),
    contactEmail: z.string(),
    contactPhone: z.string(),
  })
  .strict();

const airport = z
  .object({
    code: z.string(),
    city: z.string(),
    timezone: z.string().nullable(),
  })
  .strict();
export const agentPortalFlight = z
  .object({
    id,
    flightNumber: z.string(),
    departureTime: z.date(),
    arrivalTime: z.date(),
    origin: airport,
    destination: airport,
    cabinClass,
    availableSeats: z.number().int().nonnegative(),
    adultBaseFare: z.number().int().nonnegative(),
    currency: z.literal("SAR"),
  })
  .strict();

export const agentPortalDashboardInput = z
  .object({ agencyId: id, page: z.number().int().min(1).default(1) })
  .strict();
export const agentPortalDashboard = z
  .object({
    bookings: z.array(
      z
        .object({
          bookingId: id,
          bookingReference: z.string(),
          flightNumber: z.string(),
          departureTime: z.date(),
          status: bookingStatus,
          paymentStatus: z.enum(["pending", "paid", "failed", "refunded"]),
          totalAmount: z.number().int(),
          commissionAmount: z.number().int(),
          createdAt: z.date(),
        })
        .strict()
    ),
    total: z.number().int().nonnegative(),
    page: z.number().int().positive(),
    pageSize: z.literal(20),
    stats: z
      .object({
        totalBookings: z.number().int().nonnegative(),
        pendingBookings: z.number().int().nonnegative(),
        confirmedBookings: z.number().int().nonnegative(),
        recordedBookingAmount: z.number().int(),
        recordedCommissionAmount: z.number().int(),
      })
      .strict(),
    currency: z.literal("SAR"),
  })
  .strict();

export type AgentPortalSearch = z.infer<typeof agentPortalSearchInput>;
export type AgentPortalBooking = z.infer<typeof agentPortalBookingInput>;
