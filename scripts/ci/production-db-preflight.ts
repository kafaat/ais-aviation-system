import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  createConnection,
  type Connection,
  type RowDataPacket,
} from "mysql2/promise";

type Migration = {
  idx: number;
  tag: string;
  when: number;
  hash: string;
  snapshot: unknown;
};

type Contract = Record<string, unknown>;

type SchemaContractModule = {
  appliedMigrationCount(
    connection: Connection,
    history: Migration[]
  ): Promise<number>;
  differences(expected: unknown, actual: unknown, path?: string): string[];
  readDatabaseContract(connection: Connection): Promise<Contract>;
  readHistory(root?: string): Migration[];
  snapshotContract(snapshot: unknown): Contract;
};

type MigrateModule = {
  runMigration(
    command: "migrate" | "preflight" | "verify",
    url: string
  ): Promise<void>;
};

type CliOptions = {
  targetSha: string;
  approvedSha: string | null;
  context: string;
  reportDir: string;
  toolRepo: string;
};

type Report = {
  generatedAt: string;
  classification: "pass" | "fail";
  requestedSha: string;
  approvedSha: string | null;
  checkedOutSha: string;
  toolRepo: string;
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
    expectedEntries: Array<{
      idx: number;
      tag: string;
      when: number;
      hash: string;
    }>;
    actualEntries: Array<{ id: number; createdAt: number; hash: string }>;
  };
  preflight: {
    status: "PASS" | "FAIL";
    error: string | null;
  };
  evidence: {
    status: "PASS" | "FAIL";
    errors: string[];
  };
};

type PreflightDependencies = {
  createConnection?: typeof createConnection;
  loadToolModules?: typeof loadToolModules;
  readGitSha?: typeof readGitSha;
};

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

  const approvedShaArg = args.get("--approved-sha");
  const approvedSha = approvedShaArg ? approvedShaArg.trim() : "";
  const normalizedApprovedSha = approvedSha === "" ? null : approvedSha;
  if (normalizedApprovedSha && !/^[0-9a-f]{40}$/i.test(normalizedApprovedSha)) {
    throw new Error("APPROVED_SHA_INVALID: expected a 40-character commit SHA");
  }

  const toolRepo = args.get("--tool-repo");
  if (!toolRepo) {
    throw new Error("TOOL_REPO_REQUIRED: expected --tool-repo=<absolute-path>");
  }

  return {
    targetSha: targetSha.toLowerCase(),
    approvedSha: normalizedApprovedSha?.toLowerCase() ?? null,
    context:
      args.get("--context") || process.env.PREFLIGHT_CONTEXT || "production",
    reportDir:
      args.get("--report-dir") ||
      process.env.PREFLIGHT_REPORT_DIR ||
      "artifacts/db-preflight",
    toolRepo: resolve(toolRepo),
  };
}

