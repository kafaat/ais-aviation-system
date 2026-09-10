#!/usr/bin/env node

import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { getTableName, isTable } from "drizzle-orm/table";
import mysql from "mysql2/promise";

type JournalEntry = {
  idx: number;
  tag: string;
  when?: number;
  version?: string;
};

type Journal = {
  entries: JournalEntry[];
};

type SnapshotColumn = {
  name: string;
  type: string;
  notNull?: boolean;
  default?: unknown;
  autoincrement?: boolean;
};

type SnapshotTable = {
  name: string;
  columns: Record<string, SnapshotColumn>;
};

type Snapshot = {
  tables: Record<string, SnapshotTable>;
};

type ActualColumnRow = {
  tableName: string;
  columnName: string;
  columnType: string;
  isNullable: "YES" | "NO";
  columnDefault: string | number | null;
  extra: string | null;
};

type Severity = "warn" | "fail";
type Classification = "pass" | "warn" | "fail";

type Deviation = {
  severity: Severity;
  code:
    | "repo_journal_mismatch"
    | "repo_unmigrated_declared_tables"
    | "repo_migrated_tables_not_declared"
    | "database_migration_table_missing"
    | "database_migration_count_mismatch"
    | "database_missing_tables"
    | "database_unexpected_tables"
    | "database_missing_columns"
    | "database_unexpected_columns"
    | "database_column_definition_mismatch";
  message: string;
  details?: Record<string, unknown>;
};

type PreflightReport = {
  generatedAt: string;
  gitSha: string;
  productionContext: string;
  githubEnvironment: string | null;
  classification: Classification;
  command: string;
  summary: {
    declaredSchemaTableCount: number;
    migrationTableCount: number;
    productionTableCount: number;
    expectedMigrationCount: number;
    appliedMigrationCount: number;
    deviationCount: number;
    failureCount: number;
    warningCount: number;
  };
  repository: {
    migrationJournalPath: string;
    latestSnapshotPath: string;
    latestMigrationTag: string | null;
  };
  database: {
    schemaName: string | null;
    serverVersion: string | null;
    sslRequested: boolean;
    migrationTablePresent: boolean;
  };
  deviations: Deviation[];
};

const SYSTEM_TABLES = new Set(["__drizzle_migrations"]);

function getRepoRoot(): string {
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  return resolve(scriptDir, "..", "..");
}

function extractDeclaredSchemaTables(
  schemaModule: Record<string, unknown>
): string[] {
  const tableNames = Object.values(schemaModule)
    .filter(isTable)
    .map(table => getTableName(table))
    .filter(tableName => !SYSTEM_TABLES.has(tableName));

  return [...new Set(tableNames)].sort();
}

function sslModeRequiresTls(value: string | null): boolean {
  if (!value) {
    return false;
  }

  return new Set([
    "1",
    "true",
    "require",
    "required",
    "verify-ca",
    "verify-full",
  ]).has(value.trim().toLowerCase());
}

