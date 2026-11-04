import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as db from "../db";
import { searchFlights } from "./flights.service";
import { redisCacheService } from "./redis-cache.service";

// Stateful Redis boundary: the real cache keys, generations, JSON codec and
// flight service execute. No Redis server or database connection is created.
const redis = vi.hoisted(() => ({
  entries: new Map<string, string>(),
  listeners: new Map<string, Array<() => void>>(),
  ttl: undefined as (() => Promise<number>) | undefined,
}));

vi.mock("ioredis", () => ({
  default: class {
    on(event: string, listener: () => void) {
      const listeners = redis.listeners.get(event) ?? [];
      listeners.push(listener);
      redis.listeners.set(event, listeners);
      return this;
    }

    async connect() {
      for (const listener of redis.listeners.get("ready") ?? []) listener();
    }

    async get(key: string) {
      return redis.entries.get(key) ?? null;
    }

    async setex(key: string, _ttl: number, value: string) {
      redis.entries.set(key, value);
      return "OK";
    }

    async set(key: string, value: string, condition: "NX") {
      if (condition === "NX" && redis.entries.has(key)) return null;
      redis.entries.set(key, value);
      return "OK";
    }

    async incr(key: string) {
      const next = Number(redis.entries.get(key) ?? 0) + 1;
      redis.entries.set(key, String(next));
      return next;
    }

    async ttl() {
      return redis.ttl ? redis.ttl() : 120;
    }

    async quit() {
      return "OK";
    }
  },
}));
vi.mock("../_core/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../db", () => ({
  getDb: vi.fn(async () => null),
  searchFlights: vi.fn(),
  getFlightLiveState: vi.fn(),
}));
vi.mock("./pricing/dynamic-pricing.service", () => ({
  DynamicPricingService: {},
}));

type SearchRow = Awaited<ReturnType<typeof db.searchFlights>>[number];

