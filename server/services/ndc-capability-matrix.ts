/**
 * Database-backed distribution capability matrix.
 *
 * `capabilityFor` merges the seeded baseline (ndc-capability-seed.ts) with
 * operator-maintained rows in `distribution_capabilities` and resolves one
 * (carrier, seller, channel, schema version, action) combination. Servicing
 * entry points call `assertCapability` before offering an action; the error
 * names the combination so a refusal is never a generic "unsupported".
 */
import { TRPCError } from "@trpc/server";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import {
  airlines,
  distributionCapabilities,
  flights,
  ndcOrders,
  type Booking,
  type DistributionCapability,
  type NdcOrder,
} from "../../drizzle/schema";
import { getDb } from "../db";
import type { SettlementTx } from "./booking-settlement.service";
import {
  ANY,
  CAPABILITY_CONFIRMATION,
  CAPABILITY_SUPPORT,
  DISTRIBUTION_ACTIONS,
  DISTRIBUTION_CHANNELS,
  INTERNAL_NDC_VERSION,
  describeCombination,
  isSchemaVersionExpression,
  mergeCapabilityRows,
  resolveCapability,
  seedDistributionCapabilities,
  type CapabilityDecision,
  type CapabilityQuery,
  type CapabilityRow,
  type DistributionAction,
  type DistributionChannel,
} from "./ndc-capability-seed";

export {
  ANY,
  DISTRIBUTION_ACTIONS,
  DISTRIBUTION_CHANNELS,
  INTERNAL_NDC_VERSION,
} from "./ndc-capability-seed";
export type {
  CapabilityDecision,
  DistributionAction,
  DistributionChannel,
} from "./ndc-capability-seed";

type Queryable = SettlementTx | NonNullable<Awaited<ReturnType<typeof getDb>>>;

// ============================================================================
// Contracts
// ============================================================================

export const distributionChannelEnum = z.enum(DISTRIBUTION_CHANNELS);
export const distributionActionEnum = z.enum(DISTRIBUTION_ACTIONS);
export const capabilitySupportEnum = z.enum(CAPABILITY_SUPPORT);
export const capabilityConfirmationEnum = z.enum(CAPABILITY_CONFIRMATION);

const carrierCode = z
  .string()
  .trim()
  .regex(/^(\*|[A-Z0-9]{2,3})$/i, "Carrier is an IATA/ICAO code or *")
  .transform(value => value.toUpperCase());
const sellerId = z.string().trim().min(1).max(50);
const schemaVersion = z
  .string()
  .trim()
  .max(16)
  .refine(isSchemaVersionExpression, "Use an exact version, a range A-B or *");

export const distributionCombinationInput = z.object({
  carrierCode: carrierCode.default(ANY),
  sellerId: sellerId.default(ANY),
  channel: distributionChannelEnum,
  schemaVersion: schemaVersion.default(INTERNAL_NDC_VERSION),
});

export const capabilityRowInput = distributionCombinationInput.extend({
  id: z.number().int().positive().optional(),
  action: distributionActionEnum,
  support: capabilitySupportEnum,
  confirmation: capabilityConfirmationEnum,
  evidenceUrl: z.string().trim().url().max(512).nullable().optional(),
  evidenceNote: z.string().trim().max(2000).nullable().optional(),
  idempotencyKeyHeader: z.string().trim().max(120).nullable().optional(),
  traceIdHeader: z.string().trim().max(120).nullable().optional(),
  effectiveFrom: z.coerce.date().nullable().optional(),
  effectiveTo: z.coerce.date().nullable().optional(),
});

export const capabilityRowOutput = z.object({
  id: z.number().int().nullable(),
  source: z.enum(["seed", "database"]),
  carrierCode: z.string(),
  sellerId: z.string(),
  channel: distributionChannelEnum,
  schemaVersion: z.string(),
  action: distributionActionEnum,
  support: capabilitySupportEnum,
  confirmation: capabilityConfirmationEnum,
  evidenceUrl: z.string().nullable(),
  evidenceNote: z.string().nullable(),
  idempotencyKeyHeader: z.string().nullable(),
  traceIdHeader: z.string().nullable(),
  effectiveFrom: z.date().nullable(),
  effectiveTo: z.date().nullable(),
});

