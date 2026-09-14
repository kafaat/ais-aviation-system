import { z } from "zod";

const id = z.number().int().positive();
const jsonObject = z.record(z.string(), z.json());
const hotelIdentity = z.looseObject({ hotelBookingId: id });
const hotelReceipt = hotelIdentity.extend({
  bookingId: id,
  mode: z.enum(["sandbox", "live"]),
  currency: z.literal("SAR"),
  totalCost: z.number().int().nonnegative(),
});
const gateAssignment = z.looseObject({
  flightId: id,
  assignmentId: id,
  gateId: id,
  gateNumber: z.string(),
  previousGateId: id.nullable(),
  actorId: id,
  occupiedFrom: z.string().datetime(),
  occupiedUntil: z.string().datetime(),
});

/** Payload contracts are additive within v1. Unlisted legacy domain payloads remain
 * JSON objects; they are explicitly described as envelope-only, not fully typed.
 */
export const eventPayloadContracts: Record<string, z.ZodType> = {
  "booking.confirmed": z.looseObject({ bookingId: id }),
  "gate.assigned": gateAssignment,
  "gate.changed": gateAssignment,
  "gate.released": z.looseObject({
    flightId: id,
    reason: z.string(),
    gateIds: z.array(id),
    status: z.enum(["cancelled", "departed"]),
  }),
  "hotel.requested": hotelIdentity.extend({ bookingId: id, requestedBy: id }),
  "hotel.approved": hotelIdentity.extend({
    approvedBy: id,
    quoteId: z.string().uuid(),
  }),
  "hotel.cancellation_requested": hotelIdentity.extend({
    requestedBy: id,
    maxCancellationCost: z.number().int().nonnegative(),
  }),
  "hotel.confirmed": hotelReceipt.extend({ mode: z.literal("live") }),
  "hotel.sandbox_confirmed": hotelReceipt.extend({
    mode: z.literal("sandbox"),
  }),
  "hotel.cancelled": hotelReceipt,
  /** Station weather is field data, not tenant data: one bulletin describes
   * the airport for every airline operating into it, so this event is always
   * public-scoped and carries no booking or passenger identity. */
  "weather.observed": z.looseObject({
    icaoCode: z.string().regex(/^[A-Z]{2}[A-Z0-9]{2}$/),
    kind: z.enum(["metar", "taf"]),
    issuedAt: z.string().datetime(),
    flightCategory: z.enum(["VFR", "MVFR", "IFR", "LIFR"]).nullable(),
    sourceMode: z.enum(["sandbox", "live"]),
  }),
};
export const domainEnvelope = z.object({
  eventId: z.string().min(1).max(36),
  eventType: z.string().regex(/^[A-Za-z][A-Za-z0-9_.-]{0,99}$/),
  aggregateType: z.string().min(1).max(64),
  aggregateId: z.string().min(1).max(64),
  tenantId: id.nullable(),
  schemaVersion: z.literal(1).default(1),
  payload: jsonObject,
});
export type DomainEnvelope = z.infer<typeof domainEnvelope>;
export function validateDomainEvent(value: unknown): DomainEnvelope {
  const event = domainEnvelope.parse(value);
  const contract = eventPayloadContracts[event.eventType];
  if (contract) contract.parse(event.payload);
  return event;
}
export const cloudEventMetadata = z.object({
  specversion: z.literal("1.0"),
  id: z.string().min(1).max(36),
  source: z.string().min(1),
  type: z.string().regex(/^org\.ais\.[A-Za-z][A-Za-z0-9_.-]*\.v1$/),
  subject: z.string().min(1),
  time: z.string().datetime({ offset: true }),
  datacontenttype: z.literal("application/json"),
  dataschema: z.string().min(1),
  aisscope: z.enum(["public", "tenant"]),
  tenantid: id.optional(),
  schemaversion: z.literal(1),
  aggregatetype: z.string().min(1).max(64),
  aggregateid: z.string().min(1).max(64),
});
const cloudEvent = cloudEventMetadata.extend({ data: jsonObject });
export const domainSource = (tenantId: number | null) =>
  tenantId === null
    ? "urn:ais:aviation:public"
    : `urn:ais:aviation:tenant:${tenantId}`;
export const domainSchemaId = (eventType: string) =>
  `urn:ais:events:${eventType}:v1`;

export function toCloudEvent(value: unknown) {
  const { createdAt } = z.object({ createdAt: z.date() }).parse(value);
  const event = validateDomainEvent(value);
  return cloudEvent.parse({
    specversion: "1.0",
    id: event.eventId,
    source: domainSource(event.tenantId),
    type: `org.ais.${event.eventType}.v1`,
    subject: `${encodeURIComponent(event.aggregateType)}/${encodeURIComponent(event.aggregateId)}`,
    time: createdAt.toISOString(),
    datacontenttype: "application/json",
    dataschema: domainSchemaId(event.eventType),
    aisscope: event.tenantId === null ? "public" : "tenant",
    ...(event.tenantId === null ? {} : { tenantid: event.tenantId }),
    schemaversion: 1,
    aggregatetype: event.aggregateType,
    aggregateid: event.aggregateId,
    data: event.payload,
  });
}
export function fromCloudEvent(value: unknown): DomainEnvelope {
  const event = cloudEvent.parse(value);
  const tenantId = event.aisscope === "public" ? null : event.tenantid;
  const eventType = event.type.slice("org.ais.".length, -".v1".length);
  z.object({ valid: z.literal(true) }).parse({
    valid:
      tenantId !== undefined &&
      !(event.aisscope === "public" && event.tenantid !== undefined) &&
      event.source === domainSource(tenantId ?? null) &&
      event.dataschema === domainSchemaId(eventType) &&
      event.subject ===
        `${encodeURIComponent(event.aggregatetype)}/${encodeURIComponent(event.aggregateid)}`,
  });
  return validateDomainEvent({
    eventId: event.id,
    eventType,
    aggregateType: event.aggregatetype,
    aggregateId: event.aggregateid,
    tenantId,
    schemaVersion: event.schemaversion,
    payload: event.data,
  });
}
