import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { Connection, RowDataPacket } from "mysql2/promise";

export interface Column {
  name: string;
  type: string;
  notNull: boolean;
  autoincrement?: boolean;
  primaryKey?: boolean;
  onUpdate?: boolean;
  default?: unknown;
  generated?: unknown;
}
interface Index {
  name?: string;
  columns: string[];
  isUnique?: boolean;
  using?: string;
}
export interface Snapshot {
  id: string;
  prevId: string;
  version: string;
  dialect: string;
  views?: Record<string, unknown>;
  tables: Record<
    string,
    {
      name: string;
      columns: Record<string, Column>;
      indexes: Record<string, Index>;
      compositePrimaryKeys: Record<string, Index>;
      uniqueConstraints: Record<string, Index>;
      foreignKeys: Record<string, unknown>;
      checkConstraint?: Record<string, unknown>;
    }
  >;
}
export interface Migration {
  idx: number;
  tag: string;
  when: number;
  hash: string;
  snapshot: Snapshot;
}
export interface TableContract {
  columns: Record<
    string,
    {
      type: string;
      notNull: boolean;
      default: string | null;
      autoincrement: boolean;
      onUpdate: boolean;
    }
  >;
  indexes: Record<
    string,
    { columns: string[]; unique: boolean; using: string }
  >;
}
export type Contract = Record<string, TableContract>;

export function readHistory(root = "drizzle"): Migration[] {
  const journal = JSON.parse(
    readFileSync(join(root, "meta/_journal.json"), "utf8")
  ) as {
    entries: Array<{ idx: number; tag: string; when: number }>;
  };
  const files = readdirSync(root)
    .filter(n => /^\d{4}_.+\.sql$/.test(n))
    .sort();
  const expected = journal.entries.map(e => `${e.tag}.sql`).sort();
  if (
    JSON.stringify(files) !== JSON.stringify(expected) ||
    new Set(expected).size !== expected.length
  ) {
    throw new Error(
      "MIGRATION_JOURNAL_PARITY: SQL files must be journaled exactly once"
    );
  }
  let previousId = "00000000-0000-0000-0000-000000000000";
  let previousTime = -1;
  return journal.entries.map((e, i) => {
    if (
      e.idx !== i ||
      !Number.isSafeInteger(e.when) ||
      e.when <= previousTime ||
      !/^\d{4}_[\w-]+$/.test(e.tag)
    ) {
      throw new Error(
        "MIGRATION_JOURNAL_ORDER: invalid index, tag or timestamp"
      );
    }
    const snapshot = JSON.parse(
      readFileSync(
        join(root, `meta/${String(i).padStart(4, "0")}_snapshot.json`),
        "utf8"
      )
    ) as Snapshot;
    if (
      snapshot.prevId !== previousId ||
      snapshot.dialect !== "mysql" ||
      snapshot.version !== "5"
    ) {
      throw new Error(`MIGRATION_SNAPSHOT_CHAIN: ${e.tag}`);
    }
    previousId = snapshot.id;
    previousTime = e.when;
    return {
      ...e,
      snapshot,
      hash: createHash("sha256")
        .update(readFileSync(join(root, `${e.tag}.sql`)))
        .digest("hex"),
    };
  });
}

export function normalizeType(type: string): string {
  return type
    .replace(/^boolean$/i, "tinyint(1)")
    .replace(
      /^(tinyint|smallint|mediumint|int|bigint)\(\d+\)(?! unsigned)/i,
      (s, t: string) => (s === "tinyint(1)" ? s : t)
    )
    .replace(/,\s+/g, ",");
}
function normalizeDefault(
  value: unknown,
  type: string,
  fromSnapshot = false
): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "boolean") return value ? "1" : "0";
  let result = String(value);
  if (fromSnapshot && result.startsWith("'") && result.endsWith("'"))
    result = result.slice(1, -1).replace(/''/g, "'");
  if (
    /^(timestamp|datetime)/i.test(type) &&
    /^(\(*now\(\)\)*|current_timestamp(?:\(\d*\))?)$/i.test(result)
  )
    return "CURRENT_TIMESTAMP";
  if (
    /^(decimal|float|double|int|bigint|tinyint|boolean)/i.test(type) &&
    /^-?\d+(\.\d+)?$/.test(result)
  )
    result = result.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
  return result;
}

