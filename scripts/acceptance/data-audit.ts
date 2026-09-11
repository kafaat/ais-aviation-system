import assert from "node:assert/strict";
import { createConnection } from "mysql2/promise";
import { eq } from "drizzle-orm";
import * as schema from "../../drizzle/schema";
import {
  forensicFindings,
  inspectForensicData,
} from "../ci/forensic-data-audit";
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
      const queryFailures: Array<{ finding: string; code: string }> = [];
      let enforced = false;
      connection.query = (async (sql: string) => {
        let result;
        try {
          result = await query(sql);
        } catch (error) {
          // Only fixture diagnostics: never log SQL, driver messages or values.
          const code = (error as { code?: unknown }).code;
          queryFailures.push({
            finding:
              forensicFindings.find(f => sql.includes(f.sql))?.id ?? "setup",
            code:
              typeof code === "string" && /^ER_[A-Z0-9_]+$/.test(code)
                ? code
                : "QUERY_FAILED",
          });
          throw error;
        }
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
      const [queuedItem] = await db
        .select()
        .from(schema.bookingRefundItems)
        .where(eq(schema.bookingRefundItems.status, "queued"))
        .limit(1);
      assert(queuedItem);
      const [plan] = await db
        .select()
        .from(schema.bookingRefundPlans)
        .where(eq(schema.bookingRefundPlans.bookingId, queuedItem.bookingId));
      assert(plan);
      try {
        const baseline = await inspectForensicData(connection, 1);
        assert.deepEqual(queryFailures, []);
        assert.equal(
          baseline.findings.find(
            f => f.id === "split_refund_allocation_mismatch"
          )!.count,
          0
        );
        await db
          .update(schema.bookingRefundPlans)
          .set({ refundAmount: plan.refundAmount + 1 })
          .where(eq(schema.bookingRefundPlans.bookingId, plan.bookingId));
        await db
          .update(schema.bookingRefundItems)
          .set({ nextAttemptAt: new Date(Date.now() - 16 * 60_000) })
          .where(eq(schema.bookingRefundItems.id, queuedItem.id));
        const plansBefore = await db.select().from(schema.bookingRefundPlans);
        const itemsBefore = await db.select().from(schema.bookingRefundItems);
        const report = await inspectForensicData(connection, 1);
        assert(enforced);
        assert.deepEqual(queryFailures, []);
        assert.deepEqual(
          report.findings.filter(f => f.error !== null).map(f => f.id),
          []
        );
        assert.equal(report.status, "review_required");
        const missing = report.findings.find(
          f => f.id === "booking_missing_owner"
        )!;
        assert.equal(missing.count, 2);
        assert.equal(missing.recordIds.length, 1);
        assert.equal(missing.truncated, true);
        const allocation = report.findings.find(
          f => f.id === "split_refund_allocation_mismatch"
        )!;
        assert.equal(allocation.count, 1);
        assert.deepEqual(allocation.recordIds, [plan.bookingId]);
        const overdue = report.findings.find(
          f => f.id === "split_refund_worker_overdue"
        )!;
        assert.equal(overdue.count, 1);
        assert.deepEqual(overdue.recordIds, [plan.bookingId]);
        assert(
          report.findings.find(f => f.id === "split_refund_under_review")!
            .count! >= 2
        );
        assert(!JSON.stringify(report).includes("Synthetic"));
        assert(!JSON.stringify(report).includes("CI123456"));
        assert.deepEqual(await db.select().from(schema.bookings), before);
        assert.deepEqual(
          await db.select().from(schema.bookingRefundPlans),
          plansBefore
        );
        assert.deepEqual(
          await db.select().from(schema.bookingRefundItems),
          itemsBefore
        );
      } finally {
        await connection.end();
        await db
          .update(schema.bookingRefundPlans)
          .set({ refundAmount: plan.refundAmount, updatedAt: plan.updatedAt })
          .where(eq(schema.bookingRefundPlans.bookingId, plan.bookingId));
        await db
          .update(schema.bookingRefundItems)
          .set({
            nextAttemptAt: queuedItem.nextAttemptAt,
            updatedAt: queuedItem.updatedAt,
          })
          .where(eq(schema.bookingRefundItems.id, queuedItem.id));
      }
      // Keep downstream backup fixtures free of intentionally corrupt identities.
      for (const n of [0, 1])
        await db
          .delete(schema.bookings)
          .where(eq(schema.bookings.id, ownerId + 200 + n));
    }
  );
}
