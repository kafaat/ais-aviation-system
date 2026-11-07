// Seeded rule sets. Every value carries the source the research recorded for
// it. "official" means the figure is read from the governing text; "secondary"
// means press or law-firm coverage only and the operator must confirm before an
// award; "disputed" means the sources conflict and both candidates are kept.
import { GACA_PASSENGER_RIGHTS } from "../gaca-arrival-delay";
import type { Rule, RuleSet, Source } from "./types";

const src = (
  url: string,
  title: string,
  kind: Source["kind"] = "secondary"
): Source => ({ url, title, kind });

// --- Saudi Arabia ----------------------------------------------------------
const gacaRegulation = src(
  GACA_PASSENGER_RIGHTS,
  "GACA Customer Rights Protection Regulation (Arabic, governing text)",
  "official"
);
const gacaAnnouncement = src(
  "https://gaca.gov.sa/web/en-gb/news/consumer-protection-regulations",
  "GACA announcement, August 2023"
);
const gulfNewsAug2023 = src(
  "https://gulfnews.com/business/aviation/saudi-arabia-announces-new-airline-compensation-rules-up-to-200-of-airfare-for-delays-cancellations-1.1692855490178",
  "Gulf News, August 2023"
);
const argaam = src(
  "https://www.argaam.com/en/article/articledetail/id/1665972",
  "Argaam compensation table"
);
const gulfBusiness = src(
  "https://gulfbusiness.com/en/2023/saudi-arabia/saudi-new-airline-compensation-rules-in-effect",
  "Gulf Business, in effect 20 November 2023"
);
const gulfNewsBaggage = src(
  "https://gulfnews.com/amp/story/world%2Fgulf%2Fsaudi%2Fnew-airline-compensation-rules-come-into-force-in-saudi-arabia-1.99504908",
  "Gulf News, baggage amounts"
);
const travelobiz = src("https://travelobiz.com/?p=33043", "Travelobiz summary");
const gacaKnowYourRights = src(
  "https://gaca.gov.sa/-/media/Files/PDF/Content--Pages/Know-your-rights-En.pdf",
  "GACA Know your rights guide (earlier regulation)",
  "official"
);

