import { DatabaseSync } from "node:sqlite";
import { drizzle } from "drizzle-orm/mysql-proxy";
import { expect, it, vi } from "vitest";
import type { TrpcContext } from "../_core/context";
import { operationsRouter } from "./operations";

const store = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("../db", () => ({ getDb: store.getDb }));

it("pages equal departure times past flight 200 without dropping flights or exposing another tenant", async () => {
  const database = new DatabaseSync(":memory:");
  try {
    database.exec(
      "CREATE TABLE flights (id INTEGER PRIMARY KEY, tenantId INTEGER, flightNumber TEXT, status TEXT, departureTime TEXT, economyAvailable INTEGER, businessAvailable INTEGER)"
    );
    const insert = database.prepare(
      "INSERT INTO flights VALUES (?, ?, ?, 'scheduled', ?, 1, 1)"
    );
    for (let i = 1; i <= 203; i++) {
      insert.run(
        i,
        i === 201 ? 12 : 11,
        "ZZ" + i,
        i === 203 ? "2030-01-02 00:00:00.000" : "2030-01-01 00:00:00.000"
      );
    }
    // Evaluate the actual SELECT produced by the MySQL dialect on local relational rows.
    store.getDb.mockReturnValue(
      drizzle(async (query, params) => ({
        rows: database
          .prepare(query)
          .all(...params)
          .map(row => Object.values(row)),
      }))
    );
    const caller = operationsRouter.createCaller({
      user: { id: 1, role: "ops", tenantId: 11 },
      tenantId: 11,
    } as TrpcContext);
    const first = await caller.airlineFlights();
    expect(first).toHaveLength(200);
    const last = first[199];
    const second = await caller.airlineFlights({
      after: { id: last.id, departureTime: last.departureTime },
      limit: 10,
    });
    expect(second.map(f => f.id)).toEqual([202, 203]);
  } finally {
    database.close();
  }
});
