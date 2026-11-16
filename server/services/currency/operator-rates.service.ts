/**
 * Operator-entered exchange rates (#319 Wave 1, G2 for the display path).
 *
 * An authorised operator records a quote read from an approved publication;
 * there is no automatic feed (owner decision, 15 November 2026). Rows are
 * append-only: a correction is a new row with the next version of its pair
 * that names the row it supersedes, and the corrected row is never updated.
 * Each entry writes its audit record in the same transaction as the row.
 *
 * Quotes feed the labelled display estimate only. Nothing here prices,
 * collects or refunds, and YER stays outside every conversion that does.
 */
import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { and, desc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/mysql-core";
import { z } from "zod";
import {
  auditLogs,
  exchangeRates,
  type ExchangeRateRecord,
} from "../../../drizzle/schema";
import {
  DISPLAY_CURRENCIES,
  DISPLAY_RATE_SOURCES,
  type DisplayCurrency,
} from "../../../shared/ibe-search";
import { getDb } from "../../db";
import { createServiceLogger } from "../../_core/logger";
import {
  applyOperationalChecks,
  type OperationalCheck,
} from "../operational-observations.service";
import {
  findCurrentDisplayQuote,
  invalidateExchangeRateSnapshots,
} from "./currency.service";

const log = createServiceLogger("operator-exchange-rates");

/** Display quotes are direct SAR quotes until a tenant base exists (G10). */
export const OPERATOR_RATE_BASE = "SAR" as const;
/** Central Bank of Yemen, Sanaa: the reference source for every YER pair. */
export const YER_REFERENCE_SOURCE = "cby_sanaa" as const;
export const OPERATOR_QUOTE_CURRENCIES = DISPLAY_CURRENCIES.filter(
  (code): code is Exclude<DisplayCurrency, "SAR"> => code !== "SAR"
) as [Exclude<DisplayCurrency, "SAR">, ...Exclude<DisplayCurrency, "SAR">[]];
export const DISPLAY_RATE_ALERT_PREFIX = "fx-display-rate:";

const quoteCurrency = z.enum(OPERATOR_QUOTE_CURRENCIES);

export const operatorRateInput = z
  .strictObject({
    baseCurrency: z.literal(OPERATOR_RATE_BASE),
    quoteCurrency,
    // Quote-currency major units per one SAR, as DECIMAL(18,8) text.
    rate: z
      .string()
      .trim()
      .regex(/^\d{1,10}(\.\d{1,8})?$/, "Use a decimal with at most 8 places")
      .refine(value => /[1-9]/.test(value), "Rate must be positive"),
    source: z.enum(DISPLAY_RATE_SOURCES),
    // The publication the operator read, e.g. its date and number.
    sourceReference: z.string().trim().min(3).max(255),
    validFrom: z.date(),
    validTo: z.date(),
    supersedesId: z.number().int().positive().optional(),
  })
  .superRefine((input, ctx) => {
    if (
      (input.quoteCurrency === "YER") !==
      (input.source === YER_REFERENCE_SOURCE)
    )
      ctx.addIssue({
        code: "custom",
        path: ["source"],
        message:
          "YER quotes use the Central Bank of Yemen (Sanaa) rate, and only YER quotes may cite it",
      });
  });
export type OperatorRateInput = z.infer<typeof operatorRateInput>;

export const operatorRateRow = z.object({
  id: z.number().int(),
  baseCurrency: z.literal(OPERATOR_RATE_BASE),
  quoteCurrency: z.string(),
  rate: z.string(),
  source: z.string().nullable(),
  sourceReference: z.string().nullable(),
  validFrom: z.date(),
  validTo: z.date().nullable(),
  version: z.number().int().nullable(),
  supersedesId: z.number().int().nullable(),
  supersededById: z.number().int().nullable(),
  recordedBy: z.number().int().nullable(),
  recordedAt: z.date(),
});
export type OperatorRateRow = z.infer<typeof operatorRateRow>;

export const displayRateAlarmStatus = z.object({
  checkedAt: z.date(),
  pairs: z.array(
    z.object({
      key: z.string(),
      quoteCurrency: z.string(),
      alarm: z.boolean(),
      quoteId: z.number().int().nullable(),
      observedAt: z.date().nullable(),
      expiresAt: z.date().nullable(),
    })
  ),
});

export type OperatorActor = {
  userId: number;
  role: string;
  requestId?: string;
  sourceIp?: string;
};

/** MySQL TIMESTAMP keeps whole seconds; record exactly what is stored. */
function wholeSecond(value: Date): Date {
  return new Date(Math.floor(value.getTime() / 1000) * 1000);
}

function provenance(row: ExchangeRateRecord) {
  return {
    exchangeRateId: row.id,
    baseCurrency: row.fromCurrency,
    quoteCurrency: row.toCurrency,
    rate: row.rate,
    source: row.source,
    sourceReference: row.sourceReference,
    validFrom: row.validFrom.toISOString(),
    validTo: row.validTo?.toISOString() ?? null,
    version: row.version,
    supersedesId: row.supersedesId,
    recordedBy: row.recordedBy,
    recordedAt: row.createdAt.toISOString(),
  };
}

function toRow(
  row: ExchangeRateRecord,
  supersededById: number | null
): OperatorRateRow {
  return {
    id: row.id,
    baseCurrency: OPERATOR_RATE_BASE,
    quoteCurrency: row.toCurrency,
    rate: row.rate,
    source: row.source,
    sourceReference: row.sourceReference,
    validFrom: row.validFrom,
    validTo: row.validTo,
    version: row.version,
    supersedesId: row.supersedesId,
    supersededById,
    recordedBy: row.recordedBy,
    recordedAt: row.createdAt,
  };
}

/** A duplicate pair version or correction, or a deadlock between entries. */
function conflict(error: unknown): boolean {
  const failure =
    (error as { code?: string; cause?: { code?: string } } | null) ?? {};
  return [failure.code, failure.cause?.code].some(
    value => value === "ER_DUP_ENTRY" || value === "ER_LOCK_DEADLOCK"
  );
}

/**
 * Record an operator quote, or a correction of an earlier quote of the same
 * pair. Returns the stored row; the old row of a correction is unchanged.
 */
export async function recordOperatorExchangeRate(
  input: OperatorRateInput,
  actor: OperatorActor
): Promise<OperatorRateRow & { auditEventId: string }> {
  const parsed = operatorRateInput.parse(input);
  const db = getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Exchange rate storage unavailable",
    });
  const validFrom = wholeSecond(parsed.validFrom);
  const validTo = wholeSecond(parsed.validTo);
  if (validTo <= validFrom)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "validTo must be later than validFrom",
    });
  const recordedAt = wholeSecond(new Date());
  const auditEventId = randomUUID();
  const pair = and(
    eq(exchangeRates.fromCurrency, OPERATOR_RATE_BASE),
    eq(exchangeRates.toCurrency, parsed.quoteCurrency)
  );
  let stored: ExchangeRateRecord;
  try {
    stored = await db.transaction(async tx => {
      // Lock the pair's newest version; the unique pair-version index is
      // the backstop if two operators record the same pair at once.
      const [latest] = await tx
        .select({ version: exchangeRates.version })
        .from(exchangeRates)
        .where(pair)
        .orderBy(desc(exchangeRates.version))
        .limit(1)
        .for("update");
      const version = (latest?.version ?? 0) + 1;
      let corrected: ExchangeRateRecord | undefined;
      if (parsed.supersedesId !== undefined) {
        [corrected] = await tx
          .select()
          .from(exchangeRates)
          .where(and(pair, eq(exchangeRates.id, parsed.supersedesId)))
          .for("update");
        if (!corrected)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: `No ${OPERATOR_RATE_BASE}/${parsed.quoteCurrency} quote ${parsed.supersedesId} to correct`,
          });
        const [correction] = await tx
          .select({ id: exchangeRates.id })
          .from(exchangeRates)
          .where(eq(exchangeRates.supersedesId, corrected.id))
          .limit(1);
        if (correction)
          throw new TRPCError({
            code: "CONFLICT",
            message: `Quote ${corrected.id} is already corrected by quote ${correction.id}; correct that quote instead`,
          });
      }
      const [result] = await tx.insert(exchangeRates).values({
        fromCurrency: OPERATOR_RATE_BASE,
        toCurrency: parsed.quoteCurrency,
        rate: parsed.rate,
        source: parsed.source,
        sourceReference: parsed.sourceReference,
        validFrom,
        validTo,
        recordedBy: actor.userId,
        version,
        supersedesId: corrected?.id ?? null,
        createdAt: recordedAt,
        updatedAt: recordedAt,
      });
      const [row] = await tx
        .select()
        .from(exchangeRates)
        .where(eq(exchangeRates.id, Number(result.insertId)));
      if (!row) throw new Error("Recorded exchange rate is not readable");
      await tx.insert(auditLogs).values({
        eventId: auditEventId,
        eventType: corrected
          ? "EXCHANGE_RATE_CORRECTED"
          : "EXCHANGE_RATE_RECORDED",
        eventCategory: "system",
        outcome: "success",
        severity: "medium",
        userId: actor.userId,
        userRole: actor.role,
        actorType: "admin",
        sourceIp: actor.sourceIp ?? null,
        requestId: actor.requestId ?? null,
        resourceType: "exchange_rate",
        resourceId: String(row.id),
        previousValue: corrected ? JSON.stringify(provenance(corrected)) : null,
        newValue: JSON.stringify(provenance(row)),
        changeDescription: corrected
          ? `Corrected ${OPERATOR_RATE_BASE}/${row.toCurrency} quote ${corrected.id} with version ${version}`
          : `Recorded ${OPERATOR_RATE_BASE}/${row.toCurrency} quote version ${version}`,
        metadata: JSON.stringify({ use: "display_estimate_only" }),
        timestamp: recordedAt,
        createdAt: recordedAt,
      });
      return row;
    });
  } catch (error) {
    if (conflict(error))
      throw new TRPCError({
        code: "CONFLICT",
        message:
          "Another quote for this pair was recorded at the same time; reload and retry",
        cause: error,
      });
    throw error;
  }
  // The row and its audit are committed. Cache and alarm follow-ups are
  // best effort: cached snapshots expire on their own, and the alarm is
  // re-evaluated on its next refresh.
  try {
    await invalidateExchangeRateSnapshots(
      OPERATOR_RATE_BASE,
      stored.toCurrency
    );
  } catch (err) {
    log.error({ err }, "Exchange rate cache invalidation will expire instead");
  }
  try {
    await refreshDisplayRateAlarms();
  } catch (err) {
    log.error({ err }, "Display rate alarm refresh will retry");
  }
  return { ...toRow(stored, null), auditEventId };
}

