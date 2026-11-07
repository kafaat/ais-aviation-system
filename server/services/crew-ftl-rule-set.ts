/**
 * Crew FTL rule sets as data.
 *
 * A rule set is a document (validated here) that is persisted into
 * crew_ftl_rule_sets / crew_ftl_fdp_limits / crew_ftl_limits and read back by
 * the legality engine. Nothing in the engine hard-codes a regulatory number.
 *
 * Provenance is tracked per row:
 * - documented: the value appears in the project research with its source
 *   (docs/research/2026-11-market-gap-analysis/notes/operations_systems.md).
 * - transcribed_unverified: transcribed from the regulation text as known to
 *   the implementer; the research could not fetch the primary text, so the
 *   operator must verify it before confirming the rule set.
 * - pending_official_text: structure only; the value must be loaded from the
 *   official text (GACAR Part 117) through the admin import.
 */
import { z } from "zod";

export const sourceStatusSchema = z.enum([
  "documented",
  "transcribed_unverified",
  "pending_official_text",
]);
export type SourceStatus = z.infer<typeof sourceStatusSchema>;

export const fdpTableKindSchema = z.enum([
  "acclimatised",
  "unknown_acclimatisation",
  "unknown_acclimatisation_frm",
  "augmented_crew",
]);
export type FdpTableKind = z.infer<typeof fdpTableKindSchema>;

export const limitKeySchema = z.enum([
  "fdp_extension_minutes",
  "fdp_extensions_per_7_days",
  "fdp_extension_max_sectors",
  "min_rest_home_base_minutes",
  "min_rest_away_minutes",
  "min_rest_at_least_preceding_duty",
  "max_duty_minutes_7_days",
  "max_duty_minutes_14_days",
  "max_duty_minutes_28_days",
  "max_flight_minutes_28_days",
  "max_flight_minutes_365_days",
  "max_flight_minutes_calendar_year",
  "max_flight_minutes_12_months",
  "max_consecutive_duty_days",
  "recurrent_extended_rest_minutes",
  "max_minutes_between_recurrent_rest",
  "roster_publication_lead_days",
  "home_standby_duty_count_percent",
  "airport_standby_counts_as_duty",
  "wocl_start_minute",
  "wocl_end_minute",
  "split_duty_min_break_minutes",
  "split_duty_max_fdp_increase_minutes",
  "augmented_crew_max_fdp_minutes",
]);
export type LimitKey = z.infer<typeof limitKeySchema>;

/** Limits the engine cannot evaluate without; a null value blocks activation. */
export const requiredLimitKeys: readonly LimitKey[] = [
  "min_rest_home_base_minutes",
  "min_rest_away_minutes",
  "max_duty_minutes_7_days",
  "max_duty_minutes_14_days",
  "max_duty_minutes_28_days",
  "max_flight_minutes_28_days",
  "max_flight_minutes_calendar_year",
  "max_flight_minutes_12_months",
];

export const fdpLimitRowSchema = z
  .object({
    table: fdpTableKindSchema,
    /** Minutes after local midnight; end is exclusive and wraps when <= start. */
    bandStartMinute: z.number().int().min(0).max(1439),
    bandEndMinute: z.number().int().min(1).max(1440),
    sectorsFrom: z.number().int().min(1).max(99),
    sectorsTo: z.number().int().min(1).max(99),
    qualifier: z.string().max(40).nullable().default(null),
    maxFdpMinutes: z.number().int().positive().max(1440).nullable(),
    sourceStatus: sourceStatusSchema,
  })
  .refine(
    r => r.sectorsFrom <= r.sectorsTo,
    "sectorsFrom must be <= sectorsTo"
  );
export type FdpLimitRow = z.infer<typeof fdpLimitRowSchema>;

export const limitRowSchema = z.object({
  key: limitKeySchema,
  qualifier: z.string().max(40).nullable().default(null),
  value: z.number().int().nonnegative().nullable(),
  unit: z.enum(["minutes", "count", "days", "percent"]),
  reference: z.string().min(1).max(120),
  sourceStatus: sourceStatusSchema,
});
export type LimitRow = z.infer<typeof limitRowSchema>;

