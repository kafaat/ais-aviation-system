import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "../_core/context";
import { transactionMemory } from "../__tests__/helpers/transaction-memory";

const boundary = vi.hoisted(() => ({
  getDb: vi.fn(),
  flight: vi.fn(),
  price: vi.fn(),
  reference: 0,
}));
vi.mock("../db", () => ({
  getDb: boundary.getDb,
  getFlightById: boundary.flight,
  generateBookingReference: () =>
    `T${(++boundary.reference).toString().padStart(5, "0")}`,
}));
vi.mock("../services/metrics.service", () => ({
  trackBookingStarted: vi.fn(),
  trackBookingCancelled: vi.fn(),
}));
vi.mock("../services/notification.service", () => ({
  createNotification: vi.fn(),
}));
vi.mock("../services/flights.service", () => ({
  calculateFlightPrice: boundary.price,
  checkFlightAvailability: async (id: number) => ({
    available: true,
    flight: await boundary.flight(id),
  }),
}));
vi.mock("../services/cache.service", () => ({
  cacheService: { isConnected: () => false },
}));

import { router } from "../_core/trpc";
import { agentPortalRouter } from "./agent-portal";
import { assignAgentOwner } from "../services/travel-agent.service";
import { rateLimitService } from "../services/rate-limit.service";
import type { SettlementTx } from "../services/booking-settlement.service";

const api = router({ agentPortal: agentPortalRouter });
let fixture: ReturnType<typeof transactionMemory>;
let requestId = 0;
const search = {
  agencyId: 1,
  originCode: "JED",
  destinationCode: "RUH",
  departureDate: "2030-01-01",
  cabinClass: "economy" as const,
  passengers: 2,
};
const bookingInput = () => ({
  agencyId: 1,
  idempotencyKey: "00000000-0000-4000-8000-000000000001",
  flightId: 11,
  cabinClass: "economy" as const,
  passengers: [
    { type: "adult" as const, firstName: "Synthetic", lastName: "Passenger" },
  ],
  contactEmail: "agency@example.test",
  contactPhone: "+966500000000",
});
function context(
  id: number | null = 1,
  tenantId: number | null = 3
): TrpcContext {
  return {
    req: {
      ip: `198.51.${Math.floor(requestId / 250)}.${++requestId % 250}`,
      headers: {},
    } as TrpcContext["req"],
    res: { setHeader: vi.fn() } as unknown as TrpcContext["res"],
    user:
      id == null
        ? null
        : ({ id, tenantId, role: "user" } as NonNullable<TrpcContext["user"]>),
    tenantId,
    authMethod: id == null ? null : "cookie",
  };
}
function caller(id: number | null = 1, tenantId: number | null = 3) {
  return api.createCaller(context(id, tenantId)).agentPortal;
}

