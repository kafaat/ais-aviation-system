// Passenger-rights rule model. Values are data with provenance; the engine
// never embeds an amount, a threshold or an exchange rate of its own.

export const JURISDICTIONS = [
  "KSA-GACA-2023",
  "EU261-2004",
  "EU261-2026-amended",
  "UK261",
  "US-DOT-14CFR260",
] as const;
export type Jurisdiction = (typeof JURISDICTIONS)[number];

export const CLAIM_TYPES = [
  "arrival_delay",
  "cancellation",
  "denied_boarding",
  "downgrade",
  "baggage_delay",
  "baggage_loss",
  "baggage_damage",
  "tarmac_delay",
  "care",
  "refund_timeline",
] as const;
export type ClaimType = (typeof CLAIM_TYPES)[number];

/** How far the stored value has been verified against the governing text. */
export const CONFIRMATION_STATUSES = [
  "official",
  "secondary",
  "disputed",
  "not_yet_applicable",
] as const;
export type ConfirmationStatus = (typeof CONFIRMATION_STATUSES)[number];

export interface Source {
  url: string;
  title: string;
  kind: "official" | "secondary";
}

/** Inclusive/exclusive bounds; absent means unbounded. */
export interface Bound {
  gte?: number;
  gt?: number;
  lte?: number;
  lt?: number;
}

export interface Thresholds {
  /** Arrival delay for delay rules; departure delay for care rules. */
  delayMinutes?: Bound;
  distanceKm?: Bound;
  /** Baggage delay in whole days. */
  delayDays?: Bound;
  tarmacMinutes?: Bound;
  /** Delay of the alternative flight's arrival (denied boarding tiers). */
  alternativeArrivalDelayMinutes?: Bound;
  routeScope?: "domestic" | "international";
  /** Rule only covers flights departing the jurisdiction. */
  departureOnly?: boolean;
}

export type AmountModel =
  | { kind: "fixed"; minorUnits: number; currency: string }
  | {
      kind: "percentage_of_ticket";
      percent: number;
      capMinorUnits?: number;
      currency?: string;
    }
  | { kind: "sdr"; units: number }
  | {
      kind: "daily_capped";
      currency: string;
      dailyMinorUnits: number;
      firstDayMinorUnits?: number;
      maxDays: number;
    }
  | {
      kind: "receipt_reimbursement";
      currency: string;
      /** Absent: no statutory cap; reasonableness is reviewed. */
      capMinorUnits?: number;
    }
  | { kind: "ticket_refund" }
  | { kind: "fee_refund"; description: string }
  | { kind: "unspecified"; description: string };

export interface Reduction {
  percent: number;
  /** Applies when rerouting arrives within this many minutes of schedule. */
  reroutedArrivalWithinMinutes: number;
}

export interface CareEntitlements {
  meals?: boolean;
  refreshments?: boolean;
  hotel?: boolean;
  transport?: boolean;
  communications?: number;
}

export interface TimeLimits {
  refundCardBusinessDays?: number;
  refundOtherCalendarDays?: number;
  claimDocumentDutyHours?: number;
  claimWindowMonths?: number;
}

/** Exclusions the engine can test from recorded facts. */
export interface ExclusionChecks {
  extraordinaryCircumstances?: boolean;
  passengerCaused?: boolean;
  voluntaryDeniedBoarding?: boolean;
  cancellationNoticeDaysAtLeast?: number;
  alternativeDepartureWithinMinutes?: number;
}

export interface Rule {
  code: string;
  jurisdiction: Jurisdiction;
  claimTypes: ClaimType[];
  title: string;
  article?: string;
  thresholds?: Thresholds;
  amount: AmountModel;
  reduction?: Reduction;
  care?: CareEntitlements;
  timeLimits?: TimeLimits;
  /** Reviewer-assessed grounds that defeat the entitlement. */
  exclusions?: string[];
  exclusionChecks?: ExclusionChecks;
  sources: Source[];
  confirmationStatus: ConfirmationStatus;
  /** Conflicting candidates share a group; exactly one may be confirmed. */
  disputeGroup?: string;
  candidate?: string;
  note?: string;
}

export interface RuleSet {
  jurisdiction: Jurisdiction;
  version: string;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  sourceUrl: string;
  sourceKind: "official" | "secondary";
  confirmationStatus: ConfirmationStatus;
  governingLanguage: string;
  notes: string;
  rules: Rule[];
}

