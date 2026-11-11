import { describe, expect, it, vi } from "vitest";
import { getTableName } from "drizzle-orm";
import { transactionMemory } from "../__tests__/helpers/transaction-memory";
const state = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("../db", () => ({ getDb: () => state.db }));
import {
  addPassenger,
  updatePassenger,
  deletePassenger,
  setDefaultPassenger,
} from "./saved-passengers.service";
import { awardBonusMiles } from "./loyalty.service";
import { addToWaitlist } from "./waitlist.service";

function passengers() {
  const f = transactionMemory({
    users: [
      { id: 1, tenantId: 7 },
      { id: 2, tenantId: 8 },
    ],
    saved_passengers: [
      { id: 11, userId: 1, firstName: "A", lastName: "One", isDefault: true },
      { id: 12, userId: 1, firstName: "B", lastName: "Two", isDefault: false },
      { id: 21, userId: 2, firstName: "C", lastName: "Other", isDefault: true },
    ],
  });
  state.db = f.db;
  return f;
}
function failNewDefault(f: ReturnType<typeof passengers>) {
  const update = f.db.update;
  f.db.update = (table: Parameters<typeof getTableName>[0]) => {
    const writer = update(table);
    if (getTableName(table) !== "saved_passengers") return writer;
    return {
      set: (values: { isDefault?: boolean }) => {
        if (values.isDefault === true)
          throw new Error("Injected default write failure");
        return writer.set(values);
      },
    };
  };
}

describe("saved passenger transactional lifecycle", () => {
  it.each(["set", "update", "delete"])(
    "rolls back %s after clearing/deleting the old default",
    async operation => {
      const f = passengers();
      const before = structuredClone(f.rows("saved_passengers"));
      failNewDefault(f);
      const run =
        operation === "set"
          ? setDefaultPassenger(12, 1)
          : operation === "update"
            ? updatePassenger(12, 1, { isDefault: true })
            : deletePassenger(11, 1);
      await expect(run).rejects.toThrow("Injected");
      expect(f.rows("saved_passengers")).toEqual(before);
    }
  );
  it("rolls back clearing the old default when adding a new default fails", async () => {
    const f = passengers();
    f.failInsert("saved_passengers");
    await expect(
      addPassenger(1, { firstName: "New", lastName: "Person", isDefault: true })
    ).rejects.toThrow("Injected");
    expect(
      f
        .rows("saved_passengers")
        .filter(p => p.userId === 1 && p.isDefault)
        .map(p => p.id)
    ).toEqual([11]);
  });
  it("locks the owner for every writer and never touches another owner's default", async () => {
    const f = passengers();
    await setDefaultPassenger(12, 1);
    await updatePassenger(11, 1, { firstName: "Updated" });
    await deletePassenger(12, 1);
    await addPassenger(1, { firstName: "New", lastName: "Person" });
    expect(f.lockedTables.filter(t => t === "users")).toHaveLength(4);
    expect(
      f.rows("saved_passengers").filter(p => p.userId === 1 && p.isDefault)
    ).toHaveLength(1);
    expect(f.rows("saved_passengers").find(p => p.id === 21)?.isDefault).toBe(
      true
    );
  });
  it("rejects a foreign passenger before clearing any defaults", async () => {
    const f = passengers();
    const before = structuredClone(f.rows("saved_passengers"));
    await expect(setDefaultPassenger(21, 1)).rejects.toThrow(
      "Passenger not found"
    );
    expect(f.rows("saved_passengers")).toEqual(before);
  });
});

describe("bonus recipient integrity", () => {
  it.each(["missing", "foreign"])(
    "rejects %s recipient without creating accounts, lots or transactions",
    async kind => {
      const f = transactionMemory({
        users: kind === "missing" ? [] : [{ id: 1, tenantId: 8 }],
      });
      state.db = f.db;
      await expect(awardBonusMiles(1, 100, "fixture", 7)).rejects.toMatchObject(
        { code: "NOT_FOUND" }
      );
      for (const table of [
        "loyalty_accounts",
        "miles_transactions",
        "loyalty_credit_lots",
      ])
        expect(f.rows(table)).toHaveLength(0);
    }
  );
  it.each([0, -1, 1.5])("rejects invalid recipient %s", async userId => {
    await expect(
      awardBonusMiles(userId, 100, "fixture", 7)
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
  it("grants an existing same-tenant recipient and locks the user before the balance", async () => {
    const f = transactionMemory({ users: [{ id: 1, tenantId: 7 }] });
    state.db = f.db;
    expect(await awardBonusMiles(1, 100, "fixture", 7)).toEqual({
      newBalance: 100,
    });
    expect(f.lockedTables.slice(0, 2)).toEqual(["users", "loyalty_accounts"]);
    expect(f.rows("miles_transactions")).toHaveLength(1);
  });
});

describe("waitlist admission integrity", () => {
  it.each(["waiting", "offered"])(
    "rejects a second admission while %s",
    async status => {
      const f = transactionMemory({
        flights: [{ id: 1, economyAvailable: 0 }],
        waitlist: [
          {
            id: 1,
            userId: 1,
            flightId: 1,
            cabinClass: "economy",
            priority: 1,
            status,
          },
        ],
      });
      state.db = f.db;
      await expect(addToWaitlist(1, 1, 1, "economy")).rejects.toThrow(
        "already on the waitlist"
      );
      expect(f.rows("waitlist")).toHaveLength(1);
    }
  );
  it("allows readmission after cancellation and locks the flight before allocating priority", async () => {
    const f = transactionMemory({
      flights: [{ id: 1, economyAvailable: 0 }],
      waitlist: [
        {
          id: 1,
          userId: 1,
          flightId: 1,
          cabinClass: "economy",
          priority: 3,
          status: "cancelled",
        },
      ],
    });
    state.db = f.db;
    expect(await addToWaitlist(1, 1, 1, "economy")).toMatchObject({
      position: 4,
    });
    expect(f.lockedTables[0]).toBe("flights");
    expect(f.rows("waitlist")).toHaveLength(2);
  });
});