beforeEach(async () => {
  vi.clearAllMocks();
  for (const userId of [1, 2])
    await rateLimitService.resetRateLimit(`user:${userId}`, "strict:booking");
  const flight = {
    tenantId: 3,
    airlineId: 1,
    originId: 1,
    destinationId: 2,
    status: "scheduled",
    economyAvailable: 5,
    businessAvailable: 2,
    economyPrice: 10000,
    businessPrice: 20000,
    departureTime: new Date("2030-01-01T10:00:00Z"),
    arrivalTime: new Date("2030-01-01T12:00:00Z"),
  };
  const agency = {
    ownerUserId: 1,
    isActive: true,
    agencyName: "Owned agency",
    iataNumber: "TEST01",
    email: "agency@example.test",
    phone: "+966500000000",
    apiKey: "PRIVATE_API_KEY",
    apiSecret: "PRIVATE_HASH",
    commissionRate: "5.00",
    dailyBookingLimit: 100,
    monthlyBookingLimit: 1000,
    totalBookings: 0,
    totalRevenue: 0,
    totalCommission: 0,
  };
  fixture = transactionMemory({
    users: [
      { id: 1, tenantId: 3 },
      { id: 2, tenantId: 3 },
      { id: 3, tenantId: 4 },
    ],
    tenants: [
      { id: 3, status: "active" },
      { id: 4, status: "active" },
    ],
    travel_agents: [
      { ...agency, id: 1 },
      { ...agency, id: 2, ownerUserId: 2 },
      { ...agency, id: 3, ownerUserId: null },
      { ...agency, id: 4, isActive: false },
    ],
    airports: [
      { id: 1, code: "JED", city: "Jeddah", timezone: "Asia/Riyadh" },
      { id: 2, code: "RUH", city: "Riyadh", timezone: "Asia/Riyadh" },
    ],
    flights: [
      { ...flight, id: 11, flightNumber: "QA11" },
      { ...flight, id: 12, flightNumber: "FOREIGN", tenantId: 4 },
      { ...flight, id: 13, flightNumber: "CANCEL", status: "cancelled" },
      { ...flight, id: 14, flightNumber: "LOW", economyAvailable: 1 },
      { ...flight, id: 15, flightNumber: "HELD" },
      {
        ...flight,
        id: 16,
        flightNumber: "PAST",
        departureTime: new Date("2020-01-01T10:00:00Z"),
      },
    ],
    inventory_locks: [
      {
        id: 100,
        flightId: 15,
        cabinClass: "economy",
        numberOfSeats: 4,
        status: "active",
        expiresAt: new Date("2031-01-01T00:00:00Z"),
      },
    ],
    bookings: [],
    agent_bookings: [],
    passengers: [],
    account_locks: [],
    account_deletion_requests: [],
  });
  boundary.getDb.mockReturnValue(fixture.db);
  boundary.flight.mockImplementation(async (id: number) =>
    fixture.rows("flights").find(row => row.id === id)
  );
  boundary.price.mockResolvedValue({ price: 10000 });
});

