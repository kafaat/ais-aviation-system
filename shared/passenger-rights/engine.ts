// Pure passenger-rights engine. Input: a claim context with evidence
// references, the rule sets and dated FX records. Output: the full evaluation
// trace that the service stores as review evidence. No I/O, no clock.
import {
  determineJurisdictions,
  EU261_TERRITORY,
  normalizeCountry,
} from "./jurisdiction";
import {
  addBusinessDays,
  addCalendarDays,
  convertMinorUnits,
  percentOf,
  selectFxRecord,
} from "./money";
import { PASSENGER_RIGHTS_RULE_SETS } from "./rule-sets";
import type {
  Bound,
  ClaimContext,
  ClaimType,
  Deadline,
  Entitlement,
  EntitlementStatus,
  Evaluation,
  Jurisdiction,
  JurisdictionDetermination,
  Money,
  Rule,
  RuleSet,
  Settlement,
} from "./types";

export function withinBound(value: number, bound: Bound | undefined): boolean {
  if (!bound) return true;
  if (bound.gte !== undefined && !(value >= bound.gte)) return false;
  if (bound.gt !== undefined && !(value > bound.gt)) return false;
  if (bound.lte !== undefined && !(value <= bound.lte)) return false;
  if (bound.lt !== undefined && !(value < bound.lt)) return false;
  return true;
}

function describeBound(bound: Bound): string {
  const parts: string[] = [];
  if (bound.gte !== undefined) parts.push(`>= ${bound.gte}`);
  if (bound.gt !== undefined) parts.push(`> ${bound.gt}`);
  if (bound.lte !== undefined) parts.push(`<= ${bound.lte}`);
  if (bound.lt !== undefined) parts.push(`< ${bound.lt}`);
  return parts.join(" and ");
}

function homeTerritory(jurisdiction: Jurisdiction, country: string): boolean {
  switch (jurisdiction) {
    case "KSA-GACA-2023":
      return country === "SA";
    case "UK261":
      return country === "GB";
    case "US-DOT-14CFR260":
      return country === "US";
    default:
      return EU261_TERRITORY.has(country);
  }
}

type Outcome =
  | { status: "ok"; amount: Money | null; notes: string[] }
  | { status: Exclude<EntitlementStatus, "awardable">; notes: string[] };

function delayFactFor(context: ClaimContext, rule: Rule): number | undefined {
  if (rule.claimTypes.includes("care") && context.claimType === "care")
    return context.facts.departureDelayMinutes?.value;
  if (context.claimType === "arrival_delay")
    return context.facts.arrivalDelayMinutes?.value;
  return undefined;
}

