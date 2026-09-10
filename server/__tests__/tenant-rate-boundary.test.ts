import { afterEach, describe, expect, it, vi } from "vitest";
import express from "express";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
const m = vi.hoisted(() => ({
  db: null as any,
  rate: vi.fn(),
  connected: vi.fn(),
  select: vi.fn(),
}));
vi.mock("../db", () => ({ getDb: () => m.db }));
vi.mock("../services/flight-status.service", () => ({}));
vi.mock("../services/metrics.service", () => ({}));
vi.mock("../services/audit.service", () => ({}));
vi.mock("../services/cache.service", () => ({
  cacheService: { isConnected: m.connected, checkRateLimit: m.rate },
}));
import { adminRouter } from "../routers/admin";
import {
  rateLimitService,
  RATE_LIMIT_TIERS,
} from "../services/rate-limit.service";
import { publicProcedure, router } from "../_core/trpc";
import { getClientIp } from "../_core/middleware/user-rate-limit.middleware";

afterEach(() => vi.clearAllMocks());
describe("tenant and request boundaries", () => {
  it("scopes airline booking reads and rejects absent tenant context before DB access", async () => {
    const rows = [1, 2].map(id => ({
      id,
      tenantId: id,
      bookingReference: `TEST0${id}`,
      pnr: `PNR00${id}`,
      status: "pending",
      paymentStatus: "pending",
      totalAmount: 10000,
      cabinClass: "economy",
      numberOfPassengers: 1,
      createdAt: new Date(),
      user: { name: "Fixture", email: null },
      flight: {
        flightNumber: "ZX1",
        departureTime: new Date(),
        origin: "ZZZ",
        destination: "ZZY",
      },
    }));
    let selected = rows;
    const chain: any = {
      from: () => chain,
      innerJoin: () => chain,
      orderBy: async () => selected,
      where: (condition: any) => {
        if (condition) {
          const query = new MySqlDialect().sqlToQuery(condition);
          expect(query.sql).toContain("`bookings`.`tenantId` = ?");
          selected = rows.filter(row => row.tenantId === query.params[0]);
        }
        return chain;
      },
    };
    m.select.mockImplementation(() => chain);
    m.db = { select: m.select };
    const caller = (tenantId: number | null, role = "airline_admin") =>
      adminRouter.createCaller({
        user: { id: 7, role, tenantId },
        tenantId,
      } as any);
    expect(await caller(1).getAllBookings()).toEqual([
      (({ tenantId: _tenant, ...dto }) => dto)(rows[0]),
    ]);
    m.select.mockClear();
    await expect(caller(null).getAllBookings()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(m.select).not.toHaveBeenCalled();
    await expect(
      caller(1).updateBookingStatus({ bookingId: 2, status: "confirmed" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    selected = rows;
    expect(await caller(null, "admin").getAllBookings()).toHaveLength(2);
  });
  it("preserves Redis denial at the public rate-limit service boundary", async () => {
    m.connected.mockReturnValue(true);
    m.rate.mockResolvedValue({ allowed: false, remaining: 0 });
    expect(
      await rateLimitService.checkRateLimit("repro", RATE_LIMIT_TIERS.anonymous)
    ).toMatchObject({ allowed: false, remaining: 0, limit: 60 });
  });
  it("limits dotted names and each member of a tRPC batch", async () => {
    m.connected.mockReturnValue(true);
    m.rate.mockResolvedValue({ allowed: false, remaining: 0 });
    const invoked = vi.fn(() => "should not execute");
    const app = express();
    app.use(
      "/api/trpc",
      createExpressMiddleware({
        router: router({
          auth: router({ login: publicProcedure.query(invoked) }),
        }),
        createContext: ({ req, res }) => ({
          req,
          res,
          user: null,
          tenantId: null,
          authMethod: null,
        }),
      })
    );
    const server = app.listen(0, "127.0.0.1");
    await new Promise<void>(resolve => server.once("listening", resolve));
    const base = `http://127.0.0.1:${(server.address() as any).port}/api/trpc/`;
    try {
      expect((await fetch(base + "auth.login")).status).toBe(429);
      const response = await fetch(base + "auth.login,auth.login?batch=1");
      const body = (await response.json()) as any[];
      expect(body).toHaveLength(2);
      expect(
        body.every(item => item.error.json.data.code === "TOO_MANY_REQUESTS")
      ).toBe(true);
      expect(m.rate).toHaveBeenCalledTimes(3);
      expect(invoked).not.toHaveBeenCalled();
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });
  it("does not trust client-supplied forwarding headers", () => {
    expect(
      getClientIp({
        ip: "192.0.2.7",
        headers: {
          "x-forwarded-for": "198.51.100.1",
          "x-real-ip": "198.51.100.2",
        },
        socket: { remoteAddress: "192.0.2.7" },
      } as any)
    ).toBe("192.0.2.7");
  });
});
