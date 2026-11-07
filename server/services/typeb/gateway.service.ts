/**
 * Type B gateway: station file, outbound queue, inbound ingest.
 *
 * Producers hand a {@link TypeBPayload} to {@link enqueueTypeBMessage}; the
 * gateway resolves recipients from the station file, wraps each part in a
 * Type B envelope and stores it `queued`. {@link drainTypeBQueue} claims
 * queued rows with a lease and pushes them through a {@link TypeBTransport}.
 * Inbound text goes through {@link ingestInboundTypeB}, which parses MVT, LDM
 * and BSM/BPM into typed records and stores raw + parsed idempotently.
 */
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { getDb } from "../../db";
import {
  flights,
  typebAddresses,
  typebMessages,
  type TypeBAddress,
  type TypeBMessage,
} from "../../../drizzle/schema";
import { calculateRequestHash } from "../idempotency-v2.service";
import {
  composeMessage,
  parseAddress,
  parseEnvelope,
  type TypeBPriority,
} from "./envelope";
import { parseLdm } from "./ldm";
import {
  TYPEB_MESSAGE_TYPES,
  TypeBFormatError,
  type TypeBMessageType,
  type TypeBPayload,
} from "./model";
import { parseMvt } from "./mvt";
import { parseBsm } from "./bsm";
import { typeBSerializer } from "./serializer";
import { flightCode, parseDdmmm } from "./text";
import type { TypeBTransport } from "./transport";

const DEFAULT_MAX_ATTEMPTS = 5;
/** A claimed row older than this is assumed orphaned and becomes claimable. */
export const TYPEB_CLAIM_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_PNL_LEAD_MINUTES = 180;

export class TypeBGatewayError extends Error {}

function db() {
  const handle = getDb();
  if (!handle)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });
  return handle;
}

export function typeBConfig(env: NodeJS.ProcessEnv = process.env) {
  const origin = env.TYPEB_ORIGIN_ADDRESS?.trim().toUpperCase() ?? "";
  const lead = Number(env.TYPEB_PNL_LEAD_MINUTES ?? DEFAULT_PNL_LEAD_MINUTES);
  return {
    originAddress: /^[A-Z]{3}[A-Z]{2}[A-Z0-9]{2}$/.test(origin) ? origin : null,
    pnlLeadMinutes:
      Number.isInteger(lead) && lead >= 30 && lead <= 24 * 60
        ? lead
        : DEFAULT_PNL_LEAD_MINUTES,
    transportMode: env.TYPEB_TRANSPORT?.trim() || "disabled",
    ingestTokenConfigured: (env.TYPEB_INGEST_TOKEN?.trim().length ?? 0) >= 32,
  };
}

function requireOrigin(): string {
  const { originAddress } = typeBConfig();
  if (!originAddress)
    throw new TypeBGatewayError(
      "TYPEB_ORIGIN_ADDRESS (seven-character Type B address) is not configured"
    );
  return originAddress;
}

// ---------------------------------------------------------------------------
// Station file
// ---------------------------------------------------------------------------

export interface AddressInput {
  id?: number;
  address: string;
  stationCode?: string | null;
  handlerName: string;
  messageTypes: string[];
  enabled?: boolean;
  notes?: string | null;
}

export function normalizeAddressInput(input: AddressInput) {
  const types = [
    ...new Set(input.messageTypes.map(t => t.toUpperCase().trim())),
  ];
  const unknown = types.filter(
    t => !(TYPEB_MESSAGE_TYPES as readonly string[]).includes(t)
  );
  if (unknown.length)
    throw new TypeBGatewayError(`Unknown message types: ${unknown.join(", ")}`);
  if (!types.length)
    throw new TypeBGatewayError("Subscribe the address to at least one type");
  const station = input.stationCode?.trim().toUpperCase() || null;
  if (station && !/^[A-Z]{3}$/.test(station))
    throw new TypeBGatewayError(`Invalid station code ${input.stationCode}`);
  const handlerName = input.handlerName.trim();
  if (!handlerName) throw new TypeBGatewayError("Handler name is required");
  return {
    address: parseAddress(input.address).address,
    stationCode: station,
    handlerName: handlerName.slice(0, 120),
    messageTypes: types as TypeBMessageType[],
    enabled: input.enabled ?? true,
    notes: input.notes?.trim().slice(0, 500) || null,
  };
}

