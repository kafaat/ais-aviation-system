import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { ipBlacklist } from "../../../drizzle/schema";
import { authorityRelationalFixture } from "../../__tests__/helpers/authority-relational-fixture";
import { blockedIpAdmission } from "./blocked-ip.middleware";

const mocks = vi.hoisted(() => ({ getDb: vi.fn(), log: vi.fn() }));
vi.mock("../../db", () => ({ getDb: mocks.getDb }));
vi.mock("../logger", () => ({ logger: { error: mocks.log } }));

let fixture: ReturnType<typeof authorityRelationalFixture>;
const servers: Server[] = [];
let directOrigin = "";
let proxyOrigin = "";

async function serve(trustProxy: boolean) {
  const app = express();
  if (trustProxy) app.set("trust proxy", "loopback");
  app.use("/api", blockedIpAdmission);
  // Models the later development limiter bypass: admission already ran.
  app.use("/api", (_req, res) => res.json({ admitted: true }));
  const server = createServer(app);
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
function block(
  ipAddress: string,
  values: Record<string, string | number | null> = {}
) {
  fixture.insert(ipBlacklist, {
    id: 1,
    ipAddress,
    reason: "Controlled admission fixture",
    blockedBy: "test-admin",
    isActive: 1,
    ...values,
  });
}
beforeAll(async () => {
  directOrigin = await serve(false);
  proxyOrigin = await serve(true);
});
beforeEach(() => {
  fixture = authorityRelationalFixture([ipBlacklist]);
  mocks.getDb.mockReset().mockReturnValue(fixture.db);
});
afterEach(() => fixture.sqlite.close());
afterAll(async () => {
  await Promise.all(
    servers.map(
      server =>
        new Promise<void>((resolve, reject) =>
          server.close(error => (error ? reject(error) : resolve()))
        )
    )
  );
});

describe("API IP admission over HTTP with relational SQL fixtures", () => {
  it("allows an unblocked application request", async () => {
    const response = await fetch(`${directOrigin}/api/oauth/start`);
    expect(response.status).toBe(200);
  });

  it("denies an explicit localhost block even in development", async () => {
    block("127.0.0.1");
    const response = await fetch(`${directOrigin}/api/auth/login`);
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "IP_BLOCKED" });
  });

  it.each(["127.0.0.1", "::ffff:127.0.0.1"])(
    "matches IPv4 peer aliases against %s",
    async address => {
      block(address);
      expect((await fetch(`${directOrigin}/api/trpc/auth.me`)).status).toBe(
        403
      );
    }
  );

  it("does not allow spoofed forwarding headers to bypass a direct peer block", async () => {
    block("127.0.0.1");
    expect(
      (
        await fetch(`${directOrigin}/api/rest/bookings`, {
          headers: {
            "x-forwarded-for": "198.51.100.9",
            "x-real-ip": "198.51.100.10",
          },
        })
      ).status
    ).toBe(403);
  });

  it("does not treat an untrusted forwarded address as the client", async () => {
    block("198.51.100.9");
    expect(
      (
        await fetch(`${directOrigin}/api/rest/bookings`, {
          headers: { "x-forwarded-for": "198.51.100.9" },
        })
      ).status
    ).toBe(200);
  });

  it("uses the client address only through an explicitly trusted proxy", async () => {
    block("198.51.100.9");
    expect(
      (
        await fetch(`${proxyOrigin}/api/rest/bookings`, {
          headers: { "x-forwarded-for": "198.51.100.9" },
        })
      ).status
    ).toBe(403);
    expect(
      (
        await fetch(`${proxyOrigin}/api/rest/bookings`, {
          headers: { "x-forwarded-for": "198.51.100.9, 198.51.100.10" },
        })
      ).status
    ).toBe(200);
  });

  it.each<Record<string, string | number | null>>([
    { isActive: 0 },
    { autoUnblockAt: "2000-01-01 00:00:00" },
  ])("allows inactive or expired blocks: %j", async values => {
    block("127.0.0.1", values);
    expect((await fetch(`${directOrigin}/api/rest/bookings`)).status).toBe(200);
  });

  it("keeps a future temporary block enforced", async () => {
    block("127.0.0.1", { autoUnblockAt: "2035-01-01 00:00:00" });
    expect((await fetch(`${directOrigin}/api/rest/bookings`)).status).toBe(403);
  });

  it.each(["missing", "failed"])(
    "fails closed when admission storage is %s",
    async failure => {
      if (failure === "missing") mocks.getDb.mockReturnValue(null);
      else
        mocks.getDb.mockRejectedValue(new Error("Controlled storage failure"));
      const response = await fetch(`${directOrigin}/api/rest/bookings`);
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({
        error: "ADMISSION_UNAVAILABLE",
      });
    }
  );

  it.each([
    "/rest/health/live",
    "/rest/health/ready",
    "/trpc/health.live",
    "/trpc/health.ready",
  ])(
    "preserves the standalone health probe %s during storage failure",
    async path => {
      mocks.getDb.mockRejectedValue(new Error("Controlled storage failure"));
      expect((await fetch(`${directOrigin}/api${path}`)).status).toBe(200);
      expect(mocks.getDb).not.toHaveBeenCalled();
    }
  );

  it.each([
    "/rest/health",
    "/trpc/health.live,auth.me",
    "/rest/health/live/anything",
  ])(
    "does not exempt other operations matching a probe prefix: %s",
    async path => {
      mocks.getDb.mockReturnValue(null);
      expect((await fetch(`${directOrigin}/api${path}`)).status).toBe(503);
    }
  );
});
