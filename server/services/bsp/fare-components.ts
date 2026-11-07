/**
 * Fare component access for BSP reporting.
 *
 * Dependency: the fare-components workstream adds `booking_fare_components`
 * (base, tax and fee per passenger per segment). Until that table exists on
 * this branch, `unavailableFareComponents` returns null and RET generation
 * falls back to an even allocation of the ledger amount with no tax split.
 * Files containing fallback lines are stored with `fallbackLineCount > 0`
 * and refused for transmission: a tax breakdown is never invented.
 *
 * Wiring the real source is a one-line change in bsp-settlement.service.ts:
 * implement `FareComponentSource` over the new table and pass it in.
 */

export interface DocumentFareComponents {
  passengerId: number;
  /** Base fare for all segments of the passenger, minor units. */
  baseAmount: number;
  /** Taxes by type code (e.g. VAT, YQ); amounts in minor units. */
  taxes: Array<{ type: string; amount: number }>;
  /** Carrier fees reported with the fare (not taxes), minor units. */
  feeAmount: number;
}

export interface FareComponentSource {
  /** null = no component data for this booking. */
  read(bookingId: number): Promise<DocumentFareComponents[] | null>;
}

export const unavailableFareComponents: FareComponentSource = {
  read: async () => null,
};

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
    const covered = passengerIds.every(id => byPassenger.has(id));
    const sum = components.reduce(
      (s, c) =>
        s +
        c.baseAmount +
        c.feeAmount +
        c.taxes.reduce((t, x) => t + x.amount, 0),
      0
    );
    if (
      covered &&
      byPassenger.size === passengerIds.length &&
      sum === ledgerAmount
    )
      return passengerIds.map(id => {
        const c = byPassenger.get(id)!;
        return {
          passengerId: id,
          baseAmount: c.baseAmount,
          taxes: c.taxes,
          feeAmount: c.feeAmount,
          source: "fare_components",
        };
      });
  }
  const shares = allocateEvenly(ledgerAmount, passengerIds);
  return passengerIds.map(id => ({
    passengerId: id,
    baseAmount: shares.get(id)!,
    taxes: [],
    feeAmount: 0,
    source: "booking_total_fallback",
  }));
}