const ksaRules: Rule[] = [
  {
    code: "KSA-GACA-2023.arrival_delay.10-6.tier1",
    jurisdiction: "KSA-GACA-2023",
    claimTypes: ["arrival_delay"],
    title: "Arrival delay of 3 to 6 hours",
    article: "Article 10(6)",
    thresholds: { delayMinutes: { gte: 180, lte: 360 } },
    amount: { kind: "sdr", units: 50 },
    exclusions: [
      "Scope and exceptions reviewed on the claim (operator route review)",
    ],
    sources: [gacaRegulation],
    confirmationStatus: "official",
  },
  {
    code: "KSA-GACA-2023.arrival_delay.10-6.tier2",
    jurisdiction: "KSA-GACA-2023",
    claimTypes: ["arrival_delay"],
    title: "Arrival delay over 6 hours",
    article: "Article 10(6)",
    thresholds: { delayMinutes: { gt: 360 } },
    amount: { kind: "sdr", units: 150 },
    exclusions: [
      "Scope and exceptions reviewed on the claim (operator route review)",
    ],
    sources: [gacaRegulation],
    confirmationStatus: "official",
  },
  {
    code: "KSA-GACA-2023.cancellation.percentage",
    jurisdiction: "KSA-GACA-2023",
    claimTypes: ["cancellation"],
    title: "Cancellation: up to 150% of ticket value",
    amount: { kind: "percentage_of_ticket", percent: 150 },
    exclusions: [
      "Official article conditions (notice period, alternative offered) are unverified",
      "Extraordinary circumstances as defined by the regulation",
    ],
    exclusionChecks: { extraordinaryCircumstances: true },
    sources: [argaam, gulfNewsAug2023, gacaAnnouncement],
    confirmationStatus: "secondary",
    note: "Press reports 'up to 150%'; whether 200% also applies to cancellation is unclear in secondary sources.",
  },
  {
    code: "KSA-GACA-2023.denied_boarding.percentage",
    jurisdiction: "KSA-GACA-2023",
    claimTypes: ["denied_boarding"],
    title: "Denied boarding: 200% of ticket value",
    amount: { kind: "percentage_of_ticket", percent: 200 },
    exclusions: [
      "Alternative flight provided within 2 hours of scheduled departure (earlier GACA guide)",
      "Passenger-caused refusal (documents, conduct, late presentation)",
    ],
    exclusionChecks: {
      alternativeDepartureWithinMinutes: 120,
      passengerCaused: true,
      voluntaryDeniedBoarding: true,
    },
    sources: [argaam, gulfNewsAug2023, gacaKnowYourRights],
    confirmationStatus: "secondary",
  },
  {
    code: "KSA-GACA-2023.care.delay-over-6h",
    jurisdiction: "KSA-GACA-2023",
    claimTypes: ["care"],
    title: "Departure delay over 6 hours: care plus SAR 750",
    thresholds: { delayMinutes: { gt: 360 } },
    amount: { kind: "fixed", minorUnits: 75_000, currency: "SAR" },
    care: { meals: true, refreshments: true, hotel: true, transport: true },
    sources: [argaam],
    confirmationStatus: "secondary",
  },
  {
    code: "KSA-GACA-2023.baggage_loss.cap",
    jurisdiction: "KSA-GACA-2023",
    claimTypes: ["baggage_loss", "baggage_damage"],
    title: "Lost or damaged baggage: reimbursement up to SAR 6,568",
    amount: {
      kind: "receipt_reimbursement",
      currency: "SAR",
      capMinorUnits: 656_800,
    },
    sources: [travelobiz, gulfNewsBaggage],
    confirmationStatus: "secondary",
    note: "Approximately 1,288 SDR (Montreal Convention limit); SAR figure from press.",
  },
  {
    code: "KSA-GACA-2023.baggage_delay.daily.A",
    jurisdiction: "KSA-GACA-2023",
    claimTypes: ["baggage_delay"],
    title: "Delayed baggage: SAR 740 first day then SAR 300/day, max 5 days",
    thresholds: { delayDays: { gte: 1 } },
    amount: {
      kind: "daily_capped",
      currency: "SAR",
      firstDayMinorUnits: 74_000,
      dailyMinorUnits: 30_000,
      maxDays: 5,
    },
    sources: [gulfNewsBaggage],
    confirmationStatus: "disputed",
    disputeGroup: "ksa-baggage-delay-daily",
    candidate: "A",
    note: "Conflicts with candidate B; operator confirmation against the Arabic text required.",
  },
  {
    code: "KSA-GACA-2023.baggage_delay.daily.B-domestic",
    jurisdiction: "KSA-GACA-2023",
    claimTypes: ["baggage_delay"],
    title: "Delayed baggage (domestic): SAR 100/day, max 5 days",
    thresholds: { delayDays: { gte: 1 }, routeScope: "domestic" },
    amount: {
      kind: "daily_capped",
      currency: "SAR",
      dailyMinorUnits: 10_000,
      maxDays: 5,
    },
    sources: [argaam],
    confirmationStatus: "disputed",
    disputeGroup: "ksa-baggage-delay-daily",
    candidate: "B",
  },
  {
    code: "KSA-GACA-2023.baggage_delay.daily.B-international",
    jurisdiction: "KSA-GACA-2023",
    claimTypes: ["baggage_delay"],
    title: "Delayed baggage (international): SAR 200/day, max 5 days",
    thresholds: { delayDays: { gte: 1 }, routeScope: "international" },
    amount: {
      kind: "daily_capped",
      currency: "SAR",
      dailyMinorUnits: 20_000,
      maxDays: 5,
    },
    sources: [argaam],
    confirmationStatus: "disputed",
    disputeGroup: "ksa-baggage-delay-daily",
    candidate: "B",
  },
  {
    code: "KSA-GACA-2023.tarmac_delay.3h",
    jurisdiction: "KSA-GACA-2023",
    claimTypes: ["tarmac_delay"],
    title: "Tarmac delay over 3 hours: right to disembark",
    thresholds: { tarmacMinutes: { gt: 180 } },
    amount: {
      kind: "unspecified",
      description:
        "Press reports a right to disembark and compensation; no amount is published in the sources.",
    },
    sources: [gulfBusiness],
    confirmationStatus: "secondary",
  },
];

