import { describe, expect, it, vi } from "vitest";
import {
  appliedMigrationCount,
  differences,
  type Migration,
} from "../../../scripts/db/schema-contract";

describe("appliedMigrationCount", () => {
  it("rejects mismatched migration hashes and timestamps", async () => {
    const history = [
      {
        idx: 0,
        tag: "0000_alpha",
        when: 100,
        hash: "expected-hash",
        snapshot: {
          id: "1",
          prevId: "0",
          version: "5",
          dialect: "mysql",
          tables: {},
        },
      },
    ] as Migration[];

    const query = vi
      .fn()
      .mockResolvedValueOnce([[{ TABLE_NAME: "__drizzle_migrations" }]])
      .mockResolvedValueOnce([[{ hash: "wrong-hash", created_at: 999 }]]);

    await expect(
      appliedMigrationCount({ query } as never, history)
    ).rejects.toThrow(/MIGRATION_HISTORY_MISMATCH/);
  });
});

describe("differences", () => {
  it("detects index uniqueness drift even when table counts match", () => {
    const drift = differences(
      {
        users: {
          indexes: {
            user_email_unique: {
              columns: ["email"],
              unique: true,
              using: "BTREE",
            },
          },
        },
      },
      {
        users: {
          indexes: {
            user_email_unique: {
              columns: ["email"],
              unique: false,
              using: "BTREE",
            },
          },
        },
      }
    );

    expect(drift).toEqual(
      expect.arrayContaining([
        expect.stringContaining("users.indexes.user_email_unique.unique"),
      ])
    );
  });
});
