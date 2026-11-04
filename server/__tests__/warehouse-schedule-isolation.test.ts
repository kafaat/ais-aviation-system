import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { getTableName, type SQL } from "drizzle-orm";
import { transactionMemory } from "./helpers/transaction-memory";

const state = vi.hoisted(() => ({ db: null as unknown, days: vi.fn() }));
vi.mock("../db", () => ({ getDb: () => state.db }));
vi.mock("../services/financial-reporting.service", () => ({
  getFinancialDays: state.days,
}));
vi.mock("../services/lineage.service", () => ({
  emitLineageEvent: vi.fn(),
  exportRunId: (id: number) => `export-${id}`,
}));
import { processScheduledExports } from "../services/data-warehouse.service";

const now = new Date("2026-11-04T12:00:00Z");
const due = new Date("2026-11-04T11:00:00Z");
const previous = new Date("2026-11-03T11:00:00Z");
let fixture: ReturnType<typeof transactionMemory>;

function schedule(id: number, createdBy: number, extra = {}) {
  return {
    id,
    createdBy,
    name: `Export ${id}`,
    exportType: "revenue",
    format: "csv",
    frequency: "daily",
    isActive: true,
    lastRunAt: previous,
    nextRunAt: due,
    createdAt: new Date(now.getTime() - id * 1000),
    config: {},
    ...extra,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  state.days.mockReset().mockResolvedValue([]);
  fixture = transactionMemory({
    users: [
      { id: 1, role: "admin" },
      { id: 2, role: "user" },
    ],
    warehouse_schedules: [],
  });
  // The shared relational double handles scalar predicates, but not timestamp
  // equality. Model the scheduler's compare-and-set on id + due timestamp here.
  const update = fixture.db.update;
  fixture.db.update = (table: Parameters<typeof getTableName>[0]) => {
    if (getTableName(table) !== "warehouse_schedules") return update(table);
    return {
      set: (values: Record<string, unknown>) => ({
        where: async (predicate: SQL) => {
          const query = new MySqlDialect().sqlToQuery(predicate);
          const [id, expectedDue] = query.params;
          const row = fixture
            .rows("warehouse_schedules")
            .find(
              item =>
                item.id === id &&
                item.nextRunAt.getTime() ===
                  new Date(
                    String(expectedDue).replace(" ", "T") + "Z"
                  ).getTime()
            );
          if (row) Object.assign(row, values);
          return [{ affectedRows: row ? 1 : 0 }];
        },
      }),
    };
  };
  state.db = fixture.db;
});
afterEach(() => vi.useRealTimers());

it("executes later healthy schedules after an owner loses administrator access", async () => {
  fixture.rows("warehouse_schedules").push(schedule(1, 2), schedule(2, 1));
  await expect(processScheduledExports()).rejects.toThrow("schedule IDs: 1");
  expect(state.days).toHaveBeenCalledTimes(1);
  expect(fixture.rows("warehouse_exports")).toHaveLength(1);
  expect(fixture.rows("warehouse_exports")[0]).toMatchObject({
    status: "completed",
    createdBy: 1,
  });
  const [failed, healthy] = fixture.rows("warehouse_schedules");
  expect(failed.nextRunAt).toEqual(due);
  expect(failed.lastRunAt).toEqual(previous);
  expect(healthy.lastRunAt).toEqual(now);
  expect(healthy.nextRunAt.getTime()).toBeGreaterThan(now.getTime());
});

it("awaits healthy jobs after an export failure and retries only the failed due job", async () => {
  fixture
    .rows("warehouse_schedules")
    .push(
      schedule(1, 1),
      schedule(2, 1),
      schedule(3, 1, { nextRunAt: new Date(now.getTime() + 1000) })
    );
  state.days.mockRejectedValueOnce(new Error("sensitive raw provider context"));
  await expect(processScheduledExports()).rejects.toThrow(
    /^Scheduled exports failed for schedule IDs: 1$/
  );
  expect(fixture.rows("warehouse_exports").map(row => row.status)).toEqual([
    "failed",
    "completed",
  ]);
  expect(fixture.rows("warehouse_schedules")[0].nextRunAt).toEqual(due);
  expect(fixture.rows("warehouse_schedules")[1].lastRunAt).toEqual(now);
  expect(state.days).toHaveBeenCalledTimes(2);
  await processScheduledExports();
  expect(fixture.rows("warehouse_exports")).toHaveLength(2);
  expect(
    fixture.rows("warehouse_exports").every(row => row.status === "completed")
  ).toBe(true);
  expect(fixture.rows("warehouse_schedules")[0].lastRunAt).toEqual(now);
  expect(state.days).toHaveBeenCalledTimes(3);
});

it("does not run inactive or future schedules", async () => {
  fixture
    .rows("warehouse_schedules")
    .push(
      schedule(1, 1, { isActive: false }),
      schedule(2, 1, { nextRunAt: new Date(now.getTime() + 1000) })
    );
  await processScheduledExports();
  expect(state.days).not.toHaveBeenCalled();
  expect(fixture.rows("warehouse_exports")).toHaveLength(0);
});
