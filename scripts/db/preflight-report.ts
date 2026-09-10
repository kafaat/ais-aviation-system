import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createConnection, type RowDataPacket } from "mysql2/promise";
import {
  appliedMigrationCount,
  differences,
  readDatabaseContract,
  readHistory,
  snapshotContract,
} from "./schema-contract";
import { runMigration } from "./migrate";

type Classification = "pass" | "fail";

type CliOptions = {
  targetSha: string;
  approvedSha: string | null;
  context: string;
  reportDir: string;
};

type Report = {
  generatedAt: string;
  classification: Classification;
  requestedSha: string;
  checkedOutSha: string;
  approvedSha: string | null;
  productionContext: string;
  command: string;
  repository: {
    expectedMigrationCount: number;
    latestMigrationTag: string;
  };
  database: {
    schemaName: string | null;
    migrationTablePresent: boolean;
    actualMigrationCount: number;
    verifiedAppliedCount: number | null;
    pendingMigrationCount: number | null;
  };
  schema: {
    appliedSnapshotTableCount: number | null;
    targetSnapshotTableCount: number;
    actualTableCount: number | null;
    appliedSnapshotDiffCount: number | null;
  };
  migrationHistory: {
    expectedEntries: Array<{ idx: number; tag: string; when: number; hash: string }>;
    actualEntries: Array<{ id: number; createdAt: number; hash: string }>;
  };
  preflight: {
    status: "PASS" | "FAIL";
    error: string | null;
  };
};

function sanitizeError(error: unknown, databaseUrl: string): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replaceAll(databaseUrl, "[DATABASE_URL]");
}

export function parseArgs(argv: string[]): CliOptions {
  const args = new Map(
    argv.map(arg => {
      const separator = arg.indexOf("=");
      return separator >= 0
        ? [arg.slice(0, separator), arg.slice(separator + 1)]
        : [arg, ""];
    })
  );

  const targetSha = args.get("--target-sha");
  if (!targetSha || !/^[0-9a-f]{40}$/i.test(targetSha)) {
    throw new Error("TARGET_SHA_INVALID: expected --target-sha=<40-hex-sha>");
  }

  const approvedSha = args.get("--approved-sha");
  if (approvedSha && !/^[0-9a-f]{40}$/i.test(approvedSha)) {
    throw new Error("APPROVED_SHA_INVALID: expected a 40-character commit SHA");
  }

  return {
    targetSha: targetSha.toLowerCase(),
    approvedSha: approvedSha?.toLowerCase() ?? null,
    context: args.get("--context") || process.env.PREFLIGHT_CONTEXT || "production",
    reportDir:
      args.get("--report-dir") ||
      process.env.PREFLIGHT_REPORT_DIR ||
      "artifacts/db-preflight",
  };
}

export function readCheckedOutSha(
  readStdout: (command: string, args: string[]) => string = (command, args) =>
    execFileSync(command, args, { encoding: "utf8" }).trim()
): string {
  const sha = readStdout("git", ["rev-parse", "HEAD"]).trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(sha)) {
    throw new Error("CHECKED_OUT_SHA_INVALID: git rev-parse HEAD did not return a full SHA");
  }
  return sha;
}

export function assertApprovedSha(
  label: "TARGET_SHA" | "APPROVED_SHA",
  expectedSha: string,
  actualSha: string
): void {
  if (expectedSha.toLowerCase() !== actualSha.toLowerCase()) {
    throw new Error(
      `${label}_MISMATCH: expected ${expectedSha.toLowerCase()} but checked out ${actualSha.toLowerCase()}`
    );
  }
}

async function readActualMigrationHistory(
  connection: Awaited<ReturnType<typeof createConnection>>
): Promise<Array<{ id: number; createdAt: number; hash: string }>> {
  const [tables] = await connection.query<RowDataPacket[]>(
    "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '__drizzle_migrations'"
  );
  if (!tables.length) {
    return [];
  }

  const [rows] = await connection.query<RowDataPacket[]>(
    "SELECT id, hash, created_at FROM __drizzle_migrations ORDER BY id"
  );
  return rows.map(row => ({
    id: Number(row.id),
    createdAt: Number(row.created_at),
    hash: String(row.hash),
  }));
}

function buildMarkdownReport(report: Report): string {
  return `# Production Database Preflight Report

- Classification: **${report.classification.toUpperCase()}**
- Requested SHA: \`${report.requestedSha}\`
- Checked-out SHA: \`${report.checkedOutSha}\`
- Approved SHA: \`${report.approvedSha ?? "n/a"}\`
- Generated at: \`${report.generatedAt}\`
- Production context: \`${report.productionContext}\`
- Command: \`${report.command}\`

## Summary

| Metric | Value |
| --- | ---: |
| Expected migrations | ${report.repository.expectedMigrationCount} |
| Actual migration rows | ${report.database.actualMigrationCount} |
| Verified applied migrations | ${report.database.verifiedAppliedCount ?? "n/a"} |
| Pending migrations | ${report.database.pendingMigrationCount ?? "n/a"} |
| Target snapshot tables | ${report.schema.targetSnapshotTableCount} |
| Applied snapshot tables | ${report.schema.appliedSnapshotTableCount ?? "n/a"} |
| Actual tables | ${report.schema.actualTableCount ?? "n/a"} |
| Applied snapshot drift entries | ${report.schema.appliedSnapshotDiffCount ?? "n/a"} |

## Preflight

- Status: **${report.preflight.status}**
- Error: ${report.preflight.error ?? "none"}

## Expected migration history

\`\`\`json
${JSON.stringify(report.migrationHistory.expectedEntries, null, 2)}
\`\`\`

## Actual migration history

\`\`\`json
${JSON.stringify(report.migrationHistory.actualEntries, null, 2)}
\`\`\`

## Notes

- This report includes migration hashes and timestamps, not database credentials or customer data.
- The approved migration guard remains authoritative for preflight, migrate, and verify behavior.
`;
}

