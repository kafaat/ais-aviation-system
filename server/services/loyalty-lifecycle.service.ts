import { asc, eq, gt, isNull } from "drizzle-orm";
import {
  loyaltyAccounts,
  loyaltyExpiryNotices,
  users,
} from "../../drizzle/schema";
import { getDb } from "../db";
import type { SettlementTx } from "./booking-settlement.service";
import {
  expireMilesLots,
  lockMilesState,
  type MilesState,
} from "./loyalty-balance.service";
import {
  activityExpiryAt,
  getActiveProgramRule,
  type ProgramRule,
} from "./loyalty-rules.service";
import { createNotification } from "./notification.service";
import { sendNotificationEmail } from "./email.service";

/**
 * Daily loyalty lifecycle: expire lapsed miles (posting the breakage release
 * through the balance service's accounting hook) and warn members 60 and 30
 * days before their miles lapse.
 *
 * Idempotent and resumable: every account runs in its own transaction, expiry
 * is a no-op once posted, and a notice is keyed by (account, projected expiry
 * date, days before). A notice whose notification could not be sent keeps
 * notificationId = null and is retried on the next run. Any earn or burn
 * moves the projected date, which naturally schedules a fresh notice set.
 */
export type LifecycleResult = {
  accountsScanned: number;
  accountsExpired: number;
  milesExpired: number;
  noticesCreated: number;
  notificationsSent: number;
  failures: Array<{ userId: number; message: string }>;
};

type NoticePlan = { projectedExpiryAt: Date; milesAtRisk: number };

/** Dates at which remaining miles lapse if nothing changes, grouped by date. */
export function planExpiries(
  state: MilesState,
  rule: ProgramRule
): NoticePlan[] {
  if (state.account.currentMilesBalance <= 0) return [];
  if (rule.expiryMode === "activity") {
    const at = activityExpiryAt(rule, state.account);
    return at
      ? [
          {
            projectedExpiryAt: at,
            milesAtRisk: state.account.currentMilesBalance,
          },
        ]
      : [];
  }
  const byDate = new Map<number, NoticePlan>();
  for (const lot of state.lots) {
    if (!lot.remainingMiles || !lot.expiresAt) continue;
    const key = lot.expiresAt.getTime();
    const plan = byDate.get(key) ?? {
      projectedExpiryAt: lot.expiresAt,
      milesAtRisk: 0,
    };
    plan.milesAtRisk += lot.remainingMiles;
    byDate.set(key, plan);
  }
  return [...byDate.values()].sort(
    (a, b) => a.projectedExpiryAt.getTime() - b.projectedExpiryAt.getTime()
  );
}

/** Notice offsets whose window is open at `now` for one projected expiry date. */
export function dueNoticeDays(
  plan: NoticePlan,
  noticeDays: number[],
  now: Date
): number[] {
  const expiry = plan.projectedExpiryAt.getTime();
  if (expiry <= now.getTime()) return [];
  return noticeDays.filter(days => expiry - days * 86_400_000 <= now.getTime());
}

async function scheduleNotices(
  tx: SettlementTx,
  state: MilesState,
  rule: ProgramRule,
  now: Date
) {
  let created = 0;
  const plans = planExpiries(state, rule);
  if (!plans.length) return created;
  const existing = await tx
    .select()
    .from(loyaltyExpiryNotices)
    .where(eq(loyaltyExpiryNotices.loyaltyAccountId, state.account.id));
  for (const plan of plans)
    for (const days of dueNoticeDays(plan, rule.expiryNoticeDays, now)) {
      if (
        existing.some(
          n =>
            n.daysBefore === days &&
            n.projectedExpiryAt.getTime() === plan.projectedExpiryAt.getTime()
        )
      )
        continue;
      await tx.insert(loyaltyExpiryNotices).values({
        loyaltyAccountId: state.account.id,
        userId: state.account.userId,
        projectedExpiryAt: plan.projectedExpiryAt,
        daysBefore: days,
        milesAtRisk: plan.milesAtRisk,
        notificationId: null,
      });
      created++;
    }
  return created;
}

function noticeCopy(
  notice: typeof loyaltyExpiryNotices.$inferSelect,
  rule: ProgramRule
) {
  const date = notice.projectedExpiryAt.toISOString().slice(0, 10);
  const miles = notice.milesAtRisk.toLocaleString("en-US");
  const keep =
    rule.expiryMode === "activity"
      ? `Earn or redeem any miles before then and your whole balance stays valid for another ${rule.expiryMonths} months.`
      : "Redeem them before that date to keep their value.";
  return {
    title: `${miles} miles expire in ${notice.daysBefore} days`,
    message: `${miles} of your miles will expire on ${date}. ${keep}`,
  };
}

