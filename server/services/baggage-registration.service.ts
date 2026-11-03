import { z } from "zod";
import { and, asc, eq, isNull } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  baggageItems,
  baggageTracking,
  baggageCustodyEvents,
  dcsOperationEvents,
  flights,
  bookings,
  passengers,
  seatInventory,
  type BaggageItem,
} from "../../drizzle/schema";
import { getDb } from "../db";
import type { SettlementTx } from "./booking-settlement.service";
import {
  assertDepartureOpen,
  lockDepartureContext,
} from "./departure-control.service";
import { assertDcsPassengerCanAcceptBaggage } from "./dcs-state.service";
import {
  baggageEntitlementSnapshot,
  computeBaggageEntitlement,
} from "./baggage-entitlement.service";
import {
  calculateRequestHash,
  withTransactionalIdempotency,
} from "./idempotency-v2.service";
import { generateBaggageTag } from "./baggage-license-plate";
import { isAdmin } from "./rbac.service";
import { assertTenantOperational } from "./tenant.service";

export const baggageRegistrationScopeInput = z
  .object({
    bookingId: z.number().int().positive(),
    passengerId: z.number().int().positive(),
    flightId: z.number().int().positive(),
    segmentId: z.number().int().positive(),
  })
  .strict();

/** Canonical baggage weights are DECIMAL(5,2) kg: reject rather than round input. */
function storedWeightGrams(weight: number): number | null {
  if (!Number.isFinite(weight) || weight <= 0 || weight > 32) return null;
  const centiKg = weight * 100;
  if (Math.abs(centiKg - Math.round(centiKg)) > 1e-8) return null;
  return Math.round(centiKg) * 10;
}

export const baggageRegistrationInput = baggageRegistrationScopeInput
  .extend({
    weight: z
      .number()
      .positive("Weight must be greater than 0")
      .max(32, "Baggage weight exceeds maximum limit of 32kg")
      .refine(value => storedWeightGrams(value) !== null, {
        message: "Weight must have at most two decimal places",
      }),
    idempotencyKey: z.string().trim().min(8).max(128),
    description: z.string().trim().max(500).optional(),
    specialHandling: z.string().trim().max(255).optional(),
    replacesTag: z
      .string()
      .regex(/^\d{10}$/)
      .optional(),
    expectedActorId: z.number().int().positive().safe().optional(),
    expectedTenantId: z.number().int().positive().safe().optional(),
  })
  .refine(
    input =>
      (input.expectedActorId === undefined) ===
      (input.expectedTenantId === undefined),
    { message: "Expected actor and tenant must be provided together" }
  );

export type BaggageRegistrationInput = z.infer<typeof baggageRegistrationInput>;
type RegistrationScope = z.infer<typeof baggageRegistrationScopeInput>;
export type BaggageRegistrationActor = {
  id: number;
  role: string;
  tenantId: number | null | undefined;
};

function requireRegistrationActor(
  actor: BaggageRegistrationActor | undefined
): asserts actor is BaggageRegistrationActor & { tenantId: number } {
  if (
    !actor ||
    !Number.isSafeInteger(actor.id) ||
    actor.id <= 0 ||
    !Number.isSafeInteger(actor.tenantId) ||
    (actor.tenantId ?? 0) <= 0 ||
    (!isAdmin(actor.role) &&
      actor.role !== "airline_admin" &&
      actor.role !== "ops")
  )
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        "Physical baggage registration requires scoped airline operations staff",
    });
}

async function lockAuthorizedBooking(
  tx: SettlementTx,
  bookingId: number,
  tenantId: number
) {
  const [booking] = await tx
    .select()
    .from(bookings)
    .where(
      and(
        eq(bookings.id, bookingId),
        eq(bookings.tenantId, tenantId),
        isNull(bookings.deletedAt)
      )
    )
    .for("update");
  if (!booking)
    throw new TRPCError({ code: "NOT_FOUND", message: "Booking not found" });
  await assertTenantOperational(tx, tenantId);
}

