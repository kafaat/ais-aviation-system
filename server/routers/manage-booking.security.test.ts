import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { transactionMemory } from "../__tests__/helpers/transaction-memory";
import type { TrpcContext } from "../_core/context";

const boundary = vi.hoisted(() => ({
  getDb: vi.fn(),
  getBookingByPNR: vi.fn(),
}));
vi.mock("../db", () => boundary);
vi.mock("../services/cache.service", () => ({
  cacheService: { isConnected: () => false },
}));
// The account PNR route's real authorization stays in this test. These
// unrelated write-service dependencies are never invoked by the lookup.
vi.mock("../services/bookings.service", () => ({}));
vi.mock("../services/departure-control.service", () => ({}));
vi.mock("../services/audit.service", () => ({}));
vi.mock("../services/notification.service", () => ({}));
vi.mock("../services/baggage-entitlement.service", () => ({}));

import { router } from "../_core/trpc";
import { bookingsRouter } from "./bookings";
import { manageBookingRouter } from "./manage-booking";
import { PUBLIC_BOOKING_LOOKUP_FAILURE } from "../contracts/manage-booking";

const api = router({
  manageBooking: manageBookingRouter,
  bookings: bookingsRouter,
});
let fixture: ReturnType<typeof transactionMemory>;
let sequence = 0;
let reference: string;
let ip: string;

function context(
  user: { id: number; tenantId: number | null } | null = null,
  clientIp = ip
): TrpcContext {
  return {
    req: {
      ip: clientIp,
      socket: { remoteAddress: clientIp },
      headers: {},
    } as TrpcContext["req"],
    res: { setHeader: vi.fn() } as unknown as TrpcContext["res"],
    user: user
      ? ({ ...user, role: "user" } as NonNullable<TrpcContext["user"]>)
      : null,
    tenantId: user?.tenantId ?? null,
    authMethod: user ? "cookie" : null,
  };
}

function input(surname = "García López", bookingReference = reference) {
  return { bookingReference, surname };
}

function lookup(surname?: string, bookingReference?: string, ctx = context()) {
  return api
    .createCaller(ctx)
    .manageBooking.lookup(input(surname, bookingReference));
}

function setTenant(tenantId: number | null) {
  for (const table of ["bookings", "passengers", "flights"])
    for (const row of fixture.rows(table)) row.tenantId = tenantId;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("PUBLIC_BOOKING_TENANT_SLUG", "");
  sequence++;
  reference = `Q${sequence.toString(36).toUpperCase().padStart(5, "0")}`;
  ip = `198.51.100.${sequence}`;
  fixture = transactionMemory({
    tenants: [
      { id: 7, slug: "carrier", status: "active" },
      { id: 8, slug: "other", status: "active" },
    ],
    bookings: [
      {
        id: 50,
        tenantId: null,
        userId: 11,
        flightId: 1,
        bookingReference: reference,
        pnr: "PNR001",
        status: "confirmed",
        deletedAt: null,
        totalAmount: 99900,
        paymentStatus: "paid",
        stripePaymentIntentId: "PRIVATE_PROVIDER_ID",
        email: "private@example.test",
      },
    ],
    passengers: [
      {
        id: 101,
        bookingId: 50,
        tenantId: null,
        firstName: "Private given name",
        lastName: "García  López",
        passportNumber: "PRIVATE_PASSPORT",
      },
      {
        id: 102,
        bookingId: 50,
        tenantId: null,
        firstName: "Other private name",
        lastName: "Another surname",
      },
    ],
    booking_segments: [
      {
        id: 12,
        bookingId: 50,
        segmentOrder: 2,
        flightId: 2,
        status: "confirmed",
      },
      {
        id: 11,
        bookingId: 50,
        segmentOrder: 1,
        flightId: 1,
        status: "confirmed",
      },
    ],
    flights: [
      {
        id: 1,
        tenantId: null,
        flightNumber: "QA101",
        originId: 1,
        destinationId: 2,
        departureTime: new Date("2030-01-01T09:00:00Z"),
        arrivalTime: new Date("2030-01-01T11:00:00Z"),
        status: "scheduled",
        economyPrice: 50000,
      },
      {
        id: 2,
        tenantId: null,
        flightNumber: "QA102",
        originId: 2,
        destinationId: 1,
        departureTime: new Date("2030-01-05T09:00:00Z"),
        arrivalTime: new Date("2030-01-05T11:00:00Z"),
        status: "delayed",
        businessPrice: 90000,
      },
    ],
    airports: [
      { id: 1, code: "JED", city: "Jeddah", timezone: "Asia/Riyadh" },
      { id: 2, code: "RUH", city: "Riyadh", timezone: "Asia/Riyadh" },
    ],
  });
  boundary.getDb.mockReturnValue(fixture.db);
  boundary.getBookingByPNR.mockImplementation(async (pnr: string) =>
    fixture.rows("bookings").find(row => row.pnr === pnr)
  );
});
afterEach(() => vi.unstubAllEnvs());

