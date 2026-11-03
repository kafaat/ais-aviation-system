import { TRPCError } from "@trpc/server";
import { asc } from "drizzle-orm";
import { baggageItems } from "../../drizzle/schema";
import type { SettlementTx } from "./booking-settlement.service";
import { unresolvedCounterBaggageFlightCondition } from "./baggage-sector-scope";

const MAX_UNRESOLVED_REGISTRATIONS = 1000;
export type UnresolvedBaggageRegistration = {
  baggageId: number;
  tagNumber: string;
};

/** Caller has authorized this flight; use the same read snapshot as its report. */
export async function readUnresolvedFlightBaggage(
  db: Pick<SettlementTx, "select">,
  flightId: number
): Promise<UnresolvedBaggageRegistration[]> {
  const rows = await db
    .select({ baggageId: baggageItems.id, tagNumber: baggageItems.tagNumber })
    .from(baggageItems)
    .where(unresolvedCounterBaggageFlightCondition(flightId))
    .orderBy(asc(baggageItems.id))
    .limit(MAX_UNRESOLVED_REGISTRATIONS + 1);
  if (rows.length > MAX_UNRESOLVED_REGISTRATIONS)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "Flight baggage reconciliation exceeds the report limit; operator review is required",
    });
  return rows;
}

export async function assertFlightBaggageReconciled(
  db: Pick<SettlementTx, "select">,
  flightId: number
) {
  if ((await readUnresolvedFlightBaggage(db, flightId)).length)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "Flight has unresolved physical baggage registrations; operational reconciliation is required before generating a manifest",
    });
}
