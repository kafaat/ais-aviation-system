import { z } from "zod";

// MySQL aggregates may be decimal strings. Empty values and null are not zero.
export const outputNumber = z.union([
  z.number().finite(),
  z
    .string()
    .regex(/^-?\d+(?:\.\d+)?$/)
    .transform(Number)
    .pipe(z.number().finite()),
]);
export type StructuredValue =
  | null
  | boolean
  | number
  | string
  | Date
  | StructuredValue[]
  | { [key: string]: StructuredValue };
// Only the explicitly documented metadata fields use extensible structures.
// Domain objects always use field allowlists; credential-looking metadata is removed.
export const structuredValue: z.ZodType<StructuredValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number().finite(),
    z.string(),
    z.date(),
    z.array(structuredValue),
    z
      .record(z.string(), structuredValue)
      .overwrite(record =>
        Object.fromEntries(
          Object.entries(record).filter(
            ([key]) =>
              !/^(password(?:hash)?|secret|api_?key|api_?secret|access_?token|refresh_?token|token_?hash)$/i.test(
                key
              )
          )
        )
      ),
  ])
);
