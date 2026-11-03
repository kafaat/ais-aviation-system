import { z } from "zod";

export const cabinClassEnum = z.enum([
  "first",
  "business",
  "premium_economy",
  "economy",
]);

const seatTypeEnum = z.enum([
  "window",
  "middle",
  "aisle",
  "bulkhead_window",
  "bulkhead_middle",
  "bulkhead_aisle",
  "exit_row_window",
  "exit_row_middle",
  "exit_row_aisle",
]);

const priceTierEnum = z.enum([
  "free",
  "standard",
  "preferred",
  "premium",
  "extra_legroom",
]);

const seatDefinitionSchema = z.object({
  column: z.string().min(1).max(2),
  seatType: seatTypeEnum,
  hasExtraLegroom: z.boolean().optional(),
  hasPowerOutlet: z.boolean().optional(),
  isReclinable: z.boolean().optional(),
  nearLavatory: z.boolean().optional(),
  nearGalley: z.boolean().optional(),
  priceTier: priceTierEnum.optional(),
  seatPrice: z.number().nonnegative().optional(),
  blocked: z.boolean().optional(),
});

const cabinRowSchema = z.object({
  row: z.number().positive(),
  cabinClass: cabinClassEnum,
  seats: z.array(seatDefinitionSchema).min(1),
});

export const cabinLayoutSchema = z.object({
  rows: z.array(cabinRowSchema).min(1),
});