export const capabilityDecisionOutput = z.object({
  carrierCode: z.string(),
  sellerId: z.string(),
  channel: distributionChannelEnum,
  schemaVersion: z.string(),
  action: distributionActionEnum,
  support: z.enum([...CAPABILITY_SUPPORT, "unknown"]),
  confirmation: capabilityConfirmationEnum,
  precedence: z.enum([
    "exact_version",
    "version_range",
    "channel_default",
    "none",
  ]),
  allowed: z.boolean(),
  reason: z.string(),
  evidenceUrl: z.string().nullable(),
  evidenceNote: z.string().nullable(),
  rowId: z.number().int().nullable(),
  source: z.enum(["seed", "database"]).nullable(),
});

export const capabilitySummaryOutput = z.object({
  carrierCode: z.string(),
  sellerId: z.string(),
  channel: distributionChannelEnum,
  schemaVersion: z.string(),
  actions: z.record(distributionActionEnum, capabilityDecisionOutput),
});
export type CapabilitySummary = z.infer<typeof capabilitySummaryOutput>;

export interface DistributionContext {
  carrierCode: string;
  sellerId: string;
  channel: DistributionChannel;
  schemaVersion: string;
}

// ============================================================================
// Errors
// ============================================================================

/** Refusal of a servicing action that the matrix does not authorize. */
export class DistributionCapabilityError extends TRPCError {
  readonly decision: CapabilityDecision;
  constructor(decision: CapabilityDecision) {
    super({
      code: "PRECONDITION_FAILED",
      message: `Distribution capability: ${decision.reason}`,
    });
    this.name = "DistributionCapabilityError";
    this.decision = decision;
  }
}

// ============================================================================
// Lookup
// ============================================================================

function fromStored(row: DistributionCapability): CapabilityRow {
  return {
    id: row.id,
    source: "database",
    carrierCode: row.carrierCode,
    sellerId: row.sellerId,
    channel: row.channel,
    schemaVersion: row.schemaVersion,
    action: row.action,
    support: row.support,
    confirmation: row.confirmation,
    evidenceUrl: row.evidenceUrl,
    evidenceNote: row.evidenceNote,
    idempotencyKeyHeader: row.idempotencyKeyHeader,
    traceIdHeader: row.traceIdHeader,
    effectiveFrom: row.effectiveFrom,
    effectiveTo: row.effectiveTo,
  };
}

async function storedRows(
  tx: Queryable,
  channel: DistributionChannel,
  action?: DistributionAction
) {
  const rows = await tx
    .select()
    .from(distributionCapabilities)
    .where(
      and(
        eq(distributionCapabilities.channel, channel),
        action ? eq(distributionCapabilities.action, action) : undefined
      )
    );
  return rows.map(fromStored);
}

/** Seeded baseline plus stored overrides for one channel. */
export async function effectiveCapabilityRows(
  tx: Queryable,
  channel: DistributionChannel,
  action?: DistributionAction
) {
  return mergeCapabilityRows(
    seedDistributionCapabilities.filter(
      row => row.channel === channel && (!action || row.action === action)
    ),
    await storedRows(tx, channel, action)
  );
}

/** Resolve one combination; the decision is never a generic flag. */
export async function capabilityFor(
  tx: Queryable,
  query: CapabilityQuery
): Promise<CapabilityDecision> {
  const rows = await effectiveCapabilityRows(tx, query.channel, query.action);
  return resolveCapability(rows, query);
}

/** Refuse an action the matrix does not authorize for this combination. */
export async function assertCapability(
  tx: Queryable,
  query: CapabilityQuery
): Promise<CapabilityDecision> {
  const decision = await capabilityFor(tx, query);
  if (!decision.allowed) throw new DistributionCapabilityError(decision);
  return decision;
}

