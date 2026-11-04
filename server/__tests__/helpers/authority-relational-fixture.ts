import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { getTableColumns, getTableName, SQL } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql-proxy";
import { MySqlDialect, type MySqlTable } from "drizzle-orm/mysql-core";

/** Executes the production Drizzle predicates and transactions on SQLite.
 * MySQL row locks are recorded, not simulated. This fixture does not establish
 * MySQL concurrency, schema parity, provider acceptance, or operating approval.
 */
export function authorityRelationalFixture(tables: MySqlTable[]) {
  const sqlite = new DatabaseSync(":memory:");
  const dialect = new MySqlDialect();
  sqlite.exec("PRAGMA foreign_keys = ON");
  const defaults = new Map<string, Map<string, string>>();
  const jsonColumns = new Map<string, Set<string>>();
  for (const table of tables) {
    const name = getTableName(table);
    const tableDefaults = new Map<string, string>();
    const columns = Object.values(getTableColumns(table)).map(column => {
      const value = column.default;
      if (
        value instanceof SQL &&
        !/^\(?(now\(\)|current_timestamp(?:\(\))?)\)?$/i.test(
          dialect.sqlToQuery(value).sql.trim()
        )
      )
        throw new Error(`Unsupported fixture default: ${name}.${column.name}`);
      const fallback =
        value instanceof SQL
          ? "CURRENT_TIMESTAMP"
          : typeof value === "boolean"
            ? String(Number(value))
            : typeof value === "number"
              ? String(value)
              : typeof value === "string"
                ? `'${value.replaceAll("'", "''")}'`
                : "NULL";
      tableDefaults.set(column.name, fallback);
      const type =
        column.dataType === "number" || column.dataType === "boolean"
          ? "INTEGER"
          : "TEXT";
      return `\`${column.name}\` ${type}${column.primary ? " PRIMARY KEY" : ""} DEFAULT ${fallback}`;
    });
    sqlite.exec(`CREATE TABLE \`${name}\` (${columns.join(",")})`);
    defaults.set(name, tableDefaults);
    jsonColumns.set(
      name,
      new Set(
        Object.values(getTableColumns(table))
          .filter(column => column.dataType === "json")
          .map(column => column.name)
      )
    );
  }
  for (const [name, direction] of [
    ["GREATEST", 1],
    ["LEAST", -1],
  ] as const) {
    sqlite.function(name, { varargs: true }, (...values) => {
      if (values.some(value => value === null)) return null;
      if (!values.every(value => typeof value === "string"))
        throw new Error("Fixture date comparison requires timestamp text");
      return (values as string[]).sort()[
        direction === 1 ? values.length - 1 : 0
      ];
    });
  }
  let inTransaction = false;
  const queries: Array<{ sql: string; inTransaction: boolean }> = [];
  const db = drizzle(async (query, params, method) => {
    queries.push({ sql: query, inTransaction });
    let executable = query
      .replace(/ for update(?=\s*(?:\)|$))/gi, "")
      .replaceAll("<=>", "IS");
    // SQLite does not accept DEFAULT inside VALUES. Preserve the corresponding
    // canonical column default explicitly; never substitute a fixture rowset.
    executable = executable.replace(
      /^insert into `([^`]+)` \(([^)]+)\) values \(([^)]+)\)/i,
      (_match, table: string, names: string, values: string) => {
        const columns = names
          .split(",")
          .map(name => name.trim().replaceAll("`", ""));
        const bound = values
          .split(",")
          .map((value, index) =>
            value.trim().toLowerCase() === "default"
              ? (defaults.get(table)?.get(columns[index]) ?? "NULL")
              : value
          );
        return `insert into \`${table}\` (${names}) values (${bound.join(",")})`;
      }
    );
    if (/on duplicate key update/i.test(executable)) {
      if (!executable.startsWith("insert into `user_consents` "))
        throw new Error("Unsupported fixture upsert");
      executable = executable.replace(
        /on duplicate key update/i,
        "on conflict (`userId`) do update set"
      );
    }
    // Raw sql`${date}` parameters are encoded by mysql2 in production, whereas
    // Drizzle column predicates already encode them. SQLite needs the same UTC
    // timestamp text and precision for both paths.
    const bound = params.map(value =>
      value instanceof Date
        ? value.toISOString().replace("T", " ").replace(/Z$/, "")
        : value
    ) as SQLInputValue[];
    const statement = sqlite.prepare(executable);
    if (method === "all") {
      statement.setReturnArrays(true);
      const columns = statement.columns();
      // mysql2 decodes JSON columns before Drizzle receives its rows. Preserve
      // that driver boundary while still executing predicates on stored JSON.
      const rows = statement.all(...bound) as unknown as unknown[][];
      return {
        rows: rows.map(row =>
          row.map((value, index) => {
            const column = columns[index];
            return typeof value === "string" &&
              column.table &&
              column.column &&
              jsonColumns.get(column.table)?.has(column.column)
              ? JSON.parse(value)
              : value;
          })
        ),
      };
    }
    const result = statement.run(...bound);
    return {
      rows: [
        {
          insertId: Number(result.lastInsertRowid),
          affectedRows: Number(result.changes),
        },
      ],
    };
  });
  Object.defineProperty(db, "transaction", {
    value: async <T>(run: (tx: typeof db) => Promise<T>) => {
      if (inTransaction)
        throw new Error("Nested fixture transaction unsupported");
      sqlite.exec("BEGIN");
      inTransaction = true;
      try {
        const result = await run(db);
        sqlite.exec("COMMIT");
        return result;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      } finally {
        inTransaction = false;
      }
    },
  });
  return {
    db,
    sqlite,
    queries,
    insert(table: MySqlTable, values: Record<string, SQLInputValue>) {
      const columns = Object.keys(values);
      sqlite
        .prepare(
          `INSERT INTO \`${getTableName(table)}\` (${columns.map(column => `\`${column}\``).join(",")}) VALUES (${columns.map(() => "?").join(",")})`
        )
        .run(
          ...Object.values(values).map(value =>
            typeof value === "string" &&
            /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
              ? value + ".000"
              : value
          )
        );
    },
    rows(table: MySqlTable) {
      return sqlite.prepare(`SELECT * FROM \`${getTableName(table)}\``).all();
    },
    close() {
      sqlite.close();
    },
  };
}
