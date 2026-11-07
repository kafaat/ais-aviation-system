/**
 * Reconciliation matrix: ledger expectation × RET line × HOT line × bank
 * remittance → one classification per document transaction.
 *
 * The bank wires one net amount per remittance period, not one per ticket,
 * so remittance coverage is decided at period level (Σ bank credits in the
 * period must equal Σ HOT net) and every otherwise matched item inherits
 * `missing_remittance` until the money has arrived. Pure; no I/O.
 */

export type SettlementClassification =
  | "matched"
  | "missing_in_hot"
  | "amount_mismatch"
  | "missing_remittance"
  | "unexpected_in_hot";

export const settlementClassifications: readonly SettlementClassification[] = [
  "matched",
  "missing_in_hot",
  "amount_mismatch",
  "missing_remittance",
  "unexpected_in_hot",
];

export interface LedgerExpectation {
  documentNumber: string;
  transactionCode: string;
  ledgerEntryId: number | null;
  bookingId: number | null;
  /** Net the BSP should remit for this document; negative for refunds. */
  expectedAmount: number;
  /** The RET line that reported it, when one exists. */
  retLineId: number | null;
}

export interface HotObservation {
  hotLineId: number;
  documentNumber: string;
  transactionCode: string;
  /** Net remitted for this document; negative for refunds. */
  netAmount: number;
}

export interface RemittanceObservation {
  id: number;
  amount: number;
}

export interface ReconciliationItem {
  documentNumber: string;
  transactionCode: string;
  ledgerEntryId: number | null;
  bookingId: number | null;
  retLineId: number | null;
  hotLineId: number | null;
  remittanceId: number | null;
  expectedAmount: number | null;
  hotAmount: number | null;
  classification: SettlementClassification;
}

export interface ReconciliationSummary {
  counts: Record<SettlementClassification, number>;
  itemCount: number;
  expectedNet: number;
  hotNet: number;
  remittedAmount: number;
  remittanceCovered: boolean;
  /** Ledger documents that no RET line reported. */
  notReportedInRet: number;
}

export interface ReconciliationResult {
  items: ReconciliationItem[];
  summary: ReconciliationSummary;
}

export const documentKey = (documentNumber: string, transactionCode: string) =>
  `${documentNumber}|${transactionCode}`;

export function classifySettlement(input: {
  expectations: readonly LedgerExpectation[];
  hotLines: readonly HotObservation[];
  remittances: readonly RemittanceObservation[];
}): ReconciliationResult {
  const hotByKey = new Map<string, HotObservation[]>();
  for (const h of input.hotLines) {
    const key = documentKey(h.documentNumber, h.transactionCode);
    hotByKey.set(key, [...(hotByKey.get(key) ?? []), h]);
  }
  const hotNet = input.hotLines.reduce((s, h) => s + h.netAmount, 0);
  const remittedAmount = input.remittances.reduce((s, r) => s + r.amount, 0);
  const remittanceCovered = remittedAmount === hotNet;
  const remittanceId =
    remittanceCovered && input.remittances.length === 1
      ? input.remittances[0].id
      : null;
  const items: ReconciliationItem[] = [];
  const counts: Record<SettlementClassification, number> = {
    matched: 0,
    missing_in_hot: 0,
    amount_mismatch: 0,
    missing_remittance: 0,
    unexpected_in_hot: 0,
  };
  let notReportedInRet = 0;
  for (const e of input.expectations) {
    if (e.retLineId === null) notReportedInRet++;
    const candidates = hotByKey.get(
      documentKey(e.documentNumber, e.transactionCode)
    );
    const hot = candidates?.shift() ?? null;
    let classification: SettlementClassification;
    if (!hot) classification = "missing_in_hot";
    else if (hot.netAmount !== e.expectedAmount)
      classification = "amount_mismatch";
    else if (!remittanceCovered) classification = "missing_remittance";
    else classification = "matched";
    counts[classification]++;
    items.push({
      documentNumber: e.documentNumber,
      transactionCode: e.transactionCode,
      ledgerEntryId: e.ledgerEntryId,
      bookingId: e.bookingId,
      retLineId: e.retLineId,
      hotLineId: hot?.hotLineId ?? null,
      remittanceId: classification === "matched" ? remittanceId : null,
      expectedAmount: e.expectedAmount,
      hotAmount: hot?.netAmount ?? null,
      classification,
    });
  }
  for (const leftovers of hotByKey.values())
    for (const hot of leftovers) {
      counts.unexpected_in_hot++;
      items.push({
        documentNumber: hot.documentNumber,
        transactionCode: hot.transactionCode,
        ledgerEntryId: null,
        bookingId: null,
        retLineId: null,
        hotLineId: hot.hotLineId,
        remittanceId: null,
        expectedAmount: null,
        hotAmount: hot.netAmount,
        classification: "unexpected_in_hot",
      });
    }
  return {
    items,
    summary: {
      counts,
      itemCount: items.length,
      expectedNet: input.expectations.reduce((s, e) => s + e.expectedAmount, 0),
      hotNet,
      remittedAmount,
      remittanceCovered,
      notReportedInRet,
    },
  };
}

export interface SettlementGate {
  status: "complete" | "blocked";
  openItems: number;
  dispositionedItems: number;
  matchedItems: number;
}

/** "Settlement complete" requires every item matched or dispositioned with a reason. */
export function settlementGate(
  items: readonly {
    classification: SettlementClassification;
    dispositionReason: string | null;
  }[]
): SettlementGate {
  let open = 0;
  let dispositioned = 0;
  let matched = 0;
  for (const item of items) {
    if (item.classification === "matched") matched++;
    else if (item.dispositionReason?.trim()) dispositioned++;
    else open++;
  }
  return {
    status: open === 0 ? "complete" : "blocked",
    openItems: open,
    dispositionedItems: dispositioned,
    matchedItems: matched,
  };
}
