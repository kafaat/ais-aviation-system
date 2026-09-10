import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Connection } from "mysql2/promise";
import { adoptJournal } from "../../scripts/db/migrate";
import {
  readHistory,
  snapshotContract,
} from "../../scripts/db/schema-contract";

vi.mock("../../scripts/db/schema-contract", async importOriginal => {
  const real =
    await importOriginal<typeof import("../../scripts/db/schema-contract")>();
  return {
    ...real,
    appliedMigrationCount: () => Promise.resolve(real.readHistory().length),
    readDatabaseContract: () => {
      const latest = real.readHistory().at(-1);
      if (!latest) throw new Error("Missing migration history");
      return Promise.resolve(real.snapshotContract(latest.snapshot));
    },
  };
});

describe("baseline must not skip financial data reconciliation", () => {
  const history = readHistory();
  const latest = history.at(-1);
  if (!latest) throw new Error("Missing migration history");
  const target = snapshotContract(latest.snapshot);
  let activeBalances = 0;
  let unmarkedPaidBookings = 0;
  const query = vi.fn((sql: string) => {
    if (sql.includes("FROM `wallets`"))
      return Promise.resolve([[{ n: activeBalances }]]);
    if (sql.includes("FROM `bookings`"))
      return Promise.resolve([[{ n: unmarkedPaidBookings }]]);
    if (sql.includes("SELECT ENGINE"))
      return Promise.resolve([[{ ENGINE: "InnoDB" }]]);
    return Promise.resolve([[]]);
  });
  const beginTransaction = vi.fn(async () => {});
  const commit = vi.fn(async () => {});
  const rollback = vi.fn(async () => {});
  const connection = {
    query,
    beginTransaction,
    commit,
    rollback,
  } as unknown as Connection;
  beforeEach(() => {
    vi.clearAllMocks();
    activeBalances = 0;
    unmarkedPaidBookings = 0;
  });

  it.each(["wallet", "booking"])(
    "refuses an unresolved legacy %s before writing any journal",
    async kind => {
      if (kind === "wallet") activeBalances = 1;
      else unmarkedPaidBookings = 1;
      await expect(
        adoptJournal(connection, history, 0, target, target)
      ).rejects.toThrow("BASELINE_DATA_REVIEW_REQUIRED");
      expect(
        query.mock.calls.some(([sql]) =>
          /^(CREATE|INSERT|UPDATE|DELETE)/.test(sql)
        )
      ).toBe(false);
      expect(beginTransaction).not.toHaveBeenCalled();
      expect(commit).not.toHaveBeenCalled();
    }
  );

  it("allows adoption after the outstanding data conditions have been reviewed and resolved", async () => {
    await expect(
      adoptJournal(connection, history, 0, target, target)
    ).resolves.toBeUndefined();
    expect(
      query.mock.calls.some(([sql]) => sql.includes("FROM `wallets`"))
    ).toBe(true);
    expect(
      query.mock.calls.some(([sql]) => sql.includes("FROM `bookings`"))
    ).toBe(true);
    expect(
      query.mock.calls.filter(([sql]) =>
        sql.startsWith("INSERT INTO `__drizzle_migrations`")
      ).length
    ).toBe(history.length);
    expect(commit).toHaveBeenCalledOnce();
  });
});
