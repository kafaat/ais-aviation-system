// Explicit response field allowlists. Review contract changes with producers and consumers.
import { z } from "zod";
import { outputNumber } from "./primitives";
export const responseContracts = {
  deleteBooking: z.object({ success: z.boolean(), bookingId: outputNumber }),
  restoreBooking: z.object({ success: z.boolean(), bookingId: outputNumber }),
  getDeletedBookings: z.array(
    z.object({
      id: outputNumber,
      bookingReference: z.string(),
      pnr: z.string(),
      status: z.enum(["cancelled", "completed", "pending", "confirmed"]),
      totalAmount: outputNumber,
      paymentStatus: z.enum(["pending", "paid", "refunded", "failed"]),
      cabinClass: z.enum(["economy", "business"]),
      numberOfPassengers: outputNumber,
      deletedAt: z.union([z.null(), z.date()]),
      createdAt: z.date(),
      userId: outputNumber,
      flightNumber: z.string(),
      origin: z.string(),
      destination: z.string(),
      departureTime: z.date(),
    })
  ),
  getDeletedCount: outputNumber,
  purgeDeleted: z.object({ purgedCount: outputNumber }),
};