/** Quotes of one pair, newest first, with the row that corrected each. */
export async function listOperatorExchangeRates(
  quote: Exclude<DisplayCurrency, "SAR">,
  limit: number
): Promise<OperatorRateRow[]> {
  const db = getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Exchange rate storage unavailable",
    });
  const correction = alias(exchangeRates, "exchange_rate_correction");
  const rows = await db
    .select({ row: exchangeRates, supersededById: correction.id })
    .from(exchangeRates)
    .leftJoin(correction, eq(correction.supersedesId, exchangeRates.id))
    .where(
      and(
        eq(exchangeRates.fromCurrency, OPERATOR_RATE_BASE),
        eq(exchangeRates.toCurrency, quote)
      )
    )
    .orderBy(desc(exchangeRates.id))
    .limit(limit);
  return rows.map(({ row, supersededById }) => toRow(row, supersededById));
}

/**
 * Staleness alarm, through the shared operational alert transition
 * (operations_alerts and its on-call dispatch). An enabled display pair
 * alarms when it has no quote a display estimate may use: none recorded,
 * expired, superseded, or observed 24 hours ago or earlier.
 */
export async function refreshDisplayRateAlarms(now = new Date()) {
  const db = getDb();
  if (!db) throw new Error("Exchange rate storage unavailable");
  const checks: OperationalCheck[] = [];
  const pairs: z.infer<typeof displayRateAlarmStatus>["pairs"] = [];
  for (const currency of OPERATOR_QUOTE_CURRENCIES) {
    const quote = await findCurrentDisplayQuote(db, currency, now);
    const key = `${DISPLAY_RATE_ALERT_PREFIX}${OPERATOR_RATE_BASE}_${currency}`;
    checks.push({
      key,
      bad: !quote,
      message: quote
        ? `${OPERATOR_RATE_BASE}/${currency} display quote ${quote.id} observed ${quote.validFrom.toISOString()}`
        : `${OPERATOR_RATE_BASE}/${currency} has no current operator quote observed within 24 hours; the display estimate is withheld`,
    });
    pairs.push({
      key,
      quoteCurrency: currency,
      alarm: !quote,
      quoteId: quote?.id ?? null,
      observedAt: quote?.validFrom ?? null,
      expiresAt: quote?.expiresAt ?? null,
    });
  }
  await applyOperationalChecks(checks);
  return { checkedAt: now, pairs };
}
