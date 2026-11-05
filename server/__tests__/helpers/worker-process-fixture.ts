import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const entry = fileURLToPath(new URL("../../worker.ts", import.meta.url));
const require = createRequire(import.meta.url);
const defaultReadinessPath = "/tmp/ais-worker-ready";

export interface WorkerProcessExit {
  code: number | null;
  signal: NodeJS.Signals | null;
}

export async function waitForWorkerCondition<T>(
  read: () => Promise<T>,
  matches: (value: T) => boolean,
  timeoutMs: number,
  description: string
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (matches(value)) return value;
    if (Date.now() >= deadline)
      throw new Error(`Timed out waiting for ${description}`);
    await delay(100);
  }
}

async function bounded<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string
) {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(label)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * A real worker entry point, real cron clock, MySQL pool and BullMQ consumers.
 * Only its environment and readiness-file location are configured. No loader
 * intercepts, mocked imports, accelerated intervals or manual cron invocations.
 */
export async function startWorkerProcessFixture(input: {
  databaseUrl: string;
  redisUrl: string;
  label: string;
}) {
  const database = new URL(input.databaseUrl);
  const redis = new URL(input.redisUrl);
  const loopback = ["127.0.0.1", "localhost", "[::1]"];
  if (
    database.protocol !== "mysql:" ||
    !loopback.includes(database.hostname) ||
    !/^\/ais_worker_process_[0-9a-f]{12}$/.test(database.pathname) ||
    redis.protocol !== "redis:" ||
    !loopback.includes(redis.hostname) ||
    !/^[a-z0-9-]+$/.test(input.label)
  )
    throw new Error("Worker fixture requires its owned loopback services");

  const directory = await mkdtemp(join(tmpdir(), "ais-worker-process-"));
  const readinessPath = join(directory, "ready");
  const emptyEnv = join(directory, "empty.env");
  await writeFile(emptyEnv, "", { flag: "wx" });
  const artifactDirectory = process.env.AIS_TEST_PROCESS_ARTIFACT_DIR;
  if (artifactDirectory && !isAbsolute(artifactDirectory))
    throw new Error("Worker artifact directory must be absolute");

  let child: ChildProcess | undefined;
  let exited: Promise<WorkerProcessExit> | undefined;
  let output = "";
  let closed = false;
  const records: Array<Record<string, unknown>> = [];

  function alive() {
    return Boolean(
      child && child.exitCode === null && child.signalCode === null
    );
  }
  async function ready() {
    try {
      return Date.now() - (await stat(readinessPath)).mtimeMs < 30_000;
    } catch {
      return false;
    }
  }
  function signal(signal: NodeJS.Signals = "SIGTERM") {
    if (!child || !alive()) throw new Error("Worker is not running");
    if (!child.kill(signal)) throw new Error(`Could not send ${signal}`);
  }
  async function waitForExit(timeoutMs = 35_000) {
    if (!exited) throw new Error("Worker was not started");
    return bounded(
      exited,
      timeoutMs,
      `Worker did not exit: ${output.slice(-8000)}`
    );
  }
  async function stop() {
    if (alive()) signal();
    return exited ? waitForExit() : undefined;
  }
  async function close() {
    if (closed) return;
    closed = true;
    try {
      await stop();
    } catch (error) {
      if (alive()) {
        signal("SIGKILL");
        await waitForExit(3000);
      }
      throw error;
    } finally {
      try {
        if (artifactDirectory) {
          await mkdir(artifactDirectory, { recursive: true });
          await writeFile(
            join(artifactDirectory, `${input.label}.log`),
            output
          );
          await writeFile(
            join(artifactDirectory, `${input.label}.json`),
            JSON.stringify({ pid: child?.pid, records }, null, 2) + "\n"
          );
        }
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    }
  }

  /** Execute the deployed probe expression, substituting only this instance's path. */
  async function probe() {
    const manifest = readFileSync(
      join(root, "k8s/base/background.yaml"),
      "utf8"
    );
    const encoded = manifest.match(/"const fs=require\('node:fs'\);[^\n]+"/);
    if (!encoded) throw new Error("Deployed worker probe was not found");
    const command = JSON.parse(encoded[0]) as string;
    if (!command.includes(defaultReadinessPath))
      throw new Error("Worker default path and deployed probe disagree");
    const probeProcess = spawn(
      process.execPath,
      ["-e", command.replaceAll(defaultReadinessPath, readinessPath)],
      { stdio: "ignore", env: { TZ: "UTC" } }
    );
    return bounded(
      new Promise<number | null>((resolve, reject) => {
        probeProcess.once("error", reject);
        probeProcess.once("close", code => resolve(code));
      }),
      3000,
      "Worker probe did not finish"
    );
  }

  try {
    // Deliberately do not inherit credentials, remote endpoints, NODE_OPTIONS,
    // or a developer .env. No external provider is configured in this process.
    const environment: NodeJS.ProcessEnv = {
      NODE_ENV: "production",
      TZ: "UTC",
      DOTENV_CONFIG_PATH: emptyEnv,
      DOTENV_CONFIG_QUIET: "true",
      TMPDIR: directory,
      LOG_LEVEL: "debug",
      LOG_FORMAT: "json",
      AIS_WORKER_READY_PATH: readinessPath,
      VITE_APP_ID: "ais-native-worker-process",
      OWNER_OPEN_ID: "",
      JWT_SECRET: "native-worker-process-jwt-secret-only-32-plus",
      SELF_SERVICE_CAPABILITY_SECRET:
        "native-worker-process-capability-secret-only-32-plus",
      DATABASE_URL: database.toString(),
      DB_POOL_SIZE: "8",
      DB_MAX_IDLE: "8",
      DB_CONNECT_TIMEOUT: "1000",
      REDIS_URL: redis.toString(),
      QUEUE_REDIS_URL: redis.toString(),
      CACHE_PREFIX: "native-worker-process-fixture",
      AIS_PROVIDER_BOUNDARY: "isolated",
      OAUTH_SERVER_URL: "http://127.0.0.1:9",
      AUTH_SERVICE_URL: "http://127.0.0.1:9",
      BUILT_IN_FORGE_API_URL: "http://127.0.0.1:9",
      BUILT_IN_FORGE_API_KEY: "",
      HOTELBEDS_MODE: "disabled",
      AVIATION_WEATHER_MODE: "disabled",
      ONCALL_MODE: "disabled",
      AIS_OTEL_ENABLED: "false",
    };
    child = spawn(
      process.execPath,
      ["--import", pathToFileURL(require.resolve("tsx")).href, entry],
      { cwd: root, env: environment, stdio: ["ignore", "pipe", "pipe"] }
    );
    exited = new Promise<WorkerProcessExit>((resolve, reject) => {
      child!.once("error", reject);
      child!.once("close", (code, signal) => resolve({ code, signal }));
    });
    void exited.catch(() => {});
    let pendingLine = "";
    child.stdout!.setEncoding("utf8");
    child.stderr!.setEncoding("utf8");
    child.stdout!.on("data", (chunk: string) => {
      output = (output + chunk).slice(-512_000);
      pendingLine += chunk;
      const lines = pendingLine.split("\n");
      pendingLine = lines.pop() ?? "";
      for (const line of lines) {
        try {
          const record: unknown = JSON.parse(line);
          if (record && typeof record === "object" && !Array.isArray(record))
            records.push(record as Record<string, unknown>);
        } catch {
          /* Some imported queue modules still print plain-text startup logs. */
        }
      }
    });
    child.stderr!.on("data", (chunk: string) => {
      output = (output + chunk).slice(-512_000);
    });
    await waitForWorkerCondition(
      async () => {
        if (!alive())
          throw new Error(
            `Worker exited during startup: ${output.slice(-8000)}`
          );
        return records.some(
          record =>
            record.message ===
            "Worker dependencies and mandatory consumers are ready"
        );
      },
      Boolean,
      25_000,
      `real worker startup (${input.label})`
    );
    return {
      pid: child.pid,
      readinessPath,
      records,
      ready,
      probe,
      alive,
      signal,
      waitForExit,
      stop,
      close,
      diagnostics: () => output.slice(-12_000),
    };
  } catch (error) {
    await close();
    throw error;
  }
}
