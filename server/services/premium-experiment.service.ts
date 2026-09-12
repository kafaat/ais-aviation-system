import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import {
  flights,
  bookings,
  financialLedger,
  premiumPolicies,
  premiumAssignments,
  premiumConversions,
  retailOffers,
} from "../../drizzle/schema";
import { getDb } from "../db";
import {
  verifyAviationSource,
  persistAviationEvidence,
  type EvidenceEnvelope,
} from "./aviation-evidence.service";
import {
  premiumPolicySchema,
  premiumVariant,
  premiumPrice,
  experimentDifference,
} from "./premium-experiment-policy";
import { recordEvent } from "./outbox.service";
import { countActiveHolds } from "./inventory-capacity.service";
import type { SettlementTx } from "./booking-settlement.service";
import { financialInteger } from "./financial-reporting.service";
export async function acceptPremiumPolicy(
  e: EvidenceEnvelope,
  signature: string,
  actorId: number,
  tenantId: number | null
) {
  const payload = premiumPolicySchema.parse(e.payload),
    source = verifyAviationSource(e, signature, "premium_policy");
  if (
    e.kind !== "premium_policy" ||
    !e.flightId ||
    (tenantId !== null && source.tenantId !== tenantId)
  )
    throw new Error("Scoped premium policy required");
  const db = await getDb();
  if (!db) throw new Error("Policy storage unavailable");
  return db.transaction(async tx => {
    const [f] = await tx
      .select()
      .from(flights)
      .where(eq(flights.id, e.flightId!))
      .for("update");
    if (
      !f ||
      f.tenantId !== source.tenantId ||
      !source.airlineIds?.includes(f.airlineId) ||
      Date.parse(payload.effectiveTo) > f.departureTime.getTime()
    )
      throw new Error("Premium policy outside flight scope");
    const receipt = await persistAviationEvidence(tx, e, source);
    const [existing] = await tx
      .select()
      .from(premiumPolicies)
      .where(eq(premiumPolicies.evidenceId, receipt.evidenceId))
      .limit(1);
    if (existing) return { id: existing.id, evidenceId: receipt.evidenceId };
    const id = randomUUID();
    await tx.insert(premiumPolicies).values({
      id,
      flightId: f.id,
      tenantId: f.tenantId,
      evidenceId: receipt.evidenceId,
      payload,
      approvedBy: actorId,
    });
    await recordEvent(tx, {
      aggregateType: "premiumPolicy",
      aggregateId: id,
      tenantId: f.tenantId,
      eventType: "retail.premium_policy_approved",
      payload: {
        actorId,
        evidenceId: receipt.evidenceId,
        version: payload.version,
      },
    });
    return { id, evidenceId: receipt.evidenceId };
  });
}
export async function premiumAdjustment(
  tx: SettlementTx,
  flightId: number,
  userId: number,
  pax: number,
  base: number
) {
  const [f] = await tx
    .select()
    .from(flights)
    .where(eq(flights.id, flightId))
    .for("update");
  if (!f) throw new Error("Flight unavailable");
  const rows = await tx
    .select()
    .from(premiumPolicies)
    .where(
      and(
        eq(premiumPolicies.flightId, flightId),
        eq(premiumPolicies.status, "enabled")
      )
    )
    .for("update");
  const active = rows
    .map(row => ({ row, policy: premiumPolicySchema.parse(row.payload) }))
    .filter(
      ({ row, policy: p }) =>
        row.tenantId === f.tenantId &&
        Date.parse(p.effectiveFrom) <= Date.now() &&
        Date.parse(p.effectiveTo) > Date.now()
    );
  if (active.length > 1)
    throw new Error("Resolve overlapping premium experiments");
  if (!active.length) return null;
  const { row, policy } = active[0];
  if (
    !premiumPrice(base, pax, policy, "treatment").eligible ||
    f.businessAvailable - (await countActiveHolds(tx, f.id, "business")) - pax <
      policy.protectedSeats
  )
    return null;
  const [old] = await tx
    .select()
    .from(premiumAssignments)
    .where(
      and(
        eq(premiumAssignments.policyId, row.id),
        eq(premiumAssignments.userId, userId)
      )
    )
    .limit(1);
  const assignment = old ?? {
    id: randomUUID(),
    policyId: row.id,
    userId,
    variant: premiumVariant(row.id, userId),
  };
  if (!old) {
    await tx.insert(premiumAssignments).values(assignment);
    await recordEvent(tx, {
      aggregateType: "premiumAssignment",
      aggregateId: assignment.id,
      tenantId: f.tenantId,
      eventType: "retail.premium_exposure",
      payload: { policyId: row.id, variant: assignment.variant },
    });
  }
  return {
    totalAmount: premiumPrice(base, pax, policy, assignment.variant)
      .totalAmount,
    expiresAt: new Date(policy.effectiveTo),
    experiment: {
      policyId: row.id,
      assignmentId: assignment.id,
      variant: assignment.variant,
      protectedSeats: policy.protectedSeats,
    },
  };
}
export async function recordPremiumConversion(
  tx: SettlementTx,
  offer: typeof retailOffers.$inferSelect,
  bookingId: number
) {
  const experiment = offer.payload.experiment as
    | {
        policyId: string;
        assignmentId: string;
        variant: "control" | "treatment";
        protectedSeats: number;
      }
    | undefined;
  if (!experiment) return;
  const [p] = await tx
    .select()
    .from(premiumPolicies)
    .where(eq(premiumPolicies.id, experiment.policyId))
    .for("update");
  if (!p || p.status !== "enabled")
    throw new Error("Premium policy paused; renew offer");
  const [f] = await tx
    .select()
    .from(flights)
    .where(eq(flights.id, offer.flightId))
    .limit(1);
  if (!f) throw new Error("Flight unavailable");
  if (
    f.businessAvailable - (await countActiveHolds(tx, f.id, "business")) <
    experiment.protectedSeats
  )
    throw new Error("Protected premium inventory is unavailable");
  const [booking] = await tx
    .select()
    .from(bookings)
    .where(eq(bookings.id, bookingId))
    .limit(1);
  const [assignment] = await tx
    .select()
    .from(premiumAssignments)
    .where(eq(premiumAssignments.id, experiment.assignmentId))
    .limit(1);
  if (
    !booking ||
    !assignment ||
    assignment.userId !== booking.userId ||
    assignment.policyId !== p.id
  )
    throw new Error("Experiment ownership mismatch");
  // Only acquisition bookings enter this experiment; an upgrade of an existing paid order is not a new conversion.
  if (
    booking.paymentStatus !== "pending" ||
    booking.createdAt < assignment.createdAt
  )
    return;
  const [old] = await tx
    .select()
    .from(premiumConversions)
    .where(eq(premiumConversions.bookingId, bookingId))
    .limit(1);
  if (!old)
    await tx
      .insert(premiumConversions)
      .values({ bookingId, assignmentId: assignment.id, offerId: offer.id });
}
export async function pausePremiumPolicy(
  id: string,
  actorId: number,
  tenantId: number | null
) {
  const db = await getDb();
  if (!db) throw new Error("Policy storage unavailable");
  return db.transaction(async tx => {
    const [p] = await tx
      .select()
      .from(premiumPolicies)
      .where(eq(premiumPolicies.id, id))
      .for("update");
    if (!p || (tenantId !== null && p.tenantId !== tenantId))
      throw new Error("Scoped policy unavailable");
    await tx
      .update(premiumPolicies)
      .set({ status: "paused" })
      .where(eq(premiumPolicies.id, id));
    const receiptId = await recordEvent(tx, {
      aggregateType: "premiumPolicy",
      aggregateId: id,
      tenantId: p.tenantId,
      eventType: "retail.premium_policy_paused",
      payload: { actorId },
    });
    return { receiptId };
  });
}
export async function premiumResults(id: string, tenantId: number | null) {
  const db = await getDb();
  if (!db) throw new Error("Experiment storage unavailable");
  return db.transaction(
    async tx => {
      const [row] = await tx
        .select()
        .from(premiumPolicies)
        .where(eq(premiumPolicies.id, id))
        .limit(1);
      if (!row || (tenantId !== null && row.tenantId !== tenantId))
        throw new Error("Scoped policy unavailable");
      const policy = premiumPolicySchema.parse(row.payload),
        assignments = await tx
          .select()
          .from(premiumAssignments)
          .where(eq(premiumAssignments.policyId, id))
          .limit(100001);
      if (assignments.length > 100000)
        throw new Error("Export this large experiment through the warehouse");
      const conversions = assignments.length
        ? await tx
            .select()
            .from(premiumConversions)
            .where(
              inArray(
                premiumConversions.assignmentId,
                assignments.map(a => a.id)
              )
            )
        : [];
      const ledger = conversions.length
        ? await tx
            .select()
            .from(financialLedger)
            .where(
              inArray(
                financialLedger.bookingId,
                conversions.map(c => c.bookingId)
              )
            )
            .limit(100001)
        : [];
      if (ledger.length > 100000)
        throw new Error("Experiment ledger window exceeded");
      let unclassified = 0;
      const values = new Map(assignments.map(a => [a.id, 0]));
      const paid = new Set<string>();
      for (const entry of ledger) {
        const conversion = conversions.find(
          c => c.bookingId === entry.bookingId
        )!;
        if (entry.currency !== "SAR" || entry.type === "adjustment") {
          unclassified++;
          continue;
        }
        if (entry.type === "fee") continue;
        const amount = financialInteger(Math.round(Number(entry.amount) * 100));
        if (entry.type === "charge") paid.add(conversion.assignmentId);
        values.set(
          conversion.assignmentId,
          values.get(conversion.assignmentId)! +
            (entry.type === "charge" ? amount : -amount)
        );
      }
      const samples = (variant: "control" | "treatment") =>
        assignments
          .filter(a => a.variant === variant)
          .map(a => values.get(a.id)!);
      const arm = (variant: "control" | "treatment") => {
        const a = assignments.filter(a => a.variant === variant),
          sum = samples(variant).reduce((s, n) => s + n, 0);
        return {
          variant,
          randomizedUsers: a.length,
          paidUsers: a.filter(x => paid.has(x.id)).length,
          netCollectedMinor: sum,
          netCollectedPerUserMinor: a.length ? sum / a.length : null,
        };
      };
      const ready =
        Date.now() >= Date.parse(policy.analysisAfter) && unclassified === 0;
      return {
        id,
        currency: "SAR" as const,
        asOf: new Date(),
        metric: "lifecycle_net_collections_per_randomized_user" as const,
        arms: [arm("control"), arm("treatment")],
        unclassifiedEntries: unclassified,
        effect: ready
          ? experimentDifference(
              samples("control"),
              samples("treatment"),
              policy.minimumSamplePerArm
            )
          : null,
        status: ready
          ? ("analysis_window_open" as const)
          : ("observing" as const),
      };
    },
    { isolationLevel: "repeatable read", accessMode: "read only" }
  );
}