describe("public booking capability and tenant boundaries", () => {
  it("normalizes case/Unicode/spacing and returns an exact private-field-free projection without writes", async () => {
    const before = structuredClone(fixture.rows("bookings"));
    const ctx = context();
    const result = await lookup(
      "  GARCI\u0301A   LÓPEZ  ",
      ` ${reference.toLowerCase()} `,
      ctx
    );
    expect(result).toEqual({
      bookingReference: reference,
      status: "confirmed",
      itinerary: [
        {
          flightNumber: "QA101",
          departureTime: "2030-01-01T09:00:00.000Z",
          arrivalTime: "2030-01-01T11:00:00.000Z",
          origin: { code: "JED", city: "Jeddah", timezone: "Asia/Riyadh" },
          destination: { code: "RUH", city: "Riyadh", timezone: "Asia/Riyadh" },
          flightStatus: "scheduled",
          segmentStatus: "confirmed",
        },
        {
          flightNumber: "QA102",
          departureTime: "2030-01-05T09:00:00.000Z",
          arrivalTime: "2030-01-05T11:00:00.000Z",
          origin: { code: "RUH", city: "Riyadh", timezone: "Asia/Riyadh" },
          destination: { code: "JED", city: "Jeddah", timezone: "Asia/Riyadh" },
          flightStatus: "delayed",
          segmentStatus: "confirmed",
        },
      ],
    });
    expect(fixture.rows("bookings")).toEqual(before);
    expect(ctx.res.setHeader).toHaveBeenCalledWith(
      "Cache-Control",
      "no-store, private"
    );
  });

  it.each(["Wrong surname", "Garcia Lopez", "García", "López"])(
    "rejects a wrong or partial surname: %s",
    async surname => {
      await expect(lookup(surname)).rejects.toMatchObject({
        code: "NOT_FOUND",
        message: PUBLIC_BOOKING_LOOKUP_FAILURE,
      });
    }
  );

  it.each(["ZZZZZZ", "PNR001"])(
    "does not accept an unknown reference or a PNR alias: %s",
    async code => {
      await expect(lookup(undefined, code)).rejects.toMatchObject({
        code: "NOT_FOUND",
        message: PUBLIC_BOOKING_LOOKUP_FAILURE,
      });
    }
  );

  it("does not confuse another booking's PNR with the submitted reference", async () => {
    fixture.rows("bookings").push({
      ...fixture.rows("bookings")[0],
      id: 60,
      bookingReference: "OTHER1",
      pnr: reference,
    });
    await expect(lookup()).resolves.toMatchObject({
      bookingReference: reference,
    });
  });

  it.each(["deleted", "ambiguous", "no-passengers"])(
    "uses the same failure for %s booking data",
    async scenario => {
      if (scenario === "deleted")
        fixture.rows("bookings")[0].deletedAt = new Date();
      if (scenario === "ambiguous")
        fixture
          .rows("bookings")
          .push({ ...fixture.rows("bookings")[0], id: 60 });
      if (scenario === "no-passengers") fixture.rows("passengers").splice(0);
      await expect(lookup()).rejects.toMatchObject({
        code: "NOT_FOUND",
        message: PUBLIC_BOOKING_LOOKUP_FAILURE,
      });
    }
  );

  it("keeps NULL scope separate from airline bookings", async () => {
    setTenant(7);
    await expect(lookup()).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: PUBLIC_BOOKING_LOOKUP_FAILURE,
    });
  });

  it("permits an active deployment tenant without requiring the booking owner's account", async () => {
    vi.stubEnv("PUBLIC_BOOKING_TENANT_SLUG", " CARRIER ");
    setTenant(7);
    await expect(lookup()).resolves.toMatchObject({
      bookingReference: reference,
    });
    await expect(
      lookup(undefined, undefined, context({ id: 999, tenantId: 7 }))
    ).resolves.toMatchObject({ bookingReference: reference });
  });

  it.each(["missing", "suspended", "pending", "malformed", "ambiguous"])(
    "fails closed for a %s configured tenant",
    async scenario => {
      vi.stubEnv(
        "PUBLIC_BOOKING_TENANT_SLUG",
        scenario === "missing"
          ? "missing"
          : scenario === "malformed"
            ? "carrier/other"
            : "carrier"
      );
      setTenant(7);
      if (scenario === "suspended" || scenario === "pending")
        fixture.rows("tenants")[0].status = scenario;
      if (scenario === "ambiguous")
        fixture
          .rows("tenants")
          .push({ id: 9, slug: "carrier", status: "active" });
      await expect(lookup()).rejects.toMatchObject({
        code: "NOT_FOUND",
        message: PUBLIC_BOOKING_LOOKUP_FAILURE,
      });
    }
  );

  it("does not read a foreign tenant even when reference and surname are valid", async () => {
    vi.stubEnv("PUBLIC_BOOKING_TENANT_SLUG", "carrier");
    setTenant(8);
    await expect(lookup()).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: PUBLIC_BOOKING_LOOKUP_FAILURE,
    });
  });

  it.each([null, 8])(
    "rejects an authenticated foreign-scope account (%s)",
    async tenantId => {
      vi.stubEnv("PUBLIC_BOOKING_TENANT_SLUG", "carrier");
      setTenant(7);
      await expect(
        lookup(undefined, undefined, context({ id: 999, tenantId }))
      ).rejects.toMatchObject({
        code: "NOT_FOUND",
        message: PUBLIC_BOOKING_LOOKUP_FAILURE,
      });
    }
  );

  it("rejects an airline account on the legacy NULL interface", async () => {
    await expect(
      lookup(undefined, undefined, context({ id: 999, tenantId: 7 }))
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: PUBLIC_BOOKING_LOOKUP_FAILURE,
    });
  });

  it.each(["passenger", "flight"])(
    "refuses corrupt cross-tenant %s links",
    async kind => {
      if (kind === "passenger") fixture.rows("passengers")[0].tenantId = 8;
      else fixture.rows("flights")[1].tenantId = 8;
      await expect(lookup()).rejects.toMatchObject({
        code: "NOT_FOUND",
        message: PUBLIC_BOOKING_LOOKUP_FAILURE,
      });
    }
  );

  it("does not allow client-selected tenant IDs or slugs", async () => {
    const caller = api.createCaller(context());
    await expect(
      caller.manageBooking.lookup({
        ...input(),
        tenantId: 7,
        tenantSlug: "carrier",
      } as ReturnType<typeof input>)
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(boundary.getDb).not.toHaveBeenCalled();
  });

  it("supports the legacy direct read without creating a segment", async () => {
    fixture.rows("booking_segments").splice(0);
    const result = await lookup();
    expect(result.itinerary.map(segment => segment.flightNumber)).toEqual([
      "QA101",
    ]);
    expect(fixture.rows("booking_segments")).toEqual([]);
  });

  it("labels historical cancelled sectors explicitly", async () => {
    fixture.rows("booking_segments")[1].status = "cancelled";
    const result = await lookup();
    expect(result.itinerary[0].segmentStatus).toBe("cancelled");
    expect(result.status).toBe("confirmed");
  });

  it("does not turn a successful lookup into access to the account PNR route or cancellation", async () => {
    const caller = api.createCaller(context());
    await expect(caller.manageBooking.lookup(input())).resolves.toBeDefined();
    await expect(
      caller.bookings.getByPNR({ pnr: "PNR001" })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(
      caller.bookings.cancel({ bookingId: 50 })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(boundary.getBookingByPNR).not.toHaveBeenCalled();
    const foreignOwner = api.createCaller(context({ id: 999, tenantId: null }));
    await expect(
      foreignOwner.manageBooking.lookup(input())
    ).resolves.toBeDefined();
    await expect(
      foreignOwner.bookings.getByPNR({ pnr: "PNR001" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("sanitizes storage failures instead of returning SQL/personal details", async () => {
    boundary.getDb.mockReturnValue({
      transaction: () =>
        Promise.reject(new Error("SQL contained PRIVATE_PASSPORT and surname")),
    });
    await expect(lookup()).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
      message: PUBLIC_BOOKING_LOOKUP_FAILURE,
    });
  });
});

describe("transport and strict lookup quotas", () => {
  it("limits a reference across changing IPs, accounts, surname guesses and normalized spelling", async () => {
    for (let attempt = 0; attempt < 5; attempt++)
      await expect(
        lookup(
          `wrong${attempt}`,
          reference,
          context(
            { id: 900 + attempt, tenantId: null },
            `192.0.2.${attempt + 1}`
          )
        )
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    boundary.getDb.mockClear();
    await expect(
      lookup(
        undefined,
        ` ${reference.toLowerCase()} `,
        context(null, "192.0.2.99")
      )
    ).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
    expect(boundary.getDb).not.toHaveBeenCalled();
  });

  it("limits the IP even when reference and authenticated account change", async () => {
    for (let attempt = 0; attempt < 10; attempt++)
      await expect(
        lookup(
          "unknown",
          `X${sequence.toString().padStart(3, "0")}${attempt.toString().padStart(2, "0")}`,
          context({ id: 1000 + attempt, tenantId: null })
        )
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    boundary.getDb.mockClear();
    await expect(lookup()).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
    expect(boundary.getDb).not.toHaveBeenCalled();
  });

  it("accepts body-only POST, rejects GET, and counts each HTTP batch member", async () => {
    const app = express();
    app.use(express.json());
    app.use(
      "/api/trpc",
      createExpressMiddleware({
        router: api,
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
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/trpc/`;
    try {
      expect((await fetch(base + "manageBooking.lookup")).status).toBe(405);
      const response = await fetch(base + "manageBooking.lookup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ json: input() }),
      });
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store, private");
      const batch = Object.fromEntries(
        Array.from({ length: 10 }, (_, index) => [
          index,
          {
            json: input(
              "unknown",
              `B${sequence.toString().padStart(3, "0")}${index.toString().padStart(2, "0")}`
            ),
          },
        ])
      );
      const batchResponse = await fetch(
        base + Array(10).fill("manageBooking.lookup").join(",") + "?batch=1",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(batch),
        }
      );
      const results = (await batchResponse.json()) as Array<{
        error?: { json: { data: { code: string } } };
      }>;
      expect(results).toHaveLength(10);
      expect(
        results.filter(
          result => result.error?.json.data.code === "TOO_MANY_REQUESTS"
        )
      ).toHaveLength(1);
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });
});
