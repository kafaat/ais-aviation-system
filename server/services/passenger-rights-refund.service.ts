// US DOT 14 CFR 260 refund-timeline tracking. A deadline is opened when an
// involuntary refund becomes due and settled when the refund receipt exists.
// Business days exclude weekends only; US federal holidays are not modelled.
import { and, eq, isNull, lt } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { passengerRightsRefundDeadlines } from "../../drizzle/schema";
import { getDb } from "../db";
import {
  addBusinessDays,
  addCalendarDays,
  findRule,
} from "../../shared/passenger-rights";

export type RefundTrigger = "carrier_cancellation" | "significant_change";
export type TenderClass = "card" | "other";

const RULE_BY_TENDER: Record<TenderClass, string> = {
  card: "US-DOT-14CFR260.refund_timeline.card",
  other: "US-DOT-14CFR260.refund_timeline.other",
};

/** Deadline from the seeded rule's time limit; the rule code is stored with the row. */
export function refundDueAt(
  triggeredAt: Date,
  tenderClass: TenderClass
): { ruleCode: string; dueAt: Date; basis: string } {
  const ruleCode = RULE_BY_TENDER[tenderClass];
  const rule = findRule(ruleCode);
  const limits = rule?.timeLimits;
  if (!limits) throw new Error(`Refund timeline rule ${ruleCode} is missing`);
  if (tenderClass === "card" && limits.refundCardBusinessDays !== undefined)
    return {
      ruleCode,
      dueAt: addBusinessDays(triggeredAt, limits.refundCardBusinessDays),
      basis: `${limits.refundCardBusinessDays} business days (weekends excluded; US federal holidays not modelled)`,
    };
  if (tenderClass === "other" && limits.refundOtherCalendarDays !== undefined)
    return {
      ruleCode,
      dueAt: addCalendarDays(triggeredAt, limits.refundOtherCalendarDays),
      basis: `${limits.refundOtherCalendarDays} calendar days`,
    };
  throw new Error(
    `Refund timeline rule ${ruleCode} has no limit for ${tenderClass}`
  );
}

type Executor = Pick<
  NonNullable<ReturnType<typeof getDb>>,
  "select" | "insert" | "update"
>;

/** Records that an involuntary refund became due (admin or servicing flow). */
export async function openRefundDeadline(
  tx: Executor,
  input: {
    bookingId: number;
    trigger: RefundTrigger;
    tenderClass: TenderClass;
    triggeredAt: Date;
    openedBy: number | null;
    note?: string;
  }
) {
  const due = refundDueAt(input.triggeredAt, input.tenderClass);
  const [inserted] = await tx.insert(passengerRightsRefundDeadlines).values({
    bookingId: input.bookingId,
    jurisdiction: "US-DOT-14CFR260",
    ruleCode: due.ruleCode,
    trigger: input.trigger,
    tenderClass: input.tenderClass,
    triggeredAt: input.triggeredAt,
    dueAt: due.dueAt,
    basis: due.basis,
    openedBy: input.openedBy,
    note: input.note ?? null,
  });
  return { id: inserted.insertId, ...due };
}

/**
 * Hook for refund flows: closes every open deadline of the booking against the
 * refund receipt. With `trigger`, a refund issued without a prior deadline
 * still leaves an auditable row (opened and settled at the refund instant).
 */
export async function settleRefundDeadlines(
  tx: Executor,
  input: {
    bookingId: number;
    ledgerId: number;
    completedAt: Date;
    tenderClass: TenderClass;
    trigger?: RefundTrigger;
    actorId: number;
  }
) {
  const open = await tx
    .select()
    .from(passengerRightsRefundDeadlines)
    .where(
      and(
        eq(passengerRightsRefundDeadlines.bookingId, input.bookingId),
        isNull(passengerRightsRefundDeadlines.completedAt)
      )
    );
  if (!open.length && input.trigger) {
    const opened = await openRefundDeadline(tx, {
      bookingId: input.bookingId,
      trigger: input.trigger,
      tenderClass: input.tenderClass,
      triggeredAt: input.completedAt,
      openedBy: input.actorId,
      note: "Opened at refund time; no prior deadline row",
    });
    open.push({
      id: opened.id,
      dueAt: opened.dueAt,
    } as (typeof open)[number]);
  }
  for (const row of open) {
    await tx
      .update(passengerRightsRefundDeadlines)
      .set({
        completedAt: input.completedAt,
        ledgerId: input.ledgerId,
        metOnTime: input.completedAt.getTime() <= row.dueAt.getTime(),
      })
      .where(eq(passengerRightsRefundDeadlines.id, row.id));
  }
  return open.map(row => ({
    id: row.id,
    metOnTime: input.completedAt.getTime() <= row.dueAt.getTime(),
  }));
}

export async function listRefundDeadlines(input: {
  overdueOnly: boolean;
  now?: Date;
}) {
  const db = getDb();
  if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE" });
  const now = input.now ?? new Date();
  const rows = await db
    .select()
    .from(passengerRightsRefundDeadlines)
    .where(
      input.overdueOnly
        ? and(
            isNull(passengerRightsRefundDeadlines.completedAt),
            lt(passengerRightsRefundDeadlines.dueAt, now)
          )
        : undefined
    );
  return rows
    .map(row => ({
      id: row.id,
      bookingId: row.bookingId,
      jurisdiction: row.jurisdiction,
      ruleCode: row.ruleCode,
      trigger: row.trigger,
      tenderClass: row.tenderClass,
      triggeredAt: row.triggeredAt,
      dueAt: row.dueAt,
      basis: row.basis,
      completedAt: row.completedAt,
      ledgerId: row.ledgerId,
      metOnTime: row.metOnTime,
      overdue: row.completedAt === null && row.dueAt.getTime() < now.getTime(),
    }))
    .sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());
}
