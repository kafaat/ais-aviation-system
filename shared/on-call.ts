/** On-call delivery contract (R2-09).
 *
 * The system already evaluated operational alerts and stored them. Nothing
 * carried one to a person: an alert sat in `operations_alerts` until somebody
 * happened to open the dashboard. This adds the delivery leg and its receipts.
 *
 * One distinction runs through the whole package and is the reason the statuses
 * are named the way they are:
 *
 *   **`delivered` means the provider accepted the request. It does not mean a
 *   human was reached.** Whether anyone was paged, woke up, or read it is the
 *   provider's business and is not knowable from here. A dashboard that showed
 *   "delivered" as "someone is on it" would be asserting something this system
 *   cannot observe — the same mistake as treating a sandbox hotel confirmation
 *   as a room.
 *
 * Acknowledgement is therefore recorded separately, and only ever from an
 * operator acting in this system.
 */
import { z } from "zod";

export const onCallAction = z.enum(["raise", "close"]);
export type OnCallAction = z.infer<typeof onCallAction>;

export const onCallDispatchStatus = z.enum([
  /** Awaiting initial delivery or retry; earlier attempts may have been sent. */
  "pending",
  /** A send was started and its outcome is not known. Retryable only because
   * the provider deduplicates on the dedup key — see `OnCallProvider`. */
  "outcome_unknown",
  /** The provider accepted the request. Not a statement about any person. */
  "delivered",
  /** The provider refused in a way retrying cannot fix, or attempts ran out. */
  "failed",
  /** No further raise will be sent because closure was requested. This does
   * not assert that an earlier unknown send failed at the provider. */
  "cancelled",
]);
export type OnCallDispatchStatus = z.infer<typeof onCallDispatchStatus>;

/** Attempts before a dispatch is left for an operator rather than retried
 * forever. A page nobody can deliver is itself an operational fact, so it is
 * recorded and surfaced, not discarded. */
export const MAX_DELIVERY_ATTEMPTS = 6;

/** Exponential, capped. A provider outage must not turn a minute-by-minute
 * scheduled task into a hot retry loop against it. */
export function deliveryBackoffMs(attempts: number): number {
  const capped = Math.min(Math.max(attempts, 1), 10);
  return Math.min(60_000 * 2 ** (capped - 1), 30 * 60_000);
}

/** How long a worker may hold a dispatch while it talks to the provider. */
export const DELIVERY_LEASE_MS = 120_000;

export const onCallDispatch = z.object({
  alertKey: z.string().min(1).max(100),
  action: onCallAction,
  /** Stable per incident. The raise and its matching close share one, which is
   * how the provider correlates the close to the incident it opened. */
  dedupKey: z.string().min(1).max(100),
  summary: z.string().min(1).max(200),
  details: z.string().max(1000),
});
export type OnCallDispatch = z.infer<typeof onCallDispatch>;

export function dispatchStatusLabel(
  status: OnCallDispatchStatus,
  arabic = false
): string {
  const labels: Record<OnCallDispatchStatus, [string, string]> = {
    pending: [
      "Awaiting delivery or retry",
      "في انتظار الإرسال أو إعادة المحاولة",
    ],
    outcome_unknown: [
      "Send started, outcome unknown",
      "بدأ الإرسال، والنتيجة غير معروفة",
    ],
    delivered: [
      "Accepted by the provider — not a confirmation that a person was reached",
      "قبله المزوّد — وليس تأكيدًا بوصوله إلى شخص",
    ],
    failed: [
      "Undeliverable; requires an operator",
      "غير قابل للتسليم؛ يحتاج مشغّلًا",
    ],
    cancelled: [
      "Raise cancelled by incident closure",
      "أُلغي الإرسال بطلب إغلاق الحادث",
    ],
  };
  return labels[status][arabic ? 1 : 0];
}
