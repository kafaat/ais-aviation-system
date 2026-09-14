import assert from "node:assert/strict";
import { and, eq } from "drizzle-orm";
import {
  airlines,
  airports,
  airportWeatherStations,
  flights,
  outbox,
  weatherObservations,
} from "../../drizzle/schema";
import type { SettlementTx } from "../../server/services/booking-settlement.service";
import {
  flightWeatherAdvisory,
  ingestReports,
  recordStationMapping,
  weatherAlertsFrom,
} from "../../server/services/aviation-weather.service";
import { decodeMetar } from "../../server/integrations/aviation-weather";
import type { WeatherReport } from "../../shared/aviation-weather";

/** R2-10 acceptance against real MySQL.
 *
 * These are the properties the in-memory boundary double cannot establish: the
 * unique index that backs the duplicate check, `decimal` and `timestamp`
 * round-tripping, and the advisory reading through real SQL. No request
 * reaches the Aviation Weather Center; every bulletin here is a local fixture.
 */
export async function verifyR2Weather(
  db: SettlementTx,
  seed: number,
  check: (name: string, run: () => Promise<void>) => Promise<void>
) {
  const id = seed + 9000;
  const source = { mode: "sandbox" as const, reference: "sandbox:acceptance" };
  const at = (minutesAgo: number) =>
    new Date(Math.floor((Date.now() - minutesAgo * 60_000) / 1000) * 1000);

  await db.insert(airports).values([
    {
      id,
      code: "R2W",
      name: "R2 weather origin",
      city: "Fixture",
      country: "Fixture",
    },
    {
      id: id + 1,
      code: "R2X",
      name: "R2 weather destination",
      city: "Fixture",
      country: "Fixture",
    },
  ]);
  await db
    .insert(airlines)
    .values({ id, code: "RW", name: "R2 weather fixture" });
  await db.insert(flights).values({
    id,
    flightNumber: "R2W1",
    airlineId: id,
    originId: id,
    destinationId: id + 1,
    departureTime: new Date(Date.now() + 6 * 3600_000),
    arrivalTime: new Date(Date.now() + 8 * 3600_000),
    aircraftType: "A320",
    status: "scheduled",
    economySeats: 10,
    businessSeats: 0,
    economyAvailable: 10,
    businessAvailable: 0,
    economyPrice: 10000,
    businessPrice: 0,
  });

  /** Builds an AWC-shaped row, then decodes it through the real adapter so the
   * acceptance path exercises the same decoder production uses. */
  const report = (
    station: string,
    minutesAgo: number,
    overrides: Record<string, unknown> = {}
  ): WeatherReport =>
    decodeMetar({
      icaoId: station,
      rawOb: `${station} ${minutesAgo}Z FIXTURE`,
      reportTime: at(minutesAgo).toISOString(),
      temp: 30,
      dewp: 12,
      wdir: 320,
      wspd: 9,
      wgst: null,
      visib: "10+",
      altim: 1008,
      clouds: [{ cover: "FEW", base: 3000 }],
      ...overrides,
    });

  await check(
    "R2 weather: an airport with no recorded station is uncovered, not calm",
    async () => {
      const advisory = await flightWeatherAdvisory(db, id);
      assert.deepEqual(
        advisory.fields.map(field => field.coverage),
        ["station_unmapped", "station_unmapped"]
      );
      assert.equal(advisory.complete, false);
      // Nothing observed means nothing to alert on.
      assert.deepEqual(weatherAlertsFrom(advisory), []);
    }
  );

  await check(
    "R2 weather: a station mapping is recorded with its evidence and is exclusive",
    async () => {
      await db.transaction(tx =>
        recordStationMapping(tx, {
          airportId: id,
          icaoCode: "oe01",
          mappingEvidence:
            "ICAO Doc 7910 location indicators, acceptance fixture",
          recordedBy: seed,
        })
      );
      const [row] = await db
        .select()
        .from(airportWeatherStations)
        .where(eq(airportWeatherStations.airportId, id));
      assert.equal(row.icaoCode, "OE01");
      assert.equal(row.recordedBy, seed);

      await assert.rejects(
        db.transaction(tx =>
          recordStationMapping(tx, {
            airportId: id + 1,
            icaoCode: "OE01",
            mappingEvidence:
              "ICAO Doc 7910 location indicators, acceptance fixture",
            recordedBy: seed,
          })
        ),
        /already mapped to another airport/
      );
    }
  );

  await check(
    "R2 weather: re-ingesting a bulletin stores nothing and emits nothing new",
    async () => {
      const bulletin = report("OE01", 10);
      const first = await db.transaction(tx =>
        ingestReports(tx, source, [bulletin])
      );
      assert.deepEqual(first, { stored: 1, duplicates: 0 });
      const again = await db.transaction(tx =>
        ingestReports(tx, source, [bulletin, bulletin])
      );
      assert.deepEqual(again, { stored: 0, duplicates: 2 });

      const rows = await db
        .select()
        .from(weatherObservations)
        .where(eq(weatherObservations.icaoCode, "OE01"));
      assert.equal(rows.length, 1);
      const events = await db
        .select()
        .from(outbox)
        .where(
          and(
            eq(outbox.eventType, "weather.observed"),
            eq(outbox.aggregateId, "OE01")
          )
        );
      assert.equal(events.length, 1);
      // Field weather describes the airport, not one airline's traffic.
      assert.equal(events[0].tenantId, null);
    }
  );

  await check(
    "R2 weather: the unique index refuses a duplicate identity written past the check",
    async () => {
      // The duplicate check is a read, so this is the backstop that makes a
      // concurrent ingest of the same bulletin fail rather than double-store.
      const [existing] = await db
        .select()
        .from(weatherObservations)
        .where(eq(weatherObservations.icaoCode, "OE01"));
      await assert.rejects(
        db.insert(weatherObservations).values({
          icaoCode: existing.icaoCode,
          kind: existing.kind,
          issuedAt: existing.issuedAt,
          rawText: existing.rawText,
          bodyDigest: existing.bodyDigest,
          ceilingIndeterminate: existing.ceilingIndeterminate,
          sourceReference: existing.sourceReference,
          sourceMode: existing.sourceMode,
        }),
        // The driver error code, not its message: the message is Drizzle's
        // wrapper text and MySQL's own reason sits on the cause.
        (error: unknown) => {
          const cause = (error as { cause?: { code?: string } }).cause;
          assert.equal(cause?.code, "ER_DUP_ENTRY");
          return true;
        }
      );
    }
  );

  await check(
    "R2 weather: measurements survive the round trip and drive the category",
    async () => {
      await db.transaction(tx =>
        ingestReports(tx, source, [
          report("OE01", 5, {
            rawOb: "OE01 LOWVIS FIXTURE",
            visib: "1/2",
            clouds: [{ cover: "OVC", base: 300 }],
            wspd: 34,
            wgst: 49,
          }),
        ])
      );
      const advisory = await flightWeatherAdvisory(db, id);
      const [origin] = advisory.fields;
      assert.equal(origin.coverage, "classified");
      assert.equal(origin.flightCategory, "LIFR");
      assert.deepEqual(origin.concerns, [
        "low_visibility",
        "low_ceiling",
        "strong_wind",
        "gusting",
      ]);
      // Half a statute mile has to come back out of `decimal(5,2)` intact, or
      // the category would silently move a band.
      const [stored] = await db
        .select()
        .from(weatherObservations)
        .where(eq(weatherObservations.rawText, "OE01 LOWVIS FIXTURE"));
      assert.equal(Number(stored.visibilityStatuteMiles), 0.5);
      assert.equal(stored.ceilingFeet, 300);
      assert.equal(stored.flightCategory, "LIFR");

      const alerts = weatherAlertsFrom(advisory);
      assert.equal(alerts.length, 1);
      assert.equal(alerts[0].severity, "high");
      assert.match(alerts[0].suggestedAction, /Advisory only/);
    }
  );

  await check(
    "R2 weather: an expired bulletin stops classifying but stays readable",
    async () => {
      await db.transaction(tx =>
        recordStationMapping(tx, {
          airportId: id + 1,
          icaoCode: "OE02",
          mappingEvidence:
            "ICAO Doc 7910 location indicators, acceptance fixture",
          recordedBy: seed,
        })
      );
      await db.transaction(tx =>
        ingestReports(tx, source, [
          report("OE02", 200, {
            rawOb: "OE02 STALE FIXTURE",
            visib: "1/2",
            clouds: [{ cover: "OVC", base: 300 }],
          }),
        ])
      );
      const advisory = await flightWeatherAdvisory(db, id);
      const destination = advisory.fields[1];
      assert.equal(destination.coverage, "stale_observation");
      assert.equal(destination.rawText, "OE02 STALE FIXTURE");
      assert.equal(destination.flightCategory, null);
      assert.deepEqual(destination.concerns, []);
      assert.equal(advisory.complete, false);
      // Only the origin, which is current, may raise an alert.
      assert.deepEqual(
        weatherAlertsFrom(advisory).map(alert => alert.message.slice(0, 3)),
        ["R2W"]
      );
    }
  );

  await check(
    "R2 weather: an unmeasured ceiling is not reported as clear",
    async () => {
      await db.transaction(tx =>
        ingestReports(tx, source, [
          report("OE02", 1, {
            rawOb: "OE02 OBSCURED FIXTURE",
            clouds: [{ cover: "OVX", base: null }],
          }),
        ])
      );
      const advisory = await flightWeatherAdvisory(db, id);
      const destination = advisory.fields[1];
      assert.equal(destination.coverage, "classified");
      // Obscured with no measured vertical visibility: classified as nothing.
      assert.equal(destination.flightCategory, null);
      assert.equal(advisory.complete, false);
      const [stored] = await db
        .select()
        .from(weatherObservations)
        .where(eq(weatherObservations.rawText, "OE02 OBSCURED FIXTURE"));
      assert.equal(stored.ceilingIndeterminate, true);
      assert.equal(stored.ceilingFeet, null);
      assert.equal(stored.flightCategory, null);
    }
  );
}