/** Call after locking the authorized booking; retains booking -> flight -> pax order. */
async function registrationContext(
  tx: SettlementTx,
  scope: RegistrationScope,
  tenantId: number
) {
  const context = await lockDepartureContext(
    tx,
    scope.bookingId,
    scope.flightId
  );
  if (context.flight.tenantId !== tenantId)
    throw new TRPCError({ code: "NOT_FOUND", message: "Flight not found" });
  const segment = context.legs.find(
    leg => leg.id === scope.segmentId && leg.flightId === scope.flightId
  );
  if (!segment)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Baggage sector is not part of this booking and flight",
    });
  if (segment.status !== "confirmed")
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "A confirmed booking sector is required",
    });
  const [passenger] = await tx
    .select()
    .from(passengers)
    .where(
      and(
        eq(passengers.id, scope.passengerId),
        eq(passengers.bookingId, scope.bookingId),
        eq(passengers.tenantId, tenantId)
      )
    )
    .for("update");
  if (!passenger)
    throw new TRPCError({ code: "NOT_FOUND", message: "Passenger not found" });
  return context;
}

type RegistrationContext = Awaited<ReturnType<typeof registrationContext>>;
type ScopeWarning =
  | "ambiguous_legacy_baggage"
  | "registered_baggage_scope_conflict"
  | "invalid_registered_weight";

async function registeredBagScope(
  tx: SettlementTx,
  scope: RegistrationScope,
  context: RegistrationContext
) {
  const all = await tx
    .select()
    .from(baggageItems)
    .where(
      and(
        isNull(baggageItems.returnEvidenceId),
        eq(baggageItems.bookingId, scope.bookingId),
        eq(baggageItems.passengerId, scope.passengerId)
      )
    )
    .orderBy(asc(baggageItems.id))
    .for("update");
  const warnings: ScopeWarning[] = [];
  const bags: Array<{
    id: number;
    tagNumber: string;
    weightGrams: number | null;
    status: BaggageItem["status"];
    flightId: number | null;
    segmentId: number | null;
    legacy: boolean;
  }> = [];
  let weight = 0;
  for (const bag of all) {
    if (bag.returnEventId != null) continue;
    const legacy = bag.flightId == null && bag.segmentId == null;
    if (legacy) {
      // A legacy bag might belong to any historical leg. Do not allocate it to
      // whichever surviving/current leg happens to be requested.
      if (context.legs.length !== 1) warnings.push("ambiguous_legacy_baggage");
    } else {
      const original = context.legs.find(leg => leg.id === bag.segmentId);
      if (!original || original.flightId !== bag.flightId) {
        warnings.push("registered_baggage_scope_conflict");
      } else if (bag.segmentId !== scope.segmentId) {
        continue;
      }
    }
    const grams = storedWeightGrams(Number(bag.weight));
    if (grams === null) warnings.push("invalid_registered_weight");
    else weight += grams;
    bags.push({
      id: bag.id,
      tagNumber: bag.tagNumber,
      weightGrams: grams,
      status: bag.status,
      flightId: bag.flightId ?? null,
      segmentId: bag.segmentId ?? null,
      legacy,
    });
  }
  return {
    bags,
    warnings: [...new Set(warnings)],
    registeredWeightGrams: warnings.length ? null : weight,
  };
}

/** A scoped staff view; it never exposes funding references or broadens owner reads. */
export async function getBaggageRegistrationSummary(
  raw: RegistrationScope,
  actor: BaggageRegistrationActor | undefined
) {
  requireRegistrationActor(actor);
  const scope = baggageRegistrationScopeInput.parse(raw);
  const database = await getDb();
  if (!database) throw new Error("Baggage storage unavailable");
  return database.transaction(
    async tx => {
      await lockAuthorizedBooking(tx, scope.bookingId, actor.tenantId);
      const context = await registrationContext(tx, scope, actor.tenantId);
      const entitlement = await computeBaggageEntitlement(tx, scope);
      const registered = await registeredBagScope(tx, scope, context);
      return {
        ...scope,
        allowanceWeightGrams: entitlement.totalWeightGrams,
        registeredWeightGrams: registered.registeredWeightGrams,
        remainingWeightGrams:
          registered.registeredWeightGrams === null
            ? null
            : Math.max(
                0,
                entitlement.totalWeightGrams - registered.registeredWeightGrams
              ),
        requiresOperationalReview:
          entitlement.requiresOperationalReview ||
          registered.warnings.length > 0,
        warnings: [
          ...new Set([
            ...entitlement.warnings.map(warning => warning.code),
            ...registered.warnings,
          ]),
        ],
        bags: registered.bags,
      };
    },
    { isolationLevel: "read committed" }
  );
}

