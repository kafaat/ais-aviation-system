import { describe, expect, it } from "vitest";
import {
  buildMarkdownReport,
  classifyDeviations,
  comparePreflightState,
  defaultsEquivalent,
  parseDeclaredSchemaTables,
  typesEquivalent,
} from "./migrate";

describe("parseDeclaredSchemaTables", () => {
  it("extracts unique table names from drizzle/schema.ts source", () => {
    const source = `
      export const users = mysqlTable("users", {});
      export const bookings = mysqlTable("bookings", {});
      export const usersCopy = mysqlTable("users", {});
    `;

    expect(parseDeclaredSchemaTables(source)).toEqual(["bookings", "users"]);
  });
});

describe("comparePreflightState", () => {
  it("flags repository and production drift with failures and warnings", () => {
    const deviations = comparePreflightState({
      declaredSchemaTables: ["bookings", "users", "waitlist"],
      executableMigrations: ["0000_alpha.sql"],
      journal: {
        entries: [{ idx: 0, tag: "0000_alpha" }],
      },
      latestTag: "0000_alpha",
      snapshot: {
        tables: {
          users: {
            name: "users",
            columns: {
              id: {
                name: "id",
                type: "int",
                notNull: true,
                autoincrement: true,
              },
              isActive: {
                name: "isActive",
                type: "boolean",
                notNull: true,
                default: true,
              },
            },
          },
        },
      },
      actual: {
        migrationTablePresent: true,
        appliedMigrationCount: 0,
        tables: ["legacy_table", "users"],
        columnsByTable: new Map([
          [
            "users",
            new Map([
              [
                "id",
                {
                  tableName: "users",
                  columnName: "id",
                  columnType: "int",
                  isNullable: "NO",
                  columnDefault: null,
                  extra: "",
                },
              ],
              [
                "isActive",
                {
                  tableName: "users",
                  columnName: "isActive",
                  columnType: "tinyint(1)",
                  isNullable: "YES",
                  columnDefault: "0",
                  extra: "",
                },
              ],
              [
                "legacyFlag",
                {
                  tableName: "users",
                  columnName: "legacyFlag",
                  columnType: "tinyint(1)",
                  isNullable: "YES",
                  columnDefault: null,
                  extra: "",
                },
              ],
            ]),
          ],
        ]),
      },
    });

    expect(classifyDeviations(deviations)).toBe("fail");
    expect(deviations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "repo_unmigrated_declared_tables",
          severity: "fail",
        }),
        expect.objectContaining({
          code: "database_migration_count_mismatch",
          severity: "fail",
        }),
        expect.objectContaining({
          code: "database_unexpected_tables",
          severity: "warn",
        }),
        expect.objectContaining({
          code: "database_unexpected_columns",
          severity: "warn",
        }),
        expect.objectContaining({
          code: "database_column_definition_mismatch",
          severity: "fail",
        }),
      ])
    );
  });
});

describe("schema comparison helpers", () => {
  it("treats boolean aliases and normalized timestamp defaults as equivalent", () => {
    expect(typesEquivalent("boolean", "tinyint(1)")).toBe(true);
    expect(defaultsEquivalent("(now())", "CURRENT_TIMESTAMP")).toBe(true);
  });
});

describe("buildMarkdownReport", () => {
  it("renders a redacted report without secrets", () => {
    const markdown = buildMarkdownReport({
      generatedAt: "2026-09-10T12:00:00.000Z",
      gitSha: "abcdef1234567890",
      productionContext: "production-eu",
      githubEnvironment: "production-preflight",
      classification: "warn",
      command: "node --import tsx scripts/db/migrate.ts preflight",
      summary: {
        declaredSchemaTableCount: 3,
        migrationTableCount: 2,
        productionTableCount: 2,
        expectedMigrationCount: 2,
        appliedMigrationCount: 2,
        deviationCount: 1,
        failureCount: 0,
        warningCount: 1,
      },
      repository: {
        migrationJournalPath: "drizzle/meta/_journal.json",
        latestSnapshotPath: "drizzle/meta/0001_snapshot.json",
        latestMigrationTag: "0001_beta",
      },
      database: {
        schemaName: "ais_production",
        serverVersion: "8.0.36",
        sslRequested: true,
        migrationTablePresent: true,
      },
      deviations: [
        {
          severity: "warn",
          code: "database_unexpected_tables",
          message: "Unexpected tables detected.",
          details: { unexpectedTables: ["legacy_table"] },
        },
      ],
    });

    expect(markdown).toContain("Production Database Preflight Report");
    expect(markdown).toContain("database_unexpected_tables");
    expect(markdown).not.toContain("password");
  });
});
