import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { travelAgents, users } from "../../drizzle/schema";
import type { SettlementTx } from "./booking-settlement.service";
import { assertAccountAccessible } from "./mobile-auth-v2.service";
import { assertTenantOperational } from "./tenant.service";

export type AgencySessionOwner = { userId: number; tenantId: number | null };

export function agencyUnavailable(): never {
  throw new TRPCError({
    code: "FORBIDDEN",
    message: "Agency is unavailable for this account",
  });
}

/** Uses the existing session-account revocation authority, not an invented
 * email-verification flag. The user table has no such flag. */
export async function assertAgencySessionAccount(
  tx: SettlementTx,
  actor: AgencySessionOwner
) {
  if (!Number.isSafeInteger(actor.userId) || actor.userId <= 0)
    agencyUnavailable();
  const [owner] = await tx
    .select({ id: users.id, tenantId: users.tenantId })
    .from(users)
    .where(eq(users.id, actor.userId))
    .limit(1)
    .for("share");
  if (!owner || owner.tenantId !== actor.tenantId) agencyUnavailable();
  await assertAccountAccessible(tx, owner.id);
  await assertTenantOperational(tx, owner.tenantId);
}

/** Lock agency before account, matching the existing booking/relink order.
 * Call inside the SAME transaction that claims/replays a booking command. */
export async function requireOwnedAgency(
  tx: SettlementTx,
  actor: AgencySessionOwner,
  agencyId: number,
  forWrite = false
) {
  const [agency] = await tx
    .select({
      id: travelAgents.id,
      ownerUserId: travelAgents.ownerUserId,
      isActive: travelAgents.isActive,
      agencyName: travelAgents.agencyName,
      iataNumber: travelAgents.iataNumber,
      contactEmail: travelAgents.email,
      contactPhone: travelAgents.phone,
    })
    .from(travelAgents)
    .where(eq(travelAgents.id, agencyId))
    .limit(1)
    .for(forWrite ? "update" : "share");
  if (!agency?.isActive || agency.ownerUserId !== actor.userId)
    agencyUnavailable();
  await assertAgencySessionAccount(tx, actor);
  return agency;
}