export function snapshotContract(snapshot: Snapshot): Contract {
  if (Object.keys(snapshot.views ?? {}).length)
    throw new Error(
      "UNSUPPORTED_CONTRACT: views require explicit verification"
    );
  const result: Contract = {};
  for (const [name, table] of Object.entries(snapshot.tables)) {
    if (
      Object.keys(table.foreignKeys ?? {}).length ||
      Object.keys(table.checkConstraint ?? {}).length
    ) {
      throw new Error(
        `UNSUPPORTED_CONTRACT: foreign/check constraints on ${name}`
      );
    }
    const out: TableContract = { columns: {}, indexes: {} };
    for (const [key, c] of Object.entries(table.columns)) {
      if (c.generated)
        throw new Error(
          `UNSUPPORTED_CONTRACT: generated column ${name}.${key}`
        );
      out.columns[key] = {
        type: normalizeType(c.type),
        notNull: c.notNull,
        default: normalizeDefault(c.default, c.type, true),
        autoincrement: !!c.autoincrement,
        onUpdate: !!c.onUpdate,
      };
      if (c.primaryKey)
        out.indexes.PRIMARY = { columns: [key], unique: true, using: "BTREE" };
    }
    for (const index of Object.values(table.compositePrimaryKeys ?? {}))
      out.indexes.PRIMARY = {
        columns: index.columns,
        unique: true,
        using: "BTREE",
      };
    for (const [key, index] of Object.entries(table.indexes ?? {}))
      out.indexes[key] = {
        columns: index.columns,
        unique: !!index.isUnique,
        using: (index.using ?? "BTREE").toUpperCase(),
      };
    for (const [key, index] of Object.entries(table.uniqueConstraints ?? {}))
      out.indexes[key] = {
        columns: index.columns,
        unique: true,
        using: "BTREE",
      };
    result[name] = out;
  }
  return result;
}

export async function readDatabaseContract(
  connection: Connection
): Promise<Contract> {
  const [tables] = await connection.query<RowDataPacket[]>(
    "SELECT TABLE_NAME, TABLE_TYPE, ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()"
  );
  const result: Contract = {};
  for (const t of tables) {
    if (t.TABLE_NAME === "__drizzle_migrations") continue;
    if (t.TABLE_TYPE !== "BASE TABLE" || t.ENGINE !== "InnoDB")
      throw new Error(`UNSUPPORTED_DATABASE_OBJECT: ${t.TABLE_NAME}`);
    result[t.TABLE_NAME] = { columns: {}, indexes: {} };
  }
  const [columns] = await connection.query<RowDataPacket[]>(
    "SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, EXTRA, GENERATION_EXPRESSION FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME, ORDINAL_POSITION"
  );
  for (const c of columns) {
    if (c.TABLE_NAME === "__drizzle_migrations") continue;
    if (
      c.GENERATION_EXPRESSION ||
      /on update (?!CURRENT_TIMESTAMP)/i.test(c.EXTRA)
    )
      throw new Error(
        `UNSUPPORTED_DATABASE_COLUMN: ${c.TABLE_NAME}.${c.COLUMN_NAME}`
      );
    result[c.TABLE_NAME].columns[c.COLUMN_NAME] = {
      type: normalizeType(c.COLUMN_TYPE),
      notNull: c.IS_NULLABLE === "NO",
      default: normalizeDefault(c.COLUMN_DEFAULT, c.COLUMN_TYPE),
      autoincrement: /auto_increment/i.test(c.EXTRA),
      onUpdate: /on update CURRENT_TIMESTAMP/i.test(c.EXTRA),
    };
  }
  const [indexes] = await connection.query<RowDataPacket[]>(
    "SELECT TABLE_NAME, INDEX_NAME, NON_UNIQUE, COLUMN_NAME, SUB_PART, COLLATION, INDEX_TYPE, IS_VISIBLE, EXPRESSION FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX"
  );
  for (const i of indexes) {
    if (i.TABLE_NAME === "__drizzle_migrations") continue;
    if (
      i.SUB_PART !== null ||
      i.EXPRESSION !== null ||
      i.COLLATION !== "A" ||
      i.IS_VISIBLE !== "YES"
    )
      throw new Error(
        `UNSUPPORTED_DATABASE_INDEX: ${i.TABLE_NAME}.${i.INDEX_NAME}`
      );
    const index = (result[i.TABLE_NAME].indexes[i.INDEX_NAME] ??= {
      columns: [],
      unique: !i.NON_UNIQUE,
      using: i.INDEX_TYPE,
    });
    index.columns.push(i.COLUMN_NAME);
  }
  const [constraints] = await connection.query<RowDataPacket[]>(
    "SELECT TABLE_NAME, CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND CONSTRAINT_TYPE IN ('FOREIGN KEY', 'CHECK')"
  );
  if (constraints.length)
    throw new Error(
      `UNSUPPORTED_DATABASE_CONSTRAINT: ${constraints.map(c => `${c.TABLE_NAME}.${c.CONSTRAINT_NAME}`).join(",")}`
    );
  return result;
}

