import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  it,
  vi,
} from "vitest";
import express from "express";
import type { Server } from "node:http";
const state = vi.hoisted(() => ({
  role: null as string | null,
  consume: vi.fn(),
  read: vi.fn(),
}));
vi.mock("../_core/context", () => ({
  createContext: async () => ({
    user: state.role ? { id: 1, role: state.role } : null,
  }),
}));
vi.mock("../services/event-inbox.service", () => ({
  consumeLocalEvent: state.consume,
}));
vi.mock("../services/data-warehouse.service", () => ({
  readExportContent: state.read,
}));
import { operationalIntegrations } from "../routes/operational-integrations";
let server: Server;
let base: string;
const token = "ci-synthetic-inbox-authentication-secret";
const event = {
  eventId: "c4412d7c-a1d9-4cc0-bb0b-205bdc52c413",
  eventType: "booking.created",
  aggregateType: "booking",
  aggregateId: "1",
  tenantId: 1,
  payload: { bookingId: 1 },
};
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api", operationalIntegrations);
  await new Promise<void>(resolve => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Listener unavailable");
  base = `http://127.0.0.1:${address.port}/api`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) =>
    server.close(error => (error ? reject(error) : resolve()))
  );
});
beforeEach(() => {
  state.role = null;
  vi.clearAllMocks();
  vi.stubEnv("OUTBOX_PUBLISH_TOKEN", token);
  state.consume.mockResolvedValue({ duplicate: false });
  state.read.mockResolvedValue({
    format: "json",
    content: "[]",
    checksum: "a".repeat(64),
  });
});
afterEach(() => vi.unstubAllEnvs());
const send = (
  authorization?: string,
  identity = event.eventId,
  body: unknown = event
) =>
  fetch(`${base}/events/inbox`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": identity,
      ...(authorization ? { authorization } : {}),
    },
    body: JSON.stringify(body),
  });
it("rejects unauthenticated, wrong-token, and mismatched-identity events before consumption", async () => {
  expect((await send()).status).toBe(401);
  expect((await send("Bearer wrong")).status).toBe(401);
  expect((await send(`Bearer ${token}`, "different")).status).toBe(400);
  expect(state.consume).not.toHaveBeenCalled();
});
it("validates the authenticated receiver schema and acknowledges a durable receipt", async () => {
  expect(
    (await send(`Bearer ${token}`, event.eventId, { ...event, payload: [] }))
      .status
  ).toBe(400);
  const response = await send(`Bearer ${token}`);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ accepted: true, duplicate: false });
  expect(state.consume).toHaveBeenCalledExactlyOnceWith(event);
});
it("restricts saved export bytes to platform administrators and returns the integrity header", async () => {
  expect((await fetch(`${base}/data-warehouse/download/1`)).status).toBe(403);
  state.role = "airline_admin";
  expect((await fetch(`${base}/data-warehouse/download/1`)).status).toBe(403);
  expect(state.read).not.toHaveBeenCalled();
  state.role = "admin";
  const response = await fetch(`${base}/data-warehouse/download/1`);
  expect(await response.text()).toBe("[]");
  expect(response.headers.get("x-content-sha256")).toBe("a".repeat(64));
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(state.read).toHaveBeenCalledExactlyOnceWith(1);
});
