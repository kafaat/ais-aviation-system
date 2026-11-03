import { randomInt } from "node:crypto";

/**
 * Generate a ten-digit baggage license plate shaped for Resolution 740/RP1745.
 * The three-digit airline numeric code is an externally assigned value, so
 * production fails closed until the operator supplies it.
 */
export function generateBaggageTag(airlineNumericCode?: string): string {
  const code =
    airlineNumericCode ??
    process.env.BAGGAGE_AIRLINE_NUMERIC_CODE ??
    (process.env.NODE_ENV === "production" ? undefined : "000");
  if (!code || !/^\d{3}$/.test(code))
    throw new Error(
      "BAGGAGE_AIRLINE_NUMERIC_CODE must be the operator's assigned three-digit code"
    );
  return `0${code}${String(randomInt(0, 1_000_000)).padStart(6, "0")}`;
}

export const isBaggageLicensePlate = (value: string) => /^\d{10}$/.test(value);
