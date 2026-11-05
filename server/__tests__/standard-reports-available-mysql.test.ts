import { createHash, randomBytes } from "node:crypto";
import { Readable } from "node:stream";
import ExcelJS from "exceljs";
import { getTableName } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import * as schema from "../../drizzle/schema";
import type { TrpcContext } from "../_core/context";
import type {
  StandardReportFilters,
  StandardReportResult,
} from "../../shared/standard-reports";
import {
  opsReportTables,
  seedOpsReportRows,
  type FixtureInsert,
} from "./fixtures/standard-reports-ops.fixture";
import {
  baseFinanceRows,
  financeFixtureTables,
  fixtureInsert,
  fixtureTableDdl,
} from "./helpers/standard-finance-fixture";
import {
  availableReportCases,
  commercialAvailableTables,
  seedCommercialAvailableRows,
  type AvailableReportCase,
} from "./fixtures/standard-reports-available.fixture";

// Only the database binding and clock are controlled: production routers,
// contracts, authorization, readers, native SQL and CSV rendering are unchanged.
const state = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("../db", () => ({ getDb: () => state.db }));
import { standardReportsRouter } from "../routers/standard-reports";
import { getStandardReportDefinitions } from "../services/standard-reports.service";

const allowed =
  process.env.AIS_DISPOSABLE_DATABASE === "true" &&
  process.env.NODE_ENV === "test" &&
  Boolean(process.env.DATABASE_URL);
const nativeDescribe = allowed ? describe.sequential : describe.skip;

afterAll(async () => {
  const { cacheService } = await import("../services/cache.service");
  const { redisCacheService } = await import("../services/redis-cache.service");
  await Promise.all([cacheService.disconnect(), redisCacheService.shutdown()]);
});

it("maps every available report to native golden/API/CSV/tenant and applicable period acceptance", () => {
  const definitions = getStandardReportDefinitions().filter(
    item => item.availability === "available"
  );
  expect(
    availableReportCases.map(item => item.id).sort((a, b) => a - b)
  ).toEqual(definitions.map(item => item.id));
  expect(new Set(availableReportCases.map(item => item.id)).size).toBe(36);
  for (const item of availableReportCases) {
    const definition = definitions.find(entry => entry.id === item.id)!;
    expect(Boolean(item.period), `report ${item.id} period applicability`).toBe(
      definition.filters.includes("startDate")
    );
    expect(
      item.rows.length,
      `report ${item.id} needs positive golden rows`
    ).toBeGreaterThan(0);
    for (const row of item.rows) expect(row).toHaveLength(item.columns.length);
  }
  expect(availableReportCases.filter(item => item.period)).toHaveLength(22);
});

function caller(tenantId = 101, contextTenant = tenantId) {
  return standardReportsRouter.createCaller({
    user: {
      id: 9001 + tenantId,
      openId: `cap-report-${tenantId}`,
      role: "airline_admin",
      tenantId,
    },
    tenantId: contextTenant,
    authMethod: "cookie",
  } as TrpcContext);
}

const project = (result: StandardReportResult, columns: string[]) =>
  result.rows.map(row => columns.map(key => row[key]));

/** Independent CSV parser. Preserve text (including exact decimal rates) instead
 * of comparing the renderer with a second call to the same rendering function. */
async function csvRows(content: string, width: number) {
  const workbook = new ExcelJS.Workbook();
  const sheet = await workbook.csv.read(Readable.from([content]), {
    map: value => value,
  });
  return Array.from({ length: sheet.rowCount }, (_, row) =>
    Array.from({ length: width }, (_, column) => {
      const value = sheet.getCell(row + 1, column + 1).value;
      return value == null ? "" : String(value);
    })
  );
}

async function expectExport(
  item: AvailableReportCase,
  tenantId: number,
  rows: AvailableReportCase["rows"],
  filters = item.filters
) {
  const result = await caller(tenantId).export({
    reportId: item.id,
    filters,
    columns: item.columns,
    format: "csv",
  });
  expect(result.contentType).toBe("text/csv;charset=utf-8");
  expect(result.filename).toBe(`report-${item.id}-2030-01-02.csv`);
  expect(result.recordCount).toBe(rows.length);
  expect(result.checksum).toBe(
    createHash("sha256").update(result.content).digest("hex")
  );
  const parsed = await csvRows(result.content, item.columns.length);
  expect(parsed).toHaveLength(rows.length + 1);
  expect(parsed[0].every(label => label.length > 0)).toBe(true);
  expect(parsed.slice(1)).toEqual(
    rows.map(row => row.map(value => (value === null ? "" : String(value))))
  );
}

