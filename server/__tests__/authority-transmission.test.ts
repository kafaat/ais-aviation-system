import { createHash } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { transactionMemory } from "./helpers/transaction-memory";
const boundary = vi.hoisted(() => ({
  db: null as ReturnType<typeof transactionMemory>["db"] | null,
}));
vi.mock("../db", () => ({ getDb: () => boundary.db }));
import {
  queueTransmission,
  claimDueTransmission,
  recordAuthorityAcknowledgment,
} from "../services/aviation-message-transmission.service";
import { generateAPISMessage } from "../services/apis.service";

afterEach(() => vi.unstubAllEnvs());
beforeEach(() => {
  vi.stubEnv("AIS_ENABLE_DEMOS", "true");
  vi.stubEnv("AIS_TYPE_B_TRANSPORT_ENABLED", "true");
  vi.stubEnv("AIS_PROVIDER_BOUNDARY", "open");
});

const outbound =
  "UNB+IATA:1+AIR+AUTH+261103:1200+I'UNH+M+PNRGOV:21:1:IA+TX'UNT+2+M'UNZ+1+I'";
const receipt =
  "UNB+IATA:1+AUTH+AIR+261103:1201+R'UNH+ACK+ACKRES:21:1:IA+TX'MSG+:23+3'UNT+3+ACK'UNZ+1+R'";

it("applies only the original message's reply and keeps the first receipt on replay", async () => {
  const fixture = transactionMemory({
    operational_message_transmissions: [
      {
        id: 10,
        tenant_id: 1,
        messageType: "PNRGOV",
        messageContent: outbound,
        messageDigest: createHash("sha256").update(outbound).digest("hex"),
        providerMessageId: "fixture-authority-10",
        sentAt: new Date("2026-11-03T12:00:00Z"),
        direction: "outbound",
        status: "sent",
      },
    ],
  });
  boundary.db = fixture.db;
  const command = { transmissionId: 10, tenantId: 1, responseContent: receipt };
  await expect(
    recordAuthorityAcknowledgment({ ...command, tenantId: 2 })
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(
    recordAuthorityAcknowledgment({
      ...command,
      responseContent: receipt.replace("IA+TX", "IA+WRONG"),
    })
  ).rejects.toThrow(/reference/);
  expect(fixture.rows("operational_message_transmissions")[0].status).toBe(
    "sent"
  );
  const now = new Date("2026-11-03T12:05:00Z");
  await recordAuthorityAcknowledgment({ ...command, now });
  await recordAuthorityAcknowledgment({
    ...command,
    now: new Date(now.getTime() + 10000),
  });
  expect(fixture.rows("operational_message_transmissions")[0]).toMatchObject({
    status: "acknowledged",
    acknowledgedAt: now,
  });
});

it("requires a tenant before drafting an authority message", async () => {
  await expect(generateAPISMessage(10, "paxlst", null)).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
  boundary.db = transactionMemory({ flights: [{ id: 10, tenantId: 1 }] }).db;
  await expect(generateAPISMessage(10, "paxlst", 2)).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
});

it("refuses the isolated worker and a manifest addressed to a different station", async () => {
  vi.stubEnv("AIS_TYPE_B_TRANSPORT_ENABLED", "true");
  vi.stubEnv("AIS_PROVIDER_BOUNDARY", "isolated");
  await expect(claimDueTransmission()).rejects.toMatchObject({
    code: "PRECONDITION_FAILED",
  });
  vi.stubEnv("AIS_PROVIDER_BOUNDARY", "open");
  const fixture = transactionMemory({
    operational_message_transmissions: [
      {
        id: 10,
        tenant_id: 1,
        routeId: 2,
        messageType: "PNL",
        messageContent: "QU WRNGHXX\n.RUHSVXX\nPNL\nEND",
        direction: "outbound",
        status: "draft",
      },
    ],
    operational_message_routes: [
      {
        id: 2,
        tenant_id: 1,
        messageType: "PNL",
        originAddress: "RUHSVXX",
        destinationAddress: "LHRGHXX",
        acceptedAt: new Date(0),
        acceptedBy: 2,
        enabled: true,
      },
    ],
  });
  boundary.db = fixture.db;
  await expect(
    queueTransmission({ transmissionId: 10, tenantId: 1 })
  ).rejects.toThrow(/matching accepted/);
  expect(fixture.rows("operational_message_transmissions")[0].status).toBe(
    "draft"
  );
});
