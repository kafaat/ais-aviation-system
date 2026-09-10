import { describe, expect, it } from "vitest";
import {
  assertFinancialPreservation,
  captureMigrationState,
  financialBackfillPending,
  type FinancialSnapshot,
} from "../../scripts/db/migration-preservation";
import { readHistory } from "../../scripts/db/schema-contract";

const history = readHistory();
const boundary = history.findIndex(
  m => m.tag === "0014_transactional_audit_forward"
);

function fixture(hasBackfillColumn: boolean): FinancialSnapshot {
  return {
    bookings: [
      ["confirmed", "paid"],
      ["completed", "paid"],
      ["cancelled", "paid"],
      ["confirmed", "pending"],
    ].map(([status, paymentStatus], id) => ({
      id,
      status,
      paymentStatus,
      totalAmount: 12345,
      updatedAt: "before",
      ...(hasBackfillColumn ? { seatsReserved: 0 } : {}),
    })),
    wallets: [
      { balance: 12345, status: "active" },
      { balance: 0, status: "active" },
      { balance: 12345, status: "frozen" },
      { balance: -50, status: "active" },
      { balance: 12345, status: "closed" },
    ].map((row, id) => ({ id, ...row, updatedAt: "before" })),
  };
}

function backfilled(before: FinancialSnapshot): FinancialSnapshot {
  const after = structuredClone(before);
  for (const [i, row] of after.bookings.entries()) {
    row.seatsReserved = i < 2 ? 1 : 0;
    if (i < 2) row.updatedAt = "after";
  }
  after.wallets[0].status = "frozen";
  after.wallets[0].updatedAt = "after";
  return after;
}

describe("versioned upgrade preservation", () => {
  it("requires the backfill when crossing 0014", () => {
    const before = fixture(false);
    const pending = financialBackfillPending(
      captureMigrationState(history, boundary),
      history
    );
    expect(pending).toBe(true);
    expect(() =>
      assertFinancialPreservation(before, backfilled(before), pending)
    ).not.toThrow();
    expect(() =>
      assertFinancialPreservation(before, fixture(true), pending)
    ).toThrow(/seatsReserved/);
  });

  it("preserves fresh data seeded after 0014, including active wallets and unreserved bookings", () => {
    const before = fixture(true);
    const pending = financialBackfillPending(
      captureMigrationState(history, history.length),
      history
    );
    expect(pending).toBe(false);
    expect(() =>
      assertFinancialPreservation(before, structuredClone(before), pending)
    ).not.toThrow();
    expect(() =>
      assertFinancialPreservation(before, backfilled(before), pending)
    ).toThrow();
  });

  it.each(["bookings", "wallets"] as const)(
    "still rejects financial corruption in %s",
    table => {
      for (const pending of [false, true]) {
        const before = fixture(!pending);
        const after = pending ? backfilled(before) : structuredClone(before);
        after[table][0][table === "wallets" ? "balance" : "totalAmount"] = 1;
        expect(() =>
          assertFinancialPreservation(before, after, pending)
        ).toThrow();
      }
    }
  );

  it.each([1, 2, 3, 4])("rejects changing unrelated wallet %i", index => {
    const before = fixture(false);
    const after = backfilled(before);
    after.wallets[index].status =
      before.wallets[index].status === "frozen" ? "active" : "frozen";
    expect(() => assertFinancialPreservation(before, after, true)).toThrow(
      /status/
    );
  });

  it("rejects a missing wallet backfill", () => {
    const before = fixture(false);
    const after = backfilled(before);
    after.wallets[0].status = "active";
    expect(() => assertFinancialPreservation(before, after, true)).toThrow(
      /status/
    );
  });

  it.each([2, 3])("rejects reserving an ineligible booking %i", index => {
    const before = fixture(false);
    const after = backfilled(before);
    after.bookings[index].seatsReserved = 1;
    expect(() => assertFinancialPreservation(before, after, true)).toThrow(
      /seatsReserved/
    );
  });

  it("rejects lost rows and timestamp changes in a no-op upgrade", () => {
    const before = fixture(true);
    const after = structuredClone(before);
    after.wallets.pop();
    expect(() => assertFinancialPreservation(before, after, false)).toThrow(
      /Lost/
    );
    const changed = structuredClone(before);
    changed.bookings[0].updatedAt = "changed";
    expect(() => assertFinancialPreservation(before, changed, false)).toThrow(
      /updatedAt/
    );
  });

  it("fails closed on missing or mismatched migration evidence", () => {
    expect(() => financialBackfillPending(undefined as never, history)).toThrow(
      /migration state/
    );
    const state = captureMigrationState(history, history.length);
    state.appliedMigrations[0].hash = "modified";
    expect(() => financialBackfillPending(state, history)).toThrow(
      /history prefix/
    );
    expect(() => captureMigrationState(history, history.length + 1)).toThrow();
  });
});
