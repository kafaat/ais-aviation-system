import { TRPCError } from "@trpc/server";
import { and, desc, eq, isNotNull, inArray, sql } from "drizzle-orm";
import {
  agencyCreditObligations,
  agencyCreditTerms,
  bookings,
  financialLedger,
  travelAgents,
  users,
} from "../../drizzle/schema";
import { getDb } from "../db";
import type { SettlementTx } from "./booking-settlement.service";
import { inventoryTransactionConfig } from "./inventory-capacity.service";

type Debtor = { userId: number; tenantId: number | null };

function database() {
  const db = getDb();
  if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE" });
  return db;
}

async function latestTerms(tx: SettlementTx, agencyId: number) {
  const [terms] = await tx
    .select()
    .from(agencyCreditTerms)
    .where(eq(agencyCreditTerms.agencyId, agencyId))
    .orderBy(desc(agencyCreditTerms.id))
    .limit(1);
  return terms;
}

// Obligations never write a payment or issue a ticket. Cancellation releases
// the commitment; posted SAR funding reduces the original invoice once. A
// refund returns an already collected amount and does not reopen agency debt.
async function outstanding(tx: SettlementTx, agencyId: number) {
  const [row] = await tx
    .select({
      amount: sql<number>`coalesce(sum(
    case when ${bookings.status} = 'cancelled' then 0 else greatest(0,
      ${agencyCreditObligations.amountMinor} - coalesce((
        select round(sum(${financialLedger.amount}) * 100) from ${financialLedger}
        where ${financialLedger.bookingId} = ${agencyCreditObligations.bookingId}
          and ${financialLedger.currency} = 'SAR' and ${financialLedger.type} = 'charge'
          and ${financialLedger.amount} > 0
      ), 0)) end), 0)`,
    })
    .from(agencyCreditObligations)
    .innerJoin(
      agencyCreditTerms,
      eq(agencyCreditTerms.id, agencyCreditObligations.termsId)
    )
    .innerJoin(bookings, eq(bookings.id, agencyCreditObligations.bookingId))
    .where(eq(agencyCreditTerms.agencyId, agencyId));
  return Number(row.amount);
}

// The verified dispute handler records signed money movement without changing
// booking or payment status. Keep new credit on hold until reinstatement of
// the SAME dispute and intent; a separate customer's dispute cannot offset it.
async function hasUnresolvedWithdrawal(tx: SettlementTx, agencyId: number) {
  const disputeId = sql`json_unquote(json_extract(if(json_valid(${financialLedger.metadata}), ${financialLedger.metadata}, null), '$.disputeId'))`;
  const [withdrawn] = await tx
    .select({ bookingId: agencyCreditObligations.bookingId })
    .from(agencyCreditTerms)
    .innerJoin(
      agencyCreditObligations,
      eq(agencyCreditObligations.termsId, agencyCreditTerms.id)
    )
    .innerJoin(
      financialLedger,
      eq(financialLedger.bookingId, agencyCreditObligations.bookingId)
    )
    .where(
      and(
        eq(agencyCreditTerms.agencyId, agencyId),
        eq(financialLedger.currency, "SAR"),
        eq(financialLedger.type, "adjustment"),
        isNotNull(financialLedger.stripeEventId),
        isNotNull(financialLedger.stripePaymentIntentId),
        inArray(financialLedger.description, [
          "Provider dispute funds_withdrawn",
          "Provider dispute funds_reinstated",
        ])
      )
    )
    .groupBy(
      agencyCreditObligations.bookingId,
      financialLedger.stripePaymentIntentId,
      disputeId
    )
    .having(sql`sum(${financialLedger.amount}) < 0`)
    .limit(1);
  return Boolean(withdrawn);
}

async function requireClearedSettlement(tx: SettlementTx, agencyId: number) {
  if (await hasUnresolvedWithdrawal(tx, agencyId))
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Agency credit is on hold pending settlement review",
    });
}

function requireDebtor(
  terms: typeof agencyCreditTerms.$inferSelect,
  debtor: Debtor
) {
  if (terms.ownerId !== debtor.userId || terms.tenantId !== debtor.tenantId)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "Agency credit terms require review for the current owner and airline",
    });
}