export function readGitSha(
  cwd: string,
  readStdout: (command: string, args: string[]) => string = (command, args) =>
    execFileSync(command, args, { encoding: "utf8" }).trim()
): string {
  const sha = readStdout("git", ["-C", cwd, "rev-parse", "HEAD"])
    .trim()
    .toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(sha)) {
    throw new Error(`CHECKED_OUT_SHA_INVALID: ${cwd}`);
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

function sanitizeError(error: unknown, databaseUrl: string): string {
  const message = error instanceof Error ? error.message : String(error);
  if (!databaseUrl) {
    return message;
  }

  const tokens = new Set<string>([databaseUrl]);
  try {
    const url = new URL(databaseUrl);
    if (url.username) {
      tokens.add(url.username);
      tokens.add(decodeURIComponent(url.username));
    }
    if (url.password) {
      tokens.add(url.password);
      tokens.add(decodeURIComponent(url.password));
    }
    if (url.username || url.password) {
      tokens.add(`${url.username}:${url.password}@`);
      tokens.add(
        `${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}@`
      );
    }
  } catch {
    // Ignore URL parsing failures and fall back to whole-string replacement.
  }

  return [...tokens]
    .filter(Boolean)
    .reduce((result, token) => result.replaceAll(token, "[REDACTED]"), message);
}

async function withWorkingDirectory<T>(
  cwd: string,
  callback: () => Promise<T>
): Promise<T> {
  const previous = process.cwd();
  process.chdir(cwd);
  try {
    return await callback();
  } finally {
    process.chdir(previous);
  }
}

async function loadToolModules(
  toolRepo: string
): Promise<{ migrate: MigrateModule; schemaContract: SchemaContractModule }> {
  const migratePath = join(toolRepo, "scripts/db/migrate.ts");
  const schemaContractPath = join(toolRepo, "scripts/db/schema-contract.ts");

  if (!existsSync(migratePath) || !existsSync(schemaContractPath)) {
    throw new Error(
      "APPROVED_TOOL_MISSING: expected scripts/db/migrate.ts and scripts/db/schema-contract.ts in the approved checkout"
    );
  }

  const [migrate, schemaContract] = await Promise.all([
    import(pathToFileURL(migratePath).href),
    import(pathToFileURL(schemaContractPath).href),
  ]);

  return {
    migrate: migrate as MigrateModule,
    schemaContract: schemaContract as SchemaContractModule,
  };
}

async function readActualMigrationHistory(connection: Connection): Promise<{
  migrationTablePresent: boolean;
  rows: Array<{ id: number; createdAt: number; hash: string }>;
}> {
  const [tables] = await connection.query<RowDataPacket[]>(
    "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '__drizzle_migrations'"
  );
  if (!tables.length) {
    return { migrationTablePresent: false, rows: [] };
  }

  const [rows] = await connection.query<RowDataPacket[]>(
    "SELECT id, hash, created_at FROM __drizzle_migrations ORDER BY id"
  );

  return {
    migrationTablePresent: true,
    rows: rows.map(row => ({
      id: Number(row.id),
      createdAt: Number(row.created_at),
      hash: String(row.hash),
    })),
  };
}

function buildMarkdownReport(report: Report): string {
  return `# Production Database Preflight Report

- Classification: **${report.classification.toUpperCase()}**
- Requested SHA: \`${report.requestedSha}\`
- Checked-out SHA: \`${report.checkedOutSha}\`
- Approved SHA: \`${report.approvedSha ?? "n/a"}\`
- Approved tool repo: \`${report.toolRepo}\`
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

## Evidence inspection

- Evidence status: **${report.evidence.status}**
- Errors: ${report.evidence.errors.length ? report.evidence.errors.join("\n  - ") : "none"}

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
- Evidence is collected after preflight on a separate connection; the two observations are not an atomic database snapshot.
- Overall classification is PASS only when preflight passes and evidence inspection completes without drift.
`;
}

export async function writePreflightReport(
  options: CliOptions,
  databaseUrl: string,
  dependencies: PreflightDependencies = {}
): Promise<Report> {
  const readToolSha = dependencies.readGitSha ?? readGitSha;
  const connect = dependencies.createConnection ?? createConnection;
  const loadModules = dependencies.loadToolModules ?? loadToolModules;

  const checkedOutSha = readToolSha(options.toolRepo);
  assertApprovedSha("TARGET_SHA", options.targetSha, checkedOutSha);
  if (options.approvedSha) {
    assertApprovedSha("APPROVED_SHA", options.approvedSha, checkedOutSha);
  }

  const { migrate, schemaContract } = await loadModules(options.toolRepo);

  const history = await withWorkingDirectory(options.toolRepo, () =>
    Promise.resolve(schemaContract.readHistory())
  );
  const latest = history.at(-1);
  if (!latest) {
    throw new Error("EMPTY_MIGRATION_HISTORY");
  }

  let preflightError: string | null = null;
  try {
    await withWorkingDirectory(options.toolRepo, async () => {
      await migrate.runMigration("preflight", databaseUrl);
    });
  } catch (error) {
    preflightError = sanitizeError(error, databaseUrl);
  }

  const connection = await connect({
    uri: databaseUrl,
    multipleStatements: false,
    connectTimeout: 10000,
  });

  try {
    const [database] = await connection.query<RowDataPacket[]>(
      "SELECT DATABASE() AS name"
    );
    const actualHistory = await readActualMigrationHistory(connection);
    const evidenceErrors: string[] = [];

    let verifiedAppliedCount: number | null = null;
    try {
      verifiedAppliedCount = await withWorkingDirectory(options.toolRepo, () =>
        schemaContract.appliedMigrationCount(connection, history)
      );
    } catch (error) {
      verifiedAppliedCount = null;
      evidenceErrors.push(
        `JOURNAL_INSPECTION_FAILED: ${sanitizeError(error, databaseUrl)}`
      );
    }

    let actualTableCount: number | null = null;
    let appliedSnapshotTableCount: number | null = null;
    let appliedSnapshotDiffCount: number | null = null;

    try {
      const actualContract =
        await schemaContract.readDatabaseContract(connection);
      actualTableCount = Object.keys(actualContract).length;
      if (verifiedAppliedCount !== null) {
        const appliedContract = verifiedAppliedCount
          ? schemaContract.snapshotContract(
              history[verifiedAppliedCount - 1].snapshot
            )
          : {};
        appliedSnapshotTableCount = Object.keys(appliedContract).length;
        appliedSnapshotDiffCount = schemaContract.differences(
          appliedContract,
          actualContract
        ).length;
        if (appliedSnapshotDiffCount > 0) {
          evidenceErrors.push(
            `SCHEMA_DRIFT: evidence inspection found ${appliedSnapshotDiffCount} differences from the applied snapshot`
          );
        }
      }
    } catch (error) {
      actualTableCount = null;
      appliedSnapshotTableCount = null;
      appliedSnapshotDiffCount = null;
      evidenceErrors.push(
        `SCHEMA_INSPECTION_FAILED: ${sanitizeError(error, databaseUrl)}`
      );
    }

    const report: Report = {
      generatedAt: new Date().toISOString(),
      classification: preflightError || evidenceErrors.length ? "fail" : "pass",
      requestedSha: options.targetSha,
      approvedSha: options.approvedSha,
      checkedOutSha,
      toolRepo: options.toolRepo,
      productionContext: options.context,
      command: "node --import tsx scripts/db/migrate.ts preflight",
      repository: {
        expectedMigrationCount: history.length,
        latestMigrationTag: latest.tag,
      },
      database: {
        schemaName: database[0]?.name ? String(database[0].name) : null,
        migrationTablePresent: actualHistory.migrationTablePresent,
        actualMigrationCount: actualHistory.rows.length,
        verifiedAppliedCount,
        pendingMigrationCount:
          verifiedAppliedCount === null
            ? null
            : history.length - verifiedAppliedCount,
      },
      schema: {
        appliedSnapshotTableCount,
        targetSnapshotTableCount: Object.keys(
          schemaContract.snapshotContract(latest.snapshot)
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
        actualEntries: actualHistory.rows,
      },
      preflight: {
        status: preflightError ? "FAIL" : "PASS",
        error: preflightError,
      },
      evidence: {
        status: evidenceErrors.length ? "FAIL" : "PASS",
        errors: evidenceErrors,
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

    console.info(
      JSON.stringify({
        classification: report.classification,
        requestedSha: report.requestedSha,
        checkedOutSha: report.checkedOutSha,
        productionContext: report.productionContext,
        actualMigrationCount: report.database.actualMigrationCount,
        verifiedAppliedCount: report.database.verifiedAppliedCount,
        pendingMigrationCount: report.database.pendingMigrationCount,
        preflightStatus: report.preflight.status,
        evidenceStatus: report.evidence.status,
        reportDir: options.reportDir,
      })
    );

    if (report.classification === "fail") {
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

export function shouldRunCli(argv: string[]): boolean {
  return argv.includes("--run");
}

if (shouldRunCli(process.argv)) {
  main().catch(error => {
    console.error(
      error instanceof Error
        ? sanitizeError(error, process.env.DATABASE_URL ?? "")
        : "Preflight report failed"
    );
    process.exit(1);
  });
}