export function differences(
  expected: unknown,
  actual: unknown,
  path = "schema"
): string[] {
  if (
    expected !== null &&
    actual !== null &&
    typeof expected === "object" &&
    typeof actual === "object"
  ) {
    const e = expected as Record<string, unknown>,
      a = actual as Record<string, unknown>;
    return [...new Set([...Object.keys(e), ...Object.keys(a)])]
      .sort()
      .flatMap(k => differences(e[k], a[k], `${path}.${k}`));
  }
  return expected === actual
    ? []
    : [
        `${path}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`,
      ];
}

export async function appliedMigrationCount(
  connection: Connection,
  history: Migration[]
): Promise<number> {
  const [exists] = await connection.query<RowDataPacket[]>(
    "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '__drizzle_migrations'"
  );
  if (!exists.length) return 0;
  const [rows] = await connection.query<RowDataPacket[]>(
    "SELECT hash, created_at FROM __drizzle_migrations ORDER BY id"
  );
  for (const [i, row] of rows.entries()) {
    if (
      !history[i] ||
      row.hash !== history[i].hash ||
      Number(row.created_at) !== history[i].when
    )
      throw new Error(
        `MIGRATION_HISTORY_MISMATCH: entry ${i}; restore the original journal/SQL before proceeding`
      );
  }
  return rows.length;
}

export const quoteIdentifier = (name: string) =>
  `\`${name.replace(/`/g, "``")}\``;

// Check all new constraints before the first DDL; MySQL DDL is not transactional.
// Report aggregate conflicts only, never passenger/payment values.
export async function assertDataCompatible(
  connection: Connection,
  before: Contract,
  after: Contract
): Promise<void> {
  for (const [table, old] of Object.entries(before)) {
    const target = after[table];
    if (!target)
      throw new Error(`DESTRUCTIVE_MIGRATION: dropped table ${table}`);
    for (const [column, oldColumn] of Object.entries(old.columns)) {
      const next = target.columns[column];
      if (!next)
        throw new Error(
          `DESTRUCTIVE_MIGRATION: dropped column ${table}.${column}`
        );
      if (!oldColumn.notNull && next.notNull) {
        const [rows] = await connection.query<RowDataPacket[]>(
          `SELECT COUNT(*) AS conflicts FROM ${quoteIdentifier(table)} WHERE ${quoteIdentifier(column)} IS NULL`
        );
        if (Number(rows[0].conflicts))
          throw new Error(
            `MIGRATION_NULL_CONFLICT: ${table}.${column}; rows=${rows[0].conflicts}`
          );
      }
    }
    for (const [name, index] of Object.entries(target.indexes)) {
      if (!index.unique || !index.columns.every(c => c in old.columns))
        continue;
      if (
        Object.values(old.indexes).some(
          i =>
            i.unique &&
            JSON.stringify(i.columns) === JSON.stringify(index.columns)
        )
      )
        continue;
      const cols = index.columns.map(quoteIdentifier);
      const [rows] = await connection.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS conflicts FROM (SELECT 1 FROM ${quoteIdentifier(table)} WHERE ${cols.map(c => `${c} IS NOT NULL`).join(" AND ")} GROUP BY ${cols.join(",")} HAVING COUNT(*) > 1) AS duplicate_groups`
      );
      if (Number(rows[0].conflicts))
        throw new Error(
          `MIGRATION_UNIQUE_CONFLICT: ${table}.${name}; groups=${rows[0].conflicts}`
        );
    }
  }
}
