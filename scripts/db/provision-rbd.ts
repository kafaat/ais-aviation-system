import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { createConnection } from "mysql2/promise";
import { z } from "zod";
import * as schema from "../../drizzle/schema";
import type { SettlementTx } from "../../server/services/booking-settlement.service";

const seats = z.number().int().min(0).max(2147483647);
const id = z.number().int().positive();
const allocation = z.strictObject({
  reference: z.string().trim().min(1).max(250),
  tenantId: id,
  airlineId: id,
  rows: z
    .array(
      z.strictObject({
        flightId: id,
        fareClassId: id,
        cabin: z.enum(["economy", "business"]),
        expectedCabinAvailable: seats,
        capacity: seats,
        availableSeats: seats,
      })
    )
    .min(1)
    .max(250),
});

/** Insert only operator-declared buckets. No class is inferred from existing sales. */
export async function provisionRbd(
  db: SettlementTx,
  input: unknown,
  approvedDigest?: string
) {
  const plan = allocation.parse(input);
  const rows = [...plan.rows].sort(
    (a, b) => a.flightId - b.flightId || a.fareClassId - b.fareClassId
  );
  if (
    new Set(rows.map(row => `${row.flightId}:${row.fareClassId}`)).size !==
    rows.length
  )
    throw new Error("Duplicate bucket in operator allocation");
  const digest = createHash("sha256")
    .update(JSON.stringify({ ...plan, rows }))
    .digest("hex");
  const apply = approvedDigest !== undefined;
  if (apply && approvedDigest !== digest)
    throw new Error("Approval digest does not match the allocation");
  return await db.transaction(
    async tx => {
      const tenantQuery = tx
        .select()
        .from(schema.tenants)
        .where(eq(schema.tenants.id, plan.tenantId));
      const [tenant] = await (apply ? tenantQuery.for("share") : tenantQuery);
      if (tenant?.status !== "active")
        throw new Error("Active tenant required");
      const result = [];
      for (const row of rows) {
        const flightQuery = tx
          .select()
          .from(schema.flights)
          .where(eq(schema.flights.id, row.flightId));
        const [flight] = await (apply
          ? flightQuery.for("update")
          : flightQuery);
        const fareQuery = tx
          .select()
          .from(schema.fareClasses)
          .where(eq(schema.fareClasses.id, row.fareClassId));
        const [fare] = await (apply ? fareQuery.for("share") : fareQuery);
        if (
          !flight ||
          flight.tenantId !== plan.tenantId ||
          flight.airlineId !== plan.airlineId ||
          !fare?.active ||
          fare.airlineId !== plan.airlineId ||
          fare.cabinClass !== row.cabin ||
          !["scheduled", "delayed"].includes(flight.status) ||
          flight.departureTime <= new Date()
        )
          throw new Error(
            `Flight or active booking class outside allocation scope: ${row.flightId}/${row.fareClassId}`
          );
        const physical =
          row.cabin === "economy" ? flight.economySeats : flight.businessSeats;
        if (
          row.capacity > physical ||
          row.availableSeats > row.capacity ||
          row.availableSeats > row.expectedCabinAvailable
        )
          throw new Error(
            "Allocation exceeds the declared class or physical cabin capacity"
          );
        const existingQuery = tx
          .select()
          .from(schema.flightFareClassInventory)
          .where(
            and(
              eq(schema.flightFareClassInventory.flightId, row.flightId),
              eq(schema.flightFareClassInventory.fareClassId, row.fareClassId)
            )
          );
        const [existing] = await (apply
          ? existingQuery.for("update")
          : existingQuery);
        if (existing && existing.capacity !== row.capacity)
          throw new Error("Existing bucket conflicts with declared capacity");
        if (!existing) {
          const free =
            row.cabin === "economy"
              ? flight.economyAvailable
              : flight.businessAvailable;
          if (free !== row.expectedCabinAvailable)
            throw new Error("Cabin inventory changed; obtain a new allocation");
          if (apply)
            await tx.insert(schema.flightFareClassInventory).values({
              flightId: row.flightId,
              fareClassId: row.fareClassId,
              capacity: row.capacity,
              availableSeats: row.availableSeats,
            });
        }
        result.push({
          flightId: row.flightId,
          fareClassId: row.fareClassId,
          availableSeats: existing?.availableSeats ?? row.availableSeats,
          action: existing ? "unchanged" : apply ? "created" : "would_create",
        });
      }
      return {
        mode: apply ? "apply" : "preview",
        reference: plan.reference,
        digest,
        rows: result,
      };
    },
    apply
      ? { isolationLevel: "read committed" }
      : { isolationLevel: "repeatable read", accessMode: "read only" }
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const [path, option, ...extra] = process.argv.slice(2);
  if (
    !path ||
    extra.length ||
    (option !== undefined && !/^--apply=[a-f0-9]{64}$/.test(option))
  )
    throw new Error(
      "Usage: provision-rbd <allocation.json> [--apply=<preview digest>]"
    );
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  const input = JSON.parse(await readFile(path, "utf8"));
  const connection = await createConnection(url);
  try {
    console.info(
      JSON.stringify(
        await provisionRbd(
          drizzle(connection, { schema, mode: "default" }),
          input,
          option?.slice(8)
        ),
        null,
        2
      )
    );
  } finally {
    await connection.end();
  }
}
