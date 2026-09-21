/** Railway acceptance runner.
 *
 * Runs the repository's live MySQL/Redis acceptance suite *inside* a Railway
 * environment, against the environment's own MySQL and Redis services, so the
 * evidence is about the deployed dependencies rather than a laptop or a CI
 * container. It is a one-shot process: it exits when the report is printed.
 *
 * What it deliberately is not:
 *
 *  - **Not the worker.** It starts no cron, imports nothing from
 *    `server/worker.ts`, and runs the suite that is proven to make zero
 *    provider calls. The staging runbook blocks the worker until provider
 *    boundaries are isolated; this runner does not touch that decision.
 *  - **Not a tenant of the application database.** It creates its own
 *    disposable `*_test` database on the same server, refuses to run if that
 *    name is the application's database, and drops it afterwards. The suite
 *    additionally refuses any database whose name does not end in `_test`.
 *  - **Not a sharer of the application's Redis keyspace.** It uses a separate
 *    logical database index (default 9; index 0 is refused because that is
 *    what the application uses) and flushes only that index.
 *  - **Not a carrier of credentials.** The suite is spawned with exactly the
 *    five variables CI passes it plus PATH and HOME. No provider key can reach
 *    it, because none is in its environment.
 *
 * Connection strings are never printed; hosts, ports and database names are.
 */
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createConnection,
  type Connection,
  type RowDataPacket,
} from "mysql2/promise";
import Redis from "ioredis";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const DATABASE_NAME = /^[a-z0-9_]{1,40}_test$/;

interface Diagnosis {
  mysql: { host: string; port: string; version: string; latencyMs: number };
  redis: {
    host: string;
    port: string;
    version: string;
    latencyMs: number;
    databaseIndex: number;
  };
}