export const ruleSetDocumentSchema = z
  .object({
    code: z.string().regex(/^[A-Z0-9][A-Z0-9-]{1,39}$/),
    version: z.string().min(1).max(50),
    name: z.string().min(1).max(200),
    jurisdiction: z.string().min(2).max(10),
    sourceUrl: z.string().url().max(500),
    sourceNotes: z.string().max(4000).default(""),
    effectiveFrom: z.iso.datetime(),
    effectiveTo: z.iso.datetime().nullable().default(null),
    valuesStatus: sourceStatusSchema,
    allowsOverride: z.boolean().default(false),
    fdpLimits: z.array(fdpLimitRowSchema).max(2000),
    limits: z.array(limitRowSchema).max(200),
  })
  .strict()
  .refine(
    d =>
      d.effectiveTo === null ||
      Date.parse(d.effectiveFrom) < Date.parse(d.effectiveTo),
    "effectiveFrom must precede effectiveTo"
  );
export type RuleSetDocument = z.infer<typeof ruleSetDocumentSchema>;

/** Problems that prevent a rule set from being confirmed or activated. */
export function ruleSetReadinessIssues(doc: RuleSetDocument): string[] {
  const issues: string[] = [];
  if (doc.valuesStatus === "pending_official_text")
    issues.push("Rule values must be loaded from the official text first");
  for (const key of requiredLimitKeys) {
    const row = doc.limits.find(l => l.key === key && l.qualifier === null);
    if (!row) issues.push(`Missing limit ${key}`);
    else if (row.value === null) issues.push(`Limit ${key} has no value`);
  }
  const acclimatised = doc.fdpLimits.filter(r => r.table === "acclimatised");
  if (!acclimatised.length) issues.push("Missing acclimatised FDP table");
  if (!doc.fdpLimits.some(r => r.table === "unknown_acclimatisation"))
    issues.push("Missing unknown-acclimatisation FDP table");
  for (const row of doc.fdpLimits)
    if (row.maxFdpMinutes === null)
      issues.push(
        `FDP table ${row.table} band ${row.bandStartMinute}-${row.bandEndMinute} sectors ${row.sectorsFrom}-${row.sectorsTo} has no value`
      );
  // Acclimatised bands must tile the day for every sector column.
  const columns = new Map<string, FdpLimitRow[]>();
  for (const row of acclimatised) {
    const key = `${row.sectorsFrom}-${row.sectorsTo}`;
    columns.set(key, [...(columns.get(key) ?? []), row]);
  }
  for (const [column, rows] of columns) {
    const covered = new Array<boolean>(1440).fill(false);
    for (const row of rows)
      for (const minute of bandMinutes(row.bandStartMinute, row.bandEndMinute))
        covered[minute] = true;
    if (covered.some(c => !c))
      issues.push(
        `Acclimatised FDP table has report-time gaps for sectors ${column}`
      );
  }
  return [...new Set(issues)];
}

function bandMinutes(start: number, end: number): number[] {
  const minutes: number[] = [];
  if (end > start) for (let m = start; m < end; m++) minutes.push(m);
  else {
    for (let m = start; m < 1440; m++) minutes.push(m);
    for (let m = 0; m < end; m++) minutes.push(m);
  }
  return minutes;
}

// ---------------------------------------------------------------------------
// EASA ORO.FTL (Regulation (EU) No 965/2012, Subpart FTL) seed
// ---------------------------------------------------------------------------

const EASA_SOURCE =
  "https://regulatorylibrary.caa.co.uk/965-2012/Content/Regs/05140_ORO.FTL.210_Flight_times_and_duty_periods.htm";

const hm = (h: number, m = 0) => h * 60 + m;

/** ORO.FTL.205(b)(1) Table 1 — maximum daily FDP, acclimatised crew.
 * Columns: 1-2, 3, 4, 5, 6, 7, 8, 9, 10+ sectors. Only the 13:00 ceiling is
 * research-documented; the remaining cells are transcribed and unverified. */
