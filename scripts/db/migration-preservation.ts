import assert from "node:assert/strict";
import type { Migration } from "./schema-contract";

type MigrationStamp = Pick<Migration, "tag" | "hash" | "when">;
type Row = Record<string, unknown>;
export type FinancialSnapshot = { bookings: Row[]; wallets: Row[] };
const backfillTag = "0014_transactional_audit_forward";

export function captureMigrationState(
  history: MigrationStamp[],
  applied: number
) {
  assert.ok(
    Number.isSafeInteger(applied) && applied >= 0 && applied <= history.length,
    "Invalid applied migration count"
  );
  return {
    version: 1,
    appliedMigrations: history.slice(0, applied).map(({ tag, hash, when }) => ({
      tag,
      hash,
      when,
    })),
  };
}

/** Derive expectations from the journal at seed time, never from release names. */
export function financialBackfillPending(
  state: ReturnType<typeof captureMigrationState>,
  history: MigrationStamp[]
): boolean {
  assert.ok(
    state?.version === 1 && Array.isArray(state.appliedMigrations),
    "Missing versioned migration state in preservation artifact"
  );
  const applied = state.appliedMigrations.length;
  assert.deepEqual(
    state,
    captureMigrationState(history, applied),
    "Preservation artifact does not match the migration history prefix"
  );
  const boundary = history.findIndex(m => m.tag === backfillTag);
  assert.ok(boundary >= 0, "Financial backfill is absent from target history");
  return applied <= boundary;
}

/** Permit only the specific one-time changes from 0014 when it is pending. */
export function assertFinancialPreservation(
  before: FinancialSnapshot,
  after: FinancialSnapshot,
  backfillPending: boolean
) {
  for (const table of ["bookings", "wallets"] as const) {
    assert.equal(
      after[table].length,
      before[table].length,
      `Lost ${table} rows`
    );
    for (const [index, original] of before[table].entries()) {
      const expected = { ...original };
      let rowUpdated = false;
      if (backfillPending && table === "bookings") {
        rowUpdated =
          ["confirmed", "completed"].includes(String(original.status)) &&
          original.paymentStatus === "paid";
        expected.seatsReserved = rowUpdated ? 1 : 0;
      }
      if (
        backfillPending &&
        table === "wallets" &&
        Number(original.balance) > 0 &&
        original.status === "active"
      ) {
        expected.status = "frozen";
        rowUpdated = true;
      }
      for (const [column, value] of Object.entries(expected)) {
        // ON UPDATE timestamps may change only on rows touched by the backfill.
        if (rowUpdated && column === "updatedAt") continue;
        assert.deepEqual(
          after[table][index][column],
          value,
          `Preserve financial ${table}[${original.id}].${column}`
        );
      }
    }
  }
}
