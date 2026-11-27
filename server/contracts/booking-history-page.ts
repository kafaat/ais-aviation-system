import { z } from "zod";

export const bookingHistoryPage = z.object({
  sort: z
    .enum(["dateDesc", "dateAsc", "priceDesc", "priceAsc"])
    .default("dateDesc"),
  status: z.enum(["pending", "confirmed", "completed", "cancelled"]).optional(),
  afterDate: z.date().optional(),
  beforeDate: z.date().optional(),
  bookingId: z.number().int().positive().optional(),
  limit: z.number().int().min(1).max(100).default(25),
  cursor: z
    .object({
      id: z.number().int().positive(),
      value: z
        .number()
        .int()
        .safe()
        .min(-8640000000000000)
        .max(8640000000000000),
    })
    .nullish(),
});
export type BookingHistoryPage = z.infer<typeof bookingHistoryPage>;