function checkThresholds(context: ClaimContext, rule: Rule): Outcome | null {
  const t = rule.thresholds;
  if (!t) return null;
  const notes: string[] = [];
  const dep = normalizeCountry(context.itinerary.departure.country);
  const arr = normalizeCountry(context.itinerary.arrival.country);
  if (t.routeScope) {
    const scope = dep === arr ? "domestic" : "international";
    if (scope !== t.routeScope)
      return {
        status: "not_met",
        notes: [`Rule covers ${t.routeScope} routes; this route is ${scope}`],
      };
    notes.push(`Route scope ${scope} (${dep} to ${arr})`);
  }
  if (t.departureOnly && !homeTerritory(rule.jurisdiction, dep))
    return {
      status: "not_met",
      notes: [
        `Rule covers departures from the jurisdiction only; departure is ${dep}`,
      ],
    };
  if (t.delayMinutes && context.claimType !== "cancellation") {
    const delay = delayFactFor(context, rule);
    if (delay === undefined)
      return {
        status: "not_met",
        notes: ["Delay evidence not recorded for this claim type"],
      };
    if (!withinBound(delay, t.delayMinutes))
      return {
        status: "not_met",
        notes: [
          `Delay of ${delay} minutes is outside ${describeBound(t.delayMinutes)}`,
        ],
      };
    notes.push(
      `Delay ${delay} minutes satisfies ${describeBound(t.delayMinutes)}`
    );
  }
  if (t.distanceKm) {
    const distance = context.itinerary.distanceKm;
    if (!distance)
      return {
        status: "distance_required",
        notes: ["Great-circle distance with a named source is required"],
      };
    if (!withinBound(distance.value, t.distanceKm))
      return {
        status: "not_met",
        notes: [
          `Distance ${distance.value} km is outside ${describeBound(t.distanceKm)}`,
        ],
      };
    notes.push(
      `Distance ${distance.value} km (${distance.source}) satisfies ${describeBound(t.distanceKm)}`
    );
  }
  if (t.delayDays) {
    const days = context.facts.baggage?.delayDays;
    if (days === undefined)
      return { status: "not_met", notes: ["Baggage delay days not recorded"] };
    if (!withinBound(days, t.delayDays))
      return {
        status: "not_met",
        notes: [
          `Baggage delay of ${days} days is outside ${describeBound(t.delayDays)}`,
        ],
      };
  }
  if (t.tarmacMinutes) {
    const tarmac = context.facts.tarmacMinutes?.value;
    if (tarmac === undefined)
      return { status: "not_met", notes: ["Tarmac delay not recorded"] };
    if (!withinBound(tarmac, t.tarmacMinutes))
      return {
        status: "not_met",
        notes: [
          `Tarmac delay of ${tarmac} minutes is outside ${describeBound(t.tarmacMinutes)}`,
        ],
      };
  }
  if (t.alternativeArrivalDelayMinutes) {
    const alt = context.facts.deniedBoarding?.alternativeArrivalDelayMinutes;
    if (alt === undefined)
      return {
        status: "not_met",
        notes: ["Arrival delay of the alternative transportation not recorded"],
      };
    if (!withinBound(alt, t.alternativeArrivalDelayMinutes))
      return {
        status: "not_met",
        notes: [
          `Alternative arrival delay of ${alt} minutes is outside ${describeBound(t.alternativeArrivalDelayMinutes)}`,
        ],
      };
  }
  return notes.length ? { status: "ok", amount: null, notes } : null;
}

function checkExclusions(context: ClaimContext, rule: Rule): string | null {
  const checks = rule.exclusionChecks;
  if (!checks) return null;
  const f = context.facts;
  if (checks.extraordinaryCircumstances && f.extraordinaryCircumstances)
    return "Extraordinary circumstances recorded by the reviewer";
  if (checks.passengerCaused && f.passengerCaused)
    return "Passenger-caused disruption recorded by the reviewer";
  if (
    checks.voluntaryDeniedBoarding &&
    context.claimType === "denied_boarding" &&
    f.deniedBoarding &&
    !f.deniedBoarding.involuntary
  )
    return "Voluntary surrender of the seat";
  if (
    checks.cancellationNoticeDaysAtLeast !== undefined &&
    context.claimType === "cancellation" &&
    f.cancellation?.noticeDays !== undefined &&
    f.cancellation.noticeDays >= checks.cancellationNoticeDaysAtLeast
  )
    return `Cancellation notified ${f.cancellation.noticeDays} days before departure (at least ${checks.cancellationNoticeDaysAtLeast})`;
  if (
    checks.alternativeDepartureWithinMinutes !== undefined &&
    context.claimType === "denied_boarding" &&
    f.deniedBoarding?.alternativeDepartureWithinMinutes !== undefined &&
    f.deniedBoarding.alternativeDepartureWithinMinutes <=
      checks.alternativeDepartureWithinMinutes
  )
    return `Alternative flight within ${checks.alternativeDepartureWithinMinutes} minutes of scheduled departure`;
  return null;
}

function reroutedDelay(context: ClaimContext): number | undefined {
  switch (context.claimType) {
    case "arrival_delay":
      return context.facts.arrivalDelayMinutes?.value;
    case "cancellation":
      return context.facts.cancellation?.reroutedArrivalDelayMinutes;
    case "denied_boarding":
      return context.facts.deniedBoarding?.alternativeArrivalDelayMinutes;
    default:
      return undefined;
  }
}