describe("session agency isolation", () => {
  it("lists only active owned agencies and never emits API credentials", async () => {
    expect(await caller().agencies()).toEqual([
      {
        id: 1,
        agencyName: "Owned agency",
        iataNumber: "TEST01",
        contactEmail: "agency@example.test",
        contactPhone: "+966500000000",
      },
    ]);
  });

  it("requires an authenticated account for every portal operation", async () => {
    const anonymous = caller(null, null);
    for (const operation of [
      () => anonymous.agencies(),
      () => anonymous.search(search),
      () => anonymous.dashboard({ agencyId: 1, page: 1 }),
      () => anonymous.createBooking(bookingInput()),
    ])
      await expect(operation()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(boundary.getDb).not.toHaveBeenCalled();
  });

  it.each([2, 3, 4, 999])(
    "rejects foreign, unlinked, inactive or missing agency %s for reads and booking",
    async agencyId => {
      const session = caller();
      await expect(
        session.search({ ...search, agencyId })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(
        session.dashboard({ agencyId, page: 1 })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(
        session.createBooking({ ...bookingInput(), agencyId })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(fixture.rows("bookings")).toHaveLength(0);
    }
  );

  it.each([
    "suspended-tenant",
    "locked-account",
    "stale-tenant",
    "missing-account",
  ])("blocks %s access", async scenario => {
    if (scenario === "suspended-tenant")
      fixture.rows("tenants")[0].status = "suspended";
    if (scenario === "locked-account")
      fixture
        .rows("account_locks")
        .push({ id: 1, userId: 1, isActive: true, autoUnlockAt: null });
    if (scenario === "stale-tenant") fixture.rows("users")[0].tenantId = 4;
    if (scenario === "missing-account") fixture.rows("users").shift();
    await expect(caller().agencies()).rejects.toBeDefined();
    await expect(caller().createBooking(bookingInput())).rejects.toBeDefined();
    expect(fixture.rows("bookings")).toHaveLength(0);
  });

  it("rejects a conflicting session tenant and client owner/credential injection", async () => {
    const ctx = context();
    ctx.tenantId = 4;
    await expect(
      api.createCaller(ctx).agentPortal.agencies()
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      caller().createBooking({
        ...bookingInput(),
        ownerUserId: 2,
        apiKey: "malicious",
      } as ReturnType<typeof bookingInput>)
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(fixture.rows("bookings")).toHaveLength(0);
  });

  it("filters search by tenant, cabin, date/status, full party and outstanding holds", async () => {
    const result = await caller().search(search);
    expect(result.map(row => row.flightNumber)).toEqual(["QA11"]);
    expect(result[0]).toMatchObject({
      availableSeats: 5,
      adultBaseFare: 10000,
      cabinClass: "economy",
      currency: "SAR",
    });
    expect(
      await caller().search({
        ...search,
        cabinClass: "business",
        passengers: 3,
      })
    ).toEqual([]);
  });

  it("honors the origin-local day at midnight and rejects impossible calendar dates", async () => {
    fixture.rows("flights")[0].departureTime = new Date("2029-12-31T21:30:00Z");
    expect(
      (await caller().search(search)).map(row => row.flightNumber)
    ).toEqual(["QA11"]);
    await expect(
      caller().search({ ...search, departureDate: "2030-02-31" })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("keeps legacy NULL-tenant inventory isolated for both search and create", async () => {
    fixture.rows("users")[0].tenantId = null;
    fixture.rows("flights")[0].tenantId = null;
    const session = caller(1, null);
    expect((await session.search(search)).map(row => row.flightNumber)).toEqual(
      ["QA11"]
    );
    await expect(
      session.createBooking({ ...bookingInput(), flightId: 12 })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(fixture.rows("bookings")).toHaveLength(0);
    expect(fixture.rows("agent_bookings")).toHaveLength(0);
  });

  it("intersects agency ledger, current account, tenant, deletion and flight scope before totals", async () => {
    const base = {
      tenantId: 3,
      userId: 1,
      flightId: 11,
      status: "pending",
      paymentStatus: "pending",
      totalAmount: 1000,
      deletedAt: null,
      createdAt: new Date("2029-12-01T00:00:00Z"),
    };
    fixture.rows("bookings").push(
      { ...base, id: 100, bookingReference: "OWN001" },
      { ...base, id: 101, bookingReference: "OTHER1", userId: 2 },
      {
        ...base,
        id: 102,
        bookingReference: "OTHER2",
        tenantId: 4,
        flightId: 12,
      },
      { ...base, id: 103, bookingReference: "OTHER3", flightId: 12 },
      { ...base, id: 104, bookingReference: "DELETE", deletedAt: new Date() },
      { ...base, id: 105, bookingReference: "OTHER4" }
    );
    for (let index = 100; index <= 105; index++)
      fixture.rows("agent_bookings").push({
        bookingId: index,
        agentId: index === 105 ? 2 : 1,
        commissionAmount: 50,
      });
    const result = await caller().dashboard({ agencyId: 1, page: 1 });
    expect(result.bookings.map(row => row.bookingReference)).toEqual([
      "OWN001",
    ]);
    expect(result.stats).toEqual({
      totalBookings: 1,
      pendingBookings: 1,
      confirmedBookings: 0,
      recordedBookingAmount: 1000,
      recordedCommissionAmount: 50,
    });
    fixture.rows("travel_agents")[0].ownerUserId = 2;
    await expect(
      caller().dashboard({ agencyId: 1, page: 1 })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const replacement = await caller(2).dashboard({ agencyId: 1, page: 1 });
    expect(replacement.bookings.map(row => row.bookingReference)).toEqual([
      "OTHER1",
    ]);
    expect(replacement.stats.totalBookings).toBe(1);
  });
});

describe("existing booking authority and owner-race replay", () => {
  it("does not let the replacement owner replay or reuse the previous owner's command", async () => {
    const request = bookingInput();
    const original = await caller().createBooking(request);
    await assignAgentOwner(1, 2, 999);
    await expect(caller().createBooking(request)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(caller(2).createBooking(request)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(fixture.rows("bookings")).toHaveLength(1);
    const replacement = await caller(2).createBooking({
      ...request,
      idempotencyKey: "00000000-0000-4000-8000-000000000002",
    });
    expect(replacement.bookingId).not.toBe(original.bookingId);
    expect(fixture.rows("bookings")[1].userId).toBe(2);
    // The relational double does not apply MySQL timestamp defaults.
    for (const row of fixture.rows("bookings")) row.createdAt = new Date();
    expect(
      (await caller(2).dashboard({ agencyId: 1, page: 1 })).bookings.map(
        row => row.bookingId
      )
    ).toEqual([replacement.bookingId]);
  });

  it("creates one real owner booking/hold/ledger and replays exactly before changed inventory checks", async () => {
    const request = bookingInput();
    const first = await caller().createBooking(request);
    expect(fixture.rows("bookings")[0]).toMatchObject({
      userId: 1,
      tenantId: 3,
      status: "pending",
      paymentStatus: "pending",
    });
    expect(fixture.rows("passengers")[0]).toMatchObject({
      firstName: "Synthetic",
      tenantId: 3,
    });
    fixture.rows("flights")[0].economyAvailable = 0;
    fixture.rows("flights")[0].status = "cancelled";
    fixture.rows("travel_agents")[0].dailyBookingLimit = 0;
    expect(await caller().createBooking(request)).toEqual(first);
    expect(fixture.rows("bookings")).toHaveLength(1);
    expect(fixture.rows("agent_bookings")).toHaveLength(1);
    expect(
      fixture.rows("inventory_locks").filter(row => row.flightId === 11)
    ).toHaveLength(1);
    await expect(
      caller().createBooking({
        ...request,
        passengers: [{ ...request.passengers[0], lastName: "Changed" }],
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(fixture.rows("bookings")).toHaveLength(1);
  });

  it.each(["relinked", "inactive", "locked-account", "suspended-tenant"])(
    "revalidates %s authority before cached replay",
    async scenario => {
      const request = bookingInput();
      await caller().createBooking(request);
      if (scenario === "relinked")
        fixture.rows("travel_agents")[0].ownerUserId = 2;
      if (scenario === "inactive")
        fixture.rows("travel_agents")[0].isActive = false;
      if (scenario === "locked-account")
        fixture
          .rows("account_locks")
          .push({ id: 1, userId: 1, isActive: true, autoUnlockAt: null });
      if (scenario === "suspended-tenant")
        fixture.rows("tenants")[0].status = "suspended";
      await expect(caller().createBooking(request)).rejects.toBeDefined();
      expect(fixture.rows("bookings")).toHaveLength(1);
    }
  );

  it("rejects a real relink interleaved between initial read and the shared command transaction", async () => {
    let release!: () => void;
    let entered!: () => void;
    const ready = new Promise<void>(resolve => {
      entered = resolve;
    });
    const continueBooking = new Promise<void>(resolve => {
      release = resolve;
    });
    const originalTransaction = fixture.db.transaction.bind(fixture.db) as <T>(
      run: (tx: SettlementTx) => Promise<T>
    ) => Promise<T>;
    let firstTransaction = true;
    fixture.db.transaction = async <T>(
      run: (tx: SettlementTx) => Promise<T>
    ) => {
      if (firstTransaction) {
        firstTransaction = false;
        entered();
        await continueBooking;
      }
      return originalTransaction(run);
    };
    const pending = caller().createBooking(bookingInput());
    // Attach the rejection handler before releasing the competing operation.
    const denied = expect(pending).rejects.toMatchObject({ code: "FORBIDDEN" });
    await ready;
    await assignAgentOwner(1, 2, 999);
    release();
    await denied;
    expect(fixture.rows("travel_agents")[0].ownerUserId).toBe(2);
    expect(fixture.rows("bookings")).toHaveLength(0);
    expect(fixture.rows("agent_bookings")).toHaveLength(0);
    const replacement = await caller(2).createBooking({
      ...bookingInput(),
      idempotencyKey: "00000000-0000-4000-8000-000000000002",
    });
    expect(replacement.bookingId).toBeGreaterThan(0);
    expect(fixture.rows("bookings")[0].userId).toBe(2);
    await expect(caller().createBooking(bookingInput())).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("shares one transaction for authorization and idempotency without a nested connection", async () => {
    const transaction = vi.spyOn(fixture.db, "transaction");
    await caller().createBooking(bookingInput());
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(fixture.lockedTables.indexOf("travel_agents")).toBeLessThan(
      fixture.lockedTables.indexOf("idempotency_requests")
    );
  });
});
