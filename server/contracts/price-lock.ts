// Explicit response field allowlists. Review contract changes with producers and consumers.
import { z } from "zod";
import { outputNumber } from "./primitives";
export const responseContracts = {
  create: z.object({
    lock: z.object({
      id: outputNumber,
      userId: outputNumber,
      flightId: outputNumber,
      cabinClass: z.enum(["economy", "business"]),
      lockedPrice: outputNumber,
      originalPrice: outputNumber,
      lockFee: outputNumber,
      status: z.enum(["cancelled", "active", "expired", "used"]),
      bookingId: z.union([z.null(), outputNumber]),
      expiresAt: z.date(),
      createdAt: z.date(),
      updatedAt: z.date(),
    }),
    message: z.string(),
    isNew: z.boolean(),
  }),
  myLocks: z.array(
    z.object({
      id: outputNumber,
      flightId: outputNumber,
      cabinClass: z.enum(["economy", "business"]),
      lockedPrice: outputNumber,
      originalPrice: outputNumber,
      lockFee: outputNumber,
      status: z.enum(["cancelled", "active", "expired", "used"]),
      expiresAt: z.date(),
      createdAt: z.date(),
      flightNumber: z.string(),
      departureTime: z.date(),
      currentEconomyPrice: outputNumber,
      currentBusinessPrice: outputNumber,
    })
  ),
  checkLock: z.object({
    lock: z.union([
      z.null(),
      z.object({
        id: outputNumber,
        userId: outputNumber,
        flightId: outputNumber,
        cabinClass: z.enum(["economy", "business"]),
        lockedPrice: outputNumber,
        originalPrice: outputNumber,
        lockFee: outputNumber,
        status: z.enum(["cancelled", "active", "expired", "used"]),
        bookingId: z.union([z.null(), outputNumber]),
        expiresAt: z.date(),
        createdAt: z.date(),
        updatedAt: z.date(),
      }),
    ]),
  }),
  cancel: z.object({ success: z.boolean() }),
};
