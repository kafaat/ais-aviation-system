import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import { flights, revenueOptimizationLogs } from "../../drizzle/schema";
import { recordEvent } from "./outbox.service";
import { assertTenantOperational } from "./tenant.service";

type Recommendation = typeof revenueOptimizationLogs.$inferSelect;
export function priceApprovalDigest(
  log: Recommendation,
  tenantId: number | null
) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        version: 1,
        action: "price_change",
        logId: log.id,
        tenantId,
        flightId: log.flightId,
        cabinClass: log.cabinClass,
        previousPrice: log.previousPrice,
        optimizedPrice: log.optimizedPrice,
        factors: log.factors,
      })
    )
    .digest("hex");
}
export function validatePriceRecommendation(
  log: Recommendation,
  currentPrice: number,
  now = new Date()
) {
  if (
    !Number.isSafeInteger(log.optimizedPrice) ||
    log.optimizedPrice <= 0 ||
    log.optimizedPrice > 2147483647 ||
    currentPrice !== log.previousPrice ||
    currentPrice <= 0 ||
    Math.abs(log.optimizedPrice / currentPrice - 1) > 0.3 ||
    now.getTime() - log.createdAt.getTime() > 86400000
  )
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "Stale recommendation or price change outside the 30% agent limit; request a fresh review",
    });
}
/** Flight -> recommendation is the shared lock order for approval/execution. */
async function priceCommand(
  logId: number,
  actorId: number,
  tenantId: number | null,
  execute: boolean
) {
  const db = await getDb();
  if (!db) throw new Error("Pricing storage unavailable");
  const [identity] = await db
    .select()
    .from(revenueOptimizationLogs)
    .where(eq(revenueOptimizationLogs.id, logId))
    .limit(1);
  if (!identity)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Recommendation not found",
    });
  return db.transaction(async tx => {
    const [flight] = await tx
      .select()
      .from(flights)
      .where(eq(flights.id, identity.flightId))
      .for("update");
    if (!flight || (tenantId !== null && flight.tenantId !== tenantId))
      throw new TRPCError({ code: "NOT_FOUND", message: "Flight not found" });
    await assertTenantOperational(tx, flight.tenantId);
    const [log] = await tx
      .select()
      .from(revenueOptimizationLogs)
      .where(eq(revenueOptimizationLogs.id, logId))
      .for("update");
    if (!log || log.flightId !== flight.id)
      throw new Error("Recommendation changed");
    const digest = priceApprovalDigest(log, flight.tenantId);
    if (
      execute &&
      log.status === "applied" &&
      log.executionEventId &&
      log.approvalDigest === digest
    )
      return {
        receiptId: log.executionEventId,
        expiresAt: log.approvalExpiresAt,
      };
    validatePriceRecommendation(
      log,
      log.cabinClass === "economy" ? flight.economyPrice : flight.businessPrice
    );
    if (
      !["scheduled", "delayed"].includes(flight.status) ||
      flight.departureTime <= new Date()
    )
      throw new Error("Flight cannot be repriced");
    if (!execute) {
      if (log.status !== "suggested")
        throw new TRPCError({
          code: "CONFLICT",
          message: "Recommendation is no longer awaiting approval",
        });
      const expiresAt = new Date(Date.now() + 30 * 60000);
      const receiptId = await recordEvent(tx, {
        aggregateType: "pricing",
        aggregateId: logId,
        tenantId: flight.tenantId,
        eventType: "agent.price_approved",
        payload: {
          digest,
          approvedBy: actorId,
          expiresAt: expiresAt.toISOString(),
        },
      });
      await tx
        .update(revenueOptimizationLogs)
        .set({
          status: "approved",
          approvedBy: actorId,
          approvedAt: new Date(),
          approvalDigest: digest,
          approvalExpiresAt: expiresAt,
        })
        .where(eq(revenueOptimizationLogs.id, logId));
      return { receiptId, expiresAt };
    }
    if (
      log.status !== "approved" ||
      !log.approvedBy ||
      log.approvalDigest !== digest ||
      !log.approvalExpiresAt ||
      log.approvalExpiresAt <= new Date()
    )
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message:
          "A current human approval for this exact recommendation is required",
      });
    await tx
      .update(flights)
      .set(
        log.cabinClass === "economy"
          ? { economyPrice: log.optimizedPrice }
          : { businessPrice: log.optimizedPrice }
      )
      .where(eq(flights.id, flight.id));
    const receiptId = await recordEvent(tx, {
      aggregateType: "pricing",
      aggregateId: logId,
      tenantId: flight.tenantId,
      eventType: "agent.price_executed",
      payload: {
        digest,
        approvedBy: log.approvedBy,
        executedBy: actorId,
        previousPrice: log.previousPrice,
        price: log.optimizedPrice,
        flightId: flight.id,
      },
    });
    await tx
      .update(revenueOptimizationLogs)
      .set({
        status: "applied",
        executionEventId: receiptId,
        autoApplied: false,
      })
      .where(eq(revenueOptimizationLogs.id, logId));
    return { receiptId, expiresAt: log.approvalExpiresAt };
  });
}
export const approvePriceChange = (
  logId: number,
  actorId: number,
  tenantId: number | null
) => priceCommand(logId, actorId, tenantId, false);
export const executeApprovedPriceChange = (
  logId: number,
  actorId: number,
  tenantId: number | null
) => priceCommand(logId, actorId, tenantId, true);