export async function listAddresses(tenantId: number | null) {
  return await db()
    .select()
    .from(typebAddresses)
    .where(
      tenantId === null
        ? undefined
        : or(
            eq(typebAddresses.tenantId, tenantId),
            isNull(typebAddresses.tenantId)
          )
    )
    .orderBy(asc(typebAddresses.stationCode), asc(typebAddresses.address));
}

export async function upsertAddress(
  input: AddressInput,
  tenantId: number | null
) {
  const row = normalizeAddressInput(input);
  const handle = db();
  if (input.id) {
    const [existing] = await handle
      .select()
      .from(typebAddresses)
      .where(eq(typebAddresses.id, input.id))
      .limit(1);
    if (!existing || (tenantId !== null && existing.tenantId !== tenantId))
      throw new TRPCError({ code: "NOT_FOUND", message: "Address not found" });
    await handle
      .update(typebAddresses)
      .set(row)
      .where(eq(typebAddresses.id, input.id));
    return { id: input.id, created: false };
  }
  const [result] = await handle
    .insert(typebAddresses)
    .values({ ...row, tenantId });
  return { id: Number(result.insertId), created: true };
}

export async function removeAddress(id: number, tenantId: number | null) {
  const handle = db();
  const [existing] = await handle
    .select()
    .from(typebAddresses)
    .where(eq(typebAddresses.id, id))
    .limit(1);
  if (!existing || (tenantId !== null && existing.tenantId !== tenantId))
    throw new TRPCError({ code: "NOT_FOUND", message: "Address not found" });
  await handle.delete(typebAddresses).where(eq(typebAddresses.id, id));
  return { id };
}

/** Which stations a message type is routed to. */
export function stationsFor(
  type: TypeBMessageType,
  origin: string,
  destination: string
): string[] {
  switch (type) {
    case "PNL":
    case "ADL":
      return [origin];
    case "LDM":
      return [destination];
    case "MVT":
    case "BSM":
    case "BPM":
      return [origin, destination];
  }
}

/** Pure recipient selection over station-file rows (unit-tested). */
export function recipientsFor(
  rows: Pick<
    TypeBAddress,
    "address" | "stationCode" | "messageTypes" | "enabled" | "tenantId"
  >[],
  type: TypeBMessageType,
  stations: string[],
  tenantId: number | null
): string[] {
  return [
    ...new Set(
      rows
        .filter(
          r =>
            r.enabled &&
            (r.tenantId === null || r.tenantId === tenantId) &&
            r.messageTypes.includes(type) &&
            (r.stationCode === null || stations.includes(r.stationCode))
        )
        .map(r => r.address)
    ),
  ].sort();
}

export async function resolveRecipients(
  type: TypeBMessageType,
  stations: string[],
  tenantId: number | null
) {
  const rows = await db()
    .select()
    .from(typebAddresses)
    .where(eq(typebAddresses.enabled, true));
  return recipientsFor(rows, type, stations, tenantId);
}

// ---------------------------------------------------------------------------
// Outbound queue
// ---------------------------------------------------------------------------

export interface EnqueueInput {
  payload: TypeBPayload;
  tenantId: number | null;
  flightId: number | null;
  /** Explicit addresses; when omitted the station file decides. */
  addresses?: string[];
  stations?: string[];
  priority?: TypeBPriority;
  /** Idempotency key; parts append :P<n>. */
  dedupKey?: string;
  sentAt?: Date;
}

export interface EnqueueResult {
  ids: number[];
  duplicates: number;
  addresses: string[];
  parts: string[];
}

function flightIdentity(payload: TypeBPayload) {
  const date =
    payload.type === "MVT"
      ? payload.date
      : payload.type === "BSM" || payload.type === "BPM"
        ? payload.outbound.date
        : payload.departureDate;
  const station =
    payload.type === "MVT"
      ? payload.station
      : payload.type === "BSM" || payload.type === "BPM"
        ? payload.version.station
        : payload.type === "LDM"
          ? (payload.destinations[0]?.station ?? null)
          : payload.boardPoint;
  return {
    flightDesignator: flightCode(
      payload.type === "BSM" || payload.type === "BPM"
        ? payload.outbound.flight
        : payload.flight
    ),
    flightDate: date.toISOString().slice(0, 10),
    station: station ? station.toUpperCase() : null,
  };
}