function convertOrRequire(
  context: ClaimContext,
  amount: Money,
  toCurrency: string
): {
  converted: Money;
  fxRecordId: number | string | null;
  rate: string | null;
  fxSource: string | null;
} | null {
  if (amount.currency === toCurrency)
    return { converted: amount, fxRecordId: null, rate: null, fxSource: null };
  const record = selectFxRecord(
    context.fxRecords,
    amount.currency,
    toCurrency,
    context.evaluatedAt
  );
  if (!record) return null;
  return {
    converted: {
      minorUnits: convertMinorUnits(amount.minorUnits, record.rate),
      currency: toCurrency,
    },
    fxRecordId: record.id,
    rate: record.rate,
    fxSource: record.source,
  };
}

function computeAmount(context: ClaimContext, rule: Rule): Outcome {
  const model = rule.amount;
  const notes: string[] = [];
  switch (model.kind) {
    case "fixed": {
      let amount: Money = {
        minorUnits: model.minorUnits,
        currency: model.currency,
      };
      notes.push(`Fixed amount ${model.currency} ${model.minorUnits / 100}`);
      if (rule.reduction) {
        const delay = reroutedDelay(context);
        if (
          delay !== undefined &&
          delay <= rule.reduction.reroutedArrivalWithinMinutes
        ) {
          amount = {
            ...amount,
            minorUnits: percentOf(
              amount.minorUnits,
              100 - rule.reduction.percent
            ),
          };
          notes.push(
            `Reduced by ${rule.reduction.percent}%: arrival within ${rule.reduction.reroutedArrivalWithinMinutes} minutes of schedule`
          );
        }
      }
      return { status: "ok", amount, notes };
    }
    case "sdr":
      notes.push(
        `${model.units} SDR (XDR), independent of settlement currency`
      );
      return {
        status: "ok",
        amount: { minorUnits: model.units * 100, currency: "XDR" },
        notes,
      };
    case "percentage_of_ticket": {
      const ticket = context.ticketValue;
      if (!ticket)
        return {
          status: "ticket_value_required",
          notes: ["Ticket value with its basis and reference is required"],
        };
      let minorUnits = percentOf(ticket.minorUnits, model.percent);
      notes.push(
        `${model.percent}% of ticket value ${ticket.currency} ${ticket.minorUnits / 100} (${ticket.basis}; ${ticket.reference})`
      );
      if (model.capMinorUnits !== undefined && model.currency) {
        const cap = convertOrRequire(
          context,
          { minorUnits: model.capMinorUnits, currency: model.currency },
          ticket.currency
        );
        if (!cap)
          notes.push(
            `Cap ${model.currency} ${model.capMinorUnits / 100} not applied: no dated FX record to ${ticket.currency}; reviewer must apply it`
          );
        else if (cap.converted.minorUnits < minorUnits) {
          minorUnits = cap.converted.minorUnits;
          notes.push(
            `Capped at ${model.currency} ${model.capMinorUnits / 100}${cap.rate ? ` (FX record ${cap.fxRecordId} at ${cap.rate})` : ""}`
          );
        }
      }
      return {
        status: "ok",
        amount: { minorUnits, currency: ticket.currency },
        notes,
      };
    }
    case "daily_capped": {
      const days = context.facts.baggage?.delayDays;
      if (days === undefined || days < 1)
        return {
          status: "not_met",
          notes: ["Baggage delay days not recorded"],
        };
      const counted = Math.min(Math.floor(days), model.maxDays);
      const first = model.firstDayMinorUnits ?? model.dailyMinorUnits;
      const minorUnits = first + model.dailyMinorUnits * (counted - 1);
      notes.push(
        `${counted} of ${days} days counted (max ${model.maxDays}); first day ${model.currency} ${first / 100}, then ${model.currency} ${model.dailyMinorUnits / 100} per day`
      );
      return {
        status: "ok",
        amount: { minorUnits, currency: model.currency },
        notes,
      };
    }
    case "receipt_reimbursement": {
      const receipts =
        context.claimType === "care"
          ? context.facts.careExpenses && {
              minorUnits: context.facts.careExpenses.receiptsMinorUnits,
              currency: context.facts.careExpenses.receiptsCurrency,
              reference: context.facts.careExpenses.reference,
            }
          : context.facts.baggage?.receiptsMinorUnits !== undefined &&
              context.facts.baggage.receiptsCurrency
            ? {
                minorUnits: context.facts.baggage.receiptsMinorUnits,
                currency: context.facts.baggage.receiptsCurrency,
                reference: context.facts.baggage.reference,
              }
            : undefined;
      if (!receipts)
        return {
          status: "not_met",
          notes: ["Receipts with amount, currency and reference are required"],
        };
      notes.push(
        `Receipts ${receipts.currency} ${receipts.minorUnits / 100} (${receipts.reference})`
      );
      if (model.capMinorUnits === undefined)
        return {
          status: "ok",
          amount: {
            minorUnits: receipts.minorUnits,
            currency: receipts.currency,
          },
          notes: [...notes, "No statutory cap; reasonableness reviewed"],
        };
      const inRuleCurrency = convertOrRequire(
        context,
        { minorUnits: receipts.minorUnits, currency: receipts.currency },
        model.currency
      );
      if (!inRuleCurrency)
        return {
          status: "fx_required",
          notes: [
            ...notes,
            `No dated FX record from ${receipts.currency} to ${model.currency} for the cap comparison`,
          ],
        };
      if (inRuleCurrency.rate)
        notes.push(
          `Receipts converted at FX record ${inRuleCurrency.fxRecordId} (${inRuleCurrency.rate})`
        );
      const minorUnits = Math.min(
        inRuleCurrency.converted.minorUnits,
        model.capMinorUnits
      );
      if (minorUnits < inRuleCurrency.converted.minorUnits)
        notes.push(`Capped at ${model.currency} ${model.capMinorUnits / 100}`);
      return {
        status: "ok",
        amount: { minorUnits, currency: model.currency },
        notes,
      };
    }
    case "ticket_refund": {
      const ticket = context.ticketValue;
      if (!ticket)
        return {
          status: "ticket_value_required",
          notes: ["Refund of the unused ticket; ticket value required"],
        };
      return {
        status: "ok",
        amount: { minorUnits: ticket.minorUnits, currency: ticket.currency },
        notes: [
          `Refund of the unused ticket value (${ticket.basis}; ${ticket.reference})`,
        ],
      };
    }
    case "fee_refund":
    case "unspecified":
      return { status: "amount_unspecified", notes: [model.description] };
  }
}

