// Explicit response field allowlists. Review contract changes with producers and consumers.
import { z } from "zod";
import {
  flightCategory,
  weatherConcern,
  weatherCoverage,
  weatherReportKind,
} from "../../shared/aviation-weather";
import { outputNumber } from "./primitives";

/** The three ceiling cases stay distinct on the wire. Flattening them to a
 * number would make "no ceiling layer" and "a ceiling nobody measured" look
 * like the same thing to every consumer. */
const ceiling = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }),
  z.object({ kind: z.literal("at"), feet: outputNumber }),
  z.object({ kind: z.literal("indeterminate") }),
]);

const observation = z.object({
  icaoCode: z.string(),
  kind: weatherReportKind,
  issuedAt: z.string(),
  rawText: z.string(),
  ceiling,
  visibilityStatuteMiles: outputNumber.nullable(),
  windSpeed: outputNumber.nullable(),
  windGust: outputNumber.nullable(),
  temperatureC: outputNumber.nullable(),
  flightCategory: flightCategory.nullable(),
  concerns: z.array(weatherConcern),
});

const field = z.object({
  airportId: outputNumber,
  airportCode: z.string(),
  role: z.enum(["origin", "destination"]),
  icaoCode: z.string().nullable(),
  coverage: weatherCoverage,
  issuedAt: z.string().nullable(),
  ageMinutes: outputNumber.nullable(),
  flightCategory: flightCategory.nullable(),
  concerns: z.array(weatherConcern),
  rawText: z.string().nullable(),
});

export const responseContracts = {
  mapStation: z.object({
    airportId: outputNumber,
    icaoCode: z.string(),
  }),
  refresh: z.object({
    stored: outputNumber,
    duplicates: outputNumber,
    fetched: outputNumber,
    /** Airports whose station was never recorded, reported rather than
     * silently dropped from the pull. */
    unmapped: z.array(outputNumber),
  }),
  flightAdvisory: z.object({
    flightId: outputNumber,
    evaluatedAt: z.string(),
    fields: z.array(field),
    complete: z.boolean(),
  }),
  stations: z.array(
    z.object({
      icaoCode: z.string(),
      observation: observation.nullable(),
    })
  ),
};
