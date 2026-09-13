// Explicit response field allowlists. Review contract changes with producers and consumers.
import { z } from "zod";
import { outputNumber } from "./primitives";
export const responseContracts = {
  join: z.object({
    id: outputNumber,
    position: outputNumber,
    message: z.string(),
  }),
  getPosition: z.object({
    position: z.union([z.null(), outputNumber]),
    status: z.union([z.null(), z.string()]),
    entry: z.union([
      z.null(),
      z.object({
        id: outputNumber,
        status: z.enum([
          "cancelled",
          "confirmed",
          "expired",
          "waiting",
          "offered",
        ]),
        createdAt: z.date(),
        updatedAt: z.date(),
        flightId: outputNumber,
        bookingId: z.union([z.null(), outputNumber]),
        userId: outputNumber,
        cabinClass: z.enum(["economy", "business"]),
        seats: outputNumber,
        notifyByEmail: z.boolean(),
        notifyBySms: z.boolean(),
        priority: outputNumber,
        offeredAt: z.union([z.null(), z.date()]),
        offerExpiresAt: z.union([z.null(), z.date()]),
        confirmedAt: z.union([z.null(), z.date()]),
      }),
    ]),
  }),
  myWaitlist: z.array(
    z.object({
      id: outputNumber,
      flightId: outputNumber,
      flightNumber: z.string(),
      originCode: z.string(),
      originCity: z.string(),
      destinationCode: z.string(),
      destinationCity: z.string(),
      airlineName: z.string(),
      airlineLogo: z.union([z.null(), z.string()]),
      departureTime: z.date(),
      cabinClass: z.string(),
      seats: outputNumber,
      priority: outputNumber,
      status: z.string(),
      offeredAt: z.union([z.null(), z.date()]),
      offerExpiresAt: z.union([z.null(), z.date()]),
      createdAt: z.date(),
    })
  ),
  acceptOffer: z.object({
    waitlistId: outputNumber,
    expiresAt: z.date(),
    success: z.boolean(),
    message: z.string(),
    flightId: outputNumber,
    cabinClass: z.enum(["economy", "business"]),
    passengers: outputNumber,
  }),
  declineOffer: z.object({ success: z.boolean(), message: z.string() }),
  cancel: z.object({ success: z.boolean(), message: z.string() }),
  updateNotifications: z.object({ success: z.boolean() }),
  getFlightWaitlist: z.array(
    z.object({
      id: outputNumber,
      userId: outputNumber,
      userName: z.union([z.null(), z.string()]),
      userEmail: z.union([z.null(), z.string()]),
      cabinClass: z.string(),
      seats: outputNumber,
      priority: outputNumber,
      status: z.string(),
      offeredAt: z.union([z.null(), z.date()]),
      offerExpiresAt: z.union([z.null(), z.date()]),
      confirmedAt: z.union([z.null(), z.date()]),
      createdAt: z.date(),
    })
  ),
  offerSeat: z.object({ success: z.boolean(), expiresAt: z.date() }),
  processWaitlist: z.object({
    offeredCount: outputNumber,
    notifications: z.array(
      z.object({ userId: outputNumber, email: z.boolean(), sms: z.boolean() })
    ),
  }),
  processExpiredOffers: z.object({
    expiredCount: outputNumber,
    reofferedCount: outputNumber,
  }),
  getStats: z.object({
    totalWaiting: outputNumber,
    totalOffered: outputNumber,
    totalConfirmed: outputNumber,
    totalExpired: outputNumber,
    avgWaitTime: outputNumber,
  }),
};