function confirmationOutcome(
  context: ClaimContext,
  rule: Rule,
  ruleSet: RuleSet,
  determination: JurisdictionDetermination
): { status: EntitlementStatus; notes: string[] } {
  const confirmations = context.confirmations ?? [];
  const mine = confirmations.filter(c => c.ruleCode === rule.code);
  if (mine.some(c => c.decision === "rejected"))
    return {
      status: "blocked_disputed",
      notes: ["Operator rejected this value"],
    };
  const confirmed = mine.find(c => c.decision === "confirmed");
  if (determination.status === "requires_review")
    return {
      status: "needs_confirmation",
      notes: ["Jurisdiction scope requires reviewer confirmation"],
    };
  if (rule.confirmationStatus === "disputed") {
    if (!confirmed)
      return {
        status: "blocked_disputed",
        notes: [
          `Sources conflict (group ${rule.disputeGroup}); operator confirmation against the governing text is required before an award`,
        ],
      };
    const rival = ruleSet.rules.find(
      r =>
        r.disputeGroup === rule.disputeGroup &&
        r.candidate !== rule.candidate &&
        confirmations.some(
          c => c.ruleCode === r.code && c.decision === "confirmed"
        )
    );
    if (rival)
      return {
        status: "blocked_disputed",
        notes: [
          `Conflicting candidate ${rival.code} is also confirmed; resolve the dispute group first`,
        ],
      };
    return {
      status: "awardable",
      notes: [`Candidate ${rule.candidate} confirmed: ${confirmed.reference}`],
    };
  }
  if (rule.confirmationStatus === "secondary") {
    if (confirmed)
      return {
        status: "awardable",
        notes: [`Value confirmed by operator: ${confirmed.reference}`],
      };
    return {
      status: "needs_confirmation",
      notes: [
        "Value rests on secondary sources; operator confirmation against the governing text is required before an award",
      ],
    };
  }
  return { status: "awardable", notes: ["Value read from the governing text"] };
}

