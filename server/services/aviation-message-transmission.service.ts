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
  requireOperationalTransportSimulation,
  simulatedTransportOutcome,
} from "./aviation-transport-capability.service";
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
    envelope.destinationAddress !== route.destinationAddress ||
    envelope.messageDigest !== row.messageDigest
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
  requireOperationalTransportSimulation();
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
    return {
      transmissionId: row.id,
      status: "queued" as const,
      ...simulatedTransportOutcome,
    };
  });
}

/** Simulation worker contract only. No production network adapter is installed. */
export async function claimDueTransmission(now = new Date()) {
  requireOperationalTransportSimulation();
  const db = await getDb();
  if (!db) throw new Error("Aviation message storage unavailable");
  return db.transaction(async tx => {
    // A worker may have transmitted before dying. Expiry is not proof of
    // non-delivery: quarantine the ambiguous attempt, never automatically send
    // it again. The existing failed state is terminal pending reconciliation.
    const [expired] = await tx
      .select({ id: operationalMessageTransmissions.id })
      .from(operationalMessageTransmissions)
      .where(
        and(
          eq(operationalMessageTransmissions.direction, "outbound"),
          eq(operationalMessageTransmissions.status, "sending"),
          or(
            isNull(operationalMessageTransmissions.leaseUntil),
            lte(operationalMessageTransmissions.leaseUntil, now)
          )
        )
      )
      .limit(1)
      .for("update", { skipLocked: true });
    if (expired) {
      await tx
        .update(operationalMessageTransmissions)
        .set({
          status: "failed",
          errorMessage:
            "delivery_outcome_unknown: expired lease; reconciliation required",
          leaseKey: null,
          leaseUntil: null,
          nextAttemptAt: null,
        })
        .where(eq(operationalMessageTransmissions.id, expired.id));
      return null;
    }
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
          leaseKey: null,
          leaseUntil: null,
          nextAttemptAt: null,
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
      tenantId: row.tenantId,
      routeId: route.id,
      transportProfile: route.transportProfile,
      originAddress: route.originAddress,
      destinationAddress: route.destinationAddress,
      stationCode: route.stationCode,
      leaseKey,
      leaseUntil: new Date(now.getTime() + 60_000),
      messageType: row.messageType,
      messageContent: row.messageContent,
      messageDigest: row.messageDigest,
      idempotencyKey: row.idempotencyKey,
      attempt: row.attemptCount + 1,
      ...simulatedTransportOutcome,
    };
  });
}

export async function recordTransportResult(input: {
  transmissionId: number;
  tenantId: number;
  routeId: number;
  transportProfile: string;
  messageDigest: string;
  leaseKey: string;
  providerMessageId?: string;
  errorMessage?: string;
  /** Only a confirmed pre-send failure can be retried automatically. */
  deliveryOutcome?: "not_sent" | "unknown";
  now?: Date;
}) {
  requireOperationalTransportSimulation();
  if (input.providerMessageId && input.errorMessage)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "A receipt and failure cannot be recorded together",
    });
  const db = await getDb();
  if (!db) throw new Error("Aviation message storage unavailable");
  const now = input.now ?? new Date();
  const outcome = await db.transaction(async tx => {
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
    if (!row || row.leaseKey !== input.leaseKey || row.status !== "sending")
      throw new TRPCError({
        code: "CONFLICT",
        message: "Stale transmission lease",
      });
    if (
      row.routeId !== input.routeId ||
      row.messageDigest !== input.messageDigest
    )
      throw new TRPCError({
        code: "CONFLICT",
        message: "Transmission result binding mismatch",
      });
    if (!row.leaseUntil || row.leaseUntil <= now) {
      await tx
        .update(operationalMessageTransmissions)
        .set({
          status: "failed",
          errorMessage:
            "delivery_outcome_unknown: expired lease; reconciliation required",
          leaseKey: null,
          leaseUntil: null,
          nextAttemptAt: null,
        })
        .where(eq(operationalMessageTransmissions.id, row.id));
      return { expiredLease: true as const };
    }
    const [route] = await tx
      .select()
      .from(operationalMessageRoutes)
      .where(
        and(
          eq(operationalMessageRoutes.id, input.routeId),
          eq(operationalMessageRoutes.tenantId, input.tenantId)
        )
      )
      .limit(1)
      .for("update");
    if (!route || route.transportProfile !== input.transportProfile)
      throw new TRPCError({
        code: "CONFLICT",
        message: "Transmission route unavailable or profile changed",
      });
    assertTypeBRoute(row, route, now);
    if (input.errorMessage) {
      const ambiguous = input.deliveryOutcome !== "not_sent";
      const terminal = ambiguous || row.attemptCount >= 5;
      const status = terminal ? "failed" : "retry_scheduled";
      assertTransmissionTransition(row.status, status);
      const delay = Math.min(60 * 60_000, 2 ** row.attemptCount * 30_000);
      await tx
        .update(operationalMessageTransmissions)
        .set({
          status,
          errorMessage: ambiguous
            ? "delivery_outcome_unknown: reconciliation required"
            : input.errorMessage.slice(0, 500),
          nextAttemptAt: terminal ? null : new Date(now.getTime() + delay),
          leaseKey: null,
          leaseUntil: null,
        })
        .where(eq(operationalMessageTransmissions.id, row.id));
      return { status, ...simulatedTransportOutcome };
    }
    if (
      !input.providerMessageId ||
      !/^fixture-[A-Za-z0-9:._/-]{1,120}$/.test(input.providerMessageId)
    )
      throw new Error(
        "An explicitly synthetic fixture receipt reference is required"
      );
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
    // The legacy state machine is exercised in disposable fixtures only. The
    // API outcome never describes this as an external transmission.
    return {
      status: "simulated" as const,
      persistedStatus: "sent" as const,
      ...simulatedTransportOutcome,
    };
  });
  if ("expiredLease" in outcome)
    throw new TRPCError({
      code: "CONFLICT",
      message: "Expired transmission lease; reconciliation required",
    });
  return outcome;
}

export async function recordAuthorityAcknowledgment(input: {
  transmissionId: number;
  tenantId: number;
  responseContent: string;
  now?: Date;
}) {
  // Parsing an envelope is not source authentication. Until an authenticated
  // receiver is installed, callers can exercise only the explicit demo path.
  requireOperationalTransportSimulation();
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
    if (
      !row.providerMessageId?.startsWith("fixture-") ||
      !row.sentAt ||
      row.sentAt > now ||
      createHash("sha256").update(row.messageContent).digest("hex") !==
        row.messageDigest
    )
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "An intact simulated outbound receipt is required",
      });
    const decision = parseAuthorityAcknowledgment(input.responseContent, row);
    const responseDigest = createHash("sha256")
      .update(input.responseContent)
      .digest("hex");
    if (row.responseDigest === responseDigest && row.status === decision.status)
      return {
        ...decision,
        ...simulatedTransportOutcome,
        authenticatedAuthorityAcknowledgment: false as const,
      };
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
    return {
      ...decision,
      ...simulatedTransportOutcome,
      authenticatedAuthorityAcknowledgment: false as const,
    };
  });
}