// --- European Union --------------------------------------------------------
const eurLex261 = src(
  "https://eur-lex.europa.eu/eli/reg/2004/261/oj",
  "Regulation (EC) No 261/2004, Official Journal",
  "official"
);
const sturgeon = src(
  "https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:62007CJ0402",
  "CJEU C-402/07 and C-432/07 (Sturgeon): three-hour arrival delay",
  "official"
);
const eu261Exclusions = [
  "Extraordinary circumstances which could not have been avoided (Article 5(3))",
  "Cancellation notified at least 14 days before departure (Article 5(1)(c)(i))",
  "Cancellation notified 7-14 days before with rerouting departing no more than 2h early and arriving less than 4h late (Article 5(1)(c)(ii))",
  "Cancellation notified under 7 days before with rerouting departing no more than 1h early and arriving less than 2h late (Article 5(1)(c)(iii))",
];
const eu261ExclusionChecks = {
  extraordinaryCircumstances: true,
  cancellationNoticeDaysAtLeast: 14,
  voluntaryDeniedBoarding: true,
  passengerCaused: true,
};
const ART7_BANDS = [
  { band: "short", distance: { lte: 1500 }, within: 120 },
  { band: "medium", distance: { gt: 1500, lte: 3500 }, within: 180 },
  { band: "long", distance: { gt: 3500 }, within: 240 },
] as const;
function art7(
  jurisdiction: Rule["jurisdiction"],
  amounts: Record<(typeof ART7_BANDS)[number]["band"], number>,
  currency: string,
  sources: Source[],
  status: Rule["confirmationStatus"]
): Rule[] {
  return ART7_BANDS.map(tier => ({
    code: `${jurisdiction}.art7.${tier.band}`,
    jurisdiction,
    claimTypes: ["arrival_delay", "cancellation", "denied_boarding"],
    title: `${tier.band} haul: ${currency} ${amounts[tier.band] / 100}`,
    article: "Article 7",
    thresholds: { delayMinutes: { gte: 180 }, distanceKm: tier.distance },
    amount: { kind: "fixed", minorUnits: amounts[tier.band], currency },
    reduction: { percent: 50, reroutedArrivalWithinMinutes: tier.within },
    exclusions: eu261Exclusions,
    exclusionChecks: eu261ExclusionChecks,
    sources,
    confirmationStatus: status,
    note:
      tier.band === "medium"
        ? "Intra-Community flights over 1,500 km also fall in this band."
        : tier.band === "long"
          ? "Article 7(2)(c): half rate when the arrival is within 4 hours of schedule."
          : undefined,
  }));
}
function art9Care(
  jurisdiction: Rule["jurisdiction"],
  sources: Source[]
): Rule[] {
  const care = {
    meals: true,
    refreshments: true,
    hotel: true,
    transport: true,
    communications: 2,
  };
  return [
    { band: "short", distance: { lte: 1500 }, minutes: 120 },
    { band: "medium", distance: { gt: 1500, lte: 3500 }, minutes: 180 },
    { band: "long", distance: { gt: 3500 }, minutes: 240 },
  ].map(tier => ({
    code: `${jurisdiction}.art9.care.${tier.band}`,
    jurisdiction,
    claimTypes: ["care"],
    title: `Care after ${tier.minutes / 60}h departure delay (${tier.band} haul)`,
    article: "Articles 6 and 9",
    thresholds: {
      delayMinutes: { gte: tier.minutes },
      distanceKm: tier.distance,
    },
    amount: { kind: "receipt_reimbursement", currency: "EUR" },
    care,
    sources,
    confirmationStatus: "secondary",
    note: "Reasonable care costs; no fixed cap in the text. Article 6 thresholds not re-verified by the research notes.",
  }));
}
function art10Downgrade(
  jurisdiction: Rule["jurisdiction"],
  sources: Source[]
): Rule[] {
  return [
    { band: "short", distance: { lte: 1500 }, percent: 30 },
    { band: "medium", distance: { gt: 1500, lte: 3500 }, percent: 50 },
    { band: "long", distance: { gt: 3500 }, percent: 75 },
  ].map(tier => ({
    code: `${jurisdiction}.art10.downgrade.${tier.band}`,
    jurisdiction,
    claimTypes: ["downgrade"],
    title: `Downgrade reimbursement ${tier.percent}% of ticket price (${tier.band} haul)`,
    article: "Article 10(2)",
    thresholds: { distanceKm: tier.distance },
    amount: { kind: "percentage_of_ticket", percent: tier.percent },
    sources,
    confirmationStatus: "secondary",
    note: "Article 10 percentages are not in the research notes; confirm against the official text before award.",
  }));
}

