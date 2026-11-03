import { and, eq, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  bookings,
  financialLedger,
  paymentReceipts,
} from "../../drizzle/schema";
import { payoutEvidence } from "../../shared/payout-comparison";
import { getDb } from "../db";

export async function comparePayoutEvidence(
  input: z.infer<typeof payoutEvidence>,
  tenantId: number | undefined
) {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE" });
  const { payout, bank } = input;
  const rows = await db
    .select({
      intent: paymentReceipts.paymentIntentId,
      bookingId: bookings.id,
      kind: paymentReceipts.kind,
      targetId: paymentReceipts.targetId,
      receiptMinor: paymentReceipts.amount,
      currency: paymentReceipts.currency,
      collectionState: paymentReceipts.settlementStatus,
      ledgerId: financialLedger.id,
      ledgerMajor: financialLedger.amount,
      ledgerCurrency: financialLedger.currency,
    })
    .from(paymentReceipts)
    .innerJoin(bookings, eq(bookings.id, paymentReceipts.bookingId))
    .leftJoin(
      financialLedger,
      and(
        eq(
          financialLedger.stripePaymentIntentId,
          paymentReceipts.paymentIntentId
        ),
        eq(financialLedger.bookingId, bookings.id),
        eq(financialLedger.userId, paymentReceipts.userId),
        eq(financialLedger.type, "charge")
      )
    )
    .where(
      and(
        inArray(
          paymentReceipts.paymentIntentId,
          payout.captures.map(c => c.paymentIntentId)
        ),
        tenantId === undefined ? undefined : eq(bookings.tenantId, tenantId)
      )
    );
  const lines = payout.captures.map(capture => {
    const matches = rows.filter(row => row.intent === capture.paymentIntentId);
    const row = matches.length === 1 ? matches[0] : undefined;
    const matched = Boolean(
      row &&
      row.ledgerId !== null &&
      row.currency === payout.currency &&
      row.ledgerCurrency === payout.currency &&
      row.receiptMinor === capture.grossMinor &&
      row.ledgerMajor === (capture.grossMinor / 100).toFixed(2)
    );
    return {
      paymentIntentId: capture.paymentIntentId,
      matched,
      bookingId: row?.bookingId ?? null,
      modificationId: row?.kind === "modification" ? row.targetId : null,
      ledgerEntryId: row?.ledgerId ?? null,
      collectionState: row?.collectionState ?? null,
    };
  });
  const calculatedNetMinor = payout.captures.reduce(
    (sum, c) => sum + c.grossMinor - c.feeMinor,
    0
  );
  const payoutNetMatches = payout.netMinor === calculatedNetMinor;
  const bankTransferMatches =
    bank.payoutReference === payout.reference &&
    bank.creditedMinor === payout.netMinor;
  return {
    basis: "operator_supplied_statements" as const,
    payoutReference: payout.reference,
    statementLineId: bank.statementLineId,
    calculatedNetMinor,
    payoutNetMatches,
    bankTransferMatches,
    matched:
      payoutNetMatches &&
      bankTransferMatches &&
      lines.every(line => line.matched),
    lines,
  };
}
