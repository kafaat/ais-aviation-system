import assert from "node:assert/strict";
import { createConnection } from "mysql2/promise";
import { eq, inArray } from "drizzle-orm";
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
  await check(
    "loyalty audit accepts debt and removed contributors, detects ledger and lot corruption without writes",
    async () => {
      const ids = [0, 1, 2, 3].map(n => ownerId + 700 + n);
      const [personal, debt, expired, pending] = ids;
      const groupId = personal;
      const transactionIds = Array.from({ length: 10 }, (_, n) => personal + n);
      const future = new Date("2035-01-01T00:00:00Z");
      const past = new Date("2000-01-01T00:00:00Z");
      const connection = await createConnection(process.env.DATABASE_URL!);
      const snapshot = () =>
        Promise.all([
          db
            .select()
            .from(schema.loyaltyAccounts)
            .where(inArray(schema.loyaltyAccounts.id, ids)),
          db
            .select()
            .from(schema.milesTransactions)
            .where(inArray(schema.milesTransactions.id, transactionIds)),
          db
            .select()
            .from(schema.loyaltyCreditLots)
            .where(
              inArray(schema.loyaltyCreditLots.transactionId, transactionIds)
            ),
          db
            .select()
            .from(schema.familyGroups)
            .where(eq(schema.familyGroups.id, groupId)),
          db
            .select()
            .from(schema.familyGroupMembers)
            .where(eq(schema.familyGroupMembers.groupId, groupId)),
        ]);
      const ledger = (
        id: number,
        accountId: number,
        type: typeof schema.milesTransactions.$inferInsert.type,
        amount: number,
        balanceAfter: number,
        extra: Partial<typeof schema.milesTransactions.$inferInsert> = {}
      ) => ({
        id,
        userId: accountId,
        loyaltyAccountId: accountId,
        type,
        amount,
        balanceAfter,
        description: "PRIVATE synthetic loyalty evidence",
        ...extra,
      });
      try {
        await db
          .insert(schema.users)
          .values(ids.map(id => ({ id, openId: `data-audit-loyalty-${id}` })));
        await db.insert(schema.loyaltyAccounts).values(
          ids.map((id, index) => ({
            id,
            userId: id,
            currentMilesBalance: [60, -20, 0, 100][index],
            creditLotsInitializedAt: id === pending ? null : new Date(),
          }))
        );
        await db.insert(schema.milesTransactions).values([
          ledger(personal, personal, "earn", 100, 100, { expiresAt: future }),
          ledger(personal + 1, personal, "adjustment", -40, 60, {
            reason: `family-pool:${groupId}`,
          }),
          ledger(personal + 2, debt, "earn", 100, 100, {
            bookingId: ownerId,
            expiresAt: future,
          }),
          ledger(personal + 3, debt, "redeem", -100, 0),
          ledger(personal + 4, debt, "adjustment", -20, -20, {
            bookingId: ownerId,
          }),
          ledger(personal + 5, expired, "earn", 100, 100, {
            bookingId: ownerId,
            expiresAt: past,
          }),
          ledger(personal + 6, expired, "expire", -100, 0),
          // A refund of already expired credit records a legitimate zero balance delta.
          ledger(personal + 7, expired, "adjustment", 0, 0, {
            bookingId: ownerId,
          }),
          ledger(personal + 8, pending, "bonus", 100, 100, {
            expiresAt: future,
          }),
        ]);
        await db.insert(schema.loyaltyCreditLots).values([
          {
            transactionId: personal,
            loyaltyAccountId: personal,
            creditedMiles: 100,
            remainingMiles: 60,
            spentMiles: 40,
            expiresAt: future,
          },
          {
            transactionId: personal + 2,
            loyaltyAccountId: debt,
            bookingId: ownerId,
            creditedMiles: 100,
            remainingMiles: 0,
            spentMiles: 80,
            reversedMiles: 20,
            expiresAt: future,
          },
          {
            transactionId: personal + 5,
            loyaltyAccountId: expired,
            bookingId: ownerId,
            creditedMiles: 100,
            remainingMiles: 0,
            reversedMiles: 100,
            expiresAt: past,
          },
        ]);
        await db.insert(schema.familyGroups).values({
          id: groupId,
          ownerId: personal,
          name: "PRIVATE synthetic family",
          pooledMiles: 40,
        });
        await db.insert(schema.familyGroupMembers).values([
          {
            id: personal,
            groupId,
            userId: personal,
            milesContributed: 15,
            status: "removed",
          },
          {
            id: personal + 1,
            groupId,
            userId: personal,
            milesContributed: 25,
            status: "active",
          },
        ]);
        const expected: Record<string, number> = {
          loyalty_credit_adoption_pending: pending,
          loyalty_account_missing_owner: personal,
          loyalty_ledger_owner_mismatch: personal,
          loyalty_ledger_transition_mismatch: personal,
          loyalty_ledger_balance_mismatch: personal,
          loyalty_credit_lot_conservation_mismatch: personal,
          loyalty_credit_lot_identity_mismatch: personal,
          loyalty_initialized_credit_missing_lot: personal + 2,
          loyalty_available_credit_mismatch: personal,
          loyalty_uninitialized_account_has_lots: pending,
          family_pool_balance_mismatch: groupId,
          family_contribution_ledger_mismatch: groupId,
          family_transfer_missing_membership: personal + 9,
          inactive_family_retains_miles: groupId,
        };
        const before = await snapshot();
        const baseline = await inspectForensicData(connection, 200);
        assert.equal(
          baseline.findings.some(f => f.error),
          false
        );
        for (const [finding, recordId] of Object.entries(expected)) {
          const result = baseline.findings.find(f => f.id === finding);
          assert(result);
          // Only the clean legacy account needs adoption; debt and expired refunds pass.
          assert.deepEqual(
            result.recordIds.filter(id => transactionIds.includes(Number(id))),
            finding === "loyalty_credit_adoption_pending" ? [recordId] : [],
            finding
          );
        }
        assert.deepEqual(await snapshot(), before);

        // The aggregate remains 60: corrupting only the first balance must still be found.
        await db
          .update(schema.milesTransactions)
          .set({ balanceAfter: 101 })
          .where(eq(schema.milesTransactions.id, personal));
        const transition = await inspectForensicData(connection, 200);
        assert(
          transition.findings
            .find(f => f.id === "loyalty_ledger_transition_mismatch")!
            .recordIds.includes(personal)
        );
        assert(
          !transition.findings
            .find(f => f.id === "loyalty_ledger_balance_mismatch")!
            .recordIds.includes(personal)
        );

        await db
          .update(schema.loyaltyAccounts)
          .set({ userId: 999999998, currentMilesBalance: 62 })
          .where(eq(schema.loyaltyAccounts.id, personal));
        await db
          .update(schema.loyaltyCreditLots)
          .set({ creditedMiles: 101 })
          .where(eq(schema.loyaltyCreditLots.transactionId, personal));
        await db
          .delete(schema.loyaltyCreditLots)
          .where(eq(schema.loyaltyCreditLots.transactionId, personal + 2));
        await db.insert(schema.loyaltyCreditLots).values({
          transactionId: personal + 8,
          loyaltyAccountId: pending,
          creditedMiles: 100,
          remainingMiles: 100,
          expiresAt: future,
        });
        await db
          .update(schema.familyGroups)
          .set({ pooledMiles: 42, status: "inactive" })
          .where(eq(schema.familyGroups.id, groupId));
        await db
          .update(schema.familyGroupMembers)
          .set({ milesContributed: 26 })
          .where(eq(schema.familyGroupMembers.id, personal + 1));
        await db.insert(schema.milesTransactions).values(
          ledger(personal + 9, personal, "adjustment", -1, 59, {
            reason: "family-pool:999999999",
          })
        );
        const corrupt = await snapshot();
        const report = await inspectForensicData(connection, 200);
        assert.equal(report.status, "review_required");
        assert.equal(
          report.findings.some(f => f.error),
          false
        );
        for (const [finding, recordId] of Object.entries(expected))
          assert(
            report.findings
              .find(f => f.id === finding)
              ?.recordIds.includes(recordId),
            finding
          );
        assert(!JSON.stringify(report).includes("PRIVATE"));
        assert.deepEqual(await snapshot(), corrupt);
      } finally {
        await connection.end();
        await db
          .delete(schema.familyGroupMembers)
          .where(eq(schema.familyGroupMembers.groupId, groupId));
        await db
          .delete(schema.familyGroups)
          .where(eq(schema.familyGroups.id, groupId));
        await db
          .delete(schema.loyaltyCreditLots)
          .where(
            inArray(schema.loyaltyCreditLots.transactionId, transactionIds)
          );
        await db
          .delete(schema.milesTransactions)
          .where(inArray(schema.milesTransactions.id, transactionIds));
        await db
          .delete(schema.loyaltyAccounts)
          .where(inArray(schema.loyaltyAccounts.id, ids));
        await db.delete(schema.users).where(inArray(schema.users.id, ids));
      }
    }
  );
}