/** A rule set that is not yet in force never yields anything but planning data. */
function evaluateRule(
  context: ClaimContext,
  rule: Rule,
  ruleSet: RuleSet,
  determination: JurisdictionDetermination
): Entitlement {
  const result = evaluateApplicableRule(context, rule, ruleSet, determination);
  if (determination.status !== "not_yet_applicable") return result;
  return {
    ...result,
    status: "not_yet_applicable",
    explanation: [...result.explanation, ...determination.reasons],
  };
}

function evaluateApplicableRule(
  context: ClaimContext,
  rule: Rule,
  ruleSet: RuleSet,
  determination: JurisdictionDetermination
): Entitlement {
  const base = {
    ruleCode: rule.code,
    jurisdiction: rule.jurisdiction,
    claimType: context.claimType,
    title: rule.title,
    article: rule.article,
    care: rule.care,
    sources: rule.sources,
    confirmationStatus: rule.confirmationStatus,
  };
  const explanation: string[] = [];
  const thresholds = checkThresholds(context, rule);
  if (thresholds && thresholds.status !== "ok")
    return {
      ...base,
      status: thresholds.status,
      amount: null,
      settlement: null,
      explanation: thresholds.notes,
    };
  if (thresholds) explanation.push(...thresholds.notes);
  const excluded = checkExclusions(context, rule);
  if (excluded)
    return {
      ...base,
      status: "excluded",
      amount: null,
      settlement: null,
      explanation: [...explanation, `Excluded: ${excluded}`],
    };
  const outcome = computeAmount(context, rule);
  if (outcome.status !== "ok")
    return {
      ...base,
      status: outcome.status,
      amount: null,
      settlement: null,
      explanation: [...explanation, ...outcome.notes],
    };
  explanation.push(...outcome.notes);
  let settlement: Settlement | null = null;
  if (outcome.amount) {
    const converted = convertOrRequire(
      context,
      outcome.amount,
      context.settlementCurrency
    );
    if (!converted)
      return {
        ...base,
        status: "fx_required",
        amount: outcome.amount,
        settlement: null,
        explanation: [
          ...explanation,
          `No dated FX record from ${outcome.amount.currency} to ${context.settlementCurrency} valid at ${context.evaluatedAt}`,
        ],
      };
    settlement = {
      ...converted.converted,
      fxRecordId: converted.fxRecordId,
      rate: converted.rate,
      fxSource: converted.fxSource,
    };
    if (converted.rate)
      explanation.push(
        `Converted at FX record ${converted.fxRecordId} (${converted.rate}, ${converted.fxSource}) to ${context.settlementCurrency} ${settlement.minorUnits / 100}`
      );
  }
  const confirmation = confirmationOutcome(
    context,
    rule,
    ruleSet,
    determination
  );
  return {
    ...base,
    status: confirmation.status,
    amount: outcome.amount,
    settlement,
    explanation: [...explanation, ...confirmation.notes],
  };
}

function deadlinesFor(context: ClaimContext, rule: Rule): Deadline[] {
  const limits = rule.timeLimits;
  if (!limits) return [];
  const out: Deadline[] = [];
  const trigger = context.facts.refundTrigger;
  if (trigger) {
    const start = new Date(trigger.triggeredAt);
    if (
      trigger.tenderClass === "card" &&
      limits.refundCardBusinessDays !== undefined
    )
      out.push({
        ruleCode: rule.code,
        kind: "refund_due",
        dueAt: addBusinessDays(
          start,
          limits.refundCardBusinessDays
        ).toISOString(),
        basis: `${limits.refundCardBusinessDays} business days from ${trigger.triggeredAt} (weekends excluded; US federal holidays not modelled)`,
      });
    if (
      trigger.tenderClass === "other" &&
      limits.refundOtherCalendarDays !== undefined
    )
      out.push({
        ruleCode: rule.code,
        kind: "refund_due",
        dueAt: addCalendarDays(
          start,
          limits.refundOtherCalendarDays
        ).toISOString(),
        basis: `${limits.refundOtherCalendarDays} calendar days from ${trigger.triggeredAt}`,
      });
  }
  const departure = new Date(context.itinerary.scheduledDepartureUtc);
  if (limits.claimDocumentDutyHours !== undefined)
    out.push({
      ruleCode: rule.code,
      kind: "claim_document_duty",
      dueAt: new Date(
        departure.getTime() + limits.claimDocumentDutyHours * 3_600_000
      ).toISOString(),
      basis: `${limits.claimDocumentDutyHours} hours from scheduled departure`,
    });
  if (limits.claimWindowMonths !== undefined) {
    const end = new Date(departure.getTime());
    end.setUTCMonth(end.getUTCMonth() + limits.claimWindowMonths);
    out.push({
      ruleCode: rule.code,
      kind: "claim_window",
      dueAt: end.toISOString(),
      basis: `${limits.claimWindowMonths} months from scheduled departure`,
    });
  }
  return out;
}

