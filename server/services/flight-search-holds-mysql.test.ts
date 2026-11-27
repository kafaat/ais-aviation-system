import { it, expect, vi } from "vitest";
import { drizzle } from "drizzle-orm/mysql2";
import { searchFlights } from "./flights.service";
import * as db from "../db";
import mysql from "mysql2/promise";
import * as schema from "../../drizzle/schema";

const cache = vi.hoisted(() => ({ data: null as unknown }));
vi.mock("../db", () => ({
  getDb: vi.fn(),
  searchFlights: vi.fn(),
  getFlightLiveState: vi.fn(),
}));
vi.mock("./pricing/dynamic-pricing.service", () => ({
  DynamicPricingService: {},
}));
vi.mock("./redis-cache.service", () => ({
  CacheNamespace: { SEARCH: "search" },
  CacheTTL: { FLIGHT_SEARCH: 120 },
  redisCacheService: {
    captureGeneration: async () => ({ version: 0, epoch: 0 }),
    getCachedFlightSearch: async () => cache.data,
    cacheFlightSearch: async (_key: unknown, rows: unknown) => {
      cache.data = JSON.parse(JSON.stringify(rows));
    },
  },
}));
const airport = {
  code: "XYZ",
  name: "fixture",
  city: "fixture",
  timezone: null,
};
const instant = new Date("2026-11-27T00:00:00Z");
function flight(id: number) {
  return {
    id,
    flightNumber: "AIS" + id,
    departureTime: instant,
    arrivalTime: instant,
    aircraftType: null,
    status: "scheduled" as const,
    economyPrice: 100,
    businessPrice: 200,
    economyAvailable: 10,
    businessAvailable: 5,
    airline: { code: "XX", name: "fixture", logo: null },
    origin: airport,
    destination: airport,
  };
}
const nativeTest = it.skipIf(
  process.env.AIS_DISPOSABLE_DATABASE !== "true" ||
    process.env.NODE_ENV !== "test" ||
    !process.env.DATABASE_URL
);
nativeTest.each(
  [1, 25, 100].flatMap(flights => [0, 2].map(classes => ({ flights, classes })))
)(
  "bounds the SQL reads for $flights flights and $classes classes on both cache paths",
  async ({ flights: n, classes: fareClasses }) => {
    vi.clearAllMocks();
    cache.data = null;
    const rows = Array.from({ length: n }, (_, i) => flight(i + 1));
    vi.mocked(db.searchFlights).mockResolvedValue(rows);
    vi.mocked(db.getFlightLiveState).mockResolvedValue(rows);
    let sqls: string[] = [];
    const url = new URL(process.env.DATABASE_URL!);
    if (
      !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
      !/^\/ais_[a-z0-9_]*test$/.test(url.pathname)
    )
      throw new Error("An isolated loopback AIS test database is required");
    const connection = await mysql.createConnection(url.toString());
    try {
      const tables = [
        "inventory_locks",
        "seat_holds",
        "flight_fare_class_inventory",
        "fare_classes",
      ];
      // LIKE copies physical columns and indexes. Temporary tables keep fixture data in this session.
      for (const table of tables) {
        await connection.query(
          "create temporary table tmp_" + table + " like " + table
        );
        await connection.query(
          "alter table tmp_" + table + " rename to " + table
        );
      }
      for (let i = 1; i <= fareClasses; i++) {
        await connection.execute(
          "insert into fare_classes (id,airlineId,code,name,cabinClass) values (?,1,?,?,'economy')",
          [i, i === 1 ? "Y" : "B", "fixture"]
        );
        await connection.query(
          "insert into flight_fare_class_inventory (flightId,fareClassId,capacity,availableSeats) values ?",
          [rows.map(r => [r.id, i, 10, i === 1 ? 5 : 9])]
        );
      }
      await connection.query(`INSERT INTO inventory_locks (id,flightId,cabinClass,numberOfSeats,fareClassId,sessionId,status,expiresAt) VALUES
    (1,1,'economy',2,1,'class','active',NOW()+INTERVAL 1 DAY),
    (2,1,'economy',1,NULL,'cabin','active',NOW()+INTERVAL 1 DAY),
    (3,1,'economy',20,1,'expired','active',NOW()-INTERVAL 1 DAY),
    (4,1,'economy',20,1,'released','released',NOW()+INTERVAL 1 DAY),
    (5,1,'business',5,NULL,'other-cabin','active',NOW()+INTERVAL 1 DAY)`);
      await connection.query(`INSERT INTO seat_holds (flightId,cabinClass,seats,sessionId,status,expiresAt,inventoryLockId) VALUES
    (1,'economy',2,'linked','active',NOW()+INTERVAL 1 DAY,1),
    (1,'economy',3,'legacy','active',NOW()+INTERVAL 1 DAY,NULL),
    (1,'economy',20,'expired','active',NOW()-INTERVAL 1 DAY,NULL)`);
      const sqlReader = drizzle(connection, {
        schema,
        mode: "default",
        logger: {
          logQuery(sql: string) {
            sqls.push(sql);
          },
        },
      });
      vi.mocked(db.getDb).mockReturnValue(sqlReader);
      for (const cachePath of ["miss", "hit"]) {
        if (cachePath === "hit")
          await connection.query(
            "update inventory_locks set status='released' where id=1"
          );
        sqls = [];
        const result = await searchFlights({
          originId: 1,
          destinationId: 2,
          departureDate: "2026-11-27",
        });
        expect(result).toHaveLength(n);
        expect(result[0].fareClassAvailability?.length ?? 0).toBe(fareClasses);
        if (fareClasses) {
          const byCode = Object.fromEntries(
            result[0].fareClassAvailability!.map(c => [
              c.code,
              c.availableSeats,
            ])
          );
          expect(byCode).toEqual(
            cachePath === "miss" ? { Y: 3, B: 4 } : { Y: 5, B: 6 }
          );
          if (n > 1)
            expect(
              result[1].fareClassAvailability!.map(c => c.availableSeats)
            ).toEqual([9, 5]);
        }
        const holds = sqls.filter(
          q =>
            q.includes("from `inventory_locks`") ||
            q.includes("from `seat_holds`")
        );
        expect(holds).toHaveLength(fareClasses ? 3 : 0);
        expect(sqls).toHaveLength(fareClasses ? 5 : 1);
        expect(db.searchFlights).toHaveBeenCalledTimes(1);
        expect(db.getFlightLiveState).toHaveBeenCalledTimes(
          Number(cachePath === "hit")
        );
        console.log(
          JSON.stringify({
            n,
            fareClasses,
            cachePath,
            holdStatements: holds.length,
            enrichmentStatements: sqls.length,
          })
        );
      }
      if (fareClasses) {
        // A JSON entry written by an older server may still include obsolete buckets.
        const cached = cache.data as Array<Record<string, unknown>>;
        cached[0].fareClassAvailability = [
          {
            fareClassId: 1,
            code: "Y",
            cabinClass: "economy",
            fareFamily: null,
            priority: 0,
            totalAllocated: 10,
            availableSeats: 10,
          },
        ];
        await connection.query("delete from flight_fare_class_inventory");
        const result = await searchFlights({
          originId: 1,
          destinationId: 2,
          departureDate: "2026-11-27",
        });
        expect(result[0]).not.toHaveProperty("fareClassAvailability");
        expect(db.searchFlights).toHaveBeenCalledTimes(1);
      }
    } finally {
      await connection.end();
    }
  }
);