/** Trusted counter receipt. Signed device custody/acceptance remains independent. */
export async function registerBaggage(
  raw: BaggageRegistrationInput,
  actor: BaggageRegistrationActor | undefined
): Promise<BaggageItem> {
  requireRegistrationActor(actor);
  const input = baggageRegistrationInput.parse(raw);
  // A tab may retain an earlier operator's command after another tab replaces
  // its session cookie. The authenticated actor still grants all authority;
  // these optional bindings only reject a changed identity before replay/write.
  if (
    (input.expectedActorId !== undefined &&
      input.expectedActorId !== actor.id) ||
    (input.expectedTenantId !== undefined &&
      input.expectedTenantId !== actor.tenantId)
  )
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        "Baggage registration identity changed; restore the original staff and tenant session before retrying",
    });
  const weightGrams = storedWeightGrams(input.weight);
  if (weightGrams === null)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Invalid baggage weight",
    });
  const database = await getDb();
  if (!database) throw new Error("Baggage storage unavailable");
  return database.transaction(
    async tx => {
      // All registrations on this booking serialize here, including distinct keys.
      // Authorization is rechecked before replay; current departure eligibility is
      // checked only for new writes, so a retry returns its original receipt.
      await lockAuthorizedBooking(tx, input.bookingId, actor.tenantId);
      return withTransactionalIdempotency(
        {
          scope: "baggage.register",
          key: input.idempotencyKey,
          userId: actor.id,
          request: { ...input, tenantId: actor.tenantId },
          run: async tx => {
            const { context, registeredWeightGrams, entitlement } =
              await eligibleBagCounter(tx, input, actor.tenantId);
            const cumulativeWeightGrams = checkCorrectedAllowance(
              registeredWeightGrams,
              0,
              weightGrams,
              entitlement
            );
            let tagNumber: string | undefined;
            for (let attempt = 0; attempt < 10; attempt++) {
              const candidate = generateBaggageTag();
              const [existing] = await tx
                .select({ id: baggageItems.id })
                .from(baggageItems)
                .where(eq(baggageItems.tagNumber, candidate))
                .limit(1);
              if (!existing) {
                tagNumber = candidate;
                break;
              }
            }
            if (!tagNumber)
              throw new TRPCError({
                code: "CONFLICT",
                message: "Unable to allocate a baggage tag; retry this command",
              });
            let replacesBaggageId: number | null = null;
            if (input.replacesTag) {
              const [original] = await tx
                .select()
                .from(baggageItems)
                .where(
                  and(
                    eq(baggageItems.tagNumber, input.replacesTag),
                    eq(baggageItems.bookingId, input.bookingId),
                    eq(baggageItems.passengerId, input.passengerId)
                  )
                )
                .for("update");
              if (
                !original ||
                (original.returnEvidenceId == null &&
                  original.returnEventId == null) ||
                original.flightId == null ||
                original.segmentId == null ||
                original.flightId === input.flightId ||
                original.segmentId === input.segmentId
              )
                throw new TRPCError({
                  code: "PRECONDITION_FAILED",
                  message:
                    "Replacement requires this passenger's verified handback on a different flight",
                });
              let verifiedHandback = false;
              if (
                original.returnEvidenceId != null &&
                original.returnEventId == null
              ) {
                const [scan] = await tx
                  .select({ id: baggageCustodyEvents.id })
                  .from(baggageCustodyEvents)
                  .where(
                    and(
                      eq(
                        baggageCustodyEvents.evidenceId,
                        original.returnEvidenceId
                      ),
                      eq(baggageCustodyEvents.baggageId, original.id),
                      eq(baggageCustodyEvents.flightId, original.flightId),
                      eq(baggageCustodyEvents.stage, "return"),
                      eq(
                        baggageCustodyEvents.airportId,
                        context.flight.originId
                      )
                    )
                  );
                verifiedHandback = !!scan;
              } else if (
                original.returnEventId != null &&
                original.returnEvidenceId == null
              ) {
                const [handback] = await tx
                  .select({ details: dcsOperationEvents.details })
                  .from(dcsOperationEvents)
                  .where(
                    and(
                      eq(dcsOperationEvents.id, original.returnEventId),
                      eq(dcsOperationEvents.action, "return_bag"),
                      eq(dcsOperationEvents.tenantId, actor.tenantId),
                      eq(dcsOperationEvents.flightId, original.flightId),
                      eq(dcsOperationEvents.bookingId, input.bookingId),
                      eq(dcsOperationEvents.passengerId, input.passengerId)
                    )
                  );
                verifiedHandback =
                  handback?.details?.baggageId === original.id &&
                  handback.details.segmentId === original.segmentId &&
                  handback.details.stationId === context.flight.originId &&
                  handback.details.tagNumber === original.tagNumber;
              }
              const [priorFlight] = await tx
                .select({ tenantId: flights.tenantId })
                .from(flights)
                .where(eq(flights.id, original.flightId));
              if (!verifiedHandback || priorFlight?.tenantId !== actor.tenantId)
                throw new TRPCError({
                  code: "PRECONDITION_FAILED",
                  message: "No verified handback at this departure station",
                });
              const [existing] = await tx
                .select({ id: baggageItems.id })
                .from(baggageItems)
                .where(eq(baggageItems.replacesBaggageId, original.id));
              if (existing)
                throw new TRPCError({
                  code: "CONFLICT",
                  message: "Returned tag already has a replacement",
                });
              replacesBaggageId = original.id;
            }
            const location = `Airport ${context.flight.originId} Check-in Counter`;
            const [result] = await tx.insert(baggageItems).values({
              bookingId: input.bookingId,
              passengerId: input.passengerId,
              flightId: input.flightId,
              segmentId: input.segmentId,
              tagNumber,
              weight: (weightGrams / 1000).toFixed(2),
              replacesBaggageId,
              status: "checked_in",
              lastLocation: location,
              description: input.description || null,
              specialHandling: input.specialHandling || null,
            });
            const baggageId = Number(result.insertId);
            await tx.insert(baggageTracking).values({
              baggageId,
              location,
              status: "checked_in",
              scannedBy: actor.id,
              notes: JSON.stringify({
                kind: "staff_baggage_registration",
                flightId: input.flightId,
                segmentId: input.segmentId,
                weightGrams,
                cumulativeWeightGrams,
                entitlement: baggageEntitlementSnapshot(entitlement),
                custodyEvidence: "separate_signed_operator_event_required",
              }),
            });
            const [created] = await tx
              .select()
              .from(baggageItems)
              .where(eq(baggageItems.id, baggageId))
              .limit(1);
            if (!created)
              throw new Error("Registered baggage receipt is unavailable");
            return created;
          },
        },
        tx
      );
    },
    { isolationLevel: "read committed" }
  );
}

