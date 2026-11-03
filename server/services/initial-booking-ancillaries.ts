import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { ancillaryServices, bookingAncillaries } from "../../drizzle/schema";
import type { SettlementTx } from "./booking-settlement.service";

export const initialAncillarySchema = z
  .object({
    ancillaryServiceId: z.number().int().positive(),
    quantity: z.number().int().min(1).max(20),
    unitPrice: z.number().int().nonnegative(),
    totalPrice: z.number().int().nonnegative(),
    passengerIndex: z.number().int().nonnegative().optional(),
    segmentIndex: z.number().int().nonnegative().optional(),
    passengerId: z.number().optional(),
  })
  .strict();
export type SelectedAncillary = z.infer<typeof initialAncillarySchema>;

function allows(restriction: string | null, value: string | number) {
  if (restriction == null) return true;
  try {
    const list: unknown = JSON.parse(restriction);
    return Array.isArray(list) && list.includes(value);
  } catch {
    return false;
  }
}

export async function priceInitialAncillaries(
  tx: SettlementTx,
  lines: SelectedAncillary[],
  cabinClass: string,
  airlineIds: number[],
  passengerCount: number
) {
  const selected = [];
  const identities = new Set<string>();
  for (const line of lines) {
    const { passengerIndex, segmentIndex, quantity, ancillaryServiceId } = line;
    const scoped = passengerIndex !== undefined || segmentIndex !== undefined;
    if (
      !initialAncillarySchema.safeParse(line).success ||
      line.passengerId !== undefined ||
      (scoped &&
        (passengerIndex === undefined ||
          segmentIndex === undefined ||
          passengerIndex >= passengerCount ||
          segmentIndex >= airlineIds.length)) ||
      (!scoped && airlineIds.length !== 1)
    )
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Invalid ancillary selection or scope",
      });
    if (scoped) {
      const identity = [passengerIndex, segmentIndex, ancillaryServiceId].join(
        ":"
      );
      if (identities.has(identity))
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Duplicate ancillary selection",
        });
      identities.add(identity);
    }
    const [service] = await tx
      .select()
      .from(ancillaryServices)
      .where(
        and(
          eq(ancillaryServices.id, ancillaryServiceId),
          eq(ancillaryServices.available, true)
        )
      )
      .limit(1)
      .for("share");
    if (
      !service ||
      service.currency !== "SAR" ||
      (scoped &&
        !["baggage", "meal", "priority_boarding"].includes(service.category)) ||
      !allows(service.applicableCabinClasses, cabinClass) ||
      !allows(service.applicableAirlines, airlineIds[segmentIndex ?? 0])
    )
      throw new TRPCError({
        code: "CONFLICT",
        message: "Ancillary unavailable for this flight",
      });
    const totalPrice = service.price * quantity;
    if (
      !Number.isSafeInteger(totalPrice) ||
      totalPrice < 0 ||
      totalPrice > 2147483647 ||
      (scoped &&
        (line.unitPrice !== service.price || line.totalPrice !== totalPrice))
    )
      throw new TRPCError({
        code: "CONFLICT",
        message: "Ancillary price changed. Review the current quote.",
      });
    const weight = (service.weightGrams ?? 0) * quantity;
    if (
      scoped &&
      service.category === "baggage" &&
      (!Number.isSafeInteger(weight) || weight <= 0 || weight > 2147483647)
    )
      throw new TRPCError({
        code: "CONFLICT",
        message: "Baggage allowance unavailable",
      });
    selected.push({
      passengerIndex,
      segmentIndex,
      ancillaryServiceId,
      quantity,
      unitPrice: service.price,
      totalPrice,
      weightSnapshotGrams:
        scoped && service.category === "baggage" ? weight : null,
    });
  }
  return selected;
}

export async function persistInitialAncillaries(
  tx: SettlementTx,
  lines: Awaited<ReturnType<typeof priceInitialAncillaries>>,
  bookingId: number,
  passengerIds: number[],
  segmentIds: number[]
) {
  const purchases = [];
  for (const {
    passengerIndex,
    segmentIndex,
    weightSnapshotGrams,
    ...amounts
  } of lines) {
    const row = {
      bookingId,
      ...amounts,
      status: "active" as const,
      ...(passengerIndex !== undefined &&
        segmentIndex !== undefined && {
          passengerId: passengerIds[passengerIndex],
          segmentId: segmentIds[segmentIndex],
          scopeState: "specific_segment" as const,
          weightSnapshotGrams,
          metadata: JSON.stringify({ source: "initial_booking" }),
        }),
    };
    const [created] = await tx.insert(bookingAncillaries).values(row);
    purchases.push({ ...row, sourceReference: String(created.insertId) });
  }
  return purchases;
}