// The caller holds the travel_agents row lock in the booking transaction.
export async function reserveAgencyCredit(
  tx: SettlementTx,
  agencyId: number,
  debtor: Debtor,
  bookingId: number,
  amountMinor: number
) {
  const terms = await latestTerms(tx, agencyId);
  if (!terms) return;
  await requireClearedSettlement(tx, agencyId);
  if (terms.limitMinor == null) return;
  requireDebtor(terms, debtor);
  // The credential API also serves legacy unscoped accounts. Its invoice
  // inherits the flight's tenant; credit approval may never cross that scope.
  const [invoice] = await tx
    .select({
      userId: bookings.userId,
      tenantId: bookings.tenantId,
      amountMinor: bookings.totalAmount,
    })
    .from(bookings)
    .where(eq(bookings.id, bookingId));
  if (
    !invoice ||
    invoice.userId !== terms.ownerId ||
    invoice.tenantId !== terms.tenantId ||
    invoice.amountMinor !== amountMinor
  )
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Invoice does not belong to the approved agency credit terms",
    });
  const exposure = await outstanding(tx, agencyId);
  if (amountMinor > terms.limitMinor - exposure)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Agency credit limit exceeded",
    });
  await tx
    .insert(agencyCreditObligations)
    .values({ termsId: terms.id, bookingId, amountMinor });
}

export async function agencyCreditBalance(
  tx: SettlementTx,
  agencyId: number,
  debtor?: Debtor
) {
  const terms = await latestTerms(tx, agencyId);
  if (debtor && terms?.limitMinor != null) requireDebtor(terms, debtor);
  const settlementReview =
    Boolean(terms) && (await hasUnresolvedWithdrawal(tx, agencyId));
  const outstandingMinor =
    terms?.limitMinor != null ? await outstanding(tx, agencyId) : 0;
  return {
    termsId: terms?.id ?? null,
    limitMinor: terms?.limitMinor ?? null,
    outstandingMinor,
    settlementReview,
    availableMinor:
      terms?.limitMinor == null
        ? null
        : settlementReview
          ? 0
          : terms.limitMinor - outstandingMinor,
    currency: "SAR" as const,
  };
}

async function getCreditOwner(
  tx: SettlementTx,
  agencyId: number,
  adminTenantId: number | null,
  write: boolean
) {
  const [agency] = await tx
    .select({ ownerId: travelAgents.ownerUserId })
    .from(travelAgents)
    .where(eq(travelAgents.id, agencyId))
    .for(write ? "update" : "share");
  if (!agency?.ownerId)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "A linked agency owner is required",
    });
  const [owner] = await tx
    .select({ userId: users.id, tenantId: users.tenantId })
    .from(users)
    .where(eq(users.id, agency.ownerId))
    .for("share");
  if (!owner || (adminTenantId !== null && owner.tenantId !== adminTenantId))
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Agency owner is unavailable",
    });
  return owner;
}

export function adminAgencyCredit(
  agencyId: number,
  adminTenantId: number | null
) {
  return database().transaction(async tx => {
    await getCreditOwner(tx, agencyId, adminTenantId, false);
    return agencyCreditBalance(tx, agencyId);
  });
}

export function approveAgencyCredit(
  input: {
    agencyId: number;
    expectedTermsId: number | null;
    limitMinor: number | null;
    reason: string;
  },
  actor: Debtor
) {
  return database().transaction(async tx => {
    const owner = await getCreditOwner(
      tx,
      input.agencyId,
      actor.tenantId,
      true
    );
    const current = await latestTerms(tx, input.agencyId);
    if (
      current?.limitMinor === input.limitMinor &&
      current.reason === input.reason &&
      current.approvedBy === actor.userId &&
      current.ownerId === owner.userId &&
      current.tenantId === owner.tenantId
    )
      return agencyCreditBalance(tx, input.agencyId);
    if ((current?.id ?? null) !== input.expectedTermsId)
      throw new TRPCError({
        code: "CONFLICT",
        message: "Agency credit terms changed. Refresh before approving.",
      });
    if (current) await requireClearedSettlement(tx, input.agencyId);
    const exposure = await outstanding(tx, input.agencyId);
    if (exposure > (input.limitMinor ?? 0))
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Outstanding agency invoices exceed the requested limit",
      });
    if (exposure && current) requireDebtor(current, owner);
    await tx.insert(agencyCreditTerms).values({
      agencyId: input.agencyId,
      ownerId: owner.userId,
      tenantId: owner.tenantId,
      limitMinor: input.limitMinor,
      approvedBy: actor.userId,
      reason: input.reason,
    });
    return agencyCreditBalance(tx, input.agencyId);
  }, inventoryTransactionConfig);
}

export async function requireCreditDisabledForTransfer(
  tx: SettlementTx,
  agencyId: number
) {
  const terms = await latestTerms(tx, agencyId);
  if (!terms) return;
  await requireClearedSettlement(tx, agencyId);
  if (terms.limitMinor != null)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "Settle outstanding invoices and disable agency credit before transferring ownership",
    });
}