const EUR_BANDS = { short: 25_000, medium: 40_000, long: 60_000 };
const eu2004Rules: Rule[] = [
  ...art7("EU261-2004", EUR_BANDS, "EUR", [eurLex261, sturgeon], "official"),
  ...art9Care("EU261-2004", [eurLex261]),
  ...art10Downgrade("EU261-2004", [eurLex261]),
];

const cmsLaw = src(
  "https://cms.law/en/int/legal-updates/new-european-regulation-on-air-passenger-rights-what-impact-for-the-air-transport-sector",
  "CMS Law on the 2026 amendment"
);
const epText = src(
  "https://data.europarl.europa.eu/distribution/doc/TA-10-2026-0238_en.pdf",
  "European Parliament TA-10-2026-0238 (joint text, 7 July 2026)",
  "official"
);
const lexis = src(
  "https://www.lexisnexis.co.uk/legal/news/council-adopts-regulation-strengthening-eu-air-passenger-rights",
  "Council adoption, 13 July 2026"
);
const flightDelayed = src(
  "https://www.flight-delayed.com/en/blog/2026/06/16/eu-passenger-rights-reform-2026",
  "Flight-Delayed summary (claims industry)"
);
const skyRefund = src(
  "https://skyrefund.com/en/blog/eu261-reform-2026",
  "SkyRefund summary (claims industry)"
);
const eu2026Rules: Rule[] = [
  ...art7(
    "EU261-2026-amended",
    EUR_BANDS,
    "EUR",
    [epText, cmsLaw, lexis],
    "not_yet_applicable"
  ),
  {
    code: "EU261-2026-amended.claim_document_duty.96h",
    jurisdiction: "EU261-2026-amended",
    claimTypes: ["refund_timeline"],
    title: "Carrier must send claim documentation within 96 hours",
    amount: {
      kind: "unspecified",
      description: "Information duty; no monetary amount",
    },
    timeLimits: { claimDocumentDutyHours: 96, claimWindowMonths: 9 },
    sources: [flightDelayed, skyRefund],
    confirmationStatus: "not_yet_applicable",
    note: "Secondary summaries; verify against the Official Journal text once published.",
  },
];

// --- United Kingdom --------------------------------------------------------
const ukArt7 = src(
  "https://www.legislation.gov.uk/eur/2004/261/article/7/data.htm",
  "Retained Regulation 261/2004, Article 7 (legislation.gov.uk)",
  "official"
);
const hfw = src(
  "https://HFW.COM/downloads/002691-HFW-UK261-Passenger-rights-after-the-Brexit-transition-period-Jan-2021.pdf",
  "HFW UK261 briefing"
);
const ukRules: Rule[] = [
  ...art7(
    "UK261",
    { short: 22_000, medium: 35_000, long: 52_000 },
    "GBP",
    [ukArt7, hfw],
    "official"
  ),
  ...art9Care("UK261", [ukArt7]),
  ...art10Downgrade("UK261", [ukArt7]),
];

