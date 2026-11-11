import { describe, expect, it, vi } from "vitest";
import { getTableName, SQL } from "drizzle-orm";
import { transactionMemory } from "../__tests__/helpers/transaction-memory";
const state = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("../db", () => ({ getDb: () => state.db }));
import {
  blockIpAddress,
  unblockIpAddress,
  isIpBlocked,
} from "./account-lock.service";
import {
  upsertUserPreferences,
  getUserPreferences,
} from "./user-preferences.service";

// Adds the two actual unique keys to the rollback fixture. This verifies the
// service's lifecycle and patch semantics; MySQL concurrency is tested separately.
function fixture() {
  const f = transactionMemory({ ip_blacklist: [], user_preferences: [] });
  const insert = f.db.insert;
  let statements = Promise.resolve();
  f.db.insert = (table: Parameters<typeof getTableName>[0]) => {
    const name = getTableName(table);
    const key =
      name === "ip_blacklist"
        ? "ipAddress"
        : name === "user_preferences"
          ? "userId"
          : null;
    if (!key) return insert(table);
    return {
      values: (values: Record<string, unknown>) => {
        let patch: Record<string, unknown> | undefined;
        const execute = async () => {
          const existing = f.rows(name).find(row => row[key] === values[key]);
          if (existing) {
            if (!patch) throw new Error("ER_DUP_ENTRY");
            for (const [field, value] of Object.entries(patch))
              if (!(value instanceof SQL) && value !== undefined)
                existing[field] = value;
            return [{ insertId: existing.id }];
          }
          const supplied = Object.fromEntries(
            Object.entries(values).filter(([, value]) => value !== undefined)
          );
          return await insert(table).values(
            name === "ip_blacklist"
              ? {
                  isActive: true,
                  autoUnblockAt: null,
                  unblockedAt: null,
                  unblockedBy: null,
                  ...supplied,
                }
              : supplied
          );
        };
        const chain = {
          onDuplicateKeyUpdate: (input: { set: Record<string, unknown> }) => {
            patch = input.set;
            return chain;
          },
          then: (
            resolve: (value: unknown) => unknown,
            reject: (error: unknown) => unknown
          ) => {
            const result = statements.then(execute);
            statements = result.then(
              () => undefined,
              () => undefined
            );
            return result.then(resolve, reject);
          },
        };
        return chain;
      },
    };
  };
  state.db = f.db;
  return f;
}

describe("IP block lifecycle", () => {
  it("reactivates the retained unique row after an explicit unblock", async () => {
    const f = fixture();
    await blockIpAddress("192.0.2.1", "first");
    await unblockIpAddress("192.0.2.1", "fixture");
    await blockIpAddress("192.0.2.1", "second", "fixture", 30);
    expect(f.rows("ip_blacklist")).toHaveLength(1);
    expect(f.rows("ip_blacklist")[0]).toMatchObject({
      isActive: true,
      reason: "second",
      unblockedAt: null,
      unblockedBy: null,
    });
  });
  it("preserves a stronger permanent block and its metadata", async () => {
    const f = fixture();
    await blockIpAddress("192.0.2.1", "permanent", "admin");
    await blockIpAddress("192.0.2.1", "short", "system", 1);
    expect(f.rows("ip_blacklist")[0]).toMatchObject({
      reason: "permanent",
      blockedBy: "admin",
      autoUnblockAt: null,
    });
  });
  it("extends temporary blocks but never shortens them", async () => {
    const f = fixture();
    await blockIpAddress("192.0.2.1", "long", "fixture", 60);
    const deadline = f.rows("ip_blacklist")[0].autoUnblockAt;
    await blockIpAddress("192.0.2.1", "short", "fixture", 1);
    expect(f.rows("ip_blacklist")[0].autoUnblockAt).toEqual(deadline);
    await blockIpAddress("192.0.2.1", "longer", "fixture", 120);
    expect(f.rows("ip_blacklist")[0].autoUnblockAt.getTime()).toBeGreaterThan(
      deadline.getTime()
    );
  });
  it("treats expiry as a read predicate and does not clear a potentially renewed row", async () => {
    const f = fixture();
    await blockIpAddress("192.0.2.1", "expired", "fixture", 1);
    f.rows("ip_blacklist")[0].autoUnblockAt = new Date(0);
    const before = structuredClone(f.rows("ip_blacklist"));
    expect(await isIpBlocked("192.0.2.1")).toBe(false);
    expect(f.rows("ip_blacklist")).toEqual(before);
    await blockIpAddress("192.0.2.1", "new", "fixture", 5);
    expect(await isIpBlocked("192.0.2.1")).toBe(true);
  });
  it.each([0, -1, NaN, Infinity])(
    "rejects invalid duration %s before writing",
    async duration => {
      const f = fixture();
      await expect(
        blockIpAddress("192.0.2.1", "fixture", "fixture", duration)
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(f.rows("ip_blacklist")).toHaveLength(0);
    }
  );
});

describe("preference patch upsert", () => {
  it("accepts concurrent first writes and preserves both disjoint fields", async () => {
    fixture();
    await Promise.all([
      upsertUserPreferences(1, { passportNumber: "SYNTHETIC" }),
      upsertUserPreferences(1, { smsNotifications: true }),
    ]);
    expect(await getUserPreferences(1)).toMatchObject({
      passportNumber: "SYNTHETIC",
      smsNotifications: true,
    });
  });
  it("preserves omitted fields and accepts explicit false and null", async () => {
    fixture();
    await upsertUserPreferences(1, {
      passportNumber: "SYNTHETIC",
      smsNotifications: true,
      nationality: "SA",
    });
    await upsertUserPreferences(1, {
      passportNumber: null,
      smsNotifications: false,
    });
    expect(await getUserPreferences(1)).toMatchObject({
      passportNumber: null,
      smsNotifications: false,
      nationality: "SA",
    });
  });
});
