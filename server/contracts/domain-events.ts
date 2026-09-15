import { z } from "zod";

const id = z.number().int().positive();
const tenantStatus = z.enum(["active", "suspended", "pending"]);
const jsonObject = z.record(z.string(), z.json());
/** Existing ingestion capabilities; adding one requires a payload contract. */
export const aviationEvidenceKinds = z.enum([
  "maintenance",
  "crew_rules",
  "baggage_custody",
  "premium_policy",
  "departure_estimate",
  "departure_actual",
  "arrival_actual",
  "tobt",
  "tsat",
  "carbon",
  "travel_rules",
  "travel_clearance",
  "flight_cost",
]);
const evidenceReceipt = z.looseObject({
  evidenceId: id,
  sourceId: z.string().min(1).max(64),
  flightId: id.nullable(),
  observedAt: z.string().datetime(),
  digest: z.string().regex(/^[a-f0-9]{64}$/),
});
const unpaidNdcReceipt = z.looseObject({
  orderId: z.string().min(1),
  bookingId: id,
  actorId: id,
});
const hotelIdentity = z.looseObject({ hotelBookingId: id });
const waitlistIdentity = z.looseObject({
  waitlistId: id,
  flightId: id,
  userId: id,
});
const recoveryChoices = z.array(
  z.looseObject({ bookingId: id, key: z.string().nullable() })
);
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

/** Payload contracts are additive within v1. Unlisted historical payloads remain
 * readable as JSON objects; new writes must have a registered payload contract.
 */