/** Send pending notices (notificationId null) for one member; returns how many were sent. */
async function deliverPendingNotices(
  db: SettlementTx,
  userId: number,
  rule: ProgramRule
) {
  const pending = await db
    .select()
    .from(loyaltyExpiryNotices)
    .where(eq(loyaltyExpiryNotices.userId, userId));
  let sent = 0;
  for (const notice of pending.filter(n => n.notificationId === null)) {
    const copy = noticeCopy(notice, rule);
    const { id } = await createNotification(
      userId,
      "system",
      copy.title,
      copy.message,
      {
        milesAtRisk: notice.milesAtRisk,
        expiresAt: notice.projectedExpiryAt.toISOString(),
        daysBefore: notice.daysBefore,
        link: "/loyalty",
      }
    );
    await db
      .update(loyaltyExpiryNotices)
      .set({ notificationId: id })
      .where(eq(loyaltyExpiryNotices.id, notice.id));
    sent++;
    // System notifications are in-app only; expiry warnings also go by email
    // when the member has an address. Email failure never blocks the run.
    try {
      const [member] = await db
        .select({ email: users.email })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      if (member?.email)
        await sendNotificationEmail(member.email, copy.title, copy.message);
    } catch (error) {
      console.error("[LoyaltyLifecycle] Expiry email failed", {
        userId,
        error,
      });
    }
  }
  return sent;
}

export async function runLoyaltyLifecycle(
  options: {
    now?: Date;
    batchSize?: number;
  } = {}
): Promise<LifecycleResult> {
  const db = getDb();
  if (!db) throw new Error("Database unavailable for loyalty lifecycle");
  const now = options.now ?? new Date();
  const batchSize = options.batchSize ?? 200;
  const rule = await getActiveProgramRule(db, now);
  const result: LifecycleResult = {
    accountsScanned: 0,
    accountsExpired: 0,
    milesExpired: 0,
    noticesCreated: 0,
    notificationsSent: 0,
    failures: [],
  };
  let cursor = 0;
  for (;;) {
    const batch = await db
      .select({ id: loyaltyAccounts.id, userId: loyaltyAccounts.userId })
      .from(loyaltyAccounts)
      .where(gt(loyaltyAccounts.id, cursor))
      .orderBy(asc(loyaltyAccounts.id))
      .limit(batchSize);
    if (!batch.length) break;
    for (const account of batch) {
      cursor = Math.max(cursor, account.id);
      result.accountsScanned++;
      try {
        const outcome = await db.transaction(async tx => {
          const state = await lockMilesState(tx, account.userId);
          const expired = await expireMilesLots(tx, state, now, rule);
          const notices = await scheduleNotices(tx, state, rule, now);
          return { expired, notices };
        });
        if (outcome.expired) result.accountsExpired++;
        result.milesExpired += outcome.expired;
        result.noticesCreated += outcome.notices;
        result.notificationsSent += await deliverPendingNotices(
          db,
          account.userId,
          rule
        );
      } catch (error) {
        result.failures.push({
          userId: account.userId,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
    if (batch.length < batchSize) break;
  }
  return result;
}

/** Scheduled entry point: finishes every account, then fails the tick if any member failed. */
export async function runLoyaltyLifecycleJob() {
  const result = await runLoyaltyLifecycle();
  console.info(
    `[LoyaltyLifecycle] scanned=${result.accountsScanned} expired=${result.milesExpired} notices=${result.noticesCreated} sent=${result.notificationsSent} failures=${result.failures.length}`
  );
  if (result.failures.length)
    throw new Error(
      `Loyalty lifecycle incomplete for ${result.failures.length} accounts; user IDs: ${result.failures
        .slice(0, 20)
        .map(f => f.userId)
        .join(", ")}`
    );
  return result;
}

/** Pending notices across members, for the admin panel. */
export async function countPendingNotices(db: SettlementTx) {
  const rows = await db
    .select({ id: loyaltyExpiryNotices.id })
    .from(loyaltyExpiryNotices)
    .where(isNull(loyaltyExpiryNotices.notificationId));
  return rows.length;
}