const EASA_TABLE_1: Array<{ start: number; end: number; values: number[] }> = [
  {
    start: hm(6),
    end: hm(13, 30),
    values: [780, 750, 720, 690, 660, 630, 600, 570, 540],
  },
  {
    start: hm(13, 30),
    end: hm(14),
    values: [765, 735, 705, 675, 645, 615, 585, 555, 540],
  },
  {
    start: hm(14),
    end: hm(14, 30),
    values: [750, 720, 690, 660, 630, 600, 570, 540, 540],
  },
  {
    start: hm(14, 30),
    end: hm(15),
    values: [735, 705, 675, 645, 615, 585, 555, 540, 540],
  },
  {
    start: hm(15),
    end: hm(15, 30),
    values: [720, 690, 660, 630, 600, 570, 540, 540, 540],
  },
  {
    start: hm(15, 30),
    end: hm(16),
    values: [705, 675, 645, 615, 585, 555, 540, 540, 540],
  },
  {
    start: hm(16),
    end: hm(16, 30),
    values: [690, 660, 630, 600, 570, 540, 540, 540, 540],
  },
  {
    start: hm(16, 30),
    end: hm(17),
    values: [675, 645, 615, 585, 555, 540, 540, 540, 540],
  },
  {
    start: hm(17),
    end: hm(5),
    values: [660, 630, 600, 570, 540, 540, 540, 540, 540],
  },
  {
    start: hm(5),
    end: hm(5, 15),
    values: [720, 690, 660, 630, 600, 570, 540, 540, 540],
  },
  {
    start: hm(5, 15),
    end: hm(5, 30),
    values: [735, 705, 675, 645, 615, 585, 555, 540, 540],
  },
  {
    start: hm(5, 30),
    end: hm(5, 45),
    values: [750, 720, 690, 660, 630, 600, 570, 540, 540],
  },
  {
    start: hm(5, 45),
    end: hm(6),
    values: [765, 735, 705, 675, 645, 615, 585, 555, 540],
  },
];
const SECTOR_COLUMNS: Array<[number, number]> = [
  [1, 2],
  [3, 3],
  [4, 4],
  [5, 5],
  [6, 6],
  [7, 7],
  [8, 8],
  [9, 9],
  [10, 99],
];

/** ORO.FTL.205(b)(2) Table 2 — unknown state of acclimatisation.
 * 1-2/3/4 sectors are research-documented (11:00/10:30/10:00). */
const EASA_TABLE_2: Array<{
  sectors: [number, number];
  minutes: number;
  status: SourceStatus;
}> = [
  { sectors: [1, 2], minutes: 660, status: "documented" },
  { sectors: [3, 3], minutes: 630, status: "documented" },
  { sectors: [4, 4], minutes: 600, status: "documented" },
  { sectors: [5, 5], minutes: 570, status: "transcribed_unverified" },
  { sectors: [6, 6], minutes: 540, status: "transcribed_unverified" },
  { sectors: [7, 99], minutes: 540, status: "transcribed_unverified" },
];

