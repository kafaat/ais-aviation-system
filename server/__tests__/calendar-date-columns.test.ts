/**
 * Dates of birth and document expiries are calendar dates far outside the
 * MySQL TIMESTAMP range (1970-01-01 to 2038-01-19). Stored as TIMESTAMP, a
 * passenger born in 1965 or a passport expiring in 2039 made the INSERT
 * fail under strict mode and aborted the whole booking transaction. These
 * columns must stay DATETIME, and no new column of that kind may regress.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { is } from "drizzle-orm";
import { getTableConfig, MySqlTable } from "drizzle-orm/mysql-core";
import * as schema from "../../drizzle/schema";

const calendarColumns = [
  ["passengers", "dateOfBirth"],
  ["passengers", "passportExpiry"],
  ["saved_passengers", "dateOfBirth"],
  ["saved_passengers", "passportExpiry"],
  ["user_preferences", "passportExpiry"],
  ["crew_members", "licenseExpiry"],
  ["crew_members", "medicalExpiry"],
] as const;

const tables = Object.values(schema).filter(value => is(value, MySqlTable));
const columnType = (tableName: string, columnName: string) => {
  for (const table of tables) {
    try {
      const config = getTableConfig(table);
      if (config.name !== tableName) continue;
      const column = config.columns.find(c => c.name === columnName);
      return column?.getSQLType();
    } catch {
      /* not a table */
    }
  }
  return undefined;
};

describe("calendar date columns", () => {
  it.each(calendarColumns)(
    "%s.%s is a DATETIME, not a TIMESTAMP",
    (table, column) => {
      expect(columnType(table, column)).toBe("datetime");
    }
  );

  it("no column named like a birth date or document expiry uses TIMESTAMP", () => {
    const offenders: string[] = [];
    for (const table of tables) {
      let config;
      try {
        config = getTableConfig(table);
      } catch {
        continue;
      }
      for (const column of config.columns)
        if (
          /dateOfBirth|birthDate|Expiry$|ExpiryDate$/.test(column.name) &&
          column.getSQLType().startsWith("timestamp")
        )
          offenders.push(`${config.name}.${column.name}`);
    }
    expect(offenders).toEqual([]);
  });

  it("the migration rewrites exactly these columns under a UTC session", () => {
    const sql = readFileSync(
      new URL(
        "../../drizzle/0056_date_of_birth_and_expiry_datetime.sql",
        import.meta.url
      ),
      "utf8"
    );
    expect(sql.indexOf("SET time_zone = '+00:00'")).toBeGreaterThanOrEqual(0);
    expect(sql.indexOf("SET time_zone")).toBeLessThan(sql.indexOf("ALTER"));
    const rewritten = [
      ...sql.matchAll(/ALTER TABLE `(\w+)` MODIFY COLUMN `(\w+)` datetime;/g),
    ]
      .map(m => `${m[1]}.${m[2]}`)
      .sort();
    expect(rewritten).toEqual(
      calendarColumns.map(([t, c]) => `${t}.${c}`).sort()
    );
  });
});
