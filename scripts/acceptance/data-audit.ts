import assert from "node:assert/strict";
import { createConnection } from "mysql2/promise";
import { eq } from "drizzle-orm";
import * as schema from "../../drizzle/schema";
import { inspectForensicData } from "../ci/forensic-data-audit";
import type { SettlementTx } from "../../server/services/booking-settlement.service";

/** Called only after the disposable database guard and fixtures have run. */
export async function verifyDataAudit(
  db: SettlementTx,
  ownerId: number,
  check: (name: string, run: () => Promise<void>) => Promise<void>
) {
  await check(
    "forensic audit counts corrupt identities without writes or passenger disclosure",
    async () => {
      await db.insert(schema.bookings).values(
        [0, 1].map(n => ({
          id: ownerId + 200 + n,
          userId: n ? 999999999 : 0,
          flightId: ownerId,
          bookingReference: `CIDA0${n}`,
          pnr: `CIDA0${n}`,
          totalAmount: 100,
          cabinClass: "economy" as const,
          numberOfPassengers: 1,
        }))
      );
      const before = await db.select().from(schema.bookings);
      const connection = await createConnection(process.env.DATABASE_URL!);
      const query = connection.query.bind(connection);
      let enforced = false;
      connection.query = (async (sql: string) => {
        const result = await query(sql);
        if (sql === "START TRANSACTION READ ONLY") {
          await assert.rejects(
            query(
              "UPDATE bookings SET totalAmount = totalAmount + 1 WHERE id = ?",
              [ownerId]
            ),
            { code: "ER_CANT_EXECUTE_IN_READ_ONLY_TRANSACTION" }
          );
          enforced = true;
        }
        return result;
      }) as typeof connection.query;
      try {
        const report = await inspectForensicData(connection, 1);
        assert(enforced);
        assert.equal(report.status, "review_required");
        assert(report.findings.every(f => f.error === null));
        const missing = report.findings.find(
          f => f.id === "booking_missing_owner"
        )!;
        assert.equal(missing.count, 2);
        assert.equal(missing.recordIds.length, 1);
        assert.equal(missing.truncated, true);
        assert(!JSON.stringify(report).includes("Synthetic"));
        assert(!JSON.stringify(report).includes("CI123456"));
        assert.deepEqual(await db.select().from(schema.bookings), before);
      } finally {
        await connection.end();
      }
      // Keep downstream backup fixtures free of intentionally corrupt identities.
      for (const n of [0, 1])
        await db
          .delete(schema.bookings)
          .where(eq(schema.bookings.id, ownerId + 200 + n));
    }
  );
}
