import { z } from "zod";
import { and, asc, eq, isNull } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  baggageItems,
  baggageTracking,
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
import { withTransactionalIdempotency } from "./idempotency-v2.service";
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
            const context = await registrationContext(
              tx,
              input,
              actor.tenantId
            );
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
                message:
                  "Passenger must have a current checked-in seat on this flight",
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
            const cumulativeWeightGrams =
              registered.registeredWeightGrams + weightGrams;
            if (
              weightGrams > entitlement.maxBagWeightGrams ||
              cumulativeWeightGrams > entitlement.totalWeightGrams
            )
              throw new TRPCError({
                code: "PRECONDITION_FAILED",
                message:
                  "Registered baggage exceeds funded allowance; settle the exact passenger/sector entitlement before acceptance",
              });
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
            const location = `Airport ${context.flight.originId} Check-in Counter`;
            const [result] = await tx.insert(baggageItems).values({
              bookingId: input.bookingId,
              passengerId: input.passengerId,
              flightId: input.flightId,
              segmentId: input.segmentId,
              tagNumber,
              weight: (weightGrams / 1000).toFixed(2),
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
