/** On-call delivery and acknowledgement (R2-09).
 *
 * Alert evaluation already existed and wrote `operations_alerts`. Nothing
 * carried an alert to a person. This queues a dispatch on each transition,
 * delivers it durably, and records acknowledgement — keeping three facts
 * separate that are easy to conflate:
 *
 *   1. The alert is active (evaluation said so).
 *   2. The provider accepted a page (delivery receipt). **Not** proof that a
 *      person was reached; nothing here can observe that.
 *   3. An operator acknowledged it in this system (`operations_alerts`).
 *
 * The delivery worker follows the same discipline as the hotel worker:
 * `outcome_unknown` is persisted before the request, a lease fences concurrent
 * workers, failures get an exponential backoff instead of a per-minute hot
 * loop, and the page is ordered oldest-attempt-first so rows that cannot
 * resolve never starve new ones.
 *
 * Lost responses are retried only for a deduplicating provider and while no
 * local closure has been requested. Remote closure or an unbounded delayed
 * request requires reconciliation; deduplication is not an exactly-once proof.
 */
import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { alertDispatches } from "../../drizzle/schema";
import {
  DELIVERY_LEASE_MS,
  MAX_DELIVERY_ATTEMPTS,
  deliveryBackoffMs,
  onCallDispatch,
  type OnCallAction,
  type OnCallDispatchStatus,
} from "../../shared/on-call";
import {
  configuredOnCallProvider,
  type OnCallProvider,
} from "../integrations/on-call";
import { getDb } from "../db";
import type { SettlementTx } from "./booking-settlement.service";

/** Bounded so one tick cannot fan out into an unbounded burst of pages. */
const WORKER_PAGE_SIZE = 25;

function dbRequired() {
  const db = getDb();
  if (!db) throw new Error("On-call database unavailable");
  return db;
}

/** Provider responses can quote the request, including its credential, so only
 * a bounded, non-echoing summary is ever stored. */
function redact(error: unknown): string {
  const message = error instanceof Error ? error.message : "Unknown error";
  return message.replace(/\s+/g, " ").slice(0, 500);
}

export interface QueueRaiseInput {
  alertKey: string;
  summary: string;
  details?: string;
}

/** Queues a page for a newly active alert.
 *
 * Called inside the evaluator's transaction, so an alert transition and its
 * dispatch commit together: an alert can never become active without a queued
 * page, and a rolled-back transition leaves no page behind.
 *
 * Returns null when no provider is configured. That is not a silent success —
 * the caller records nothing, and the dashboard shows an active alert with no
 * dispatch, which is the honest picture of a deployment that pages nobody.
 */
export async function queueAlertRaise(
  tx: SettlementTx,
  input: QueueRaiseInput,
  provider: Pick<OnCallProvider, "mode" | "reference"> | null
): Promise<{ dedupKey: string } | null> {
  if (!provider) return null;
  // One dedup key per incident. A fresh key per activation is what keeps a
  // re-activation after a resolve from being folded into the closed incident.
  const dedupKey = `${input.alertKey.slice(0, 63)}:${randomUUID()}`;
  const dispatch = onCallDispatch.parse({
    alertKey: input.alertKey,
    action: "raise" satisfies OnCallAction,
    dedupKey,
    summary: input.summary.slice(0, 200),
    details: (input.details ?? "").slice(0, 1000),
  });
  await tx.insert(alertDispatches).values({
    ...dispatch,
    status: "pending",
    nextAttemptAt: new Date(),
    providerMode: provider.mode,
    providerReference: provider.reference,
  });
  return { dedupKey };
}

/** Queues a close for the incident a raise opened.
 *
 * Reuses the raise's dedup key, which is how the provider matches the close to
 * the incident. Failed raises are included because an earlier send may have
 * been accepted despite a lost response. The raise row serializes closers.
 */
export async function queueAlertClose(
  tx: SettlementTx,
  alertKey: string,
  _provider: Pick<OnCallProvider, "mode" | "reference"> | null
): Promise<{ dedupKey: string } | null> {
  // Persist closure even while delivery is disabled; re-enabling a worker
  // must not resurrect the old raise. The original row owns the target.
  const [raise] = await tx
    .select()
    .from(alertDispatches)
    .where(
      and(
        eq(alertDispatches.alertKey, alertKey),
        eq(alertDispatches.action, "raise")
      )
    )
    .orderBy(sql`${alertDispatches.id} desc`)
    .limit(1)
    .for("update");
  if (!raise) return null;

  const [existing] = await tx
    .select({ id: alertDispatches.id })
    .from(alertDispatches)
    .where(
      and(
        eq(alertDispatches.alertKey, alertKey),
        eq(alertDispatches.action, "close"),
        eq(alertDispatches.dedupKey, raise.dedupKey)
      )
    )
    .limit(1);
  if (existing) return { dedupKey: raise.dedupKey };

  await tx.insert(alertDispatches).values({
    alertKey,
    action: "close",
    dedupKey: raise.dedupKey,
    summary: `Resolved: ${raise.summary}`.slice(0, 200),
    details: "",
    status: "pending",
    nextAttemptAt: new Date(),
    // Closure belongs to the original target even if configuration changed.
    providerMode: raise.providerMode,
    providerReference: raise.providerReference,
  });
  return { dedupKey: raise.dedupKey };
}

