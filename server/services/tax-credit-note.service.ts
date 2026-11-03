import type { Booking } from "../../drizzle/schema";
import type { SettlementTx } from "./booking-settlement.service";
import {
  ensureSaleFareComponents,
  recordReversalComponents,
  sumComponents,
  vatOfComponents,
  type NewFareComponent,
} from "./fare-components.service";
import { issueTaxDocument, latestTaxInvoice } from "./tax-invoice.service";

/**
 * Bridges servicing and refunds to the fare ledger and ZATCA documents: a
 * refund reverses components at the rates they were charged and issues a
 * simplified credit note against the latest invoice; an exchange cancels the
 * old invoice with a credit note and issues a new one for the replacement.
 */

const documentLines = (rows: NewFareComponent[]) =>
  rows.map(c => ({
    passengerId: c.passengerId,
    flightId: c.flightId,
    componentType: c.componentType,
    code: c.code,
    jurisdiction: c.jurisdiction,
    rateBasisPoints: c.rateBasisPoints,
    amount: c.amount,
  }));

export async function issueRefundCreditNote(
  tx: SettlementTx,
  booking: Booking,
  amount: number,
  reference: string
) {
  // Bookings paid before the ledger existed get a derived decomposition first.
  await ensureSaleFareComponents(tx, booking, `${reference}:derived`);
  const reversal = await recordReversalComponents(
    tx,
    booking,
    amount,
    reference
  );
  const original = await latestTaxInvoice(tx, booking.id);
  if (!original) return { reversal, creditNote: null };
  const creditNote = await issueTaxDocument(tx, {
    booking,
    documentType: "simplified_credit_note",
    totalIncludingVat: -sumComponents(reversal),
    vatAmount: -vatOfComponents(reversal),
    reference,
    referencedInvoiceId: original.id,
    lines: documentLines(reversal),
  });
  return { reversal, creditNote };
}

/** Cancel-and-reissue for an itinerary exchange; invoice only for added services. */
export async function issueServicingTaxDocuments(
  tx: SettlementTx,
  booking: Booking,
  rows: { reversal: NewFareComponent[]; sale: NewFareComponent[] },
  reference: string
) {
  const original = await latestTaxInvoice(tx, booking.id);
  const reversed = -sumComponents(rows.reversal);
  const creditNote =
    reversed > 0 && original
      ? await issueTaxDocument(tx, {
          booking,
          documentType: "simplified_credit_note",
          totalIncludingVat: reversed,
          vatAmount: -vatOfComponents(rows.reversal),
          reference: `${reference}:reversal`,
          referencedInvoiceId: original.id,
          lines: documentLines(rows.reversal),
        })
      : null;
  const sold = sumComponents(rows.sale);
  const invoice =
    sold > 0
      ? await issueTaxDocument(tx, {
          booking,
          documentType: "simplified_invoice",
          totalIncludingVat: sold,
          vatAmount: vatOfComponents(rows.sale),
          reference: `${reference}:sale`,
          lines: documentLines(rows.sale),
        })
      : null;
  return { creditNote, invoice };
}