function parseDatabaseConnectionConfig(databaseUrl: string): {
  connectionConfig: mysql.ConnectionOptions;
  sslRequested: boolean;
} {
  const url = new URL(databaseUrl);
  const sslRequested =
    sslModeRequiresTls(url.searchParams.get("ssl")) ||
    sslModeRequiresTls(url.searchParams.get("sslmode")) ||
    sslModeRequiresTls(url.searchParams.get("tls"));

  return {
    connectionConfig: {
      host: url.hostname,
      port: url.port ? Number(url.port) : 3306,
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      database: decodeURIComponent(url.pathname.replace(/^\//, "")),
      ssl: sslRequested ? {} : undefined,
    },
    sslRequested,
  };
}

function normalizeType(value: string): string {
  return value.toLowerCase().replace(/\s+/g, "");
}

function normalizeDefault(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value === "boolean") {
    return value ? "1" : "0";
  }

  if (typeof value === "number" || typeof value === "bigint") {
    return String(value);
  }

  return String(value)
    .trim()
    .toLowerCase()
    .replace(/^\((.*)\)$/, "$1")
    .replace(/^'(.*)'$/, "$1")
    .replace(/current_timestamp\(\)/g, "current_timestamp")
    .replace(/now\(\)/g, "current_timestamp");
}

function typesEquivalent(expected: string, actual: string): boolean {
  const expectedType = normalizeType(expected);
  const actualType = normalizeType(actual);

  if (expectedType === actualType) {
    return true;
  }

  const booleanTypes = new Set(["boolean", "bool", "tinyint(1)"]);
  if (booleanTypes.has(expectedType) && booleanTypes.has(actualType)) {
    return true;
  }

  return false;
}

function defaultsEquivalent(expected: unknown, actual: unknown): boolean {
  return normalizeDefault(expected) === normalizeDefault(actual);
}

async function loadAuthoritativeMetadata(repoRoot: string): Promise<{
  declaredSchemaTables: string[];
  executableMigrations: string[];
  journal: Journal;
  snapshot: Snapshot;
  latestTag: string | null;
  latestSnapshotPath: string;
  journalPath: string;
}> {
  const drizzleDir = join(repoRoot, "drizzle");
  const journalPath = join(drizzleDir, "meta", "_journal.json");

  const schemaModulePath = pathToFileURL(join(drizzleDir, "schema.ts")).href;
  const [schemaModule, journalSource, drizzleEntries] = await Promise.all([
    import(schemaModulePath),
    readFile(journalPath, "utf8"),
    readdir(drizzleDir),
  ]);

  const declaredSchemaTables = extractDeclaredSchemaTables(schemaModule);
  const executableMigrations = drizzleEntries
    .filter(name => /^\d{4}_.+\.sql$/.test(name))
    .sort();
  const journal = JSON.parse(journalSource) as Journal;
  const latestTag = journal.entries.at(-1)?.tag ?? null;

  if (!latestTag) {
    throw new Error("No authoritative Drizzle journal entry was found.");
  }

  const tagPrefix = latestTag.match(/^(\d{4})_/)?.[1];
  if (!tagPrefix) {
    throw new Error(`Unable to resolve snapshot name from tag "${latestTag}".`);
  }

  const latestSnapshotPath = join(
    drizzleDir,
    "meta",
    `${tagPrefix}_snapshot.json`
  );
  const snapshot = JSON.parse(
    await readFile(latestSnapshotPath, "utf8")
  ) as Snapshot;

  return {
    declaredSchemaTables,
    executableMigrations,
    journal,
    snapshot,
    latestTag,
    latestSnapshotPath,
    journalPath,
  };
}

async function queryActualSchema(connection: mysql.Connection): Promise<{
  schemaName: string | null;
  serverVersion: string | null;
  migrationTablePresent: boolean;
  appliedMigrationCount: number;
  tables: string[];
  columnsByTable: Map<string, Map<string, ActualColumnRow>>;
}> {
  const [contextRows] = await connection.query<
    Array<{ schemaName: string | null; serverVersion: string | null }>
  >(`SELECT DATABASE() AS schemaName, VERSION() AS serverVersion`);

  const schemaName = contextRows[0]?.schemaName ?? null;
  const serverVersion = contextRows[0]?.serverVersion ?? null;

  const [migrationRows] = await connection.query<Array<{ count: number }>>(
    `
      SELECT COUNT(*) AS count
      FROM information_schema.tables
      WHERE table_schema = DATABASE()
        AND table_name = '__drizzle_migrations'
    `
  );

  const migrationTablePresent = Number(migrationRows[0]?.count ?? 0) > 0;
  let appliedMigrationCount = 0;

  if (migrationTablePresent) {
    const [countRows] = await connection.query<Array<{ count: number }>>(
      "SELECT COUNT(*) AS count FROM `__drizzle_migrations`"
    );
    appliedMigrationCount = Number(countRows[0]?.count ?? 0);
  }

  const [tableRows] = await connection.query<Array<{ tableName: string }>>(
    `
      SELECT table_name AS tableName
      FROM information_schema.tables
      WHERE table_schema = DATABASE()
      ORDER BY table_name
    `
  );

  const tables = tableRows
    .map(row => row.tableName)
    .filter(tableName => !SYSTEM_TABLES.has(tableName));

  const [columnRows] = await connection.query<Array<ActualColumnRow>>(
    `
      SELECT
        table_name AS tableName,
        column_name AS columnName,
        column_type AS columnType,
        is_nullable AS isNullable,
        column_default AS columnDefault,
        extra AS extra
      FROM information_schema.columns
      WHERE table_schema = DATABASE()
      ORDER BY table_name, ordinal_position
    `
  );

  const columnsByTable = new Map<string, Map<string, ActualColumnRow>>();
  for (const row of columnRows) {
    if (SYSTEM_TABLES.has(row.tableName)) {
      continue;
    }

    const tableColumns =
      columnsByTable.get(row.tableName) ?? new Map<string, ActualColumnRow>();
    tableColumns.set(row.columnName, row);
    columnsByTable.set(row.tableName, tableColumns);
  }

  return {
    schemaName,
    serverVersion,
    migrationTablePresent,
    appliedMigrationCount,
    tables,
    columnsByTable,
  };
}

function comparePreflightState(input: {
  declaredSchemaTables: string[];
  executableMigrations: string[];
  journal: Journal;
  snapshot: Snapshot;
  latestTag: string | null;
  actual: {
    migrationTablePresent: boolean;
    appliedMigrationCount: number;
    tables: string[];
    columnsByTable: Map<string, Map<string, ActualColumnRow>>;
  };
}): Deviation[] {
  const deviations: Deviation[] = [];

  const journalSql = input.journal.entries
    .map(entry => `${entry.tag}.sql`)
    .sort();
  if (
    input.executableMigrations.length !== journalSql.length ||
    input.executableMigrations.some(
      (fileName, index) => fileName !== journalSql[index]
    )
  ) {
    deviations.push({
      severity: "fail",
      code: "repo_journal_mismatch",
      message:
        "Executable Drizzle SQL files do not match the authoritative journal entries.",
      details: {
        executableMigrations: input.executableMigrations,
        journalSql,
      },
    });
  }

  const migrationTables = Object.keys(input.snapshot.tables).sort();
  const declaredSet = new Set(input.declaredSchemaTables);
  const migrationSet = new Set(migrationTables);
  const actualSet = new Set(input.actual.tables);

  const unmigratedDeclaredTables = input.declaredSchemaTables.filter(
    tableName => !migrationSet.has(tableName)
  );
  if (unmigratedDeclaredTables.length > 0) {
    deviations.push({
      severity: "fail",
      code: "repo_unmigrated_declared_tables",
      message:
        "Declared application tables are not covered by the authoritative migration snapshot for this SHA.",
      details: {
        missingFromMigrations: unmigratedDeclaredTables,
      },
    });
  }

  const migratedButUndeclaredTables = migrationTables.filter(
    tableName => !declaredSet.has(tableName)
  );
  if (migratedButUndeclaredTables.length > 0) {
    deviations.push({
      severity: "warn",
      code: "repo_migrated_tables_not_declared",
      message:
        "Authoritative migrations contain tables that are not declared in drizzle/schema.ts.",
      details: {
        missingFromSchema: migratedButUndeclaredTables,
      },
    });
  }

  if (!input.actual.migrationTablePresent) {
    deviations.push({
      severity: "fail",
      code: "database_migration_table_missing",
      message:
        "Production schema does not expose the __drizzle_migrations table to the read-only preflight.",
    });
  } else if (
    input.actual.appliedMigrationCount !== input.journal.entries.length
  ) {
    deviations.push({
      severity: "fail",
      code: "database_migration_count_mismatch",
      message:
        "Production applied migration count does not match the authoritative journal entry count for this SHA.",
      details: {
        expectedAppliedMigrations: input.journal.entries.length,
        actualAppliedMigrations: input.actual.appliedMigrationCount,
        latestMigrationTag: input.latestTag,
      },
    });
  }

  const missingTables = migrationTables.filter(
    tableName => !actualSet.has(tableName)
  );
  if (missingTables.length > 0) {
    deviations.push({
      severity: "fail",
      code: "database_missing_tables",
      message:
        "Production schema is missing tables required by the authoritative migration snapshot.",
      details: {
        missingTables,
      },
    });
  }

  const unexpectedTables = input.actual.tables.filter(
    tableName => !migrationSet.has(tableName)
  );
  if (unexpectedTables.length > 0) {
    deviations.push({
      severity: "warn",
      code: "database_unexpected_tables",
      message:
        "Production schema contains extra tables outside the authoritative migration snapshot.",
      details: {
        unexpectedTables,
      },
    });
  }

  for (const tableName of migrationTables) {
    if (!actualSet.has(tableName)) {
      continue;
    }

    const expectedColumns = Object.values(
      input.snapshot.tables[tableName]?.columns ?? {}
    );
    const expectedColumnMap = new Map(
      expectedColumns.map(column => [column.name, column] as const)
    );
    const actualColumnMap =
      input.actual.columnsByTable.get(tableName) ?? new Map();

    const missingColumns = expectedColumns
      .map(column => column.name)
      .filter(columnName => !actualColumnMap.has(columnName));
    if (missingColumns.length > 0) {
      deviations.push({
        severity: "fail",
        code: "database_missing_columns",
        message: `Production table "${tableName}" is missing expected columns.`,
        details: {
          tableName,
          missingColumns,
        },
      });
    }

    const unexpectedColumns = [...actualColumnMap.keys()].filter(
      columnName => !expectedColumnMap.has(columnName)
    );
    if (unexpectedColumns.length > 0) {
      deviations.push({
        severity: "warn",
        code: "database_unexpected_columns",
        message: `Production table "${tableName}" contains unexpected columns.`,
        details: {
          tableName,
          unexpectedColumns,
        },
      });
    }

    const mismatchedColumns = expectedColumns
      .map(column => {
        const actualColumn = actualColumnMap.get(column.name);
        if (!actualColumn) {
          return null;
        }

        const issues: string[] = [];
        if (!typesEquivalent(column.type, actualColumn.columnType)) {
          issues.push(
            `type expected ${column.type} but found ${actualColumn.columnType}`
          );
        }

        const expectedNullable = column.notNull ? "NO" : "YES";
        if (expectedNullable !== actualColumn.isNullable) {
          issues.push(
            `nullability expected ${expectedNullable} but found ${actualColumn.isNullable}`
          );
        }

        if (!defaultsEquivalent(column.default, actualColumn.columnDefault)) {
          issues.push(
            `default expected ${normalizeDefault(column.default)} but found ${normalizeDefault(actualColumn.columnDefault)}`
          );
        }

        const expectedAutoIncrement = Boolean(column.autoincrement);
        const actualAutoIncrement =
          actualColumn.extra?.includes("auto_increment") ?? false;
        if (expectedAutoIncrement !== actualAutoIncrement) {
          issues.push(
            `autoincrement expected ${expectedAutoIncrement} but found ${actualAutoIncrement}`
          );
        }

        if (issues.length === 0) {
          return null;
        }

        return {
          columnName: column.name,
          issues,
        };
      })
      .filter(
        (value): value is { columnName: string; issues: string[] } =>
          value !== null
      );

    if (mismatchedColumns.length > 0) {
      deviations.push({
        severity: "fail",
        code: "database_column_definition_mismatch",
        message: `Production table "${tableName}" has column definitions that drift from the authoritative migration snapshot.`,
        details: {
          tableName,
          mismatchedColumns,
        },
      });
    }
  }

  return deviations;
}

function classifyDeviations(deviations: Deviation[]): Classification {
  if (deviations.some(deviation => deviation.severity === "fail")) {
    return "fail";
  }

  if (deviations.length > 0) {
    return "warn";
  }

  return "pass";
}

function buildMarkdownReport(report: PreflightReport): string {
  const lines = [
    "# Production Database Preflight Report",
    "",
    `- Classification: **${report.classification.toUpperCase()}**`,
    `- Git SHA: \`${report.gitSha}\``,
    `- Generated at: \`${report.generatedAt}\``,
    `- Production context: \`${report.productionContext}\``,
    `- GitHub environment: \`${report.githubEnvironment ?? "n/a"}\``,
    `- Database schema: \`${report.database.schemaName ?? "unknown"}\``,
    `- Server version: \`${report.database.serverVersion ?? "unknown"}\``,
    `- Command: \`${report.command}\``,
    "",
    "## Summary",
    "",
    "| Metric | Value |",
    "| --- | ---: |",
    `| Declared schema tables | ${report.summary.declaredSchemaTableCount} |`,
    `| Migration snapshot tables | ${report.summary.migrationTableCount} |`,
    `| Production tables | ${report.summary.productionTableCount} |`,
    `| Expected migrations | ${report.summary.expectedMigrationCount} |`,
    `| Applied migrations | ${report.summary.appliedMigrationCount} |`,
    `| Deviations | ${report.summary.deviationCount} |`,
    `| Failures | ${report.summary.failureCount} |`,
    `| Warnings | ${report.summary.warningCount} |`,
    "",
    "## Deviations",
    "",
  ];

  if (report.deviations.length === 0) {
    lines.push("- No deviations detected.");
  } else {
    for (const deviation of report.deviations) {
      lines.push(
        `- **${deviation.severity.toUpperCase()} · ${deviation.code}** — ${deviation.message}`
      );
      if (deviation.details) {
        lines.push("  ```json");
        lines.push(
          ...JSON.stringify(deviation.details, null, 2)
            .split("\n")
            .map(line => `  ${line}`)
        );
        lines.push("  ```");
      }
    }
  }

  lines.push(
    "",
    "## Notes",
    "",
    "- This report excludes passwords, secrets, and customer-row data.",
    "- Results are derived from repository metadata, `information_schema`, and `__drizzle_migrations` only."
  );

  return `${lines.join("\n")}\n`;
}

async function runPreflight(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for the preflight command.");
  }

  const repoRoot = getRepoRoot();
  const metadata = await loadAuthoritativeMetadata(repoRoot);
  const reportDir = resolve(
    repoRoot,
    process.env.PREFLIGHT_REPORT_DIR ?? "artifacts/db-preflight"
  );
  const productionContext = process.env.PREFLIGHT_CONTEXT ?? "production";
  const githubEnvironment = process.env.GITHUB_ENVIRONMENT_NAME ?? null;
  const gitSha = process.env.GITHUB_SHA ?? "unknown";
  const { connectionConfig, sslRequested } =
    parseDatabaseConnectionConfig(databaseUrl);

  const connection = await mysql.createConnection(connectionConfig);
  try {
    const actual = await queryActualSchema(connection);
    const deviations = comparePreflightState({
      declaredSchemaTables: metadata.declaredSchemaTables,
      executableMigrations: metadata.executableMigrations,
      journal: metadata.journal,
      snapshot: metadata.snapshot,
      latestTag: metadata.latestTag,
      actual,
    });
    const classification = classifyDeviations(deviations);

    const report: PreflightReport = {
      generatedAt: new Date().toISOString(),
      gitSha,
      productionContext,
      githubEnvironment,
      classification,
      command: "node --import tsx scripts/db/migrate.ts preflight",
      summary: {
        declaredSchemaTableCount: metadata.declaredSchemaTables.length,
        migrationTableCount: Object.keys(metadata.snapshot.tables).length,
        productionTableCount: actual.tables.length,
        expectedMigrationCount: metadata.journal.entries.length,
        appliedMigrationCount: actual.appliedMigrationCount,
        deviationCount: deviations.length,
        failureCount: deviations.filter(
          deviation => deviation.severity === "fail"
        ).length,
        warningCount: deviations.filter(
          deviation => deviation.severity === "warn"
        ).length,
      },
      repository: {
        migrationJournalPath: "drizzle/meta/_journal.json",
        latestSnapshotPath: metadata.latestSnapshotPath.replace(
          `${repoRoot}/`,
          ""
        ),
        latestMigrationTag: metadata.latestTag,
      },
      database: {
        schemaName: actual.schemaName,
        serverVersion: actual.serverVersion,
        sslRequested,
        migrationTablePresent: actual.migrationTablePresent,
      },
      deviations,
    };

    await mkdir(reportDir, { recursive: true });

    const jsonPath = join(reportDir, "preflight-report.json");
    const markdownPath = join(reportDir, "preflight-report.md");
    const summaryPath = join(reportDir, "summary.txt");
    const markdown = buildMarkdownReport(report);

    await Promise.all([
      writeFile(jsonPath, JSON.stringify(report, null, 2)),
      writeFile(markdownPath, markdown),
      writeFile(summaryPath, classification),
    ]);

    if (process.env.GITHUB_STEP_SUMMARY) {
      await writeFile(process.env.GITHUB_STEP_SUMMARY, markdown, { flag: "a" });
    }

    console.info(
      JSON.stringify(
        {
          classification,
          gitSha,
          productionContext,
          schemaName: report.database.schemaName,
          deviationCount: report.summary.deviationCount,
          failureCount: report.summary.failureCount,
          warningCount: report.summary.warningCount,
          reportDir: reportDir.replace(`${repoRoot}/`, ""),
        },
        null,
        2
      )
    );

    if (classification === "fail") {
      process.exitCode = 1;
    }
  } finally {
    await connection.end();
  }
}

async function main(): Promise<void> {
  const command = process.argv[2];

  if (command !== "preflight") {
    throw new Error(
      'Unsupported command. Use "node --import tsx scripts/db/migrate.ts preflight".'
    );
  }

  await runPreflight();
}

const executedScriptPath = process.argv[1] ? resolve(process.argv[1]) : null;
const currentScriptPath = fileURLToPath(import.meta.url);

if (executedScriptPath === currentScriptPath) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}

export {
  buildMarkdownReport,
  classifyDeviations,
  comparePreflightState,
  defaultsEquivalent,
  extractDeclaredSchemaTables,
  normalizeDefault,
  parseDatabaseConnectionConfig,
  typesEquivalent,
};
