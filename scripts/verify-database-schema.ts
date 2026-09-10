import "dotenv/config";
import mysql, { type RowDataPacket } from "mysql2/promise";
import { is } from "drizzle-orm";
import { MySqlTable, getTableConfig } from "drizzle-orm/mysql-core";
import * as schema from "../drizzle/schema";

// Compare the live catalog with the application schema, not just the journal.
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const connection = await mysql.createConnection(process.env.DATABASE_URL);
const failures: string[] = [];
const normalize = (value: string) =>
  value
    .toLowerCase()
    .replace(/^boolean$/, "tinyint(1)")
    .replace(/^(int|bigint|smallint)\(\d+\)/, "$1")
    .replaceAll(", ", ",");
try {
  const [columns] = await connection.query<RowDataPacket[]>(
    "SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, COLUMN_DEFAULT, IS_NULLABLE, EXTRA FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()"
  );
  const [indexes] = await connection.query<RowDataPacket[]>(
    "SELECT TABLE_NAME, INDEX_NAME, COLUMN_NAME, NON_UNIQUE FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX"
  );
  const tables = Object.values(schema).filter(value => is(value, MySqlTable));
  const expectedTables = new Set(
    tables.map(table => getTableConfig(table).name)
  );
  for (const name of new Set(columns.map(row => String(row.TABLE_NAME)))) {
    if (!expectedTables.has(name) && name !== "__drizzle_migrations")
      failures.push(`Unexpected table: ${name}`);
  }
  for (const table of tables) {
    const config = getTableConfig(table);
    const actual = columns.filter(row => row.TABLE_NAME === config.name);
    for (const row of actual) {
      if (!config.columns.some(column => column.name === row.COLUMN_NAME))
        failures.push(`Unexpected column: ${config.name}.${row.COLUMN_NAME}`);
    }
    for (const column of config.columns) {
      const row = actual.find(row => row.COLUMN_NAME === column.name);
      if (!row) {
        failures.push(`Missing column: ${config.name}.${column.name}`);
        continue;
      }
      if (normalize(row.COLUMN_TYPE) !== normalize(column.getSQLType()))
        failures.push(
          `Type mismatch: ${config.name}.${column.name}: ${row.COLUMN_TYPE} != ${column.getSQLType()}`
        );
      if ((row.IS_NULLABLE === "NO") !== column.notNull)
        failures.push(`Nullability mismatch: ${config.name}.${column.name}`);
      // false is a declared default too. NOT NULL/type checks alone cannot
      // detect a MODIFY COLUMN that silently drops its DEFAULT clause.
      if (
        typeof column.default === "boolean" &&
        (row.COLUMN_DEFAULT === null ||
          String(row.COLUMN_DEFAULT) !== String(Number(column.default)))
      )
        failures.push(
          `Boolean default mismatch: ${config.name}.${column.name}`
        );
      if (
        "autoIncrement" in column &&
        Boolean(column.autoIncrement) !== row.EXTRA.includes("auto_increment")
      )
        failures.push(`Auto-increment mismatch: ${config.name}.${column.name}`);
    }
    const expected = config.indexes.map(index => ({
      name: index.config.name,
      unique: Boolean(index.config.unique),
      columns: index.config.columns.map(column =>
        "name" in column ? column.name : "<expression>"
      ),
    }));
    for (const column of config.columns) {
      if (column.primary)
        expected.push({
          name: "PRIMARY",
          unique: true,
          columns: [column.name],
        });
      if (column.isUnique)
        expected.push({
          name: column.uniqueName!,
          unique: true,
          columns: [column.name],
        });
    }
    for (const key of config.primaryKeys)
      expected.push({
        name: "PRIMARY",
        unique: true,
        columns: key.columns.map(c => c.name),
      });
    for (const key of config.uniqueConstraints)
      expected.push({
        name: key.getName(),
        unique: true,
        columns: key.columns.map(c => c.name),
      });
    const actualIndexes = indexes.filter(row => row.TABLE_NAME === config.name);
    for (const index of expected) {
      const rows = actualIndexes.filter(row => row.INDEX_NAME === index.name);
      if (
        !rows.length ||
        JSON.stringify(rows.map(row => row.COLUMN_NAME)) !==
          JSON.stringify(index.columns) ||
        (rows[0].NON_UNIQUE === 0) !== index.unique
      )
        failures.push(`Index mismatch: ${config.name}.${index.name}`);
    }
    for (const name of new Set(
      actualIndexes.map(row => String(row.INDEX_NAME))
    )) {
      if (!expected.some(index => index.name === name))
        failures.push(`Unexpected index: ${config.name}.${name}`);
    }
  }
  if (failures.length)
    throw new Error(
      `Database schema differs from source:\n${failures.join("\n")}`
    );
  console.info(
    `Verified ${tables.length} live tables: columns, types, boolean defaults, nullability, auto-increment, primary and unique indexes.`
  );
} finally {
  await connection.end();
}
