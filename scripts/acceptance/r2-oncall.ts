import assert from "node:assert/strict";
import { and, eq } from "drizzle-orm";
import { alertDispatches, operationsAlerts } from "../../drizzle/schema";
import type { SettlementTx } from "../../server/services/booking-settlement.service";
import {
  deliverDispatch,
  queueAlertClose,
  queueAlertRaise,
} from "../../server/services/on-call.service";
import type { OnCallProvider } from "../../server/integrations/on-call";

/** R2-09 acceptance against real MySQL.
 *
 * Establishes what the in-memory boundary double cannot: the identity index
 * that stops a duplicate dispatch, row locks fencing two workers racing for
 * one page, and an alert transition rolling back together with its dispatch.
 * **No request reaches an on-call provider**; every send here is a local
 * double, and nothing in this file pages a person.
 */
export async function verifyR2OnCall(
  db: SettlementTx,
  seed: number,
  check: (name: string, run: () => Promise<void>) => Promise<void>
) {
  const key = `r2-oncall-${seed}`;
  const sandbox = { mode: "sandbox" as const, reference: "sandbox:acceptance" };

  function provider(
    behaviour: (attempt: number) => void = () => {}
  ): OnCallProvider & { sent: string[] } {
    const sent: string[] = [];
    let attempt = 0;
    return {
      mode: "sandbox",
      reference: "sandbox:acceptance",
      dedupes: true,
      sent,
      async send(dispatch) {
        attempt += 1;
        behaviour(attempt);
        sent.push(`${dispatch.action}:${dispatch.dedupKey}`);
      },
    };
  }

  await check(
    "R2 on-call: an alert transition and its page commit or roll back together",
    async () => {
      await assert.rejects(
        db.transaction(async tx => {
          await tx
            .insert(operationsAlerts)
            .values({ key, status: "active", message: "R2 on-call fixture" });
          await queueAlertRaise(
            tx,
            { alertKey: key, summary: "R2 on-call fixture" },
            sandbox
          );
          throw new Error("rollback");
        }),
        /rollback/
      );
      // Neither half survives: an alert can never be active with no page, and
      // a rolled-back transition leaves no page behind.
      assert.equal(
        (
          await db
            .select()
            .from(operationsAlerts)
            .where(eq(operationsAlerts.key, key))
        ).length,
        0
      );
      assert.equal(
        (
          await db
            .select()
            .from(alertDispatches)
            .where(eq(alertDispatches.alertKey, key))
        ).length,
        0
      );
    }
  );

  let dispatchId = 0;
  let dedupKey = "";
  await check(
    "R2 on-call: a raise is queued once and the identity index refuses a repeat",
    async () => {
      const queued = await db.transaction(async tx => {
        await tx
          .insert(operationsAlerts)
          .values({ key, status: "active", message: "R2 on-call fixture" });
        return await queueAlertRaise(
          tx,
          { alertKey: key, summary: "R2 on-call fixture" },
          sandbox
        );
      });
      assert(queued);
      dedupKey = queued.dedupKey;
      const [row] = await db
        .select()
        .from(alertDispatches)
        .where(eq(alertDispatches.alertKey, key));
      dispatchId = row.id;
      assert.equal(row.status, "pending");
      assert.equal(row.attempts, 0);
      assert.equal(row.providerReference, "sandbox:acceptance");

      // The index is the backstop behind every queue path: one incident can
      // never hold two pages of the same action.
      await assert.rejects(
        db.insert(alertDispatches).values({
          alertKey: key,
          action: "raise",
          dedupKey,
          summary: "duplicate",
          providerMode: "sandbox",
          providerReference: "sandbox:acceptance",
        }),
        (error: unknown) => {
          const cause = (error as { cause?: { code?: string } }).cause;
          assert.equal(cause?.code, "ER_DUP_ENTRY");
          return true;
        }
      );
    }
  );

  await check(
    "R2 on-call: two concurrent workers deliver one page exactly once",
    async () => {
      const first = provider();
      const second = provider();
      const now = new Date(Date.now() + 1000);
      const results = await Promise.all([
        deliverDispatch(db, dispatchId, first, now),
        deliverDispatch(db, dispatchId, second, now),
      ]);
      // One wins the lease; the other finds the row claimed and stands down.
      assert.equal(results.filter(r => r === "delivered").length, 1);
      assert.equal(results.filter(r => r === "skipped").length, 1);
      assert.equal(first.sent.length + second.sent.length, 1);

      const [row] = await db
        .select()
        .from(alertDispatches)
        .where(eq(alertDispatches.id, dispatchId));
      assert.equal(row.status, "delivered");
      assert.equal(row.attempts, 1);
      assert.equal(row.leaseToken, null);
      assert.notEqual(row.deliveredAt, null);
    }
  );

  await check(
    "R2 on-call: a failed send earns a backoff rather than a per-minute retry",
    async () => {
      const raised = await db.transaction(tx =>
        queueAlertRaise(
          tx,
          { alertKey: `${key}-fail`, summary: "R2 on-call failing fixture" },
          sandbox
        )
      );
      assert(raised);
      const [row] = await db
        .select()
        .from(alertDispatches)
        .where(eq(alertDispatches.alertKey, `${key}-fail`));
      const now = new Date(Date.now() + 1000);
      const failing = provider(() => {
        throw new Error("provider unreachable");
      });
      assert.equal(await deliverDispatch(db, row.id, failing, now), "retry");
      const [after] = await db
        .select()
        .from(alertDispatches)
        .where(eq(alertDispatches.id, row.id));
      assert.equal(after.status, "pending");
      assert.equal(after.lastError, "provider unreachable");
      assert(after.nextAttemptAt && after.nextAttemptAt > now);
      // The same tick must not pick it up again.
      assert.equal(await deliverDispatch(db, row.id, failing, now), "skipped");
    }
  );

  await check(
    "R2 on-call: acknowledging closes the incident the page opened",
    async () => {
      const closed = await db.transaction(tx =>
        queueAlertClose(tx, key, sandbox)
      );
      assert(closed);
      // The close carries the raise's key, which is what lets the provider
      // match it to the incident rather than opening a new one.
      assert.equal(closed.dedupKey, dedupKey);
      const [close] = await db
        .select()
        .from(alertDispatches)
        .where(
          and(
            eq(alertDispatches.alertKey, key),
            eq(alertDispatches.action, "close")
          )
        );
      assert.equal(close.status, "pending");
      assert.match(close.summary, /^Resolved: /);

      const closer = provider();
      assert.equal(
        await deliverDispatch(
          db,
          close.id,
          closer,
          new Date(Date.now() + 1000)
        ),
        "delivered"
      );
      assert.deepEqual(closer.sent, [`close:${dedupKey}`]);
    }
  );

  await check(
    "R2 on-call: an unconfigured provider pages nobody and fabricates no receipt",
    async () => {
      const queued = await db.transaction(tx =>
        queueAlertRaise(
          tx,
          { alertKey: `${key}-unconfigured`, summary: "no provider" },
          null
        )
      );
      assert.equal(queued, null);
      assert.equal(
        (
          await db
            .select()
            .from(alertDispatches)
            .where(eq(alertDispatches.alertKey, `${key}-unconfigured`))
        ).length,
        0
      );
    }
  );

  await check(
    "R2 on-call: close waits for an in-flight raise across competing workers",
    async () => {
      const incident = `${key}-ordered`;
      await db.transaction(tx =>
        queueAlertRaise(tx, { alertKey: incident, summary: "ordered" }, sandbox)
      );
      const [raise] = await db
        .select()
        .from(alertDispatches)
        .where(eq(alertDispatches.alertKey, incident));
      const started = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      const actions: string[] = [];
      const target: OnCallProvider = {
        ...sandbox,
        dedupes: true,
        async send(dispatch) {
          actions.push(`${dispatch.action}:start`);
          if (dispatch.action === "raise") {
            started.resolve();
            await release.promise;
          }
          actions.push(`${dispatch.action}:end`);
        },
      };
      const now = new Date(Date.now() + 1000);
      const sending = deliverDispatch(db, raise.id, target, now);
      await Promise.race([
        started.promise,
        sending.then(() => {
          throw new Error("raise never started");
        }),
      ]);
      try {
        // Two closers share the same raise lock, so insertion is also idempotent.
        await Promise.all(
          [0, 1].map(() =>
            db.transaction(tx => queueAlertClose(tx, incident, sandbox))
          )
        );
        const rows = await db
          .select()
          .from(alertDispatches)
          .where(eq(alertDispatches.alertKey, incident));
        const closes = rows.filter(row => row.action === "close");
        assert.equal(closes.length, 1);
        assert.equal(
          await deliverDispatch(db, closes[0].id, target, now),
          "skipped"
        );
        assert.deepEqual(actions, ["raise:start"]);
        release.resolve();
        assert.equal(await sending, "delivered");
        assert.equal(
          await deliverDispatch(db, closes[0].id, target, now),
          "delivered"
        );
        assert.deepEqual(actions, [
          "raise:start",
          "raise:end",
          "close:start",
          "close:end",
        ]);
      } finally {
        release.resolve();
        await sending;
      }
    }
  );

  await check(
    "R2 on-call: a lost response followed by close cannot resurrect an incident",
    async () => {
      const incident = `${key}-lost`;
      await db.transaction(tx =>
        queueAlertRaise(tx, { alertKey: incident, summary: "lost" }, sandbox)
      );
      const [raise] = await db
        .select()
        .from(alertDispatches)
        .where(eq(alertDispatches.alertKey, incident));
      let open = false;
      let raised = 0;
      const target: OnCallProvider = {
        ...sandbox,
        dedupes: true,
        async send(dispatch) {
          if (dispatch.action === "close") {
            open = false;
            return;
          }
          if (!open) {
            open = true;
            raised++;
          }
          throw new Error("accepted then response lost");
        },
      };
      const now = new Date(Date.now() + 1000);
      assert.equal(await deliverDispatch(db, raise.id, target, now), "retry");
      await db.transaction(tx => queueAlertClose(tx, incident, sandbox));
      const [close] = await db
        .select()
        .from(alertDispatches)
        .where(
          and(
            eq(alertDispatches.alertKey, incident),
            eq(alertDispatches.action, "close")
          )
        );
      assert.equal(
        await deliverDispatch(db, close.id, target, now),
        "delivered"
      );
      assert.equal(
        await deliverDispatch(
          db,
          raise.id,
          target,
          new Date(now.getTime() + 180_000)
        ),
        "skipped"
      );
      assert.equal(open, false);
      assert.equal(raised, 1);
      const [after] = await db
        .select()
        .from(alertDispatches)
        .where(eq(alertDispatches.id, raise.id));
      assert.equal(after.status, "cancelled");
      assert.equal(after.deliveredAt, null);
    }
  );

  await check(
    "R2 on-call: changed target is blocked before sending or consuming an attempt",
    async () => {
      const incident = `${key}-target`;
      await db.transaction(tx =>
        queueAlertRaise(tx, { alertKey: incident, summary: "target" }, sandbox)
      );
      const [raise] = await db
        .select()
        .from(alertDispatches)
        .where(eq(alertDispatches.alertKey, incident));
      const changed = { ...provider(), reference: "different-target" };
      assert.equal(
        await deliverDispatch(
          db,
          raise.id,
          changed,
          new Date(Date.now() + 1000)
        ),
        "failed"
      );
      assert.equal(changed.sent.length, 0);
      const [after] = await db
        .select()
        .from(alertDispatches)
        .where(eq(alertDispatches.id, raise.id));
      assert.equal(after.attempts, 0);
      assert.equal(after.leaseToken, null);
    }
  );
}