export const eventPayloadContracts: Record<string, z.ZodType> = {
  ...Object.fromEntries(
    aviationEvidenceKinds.options.map(kind => [
      `aviation.${kind}`,
      evidenceReceipt,
    ])
  ),
  "crew.rules_accepted": z.looseObject({
    actorId: id,
    version: z.string().min(1),
    airlineId: id,
  }),
  "crew.assignment_created": z.looseObject({
    crewMemberId: id,
    flightId: id,
    ruleEvidenceId: id,
    assignedBy: id,
  }),
  "aircraft.rotation_planned": z.looseObject({
    flightId: id,
    airlineId: id,
    tenantId: id.nullable(),
    tailNumber: z.string().min(1),
    maintenanceEvidenceId: id,
    scheduleDigest: z.string().regex(/^[a-f0-9]{64}$/),
    assignedBy: id,
    acceptance: z.literal("planning_only_dispatch_required"),
  }),
  "operations.event_replay_requested": z.looseObject({
    eventId: z.string().min(1).max(36),
    actorId: id,
    reason: z.string(),
    previousAttempts: z.number().int().nonnegative(),
  }),
  "operations.cancellation_retry_requested": z.looseObject({
    jobId: id,
    actorId: id,
    reason: z.string(),
  }),
  "travel_agent.owner_assigned": z.looseObject({
    agentId: id,
    previousOwnerId: id.nullable(),
    ownerUserId: id,
    actorId: id,
  }),
  NdcOrderCreated: z.looseObject({
    orderId: z.string().min(1),
    offerId: z.string().min(1),
    totalAmount: z.number().int().positive(),
    currency: z.string().length(3),
  }),
  NdcOrderCancelled: z.looseObject({
    orderId: z.string().min(1),
    bookingId: id,
    reason: z.string(),
    paymentStatus: z.enum(["pending", "paid", "refunded", "failed"]),
  }),
  NdcUnpaidOrderChanged: unpaidNdcReceipt,
  NdcUnpaidServicesAdded: unpaidNdcReceipt,
  "tenant.status_changed": z.looseObject({
    tenantId: id,
    previous: tenantStatus,
    status: tenantStatus,
    actorId: id,
  }),
  "tenant.user_assigned": z.looseObject({
    userId: id,
    previousTenantId: id.nullable(),
    tenantId: id,
    actorId: id,
  }),
  "family.miles_contributed": z.looseObject({
    groupId: id,
    userId: id,
    miles: z.number().int().positive(),
  }),
  "agent.price_approved": z.looseObject({
    digest: z.string().min(1),
    approvedBy: id,
    expiresAt: z.string().datetime(),
  }),
  "agent.price_executed": z.looseObject({
    digest: z.string().min(1),
    approvedBy: id,
    executedBy: id,
    previousPrice: z.number().int().nonnegative(),
    price: z.number().int().positive(),
    flightId: id,
  }),
  AgentDecisionOverridden: z.looseObject({
    decisionId: id,
    overriddenBy: id,
    reason: z.string(),
    supersededBy: id.nullable(),
  }),
  "retail.premium_policy_approved": z.looseObject({
    actorId: id,
    evidenceId: id,
    version: z.string().min(1),
  }),
  "retail.premium_exposure": z.looseObject({
    policyId: z.string().uuid(),
    variant: z.enum(["control", "treatment"]),
  }),
  "retail.premium_policy_paused": z.looseObject({ actorId: id }),
  "waitlist.offered": waitlistIdentity.extend({
    expiresAt: z.string().datetime(),
  }),
  "waitlist.cancelled": waitlistIdentity,
  "waitlist.expired": waitlistIdentity,
  "irops.created": z.looseObject({
    flightId: id,
    type: z.enum(["delay", "cancellation", "diversion", "equipment_change"]),
  }),
  "irops.protection_planned": z.looseObject({
    flightId: id,
    actionsCreated: z.number().int().nonnegative(),
  }),
  "irops.notification_created": z.looseObject({ userId: id, flightId: id }),
  "irops.escalated": z.looseObject({
    level: z.enum(["low", "medium", "high", "critical"]),
  }),
  // The existing v1 producer records identity in the envelope, with empty data.
  // Do not require new fields that would make historical receipts unreplayable.
  "irops.resolved": z.looseObject({}),
  "irops.reaccommodation_confirmed": z.looseObject({ bookingId: id }),
  "irops.recovery_proposed": z.looseObject({
    digest: z.string().min(1),
    choices: recoveryChoices,
    optimal: z.boolean(),
    gap: z.number().nonnegative().nullable(),
    unassignedPassengers: z.number().int().nonnegative(),
    passengerDelayMinutes: z.number().int().nonnegative(),
  }),
  "irops.recovery_approved": z.looseObject({
    actorId: id,
    digest: z.string().min(1),
  }),
  "irops.recovery_executed": z.looseObject({
    actorId: id,
    digest: z.string().min(1),
    choices: recoveryChoices,
    unassignedPassengers: z.number().int().nonnegative(),
    fulfillment: z.literal("awaiting_ticket_reissue"),
  }),
  "booking.created": z.looseObject({
    bookingId: id,
    userId: id,
    channel: z.string().min(1),
    flightId: id.optional(),
  }),
  "booking.cancelled": z.looseObject({
    bookingId: id,
    reason: z.string(),
    actorId: id.nullable(),
  }),
  "booking.modified": z.looseObject({ bookingId: id, modificationId: id }),
  "booking.invoice_changed": z.looseObject({
    bookingId: id,
    previousTotal: z.number().int().nonnegative(),
    totalAmount: z.number().int().positive(),
  }),
  "booking.checkout_requested": z.looseObject({
    bookingId: id,
    requestId: z.string().uuid(),
    invoiceHash: z.string().min(1),
  }),
  "booking.checkout_expired": z.looseObject({
    bookingId: id,
    requestId: z.string().uuid(),
    sessionId: z.string().min(1),
  }),
  "booking.split_payment_created": z.looseObject({
    bookingId: id,
    splitIds: z.array(id).min(1),
    totalAmount: z.number().int().positive(),
  }),
  "booking.split_checkout_requested": z.looseObject({
    bookingId: id,
    splitId: id,
    requestId: z.string().uuid(),
  }),
  "booking.split_payment_cancelled": z.looseObject({
    bookingId: id,
    splitId: id,
  }),
  "booking.split_refund_reserved": z.looseObject({
    bookingId: id,
    planId: z.string().uuid(),
    actorId: id,
    refundAmount: z.number().int().nonnegative(),
    cancellationFee: z.number().int().nonnegative(),
  }),
  ...Object.fromEntries(
    ["completed", "pending", "processing", "failed", "review_required"].map(
      status => [
        `booking.split_refund_${status}`,
        z.looseObject({
          bookingId: id,
          planId: z.string().uuid(),
          refundAmount: z.number().int().nonnegative(),
          cancellationFee: z.number().int().nonnegative(),
        }),
      ]
    )
  ),
  "booking.split_refund_item_review": z.looseObject({
    bookingId: id,
    splitId: id,
    requestId: z.string().uuid(),
    code: z.string().min(1),
  }),
  "booking.split_refund_item_updated": z.looseObject({
    bookingId: id,
    splitId: id,
    requestId: z.string().uuid(),
    status: z.string().min(1),
  }),
  "payment.refunded": z.looseObject({
    userId: id,
    bookingId: id.nullable(),
    amount: z.number().int().positive(),
  }),
  "payment.settlement_review_required": z.looseObject({
    bookingId: id,
    paymentIntentId: z.string().min(1),
    reason: z.string().min(1),
  }),
  "payment.internal_refunded": z.looseObject({
    bookingId: id,
    ledgerId: id,
    originalLedgerId: id,
    amount: z.number().int().positive(),
    tender: z.enum(["user_credit", "corporate_credit"]),
    actorId: id,
    approvalReference: z.string().min(3),
    cancelItinerary: z.boolean(),
  }),
  "payment.disputed": z.looseObject({
    userId: id,
    bookingId: id.nullable(),
    amount: z.number().int(),
  }),
  "order.refund_planned": z.looseObject({
    modificationId: id.nullable(),
    amount: z.number().int().positive(),
    payers: z.number().int().positive(),
  }),
  "order.refund_updated": z.looseObject({
    modificationId: id.nullable(),
    requestId: z.string().uuid(),
    status: z.string().min(1),
    refundId: z.string().min(1),
  }),
  "order.servicing_quoted": z.looseObject({
    modificationId: id,
    totalCost: z.number().int(),
    expiresAt: z.string().datetime(),
  }),
  "order.servicing_applied": z.looseObject({
    modificationId: id,
    previousTotal: z.number().int().nonnegative(),
    totalAmount: z.number().int().positive(),
    refundDue: z.number().int().nonnegative(),
    fulfillment: z.enum(["awaiting_ticket_reissue", "entitlement_created"]),
  }),
  "order.servicing_cancelled": z.looseObject({
    modificationId: id,
    userId: id,
  }),
  "inventory.adjusted": z.looseObject({
    cabinClass: z.enum(["economy", "business"]),
    previous: z.number().int().nonnegative(),
    available: z.number().int().nonnegative(),
    capacity: z.number().int().nonnegative(),
    reservedSeats: z.number().int().nonnegative(),
    heldSeats: z.number().int().nonnegative(),
    actorId: id.nullable(),
    reason: z.string().min(1),
  }),
  "flight.refund_planned": z.looseObject({
    flightId: id,
    bookingId: id,
    // An unpaid or already refunded booking has no remaining liability.
    amount: z.number().int().nonnegative(),
    jobId: id,
  }),
  "flight.status_changed": z.looseObject({
    flightId: id,
    flightNumber: z.string(),
    oldStatus: z.string(),
    newStatus: z.string(),
    departureTime: z.string().datetime(),
    arrivalTime: z.string().datetime(),
    delayMinutes: z.number().nullable(),
    reason: z.string().nullable(),
    actorId: id.nullable(),
    bookingIds: z.array(id),
    disruptionId: id.nullable(),
  }),
  "passenger.checked_in": z.looseObject({
    bookingId: id,
    flightId: id,
    passengerId: id,
    seatNumber: z.string().min(1),
  }),
  "group.allocated": z.looseObject({
    groupBookingId: id,
    organizerUserId: id,
    inventoryLockId: id,
    expiresAt: z.string().datetime(),
    totalPrice: z.number().int().nonnegative(),
    actorId: id,
  }),
  "group.allocation_released": z.looseObject({
    groupBookingId: id,
    reason: z.string(),
  }),
  "retail.offer_consumed": z.looseObject({
    bookingId: id,
    digest: z.string().min(1),
    channel: z.string().min(1),
    totalAmount: z.number().int().positive(),
  }),
  PaymentConfirmed: z.looseObject({
    bookingId: id,
    bookingReference: z.string(),
    amount: z.number().int().positive(),
    currency: z.string().length(3),
    paymentIntentId: z.string().min(1),
  }),
  ...Object.fromEntries(
    ["BookingRefunded", "BookingPartiallyRefunded"].map(type => [
      type,
      z.looseObject({
        bookingId: id,
        bookingReference: z.string(),
        amountRefunded: z.number().int().nonnegative(),
        currency: z.string().length(3),
        chargeId: z.string().min(1),
      }),
    ])
  ),
  ETicketIssued: z.looseObject({
    bookingId: id,
    passengerId: id,
    ticketNumber: z.string(),
    flightIds: z.array(id).min(1),
    acceptance: z.literal("local_document_external_ticket_acceptance_required"),
  }),
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
export function validateDomainEvent(
  value: unknown,
  options: { requirePayloadContract?: boolean } = {}
): DomainEnvelope {
  const event = domainEnvelope.parse(value);
  const contract = Object.hasOwn(eventPayloadContracts, event.eventType)
    ? eventPayloadContracts[event.eventType]
    : undefined;
  if (!contract && options.requirePayloadContract)
    throw new Error(`Unregistered domain event type: ${event.eventType}`);
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