async function eligibleBagCounter(
  tx: SettlementTx,
  input: RegistrationScope,
  tenantId: number
) {
  const context = await registrationContext(tx, input, tenantId);
  assertDepartureOpen(context, "check_in");
  await assertDcsPassengerCanAcceptBaggage(tx, input);
  const seats = await tx
    .select()
    .from(seatInventory)
    .where(
      and(
        eq(seatInventory.bookingId, input.bookingId),
        eq(seatInventory.passengerId, input.passengerId),
        eq(seatInventory.flightId, input.flightId),
        eq(seatInventory.status, "checked_in")
      )
    )
    .for("update");
  const seat = seats[0];
  if (
    seats.length !== 1 ||
    !seat?.checkInNonce ||
    !seat.checkedInAt ||
    !seat.boardingSequence ||
    seat.cabinClass !== context.booking.cabinClass
  )
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Passenger must have a current checked-in seat on this flight",
    });
  const entitlement = await computeBaggageEntitlement(tx, input);
  const registered = await registeredBagScope(tx, input, context);
  if (
    entitlement.requiresOperationalReview ||
    registered.registeredWeightGrams === null
  )
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "Baggage allowance or existing sector scope requires operator review",
    });

  return {
    context,
    registered,
    registeredWeightGrams: registered.registeredWeightGrams,
    entitlement,
  };
}
function checkCorrectedAllowance(
  registeredWeightGrams: number,
  previousWeightGrams: number,
  weightGrams: number,
  entitlement: Awaited<ReturnType<typeof computeBaggageEntitlement>>
) {
  const cumulativeWeightGrams =
    registeredWeightGrams - previousWeightGrams + weightGrams;
  if (
    weightGrams > entitlement.maxBagWeightGrams ||
    cumulativeWeightGrams > entitlement.totalWeightGrams
  )
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "Registered baggage exceeds funded allowance; settle the exact passenger/sector entitlement before acceptance",
    });

  return cumulativeWeightGrams;
}

