import { TRPCError } from "@trpc/server";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  airlines,
  bookings,
  codeshareAgreements,
  codeshareAllotments,
  flights,
  inventoryLocks,
  type CodeshareAgreement,
  type Flight,
} from "../../drizzle/schema";
import { getDb } from "../db";
import type { SettlementTx } from "./booking-settlement.service";
import { inventoryTransactionConfig } from "./inventory-capacity.service";

type Service = Pick<
  Flight,
  "airlineId" | "originId" | "destinationId" | "departureTime"
>;
type Cabin = "economy" | "business";
function unavailable(message: string): never {
  throw new TRPCError({ code: "CONFLICT", message });
}

export function applicableAgreement(
  agreements: CodeshareAgreement[],
  service: Service
) {
  return agreements
    .filter(agreement => {
      if (
        agreement.operatingAirlineId !== service.airlineId ||
        service.departureTime < agreement.validFrom ||
        (agreement.validUntil &&
          service.departureTime > agreement.validUntil) ||
        (agreement.agreementType !== "free_sale" &&
          !(Number(agreement.blockSize) > 0))
      )
        return false;
      if (agreement.routeScope === "all_routes") return true;
      try {
        const routes: unknown = JSON.parse(agreement.routes ?? "null");
        return (
          Array.isArray(routes) &&
          routes.some(
            route =>
              route?.originId === service.originId &&
              route?.destinationId === service.destinationId
          )
        );
      } catch {
        return false;
      }
    })
    .sort(
      (a, b) =>
        Number(b.routeScope === "specific_routes") -
          Number(a.routeScope === "specific_routes") ||
        b.validFrom.getTime() - a.validFrom.getTime() ||
        a.id - b.id
    )[0];
}

// Called after locking the operating flight. The booking itself is the quota
// claim. Expiry and cancellation release it without a second balance to repair.
export function occupiedCodeshareSeats() {
  // Explicit SQL aliases preserve the correlation in Drizzle's single-table
  // projections, which otherwise render interpolated column names unqualified.
  return sql<number>`(select coalesce(sum(b.numberOfPassengers), 0)
    from ${bookings} as b left join ${inventoryLocks} as h on h.id = b.inventoryLockId
    where b.codeshareAllotmentId = codeshare_allotments.id
      and b.flightId = codeshare_allotments.flightId and b.cabinClass = codeshare_allotments.cabinClass
      and b.status <> 'cancelled'
      and (b.seatsReserved = true or (h.status = 'active' and h.expiresAt > CURRENT_TIMESTAMP)))`.mapWith(
    Number
  );
}

async function assertAgreement(
  tx: SettlementTx,
  flight: Flight,
  agreementId: number
) {
  const [identity] = await tx
    .select({ marketingId: codeshareAgreements.marketingAirlineId })
    .from(codeshareAgreements)
    .where(eq(codeshareAgreements.id, agreementId));
  if (!identity) unavailable("Unknown codeshare agreement");
  const agreements = await tx
    .select()
    .from(codeshareAgreements)
    .where(
      and(
        eq(codeshareAgreements.marketingAirlineId, identity.marketingId),
        eq(codeshareAgreements.operatingAirlineId, flight.airlineId),
        eq(codeshareAgreements.status, "active"),
        sql`${codeshareAgreements.validFrom} <= CURRENT_TIMESTAMP`,
        sql`(${codeshareAgreements.validUntil} is null or ${codeshareAgreements.validUntil} >= CURRENT_TIMESTAMP)`
      )
    )
    .for("update");
  const agreement = applicableAgreement(agreements, flight);
  if (
    agreement?.id !== agreementId ||
    flight.status !== "scheduled" ||
    flight.departureTime <= new Date()
  )
    unavailable("Codeshare agreement does not cover this service");
  return agreement;
}

