import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import {
  airports,
  bookingAncillaries,
  bookingFareComponents,
  bookingSegments,
  flights,
  passengers,
  type Booking,
  type InsertBookingFareComponent,
} from "../../drizzle/schema";
import type { SettlementTx } from "./booking-settlement.service";
import { allocateProportional } from "./seat-economics.service";
import { offerFareLineSchema } from "./retail-offer.service";
import {
  resolveSegmentVat,
  splitGross,
  type VatRule,
  type JurisdictionVatConfig,
  DEFAULT_VAT_CONFIG,
} from "./tax-rules";

/**
 * Fare component ledger: base + taxes + surcharges + fees per passenger and
 * segment. Every write keeps `sum(amount) === bookings.totalAmount` for the
 * booking's current invoice; servicing and refunds append signed rows rather
 * than editing earlier ones so the history stays traceable.
 */

export type FareLine = z.infer<typeof offerFareLineSchema>;
export type NewFareComponent = Omit<
  InsertBookingFareComponent,
  "id" | "createdAt"
>;

/** Expected business rejection: the ledger disagrees with the invoice total. */
export class FareComponentsUnbalancedError extends Error {}

export interface ComponentLeg {
  flightId: number;
  segmentId?: number | null;
  /** Gross minor units for this leg (all passengers). */
  amount: number;
  /** Quoted per-passenger lines in passenger order, when the sale had them. */
  fareLines?: FareLine[] | null;
}

export interface SaleComponentsInput {
  booking: Pick<Booking, "id" | "tenantId">;
  passengers: Array<{ id: number; type: string }>;
  legs: ComponentLeg[];
  /** Booking-level fees (price lock fee, modification fee). */
  fees?: Array<{ code: "LCK" | "MOD"; amount: number }>;
  ancillaries?: Array<{ amount: number; passengerId?: number | null }>;
  reference: string;
  entryKind?: "sale" | "adjustment";
  currency?: string;
  vatConfig?: JurisdictionVatConfig;
}

export function sumComponents(rows: Array<{ amount: number }>) {
  return rows.reduce((sum, row) => sum + row.amount, 0);
}

export function vatOfComponents(rows: NewFareComponent[]) {
  return sumComponents(
    rows.filter(r => r.componentType === "tax" && r.code === "VAT")
  );
}

/** Country lookup for one flight; unresolved when reference data is missing. */
export async function segmentVatRule(
  tx: SettlementTx,
  flightId: number,
  config: JurisdictionVatConfig = DEFAULT_VAT_CONFIG
): Promise<VatRule> {
  const [flight] = await tx
    .select()
    .from(flights)
    .where(eq(flights.id, flightId))
    .limit(1);
  if (!flight)
    return resolveSegmentVat(
      { originCountry: null, destinationCountry: null },
      config
    );
  const [origin] = await tx
    .select()
    .from(airports)
    .where(eq(airports.id, flight.originId))
    .limit(1);
  const [destination] = await tx
    .select()
    .from(airports)
    .where(eq(airports.id, flight.destinationId))
    .limit(1);
  return resolveSegmentVat(
    {
      originCountry: origin?.country,
      destinationCountry: destination?.country,
    },
    config
  );
}

/** Fees and ancillaries follow the itinerary: a wholly zero-rated itinerary
 * zero-rates them; any domestic leg applies the domestic rate (conservative). */
export function itineraryVatRule(rules: VatRule[]): VatRule {
  const domestic = rules.find(r => r.applicability === "domestic_standard");
  if (domestic) return domestic;
  const international = rules.find(
    r => r.applicability === "international_zero_rated"
  );
  if (international) return international;
  return (
    rules.find(r => r.applicability === "out_of_scope") ??
    rules[0] ?? {
      applicability: "unresolved",
      jurisdiction: null,
      rateBasisPoints: 0,
      code: "VAT",
      confirmed: false,
      source: DEFAULT_VAT_CONFIG.source,
    }
  );
}

function taxRow(
  scope: Pick<
    NewFareComponent,
    "bookingId" | "tenantId" | "passengerId" | "flightId" | "segmentId"
  >,
  rule: VatRule,
  amount: number,
  basis: NewFareComponent["basis"],
  shared: Pick<NewFareComponent, "reference" | "entryKind" | "currency">
): NewFareComponent {
  return {
    ...scope,
    ...shared,
    componentType: "tax",
    code: rule.code,
    jurisdiction: rule.jurisdiction,
    rateBasisPoints:
      rule.applicability === "unresolved" ? null : rule.rateBasisPoints,
    amount,
    basis,
  };
}

