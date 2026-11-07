/**
 * Fare component access for BSP reporting.
 *
 * `booking_fare_components` holds the priced lines (base fare, taxes,
 * carrier surcharges, fees, discounts) per passenger and sector.
 * `drizzleFareComponents` folds them into one document per passenger. When
 * the rows do not describe exactly the ticketed passengers, or do not sum to
 * the money in the ledger entry, the booking falls back to an even allocation
 * of the ledger amount with no tax split; such lines are stored as
 * `booking_total_fallback` and block transmission. A tax breakdown is never
 * invented.
 */
import { and, eq, isNull } from "drizzle-orm";
import { bookingFareComponents } from "../../../drizzle/schema";
import type { getDb } from "../../db";

type Db = NonNullable<ReturnType<typeof getDb>>;

export interface DocumentFareComponents {
  passengerId: number;
  /** Base fare for all segments of the passenger, minor units. */
  baseAmount: number;
  /** Taxes by type code (e.g. VAT, YQ); amounts in minor units. */
  taxes: Array<{ type: string; amount: number }>;
  /** Carrier surcharges and fees reported with the fare, minor units. */
  feeAmount: number;
}

export interface FareComponentSource {
  /** null = no usable component data for this booking. */
  read(bookingId: number): Promise<DocumentFareComponents[] | null>;
}

export const unavailableFareComponents: FareComponentSource = {
  read: () => Promise.resolve(null),
};

/** Component types that belong to the ticket document itself. Ancillaries are
 * EMD matter and `unclassified` rows carry no reportable meaning, so a booking
 * with either falls back rather than mislabelling them as fare. */
const DOCUMENT_TYPES = new Set([
  "base_fare",
  "tax",
  "carrier_surcharge",
  "booking_fee",
  "discount",
]);

export function drizzleFareComponents(
  db: Db,
  currency: string
): FareComponentSource {
  return {
    async read(bookingId) {
      const rows = await db
        .select()
        .from(bookingFareComponents)
        .where(
          and(
            eq(bookingFareComponents.bookingId, bookingId),
            isNull(bookingFareComponents.reversedAt)
          )
        );
      if (!rows.length) return null;
      const byPassenger = new Map<number, DocumentFareComponents>();
      for (const row of rows) {
        if (
          row.passengerId === null ||
          row.currency !== currency ||
          !DOCUMENT_TYPES.has(row.componentType)
        )
          return null;
        const doc = byPassenger.get(row.passengerId) ?? {
          passengerId: row.passengerId,
          baseAmount: 0,
          taxes: [],
          feeAmount: 0,
        };
        if (row.componentType === "tax") {
          const code = (row.code ?? "TAX").toUpperCase().slice(0, 8);
          const existing = doc.taxes.find(t => t.type === code);
          if (existing) existing.amount += row.amount;
          else doc.taxes.push({ type: code, amount: row.amount });
        } else if (
          row.componentType === "base_fare" ||
          row.componentType === "discount"
        )
          doc.baseAmount += row.amount;
        else doc.feeAmount += row.amount;
        byPassenger.set(row.passengerId, doc);
      }
      const docs = [...byPassenger.values()];
      // DISH amounts are unsigned and BKS30 carries three tax elements.
      if (
        docs.some(
          d =>
            d.baseAmount < 0 ||
            d.feeAmount < 0 ||
            d.taxes.length > 3 ||
            d.taxes.some(t => t.amount < 0)
        )
      )
        return null;
      return docs;
    },
  };
}

export interface AllocatedDocument {
  passengerId: number;
  baseAmount: number;
  taxes: Array<{ type: string; amount: number }>;
  feeAmount: number;
  source: "fare_components" | "booking_total_fallback";
}

/** Split an amount over passengers in order; the remainder lands on the first. */
export function allocateEvenly(
  total: number,
  passengerIds: readonly number[]
): Map<number, number> {
  if (!Number.isInteger(total) || total < 0)
    throw new RangeError("Allocation requires a non-negative integer");
  if (!passengerIds.length)
    throw new RangeError("No passengers to allocate to");
  const share = Math.floor(total / passengerIds.length);
  const remainder = total - share * passengerIds.length;
  return new Map(
    passengerIds.map((id, i) => [id, share + (i === 0 ? remainder : 0)])
  );
}

/** Resolve the components for the ticketed passengers of a booking. The
 * component data must cover exactly the ticketed passengers and sum to the
 * ledger amount; otherwise it is ignored and the fallback is used, so the
 * RET never disagrees with the money actually collected. */
export function resolveDocumentComponents(
  components: DocumentFareComponents[] | null,
  ledgerAmount: number,
  passengerIds: readonly number[]
): AllocatedDocument[] {
  if (components) {
    const byPassenger = new Map(components.map(c => [c.passengerId, c]));
    const sum = components.reduce(
      (s, c) =>
        s +
        c.baseAmount +
        c.feeAmount +
        c.taxes.reduce((t, x) => t + x.amount, 0),
      0
    );
    const resolved = passengerIds.map(id => byPassenger.get(id));
    if (
      resolved.every(c => c !== undefined) &&
      byPassenger.size === passengerIds.length &&
      sum === ledgerAmount
    )
      return resolved.map(c => ({
        passengerId: c.passengerId,
        baseAmount: c.baseAmount,
        taxes: c.taxes,
        feeAmount: c.feeAmount,
        source: "fare_components",
      }));
  }
  const shares = allocateEvenly(ledgerAmount, passengerIds);
  return passengerIds.map(id => ({
    passengerId: id,
    baseAmount: shares.get(id) ?? 0,
    taxes: [],
    feeAmount: 0,
    source: "booking_total_fallback",
  }));
}