interface AcceptanceReport {
  completed: boolean;
  passed: number;
  skipped: number;
  failedCheck: string | null;
  database: string;
  cache: string;
  providerCalls: number;
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function describe(url: URL): string {
  return `${url.hostname}:${url.port || "(default)"}`;
}

/** Runs a repository script with a *replacement* environment, not an
 * inherited one, so nothing in this process's environment leaks into it. */
function run(
  label: string,
  args: string[],
  env: Record<string, string>
): Promise<number> {
  return new Promise(resolve => {
    console.info(`[railway-acceptance] ${label}`);
    const child = spawn(process.execPath, args, {
      cwd: ROOT,
      stdio: "inherit",
      env: {
        PATH: process.env.PATH ?? "",
        HOME: process.env.HOME ?? tmpdir(),
        ...env,
      },
    });
    child.on("error", error => {
      console.error(`[railway-acceptance] ${label} failed to start`, error);
      resolve(1);
    });
    child.on("exit", (code, signal) => {
      if (signal) console.error(`[railway-acceptance] ${label} ${signal}`);
      resolve(code ?? 1);
    });
  });
}

async function diagnose(
  admin: Connection,
  adminUrl: URL,
  redis: Redis,
  redisUrl: URL,
  databaseIndex: number
): Promise<Diagnosis> {
  let started = Date.now();
  const [rows] = await admin.query<RowDataPacket[]>(
    "SELECT VERSION() AS version"
  );
  const mysqlLatency = Date.now() - started;
  const mysqlVersion = String(rows[0]?.version ?? "unknown");

  started = Date.now();
  await redis.ping();
  const redisLatency = Date.now() - started;
  const info = await redis.info("server");
  const redisVersion = /redis_version:([^\r\n]+)/.exec(info)?.[1] ?? "unknown";

  return {
    mysql: {
      host: adminUrl.hostname,
      port: adminUrl.port || "3306",
      version: mysqlVersion,
      latencyMs: mysqlLatency,
    },
    redis: {
      host: redisUrl.hostname,
      port: redisUrl.port || "6379",
      version: redisVersion,
      latencyMs: redisLatency,
      databaseIndex,
    },
  };
}

/** One-shot containers can exit before the platform's log shipper has read
 * their last lines; the first Railway run left no deployment log at all, and
 * the migrate service shows the same gap. A short pause after the summary is
 * what makes the report reliably observable. Written to both streams so it
 * survives either one being dropped. */
const LOG_FLUSH_MS = 4_000;

function announce(line: string): void {
  console.info(line);
  console.error(line);
}

async function main(): Promise<number> {
  announce(
    `[railway-acceptance] starting on node ${process.version}, source ${process.env.RAILWAY_GIT_COMMIT_SHA ?? "local"}`
  );
  if (process.env.NODE_ENV === "production")
    throw new Error("The acceptance runner refuses to run as production");

  const adminUrl = new URL(required("ACCEPTANCE_MYSQL_ADMIN_URL"));
  if (adminUrl.protocol !== "mysql:")
    throw new Error("ACCEPTANCE_MYSQL_ADMIN_URL must be a mysql:// URL");
  const databaseName =
    process.env.ACCEPTANCE_DB_NAME?.trim() || "ais_acceptance_test";
  if (!DATABASE_NAME.test(databaseName))
    throw new Error(
      "ACCEPTANCE_DB_NAME must be lowercase, at most 45 characters, and end in _test"
    );
  const applicationDatabase = adminUrl.pathname.replace(/^\//, "");
  if (applicationDatabase && applicationDatabase === databaseName)
    throw new Error(
      "ACCEPTANCE_DB_NAME is the application database; refusing to drop it"
    );

  const redisBase = new URL(required("ACCEPTANCE_REDIS_URL"));
  if (!/^rediss?:$/.test(redisBase.protocol))
    throw new Error("ACCEPTANCE_REDIS_URL must be a redis:// URL");
  const databaseIndex = Number(process.env.ACCEPTANCE_REDIS_DB ?? "9");
  if (
    !Number.isInteger(databaseIndex) ||
    databaseIndex < 1 ||
    databaseIndex > 15
  )
    throw new Error(
      "ACCEPTANCE_REDIS_DB must be an integer from 1 to 15; index 0 belongs to the application"
    );
  const redisUrl = new URL(redisBase);
  redisUrl.pathname = `/${databaseIndex}`;

  const targetUrl = new URL(adminUrl);
  targetUrl.pathname = `/${databaseName}`;

  console.info(
    `[railway-acceptance] mysql ${describe(adminUrl)} database=${databaseName}; redis ${describe(redisUrl)} db=${databaseIndex}`
  );

  const admin = await createConnection({
    uri: adminUrl.toString(),
    connectTimeout: 15_000,
  });
  const redis = new Redis(redisUrl.toString(), {
    lazyConnect: true,
    maxRetriesPerRequest: 2,
    connectTimeout: 15_000,
  });

  let exitCode = 1;
  let report: AcceptanceReport | null = null;
  let diagnosis: Diagnosis | null = null;
  const timings: Record<string, number> = {};
  const mark = (label: string, since: number) => {
    timings[label] = Date.now() - since;
  };

  try {
    await redis.connect();
    diagnosis = await diagnose(admin, adminUrl, redis, redisUrl, databaseIndex);
    console.info(
      `[railway-acceptance] mysql ${diagnosis.mysql.version} (${diagnosis.mysql.latencyMs}ms), redis ${diagnosis.redis.version} (${diagnosis.redis.latencyMs}ms)`
    );

    // Only this index is ever flushed, and index 0 was refused above.
    await redis.flushdb();

    // The identifier passed the strict regex, so interpolation is safe.
    await admin.query(`DROP DATABASE IF EXISTS \`${databaseName}\``);
    await admin.query(
      `CREATE DATABASE \`${databaseName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );

    // The application logs every pool checkout at DEBUG; at that volume the
    // platform's log shipper drops thousands of lines, and the assertion that
    // failed is the first casualty. Warnings and errors are what a report needs.
    const migrateEnv = {
      NODE_ENV: "test",
      LOG_LEVEL: "warn",
      DATABASE_URL: targetUrl.toString(),
    };
    let since = Date.now();
    const migrated = await run(
      "apply migration journal",
      ["--import", "tsx", "scripts/db/migrate.ts", "migrate"],
      migrateEnv
    );
    mark("migrateMs", since);
    if (migrated !== 0) {
      console.error(
        "[railway-acceptance] migration failed; acceptance skipped"
      );
      return 1;
    }
    since = Date.now();
    const verified = await run(
      "verify journal matches declared schema",
      ["--import", "tsx", "scripts/db/migrate.ts", "verify"],
      migrateEnv
    );
    mark("verifyMs", since);
    if (verified !== 0) {
      console.error(
        "[railway-acceptance] schema verification failed; acceptance skipped"
      );
      return 1;
    }

    const reportPath = join(
      await mkdtemp(join(tmpdir(), "railway-acceptance-")),
      "acceptance.json"
    );
    since = Date.now();
    // Exactly the variables CI passes, nothing from this process.
    exitCode = await run(
      "run live acceptance suite",
      [
        "--import",
        "tsx",
        "scripts/verify-transaction-boundaries.ts",
        reportPath,
      ],
      {
        NODE_ENV: "test",
        LOG_LEVEL: "warn",
        AIS_DISPOSABLE_DATABASE: "true",
        DATABASE_URL: targetUrl.toString(),
        REDIS_URL: redisUrl.toString(),
        JWT_SECRET: randomBytes(32).toString("hex"),
      }
    );
    mark("acceptanceMs", since);
    try {
      report = JSON.parse(
        await readFile(reportPath, "utf8")
      ) as AcceptanceReport;
    } catch {
      console.error("[railway-acceptance] acceptance produced no report");
    }
    return exitCode;
  } finally {
    try {
      await admin.query(`DROP DATABASE IF EXISTS \`${databaseName}\``);
      console.info(`[railway-acceptance] dropped ${databaseName}`);
    } catch (error) {
      console.error(
        "[railway-acceptance] failed to drop the disposable database",
        error
      );
    }
    try {
      if (redis.status === "ready") await redis.flushdb();
    } catch (error) {
      console.error(
        "[railway-acceptance] failed to flush the acceptance Redis index",
        error
      );
    }
    await Promise.allSettled([admin.end(), redis.quit()]);

    const summary = {
      runner: "railway-acceptance",
      source: process.env.RAILWAY_GIT_COMMIT_SHA ?? null,
      environment: process.env.RAILWAY_ENVIRONMENT_NAME ?? null,
      diagnosis,
      timings,
      acceptance: report && {
        completed: report.completed,
        passed: report.passed,
        skipped: report.skipped,
        failedCheck: report.failedCheck,
        database: report.database,
        cache: report.cache,
        providerCalls: report.providerCalls,
      },
      exitCode,
    };
    announce(`RAILWAY_ACCEPTANCE_SUMMARY ${JSON.stringify(summary)}`);
    await new Promise(resolve => setTimeout(resolve, LOG_FLUSH_MS));
  }
}

main().then(
  code => {
    process.exitCode = code;
  },
  async error => {
    // A refused configuration is exactly the case that has to be readable.
    announce(
      `[railway-acceptance] aborted: ${error instanceof Error ? error.message : String(error)}`
    );
    await new Promise(resolve => setTimeout(resolve, LOG_FLUSH_MS));
    process.exitCode = 1;
  }
);