// --- United States ---------------------------------------------------------
const ecfr260 = src(
  "https://www.ecfr.gov/current/title-14/chapter-II/subchapter-A/part-260",
  "14 CFR Part 260 (eCFR)",
  "official"
);
const cfrMirror = src(
  "https://www.customsmobile.com/regulations/title14_chapterII_part260",
  "14 CFR Part 260 mirror"
);
const fedReg = src(
  "https://regulations.justia.com/regulations/fedreg/2024/04/26/2024-07177.html",
  "Federal Register 2024-07177, Refunds and Other Consumer Protections",
  "official"
);
const eckert = src(
  "https://www.eckertseamans.com/legal-updates/dot-finalizes-two-key-new-consumer-protection-rulemakings",
  "Eckert Seamans summary"
);
const ecfr250 = src(
  "https://www.ecfr.gov/current/title-14/chapter-II/subchapter-A/part-250",
  "14 CFR Part 250, Oversales (eCFR)",
  "official"
);
const ecfr259 = src(
  "https://www.ecfr.gov/current/title-14/chapter-II/subchapter-A/part-259",
  "14 CFR Part 259, tarmac delay contingency plans (eCFR)",
  "official"
);
const usRules: Rule[] = [
  {
    code: "US-DOT-14CFR260.refund_timeline.card",
    jurisdiction: "US-DOT-14CFR260",
    claimTypes: ["refund_timeline", "cancellation"],
    title: "Prompt refund: 7 business days for credit card purchases",
    article: "14 CFR 260.2 and 260.6",
    amount: { kind: "ticket_refund" },
    timeLimits: { refundCardBusinessDays: 7 },
    sources: [ecfr260, cfrMirror, fedReg],
    confirmationStatus: "official",
    note: "Business days exclude US federal holidays in the rule; this engine models weekends only.",
  },
  {
    code: "US-DOT-14CFR260.refund_timeline.other",
    jurisdiction: "US-DOT-14CFR260",
    claimTypes: ["refund_timeline", "cancellation"],
    title: "Prompt refund: 20 calendar days for other payment methods",
    article: "14 CFR 260.2 and 260.6",
    amount: { kind: "ticket_refund" },
    timeLimits: { refundOtherCalendarDays: 20 },
    sources: [ecfr260, cfrMirror, fedReg],
    confirmationStatus: "official",
  },
  {
    code: "US-DOT-14CFR260.significant_change.domestic",
    jurisdiction: "US-DOT-14CFR260",
    claimTypes: ["arrival_delay", "cancellation"],
    title: "Significant change (domestic): schedule moved more than 3 hours",
    article: "14 CFR 260.2",
    thresholds: { delayMinutes: { gt: 180 }, routeScope: "domestic" },
    amount: { kind: "ticket_refund" },
    exclusions: [
      "Passenger accepted the alternative transportation or travel credit offered",
    ],
    sources: [cfrMirror, eckert],
    confirmationStatus: "secondary",
    note: "Refund of the unused ticket when the passenger declines alternatives; no fixed compensation.",
  },
  {
    code: "US-DOT-14CFR260.significant_change.international",
    jurisdiction: "US-DOT-14CFR260",
    claimTypes: ["arrival_delay", "cancellation"],
    title:
      "Significant change (international): schedule moved more than 6 hours",
    article: "14 CFR 260.2",
    thresholds: { delayMinutes: { gt: 360 }, routeScope: "international" },
    amount: { kind: "ticket_refund" },
    exclusions: [
      "Passenger accepted the alternative transportation or travel credit offered",
    ],
    sources: [cfrMirror, eckert],
    confirmationStatus: "secondary",
  },
  {
    code: "US-DOT-14CFR260.baggage_delay.fee_refund.domestic",
    jurisdiction: "US-DOT-14CFR260",
    claimTypes: ["baggage_delay"],
    title:
      "Checked bag fee refund when a domestic bag is not delivered within 12 hours",
    article: "14 CFR 260.7",
    thresholds: { routeScope: "domestic" },
    amount: {
      kind: "fee_refund",
      description:
        "Refund of the checked baggage fee once a Mishandled Baggage Report is filed; international thresholds (15h/30h by flight length) require confirmation.",
    },
    sources: [cfrMirror, eckert],
    confirmationStatus: "secondary",
  },
  {
    code: "US-DOT-14CFR260.denied_boarding.part250.200",
    jurisdiction: "US-DOT-14CFR260",
    claimTypes: ["denied_boarding"],
    title: "Involuntary denied boarding: 200% of one-way fare, max USD 775",
    article: "14 CFR 250.5",
    thresholds: {
      departureOnly: true,
      alternativeArrivalDelayMinutes: { gte: 60, lte: 120 },
    },
    amount: {
      kind: "percentage_of_ticket",
      percent: 200,
      capMinorUnits: 77_500,
      currency: "USD",
    },
    exclusions: [
      "Alternative transportation arriving within 1 hour of scheduled arrival",
      "Passenger did not comply with check-in or documentation requirements",
    ],
    exclusionChecks: { voluntaryDeniedBoarding: true, passengerCaused: true },
    sources: [ecfr250],
    confirmationStatus: "secondary",
    note: "Domestic tier; international tier (1-4h) and the Part 250 text were not re-verified by the research notes.",
  },
  {
    code: "US-DOT-14CFR260.denied_boarding.part250.400",
    jurisdiction: "US-DOT-14CFR260",
    claimTypes: ["denied_boarding"],
    title: "Involuntary denied boarding: 400% of one-way fare, max USD 1,550",
    article: "14 CFR 250.5",
    thresholds: {
      departureOnly: true,
      alternativeArrivalDelayMinutes: { gt: 120 },
    },
    amount: {
      kind: "percentage_of_ticket",
      percent: 400,
      capMinorUnits: 155_000,
      currency: "USD",
    },
    exclusions: [
      "Passenger did not comply with check-in or documentation requirements",
    ],
    exclusionChecks: { voluntaryDeniedBoarding: true, passengerCaused: true },
    sources: [ecfr250],
    confirmationStatus: "secondary",
  },
  {
    code: "US-DOT-14CFR260.tarmac_delay.part259",
    jurisdiction: "US-DOT-14CFR260",
    claimTypes: ["tarmac_delay"],
    title: "Tarmac delay over 3 hours domestic / 4 hours international",
    article: "14 CFR 259.4",
    thresholds: { tarmacMinutes: { gt: 180 } },
    amount: {
      kind: "unspecified",
      description:
        "Carrier contingency-plan duty enforced by civil penalty; no passenger compensation amount.",
    },
    sources: [ecfr259],
    confirmationStatus: "secondary",
    note: "International threshold is 4 hours; the reviewer applies it for international routes.",
  },
];