export function easaOroFtlRuleSet(): RuleSetDocument {
  const fdpLimits: FdpLimitRow[] = [];
  for (const band of EASA_TABLE_1)
    band.values.forEach((minutes, i) => {
      const [sectorsFrom, sectorsTo] = SECTOR_COLUMNS[i];
      fdpLimits.push({
        table: "acclimatised",
        bandStartMinute: band.start,
        bandEndMinute: band.end,
        sectorsFrom,
        sectorsTo,
        qualifier: null,
        maxFdpMinutes: minutes,
        // The 13 h basic ceiling (06:00-13:29, 1-2 sectors) is documented.
        sourceStatus:
          band.start === hm(6) && i === 0
            ? "documented"
            : "transcribed_unverified",
      });
    });
  for (const row of EASA_TABLE_2)
    fdpLimits.push({
      table: "unknown_acclimatisation",
      bandStartMinute: 0,
      bandEndMinute: 1440,
      sectorsFrom: row.sectors[0],
      sectorsTo: row.sectors[1],
      qualifier: null,
      maxFdpMinutes: row.minutes,
      sourceStatus: row.status,
    });
  const limit = (
    key: LimitKey,
    value: number,
    unit: LimitRow["unit"],
    reference: string,
    sourceStatus: SourceStatus
  ): LimitRow => ({
    key,
    qualifier: null,
    value,
    unit,
    reference,
    sourceStatus,
  });
  return ruleSetDocumentSchema.parse({
    code: "EASA-ORO-FTL",
    version: "965-2012-research-2026-11",
    name: "EASA Subpart FTL (ORO.FTL.205/210/235) commercial air transport",
    jurisdiction: "EU",
    sourceUrl: EASA_SOURCE,
    sourceNotes:
      "Documented values: 100 h flight time / 28 consecutive days, 900 h / calendar year, 1,000 h / 12 consecutive calendar months (ORO.FTL.210); 13 h basic FDP for acclimatised crew with +1 h extension at most twice in any 7 consecutive days (ORO.FTL.205); unknown-acclimatisation FDP 11:00/10:30/10:00 for 1-2/3/4 sectors; minimum rest 12 h or the preceding duty at home base; 14-day roster publication. The full ORO.FTL.205 Table 1, ORO.FTL.210(c) duty-hour limits (7/14/28 days), ORO.FTL.235 away-rest floor, recurrent extended recovery rest and WOCL/early-start definitions are transcribed from the regulation as known to the implementer and must be verified against the primary text before operator confirmation (research gap: primary pages were unreachable).",
    effectiveFrom: "2014-02-18T00:00:00.000Z",
    effectiveTo: null,
    valuesStatus: "transcribed_unverified",
    allowsOverride: false,
    fdpLimits,
    limits: [
      limit(
        "fdp_extension_minutes",
        60,
        "minutes",
        "ORO.FTL.205(d)",
        "documented"
      ),
      limit(
        "fdp_extensions_per_7_days",
        2,
        "count",
        "ORO.FTL.205(d)",
        "documented"
      ),
      limit(
        "fdp_extension_max_sectors",
        5,
        "count",
        "ORO.FTL.205(d) Table 3",
        "transcribed_unverified"
      ),
      limit(
        "min_rest_home_base_minutes",
        720,
        "minutes",
        "ORO.FTL.235(a)(1)",
        "documented"
      ),
      limit(
        "min_rest_away_minutes",
        600,
        "minutes",
        "ORO.FTL.235(a)(2)",
        "transcribed_unverified"
      ),
      limit(
        "min_rest_at_least_preceding_duty",
        1,
        "count",
        "ORO.FTL.235(a)",
        "documented"
      ),
      limit(
        "max_duty_minutes_7_days",
        3600,
        "minutes",
        "ORO.FTL.210(c)(1)",
        "transcribed_unverified"
      ),
      limit(
        "max_duty_minutes_14_days",
        6600,
        "minutes",
        "ORO.FTL.210(c)(2)",
        "transcribed_unverified"
      ),
      limit(
        "max_duty_minutes_28_days",
        11400,
        "minutes",
        "ORO.FTL.210(c)(3)",
        "transcribed_unverified"
      ),
      limit(
        "max_flight_minutes_28_days",
        6000,
        "minutes",
        "ORO.FTL.210(a)(1)",
        "documented"
      ),
      limit(
        "max_flight_minutes_calendar_year",
        54000,
        "minutes",
        "ORO.FTL.210(a)(2)",
        "documented"
      ),
      limit(
        "max_flight_minutes_12_months",
        60000,
        "minutes",
        "ORO.FTL.210(a)(3)",
        "documented"
      ),
      limit(
        "recurrent_extended_rest_minutes",
        2160,
        "minutes",
        "ORO.FTL.235(d)",
        "transcribed_unverified"
      ),
      limit(
        "max_minutes_between_recurrent_rest",
        10080,
        "minutes",
        "ORO.FTL.235(d)",
        "transcribed_unverified"
      ),
      limit(
        "roster_publication_lead_days",
        14,
        "days",
        "ORO.FTL.110(a)",
        "documented"
      ),
      limit(
        "home_standby_duty_count_percent",
        25,
        "percent",
        "ORO.FTL.225 / CS FTL.1.225",
        "transcribed_unverified"
      ),
      limit(
        "airport_standby_counts_as_duty",
        1,
        "count",
        "ORO.FTL.225(b)",
        "transcribed_unverified"
      ),
      limit(
        "wocl_start_minute",
        hm(2),
        "minutes",
        "ORO.FTL.105(26)",
        "transcribed_unverified"
      ),
      limit(
        "wocl_end_minute",
        hm(6),
        "minutes",
        "ORO.FTL.105(26)",
        "transcribed_unverified"
      ),
    ],
  });
}