export async function writePreflightReport(
  options: CliOptions,
  databaseUrl: string
): Promise<Report> {
  const checkedOutSha = readCheckedOutSha();
  assertApprovedSha("TARGET_SHA", options.targetSha, checkedOutSha);
  if (options.approvedSha) {
    assertApprovedSha("APPROVED_SHA", options.approvedSha, checkedOutSha);
  }

  const history = readHistory();
  const latest = history.at(-1);
  if (!latest) {
    throw new Error("EMPTY_MIGRATION_HISTORY");
  }

  let preflightError: string | null = null;
  try {
    await runMigration("preflight", databaseUrl);
  } catch (error) {
    preflightError = sanitizeError(error, databaseUrl);
  }

  const connection = await createConnection({
    uri: databaseUrl,
    multipleStatements: false,
    connectTimeout: 10000,
  });

  try {
    const [database] = await connection.query<RowDataPacket[]>(
      "SELECT DATABASE() AS name"
    );
    const actualHistory = await readActualMigrationHistory(connection);

    let verifiedAppliedCount: number | null = null;
    try {
      verifiedAppliedCount = await appliedMigrationCount(connection, history);
    } catch {
      verifiedAppliedCount = null;
    }

    let actualTableCount: number | null = null;
    let appliedSnapshotTableCount: number | null = null;
    let appliedSnapshotDiffCount: number | null = null;

    try {
      const actualContract = await readDatabaseContract(connection);
      actualTableCount = Object.keys(actualContract).length;
      if (verifiedAppliedCount !== null) {
        const appliedContract = verifiedAppliedCount
          ? snapshotContract(history[verifiedAppliedCount - 1].snapshot)
          : {};
        appliedSnapshotTableCount = Object.keys(appliedContract).length;
        appliedSnapshotDiffCount = differences(
          appliedContract,
          actualContract
        ).length;
      }
    } catch {
      actualTableCount = null;
    }

    const report: Report = {
      generatedAt: new Date().toISOString(),
      classification: preflightError ? "fail" : "pass",
      requestedSha: options.targetSha,
      checkedOutSha,
      approvedSha: options.approvedSha,
      productionContext: options.context,
      command: "node --import tsx scripts/db/migrate.ts preflight",
      repository: {
        expectedMigrationCount: history.length,
        latestMigrationTag: latest.tag,
      },
      database: {
        schemaName: database[0]?.name ? String(database[0].name) : null,
        migrationTablePresent: actualHistory.length > 0,
        actualMigrationCount: actualHistory.length,
        verifiedAppliedCount,
        pendingMigrationCount:
          verifiedAppliedCount === null ? null : history.length - verifiedAppliedCount,
      },
      schema: {
        appliedSnapshotTableCount,
        targetSnapshotTableCount: Object.keys(
          snapshotContract(latest.snapshot)
        ).length,
        actualTableCount,
        appliedSnapshotDiffCount,
      },
      migrationHistory: {
        expectedEntries: history.map(({ idx, tag, when, hash }) => ({
          idx,
          tag,
          when,
          hash,
        })),
        actualEntries: actualHistory,
      },
      preflight: {
        status: preflightError ? "FAIL" : "PASS",
        error: preflightError,
      },
    };

    mkdirSync(options.reportDir, { recursive: true });
    writeFileSync(
      join(options.reportDir, "preflight-report.json"),
      JSON.stringify(report, null, 2)
    );
    writeFileSync(
      join(options.reportDir, "preflight-report.md"),
      buildMarkdownReport(report)
    );
    writeFileSync(
      join(options.reportDir, "summary.txt"),
      report.classification,
      "utf8"
    );

    if (process.env.GITHUB_STEP_SUMMARY) {
      writeFileSync(
        process.env.GITHUB_STEP_SUMMARY,
        `${buildMarkdownReport(report)}\n`,
        { flag: "a" }
      );
    }

    console.info(JSON.stringify(report, null, 2));

    if (preflightError) {
      process.exitCode = 1;
    }

    return report;
  } finally {
    await connection.end();
  }
}

export async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  const options = parseArgs(process.argv.slice(2));
  await writePreflightReport(options, databaseUrl);
}

if (process.argv.slice(2).some(arg => arg.startsWith("--target-sha="))) {
  main().catch(error => {
    console.error(
      error instanceof Error
        ? sanitizeError(error, process.env.DATABASE_URL ?? "")
        : "Preflight report failed"
    );
    process.exit(1);
  });
}
