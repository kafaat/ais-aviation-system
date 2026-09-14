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
 * It differs in one place, deliberately: a lost response here *is* retryable,
 * because the provider deduplicates on the dedup key. That is asserted against
 * the provider rather than assumed.
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
  const dedupKey = `${input.alertKey}:${randomUUID()}`.slice(0, 100);
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
 * the incident. With no delivered or in-flight raise there is nothing to close,
 * so nothing is queued: sending a bare close would invent an incident.
 */
export async function queueAlertClose(
  tx: SettlementTx,
  alertKey: string,
  provider: Pick<OnCallProvider, "mode" | "reference"> | null
): Promise<{ dedupKey: string } | null> {
  if (!provider) return null;
  const [raise] = await tx
    .select()
    .from(alertDispatches)
    .where(
      and(
        eq(alertDispatches.alertKey, alertKey),
        eq(alertDispatches.action, "raise"),
        inArray(alertDispatches.status, [
          "pending",
          "outcome_unknown",
          "delivered",
        ])
      )
    )
    .orderBy(sql`${alertDispatches.id} desc`)
    .limit(1);
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
    providerMode: provider.mode,
    providerReference: provider.reference,
  });
  return { dedupKey: raise.dedupKey };
}

type ClaimOutcome =
  | { claimed: true; id: number; leaseToken: string }
  | { claimed: false };

/** Takes a fenced lease and persists `outcome_unknown` in the same
 * transaction, before anything is sent. A crash between here and the request
 * therefore leaves a row that says a send may have happened, which is the
 * truth, rather than a `pending` row that would look untouched. */
async function claim(
  tx: SettlementTx,
  id: number,
  now: Date
): Promise<ClaimOutcome> {
  const [row] = await tx
    .select()
    .from(alertDispatches)
    .where(eq(alertDispatches.id, id))
    .for("update");
  if (!row) return { claimed: false };
  if (row.status === "delivered" || row.status === "failed")
    return { claimed: false };
  if (row.leaseUntil && row.leaseUntil.getTime() > now.getTime())
    return { claimed: false };
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
  const claimed = await db.transaction(tx => claim(tx, id, now));
  if (!claimed.claimed) return "skipped";

  const [row] = await db
    .select()
    .from(alertDispatches)
    .where(eq(alertDispatches.id, id));
  if (!row) return "skipped";

  // Retrying after an unknown outcome is only safe because the provider folds
  // a repeated dedup key into one incident. Asserted, not assumed: a provider
  // without that property must not inherit this retry path.
  if (row.attempts > 1 && !provider.dedupes)
    throw new Error("On-call provider cannot be retried safely");

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
    await db
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
    return exhausted ? "failed" : "retry";
  }

  await db
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
  return "delivered";
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
  status: "pending" | "outcome_unknown" | "delivered" | "failed";
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