export async function assertCodeshareSale(
  tx: SettlementTx,
  flight: Flight,
  cabin: Cabin,
  id: number,
  count: number
) {
  const [allocation] = await tx
    .select({
      agreementId: codeshareAllotments.agreementId,
      seatLimit: codeshareAllotments.seatLimit,
      occupied: occupiedCodeshareSeats(),
    })
    .from(codeshareAllotments)
    .where(
      and(
        eq(codeshareAllotments.id, id),
        eq(codeshareAllotments.flightId, flight.id),
        eq(codeshareAllotments.cabinClass, cabin)
      )
    );
  if (!allocation)
    unavailable("Codeshare allotment does not cover this service and cabin");
  const agreement = await assertAgreement(tx, flight, allocation.agreementId);
  if (allocation.seatLimit - allocation.occupied < count)
    unavailable("Insufficient codeshare allotment");
  if (agreement.agreementType !== "free_sale") {
    const siblings = await scopedAllotments(tx, agreement.id, flight.id);
    if (
      siblings.reduce((sum, row) => sum + row.seatLimit, 0) >
      Number(agreement.blockSize)
    )
      unavailable("Codeshare allotments exceed the current agreement block");
  }
}

function scopedAllotments(
  tx: SettlementTx,
  agreementId: number,
  flightId: number
) {
  return tx
    .select()
    .from(codeshareAllotments)
    .where(
      and(
        eq(codeshareAllotments.agreementId, agreementId),
        eq(codeshareAllotments.flightId, flightId)
      )
    );
}

export async function configureAllotment(
  input: {
    agreementId: number;
    flightId: number;
    cabinClass: Cabin;
    marketingFlightNumber: string;
    seatLimit: number;
  },
  tenantId: number | null | undefined
) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  return db.transaction(async tx => {
    const [flight] = await tx
      .select()
      .from(flights)
      .where(eq(flights.id, input.flightId))
      .for("update");
    if (!flight || (tenantId != null && flight.tenantId !== tenantId))
      throw new TRPCError({ code: "NOT_FOUND", message: "Flight not found" });
    const agreement = await assertAgreement(tx, flight, input.agreementId);
    const [carrier] = await tx
      .select({ code: airlines.code })
      .from(airlines)
      .where(eq(airlines.id, agreement.marketingAirlineId));
    if (
      !carrier ||
      !input.marketingFlightNumber.startsWith(carrier.code) ||
      !/^\d{1,4}[A-Z]?$/.test(
        input.marketingFlightNumber.slice(carrier.code.length)
      )
    )
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Supply a flight number for the marketing carrier",
      });
    const scopes = await scopedAllotments(tx, agreement.id, flight.id);
    if (
      agreement.agreementType !== "free_sale" &&
      scopes.reduce(
        (n, s) => n + (s.cabinClass === input.cabinClass ? 0 : s.seatLimit),
        input.seatLimit
      ) > Number(agreement.blockSize)
    )
      unavailable("Codeshare allotments exceed the agreement block");
    const existing = scopes.find(s => s.cabinClass === input.cabinClass);
    if (existing) {
      if (input.marketingFlightNumber !== existing.marketingFlightNumber)
        unavailable("An assigned marketing flight number cannot be changed");
      const [usage] = await tx
        .select({ occupied: occupiedCodeshareSeats() })
        .from(codeshareAllotments)
        .where(eq(codeshareAllotments.id, existing.id));
      if (input.seatLimit < usage.occupied)
        unavailable("Seat limit is below committed seats");
      await tx
        .update(codeshareAllotments)
        .set({ seatLimit: input.seatLimit })
        .where(eq(codeshareAllotments.id, existing.id));
      return { allotmentId: existing.id };
    }
    const [created] = await tx.insert(codeshareAllotments).values(input);
    return { allotmentId: created.insertId };
  }, inventoryTransactionConfig);
}

export async function readAllotments(db: SettlementTx, flightIds: number[]) {
  if (!flightIds.length) return [];
  return await db
    .select({
      allotmentId: codeshareAllotments.id,
      agreementId: codeshareAllotments.agreementId,
      flightId: codeshareAllotments.flightId,
      cabinClass: codeshareAllotments.cabinClass,
      seatLimit: codeshareAllotments.seatLimit,
      marketingFlightNumber: codeshareAllotments.marketingFlightNumber,
      occupied: occupiedCodeshareSeats(),
    })
    .from(codeshareAllotments)
    .where(inArray(codeshareAllotments.flightId, flightIds));
}