type ClaimOutcome =
  | { claimed: true; id: number; leaseToken: string }
  | { claimed: false; outcome?: "failed" };

/** Takes a fenced lease and persists `outcome_unknown` in the same
 * transaction, before anything is sent. A crash between here and the request
 * therefore leaves a row that says a send may have happened, which is the
 * truth, rather than a `pending` row that would look untouched. */
async function claim(
  tx: SettlementTx,
  id: number,
  now: Date,
  provider: OnCallProvider
): Promise<ClaimOutcome> {
  const [pointer] = await tx
    .select()
    .from(alertDispatches)
    .where(eq(alertDispatches.id, id));
  if (!pointer) return { claimed: false };
  // Every sender and queueAlertClose locks the raise first. The current read
  // under that lock includes a closure committed while this worker waited.
  const [raise] = await tx
    .select()
    .from(alertDispatches)
    .where(
      and(
        eq(alertDispatches.alertKey, pointer.alertKey),
        eq(alertDispatches.dedupKey, pointer.dedupKey),
        eq(alertDispatches.action, "raise")
      )
    )
    .for("update");
  if (!raise) return { claimed: false };
  const [close] = await tx
    .select()
    .from(alertDispatches)
    .where(
      and(
        eq(alertDispatches.alertKey, pointer.alertKey),
        eq(alertDispatches.dedupKey, pointer.dedupKey),
        eq(alertDispatches.action, "close")
      )
    )
    .for("update");
  const row = pointer.action === "raise" ? raise : close;
  if (!row) return { claimed: false };
  if (["delivered", "failed", "cancelled"].includes(row.status))
    return { claimed: false };
  if (
    [raise, close].some(
      entry => entry?.leaseUntil && entry.leaseUntil.getTime() > now.getTime()
    )
  )
    return { claimed: false };

  if (close && ["pending", "outcome_unknown"].includes(raise.status)) {
    await tx
      .update(alertDispatches)
      .set({
        status: "cancelled",
        nextAttemptAt: null,
        leaseToken: null,
        leaseUntil: null,
        updatedAt: now,
        lastError:
          "Closure requested; no further raise attempts. Earlier send may have been accepted.",
      })
      .where(eq(alertDispatches.id, raise.id));
    if (row.action === "raise") return { claimed: false };
  }

  const refusal =
    row.providerMode !== provider.mode ||
    row.providerReference !== provider.reference
      ? "On-call target changed; reconcile the original target before redelivery"
      : row.attempts >= MAX_DELIVERY_ATTEMPTS
        ? "Delivery attempt limit reached; reconcile the unknown outcome"
        : row.attempts > 0 && !provider.dedupes
          ? "On-call provider cannot be retried safely"
          : null;
  if (refusal) {
    await tx
      .update(alertDispatches)
      .set({
        status: "failed",
        lastError: refusal,
        nextAttemptAt: null,
        leaseToken: null,
        leaseUntil: null,
        updatedAt: now,
      })
      .where(eq(alertDispatches.id, id));
    return { claimed: false, outcome: "failed" };
  }
  if (row.nextAttemptAt && row.nextAttemptAt.getTime() > now.getTime())
    return { claimed: false };

  const leaseToken = randomUUID();
  await tx
    .update(alertDispatches)
    .set({
      status: "outcome_unknown",
      attempts: row.attempts + 1,
      leaseToken,
      leaseUntil: new Date(now.getTime() + DELIVERY_LEASE_MS),
      updatedAt: now,
    })
    .where(eq(alertDispatches.id, id));
  return { claimed: true, id, leaseToken };
}

/** Delivers one dispatch. The provider call sits between two transactions so a
 * hanging provider never holds a database transaction open. */
