import { createHash } from "node:crypto";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { getTableColumns, getTableName } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql-proxy";
import type { MySqlTable } from "drizzle-orm/mysql-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { agentBookings, bookings, financialLedger } from "../../drizzle/schema";
import { bspEvidenceFiles } from "../../drizzle/operations-schema";
import type { Bank, Hot } from "../../shared/bsp-local-evidence";

const state = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("../db", () => ({ getDb: () => state.db }));
import {
  importBspEvidence,
  reconcileBspEvidence,
  stageDailyRet,
} from "../services/bsp-local-evidence";

const actor = { tenantId: 101, userId: 11 };
const day = "2026-01-02";
let database: DatabaseSync;
let executed: string[];

function insert(table: MySqlTable, values: Record<string, SQLInputValue>) {
  const columns = Object.keys(values)
    .map(name => `\`${name}\``)
    .join(",");
  database
    .prepare(
      `INSERT INTO \`${getTableName(table)}\` (${columns}) VALUES (${Object.keys(
        values
      )
        .map(() => "?")
        .join(",")})`
    )
    .run(...Object.values(values));
}

beforeEach(() => {
  database = new DatabaseSync(":memory:");
  executed = [];
  for (const table of [
    bookings,
    agentBookings,
    financialLedger,
    bspEvidenceFiles,
  ]) {
    database.exec(
      `CREATE TABLE \`${getTableName(table)}\` (${Object.values(
        getTableColumns(table)
      )
        .map(
          column =>
            `\`${column.name}\` ${column.dataType === "number" || column.dataType === "boolean" ? "INTEGER" : "TEXT"}${column.name === "id" ? " PRIMARY KEY" : ""}`
        )
        .join(",")})`
    );
  }
  database.exec(
    "CREATE UNIQUE INDEX bsp_identity ON bsp_evidence_files(tenant_id,kind,reference)"
  );
  database.function("JSON_UNQUOTE", value => value);
  const queryDb = drizzle(async (query, params) => {
    executed.push(query);
    // Execute the production SELECTs, joins, constraints and transactions over
    // relational data. Syntax translation does not model native MySQL row
    // locks; the existing live BSP acceptance covers that boundary.
    const translated = query
      .replace(/\s+for update$/i, "")
      .replace(/\s+on duplicate key update[\s\S]+$/i, " ON CONFLICT DO NOTHING")
      .replace(/\bdefault\b/gi, "NULL");
    const statement = database.prepare(translated);
    if (/^insert\b/i.test(translated)) {
      const inserted = statement.run(...(params as SQLInputValue[]));
      return {
        rows: [
          {
            insertId: Number(inserted.lastInsertRowid),
            affectedRows: Number(inserted.changes),
          },
        ],
      };
    }
    statement.setReturnArrays(true);
    const columns = statement.columns();
    const rows = statement.all(...(params as SQLInputValue[])) as unknown[][];
    // mysql2 decodes JSON columns before Drizzle receives them.
    return {
      rows: rows.map(row =>
        row.map((value, index) =>
          columns[index].table === "bsp_evidence_files" &&
          columns[index].column === "content" &&
          typeof value === "string"
            ? JSON.parse(value)
            : value
        )
      ),
    };
  });
  state.db = {
    async transaction<T>(run: (tx: typeof queryDb) => Promise<T>) {
      database.exec("BEGIN");
      try {
        const result = await run(queryDb);
        database.exec("COMMIT");
        return result;
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
  };
  insert(bookings, { id: 10, tenantId: 101 });
  insert(bookings, { id: 20, tenantId: 202 });
  insert(bookings, { id: 30, tenantId: 101 });
  insert(agentBookings, { id: 1, bookingId: 10, agentId: 701 });
  insert(agentBookings, { id: 2, bookingId: 20, agentId: 702 });
  for (const row of [
    {
      id: 1,
      bookingId: 10,
      type: "charge",
      amount: "15.00",
      currency: "SAR",
      transactionDate: "2026-01-02 00:00:00.000",
      metadata: null,
    },
    {
      id: 2,
      bookingId: 10,
      type: "partial_refund",
      amount: "10.00",
      currency: "SAR",
      transactionDate: "2026-01-02 23:59:59.999",
      metadata: null,
    },
    {
      id: 3,
      bookingId: 10,
      type: "charge",
      amount: "99.00",
      currency: "SAR",
      transactionDate: "2026-01-03 00:00:00.000",
      metadata: null,
    },
    {
      id: 4,
      bookingId: 10,
      type: "charge",
      amount: "99.00",
      currency: "SAR",
      transactionDate: "2026-01-01 23:59:59.999",
      metadata: null,
    },
    {
      id: 5,
      bookingId: 20,
      type: "charge",
      amount: "99.00",
      currency: "SAR",
      transactionDate: "2026-01-02 12:00:00.000",
      metadata: null,
    },
    {
      id: 6,
      bookingId: 30,
      type: "charge",
      amount: "99.00",
      currency: "SAR",
      transactionDate: "2026-01-02 12:00:00.000",
      metadata: null,
    },
    {
      id: 7,
      bookingId: 10,
      type: "charge",
      amount: "99.00",
      currency: "SAR",
      transactionDate: "2026-01-02 12:00:00.000",
      metadata: '{"tender":"corporate_credit"}',
    },
    {
      id: 8,
      bookingId: 10,
      type: "refund",
      amount: "99.00",
      currency: "SAR",
      transactionDate: "2026-01-02 12:00:00.000",
      metadata: '{"tender":"user_credit"}',
    },
  ])
    insert(financialLedger, row);
});
afterEach(() => {
  state.db = null;
  database.close();
});

async function imported() {
  const staged = await stageDailyRet(day, actor);
  const hot: Hot = {
    ...staged.draft,
    direction: "inbound_hot",
    settlementReference: "SETTLEMENT-01",
    transferMinor: 500,
  };
  const bank: Bank = {
    profile: "AIS-BSP-LOCAL-1",
    direction: "inbound_bank",
    tenantId: 101,
    day,
    currency: "SAR",
    settlementReference: hot.settlementReference,
    statementLineId: "BANK-01",
    transferMinor: 500,
  };
  await importBspEvidence(hot, actor);
  await importBspEvidence(bank, actor);
  return { staged, hot, bank };
}

describe("BSP local evidence persistence over relational data", () => {
  it("stages only the tenant's agent cash movements for the exact completed UTC day", async () => {
    const staged = await stageDailyRet(day, actor);
    expect(staged.reference).toBe(day);
    expect(staged.draft.lines).toEqual([
      {
        ledgerId: 1,
        bookingId: 10,
        agentId: 701,
        kind: "sale",
        amountMinor: 1500,
      },
      {
        ledgerId: 2,
        bookingId: 10,
        agentId: 701,
        kind: "refund",
        amountMinor: 1000,
      },
    ]);
    expect(staged.digest).toBe(
      createHash("sha256").update(JSON.stringify(staged.draft)).digest("hex")
    );
    const row = database
      .prepare(
        "SELECT tenant_id,kind,reference,recorded_by FROM bsp_evidence_files"
      )
      .get();
    expect(row).toMatchObject({
      tenant_id: 101,
      kind: "ret_draft",
      reference: day,
      recorded_by: 11,
    });
    expect(executed.some(query => /for update$/i.test(query))).toBe(true);
  });

  it("persists all three immutable receipts and reconciles them from stored content", async () => {
    const { staged, hot, bank } = await imported();
    expect(await stageDailyRet(day, actor)).toEqual(staged);
    const receipt = await importBspEvidence(hot, actor);
    expect(await importBspEvidence(hot, { ...actor, userId: 12 })).toEqual(
      receipt
    );
    expect(
      await reconcileBspEvidence(
        day,
        hot.settlementReference,
        bank.statementLineId,
        101
      )
    ).toEqual({
      basis: "local_evidence_only",
      matches: true,
      retMatchesLedger: true,
      hotMatchesRet: true,
      bankMatchesHot: true,
      netMinor: 500,
      differingLedgerIds: [],
    });
    expect(
      database.prepare("SELECT COUNT(*) AS total FROM bsp_evidence_files").get()
        ?.total
    ).toBe(3);
    expect(
      database
        .prepare(
          "SELECT recorded_by FROM bsp_evidence_files WHERE kind='hot_input'"
        )
        .get()?.recorded_by
    ).toBe(11);
  });

  it("rejects changed content under an existing reference without replacing its digest", async () => {
    const { hot } = await imported();
    const before = database
      .prepare(
        "SELECT digest,content FROM bsp_evidence_files WHERE kind='hot_input'"
      )
      .get();
    await expect(
      importBspEvidence({ ...hot, transferMinor: 501 }, actor)
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(
      database
        .prepare(
          "SELECT digest,content FROM bsp_evidence_files WHERE kind='hot_input'"
        )
        .get()
    ).toEqual(before);
  });

  it("denies cross-tenant imports and reads without changing the original evidence", async () => {
    const { hot, bank } = await imported();
    await expect(
      importBspEvidence(hot, { tenantId: 202, userId: 22 })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      reconcileBspEvidence(
        day,
        hot.settlementReference,
        bank.statementLineId,
        202
      )
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(
      database.prepare("SELECT COUNT(*) AS total FROM bsp_evidence_files").get()
        ?.total
    ).toBe(3);
  });

  it("detects a late journal change and refuses to replace the prior RET draft", async () => {
    const { hot, bank } = await imported();
    insert(financialLedger, {
      id: 9,
      bookingId: 10,
      type: "refund",
      amount: "1.00",
      currency: "SAR",
      transactionDate: "2026-01-02 10:00:00.000",
    });
    expect(
      await reconcileBspEvidence(
        day,
        hot.settlementReference,
        bank.statementLineId,
        101
      )
    ).toMatchObject({
      matches: false,
      retMatchesLedger: false,
      differingLedgerIds: [9],
    });
    await expect(stageDailyRet(day, actor)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(
      database.prepare("SELECT COUNT(*) AS total FROM bsp_evidence_files").get()
        ?.total
    ).toBe(3);
  });

  it.each(["currency", "movement"])(
    "requires manual mapping for an unsupported %s",
    async change => {
      database.exec(
        change === "currency"
          ? "UPDATE financial_ledger SET currency='USD' WHERE id=1"
          : "UPDATE financial_ledger SET type='adjustment' WHERE id=1"
      );
      await expect(stageDailyRet(day, actor)).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
      });
      expect(
        database
          .prepare("SELECT COUNT(*) AS total FROM bsp_evidence_files")
          .get()?.total
      ).toBe(0);
    }
  );

  it("does not stage an open day or a day without matching agent movements", async () => {
    await expect(
      stageDailyRet(new Date().toISOString().slice(0, 10), actor)
    ).rejects.toThrow("still open");
    await expect(stageDailyRet("2025-12-31", actor)).rejects.toThrow("1–1000");
    expect(
      database.prepare("SELECT COUNT(*) AS total FROM bsp_evidence_files").get()
        ?.total
    ).toBe(0);
  });

  it("rejects a 1001-movement day without publishing a truncated draft", async () => {
    database.exec("DELETE FROM financial_ledger");
    const statement = database.prepare(
      "INSERT INTO financial_ledger(id,bookingId,type,amount,currency,transactionDate) VALUES (?,10,'charge','0.01','SAR','2026-01-02 12:00:00.000')"
    );
    for (let id = 1; id <= 1001; id++) statement.run(id);
    await expect(stageDailyRet(day, actor)).rejects.toThrow("1–1000");
    expect(
      database.prepare("SELECT COUNT(*) AS total FROM bsp_evidence_files").get()
        ?.total
    ).toBe(0);
    database.exec("DELETE FROM financial_ledger WHERE id=1001");
    expect((await stageDailyRet(day, actor)).draft.lines).toHaveLength(1000);
  });

  it("rolls back a failed persistence attempt and permits a clean retry", async () => {
    database.exec(
      "CREATE TRIGGER reject_evidence BEFORE INSERT ON bsp_evidence_files BEGIN SELECT RAISE(ABORT, 'Injected evidence failure'); END"
    );
    await expect(stageDailyRet(day, actor)).rejects.toThrow();
    expect(
      database.prepare("SELECT COUNT(*) AS total FROM bsp_evidence_files").get()
        ?.total
    ).toBe(0);
    database.exec("DROP TRIGGER reject_evidence");
    expect((await stageDailyRet(day, actor)).draft.lines).toHaveLength(2);
  });

  it("rejects missing or corrupt stored evidence instead of inventing a matched result", async () => {
    const { hot, bank } = await imported();
    await expect(
      reconcileBspEvidence(day, "MISSING", bank.statementLineId, 101)
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    database.exec(
      "UPDATE bsp_evidence_files SET content='{}' WHERE kind='bank_input'"
    );
    await expect(
      reconcileBspEvidence(
        day,
        hot.settlementReference,
        bank.statementLineId,
        101
      )
    ).rejects.toThrow();
  });

  it("fails explicitly when the database is unavailable", async () => {
    state.db = null;
    await expect(stageDailyRet(day, actor)).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
    });
    await expect(
      reconcileBspEvidence(day, "SETTLEMENT-01", "BANK-01", 101)
    ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
  });
});