/** Quoted line -> rows. The quote taxed the fare; fees are split by the rule so
 * `base + tax + fee` still equals the quoted line total. */
export function decomposeFareLine(
  scope: Pick<
    NewFareComponent,
    "bookingId" | "tenantId" | "passengerId" | "flightId" | "segmentId"
  >,
  line: FareLine,
  rule: VatRule,
  shared: Pick<NewFareComponent, "reference" | "entryKind" | "currency">
): NewFareComponent[] {
  if (line.baseFare + line.tax + line.bookingFee !== line.total)
    throw new FareComponentsUnbalancedError("Quoted fare line does not sum");
  const fee = splitGross(line.bookingFee, rule);
  const rows: NewFareComponent[] = [
    {
      ...scope,
      ...shared,
      componentType: "base",
      code: "FARE",
      jurisdiction: null,
      rateBasisPoints: null,
      amount: line.baseFare,
      basis: "fare_line",
    },
    taxRow(scope, rule, line.tax + fee.vat, "fare_line", shared),
  ];
  if (fee.net)
    rows.push({
      ...scope,
      ...shared,
      componentType: "fee",
      code: "BKF",
      jurisdiction: null,
      rateBasisPoints: null,
      amount: fee.net,
      basis: "fare_line",
    });
  return rows;
}

/** Gross amount with no quoted lines: back the VAT out per the rule. */
export function deriveGrossComponents(
  scope: Pick<
    NewFareComponent,
    "bookingId" | "tenantId" | "passengerId" | "flightId" | "segmentId"
  >,
  gross: number,
  rule: VatRule,
  component: { componentType: "base" | "fee"; code: string },
  shared: Pick<NewFareComponent, "reference" | "entryKind" | "currency">
): NewFareComponent[] {
  const basis: NewFareComponent["basis"] =
    rule.applicability === "unresolved" ? "unresolved" : "derived";
  const { net, vat } = splitGross(gross, rule);
  const rows: NewFareComponent[] = [
    {
      ...scope,
      ...shared,
      componentType: component.componentType,
      code: component.code,
      jurisdiction: null,
      rateBasisPoints: null,
      amount: net,
      basis,
    },
  ];
  if (rule.applicability !== "unresolved")
    rows.push(taxRow(scope, rule, vat, basis, shared));
  return rows;
}

export function buildSaleComponents(
  input: SaleComponentsInput,
  rules: Map<number, VatRule>
): NewFareComponent[] {
  const shared = {
    reference: input.reference,
    entryKind: input.entryKind ?? ("sale" as const),
    currency: input.currency ?? "SAR",
  };
  const rows: NewFareComponent[] = [];
  const legRules: VatRule[] = [];
  for (const leg of input.legs) {
    const rule = rules.get(leg.flightId);
    if (!rule) throw new Error(`Missing VAT rule for flight ${leg.flightId}`);
    legRules.push(rule);
    const lines = leg.fareLines
      ? z.array(offerFareLineSchema).parse(leg.fareLines)
      : null;
    const scopeFor = (passengerId: number | null) => ({
      bookingId: input.booking.id,
      tenantId: input.booking.tenantId,
      passengerId,
      flightId: leg.flightId,
      segmentId: leg.segmentId ?? null,
    });
    if (
      lines &&
      lines.length === input.passengers.length &&
      sumComponents(lines.map(l => ({ amount: l.total }))) === leg.amount
    ) {
      input.passengers.forEach((p, i) =>
        rows.push(...decomposeFareLine(scopeFor(p.id), lines[i], rule, shared))
      );
    } else {
      // Without passenger rows (channel or historical bookings) the leg is
      // decomposed at booking level rather than invented per passenger.
      const holders: Array<number | null> = input.passengers.length
        ? input.passengers.map(p => p.id)
        : [null];
      const shares = allocateProportional(
        leg.amount,
        holders.map(() => 1)
      );
      holders.forEach((passengerId, i) =>
        rows.push(
          ...deriveGrossComponents(
            scopeFor(passengerId),
            shares[i],
            rule,
            { componentType: "base", code: "FARE" },
            shared
          )
        )
      );
    }
  }
  const itinerary = itineraryVatRule(legRules);
  const bookingScope = {
    bookingId: input.booking.id,
    tenantId: input.booking.tenantId,
    passengerId: null,
    flightId: null,
    segmentId: null,
  };
  for (const fee of input.fees ?? [])
    rows.push(
      ...deriveGrossComponents(
        bookingScope,
        fee.amount,
        itinerary,
        { componentType: "fee", code: fee.code },
        shared
      )
    );
  for (const item of input.ancillaries ?? [])
    rows.push(
      ...deriveGrossComponents(
        { ...bookingScope, passengerId: item.passengerId ?? null },
        item.amount,
        itinerary,
        { componentType: "fee", code: "ANC" },
        shared
      )
    );
  const expected =
    sumComponents(input.legs) +
    sumComponents(input.fees ?? []) +
    sumComponents(input.ancillaries ?? []);
  if (sumComponents(rows) !== expected)
    throw new FareComponentsUnbalancedError(
      "Fare components do not conserve the sale amount"
    );
  return rows;
}