export async function deliverDispatch(
  db: SettlementTx,
  id: number,
  provider: OnCallProvider,
  now: Date = new Date()
): Promise<"delivered" | "retry" | "failed" | "skipped"> {
  const claimed = await db.transaction(tx => claim(tx, id, now, provider));
  if (!claimed.claimed) return claimed.outcome ?? "skipped";

  const [row] = await db
    .select()
    .from(alertDispatches)
    .where(eq(alertDispatches.id, id));
  if (!row) return "skipped";

  try {
    await provider.send(
      onCallDispatch.parse({
        alertKey: row.alertKey,
        action: row.action,
        dedupKey: row.dedupKey,
        summary: row.summary,
        details: row.details,
      })
    );
  } catch (error) {
    const exhausted = row.attempts >= MAX_DELIVERY_ATTEMPTS;
    const result = await db
      .update(alertDispatches)
      .set({
        // An exhausted dispatch stops retrying but is not forgotten: an
        // undeliverable page is itself an operational fact.
        status: exhausted ? "failed" : "pending",
        lastError: redact(error),
        nextAttemptAt: exhausted
          ? null
          : new Date(now.getTime() + deliveryBackoffMs(row.attempts)),
        leaseToken: null,
        leaseUntil: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(alertDispatches.id, id),
          eq(alertDispatches.leaseToken, claimed.leaseToken)
        )
      );
    return result[0].affectedRows
      ? exhausted
        ? "failed"
        : "retry"
      : "skipped";
  }

  const result = await db
    .update(alertDispatches)
    .set({
      status: "delivered",
      deliveredAt: new Date(),
      lastError: null,
      nextAttemptAt: null,
      leaseToken: null,
      leaseUntil: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(alertDispatches.id, id),
        eq(alertDispatches.leaseToken, claimed.leaseToken)
      )
    );
  return result[0].affectedRows ? "delivered" : "skipped";
}

export interface DeliveryRun {
  considered: number;
  delivered: number;
  retrying: number;
  failed: number;
}

/** Scheduled entry point. Returns a summary rather than throwing on a delivery
 * failure: a provider outage is recorded per row with a backoff, and failing
 * the whole task would only mark the scheduler unhealthy for something the
 * rows already describe. Exhausted dispatches do raise, since a page nobody
 * can deliver needs an operator. */
export async function processOnCallDeliveries(
  now: Date = new Date()
): Promise<DeliveryRun> {
  const provider = configuredOnCallProvider();
  if (!provider) return { considered: 0, delivered: 0, retrying: 0, failed: 0 };
  const db = dbRequired();
  const rows = await db
    .select({ id: alertDispatches.id })
    .from(alertDispatches)
    .where(
      and(
        inArray(alertDispatches.status, ["pending", "outcome_unknown"]),
        or(
          isNull(alertDispatches.nextAttemptAt),
          lte(alertDispatches.nextAttemptAt, now)
        ),
        or(
          isNull(alertDispatches.leaseUntil),
          lte(alertDispatches.leaseUntil, now)
        )
      )
    )
    // Oldest next-attempt first; MySQL sorts NULL first ascending, so a
    // never-attempted dispatch always leads. Without this, rows stuck behind a
    // long backoff could hold every slot and starve a fresh page.
    .orderBy(asc(alertDispatches.nextAttemptAt))
    .limit(WORKER_PAGE_SIZE);

  const run: DeliveryRun = {
    considered: rows.length,
    delivered: 0,
    retrying: 0,
    failed: 0,
  };
  const exhausted: number[] = [];
  for (const row of rows) {
    const result = await deliverDispatch(db, row.id, provider, now);
    if (result === "delivered") run.delivered += 1;
    else if (result === "retry") run.retrying += 1;
    else if (result === "failed") {
      run.failed += 1;
      exhausted.push(row.id);
    }
  }
  if (exhausted.length)
    throw new Error(
      `On-call dispatches are undeliverable and need an operator: ${exhausted.join(",")}`
    );
  return run;
}

export interface DispatchView {
  id: number;
  alertKey: string;
  action: OnCallAction;
  status: OnCallDispatchStatus;
  attempts: number;
  deliveredAt: string | null;
  nextAttemptAt: string | null;
  lastError: string | null;
  providerMode: "sandbox" | "live";
}

/** Recent dispatch state for the operations view. Deliberately reports the
 * provider receipt only; whether a person responded is not represented here
 * because it is not known here. */
export async function readAlertDispatches(limit = 50): Promise<DispatchView[]> {
  const db = dbRequired();
  const rows = await db
    .select()
    .from(alertDispatches)
    .orderBy(sql`${alertDispatches.id} desc`)
    .limit(Math.min(Math.max(limit, 1), 200));
  return rows.map(row => ({
    id: row.id,
    alertKey: row.alertKey,
    action: row.action,
    status: row.status,
    attempts: row.attempts,
    deliveredAt: row.deliveredAt?.toISOString() ?? null,
    nextAttemptAt: row.nextAttemptAt?.toISOString() ?? null,
    lastError: row.lastError,
    providerMode: row.providerMode,
  }));
}