/** Render parts and resolve recipients without writing anything (preview). */
export async function renderTypeBMessage(input: EnqueueInput) {
  const serialized = typeBSerializer.serialize(input.payload);
  const identity = flightIdentity(input.payload);
  const addresses =
    input.addresses?.map(a => parseAddress(a).address) ??
    (await resolveRecipients(
      input.payload.type,
      input.stations ?? (identity.station ? [identity.station] : []),
      input.tenantId
    ));
  return { serialized, identity, addresses };
}

export async function enqueueTypeBMessage(
  input: EnqueueInput
): Promise<EnqueueResult> {
  const origin = requireOrigin();
  const { serialized, identity, addresses } = await renderTypeBMessage(input);
  if (!addresses.length)
    throw new TypeBGatewayError(
      `No enabled Type B address subscribes to ${input.payload.type} for ${
        (input.stations ?? [identity.station]).join("/") || "this flight"
      }`
    );
  const handle = db();
  const ids: number[] = [];
  let duplicates = 0;
  const parts: string[] = [];
  for (const [index, part] of serialized.parts.entries()) {
    const lines = composeMessage(
      {
        priority: input.priority ?? "QU",
        addresses,
        origin,
        sentAt: input.sentAt,
      },
      part.split("\n")
    );
    const body = lines.join("\n");
    parts.push(body);
    const dedupKey = input.dedupKey
      ? serialized.parts.length > 1
        ? `${input.dedupKey}:P${index + 1}`
        : input.dedupKey
      : null;
    if (dedupKey) {
      const [existing] = await handle
        .select({ id: typebMessages.id })
        .from(typebMessages)
        .where(eq(typebMessages.dedupKey, dedupKey))
        .limit(1);
      if (existing) {
        duplicates += 1;
        ids.push(existing.id);
        continue;
      }
    }
    try {
      const [result] = await handle.insert(typebMessages).values({
        tenantId: input.tenantId,
        direction: "outbound",
        messageType: input.payload.type,
        flightId: input.flightId,
        ...identity,
        priority: input.priority ?? "QU",
        originAddress: origin,
        addresses,
        body,
        status: "queued",
        dedupKey,
      });
      ids.push(Number(result.insertId));
    } catch (error) {
      // Unique dedup key raced with another writer: treat as duplicate.
      if (dedupKey && /Duplicate entry/i.test(String(error))) {
        duplicates += 1;
        const [existing] = await handle
          .select({ id: typebMessages.id })
          .from(typebMessages)
          .where(eq(typebMessages.dedupKey, dedupKey))
          .limit(1);
        if (existing) ids.push(existing.id);
      } else throw error;
    }
  }
  return { ids, duplicates, addresses, parts };
}

function claimable(maxAttempts: number, now: Date) {
  const stale = new Date(now.getTime() - TYPEB_CLAIM_TIMEOUT_MS);
  return and(
    eq(typebMessages.direction, "outbound"),
    eq(typebMessages.status, "queued"),
    or(isNull(typebMessages.leaseToken), lt(typebMessages.lockedAt, stale)),
    lt(typebMessages.attempts, maxAttempts)
  );
}

export async function claimQueuedMessages(
  limit = 50,
  maxAttempts = DEFAULT_MAX_ATTEMPTS
) {
  const handle = db();
  const now = new Date();
  const leaseToken = randomUUID();
  return await handle.transaction(async tx => {
    const rows = await tx
      .select()
      .from(typebMessages)
      .where(claimable(maxAttempts, now))
      .orderBy(asc(typebMessages.createdAt), asc(typebMessages.id))
      .limit(limit)
      .for("update", { skipLocked: true });
    if (!rows.length) return [];
    await tx
      .update(typebMessages)
      .set({ leaseToken, lockedAt: now })
      .where(
        inArray(
          typebMessages.id,
          rows.map(r => r.id)
        )
      );
    return rows.map(r => ({ ...r, leaseToken, lockedAt: now }));
  });
}