export const PASSENGER_RIGHTS_RULE_SETS: RuleSet[] = [
  {
    jurisdiction: "KSA-GACA-2023",
    version: "2023-11-20",
    effectiveFrom: "2023-11-20T00:00:00+03:00",
    effectiveTo: null,
    sourceUrl: GACA_PASSENGER_RIGHTS,
    sourceKind: "official",
    confirmationStatus: "secondary",
    governingLanguage: "ar",
    notes:
      "Customer Rights Protection Regulation in force 20 November 2023 (GACA circular of 21 September 2023). The Arabic text governs; press figures conflict on delayed-baggage daily amounts.",
    rules: ksaRules,
  },
  {
    jurisdiction: "EU261-2004",
    version: "2004/261 consolidated",
    effectiveFrom: "2005-02-17T00:00:00Z",
    effectiveTo: null,
    sourceUrl: eurLex261.url,
    sourceKind: "official",
    confirmationStatus: "official",
    governingLanguage: "en",
    notes:
      "Applies to flights departing an EU/EEA/Swiss airport and to flights into one on a Community carrier (Article 3).",
    rules: eu2004Rules,
  },
  {
    jurisdiction: "EU261-2026-amended",
    version: "2026 amendment (adopted 13 July 2026)",
    effectiveFrom: null,
    effectiveTo: null,
    sourceUrl: epText.url,
    sourceKind: "official",
    confirmationStatus: "not_yet_applicable",
    governingLanguage: "en",
    notes:
      "Application expected in the second half of 2027; Official Journal reference and date not confirmed. Kept for planning only.",
    rules: eu2026Rules,
  },
  {
    jurisdiction: "UK261",
    version: "retained 261/2004 as amended by APR 2019",
    effectiveFrom: "2021-01-01T00:00:00Z",
    effectiveTo: null,
    sourceUrl: ukArt7.url,
    sourceKind: "official",
    confirmationStatus: "official",
    governingLanguage: "en",
    notes:
      "Applies to departures from the UK and to arrivals in the UK on UK or EU carriers; enforced by the CAA.",
    rules: ukRules,
  },
  {
    jurisdiction: "US-DOT-14CFR260",
    version: "89 FR 32760, compliance 2024-10-28",
    effectiveFrom: "2024-10-28T00:00:00Z",
    effectiveTo: null,
    sourceUrl: ecfr260.url,
    sourceKind: "official",
    confirmationStatus: "official",
    governingLanguage: "en",
    notes:
      "Covers flights to, from and within the United States by US and foreign carriers. Denied boarding (Part 250) applies to departures from US airports.",
    rules: usRules,
  },
];

export function findRule(code: string, ruleSets = PASSENGER_RIGHTS_RULE_SETS) {
  for (const set of ruleSets)
    for (const rule of set.rules) if (rule.code === code) return rule;
  return undefined;
}