async function rulesFor(
  tx: SettlementTx,
  flightIds: number[],
  config?: JurisdictionVatConfig
) {
  const rules = new Map<number, VatRule>();
  for (const id of [...new Set(flightIds)].sort((a, b) => a - b))
    rules.set(id, await segmentVatRule(tx, id, config));
  return rules;
}

/** Called inside the sale transaction once passengers exist. */
export async function recordSaleFareComponents(
  tx: SettlementTx,
  input: SaleComponentsInput
) {
  const rows = buildSaleComponents(
    input,
    await rulesFor(
      tx,
      input.legs.map(l => l.flightId),
      input.vatConfig
    )
  );
  if (rows.length) await tx.insert(bookingFareComponents).values(rows);
  return rows;
}

export function listFareComponents(tx: SettlementTx, bookingId: number) {
  return tx
    .select()
    .from(bookingFareComponents)
    .where(eq(bookingFareComponents.bookingId, bookingId))
    .orderBy(asc(bookingFareComponents.id));
}

/** The ledger must equal the invoice total for the booking as it stands. */
export async function assertFareComponentsBalanced(
  tx: SettlementTx,
  bookingId: number,
  expectedTotal: number
) {
  const rows = await listFareComponents(tx, bookingId);
  const total = sumComponents(rows);
  if (total !== expectedTotal)
    throw new FareComponentsUnbalancedError(
      `Fare components (${total}) do not equal the booking total (${expectedTotal})`
    );
  return rows;
}

/** Settlement entry point: bookings created by paths without the sale hook
 * (channel, group, multi-city) get a derived decomposition before invoicing. */
export async function ensureSaleFareComponents(
  tx: SettlementTx,
  booking: Booking,
  reference = "settlement.derived",
  options: { excludeAncillaryIds?: number[] } = {}
) {
  // Existing rows may already carry refund reversals, so only a fresh
  // decomposition is checked against the invoice total here.
  const existing = await listFareComponents(tx, booking.id);
  if (existing.length) return existing;
  const pax = await tx
    .select({ id: passengers.id, type: passengers.type })
    .from(passengers)
    .where(eq(passengers.bookingId, booking.id))
    .orderBy(asc(passengers.id));
  const extras = (
    await tx
      .select()
      .from(bookingAncillaries)
      .where(eq(bookingAncillaries.bookingId, booking.id))
  ).filter(
    a =>
      a.status === "active" &&
      !(options.excludeAncillaryIds ?? []).includes(a.id)
  );
  const ancillaryTotal = sumComponents(
    extras.map(a => ({ amount: a.totalPrice }))
  );
  const fare = booking.totalAmount - ancillaryTotal;
  if (fare < 0)
    throw new FareComponentsUnbalancedError(
      "Ancillaries exceed the booking total"
    );
  const segments = await tx
    .select()
    .from(bookingSegments)
    .where(eq(bookingSegments.bookingId, booking.id))
    .orderBy(asc(bookingSegments.segmentOrder));
  const weights = segments.map(s =>
    s.segmentAmount == null || s.segmentAmount < 0 ? 1 : s.segmentAmount
  );
  const legAmounts = allocateProportional(fare, weights);
  const legs: ComponentLeg[] = segments.length
    ? segments.map((s, i) => ({
        flightId: s.flightId,
        segmentId: s.id,
        amount: legAmounts[i],
      }))
    : [{ flightId: booking.flightId, amount: fare }];
  await recordSaleFareComponents(tx, {
    booking,
    passengers: pax,
    legs,
    ancillaries: extras.map(a => ({
      amount: a.totalPrice,
      passengerId: a.passengerId,
    })),
    reference,
  });
  return assertFareComponentsBalanced(tx, booking.id, booking.totalAmount);
}

type GroupKey = string;
function groupKey(row: NewFareComponent) {
  return [
    row.passengerId ?? "",
    row.flightId ?? "",
    row.segmentId ?? "",
    row.componentType,
    row.code,
    row.jurisdiction ?? "",
    row.rateBasisPoints ?? "",
    row.currency,
  ].join("|");
}

