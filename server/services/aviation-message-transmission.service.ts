import { createHash, randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { and, eq, inArray, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import {
  operationalMessageRoutes,
  operationalMessageTransmissions,
} from "../../drizzle/operations-schema";
import { providerBoundary } from "../_core/provider-boundary";
import { getDb } from "../db";
import { parseAuthorityAcknowledgment } from "./apis-pnrgov";
import {
  assertTransmissionTransition,
  parseOperationalDraft,
  operationalMessageTypes,
  requireAcceptedOperationalRoute,
  type TransmissionStatus,
} from "./operational-messaging.service";

export async function createTransmissionDraft(input: {
  tenantId: number;
  flightId?: number;
  routeId?: number;
  messageType: string;
  idempotencyKey: string;
  messageContent: string;
}) {
  if (!/^[A-Za-z0-9:_./-]{8,128}$/.test(input.idempotencyKey))
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "A stable transmission idempotency key is required",
    });
  if (!/^[A-Z0-9_]{3,12}$/.test(input.messageType))
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Unsupported aviation message type",
    });
  if (!input.messageContent || input.messageContent.length > 2_000_000)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "A bounded aviation message is required",
    });
  const db = await getDb();
  if (!db) throw new Error("Aviation message storage unavailable");
  const digest = createHash("sha256")
    .update(input.messageContent)
    .digest("hex");
  return db.transaction(async tx => {
    await tx
      .insert(operationalMessageTransmissions)
      .values({
        tenantId: input.tenantId,
        flightId: input.flightId,
        routeId: input.routeId,
        messageType: input.messageType,
        direction: "outbound",
        idempotencyKey: input.idempotencyKey,
        messageDigest: digest,
        messageContent: input.messageContent,
        status: "draft",
      })
      .onDuplicateKeyUpdate({
        set: { idempotencyKey: sql`idempotency_key` },
      });
    const [row] = await tx
      .select()
      .from(operationalMessageTransmissions)
      .where(
        and(
          eq(operationalMessageTransmissions.tenantId, input.tenantId),
          eq(
            operationalMessageTransmissions.idempotencyKey,
            input.idempotencyKey
          )
        )
      )
      .limit(1);
    if (
      !row ||
      row.messageDigest !== digest ||
      row.direction !== "outbound" ||
      row.routeId !== (input.routeId ?? null) ||
      row.flightId !== (input.flightId ?? null) ||
      row.messageType !== input.messageType
    )
      throw new TRPCError({
        code: "CONFLICT",
        message: "Transmission idempotency key was reused with different data",
      });
    return { transmissionId: row.id, messageDigest: row.messageDigest };
  });
}

function assertTypeBRoute(
  row: typeof operationalMessageTransmissions.$inferSelect,
  route: typeof operationalMessageRoutes.$inferSelect,
  now: Date
) {
  const envelope = parseOperationalDraft(row.messageContent);
  if (
    providerBoundary() !== "open" ||
    !route.acceptedBy ||
    !route.acceptedAt ||
    route.acceptedAt > now ||
    row.direction !== "outbound" ||
    envelope.messageType !== row.messageType ||
    route.messageType !== row.messageType ||
    envelope.originAddress !== route.originAddress ||
    envelope.destinationAddress !== route.destinationAddress
  )
    throw new Error(
      "Operational message has no matching accepted Type B route"
    );
  requireAcceptedOperationalRoute({
    originAddress: route.originAddress,
    destinationAddress: route.destinationAddress,
    stationCode: route.stationCode,
    transportProfile: route.transportProfile,
    enabled: route.enabled,
    acceptedAt: route.acceptedAt.toISOString(),
  });
}

export async function queueTransmission(input: {
  transmissionId: number;
  tenantId: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("Aviation message storage unavailable");
  return db.transaction(async tx => {
    const [row] = await tx
      .select()
      .from(operationalMessageTransmissions)
      .where(
        and(
          eq(operationalMessageTransmissions.id, input.transmissionId),
          eq(operationalMessageTransmissions.tenantId, input.tenantId)
        )
      )
      .limit(1)
      .for("update");
    if (!row || !row.routeId)
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Route-bound draft not found",
      });
    const [route] = await tx
      .select()
      .from(operationalMessageRoutes)
      .where(
        and(
          eq(operationalMessageRoutes.id, row.routeId),
          eq(operationalMessageRoutes.tenantId, input.tenantId)
        )
      )
      .limit(1)
      .for("update");
    if (!route) throw new Error("Operational message route unavailable");
    assertTypeBRoute(row, route, new Date());
    assertTransmissionTransition(row.status as TransmissionStatus, "queued");
    await tx
      .update(operationalMessageTransmissions)
      .set({ status: "queued", nextAttemptAt: new Date() })
      .where(eq(operationalMessageTransmissions.id, row.id));
    return { transmissionId: row.id, status: "queued" as const };
  });
}