function flight(id: number): SearchRow {
  return {
    id,
    flightNumber: `ZX${id}`,
    departureTime: new Date("2030-01-01T12:00:00.000Z"),
    arrivalTime: new Date("2030-01-01T14:00:00.000Z"),
    aircraftType: "B737",
    status: "scheduled",
    economyPrice: 10000,
    businessPrice: 20000,
    economyAvailable: 10,
    businessAvailable: 2,
    airline: { code: "ZX", name: "Synthetic", logo: null },
    origin: {
      code: "RUH",
      name: "Origin",
      city: "Riyadh",
      timezone: "Asia/Riyadh",
    },
    destination: {
      code: "JED",
      name: "Destination",
      city: "Jeddah",
      timezone: "Asia/Riyadh",
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(accept => {
    resolve = accept;
  });
  return { promise, resolve };
}

function emit(event: string) {
  for (const listener of redis.listeners.get(event) ?? []) listener();
}

let originId = 100;
let input: Parameters<typeof searchFlights>[0];
const beforeInsert = [flight(701)];
const afterInsert = [...beforeInsert, flight(702)];

beforeEach(() => {
  vi.clearAllMocks();
  redis.entries.clear();
  redis.ttl = undefined;
  emit("ready");
  // Distinct cache identity avoids relying on a reset of the real memory cache.
  input = {
    originId: ++originId,
    destinationId: 2,
    departureDate: "2030-01-01",
  };
  vi.mocked(db.searchFlights).mockReset().mockResolvedValue(afterInsert);
  vi.mocked(db.getFlightLiveState).mockImplementation(async ids =>
    ids.map(id => ({
      id,
      status: "scheduled" as const,
      economyAvailable: 10,
      businessAvailable: 2,
    }))
  );
});

afterAll(() => redisCacheService.shutdown());

function pauseOldRead() {
  const started = deferred<void>();
  const result = deferred<SearchRow[]>();
  vi.mocked(db.searchFlights).mockImplementationOnce(() => {
    started.resolve();
    return result.promise;
  });
  return {
    started: started.promise,
    complete: () => result.resolve(beforeInsert),
  };
}

describe("flight search cache generations", () => {
  it("does not publish a pre-invalidation query into a newer Redis generation", async () => {
    redis.entries.set("ais:version:search", "7");
    const source = pauseOldRead();
    const oldRequest = searchFlights(input);
    await source.started;

    // Another process commits a flight and INCRs the namespace, as the E2E
    // fixture does. This does not call this instance's invalidation method.
    redis.entries.set("ais:version:search", "8");
    source.complete();
    expect((await oldRequest).map(row => row.id)).toEqual([701]);

    const fresh = await searchFlights(input);
    expect(fresh.map(row => row.id)).toEqual([701, 702]);
    expect(db.searchFlights).toHaveBeenCalledTimes(2);
    const warm = await searchFlights(input);
    expect(warm).toEqual(fresh);
    expect(warm[1].departureTime).toBeInstanceOf(Date);
    expect(db.searchFlights).toHaveBeenCalledTimes(2);
  });

  it("invalidates a legacy v1 entry when the first Redis version key is absent", async () => {
    const namespace = "first-generation-regression";
    const params = { id: 1 };
    await redisCacheService.set(namespace, params, "before invalidation", 120);
    expect(await redisCacheService.get(namespace, params)).toBe(
      "before invalidation"
    );
    expect(redis.entries.has(`ais:version:${namespace}`)).toBe(false);
    expect(
      [...redis.entries.keys()].some(key =>
        key.startsWith(`ais:${namespace}:v1:`)
      )
    ).toBe(true);

    await redisCacheService.invalidateNamespace(namespace);

    expect(await redisCacheService.get(namespace, params)).toBeNull();
  });

  it("does not refill invalidated memory fallback from a pending database read", async () => {
    emit("close");
    const source = pauseOldRead();
    const oldRequest = searchFlights(input);
    await source.started;

    await redisCacheService.invalidateFlightSearchCache();
    source.complete();
    await oldRequest;

    expect((await searchFlights(input)).map(row => row.id)).toEqual([701, 702]);
    expect(db.searchFlights).toHaveBeenCalledTimes(2);
    expect(redis.entries.size).toBe(0);
  });

  it("does not overwrite a current Redis fill with a read begun during memory fallback", async () => {
    emit("close");
    const source = pauseOldRead();
    const oldRequest = searchFlights(input);
    await source.started;

    emit("ready");
    expect((await searchFlights(input)).map(row => row.id)).toEqual([701, 702]);
    source.complete();
    await oldRequest;

    expect((await searchFlights(input)).map(row => row.id)).toEqual([701, 702]);
    expect(db.searchFlights).toHaveBeenCalledTimes(2);
  });

  it("does not promote an outstanding Redis read after fallback invalidation", async () => {
    const namespace = "read-through-generation-regression";
    const params = { id: 1 };
    await redisCacheService.set(namespace, params, "old record", 120);
    const started = deferred<void>();
    const ttl = deferred<number>();
    redis.ttl = () => {
      started.resolve();
      return ttl.promise;
    };
    const oldRead = redisCacheService.get(namespace, params);
    await started.promise;

    emit("close");
    await redisCacheService.invalidateNamespace(namespace);
    ttl.resolve(120);

    expect(await oldRead).toBeNull();
    expect(await redisCacheService.get(namespace, params)).toBeNull();
  });

  it("does not resurrect an older fallback entry after a Redis reconnect cycle", async () => {
    const namespace = "reconnect-generation-regression";
    const params = { id: 1 };
    emit("close");
    await redisCacheService.set(namespace, params, "old memory record", 120);
    emit("ready");
    redis.entries.set(`ais:version:${namespace}`, "10");
    await redisCacheService.set(namespace, params, "current Redis record", 120);
    expect(await redisCacheService.get(namespace, params)).toBe(
      "current Redis record"
    );

    emit("close");

    expect(await redisCacheService.get(namespace, params)).toBeNull();
  });

  it("retains a normal Redis cache hit and restores both date values", async () => {
    const cold = await searchFlights(input);
    const warm = await searchFlights(input);
    expect(warm).toEqual(cold);
    for (const row of warm) {
      expect(row.departureTime).toBeInstanceOf(Date);
      expect(row.arrivalTime).toBeInstanceOf(Date);
    }
    expect(db.searchFlights).toHaveBeenCalledOnce();
  });
});
