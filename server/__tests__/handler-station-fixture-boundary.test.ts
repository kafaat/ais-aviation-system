import { createHash } from "node:crypto";
import http from "node:http";
import https from "node:https";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest";
import {
  operationalMessageRoutes,
  operationalMessageTransmissions,
} from "../../drizzle/operations-schema";
import { authorityRelationalFixture } from "./helpers/authority-relational-fixture";
import * as capability from "../services/aviation-transport-capability.service";
import * as transmission from "../services/aviation-message-transmission.service";
import {
  simulateHandlerTransmission,
  verifyHandlerStation,
} from "../../scripts/acceptance/handler-station";

const store = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("../db", () => ({ getDb: store.getDb }));
// Only the fixed messaging sequence is under test. The outer acceptance runner's
// booking/finance/coupon dependencies must not start services in this unit run.
vi.mock("../routers/aviation-integrations", () => ({
  aviationIntegrationsRouter: {},
}));
vi.mock("../routers/bookings", () => ({ bookingsRouter: {} }));
vi.mock("../services/coupon-month-review", () => ({
  reviewCouponMonth: vi.fn(),
}));
vi.mock("../services/idempotency-v2.service", () => ({
  calculateRequestHash: vi.fn(),
}));
vi.mock("../services/payment-settlement.service", () => ({
  settleVerifiedPayment: vi.fn(),
}));
vi.mock("../services/seat-map.service", () => ({
  changeSeat: vi.fn(),
  checkIn: vi.fn(),
  selectSeat: vi.fn(),
}));
vi.mock("../services/ticket-documents.service", () => ({
  readTicketDocument: vi.fn(),
}));

const messageContent = "QU ZZAGHXX\n.ZZBZYXX\nPNL\nZY917/06NOV/ZZA/ZZB\nEND";
const input = {
  transmissionId: 10,
  tenantId: 1,
  routeId: 2,
  messageType: "PNL" as const,
  messageDigest: createHash("sha256").update(messageContent).digest("hex"),
  destinationAddress: "ZZAGHXX",
};
let fixture: ReturnType<typeof authorityRelationalFixture>;
let fetchSpy: MockInstance<typeof globalThis.fetch>;
let httpSpy: MockInstance<typeof http.request>;
let httpsSpy: MockInstance<typeof https.request>;

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("AIS_ENABLE_DEMOS", "true");
  vi.stubEnv("AIS_TYPE_B_TRANSPORT_ENABLED", "true");
  vi.stubEnv("AIS_PROVIDER_BOUNDARY", "isolated");
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-06T12:00:00Z"));
  fixture = authorityRelationalFixture([
    operationalMessageRoutes,
    operationalMessageTransmissions,
  ]);
  fixture.insert(operationalMessageRoutes, {
    id: 2,
    tenant_id: 1,
    station_code: "ZZA",
    message_type: "PNL",
    origin_address: "ZZBZYXX",
    destination_address: "ZZAGHXX",
    transport_profile: "synthetic-handler-v1",
    enabled: 1,
    accepted_at: "2026-11-05 12:00:00",
    accepted_by: 7,
  });
  fixture.insert(operationalMessageTransmissions, {
    id: 10,
    tenant_id: 1,
    route_id: 2,
    message_type: "PNL",
    direction: "outbound",
    idempotency_key: "handler-pilot:PNL",
    message_digest: input.messageDigest,
    message_content: messageContent,
    status: "draft",
  });
  store.getDb.mockReset().mockReturnValue(fixture.db);
  const noProviderCall = () => {
    throw new Error("Unexpected provider transport in synthetic fixture");
  };
  fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(noProviderCall);
  httpSpy = vi.spyOn(http, "request").mockImplementation(noProviderCall);
  httpsSpy = vi.spyOn(https, "request").mockImplementation(noProviderCall);
});

