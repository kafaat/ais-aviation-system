import { randomBytes } from "node:crypto";
import { getTableColumns, getTableName } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as schema from "../../drizzle/schema";
import {
  opsReportTables,
  seedOpsReportRows,
} from "./fixtures/standard-reports-ops.fixture";

const state = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("../db", () => ({ getDb: () => state.db }));
import {
  getOperationsStandardReport,
  operationsReportDefinitions,
} from "../services/standard-reports-ops.service";

const allowed =
  process.env.AIS_DISPOSABLE_DATABASE === "true" &&
  process.env.NODE_ENV === "test" &&
  Boolean(process.env.DATABASE_URL);
const nativeDescribe = allowed ? describe : describe.skip;

nativeDescribe("standard operational reports on isolated native MySQL", () => {
  let admin: mysql.Connection | null = null;
  let connection: mysql.Connection | null = null;
  let databaseName = "";
  const scope = { tenantId: 101, userId: 701 };

  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? "");
    if (
      !url.pathname.endsWith("_test") ||
      !["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname)
    ) {
      throw new Error(
        "Native operational report fixtures require a loopback disposable _test database"
      );
    }
    const options = {
      host: url.hostname,
      port: Number(url.port || 3306),
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      timezone: "Z",
    };
    databaseName = "ais_ops_reports_" + randomBytes(6).toString("hex");
    if (!/^ais_ops_reports_[0-9a-f]{12}$/.test(databaseName))
      throw new Error("Invalid fixture database identity");
    admin = await mysql.createConnection(options);
    await admin.query("CREATE DATABASE " + databaseName);
    connection = await mysql.createConnection({
      ...options,
      database: databaseName,
    });
    await connection.query("SET SESSION time_zone = '+00:00'");
    const [mode] = await connection.query<mysql.RowDataPacket[]>(
      "SELECT @@SESSION.sql_mode AS sqlMode"
    );
    expect(String(mode[0]?.sqlMode)).toContain("ONLY_FULL_GROUP_BY");
    // Real MySQL column types and production Drizzle SELECTs. Full migration
    // catalog/replay gates independently verify schema constraints and indexes.
    for (const table of opsReportTables) {
      await connection.query(
        `CREATE TABLE \`${getTableName(table)}\` (${Object.values(
          getTableColumns(table)
        )
          .map(
            column =>
              `\`${column.name}\` ${column.getSQLType()}${column.name === "id" ? " PRIMARY KEY" : " NULL"}`
          )
          .join(",")})`
      );
    }
    await seedOpsReportRows(async (table, values) => {
      if (!connection) throw new Error("Fixture connection is unavailable");
      const columns = Object.keys(values);
      await connection.execute(
        `INSERT INTO \`${getTableName(table)}\` (${columns.map(column => `\`${column}\``).join(",")}) VALUES (${columns.map(() => "?").join(",")})`,
        Object.values(values)
      );
    });
    state.db = drizzle(connection, { schema, mode: "default" });
  }, 30000);

  afterAll(async () => {
    state.db = null;
    if (connection) await connection.end();
    if (admin) {
      try {
        if (databaseName) await admin.query("DROP DATABASE " + databaseName);
      } finally {
        await admin.end();
      }
    }
  });

  it("runs every executable catalog entry under native strict SQL mode", async () => {
    for (const definition of operationsReportDefinitions.filter(
      report => report.availability !== "blocked"
    )) {
      const filters =
        definition.filters.length === 1
          ? { flightId: 1 }
          : { startDate: "2030-01-02", origin: "RUH" };
      const result = await getOperationsStandardReport(
        definition.id,
        filters,
        scope
      );
      expect(result, `${definition.id} ${definition.title}`).toBeDefined();
      expect(result?.columns.length).toBeGreaterThan(0);
    }
  });

  it("preserves exact UTC midnight boundaries and sector membership on TIMESTAMP columns", async () => {
    const day = await getOperationsStandardReport(
      15,
      { startDate: "2030-01-02" },
      scope
    );
    expect(day?.rows.map(row => row.flightId)).toEqual([1]);
    expect(day?.rows[0]).toMatchObject({
      economyHeld: 5,
      businessHeld: 2,
      economyAvailable: 0,
      sold: 4,
    });
    const moved = await getOperationsStandardReport(
      72,
      { startDate: "2030-01-03", endDate: "2030-01-03" },
      scope
    );
    expect(
      moved?.rows.map(row => [row.bookingId, row.passengerId, row.flightId])
    ).toEqual([[11, 110, 2]]);
    await expect(
      getOperationsStandardReport(17, { flightId: 3 }, scope)
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("reconciles per-passenger coupons, baggage, DCS counts and incomplete document identity without cross-tenant data", async () => {
    const manifest = await getOperationsStandardReport(
      17,
      { flightId: 1 },
      scope
    );
    expect(manifest?.rows).toHaveLength(2);
    expect(manifest?.rows[0]).toMatchObject({
      ticketNumber: "1000000000100",
      couponNumber: 1,
      couponStatus: "O",
      baggagePieces: 1,
      baggageWeightKg: 10.5,
    });
    expect(manifest?.rows[1]).toMatchObject({
      passengerId: 101,
      seatNumber: "12A",
      baggageTags: "BAGLEGACY03",
    });
    const counts = await getOperationsStandardReport(
      5,
      { startDate: "2030-01-02" },
      scope
    );
    expect(counts?.rows[0]).toMatchObject({
      confirmedPassengers: 2,
      bookedPassengers: 3,
      ticketedPassengers: 2,
      offloadedPassengers: 1,
      noShowPassengers: null,
    });
    const documents = await getOperationsStandardReport(
      2,
      { flightId: 1 },
      scope
    );
    expect(documents?.rows[1]).toMatchObject({
      documentNumber: "LEGACY101",
      verificationStatus: "legacy_unverified",
    });
    expect(JSON.stringify(documents)).not.toContain("DO-NOT-LEAK");
  });
});
