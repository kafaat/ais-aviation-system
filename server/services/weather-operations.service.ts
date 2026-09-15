import { and, eq, gt, inArray, like, lte } from "drizzle-orm";
import {
  airportWeatherStations,
  flights,
  operationsAlerts,
} from "../../drizzle/schema";
import { getDb } from "../db";
import {
  configuredWeatherSource,
  type WeatherSource,
} from "../integrations/aviation-weather";
import {
  flightWeatherAdvisory,
  ingestReports,
  pullStationReports,
  weatherAlertsFrom,
} from "./aviation-weather.service";
import {
  applyOperationalChecks,
  type OperationalCheck,
} from "./operational-observations.service";

/** Refresh registered stations, then update advisory incidents. Missing coverage
 * creates its own incident; it cannot resolve an earlier bad-weather incident. */
export async function refreshWeatherOperations(
  now = new Date(),
  source: WeatherSource | null = configuredWeatherSource()
) {
  const db = getDb();
  if (!db) throw new Error("Weather operations database unavailable");
  if (!source) return { enabled: false, fetched: 0, flights: 0 };
  const active = await db
    .select({
      id: flights.id,
      originId: flights.originId,
      destinationId: flights.destinationId,
    })
    .from(flights)
    .where(
      and(
        inArray(flights.status, ["scheduled", "delayed"]),
        gt(flights.arrivalTime, now),
        lte(flights.departureTime, new Date(now.getTime() + 24 * 3600_000))
      )
    );
  const airportIds = [
    ...new Set(active.flatMap(f => [f.originId, f.destinationId])),
  ];
  const mapped = airportIds.length
    ? await db
        .select({ icaoCode: airportWeatherStations.icaoCode })
        .from(airportWeatherStations)
        .where(inArray(airportWeatherStations.airportId, airportIds))
    : [];
  const stations = [...new Set(mapped.map(s => s.icaoCode))];
  let fetched = 0;
  let fetchFailure: unknown;
  try {
    for (let i = 0; i < stations.length; i += 20) {
      const result = await pullStationReports(
        source,
        "metar",
        stations.slice(i, i + 20),
        reports => db.transaction(tx => ingestReports(tx, source, reports))
      );
      fetched += result.fetched;
    }
  } catch (error) {
    fetchFailure = error;
  }
  const checks: OperationalCheck[] = [];
  for (const flight of active) {
    const advisory = await flightWeatherAdvisory(db, flight.id, now);
    for (const field of advisory.fields) {
      const key = `weather:${flight.id}:${field.role}`;
      const known =
        field.coverage === "classified" && field.flightCategory !== null;
      checks.push({
        key: `${key}:coverage`,
        bad: !known,
        message: `Flight ${flight.id}: ${field.airportCode} weather coverage ${field.coverage}; observation ${field.issuedAt ?? "unavailable"}`,
      });
      if (known) {
        const [alert] = weatherAlertsFrom({ ...advisory, fields: [field] });
        checks.push({
          key,
          bad: !!alert,
          message: alert
            ? `Flight ${flight.id}: ${alert.message}; observed ${field.issuedAt}`
            : `Flight ${flight.id}: fresh ${field.airportCode} VFR report`,
        });
      }
    }
  }
  const activeIds = new Set(active.map(f => f.id));
  const prior = await db
    .select({ key: operationsAlerts.key })
    .from(operationsAlerts)
    .where(
      and(
        like(operationsAlerts.key, "weather:%"),
        eq(operationsAlerts.status, "active")
      )
    );
  for (const alert of prior) {
    const id = Number(alert.key.split(":")[1]);
    if (!activeIds.has(id))
      checks.push({
        key: alert.key,
        bad: false,
        message: `Flight ${id} is outside the active weather monitoring window`,
      });
  }
  await applyOperationalChecks(checks);
  if (fetchFailure) throw fetchFailure;
  return { enabled: true, fetched, flights: active.length };
}