export const baggageCorrectionInput = baggageRegistrationScopeInput.extend({
  baggageId: z.number().int().positive(),
  previousWeight: baggageRegistrationInput.shape.weight,
  weight: baggageRegistrationInput.shape.weight,
  reason: z.string().trim().min(5).max(500),
  idempotencyKey: z.string().min(8).max(128),
  expectedActorId: z.number().int().positive(),
  expectedTenantId: z.number().int().positive(),
});
export async function correctCounterBag(
  raw: z.infer<typeof baggageCorrectionInput>,
  actor: BaggageRegistrationActor
) {
  requireRegistrationActor(actor);
  const input = baggageCorrectionInput.parse(raw);
  if (
    input.expectedActorId !== actor.id ||
    input.expectedTenantId !== actor.tenantId
  )
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Counter staff identity changed",
    });
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  return db.transaction(
    async tx => {
      await lockAuthorizedBooking(tx, input.bookingId, actor.tenantId);
      const request = { ...input, tenantId: actor.tenantId };
      return withTransactionalIdempotency(
        {
          scope: "baggage.correct_weight",
          key: input.idempotencyKey,
          userId: actor.id,
          request,
          run: async tx => {
            const { registered, registeredWeightGrams, entitlement } =
              await eligibleBagCounter(tx, input, actor.tenantId);
            const bag = registered.bags.find(b => b.id === input.baggageId);
            const before = storedWeightGrams(input.previousWeight);
            const after = storedWeightGrams(input.weight);
            if (
              before === null ||
              after === null ||
              !bag ||
              bag.legacy ||
              bag.flightId !== input.flightId ||
              bag.segmentId !== input.segmentId ||
              bag.status !== "checked_in" ||
              bag.weightGrams !== before ||
              before === after
            )
              throw new TRPCError({
                code: "CONFLICT",
                message: "The scoped counter bag or its weight has changed",
              });
            const [custody] = await tx
              .select({ id: baggageCustodyEvents.id })
              .from(baggageCustodyEvents)
              .where(eq(baggageCustodyEvents.baggageId, bag.id))
              .limit(1);
            if (custody)
              throw new TRPCError({
                code: "PRECONDITION_FAILED",
                message: "Bag already entered device custody",
              });
            checkCorrectedAllowance(
              registeredWeightGrams,
              before,
              after,
              entitlement
            );
            const [updated] = await tx
              .update(baggageItems)
              .set({ weight: input.weight.toFixed(2) })
              .where(
                and(
                  eq(baggageItems.id, bag.id),
                  eq(baggageItems.weight, input.previousWeight.toFixed(2)),
                  eq(baggageItems.status, "checked_in")
                )
              );
            if (updated.affectedRows !== 1)
              throw new TRPCError({
                code: "CONFLICT",
                message: "Bag changed during correction",
              });
            const [event] = await tx.insert(dcsOperationEvents).values({
              tenantId: actor.tenantId,
              bookingId: input.bookingId,
              passengerId: input.passengerId,
              flightId: input.flightId,
              action: "bag_weight_corrected",
              fromState: String(before),
              toState: String(after),
              reason: input.reason,
              actorId: actor.id,
              actorRole: actor.role,
              idempotencyKey: input.idempotencyKey,
              requestHash: calculateRequestHash(request),
              details: {
                baggageId: bag.id,
                previousWeightGrams: before,
                correctedWeightGrams: after,
              },
            });
            return {
              eventId: Number(event.insertId),
              flightId: input.flightId,
            };
          },
        },
        tx
      );
    },
    { isolationLevel: "read committed" }
  );
}