/** Operator confirmation of a non-official value, recorded with a reference. */
export interface RuleConfirmation {
  ruleCode: string;
  confirmedAt: string;
  reference: string;
  decision: "confirmed" | "rejected";
}

export interface FxRecord {
  id: number | string;
  fromCurrency: string;
  toCurrency: string;
  /** Decimal string, e.g. "5.123456"; parsed exactly, never as a float. */
  rate: string;
  validFrom: string;
  source: string;
}

export interface EvidenceRef {
  reference: string;
}

export interface ItineraryContext {
  operatingCarrier: { code?: string; country: string };
  departure: { airport?: string; country: string };
  arrival: { airport?: string; country: string };
  scheduledDepartureUtc: string;
  scheduledArrivalUtc: string;
  distanceKm?: { value: number; source: string };
}

export interface ClaimFacts {
  arrivalDelayMinutes?: { value: number } & EvidenceRef;
  departureDelayMinutes?: { value: number } & EvidenceRef;
  cancellation?: {
    noticeDays?: number;
    reroutedArrivalDelayMinutes?: number;
  } & EvidenceRef;
  deniedBoarding?: {
    involuntary: boolean;
    alternativeArrivalDelayMinutes?: number;
    alternativeDepartureWithinMinutes?: number;
  } & EvidenceRef;
  downgrade?: EvidenceRef;
  baggage?: {
    delayDays?: number;
    receiptsMinorUnits?: number;
    receiptsCurrency?: string;
  } & EvidenceRef;
  tarmacMinutes?: { value: number } & EvidenceRef;
  careExpenses?: {
    receiptsMinorUnits: number;
    receiptsCurrency: string;
  } & EvidenceRef;
  /** When an involuntary refund became due and how the ticket was paid. */
  refundTrigger?: {
    triggeredAt: string;
    tenderClass: "card" | "other";
  } & EvidenceRef;
  extraordinaryCircumstances?: boolean;
  passengerCaused?: boolean;
}

export interface TicketValue {
  minorUnits: number;
  currency: string;
  basis: string;
  reference: string;
}

export interface ClaimContext {
  claimType: ClaimType;
  itinerary: ItineraryContext;
  facts: ClaimFacts;
  ticketValue?: TicketValue;
  settlementCurrency: string;
  fxRecords: FxRecord[];
  evaluatedAt: string;
  confirmations?: RuleConfirmation[];
  /** Restrict evaluation to one basis (the filed regulation). */
  jurisdictions?: Jurisdiction[];
}

export type DeterminationStatus =
  | "applicable"
  | "not_applicable"
  | "not_yet_applicable"
  | "requires_review";

export interface JurisdictionDetermination {
  jurisdiction: Jurisdiction;
  status: DeterminationStatus;
  reasons: string[];
  basis: string;
  version: string;
}

export const ENTITLEMENT_STATUSES = [
  "awardable",
  "needs_confirmation",
  "blocked_disputed",
  "fx_required",
  "ticket_value_required",
  "distance_required",
  "amount_unspecified",
  "not_met",
  "excluded",
  "not_yet_applicable",
] as const;
export type EntitlementStatus = (typeof ENTITLEMENT_STATUSES)[number];

export interface Money {
  minorUnits: number;
  currency: string;
}

export interface Settlement extends Money {
  fxRecordId: number | string | null;
  rate: string | null;
  fxSource: string | null;
}

export interface Entitlement {
  ruleCode: string;
  jurisdiction: Jurisdiction;
  claimType: ClaimType;
  title: string;
  article?: string;
  status: EntitlementStatus;
  amount: Money | null;
  settlement: Settlement | null;
  care?: CareEntitlements;
  explanation: string[];
  sources: Source[];
  confirmationStatus: ConfirmationStatus;
}

export interface Deadline {
  ruleCode: string;
  kind: "refund_due" | "claim_document_duty" | "claim_window";
  dueAt: string;
  basis: string;
}

export interface Evaluation {
  version: 1;
  nonBinding: true;
  evaluatedAt: string;
  claimType: ClaimType;
  jurisdictions: JurisdictionDetermination[];
  rulesConsidered: string[];
  entitlements: Entitlement[];
  deadlines: Deadline[];
  inputs: {
    itinerary: ItineraryContext;
    facts: ClaimFacts;
    ticketValue: TicketValue | null;
    settlementCurrency: string;
    fxRecordIds: Array<number | string>;
  };
}
