import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import { transactionMemory } from "./helpers/transaction-memory";
import {
  createFamilyGroup,
  addFamilyMember,
  contributeMilesToPool,
} from "../services/family-pool.service";

const boundary = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock("../db", () => ({ getDb: () => boundary.db }));

it("replays a family contribution without a second miles debit or group credit", async () => {
  const fixture = transactionMemory({
    users: [{ id: 1, tenantId: 2 }],
    family_groups: [{ id: 3, status: "active", pooledMiles: 0 }],
    family_group_members: [
      { id: 4, groupId: 3, userId: 1, status: "active", milesContributed: 0 },
    ],
    loyalty_accounts: [
      {
        id: 5,
        userId: 1,
        currentMilesBalance: 500,
        creditLotsInitializedAt: new Date(),
      },
    ],
    loyalty_credit_lots: [
      {
        transactionId: 6,
        loyaltyAccountId: 5,
        bookingId: null,
        creditedMiles: 500,
        remainingMiles: 500,
        spentMiles: 0,
        expiredMiles: 0,
        reversedMiles: 0,
        expiresAt: null,
      },
    ],
  });
  boundary.db = fixture.db;
  const key = randomUUID();
  const receipt = await contributeMilesToPool(1, 3, 200, key);
  expect(await contributeMilesToPool(1, 3, 200, key)).toEqual(receipt);
  await expect(contributeMilesToPool(1, 3, 300, key)).rejects.toMatchObject({
    code: "CONFLICT",
  });
  expect(fixture.rows("loyalty_accounts")[0].currentMilesBalance).toBe(300);
  expect(fixture.rows("family_groups")[0].pooledMiles).toBe(200);
  expect(fixture.rows("family_group_members")[0].milesContributed).toBe(200);
  expect(fixture.rows("outbox")).toHaveLength(1);
});

it("rolls back the group if creating its owner membership fails", async () => {
  const fixture = transactionMemory({ users: [{ id: 1 }] });
  boundary.db = fixture.db;
  fixture.failInsert("family_group_members");
  await expect(createFamilyGroup(1, "Family")).rejects.toThrow();
  expect(fixture.rows("family_groups")).toHaveLength(0);
  expect(fixture.rows("family_group_members")).toHaveLength(0);
});

it("locks the user before the group and enforces membership and capacity across groups", async () => {
  const fixture = transactionMemory({
    users: [
      { id: 1 },
      { id: 2, email: "one@example.test" },
      { id: 3, email: "two@example.test" },
    ],
    family_groups: [
      { id: 1, ownerId: 1, status: "active", maxMembers: 2 },
      { id: 2, ownerId: 9, status: "active", maxMembers: 6 },
    ],
    family_group_members: [
      { id: 1, userId: 1, groupId: 1, status: "active", role: "owner" },
    ],
  });
  boundary.db = fixture.db;
  await addFamilyMember(1, 1, "one@example.test");
  expect(fixture.lockedTables.slice(0, 2)).toEqual(["users", "family_groups"]);
  await expect(addFamilyMember(9, 2, "one@example.test")).rejects.toThrow(
    /already/
  );
  await expect(createFamilyGroup(2, "Duplicate")).rejects.toThrow(/already/);
  await expect(addFamilyMember(1, 1, "two@example.test")).rejects.toThrow(
    /Maximum/
  );
  expect(fixture.rows("family_group_members")).toHaveLength(2);
});
