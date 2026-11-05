import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { and, eq } from "drizzle-orm";
import type { RowDataPacket } from "mysql2/promise";
import {
  agentBookings,
  financialLedger,
  travelAgents,
} from "../../drizzle/schema";
import { bspEvidenceFiles } from "../../drizzle/operations-schema";
import {
  inboundBspEvidence,
  type Bank,
  type Hot,
} from "../../shared/bsp-local-evidence";
import type { TrpcContext } from "../../server/_core/context";
import { getPool } from "../../server/db";
import { bspReportingRouter } from "../../server/routers/bsp-reporting";
import type { SettlementTx } from "../../server/services/booking-settlement.service";

export async function verifyBspLocalEvidence(
  db: SettlementTx,
  ctx: TrpcContext,
  bookingId: number
) {
  assert(ctx.user && ctx.tenantId);
  const tenantId = ctx.tenantId;
  const finance = bspReportingRouter.createCaller({
    ...ctx,
    user: { ...ctx.user, role: "finance" },
  });
  const other = bspReportingRouter.createCaller({
    ...ctx,
    tenantId: tenantId + 1,
    user: { ...ctx.user, tenantId: tenantId + 1, role: "finance" },
  });
  const day = "2020-01-05";
  const [agent] = await db.insert(travelAgents).values({
    agencyName: "BSP synthetic agency",
    iataNumber: "FIX-BSP-LOCAL",
    contactName: "Synthetic",
    email: "bsp@fixture.invalid",
    phone: "000",
    apiKey: "local-bsp-test",
    apiSecret: "fixture-only",
  });
  await db.insert(agentBookings).values({
    agentId: agent.insertId,
    bookingId,
    commissionRate: "0",
    commissionAmount: 0,
    bookingAmount: 1500,
  });
  await db.insert(financialLedger).values([
    {
      bookingId,
      type: "charge",
      amount: "15.00",
      transactionDate: new Date(day + "T04:00:00Z"),
    },
    {
      bookingId,
      type: "partial_refund",
      amount: "10.00",
      transactionDate: new Date(day + "T05:00:00Z"),
    },
  ]);
  const [draft, replay] = await Promise.all([
    finance.stageDailyRet({ day }),
    finance.stageDailyRet({ day }),
  ]);
  assert.deepEqual(draft, replay);
  assert.equal(draft.draft.lines.length, 2);
  const hot = {
    ...draft.draft,
    direction: "inbound_hot" as const,
    settlementReference: "TEST-BSP-1",
    transferMinor: 500,
  };
  const bank = {
    profile: hot.profile,
    tenantId,
    day,
    currency: hot.currency,
    direction: "inbound_bank" as const,
    settlementReference: hot.settlementReference,
    statementLineId: "TEST-BANK-1",
    transferMinor: 500,
  };
  await assert.rejects(other.importEvidence(hot), { code: "FORBIDDEN" });
  const h = await finance.importEvidence(hot);
  assert.deepEqual(await finance.importEvidence(hot), h);
  await assert.rejects(finance.importEvidence({ ...hot, transferMinor: 501 }), {
    code: "CONFLICT",
  });
  await finance.importEvidence(bank);
  const request = {
    day,
    settlementReference: hot.settlementReference,
    statementLineId: bank.statementLineId,
  };
  assert.deepEqual(await finance.reconcileEvidence(request), {
    basis: "local_evidence_only",
    matches: true,
    retMatchesLedger: true,
    hotMatchesRet: true,
    bankMatchesHot: true,
    netMinor: 500,
    differingLedgerIds: [],
  });

  // An AFTER INSERT gate keeps the first immutable identity uncommitted while
  // the competing import really waits on InnoDB's unique-key lock. No query,
  // receipt, digest or transaction result is replaced by a test double.
  assert.equal(process.env.AIS_DISPOSABLE_DATABASE, "true");
  assert(
    /\/[a-z0-9_]+_test$/i.test(new URL(process.env.DATABASE_URL!).pathname),
    "Native BSP barriers require a disposable _test database"
  );
  const pool = getPool();
  assert(pool);
  const concurrentImports: Array<{
    kind: "hot_input" | "bank_input";
    changedContent: boolean;
    reference: string;
    nativeUniqueLockWaitObserved: true;
    blockingTransaction: string;
    waitingTransaction: string;
  }> = [];
  for (const kind of ["hot_input", "bank_input"] as const) {
    for (const changedContent of [false, true]) {
      const token = randomUUID().replaceAll("-", "");
      const reference = `RACE-${token.toUpperCase()}`;
      const trigger = `bsp_import_race_${token}`;
      const lockName = `bsp-import-${token}`;
      const first: Hot | Bank =
        kind === "hot_input"
          ? { ...hot, settlementReference: reference }
          : { ...bank, statementLineId: reference };
      const second = changedContent
        ? { ...first, transferMinor: first.transferMinor + 1 }
        : { ...first };
      const control = await pool.getConnection();
      const pending: Array<ReturnType<typeof finance.importEvidence>> = [];
      let created = false;
      async function waitFor<T>(
        read: () => Promise<T | undefined>,
        description: string
      ): Promise<T> {
        const deadline = Date.now() + 5000;
        do {
          const result = await read();
          if (result !== undefined) return result;
          await delay(10);
        } while (Date.now() < deadline);
        throw new Error(`BSP native barrier did not observe ${description}`);
      }
      try {
        const [locked] = await control.query<RowDataPacket[]>(
          "SELECT GET_LOCK(?, 0) AS acquired",
          [lockName]
        );
        assert.equal(Number(locked[0].acquired), 1);
        await control.query(`CREATE TRIGGER \`${trigger}\`
          AFTER INSERT ON bsp_evidence_files FOR EACH ROW
          BEGIN
            IF NEW.tenant_id = ${tenantId}
              AND NEW.kind = ${control.escape(kind)}
              AND NEW.reference = ${control.escape(reference)} THEN
              IF GET_LOCK(${control.escape(lockName)}, 10) <> 1 THEN
                SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'BSP acceptance barrier timed out';
              END IF;
              DO RELEASE_LOCK(${control.escape(lockName)});
            END IF;
          END`);
        created = true;
        pending.push(finance.importEvidence(first));
        void pending[0].catch(() => {});
        const ownerConnection = await waitFor(async () => {
          const [rows] = await control.query<RowDataPacket[]>(
            `SELECT t.PROCESSLIST_ID AS connectionId
             FROM performance_schema.metadata_locks l
             INNER JOIN performance_schema.threads t
               ON t.THREAD_ID = l.OWNER_THREAD_ID
             WHERE l.OBJECT_TYPE = 'USER LEVEL LOCK' AND l.OBJECT_NAME = ?
               AND l.LOCK_STATUS = 'PENDING'`,
            [lockName]
          );
          return rows[0] ? Number(rows[0].connectionId) : undefined;
        }, "the first import paused inside its native INSERT trigger");
        pending.push(finance.importEvidence(second));
        void pending[1].catch(() => {});
        // Bind the lock to the fresh immutable reference, not stored-trigger
        // thread attribution. The first connection must still hold its gate.
        const nativeWait = await waitFor(async () => {
          const [rows] = await control.query<RowDataPacket[]>(
            `SELECT w.BLOCKING_ENGINE_TRANSACTION_ID AS blockingTransaction,
                    w.REQUESTING_ENGINE_TRANSACTION_ID AS waitingTransaction,
                    b.LOCK_DATA AS recordKey
             FROM performance_schema.data_lock_waits w
             INNER JOIN performance_schema.data_locks b
               ON b.ENGINE_LOCK_ID = w.BLOCKING_ENGINE_LOCK_ID
             WHERE w.REQUESTING_ENGINE_TRANSACTION_ID <> w.BLOCKING_ENGINE_TRANSACTION_ID
               AND b.OBJECT_SCHEMA = DATABASE()
               AND b.OBJECT_NAME = 'bsp_evidence_files'
               AND b.INDEX_NAME = 'bsp_evidence_identity'
               AND LOCATE(?, b.LOCK_DATA) > 0`,
            [reference]
          );
          return rows[0];
        }, "the competing import waiting on this uncommitted unique identity");
        const [gated] = await control.query<RowDataPacket[]>(
          "SELECT STATE AS state FROM information_schema.PROCESSLIST WHERE ID = ?",
          [ownerConnection]
        );
        assert.equal(gated[0]?.state, "User lock");
        await control.query("SELECT RELEASE_LOCK(?)", [lockName]);
        const [winner, contender] = await Promise.allSettled(pending);
        assert.equal(winner.status, "fulfilled");
        if (changedContent) {
          assert.equal(contender.status, "rejected");
          if (contender.status === "rejected")
            assert.equal(contender.reason.code, "CONFLICT");
        } else {
          assert.equal(contender.status, "fulfilled");
          if (contender.status === "fulfilled")
            assert.deepEqual(contender.value, winner.value);
        }
        const stored = await db
          .select()
          .from(bspEvidenceFiles)
          .where(
            and(
              eq(bspEvidenceFiles.tenantId, tenantId),
              eq(bspEvidenceFiles.kind, kind),
              eq(bspEvidenceFiles.reference, reference)
            )
          );
        assert.equal(stored.length, 1);
        assert.deepEqual(stored[0].content, first);
        assert.equal(stored[0].recordedBy, ctx.user.id);
        assert.equal(stored[0].digest, winner.value.digest);
        assert.equal(
          stored[0].digest,
          createHash("sha256")
            .update(JSON.stringify(inboundBspEvidence.parse(first)))
            .digest("hex")
        );
        assert.deepEqual(await finance.importEvidence(first), winner.value);
        if (changedContent)
          await assert.rejects(finance.importEvidence(second), {
            code: "CONFLICT",
          });
        assert.deepEqual(
          await db
            .select()
            .from(bspEvidenceFiles)
            .where(eq(bspEvidenceFiles.id, stored[0].id)),
          stored,
          "Replay and conflict must preserve the first receipt and its content"
        );
        concurrentImports.push({
          kind,
          changedContent,
          reference,
          nativeUniqueLockWaitObserved: true,
          blockingTransaction: String(nativeWait.blockingTransaction),
          waitingTransaction: String(nativeWait.waitingTransaction),
        });
      } finally {
        try {
          await control.query("SELECT RELEASE_LOCK(?)", [lockName]);
          await Promise.allSettled(pending);
          if (created) await control.query(`DROP TRIGGER \`${trigger}\``);
        } finally {
          control.release();
        }
      }
    }
  }
  await db.insert(financialLedger).values({
    bookingId,
    type: "refund",
    amount: "1.00",
    transactionDate: new Date(day + "T06:00:00Z"),
  });
  assert.equal(
    (await finance.reconcileEvidence(request)).retMatchesLedger,
    false
  );
  await assert.rejects(finance.stageDailyRet({ day }), { code: "CONFLICT" });
  return {
    localRetHotBankMatched: true,
    changedReplayRejected: true,
    latePostingDetected: true,
    concurrentImports,
    outboundRequests: 0,
  };
}
