// @vitest-environment node
import { initTRPC } from "@trpc/server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { afterEach, expect, it, vi } from "vitest";
import { z } from "zod";
import superjson from "superjson";
import { TRPC_BATCH_LIMIT } from "@shared/const";
import { createBrowserTRPCClient } from "./trpc";

const origin = "https://ais.test";
const procedure = "bookings.baggageEntitlements";
const createdBooking = {
  bookingId: 42,
  bookingReference: "TEST42",
  pnr: "TEST42",
  totalAmount: 50000,
};

function allowance(bookingId: number) {
  return [
    {
      passengerId: bookingId * 10,
      segmentId: bookingId,
      segmentOrder: 1,
      flightId: bookingId + 100,
      totalWeightGrams: bookingId % 2 ? 32000 : 43000,
      maxBagWeightGrams: 32000,
      requiresOperationalReview: false,
      warnings: [],
    },
  ];
}

/** Exercise the configured browser link through tRPC's real HTTP parser,
 * batching and serialization. Only the business resolver is a fixture.
 */
function transportFixture() {
  const calls: number[] = [];
  const requests: Request[] = [];
  const mutations: unknown[] = [];
  const t = initTRPC.create({ transformer: superjson });
  const router = t.router({
    bookings: t.router({
      baggageEntitlements: t.procedure
        .input(z.object({ bookingId: z.number().int().positive() }))
        .query(({ input }) => {
          calls.push(input.bookingId);
          return allowance(input.bookingId);
        }),
      create: t.procedure.input(z.unknown()).mutation(({ input }) => {
        mutations.push(input);
        return createdBooking;
      }),
    }),
  });
  const handle = (req: Request) =>
    fetchRequestHandler({
      endpoint: "/api/trpc",
      req,
      router,
      createContext: () => ({}),
      maxBatchSize: TRPC_BATCH_LIMIT,
    });
  vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
    const req = new Request(
      input instanceof Request ? input : new URL(String(input), origin),
      init
    );
    requests.push(req.clone());
    return handle(req);
  });
  return { calls, requests, mutations, handle };
}

afterEach(() => vi.restoreAllMocks());

it("returns every allowance when 16 concurrent browser queries exceed one server batch", async () => {
  const { calls, requests } = transportFixture();
  const client = createBrowserTRPCClient();
  const bookingIds = Array.from({ length: 16 }, (_, index) => index + 1);

  const results = await Promise.all(
    bookingIds.map(bookingId =>
      client.bookings.baggageEntitlements.query({ bookingId })
    )
  );

  expect(results).toEqual(bookingIds.map(allowance));
  expect(calls.sort((a, b) => a - b)).toEqual(bookingIds);
  expect(
    requests.map(req => new URL(req.url).pathname.split(",").length)
  ).toEqual([10, 6]);
  for (const request of requests) {
    expect(request.credentials).toBe("include");
    expect(request.method).toBe("GET");
    expect(new URL(request.url).searchParams.get("batch")).toBe("1");
  }
});

it("preserves mutation headers, body, credentials and SuperJSON dates", async () => {
  const { mutations, requests } = transportFixture();
  const client = createBrowserTRPCClient();
  const input = {
    flightId: 42,
    cabinClass: "economy" as const,
    sessionId: "transport-regression",
    passengers: [
      {
        type: "adult" as const,
        firstName: "Test",
        lastName: "Passenger",
        dateOfBirth: new Date("2000-01-01T00:00:00Z"),
      },
    ],
  };

  expect(await client.bookings.create.mutate(input)).toEqual(createdBooking);
  expect(mutations).toEqual([input]);
  expect(requests).toHaveLength(1);
  const [request] = requests;
  expect(request.credentials).toBe("include");
  expect(request.method).toBe("POST");
  expect(request.headers.get("content-type")).toBe("application/json");
  expect(await request.json()).toEqual({ 0: superjson.serialize(input) });
});

it("still rejects a direct 11-call request before any procedure executes", async () => {
  const { calls, handle } = transportFixture();
  expect(TRPC_BATCH_LIMIT).toBe(10);
  const ids = Array.from({ length: 11 }, (_, index) => index + 1);
  const params = new URLSearchParams({
    batch: "1",
    input: JSON.stringify(
      Object.fromEntries(
        ids.map((bookingId, index) => [
          index,
          superjson.serialize({ bookingId }),
        ])
      )
    ),
  });
  const req = new Request(
    `${origin}/api/trpc/${ids.map(() => procedure).join(",")}?${params}`
  );

  const response = await handle(req);

  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({
    error: {
      json: {
        message: "Batch call exceeds maximum size",
        data: { code: "BAD_REQUEST", httpStatus: 400 },
      },
    },
  });
  expect(calls).toEqual([]);
});
