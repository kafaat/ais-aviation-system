import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import {
  operationalMessageRoutes,
  operationalMessageTransmissions,
} from "../../drizzle/operations-schema";
import { authorityRelationalFixture } from "../__tests__/helpers/authority-relational-fixture";
import { getOperationalTransportCapability } from "./aviation-transport-capability.service";
import {
  claimDueTransmission,
  queueTransmission,
  recordTransportResult,
  recordAuthorityAcknowledgment,
} from "./aviation-message-transmission.service";
import {
  getAuthoritySubmissionCapability,
  submitToAuthorities,
} from "./apis.service";

const store = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("../db", () => ({ getDb: store.getDb }));
let fixture: ReturnType<typeof authorityRelationalFixture>;
const now = new Date("2026-11-06T12:00:00Z");
const messageContent = "QU LHRGHXX\n.RUHSVXX\nPNL\nZY917/06NOV/RUH/LHR\nEND";
const messageDigest = createHash("sha256").update(messageContent).digest("hex");
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");

function enableSimulation() {
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("AIS_ENABLE_DEMOS", "true");
  vi.stubEnv("AIS_TYPE_B_TRANSPORT_ENABLED", "true");
  vi.stubEnv("AIS_PROVIDER_BOUNDARY", "open");
}
function seed(status = "draft") {
  fixture.insert(operationalMessageRoutes, {
    id: 2,
    tenant_id: 1,
    station_code: "LHR",
    message_type: "PNL",
    origin_address: "RUHSVXX",
    destination_address: "LHRGHXX",
    transport_profile: "controlled-handler-fixture",
    enabled: 1,
    accepted_at: "2026-11-05 12:00:00",
    accepted_by: 7,
  });
  fixture.insert(operationalMessageTransmissions, {
    id: 10,
    tenant_id: 1,
    flight_id: 100,
    route_id: 2,
    message_type: "PNL",
    direction: "outbound",
    idempotency_key: "fixture:transmission:10",
    message_digest: messageDigest,
    message_content: messageContent,
    status,
  });
}
async function read() {
  return (await fixture.db.select().from(operationalMessageTransmissions))[0];
}
async function claim() {
  seed();
  await queueTransmission({ transmissionId: 10, tenantId: 1 });
  const delivery = await claimDueTransmission(now);
  expect(delivery).not.toBeNull();
  return delivery!;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
  enableSimulation();
  fixture = authorityRelationalFixture([
    operationalMessageRoutes,
    operationalMessageTransmissions,
  ]);
  store.getDb.mockReset().mockReturnValue(fixture.db);
});
afterEach(() => {
  fixture.sqlite.close();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("Type B execution and authenticated acknowledgment boundary", () => {
  it.each(["production", "development"])(
    "refuses flag-only claims, send receipts and ACKs in %s before storage",
    async environment => {
      vi.stubEnv("NODE_ENV", environment);
      vi.stubEnv(
        "AIS_ENABLE_DEMOS",
        environment === "production" ? "true" : "false"
      );
      expect(getOperationalTransportCapability()).toMatchObject({
        mode: "disabled",
        simulationAvailable: false,
        externalTransmissionAvailable: false,
        productionWorkerAvailable: false,
        authenticatedAcknowledgmentAvailable: false,
      });
      await expect(
        queueTransmission({ transmissionId: 10, tenantId: 1 })
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
      await expect(claimDueTransmission()).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
      });
      await expect(
        recordTransportResult({
          transmissionId: 10,
          tenantId: 1,
          routeId: 2,
          transportProfile: "controlled-handler-fixture",
          messageDigest,
          leaseKey: "claimed-key",
          providerMessageId: "real-looking-receipt",
        })
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
      // A syntactically valid or caller-supplied "signed" message cannot provide
      // the missing authenticated receiver/accepted authority contract.
      await expect(
        recordAuthorityAcknowledgment({
          transmissionId: 10,
          tenantId: 1,
          responseContent: "UNH+ACK+ACKRES:21:1:IA+TX'MSG+:23+3'UNT+3+ACK'",
        })
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
      expect(store.getDb).not.toHaveBeenCalled();
    }
  );

  it("keeps the isolated boundary closed even for explicit simulations", async () => {
    vi.stubEnv("AIS_PROVIDER_BOUNDARY", "isolated");
    await expect(claimDueTransmission()).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
    expect(store.getDb).not.toHaveBeenCalled();
  });

  it("APIS submission remains closed regardless of Type B/demo flags", async () => {
    expect(getAuthoritySubmissionCapability()).toEqual({
      available: false,
      reason: "authority_transport_unavailable",
    });
    await expect(
      submitToAuthorities(100, "controlled-authority")
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(store.getDb).not.toHaveBeenCalled();
  });

  it("returns the complete bound worker claim while labeling successful fixture results as simulated", async () => {
    const delivery = await claim();
    expect(delivery).toMatchObject({
      tenantId: 1,
      routeId: 2,
      transportProfile: "controlled-handler-fixture",
      originAddress: "RUHSVXX",
      destinationAddress: "LHRGHXX",
      stationCode: "LHR",
      idempotencyKey: "fixture:transmission:10",
      messageDigest,
      messageContent,
      execution: "simulation",
      externallyTransmitted: false,
      attempt: 1,
      leaseUntil: new Date(now.getTime() + 60_000),
    });
    expect(
      await recordTransportResult({
        ...delivery,
        providerMessageId: "fixture-provider-10",
        now,
      })
    ).toEqual({
      status: "simulated",
      persistedStatus: "sent",
      execution: "simulation",
      externallyTransmitted: false,
    });
    expect(await read()).toMatchObject({
      status: "sent",
      providerMessageId: "fixture-provider-10",
      leaseKey: null,
    });
  });

  it.each(["", "provider-looks-real", "fixture-with spaces"])(
    "rejects non-fixture or malformed receipt references: %s",
    async providerMessageId => {
      const delivery = await claim();
      await expect(
        recordTransportResult({ ...delivery, providerMessageId, now })
      ).rejects.toThrow(/fixture receipt/);
      expect((await read()).status).toBe("sending");
    }
  );

  it.each([
    { tenantId: 2 },
    { routeId: 3 },
    { messageDigest: "a".repeat(64) },
    { leaseKey: "stale-key" },
    { transportProfile: "different-profile" },
  ])("rejects a result for the wrong claim binding: %j", async change => {
    const delivery = await claim();
    await expect(
      recordTransportResult({
        ...delivery,
        ...change,
        providerMessageId: "fixture-provider-10",
        now,
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await read()).status).toBe("sending");
  });

  it("revalidates route authorization and the message digest after claim", async () => {
    const delivery = await claim();
    await fixture.db
      .update(operationalMessageRoutes)
      .set({ destinationAddress: "WRNGHXX" })
      .where(eq(operationalMessageRoutes.id, 2));
    await expect(
      recordTransportResult({
        ...delivery,
        providerMessageId: "fixture-provider-10",
        now,
      })
    ).rejects.toThrow(/matching accepted/);
    await fixture.db
      .update(operationalMessageRoutes)
      .set({ destinationAddress: "LHRGHXX" })
      .where(eq(operationalMessageRoutes.id, 2));
    await fixture.db
      .update(operationalMessageTransmissions)
      .set({ messageContent: messageContent.replace("ZY917", "ZY918") })
      .where(eq(operationalMessageTransmissions.id, 10));
    await expect(
      recordTransportResult({
        ...delivery,
        providerMessageId: "fixture-provider-10",
        now,
      })
    ).rejects.toThrow(/matching accepted/);
    expect((await read()).status).toBe("sending");
  });

  it("does not claim a tampered draft or release its payload", async () => {
    seed("queued");
    await fixture.db
      .update(operationalMessageTransmissions)
      .set({ messageDigest: "a".repeat(64) })
      .where(eq(operationalMessageTransmissions.id, 10));
    expect(await claimDueTransmission(now)).toBeNull();
    expect(await read()).toMatchObject({
      status: "failed",
      leaseKey: null,
      nextAttemptAt: null,
    });
  });

  it("persists expired-result quarantine before rejecting the stale worker", async () => {
    const delivery = await claim();
    const expiredAt = new Date(now.getTime() + 60_000);
    await expect(
      recordTransportResult({
        ...delivery,
        providerMessageId: "fixture-provider-10",
        now: expiredAt,
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await read()).toMatchObject({
      status: "failed",
      nextAttemptAt: null,
      leaseKey: null,
      providerMessageId: null,
    });
    expect((await read()).errorMessage).toContain("delivery_outcome_unknown");
    expect(await claimDueTransmission(expiredAt)).toBeNull();
  });

  it("quarantines abandoned sending work rather than retrying a possibly delivered message", async () => {
    await claim();
    expect(
      await claimDueTransmission(new Date(now.getTime() + 60_000))
    ).toBeNull();
    expect(await read()).toMatchObject({
      status: "failed",
      attemptCount: 1,
      nextAttemptAt: null,
    });
    expect((await read()).errorMessage).toContain("reconciliation required");
  });

  it("only retries a confirmed pre-send failure and preserves the exact idempotent message", async () => {
    const delivery = await claim();
    expect(
      await recordTransportResult({
        ...delivery,
        errorMessage: "Fixture refused before send",
        deliveryOutcome: "not_sent",
        now,
      })
    ).toMatchObject({
      status: "retry_scheduled",
      externallyTransmitted: false,
    });
    const row = await read();
    expect(
      await claimDueTransmission(new Date(row.nextAttemptAt!.getTime() - 1))
    ).toBeNull();
    const retry = await claimDueTransmission(row.nextAttemptAt!);
    expect(retry).toMatchObject({
      attempt: 2,
      idempotencyKey: delivery.idempotencyKey,
      messageDigest,
      messageContent,
    });
    expect(retry!.leaseKey).not.toBe(delivery.leaseKey);
    await expect(
      recordTransportResult({
        ...delivery,
        providerMessageId: "fixture-old-worker",
        now: row.nextAttemptAt!,
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("treats unknown or unclassified failures as reconciliation-required, with no retry", async () => {
    const delivery = await claim();
    expect(
      await recordTransportResult({
        ...delivery,
        errorMessage: "Timed out after sending",
        now,
      })
    ).toMatchObject({ status: "failed" });
    expect(await read()).toMatchObject({
      nextAttemptAt: null,
      errorMessage: "delivery_outcome_unknown: reconciliation required",
    });
  });

  it("labels ACK parser fixtures as unauthenticated simulation and preserves replay time", async () => {
    const outbound =
      "UNB+IATA:1+AIR+AUTH+261106:1200+I'UNH+M+PNRGOV:21:1:IA+TX'UNT+2+M'UNZ+1+I'";
    fixture.insert(operationalMessageTransmissions, {
      id: 10,
      tenant_id: 1,
      message_type: "PNRGOV",
      direction: "outbound",
      idempotency_key: "fixture:authority:10",
      message_digest: hash(outbound),
      message_content: outbound,
      status: "sent",
      provider_message_id: "fixture-authority-10",
      sent_at: "2026-11-06 12:00:00",
    });
    const input = {
      transmissionId: 10,
      tenantId: 1,
      responseContent:
        "UNB+IATA:1+AUTH+AIR+261106:1201+R'UNH+ACK+ACKRES:21:1:IA+TX'MSG+:23+3'UNT+3+ACK'UNZ+1+R'",
      now,
    };
    expect(await recordAuthorityAcknowledgment(input)).toMatchObject({
      status: "acknowledged",
      externallyTransmitted: false,
      authenticatedAuthorityAcknowledgment: false,
    });
    await recordAuthorityAcknowledgment({
      ...input,
      now: new Date(now.getTime() + 10000),
    });
    expect((await read()).acknowledgedAt).toEqual(now);
    await fixture.db
      .update(operationalMessageTransmissions)
      .set({ providerMessageId: null })
      .where(eq(operationalMessageTransmissions.id, 10));
    await expect(recordAuthorityAcknowledgment(input)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
  });
});
