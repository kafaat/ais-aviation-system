import { z } from "zod";

const decimalInRange = (min: number, max: number) =>
  z
    .string()
    .trim()
    .regex(/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/, "Expected a decimal number")
    .refine(
      value =>
        Number.isFinite(Number(value)) &&
        Number(value) >= min &&
        Number(value) <= max,
      `Value must be between ${min} and ${max}`
    );

// Shared by the public ingestion contract and direct service callers.
export const flightPositionRanges = {
  latitude: decimalInRange(-90, 90),
  longitude: decimalInRange(-180, 180),
  progressPercent: decimalInRange(0, 100).optional(),
};
export const flightPositionRangeSchema = z.object(flightPositionRanges);