afterEach(() => {
  try {
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(httpSpy).not.toHaveBeenCalled();
    expect(httpsSpy).not.toHaveBeenCalled();
  } finally {
    fixture.sqlite.close();
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.unstubAllEnvs();
  }
});

describe("handler-station fixture provider boundary", () => {
  it.each(["isolated", "open", undefined])(
    "restores the previous boundary %s after the actual synthetic state-machine sequence",
    async previous => {
      if (previous === undefined) delete process.env.AIS_PROVIDER_BOUNDARY;
      else vi.stubEnv("AIS_PROVIDER_BOUNDARY", previous);
      const result = await simulateHandlerTransmission(input);
      expect(result).toMatchObject({
        messageDigest: input.messageDigest,
        execution: "simulation",
        externallyTransmitted: false,
      });
      expect(process.env.AIS_PROVIDER_BOUNDARY).toBe(previous);
      const [row] = await fixture.db
        .select()
        .from(operationalMessageTransmissions);
      expect(row).toMatchObject({
        status: "sent",
        providerMessageId: "fixture-PNL-10",
      });
      if (previous === "isolated") {
        expect(
          capability.getOperationalTransportCapability().simulationAvailable
        ).toBe(false);
        await expect(transmission.claimDueTransmission()).rejects.toMatchObject(
          { code: "PRECONDITION_FAILED" }
        );
      }
    }
  );

  it.each([
    "queueTransmission",
    "claimDueTransmission",
    "recordTransportResult",
  ] as const)("restores isolation when %s fails", async method => {
    vi.spyOn(transmission, method).mockRejectedValue(
      new Error("Controlled fixture failure")
    );
    await expect(simulateHandlerTransmission(input)).rejects.toThrow(
      "Controlled fixture failure"
    );
    expect(process.env.AIS_PROVIDER_BOUNDARY).toBe("isolated");
  });

  it("refuses production before changing environment or querying storage", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await expect(simulateHandlerTransmission(input)).rejects.toThrow(
      "cannot run in production"
    );
    await expect(
      verifyHandlerStation(
        {} as Parameters<typeof verifyHandlerStation>[0],
        {} as Parameters<typeof verifyHandlerStation>[1],
        1
      )
    ).rejects.toThrow("cannot run in production");
    expect(process.env.AIS_PROVIDER_BOUNDARY).toBe("isolated");
    expect(store.getDb).not.toHaveBeenCalled();
  });

  it("does not promote an undeclared demo into execution", async () => {
    vi.stubEnv("AIS_ENABLE_DEMOS", "false");
    await expect(simulateHandlerTransmission(input)).rejects.toThrow();
    expect(process.env.AIS_PROVIDER_BOUNDARY).toBe("isolated");
    expect(store.getDb).not.toHaveBeenCalled();
  });

  it("refuses a capability that could invoke external transport before storage", async () => {
    vi.spyOn(capability, "getOperationalTransportCapability").mockReturnValue({
      mode: "simulation",
      simulationAvailable: true,
      externalTransmissionAvailable: true,
      productionWorkerAvailable: false,
      authenticatedAcknowledgmentAvailable: false,
      reason: "accepted_transport_adapter_unavailable",
    } as unknown as ReturnType<
      typeof capability.getOperationalTransportCapability
    >);
    await expect(simulateHandlerTransmission(input)).rejects.toThrow();
    expect(process.env.AIS_PROVIDER_BOUNDARY).toBe("isolated");
    expect(store.getDb).not.toHaveBeenCalled();
  });

  it("rejects any receipt claiming an external transmission and restores isolation", async () => {
    vi.spyOn(transmission, "recordTransportResult").mockResolvedValue({
      status: "simulated",
      execution: "simulation",
      externallyTransmitted: true,
    } as unknown as Awaited<
      ReturnType<typeof transmission.recordTransportResult>
    >);
    await expect(simulateHandlerTransmission(input)).rejects.toThrow();
    expect(process.env.AIS_PROVIDER_BOUNDARY).toBe("isolated");
  });
});