nativeDescribe(
  "CAP-01 available report acceptance on isolated native MySQL",
  () => {
    let admin: mysql.Connection | undefined;
    const connections = new Map<"operations" | "money", mysql.Connection>();
    const databases: string[] = [];
    const dbs = new Map<
      "operations" | "money",
      ReturnType<typeof drizzle<typeof schema>>
    >();
    const key = (item: AvailableReportCase) =>
      item.family === "operations" ? "operations" : "money";

    beforeAll(async () => {
      const url = new URL(process.env.DATABASE_URL!);
      if (
        !url.pathname.endsWith("_test") ||
        !["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname)
      )
        throw new Error(
          "CAP acceptance requires a loopback disposable _test database"
        );
      const options = {
        host: url.hostname,
        port: Number(url.port || 3306),
        user: decodeURIComponent(url.username),
        password: decodeURIComponent(url.password),
        timezone: "Z",
      };
      admin = await mysql.createConnection(options);
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2030-01-02T12:00:00Z"));
      for (const family of ["operations", "money"] as const) {
        const name = `ais_cap_${randomBytes(6).toString("hex")}_${family}_test`;
        expect(name).toMatch(/^ais_cap_[0-9a-f]{12}_(operations|money)_test$/);
        await admin.query(`CREATE DATABASE \`${name}\``);
        databases.push(name);
        const connection = await mysql.createConnection({
          ...options,
          database: name,
        });
        connections.set(family, connection);
        await connection.query("SET SESSION time_zone = '+00:00'");
        const [mode] = await connection.query<mysql.RowDataPacket[]>(
          "SELECT @@SESSION.sql_mode AS sqlMode"
        );
        expect(String(mode[0].sqlMode)).toContain("ONLY_FULL_GROUP_BY");
        expect(String(mode[0].sqlMode)).toContain("STRICT_TRANS_TABLES");
        // Read fixtures retain native MySQL column/JSON/timestamp types. Constraint
        // and migration acceptance are owned by the existing migration gates.
        const tables =
          family === "operations"
            ? opsReportTables
            : [...financeFixtureTables, ...commercialAvailableTables];
        for (const table of tables)
          await connection.query(fixtureTableDdl(table, true));
        const insert: FixtureInsert = async (table, values) => {
          const row = fixtureInsert(table, values);
          await connection.execute(row.sql, row.params);
        };
        if (family === "operations") await seedOpsReportRows(insert);
        else {
          for (const [table, values] of baseFinanceRows)
            await insert(table, values);
          await seedCommercialAvailableRows(insert);
          await connection.execute(
            "UPDATE bookings SET createdAt='2032-01-01 00:00:00' WHERE id=2"
          );
        }
        dbs.set(family, drizzle(connection, { schema, mode: "default" }));
        const [tablesPresent] = await connection.query<mysql.RowDataPacket[]>(
          "SELECT COUNT(*) AS total FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()"
        );
        expect(Number(tablesPresent[0].total)).toBe(
          new Set(tables.map(getTableName)).size
        );
      }
    }, 30000);

    afterAll(async () => {
      state.db = null;
      vi.useRealTimers();
      try {
        for (const connection of connections.values()) await connection.end();
      } finally {
        if (admin) {
          try {
            for (const name of databases)
              await admin.query(`DROP DATABASE \`${name}\``);
            if (databases.length) {
              const [remaining] = await admin.query<mysql.RowDataPacket[]>(
                `SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME IN (${databases.map(() => "?").join(",")})`,
                databases
              );
              expect(remaining).toEqual([]);
              console.info("CAP native fixture cleanup", {
                databasesDropped: databases,
                connectionsClosed: connections.size,
              });
            }
          } finally {
            await admin.end();
          }
        }
      }
    });

    for (const item of [...availableReportCases].sort((a, b) => a.id - b.id)) {
      describe(`report ${item.id} (${item.family})`, () => {
        beforeAll(async () => {
          state.db = dbs.get(key(item));
          if (item.arrange)
            await connections.get(key(item))!.query(item.arrange);
        });
        beforeEach(() => {
          state.db = dbs.get(key(item));
        });
        afterAll(async () => {
          if (item.restore && connections.has(key(item)))
            await connections.get(key(item))!.query(item.restore);
        });

        it("returns the independent golden identities/quantities through API and CSV", async () => {
          const result = await caller().run({
            reportId: item.id,
            filters: item.filters,
          });
          expect(result.reportId).toBe(item.id);
          expect(result.total).toBe(item.rows.length);
          expect(project(result, item.columns)).toEqual(item.rows);
          expect(JSON.stringify(result)).not.toMatch(
            /DO-NOT-LEAK|WrongBookingTenant|WrongPassengerTenant/
          );
          await expectExport(item, 101, item.rows);
        });

        it("binds API and CSV to the authenticated tenant and preserves deliberate shared currency scope", async () => {
          const input = { reportId: item.id, filters: item.filters };
          await expect(caller(101, 202).run(input)).rejects.toMatchObject({
            code: "FORBIDDEN",
          });
          await expect(
            caller(101, 202).export({ ...input, format: "csv" })
          ).rejects.toMatchObject({ code: "FORBIDDEN" });
          if (item.family === "operations") {
            await expect(caller(202).run(input)).rejects.toMatchObject({
              code: "NOT_FOUND",
            });
            await expect(
              caller(202).export({ ...input, format: "csv" })
            ).rejects.toMatchObject({ code: "NOT_FOUND" });
          } else {
            const filters = item.foreignFilters ?? item.filters;
            const expected = item.sharedAcrossTenants
              ? item.rows
              : item.foreignRows!;
            const result = await caller(202).run({
              reportId: item.id,
              filters,
            });
            expect(result.total).toBe(expected.length);
            expect(project(result, item.columns)).toEqual(expected);
            await expectExport(item, 202, expected, filters);
            if (item.sharedAcrossTenants)
              expect(result.notes.join(" ")).toContain(
                "shared across the platform"
              );
          }
        });

        it(
          item.period
            ? "includes both UTC day endpoints and excludes adjacent instants in API and CSV"
            : "rejects unsupported period filters in API and CSV",
          async () => {
            if (!item.period) {
              const input = {
                reportId: item.id,
                filters: { ...item.filters, startDate: "2030-01-02" },
              };
              await expect(caller().run(input)).rejects.toMatchObject({
                code: "BAD_REQUEST",
              });
              await expect(
                caller().export({ ...input, format: "csv" })
              ).rejects.toMatchObject({ code: "BAD_REQUEST" });
              return;
            }
            const p = item.period;
            const connection = connections.get(key(item))!;
            const filters: StandardReportFilters = { ...item.filters };
            if (item.family === "operations") delete filters.flightId;
            const start = new Date(p.day + "T00:00:00Z");
            const end = new Date(start.getTime() + (p.days ?? 1) * 86400000);
            const [original] = await connection.query<mysql.RowDataPacket[]>(
              `SELECT \`${p.column}\` AS original${p.table === "flights" ? ", arrivalTime" : ""} FROM \`${p.table}\` WHERE id = ?`,
              [p.id]
            );
            expect(original).toHaveLength(1);
            expect((original[0].original as Date).toISOString()).toBe(
              new Date(p.original.replace(" ", "T") + "Z").toISOString()
            );
            try {
              for (const [at, included] of [
                [start, true],
                [new Date(end.getTime() - 1000), true],
                [new Date(start.getTime() - 1000), false],
                [end, false],
              ] as const) {
                const updates =
                  p.table === "flights"
                    ? [at, new Date(at.getTime() + 2 * 3600000), p.id]
                    : [at, p.id];
                await connection.execute(
                  `UPDATE \`${p.table}\` SET \`${p.column}\` = ?${p.table === "flights" ? ", arrivalTime = ?" : ""} WHERE id = ?`,
                  updates
                );
                const input = { reportId: item.id, filters };
                const result = await caller().run(input);
                const count = result.rows.filter(
                  row => row[p.rowKey] === p.id
                ).length;
                expect(count, `${at.toISOString()} membership`).toBe(
                  included ? p.targetRows : 0
                );
                if (item.family === "operations")
                  expect(result.rows.some(row => row.flightId === 3)).toBe(
                    false
                  );
                const exported = await caller().export({
                  ...input,
                  columns: [p.rowKey],
                  format: "csv",
                });
                const parsed = (await csvRows(exported.content, 1)).slice(1);
                expect(
                  parsed.filter(row => row[0] === String(p.id))
                ).toHaveLength(included ? p.targetRows : 0);
                expect(exported.recordCount).toBe(result.total);
              }
            } finally {
              const values =
                p.table === "flights"
                  ? [original[0].original, original[0].arrivalTime, p.id]
                  : [original[0].original, p.id];
              await connection.execute(
                `UPDATE \`${p.table}\` SET \`${p.column}\` = ?${p.table === "flights" ? ", arrivalTime = ?" : ""} WHERE id = ?`,
                values
              );
            }
          }
        );
      });
    }
  }
);