/** Decisions for every action of one combination (client read model). */
export async function resolveCapabilitySummary(
  tx: Queryable,
  context: DistributionContext,
  at?: Date
): Promise<CapabilitySummary> {
  const rows = await effectiveCapabilityRows(tx, context.channel);
  const actions = Object.fromEntries(
    DISTRIBUTION_ACTIONS.map(action => [
      action,
      resolveCapability(rows, { ...context, action, at }),
    ])
  ) as Record<DistributionAction, CapabilityDecision>;
  return {
    carrierCode: context.carrierCode.toUpperCase(),
    sellerId: context.sellerId,
    channel: context.channel,
    schemaVersion: context.schemaVersion,
    actions,
  };
}

// ============================================================================
// Context derivation
// ============================================================================

const orderChannelMap: Record<NdcOrder["channel"], DistributionChannel> = {
  direct: "direct",
  ndc_aggregator: "ndc",
  gds: "gds",
  ota: "ota",
  // Traditional agency sales reach the carrier through a GDS.
  travel_agent: "gds",
};

/** Map the stored NDC order/offer channel onto the matrix channel. */
export function distributionChannelOf(
  channel: NdcOrder["channel"] | null | undefined
): DistributionChannel {
  return channel ? orderChannelMap[channel] : "direct";
}

/** Schema version recorded on an order payload, else the internal vocabulary. */
export function schemaVersionOf(orderPayload: string | null | undefined) {
  if (!orderPayload) return INTERNAL_NDC_VERSION;
  try {
    const parsed = JSON.parse(orderPayload) as { ndcVersion?: unknown };
    return typeof parsed.ndcVersion === "string" &&
      /^\d+\.\d+$/.test(parsed.ndcVersion)
      ? parsed.ndcVersion
      : INTERNAL_NDC_VERSION;
  } catch {
    return INTERNAL_NDC_VERSION;
  }
}

async function carrierCodeOf(tx: Queryable, flightId: number | null) {
  if (!flightId) return ANY;
  const [flight] = await tx
    .select({ airlineId: flights.airlineId })
    .from(flights)
    .where(eq(flights.id, flightId))
    .limit(1);
  if (!flight?.airlineId) return ANY;
  const [airline] = await tx
    .select({ code: airlines.code })
    .from(airlines)
    .where(eq(airlines.id, flight.airlineId))
    .limit(1);
  return airline?.code?.toUpperCase() || ANY;
}

/**
 * Distribution combination of a booking: the issuing NDC order (channel,
 * distributor, payload schema version) when one exists, otherwise the direct
 * channel in the internal vocabulary; the carrier is the flight's airline.
 */
export async function bookingDistributionContext(
  tx: Queryable,
  booking: Pick<Booking, "id" | "flightId">,
  order?: Pick<NdcOrder, "channel" | "distributorId" | "orderPayload"> | null
): Promise<DistributionContext> {
  let issuing = order ?? null;
  if (issuing === undefined || issuing === null) {
    const [stored] = await tx
      .select({
        channel: ndcOrders.channel,
        distributorId: ndcOrders.distributorId,
        orderPayload: ndcOrders.orderPayload,
      })
      .from(ndcOrders)
      .where(eq(ndcOrders.bookingId, booking.id))
      .orderBy(asc(ndcOrders.id))
      .limit(1);
    issuing = stored ?? null;
  }
  return {
    carrierCode: await carrierCodeOf(tx, booking.flightId),
    sellerId: issuing?.distributorId || ANY,
    channel: distributionChannelOf(issuing?.channel),
    schemaVersion: schemaVersionOf(issuing?.orderPayload),
  };
}

/** Gate one servicing action for a booking; returns the decision when allowed. */
export async function assertBookingCapability(
  tx: Queryable,
  booking: Pick<Booking, "id" | "flightId">,
  action: DistributionAction,
  order?: Pick<NdcOrder, "channel" | "distributorId" | "orderPayload"> | null
) {
  const context = await bookingDistributionContext(tx, booking, order);
  return assertCapability(tx, { ...context, action });
}

// ============================================================================
// Admin CRUD
// ============================================================================

async function requireDb() {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "SERVICE_UNAVAILABLE",
      message: "Capability storage unavailable",
    });
  return db;
}