// ---------------------------------------------------------------------------
// GACAR Part 117 skeleton — structure only, values pending the official text
// ---------------------------------------------------------------------------

const GACAR_SOURCE =
  "https://gaca.gov.sa/-/media/Files/PDF/LawsAndRegulation/Aviation-Safety-and-Environmental-Sustainability/GACAR-Safety-Regulations/GACARS/Part_117.pdf";

export function gacarPart117RuleSet(): RuleSetDocument {
  const pending = (
    key: LimitKey,
    unit: LimitRow["unit"],
    reference: string
  ): LimitRow => ({
    key,
    qualifier: null,
    value: null,
    unit,
    reference,
    sourceStatus: "pending_official_text",
  });
  return ruleSetDocumentSchema.parse({
    code: "GACAR-117",
    version: "structure-only-2026-11",
    name: "GACAR Part 117 flight and duty limitations (values to be loaded)",
    jurisdiction: "SA",
    sourceUrl: GACAR_SOURCE,
    sourceNotes:
      "Structure only. GACAR Part 117 Tables A/B/C and the FRMS provisions under §117.7 govern Saudi operators; the research could not extract their values and none are invented here. Load the FDP tables and limits from the official GACAR Part 117 text through the admin import (same document shape), then confirm as operator. The rule set cannot be confirmed or activated while any value is pending.",
    effectiveFrom: "2026-01-01T00:00:00.000Z",
    effectiveTo: null,
    valuesStatus: "pending_official_text",
    allowsOverride: false,
    fdpLimits: [],
    limits: [
      pending("fdp_extension_minutes", "minutes", "GACAR 117 (to be loaded)"),
      pending("fdp_extensions_per_7_days", "count", "GACAR 117 (to be loaded)"),
      pending(
        "min_rest_home_base_minutes",
        "minutes",
        "GACAR 117 (to be loaded)"
      ),
      pending("min_rest_away_minutes", "minutes", "GACAR 117 (to be loaded)"),
      pending("max_duty_minutes_7_days", "minutes", "GACAR 117 (to be loaded)"),
      pending(
        "max_duty_minutes_14_days",
        "minutes",
        "GACAR 117 (to be loaded)"
      ),
      pending(
        "max_duty_minutes_28_days",
        "minutes",
        "GACAR 117 (to be loaded)"
      ),
      pending(
        "max_flight_minutes_28_days",
        "minutes",
        "GACAR 117 Table A (to be loaded)"
      ),
      pending(
        "max_flight_minutes_calendar_year",
        "minutes",
        "GACAR 117 (to be loaded)"
      ),
      pending(
        "max_flight_minutes_12_months",
        "minutes",
        "GACAR 117 (to be loaded)"
      ),
      pending(
        "roster_publication_lead_days",
        "days",
        "GACAR 117 (to be loaded)"
      ),
      pending(
        "wocl_start_minute",
        "minutes",
        "GACAR 117 §117.3 (to be loaded)"
      ),
      pending("wocl_end_minute", "minutes", "GACAR 117 §117.3 (to be loaded)"),
      pending(
        "augmented_crew_max_fdp_minutes",
        "minutes",
        "GACAR 117 Table C (to be loaded)"
      ),
    ],
  });
}

export const ruleSetTemplates = {
  "EASA-ORO-FTL": easaOroFtlRuleSet,
  "GACAR-117": gacarPart117RuleSet,
} as const;
export type RuleSetTemplateCode = keyof typeof ruleSetTemplates;
