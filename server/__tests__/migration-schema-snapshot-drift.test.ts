import { describe, expect, it } from "vitest";
import {
  assertSnapshotMatchesSchema,
  assertMigrationScope,
} from "../../scripts/db/snapshot-check";
import {
  differences,
  readHistory,
  snapshotContract,
} from "../../scripts/db/schema-contract";

describe("Drizzle schema/snapshot authority", () => {
  it("matches the complete generated schema including re-exports, columns, indexes and constraints", async () => {
    await expect(assertSnapshotMatchesSchema()).resolves.toBeUndefined();
  });

  it("rejects lost tenant columns and weakened unique constraints even when table names match", () => {
    const latest = readHistory().at(-1);
    if (!latest) throw new Error("Missing migration history");
    const expected = snapshotContract(latest.snapshot);
    const missingColumn = structuredClone(expected);
    delete missingColumn.users.columns.tenantId;
    expect(
      differences(expected, missingColumn).some(p =>
        p.includes("users.columns.tenantId")
      )
    ).toBe(true);
    const weakenedIndex = structuredClone(expected);
    weakenedIndex.flight_reviews.indexes.user_flight_unique.unique = false;
    expect(differences(expected, weakenedIndex)).toEqual([
      "schema.flight_reviews.indexes.user_flight_unique.unique: expected true, received false",
    ]);
  });
  it("refuses broad legacy drift when only ticket and seat tables were declared", () => {
    const history = readHistory();
    const before = history[12].snapshot;
    const last = history.at(-1);
    if (!last) throw new Error("Missing history");
    const after = last.snapshot;
    expect(() =>
      assertMigrationScope(before, after, ["passengers", "seat_inventory"])
    ).toThrow("MIGRATION_SCOPE_MISMATCH");
    const changed = structuredClone(after);
    changed.tables.passengers.columns.ticketNumber.notNull = true;
    expect(() =>
      assertMigrationScope(after, changed, ["passengers"])
    ).not.toThrow();
  });
});
