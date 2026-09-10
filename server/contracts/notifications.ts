// Explicit response field allowlists. Review contract changes with producers and consumers.
import { z } from "zod";
import { outputNumber, structuredValue } from "./primitives";
export const responseContracts = {
  list: z.array(
    z.object({
      data: z
        .object({
          link: z.string().optional(),
          bookingId: outputNumber.optional(),
          eventId: z.string().optional(),
        })
        .catchall(structuredValue)
        .nullable(),
      id: outputNumber,
      userId: outputNumber,
      type: z.enum(["flight", "booking", "payment", "system", "promo"]),
      title: z.string(),
      message: z.string(),
      isRead: z.boolean(),
      createdAt: z.date(),
      readAt: z.union([z.null(), z.date()]),
    })
  ),
  unreadCount: z.object({ count: outputNumber }),
  markAsRead: z.object({ success: z.boolean() }),
  markAllAsRead: z.object({ count: outputNumber }),
  delete: z.object({ success: z.boolean() }),
  deleteAll: z.object({ count: outputNumber }),
  create: z.object({ id: outputNumber }),
  createBulk: z.object({ count: outputNumber }),
  getUserNotifications: z.array(
    z.object({
      data: z
        .object({
          link: z.string().optional(),
          bookingId: outputNumber.optional(),
          eventId: z.string().optional(),
        })
        .catchall(structuredValue)
        .nullable(),
      id: outputNumber,
      userId: outputNumber,
      type: z.enum(["flight", "booking", "payment", "system", "promo"]),
      title: z.string(),
      message: z.string(),
      isRead: z.boolean(),
      createdAt: z.date(),
      readAt: z.union([z.null(), z.date()]),
    })
  ),
  cleanup: z.object({ count: outputNumber }),
};