/** Reverse `amount` minor units across the booking's net components, in
 * proportion, so taxes refund at the same rate they were charged. */
export async function recordReversalComponents(
  tx: SettlementTx,
  booking: Pick<Booking, "id" | "tenantId">,
  amount: number,
  reference: string,
  entryKind: "reversal" | "adjustment" = "reversal"
) {
  if (!Number.isSafeInteger(amount) || amount <= 0)
    throw new Error("Reversal amount must be positive minor units");
  const rows = await listFareComponents(tx, booking.id);
  const groups = new Map<GroupKey, NewFareComponent>();
  for (const row of rows) {
    const key = groupKey(row);
    const current = groups.get(key);
    if (current) current.amount += row.amount;
    else {
      const { id: _id, createdAt: _createdAt, ...rest } = row;
      groups.set(key, { ...rest, amount: row.amount });
    }
  }
  const net = [...groups.values()].filter(g => g.amount > 0);
  const available = sumComponents(net);
  if (amount > available)
    throw new FareComponentsUnbalancedError(
      `Reversal ${amount} exceeds net fare components ${available}`
    );
  const shares = allocateProportional(
    amount,
    net.map(g => g.amount)
  );
  const reversal: NewFareComponent[] = net.flatMap((g, i) =>
    shares[i]
      ? [{ ...g, amount: -shares[i], entryKind, reference, basis: g.basis }]
      : []
  );
  if (reversal.length) await tx.insert(bookingFareComponents).values(reversal);
  return reversal;
}

/** Itinerary exchange: reverse the current ledger and record the replacement
 * itinerary from its offers plus the modification fee. */
export async function recordExchangeComponents(
  tx: SettlementTx,
  booking: Booking,
  input: {
    passengers: Array<{ id: number; type: string }>;
    legs: ComponentLeg[];
    modificationFee: number;
    newAmount: number;
    reference: string;
  }
) {
  // Bookings paid before the ledger existed are decomposed from their
  // pre-exchange state so the reversal has something to cancel.
  await ensureSaleFareComponents(tx, booking, `${input.reference}:derived`);
  const current = sumComponents(await listFareComponents(tx, booking.id));
  const reversal =
    current > 0
      ? await recordReversalComponents(
          tx,
          booking,
          current,
          input.reference,
          "adjustment"
        )
      : [];
  const sale = await recordSaleFareComponents(tx, {
    booking,
    passengers: input.passengers,
    legs: input.legs,
    fees: input.modificationFee
      ? [{ code: "MOD", amount: input.modificationFee }]
      : [],
    reference: input.reference,
    entryKind: "adjustment",
  });
  await assertFareComponentsBalanced(tx, booking.id, input.newAmount);
  return { reversal, sale };
}

/** Added paid services after sale. */
export async function recordServiceComponents(
  tx: SettlementTx,
  booking: Booking,
  input: {
    ancillaries: Array<{ amount: number; passengerId?: number | null }>;
    /** Ancillary rows created by this servicing; excluded from any derived baseline. */
    createdAncillaryIds?: number[];
    newAmount: number;
    reference: string;
  }
) {
  await ensureSaleFareComponents(tx, booking, `${input.reference}:derived`, {
    excludeAncillaryIds: input.createdAncillaryIds ?? [],
  });
  const legs = await tx
    .select()
    .from(bookingSegments)
    .where(eq(bookingSegments.bookingId, booking.id));
  const flightIds = legs.length
    ? legs.map(l => l.flightId)
    : [booking.flightId];
  const rules = await rulesFor(tx, flightIds);
  // Services follow the itinerary rule of the real legs, not the added items.
  const itinerary = itineraryVatRule([...rules.values()]);
  const resolved: NewFareComponent[] = [];
  for (const item of input.ancillaries)
    resolved.push(
      ...deriveGrossComponents(
        {
          bookingId: booking.id,
          tenantId: booking.tenantId,
          passengerId: item.passengerId ?? null,
          flightId: null,
          segmentId: null,
        },
        item.amount,
        itinerary,
        { componentType: "fee", code: "ANC" },
        { reference: input.reference, entryKind: "adjustment", currency: "SAR" }
      )
    );
  if (resolved.length) await tx.insert(bookingFareComponents).values(resolved);
  await assertFareComponentsBalanced(tx, booking.id, input.newAmount);
  return { reversal: [] as NewFareComponent[], sale: resolved };
}
