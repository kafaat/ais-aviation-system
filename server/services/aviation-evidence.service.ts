import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { aviationEvidence } from "../../drizzle/schema";
import { calculateRequestHash } from "./idempotency-v2.service";
import { recordEvent } from "./outbox.service";
import type { SettlementTx } from "./booking-settlement.service";

export const evidenceEnvelope = z
  .object({
    sourceId: z.string().min(1).max(64),
    eventId: z.string().min(1).max(128),
    issuedAt: z.iso.datetime(),
    observedAt: z.iso.datetime(),
    flightId: z.number().int().positive().nullable(),
    kind: z.string().min(1).max(50),
    payload: z.record(z.string(), z.unknown()),
  })
  .strict();
export type EvidenceEnvelope = z.infer<typeof evidenceEnvelope>;
const sourceSchema = z.object({
  sourceId: z.string(),
  tenantId: z.number().int().positive().nullable(),
  capabilities: z.array(z.string()),
  secretEnv: z.string().regex(/^[A-Z][A-Z0-9_]+$/),
  validUntil: z.iso.datetime(),
});
export type AviationSource = z.infer<typeof sourceSchema>;
/** No credentials or source registration are accepted from the ingestion request. */
export function verifyAviationSource(
  envelope: EvidenceEnvelope,
  signature: string,
  capability: string,
  now = new Date()
): AviationSource {
  evidenceEnvelope.parse(envelope);
  if (
    JSON.stringify(envelope).length > 65536 ||
    Math.abs(now.getTime() - Date.parse(envelope.issuedAt)) > 300000 ||
    Date.parse(envelope.observedAt) > now.getTime() + 60000
  )
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Invalid event size or timestamp",
    });
  const registry = z
    .array(sourceSchema)
    .parse(JSON.parse(process.env.AVIATION_SOURCE_REGISTRY ?? "[]"));
  const matches = registry.filter(s => s.sourceId === envelope.sourceId);
  const source = matches.length === 1 ? matches[0] : undefined;
  const key = source ? process.env[source.secretEnv] : undefined;
  if (
    !source ||
    Date.parse(source.validUntil) <= now.getTime() ||
    !source.capabilities.includes(capability) ||
    !key ||
    key.length < 32 ||
    !/^[a-f0-9]{64}$/.test(signature)
  )
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Source is not authorized for this capability",
    });
  const expected = createHmac("sha256", key)
    .update(calculateRequestHash(envelope))
    .digest();
  if (!timingSafeEqual(expected, Buffer.from(signature, "hex")))
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Invalid source signature",
    });
  return source;
}
export function evidenceDigest(e: EvidenceEnvelope) {
  // Retries may refresh transport issuedAt; business event content is immutable.
  const { issuedAt: _issuedAt, ...content } = e;
  return calculateRequestHash(content);
}
/** Caller holds the flight/entity lock. Records evidence and outbox atomically. */
export async function persistAviationEvidence(
  tx: SettlementTx,
  e: EvidenceEnvelope,
  source: AviationSource
) {
  const digest = evidenceDigest(e);
  const [existing] = await tx
    .select()
    .from(aviationEvidence)
    .where(
      and(
        eq(aviationEvidence.sourceId, e.sourceId),
        eq(aviationEvidence.sourceEventId, e.eventId)
      )
    )
    .limit(1);
  if (existing) {
    if (existing.digest !== digest || existing.tenantId !== source.tenantId)
      throw new TRPCError({
        code: "CONFLICT",
        message: "Source event identity was reused with different content",
      });
    return { evidenceId: existing.id, duplicate: true };
  }
  const result = await tx.insert(aviationEvidence).values({
    sourceId: e.sourceId,
    sourceEventId: e.eventId,
    tenantId: source.tenantId,
    flightId: e.flightId,
    kind: e.kind,
    payload: e.payload,
    digest,
    observedAt: new Date(e.observedAt),
    receivedAt: new Date(),
  });
  const evidenceId = Number(result[0].insertId);
  if (!Number.isSafeInteger(evidenceId) || evidenceId <= 0)
    throw new Error("Evidence identity unavailable");
  await recordEvent(tx, {
    aggregateType: "aviationEvidence",
    aggregateId: evidenceId,
    tenantId: source.tenantId,
    eventType: `aviation.${e.kind}`,
    payload: {
      evidenceId,
      sourceId: source.sourceId,
      flightId: e.flightId,
      observedAt: e.observedAt,
      digest,
    },
  });
  return { evidenceId, duplicate: false };
}