/** Claims one due message. The adapter must later record success or failure. */
export async function claimDueTransmission(now = new Date()) {
  if (
    process.env.AIS_TYPE_B_TRANSPORT_ENABLED !== "true" ||
    providerBoundary() !== "open"
  )
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Operational message transport is disabled",
    });
  const db = await getDb();
  if (!db) throw new Error("Aviation message storage unavailable");
  return db.transaction(async tx => {
    const [match] = await tx
      .select({
        row: operationalMessageTransmissions,
        route: operationalMessageRoutes,
      })
      .from(operationalMessageTransmissions)
      .innerJoin(
        operationalMessageRoutes,
        and(
          eq(
            operationalMessageRoutes.id,
            operationalMessageTransmissions.routeId
          ),
          eq(
            operationalMessageRoutes.tenantId,
            operationalMessageTransmissions.tenantId
          ),
          eq(
            operationalMessageRoutes.messageType,
            operationalMessageTransmissions.messageType
          )
        )
      )
      .where(
        and(
          eq(operationalMessageTransmissions.direction, "outbound"),
          inArray(operationalMessageTransmissions.messageType, [
            ...operationalMessageTypes,
          ]),
          eq(operationalMessageRoutes.enabled, true),
          isNotNull(operationalMessageRoutes.acceptedBy),
          lte(operationalMessageRoutes.acceptedAt, now),
          or(
            eq(operationalMessageTransmissions.status, "queued"),
            eq(operationalMessageTransmissions.status, "retry_scheduled")
          ),
          or(
            isNull(operationalMessageTransmissions.nextAttemptAt),
            lte(operationalMessageTransmissions.nextAttemptAt, now)
          ),
          or(
            isNull(operationalMessageTransmissions.leaseUntil),
            lte(operationalMessageTransmissions.leaseUntil, now)
          )
        )
      )
      .limit(1)
      .for("update", { skipLocked: true });
    if (!match) return null;
    const { row, route } = match;
    // A changed route must never release an earlier draft to a different station.
    try {
      assertTypeBRoute(row, route, now);
    } catch {
      await tx
        .update(operationalMessageTransmissions)
        .set({
          status: "failed",
          errorMessage: "Type B route no longer matches this draft",
        })
        .where(eq(operationalMessageTransmissions.id, row.id));
      return null;
    }
    const leaseKey = randomUUID();
    await tx
      .update(operationalMessageTransmissions)
      .set({
        status: "sending",
        leaseKey,
        leaseUntil: new Date(now.getTime() + 60_000),
        attemptCount: row.attemptCount + 1,
        nextAttemptAt: null,
      })
      .where(eq(operationalMessageTransmissions.id, row.id));
    return {
      transmissionId: row.id,
      leaseKey,
      messageType: row.messageType,
      messageContent: row.messageContent,
      attempt: row.attemptCount + 1,
    };
  });
}

export async function recordTransportResult(input: {
  transmissionId: number;
  leaseKey: string;
  providerMessageId?: string;
  errorMessage?: string;
  now?: Date;
}) {
  const db = await getDb();
  if (!db) throw new Error("Aviation message storage unavailable");
  const now = input.now ?? new Date();
  return db.transaction(async tx => {
    const [row] = await tx
      .select()
      .from(operationalMessageTransmissions)
      .where(eq(operationalMessageTransmissions.id, input.transmissionId))
      .limit(1)
      .for("update");
    if (!row || row.leaseKey !== input.leaseKey || row.status !== "sending")
      throw new TRPCError({
        code: "CONFLICT",
        message: "Stale transmission lease",
      });
    if (input.errorMessage) {
      const terminal = row.attemptCount >= 5;
      const status = terminal ? "failed" : "retry_scheduled";
      assertTransmissionTransition(row.status, status);
      const delay = Math.min(60 * 60_000, 2 ** row.attemptCount * 30_000);
      await tx
        .update(operationalMessageTransmissions)
        .set({
          status,
          errorMessage: input.errorMessage.slice(0, 500),
          nextAttemptAt: terminal ? null : new Date(now.getTime() + delay),
          leaseKey: null,
          leaseUntil: null,
        })
        .where(eq(operationalMessageTransmissions.id, row.id));
      return { status };
    }
    if (
      !input.providerMessageId?.trim() ||
      input.providerMessageId.length > 128
    )
      throw new Error("A transport receipt reference is required");
    assertTransmissionTransition(row.status, "sent");
    await tx
      .update(operationalMessageTransmissions)
      .set({
        status: "sent",
        providerMessageId: input.providerMessageId,
        sentAt: now,
        leaseKey: null,
        leaseUntil: null,
        errorMessage: null,
      })
      .where(eq(operationalMessageTransmissions.id, row.id));
    return { status: "sent" as const };
  });
}

export async function recordAuthorityAcknowledgment(input: {
  transmissionId: number;
  tenantId: number;
  responseContent: string;
  now?: Date;
}) {
  const db = await getDb();
  if (!db) throw new Error("Aviation message storage unavailable");
  const now = input.now ?? new Date();
  return db.transaction(async tx => {
    const [row] = await tx
      .select()
      .from(operationalMessageTransmissions)
      .where(
        and(
          eq(operationalMessageTransmissions.id, input.transmissionId),
          eq(operationalMessageTransmissions.tenantId, input.tenantId)
        )
      )
      .limit(1)
      .for("update");
    if (!row)
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Transmission not found",
      });
    if (row.direction !== "outbound")
      throw new Error("Outbound transmission required");
    const decision = parseAuthorityAcknowledgment(input.responseContent, row);
    const responseDigest = createHash("sha256")
      .update(input.responseContent)
      .digest("hex");
    if (row.responseDigest === responseDigest && row.status === decision.status)
      return decision;
    assertTransmissionTransition(
      row.status as TransmissionStatus,
      decision.status
    );
    await tx
      .update(operationalMessageTransmissions)
      .set({
        status: decision.status,
        acknowledgmentCode: decision.responseCode,
        responseDigest,
        acknowledgedAt: now,
        errorMessage: decision.errorCodes.length
          ? `Authority error codes: ${decision.errorCodes.join(",")}`
          : null,
      })
      .where(eq(operationalMessageTransmissions.id, row.id));
    return decision;
  });
}