export async function listDistributionCapabilities(filters: {
  channel?: DistributionChannel;
  action?: DistributionAction;
  carrierCode?: string;
  includeSeeds?: boolean;
}) {
  const db = await requireDb();
  const stored = (
    await db
      .select()
      .from(distributionCapabilities)
      .orderBy(asc(distributionCapabilities.id))
  ).map(fromStored);
  const rows =
    filters.includeSeeds === false
      ? stored
      : mergeCapabilityRows(seedDistributionCapabilities, stored);
  const carrier = filters.carrierCode?.toUpperCase();
  return rows
    .filter(
      row =>
        (!filters.channel || row.channel === filters.channel) &&
        (!filters.action || row.action === filters.action) &&
        (!carrier || row.carrierCode === carrier || row.carrierCode === ANY)
    )
    .map(row => ({ ...row, id: row.id ?? null }));
}

export async function upsertDistributionCapability(
  input: z.infer<typeof capabilityRowInput>,
  actorId: number
) {
  const db = await requireDb();
  if (
    input.effectiveFrom &&
    input.effectiveTo &&
    input.effectiveFrom > input.effectiveTo
  )
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "effectiveFrom must not be after effectiveTo",
    });
  if (
    input.confirmation === "confirmed" &&
    !input.evidenceUrl &&
    !input.evidenceNote
  )
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `A confirmed capability for ${describeCombination(input)} needs an evidence URL or note`,
    });
  const values = {
    carrierCode: input.carrierCode,
    sellerId: input.sellerId,
    channel: input.channel,
    schemaVersion: input.schemaVersion,
    action: input.action,
    support: input.support,
    confirmation: input.confirmation,
    evidenceUrl: input.evidenceUrl ?? null,
    evidenceNote: input.evidenceNote ?? null,
    idempotencyKeyHeader: input.idempotencyKeyHeader || null,
    traceIdHeader: input.traceIdHeader || null,
    effectiveFrom: input.effectiveFrom ?? null,
    effectiveTo: input.effectiveTo ?? null,
    updatedBy: actorId,
  };
  const [existing] = await db
    .select({ id: distributionCapabilities.id })
    .from(distributionCapabilities)
    .where(
      and(
        eq(distributionCapabilities.carrierCode, values.carrierCode),
        eq(distributionCapabilities.sellerId, values.sellerId),
        eq(distributionCapabilities.channel, values.channel),
        eq(distributionCapabilities.schemaVersion, values.schemaVersion),
        eq(distributionCapabilities.action, values.action)
      )
    )
    .limit(1);
  if (input.id && existing && existing.id !== input.id)
    throw new TRPCError({
      code: "CONFLICT",
      message: `Another row already covers ${describeCombination(input)} for ${input.action}`,
    });
  const id = input.id ?? existing?.id;
  if (id) {
    await db
      .update(distributionCapabilities)
      .set(values)
      .where(eq(distributionCapabilities.id, id));
  } else {
    await db.insert(distributionCapabilities).values(values);
  }
  const [row] = await db
    .select()
    .from(distributionCapabilities)
    .where(
      and(
        eq(distributionCapabilities.carrierCode, values.carrierCode),
        eq(distributionCapabilities.sellerId, values.sellerId),
        eq(distributionCapabilities.channel, values.channel),
        eq(distributionCapabilities.schemaVersion, values.schemaVersion),
        eq(distributionCapabilities.action, values.action)
      )
    )
    .limit(1);
  if (!row)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Capability row was not persisted",
    });
  return { ...fromStored(row), id: row.id };
}

export async function deleteDistributionCapability(id: number) {
  const db = await requireDb();
  const [row] = await db
    .select({ id: distributionCapabilities.id })
    .from(distributionCapabilities)
    .where(eq(distributionCapabilities.id, id))
    .limit(1);
  if (!row)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Capability row not found",
    });
  await db
    .delete(distributionCapabilities)
    .where(eq(distributionCapabilities.id, id));
  return { deleted: true as const, id };
}

/** Resolve every action for an explicit combination (read endpoint). */
export async function resolveDistributionCapabilities(
  input: z.infer<typeof distributionCombinationInput>
) {
  const db = await requireDb();
  return resolveCapabilitySummary(db, input);
}