export interface OutboundResult {
  sent: Array<{ id: number; transportReference: string }>;
  failed: Array<{ id: number; error: string }>;
}

/** Pure delivery core: push each claimed message through the transport. */
export async function processOutbound(
  messages: Pick<TypeBMessage, "id" | "messageType" | "addresses" | "body">[],
  transport: TypeBTransport
): Promise<OutboundResult> {
  const result: OutboundResult = { sent: [], failed: [] };
  for (const m of messages) {
    try {
      const { transportReference } = await transport.send({
        id: m.id,
        messageType: m.messageType as TypeBMessageType,
        addresses: m.addresses,
        text: m.body,
      });
      result.sent.push({ id: m.id, transportReference });
    } catch (error) {
      result.failed.push({
        id: m.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return result;
}

export async function drainTypeBQueue(
  transport: TypeBTransport,
  opts: { limit?: number; maxAttempts?: number } = {}
) {
  const maxAttempts = opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const claimed = await claimQueuedMessages(opts.limit, maxAttempts);
  if (!claimed.length) return { sent: 0, failed: 0 };
  const outcome = await processOutbound(claimed, transport);
  const handle = db();
  for (const s of outcome.sent) {
    const claim = claimed.find(c => c.id === s.id);
    if (!claim?.leaseToken) continue;
    await handle
      .update(typebMessages)
      .set({
        // A transport that acknowledges moves the row to `acked` later via
        // acknowledgeTypeBMessage; file drop and memory stay `sent`.
        status: "sent",
        sentAt: new Date(),
        transportId: transport.id,
        transportReference: s.transportReference.slice(0, 255),
        attempts: sql`${typebMessages.attempts} + 1`,
        lastError: null,
        leaseToken: null,
        lockedAt: null,
      })
      .where(
        and(
          eq(typebMessages.id, s.id),
          eq(typebMessages.leaseToken, claim.leaseToken)
        )
      );
  }
  for (const f of outcome.failed) {
    const claim = claimed.find(c => c.id === f.id);
    if (!claim?.leaseToken) continue;
    await handle
      .update(typebMessages)
      .set({
        status: sql`CASE WHEN ${typebMessages.attempts} + 1 >= ${maxAttempts} THEN 'failed' ELSE 'queued' END`,
        attempts: sql`${typebMessages.attempts} + 1`,
        lastError: f.error.slice(0, 500),
        transportId: transport.id,
        leaseToken: null,
        lockedAt: null,
      })
      .where(
        and(
          eq(typebMessages.id, f.id),
          eq(typebMessages.leaseToken, claim.leaseToken)
        )
      );
  }
  return { sent: outcome.sent.length, failed: outcome.failed.length };
}

/** Provider or handler acknowledgement, matched by id or transport reference. */
export async function acknowledgeTypeBMessage(
  ref: { id: number } | { transportReference: string },
  tenantId: number | null
) {
  const handle = db();
  const condition =
    "id" in ref
      ? eq(typebMessages.id, ref.id)
      : eq(typebMessages.transportReference, ref.transportReference);
  const [row] = await handle
    .select()
    .from(typebMessages)
    .where(condition)
    .limit(1);
  if (!row || (tenantId !== null && row.tenantId !== tenantId))
    throw new TRPCError({ code: "NOT_FOUND", message: "Message not found" });
  if (row.direction !== "outbound" || row.status !== "sent")
    throw new TypeBGatewayError(
      `Only sent outbound messages can be acknowledged (status ${row.status})`
    );
  await handle
    .update(typebMessages)
    .set({ status: "acked", ackedAt: new Date() })
    .where(eq(typebMessages.id, row.id));
  return { id: row.id };
}

export async function retryTypeBMessage(id: number, tenantId: number | null) {
  const handle = db();
  const [row] = await handle
    .select()
    .from(typebMessages)
    .where(eq(typebMessages.id, id))
    .limit(1);
  if (!row || (tenantId !== null && row.tenantId !== tenantId))
    throw new TRPCError({ code: "NOT_FOUND", message: "Message not found" });
  if (row.direction !== "outbound" || row.status !== "failed")
    throw new TypeBGatewayError("Only failed outbound messages can be retried");
  await handle
    .update(typebMessages)
    .set({
      status: "queued",
      attempts: 0,
      lastError: null,
      leaseToken: null,
      lockedAt: null,
    })
    .where(eq(typebMessages.id, id));
  return { id };
}

// ---------------------------------------------------------------------------
// Inbound
// ---------------------------------------------------------------------------

export interface InboundParse {
  type: TypeBMessageType;
  header: ReturnType<typeof parseEnvelope>["header"];
  parsed: Record<string, unknown>;
  flightDesignator: string | null;
  flightDate: string | null;
  station: string | null;
}

/** Parse raw inbound text into a typed record; throws TypeBFormatError. */
export function parseInbound(
  raw: string,
  reference = new Date()
): InboundParse {
  const envelope = parseEnvelope(raw);
  const base = {
    type: envelope.type,
    header: envelope.header,
    flightDesignator: null as string | null,
    flightDate: null as string | null,
    station: null as string | null,
  };
  switch (envelope.type) {
    case "MVT": {
      const parsed = parseMvt(envelope.textLines, reference);
      const day = new Date(
        Date.UTC(
          reference.getUTCFullYear(),
          reference.getUTCMonth(),
          parsed.day
        )
      );
      return {
        ...base,
        parsed: parsed as unknown as Record<string, unknown>,
        flightDesignator: flightCode(parsed.flight),
        flightDate: day.toISOString().slice(0, 10),
        station: parsed.station,
      };
    }
    case "LDM": {
      const parsed = parseLdm(envelope.textLines);
      const day = new Date(
        Date.UTC(
          reference.getUTCFullYear(),
          reference.getUTCMonth(),
          parsed.day
        )
      );
      return {
        ...base,
        parsed: parsed as unknown as Record<string, unknown>,
        flightDesignator: flightCode(parsed.flight),
        flightDate: day.toISOString().slice(0, 10),
        station: parsed.destinations[0]?.station ?? null,
      };
    }
    case "BSM":
    case "BPM": {
      const parsed = parseBsm(envelope.textLines, reference);
      return {
        ...base,
        parsed: parsed as unknown as Record<string, unknown>,
        flightDesignator: parsed.outbound
          ? flightCode(parsed.outbound.flight)
          : null,
        flightDate: parsed.outbound
          ? parseDdmmm(parsed.outbound.date, reference)
              .toISOString()
              .slice(0, 10)
          : null,
        station: parsed.version?.station ?? null,
      };
    }
    default:
      throw new TypeBFormatError(
        `Inbound ${envelope.type} is archived but not parsed by this gateway`,
        "type"
      );
  }
}

/** Find the AIS flight instance a designator/date pair refers to, if any. */
export async function matchFlight(
  designator: string | null,
  flightDate: string | null,
  tenantId: number | null
) {
  if (!designator || !flightDate) return null;
  const numberOnly = designator.replace(/^[A-Z0-9]{2,3}?(?=\d)/, "");
  const candidates = [
    designator,
    `${designator.slice(0, 2)}${numberOnly.padStart(4, "0")}`,
    numberOnly,
  ];
  const rows = await db()
    .select({ id: flights.id, tenantId: flights.tenantId })
    .from(flights)
    .where(
      and(
        inArray(flights.flightNumber, candidates),
        sql`DATE(${flights.departureTime}) = ${flightDate}`
      )
    )
    .limit(2);
  const scoped = rows.filter(r => tenantId === null || r.tenantId === tenantId);
  return scoped.length === 1 ? scoped[0].id : null;
}

export async function ingestInboundTypeB(input: {
  raw: string;
  transportReference?: string | null;
  transportId?: string | null;
  tenantId: number | null;
  now?: Date;
}) {
  const raw = input.raw.replace(/\r\n?/g, "\n").trim();
  if (!raw) throw new TypeBGatewayError("Empty message");
  if (raw.length > 16000)
    throw new TypeBGatewayError(
      "Inbound message exceeds the Type B size limit"
    );
  const dedupKey = `IN:${calculateRequestHash({ raw, tenantId: input.tenantId })}`;
  const handle = db();
  const [existing] = await handle
    .select()
    .from(typebMessages)
    .where(eq(typebMessages.dedupKey, dedupKey))
    .limit(1);
  if (existing)
    return {
      id: existing.id,
      duplicate: true,
      status: existing.status,
      type: existing.messageType,
    };
  let parsed: InboundParse | null = null;
  let error: string | null = null;
  let type: string = "UNKNOWN";
  try {
    parsed = parseInbound(raw, input.now);
    type = parsed.type;
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
    try {
      type = parseEnvelope(raw).type;
    } catch {
      /* unrecognised */
    }
  }
  const flightId = parsed
    ? await matchFlight(
        parsed.flightDesignator,
        parsed.flightDate,
        input.tenantId
      )
    : null;
  const [result] = await handle.insert(typebMessages).values({
    tenantId: input.tenantId,
    direction: "inbound",
    messageType: type.slice(0, 8),
    flightId,
    flightDesignator: parsed?.flightDesignator ?? null,
    flightDate: parsed?.flightDate ?? null,
    station: parsed?.station ?? null,
    priority: parsed?.header?.priority ?? null,
    originAddress: parsed?.header?.origin ?? null,
    addresses: parsed?.header?.addresses ?? [],
    body: raw,
    parsed: parsed ? { ...parsed.parsed, header: parsed.header } : null,
    status: parsed ? "received" : "failed",
    attempts: 1,
    lastError: error?.slice(0, 500) ?? null,
    transportId: input.transportId ?? null,
    transportReference: input.transportReference?.slice(0, 255) ?? null,
    dedupKey,
  });
  return {
    id: Number(result.insertId),
    duplicate: false,
    status: parsed ? ("received" as const) : ("failed" as const),
    type,
    flightId,
    error,
  };
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export async function listMessages(
  filters: {
    direction?: "outbound" | "inbound";
    status?: TypeBMessage["status"];
    messageType?: string;
    flightId?: number;
    limit?: number;
  },
  tenantId: number | null
) {
  const conditions = [
    filters.direction
      ? eq(typebMessages.direction, filters.direction)
      : undefined,
    filters.status ? eq(typebMessages.status, filters.status) : undefined,
    filters.messageType
      ? eq(typebMessages.messageType, filters.messageType)
      : undefined,
    filters.flightId ? eq(typebMessages.flightId, filters.flightId) : undefined,
    tenantId === null ? undefined : eq(typebMessages.tenantId, tenantId),
  ].filter(Boolean);
  return await db()
    .select()
    .from(typebMessages)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(typebMessages.createdAt), desc(typebMessages.id))
    .limit(Math.min(filters.limit ?? 100, 500));
}

export async function getMessage(id: number, tenantId: number | null) {
  const [row] = await db()
    .select()
    .from(typebMessages)
    .where(eq(typebMessages.id, id))
    .limit(1);
  if (!row || (tenantId !== null && row.tenantId !== tenantId))
    throw new TRPCError({ code: "NOT_FOUND", message: "Message not found" });
  return row;
}

/** True when a PNL for the flight has already been queued or sent. */
export async function pnlIssued(flightId: number) {
  const [row] = await db()
    .select({ id: typebMessages.id })
    .from(typebMessages)
    .where(
      and(
        eq(typebMessages.flightId, flightId),
        eq(typebMessages.messageType, "PNL"),
        eq(typebMessages.direction, "outbound"),
        inArray(typebMessages.status, ["queued", "sent", "acked"])
      )
    )
    .limit(1);
  return Boolean(row);
}

export async function gatewayStatus(tenantId: number | null) {
  const rows = await db()
    .select({
      direction: typebMessages.direction,
      status: typebMessages.status,
      count: sql<number>`COUNT(*)`,
    })
    .from(typebMessages)
    .where(tenantId === null ? undefined : eq(typebMessages.tenantId, tenantId))
    .groupBy(typebMessages.direction, typebMessages.status);
  const config = typeBConfig();
  return {
    ...config,
    counts: rows.map(r => ({ ...r, count: Number(r.count) })),
    acceptance:
      "Message formats and queue are local; SITA/ARINC transport and handler sample exchange are not recorded" as const,
  };
}
