/**
 * Backfill booking-class (RBD) inventory for existing flights (ADR 0002).
 *
 * For every airline, one default class per cabin is chosen: the active
 * highest-priority fare class of that cabin, or a new "Y"/"J" standard class
 * (multiplier 1.000) when the airline has none. Every flight then receives one
 * nested inventory row per cabin, authorized to the cabin capacity, with
 * `sold` derived from the cabin counters so availability is unchanged.
 *
 * Idempotent: existing rows are left alone (unique flightId + fareClassId).
 * Usage: DATABASE_URL=... node --import tsx scripts/db/backfill-rbd-inventory.ts [--dry-run]
 */
import { createConnection } from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import {
  airlines,
  fareClasses,
  flightFareClassInventory,
  flights,
} from "../../drizzle/schema";
import {
  deriveDefaultInventory,
  type Cabin,
} from "../../server/services/rbd-inventory.service";

const DEFAULTS: Record<Cabin, { code: string; name: string }> = {
  economy: { code: "Y", name: "Economy Standard" },
  business: { code: "J", name: "Business Standard" },
};

async function main() {
  if (!process.env.DATABASE_URL)
    throw new Error("DATABASE_URL is required for the RBD backfill");
  const dryRun = process.argv.includes("--dry-run");
  const connection = await createConnection(process.env.DATABASE_URL);
  const db = drizzle(connection);
  let classesCreated = 0;
  let rowsInserted = 0;
  try {
    const carriers = await db
      .select({ id: airlines.id })
      .from(airlines)
      .orderBy(asc(airlines.id));
    for (const carrier of carriers) {
      const defaults: Partial<Record<Cabin, number>> = {};
      for (const cabin of ["economy", "business"] as Cabin[]) {
        const [existing] = await db
          .select({ id: fareClasses.id })
          .from(fareClasses)
          .where(
            and(
              eq(fareClasses.airlineId, carrier.id),
              eq(fareClasses.cabinClass, cabin),
              eq(fareClasses.active, true)
            )
          )
          .orderBy(desc(fareClasses.priority), asc(fareClasses.id))
          .limit(1);
        if (existing) {
          defaults[cabin] = existing.id;
          continue;
        }
        classesCreated++;
        if (dryRun) {
          // Placeholder so the dry run still counts the rows it would insert.
          defaults[cabin] = -1;
          continue;
        }
        const [created] = await db.insert(fareClasses).values({
          airlineId: carrier.id,
          code: DEFAULTS[cabin].code,
          name: DEFAULTS[cabin].name,
          cabinClass: cabin,
          fareFamily: "Standard",
          priority: 100,
          basePriceMultiplier: "1.000",
        });
        defaults[cabin] = Number(created.insertId);
      }
      const carrierFlights = await db
        .select({
          id: flights.id,
          economySeats: flights.economySeats,
          businessSeats: flights.businessSeats,
          economyAvailable: flights.economyAvailable,
          businessAvailable: flights.businessAvailable,
        })
        .from(flights)
        .where(eq(flights.airlineId, carrier.id))
        .orderBy(asc(flights.id));
      if (!carrierFlights.length) continue;
      const covered = new Set(
        (
          await db
            .select({
              flightId: flightFareClassInventory.flightId,
              cabinClass: flightFareClassInventory.cabinClass,
            })
            .from(flightFareClassInventory)
            .where(
              inArray(
                flightFareClassInventory.flightId,
                carrierFlights.map(f => f.id)
              )
            )
        ).map(r => `${r.flightId}:${r.cabinClass}`)
      );
      const rows = carrierFlights
        .flatMap(flight => deriveDefaultInventory(flight, defaults))
        // A cabin that already has any RBD row keeps its operator-set classes.
        .filter(row => !covered.has(`${row.flightId}:${row.cabinClass}`));
      rowsInserted += rows.length;
      if (dryRun || !rows.length) continue;
      for (let i = 0; i < rows.length; i += 500)
        await db
          .insert(flightFareClassInventory)
          .values(rows.slice(i, i + 500))
          .onDuplicateKeyUpdate({
            set: { flightId: sql`${flightFareClassInventory.flightId}` },
          });
    }
    console.info(
      `${dryRun ? "[dry-run] " : ""}RBD backfill: ${classesCreated} default fare class(es), ${rowsInserted} inventory row(s) for ${carriers.length} airline(s)`
    );
  } finally {
    await connection.end();
  }
}

await main();
