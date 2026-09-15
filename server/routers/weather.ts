/** Aviation weather router (R2-10).
 *
 * Everything here is operational and read-mostly. Recording a station mapping
 * and pulling bulletins are admin commands; reading an advisory is an admin
 * read. Nothing in this router changes a flight, booking, gate or payment.
 */
import { z } from "zod";
import { adminProcedure, router } from "../_core/trpc";
import {
  getFlightWeatherAdvisory,
  getStationWeather,
  mapAirportStation,
  refreshAirportWeather,
} from "../services/aviation-weather.service";
import { icaoCode, weatherReportKind } from "../../shared/aviation-weather";
import { responseContracts } from "../contracts/weather";

/** Bounded so one command cannot fan out into a bulk scrape of the source. */
const MAX_AIRPORTS = 20;

export const weatherRouter = router({
  /** Records which ICAO station reports for an airport. IATA and ICAO are
   * unrelated code spaces, so the operator supplies both the identifier and
   * where they verified it; nothing is inferred from the IATA code. */
  mapStation: adminProcedure
    .input(
      z.object({
        airportId: z.number().int().positive(),
        icaoCode,
        mappingEvidence: z.string().trim().min(5).max(255),
      })
    )
    .output(responseContracts.mapStation)
    .mutation(({ input, ctx }) =>
      mapAirportStation({ ...input, recordedBy: ctx.user.id })
    ),

  /** Pulls the configured source for these airports' recorded stations.
   * Airports with no station come back in `unmapped` rather than being
   * silently skipped. */
  refresh: adminProcedure
    .input(
      z.object({
        airportIds: z
          .array(z.number().int().positive())
          .min(1)
          .max(MAX_AIRPORTS),
        kind: weatherReportKind.default("metar"),
      })
    )
    .output(responseContracts.refresh)
    .mutation(({ input }) => refreshAirportWeather(input)),

  /** Origin and destination coverage for one flight. Advisory only. */
  flightAdvisory: adminProcedure
    .input(z.object({ flightId: z.number().int().positive() }))
    .output(responseContracts.flightAdvisory)
    .query(({ input }) => getFlightWeatherAdvisory(input.flightId)),

  /** Latest stored bulletin per station, or `null` where none is stored. */
  stations: adminProcedure
    .input(
      z.object({
        stations: z.array(icaoCode).min(1).max(MAX_AIRPORTS),
        kind: weatherReportKind.default("metar"),
      })
    )
    .output(responseContracts.stations)
    .query(({ input }) => getStationWeather(input.stations, input.kind)),
});