export function evaluateClaim(
  context: ClaimContext,
  ruleSets: RuleSet[] = PASSENGER_RIGHTS_RULE_SETS
): Evaluation {
  const jurisdictions = determineJurisdictions(
    context.itinerary,
    context.evaluatedAt,
    ruleSets
  );
  const restricted = context.jurisdictions;
  const rulesConsidered: string[] = [];
  const entitlements: Entitlement[] = [];
  const deadlines: Deadline[] = [];
  for (const set of ruleSets) {
    if (restricted && !restricted.includes(set.jurisdiction)) continue;
    const determination = jurisdictions.find(
      j => j.jurisdiction === set.jurisdiction
    );
    if (!determination || determination.status === "not_applicable") continue;
    for (const rule of set.rules) {
      if (!rule.claimTypes.includes(context.claimType)) continue;
      rulesConsidered.push(rule.code);
      entitlements.push(evaluateRule(context, rule, set, determination));
      if (determination.status !== "not_yet_applicable")
        deadlines.push(...deadlinesFor(context, rule));
    }
  }
  return {
    version: 1,
    nonBinding: true,
    evaluatedAt: context.evaluatedAt,
    claimType: context.claimType,
    jurisdictions,
    rulesConsidered,
    entitlements,
    deadlines,
    inputs: {
      itinerary: context.itinerary,
      facts: context.facts,
      ticketValue: context.ticketValue ?? null,
      settlementCurrency: context.settlementCurrency,
      fxRecordIds: context.fxRecords.map(r => r.id),
    },
  };
}

/** The single entitlement an award may rest on, or the reason it cannot. */
export function awardableEntitlement(
  evaluation: Evaluation,
  ruleCode: string
): { ok: true; entitlement: Entitlement } | { ok: false; reason: string } {
  const entitlement = evaluation.entitlements.find(
    e => e.ruleCode === ruleCode
  );
  if (!entitlement)
    return {
      ok: false,
      reason: `Rule ${ruleCode} was not considered for this claim`,
    };
  if (entitlement.status !== "awardable")
    return {
      ok: false,
      reason: `${ruleCode}: ${entitlement.status} (${entitlement.explanation.at(-1) ?? ""})`,
    };
  if (!entitlement.settlement || entitlement.settlement.minorUnits <= 0)
    return { ok: false, reason: `${ruleCode}: no positive settlement amount` };
  return { ok: true, entitlement };
}

export const CLAIM_TYPE_LABELS: Record<ClaimType, { en: string; ar: string }> =
  {
    arrival_delay: { en: "Arrival delay", ar: "تأخير الوصول" },
    cancellation: { en: "Cancellation", ar: "إلغاء الرحلة" },
    denied_boarding: { en: "Denied boarding", ar: "رفض الإركاب" },
    downgrade: { en: "Downgrade", ar: "تخفيض الدرجة" },
    baggage_delay: { en: "Baggage delay", ar: "تأخير الأمتعة" },
    baggage_loss: { en: "Baggage loss", ar: "فقدان الأمتعة" },
    baggage_damage: { en: "Baggage damage", ar: "تلف الأمتعة" },
    tarmac_delay: { en: "Tarmac delay", ar: "تأخير على المدرج" },
    care: { en: "Care expenses", ar: "نفقات الرعاية" },
    refund_timeline: { en: "Refund timeline", ar: "مهلة الاسترداد" },
  };
