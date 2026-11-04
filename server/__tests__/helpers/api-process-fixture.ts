import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { createRequire } from "node:module";
import { connect, createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const entry = fileURLToPath(new URL("../../_core/index.ts", import.meta.url));
const require = createRequire(import.meta.url);
const stripeKey = "sk_test_native_api_process_fixture_only";
export const apiProcessWebhookSecret = "whsec_native_api_process_fixture_only";

async function listen(server: Server) {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("No fixture port");
  return address.port;
}

async function closeServer(server: Server) {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) => {
    server.close(error => (error ? reject(error) : resolve()));
  });
}

async function bounded<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string
) {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Every socket belongs to this child-only proxy; outage never touches MySQL itself. */
async function mysqlProxy(host: string, port: number) {
  let enabled = true;
  const sockets = new Set<Socket>();
  const server = createServer(client => {
    if (!enabled) {
      client.destroy();
      return;
    }
    const upstream = connect({ host, port });
    sockets.add(client);
    sockets.add(upstream);
    const destroy = () => {
      client.destroy();
      upstream.destroy();
    };
    client.on("error", destroy);
    upstream.on("error", destroy);
    client.on("close", () => {
      sockets.delete(client);
      upstream.destroy();
    });
    upstream.on("close", () => {
      sockets.delete(upstream);
      client.destroy();
    });
    client.pipe(upstream);
    upstream.pipe(client);
  });
  const listeningPort = await listen(server);
  return {
    port: listeningPort,
    disconnect() {
      enabled = false;
      for (const socket of sockets) socket.destroy();
    },
    reconnect() {
      enabled = true;
    },
    connections: () => sockets.size,
    async close() {
      enabled = false;
      for (const socket of sockets) socket.destroy();
      await closeServer(server);
    },
  };
}

export interface ApiProcessExit {
  code: number | null;
  signal: NodeJS.Signals | null;
}

/** Start the unmodified API entry point with no inherited credentials or endpoints. */
export async function startApiProcessFixture(databaseUrl: string) {
  const database = new URL(databaseUrl);
  if (
    database.protocol !== "mysql:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(database.hostname) ||
    !/^\/ais_api_process_[0-9a-f]{12}$/.test(database.pathname)
  )
    throw new Error(
      "API process fixture requires its owned loopback MySQL schema"
    );

  const temp = await mkdtemp(join(tmpdir(), "ais-api-process-"));
  const emptyEnv = join(temp, "empty.env");
  await writeFile(emptyEnv, "", { flag: "wx" });
  let proxy: Awaited<ReturnType<typeof mysqlProxy>> | undefined;
  let child: ChildProcess | undefined;
  let exited: Promise<ApiProcessExit> | undefined;
  let output = "";
  const records: Array<Record<string, unknown>> = [];
  const providerRequests: Array<{
    method: string | undefined;
    path: string | undefined;
    authorized: boolean;
  }> = [];
  const stripe = createHttpServer((request, response) => {
    const authorized = request.headers.authorization === `Bearer ${stripeKey}`;
    providerRequests.push({
      method: request.method,
      path: request.url,
      authorized,
    });
    if (
      request.method !== "GET" ||
      request.url !== "/v1/balance" ||
      !authorized
    ) {
      response.writeHead(500, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify({ error: "Unexpected fixture provider request" })
      );
      return;
    }
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(
      JSON.stringify({
        object: "balance",
        livemode: false,
        available: [],
        pending: [],
      })
    );
  });
  // Redis is deliberately unavailable. This exercises the documented memory
  // cache fallback without reaching shared/default Redis or starting workers.
  const redis = createServer(socket => socket.destroy());
  const reservation = createServer();

  async function stop() {
    proxy?.reconnect();
    if (!child || !exited) return undefined;
    if (child.exitCode === null && child.signalCode === null)
      child.kill("SIGTERM");
    return bounded(
      exited,
      13_000,
      "API process did not exit within its shutdown budget"
    );
  }
  async function close() {
    let cleanupError: unknown;
    try {
      await stop();
    } catch (error) {
      cleanupError = error;
      if (
        child &&
        exited &&
        child.exitCode === null &&
        child.signalCode === null
      ) {
        child.kill("SIGKILL");
        await bounded(exited, 2000, "API process could not be terminated");
      }
    } finally {
      stripe.closeAllConnections();
      try {
        const closed = await bounded(
          Promise.allSettled([
            proxy?.close(),
            closeServer(stripe),
            closeServer(redis),
            closeServer(reservation),
          ]),
          3000,
          "Owned API fixture endpoints did not close"
        );
        for (const result of closed)
          if (result.status === "rejected") cleanupError ??= result.reason;
      } finally {
        await rm(temp, { recursive: true, force: true });
      }
    }
    if (cleanupError) throw cleanupError;
  }

  try {
    proxy = await mysqlProxy(
      database.hostname.replace(/^\[|\]$/g, ""),
      Number(database.port || 3306)
    );
    const stripePort = await listen(stripe);
    const redisPort = await listen(redis);
    const preferredPort = await listen(reservation);
    await closeServer(reservation);
    database.hostname = "127.0.0.1";
    database.port = String(proxy.port);
    const mockOrigin = `http://127.0.0.1:${stripePort}`;
    const environment: NodeJS.ProcessEnv = {
      NODE_ENV: "production",
      TZ: "UTC",
      PORT: String(preferredPort),
      DOTENV_CONFIG_PATH: emptyEnv,
      DOTENV_CONFIG_QUIET: "true",
      TMPDIR: temp,
      LOG_LEVEL: "info",
      LOG_FORMAT: "json",
      VITE_APP_ID: "ais-native-api-process",
      OWNER_OPEN_ID: "",
      JWT_SECRET: "native-api-process-jwt-secret-only-32-plus",
      REFRESH_TOKEN_PEPPER: "native-api-process-refresh-pepper-only-32-plus",
      SELF_SERVICE_CAPABILITY_SECRET:
        "native-api-process-capability-secret-only-32-plus",
      DATABASE_URL: database.toString(),
      DB_POOL_SIZE: "3",
      DB_CONNECT_TIMEOUT: "1000",
      REDIS_URL: `redis://127.0.0.1:${redisPort}`,
      QUEUE_REDIS_URL: `redis://127.0.0.1:${redisPort}`,
      CACHE_PREFIX: "native-api-process-fixture",
      AIS_PROVIDER_BOUNDARY: "isolated",
      STRIPE_MOCK_HOST: mockOrigin,
      STRIPE_SECRET_KEY: stripeKey,
      STRIPE_WEBHOOK_SECRET: apiProcessWebhookSecret,
      OAUTH_SERVER_URL: mockOrigin,
      AUTH_SERVICE_URL: mockOrigin,
      BUILT_IN_FORGE_API_URL: mockOrigin,
      BUILT_IN_FORGE_API_KEY: "",
      HOTELBEDS_MODE: "disabled",
      AVIATION_WEATHER_MODE: "disabled",
      ONCALL_MODE: "disabled",
      AIS_OTEL_ENABLED: "false",
      METRICS_TOKEN: "native-api-process-metrics-fixture",
      TRUSTED_PROXIES: "loopback",
    };
    child = spawn(
      process.execPath,
      ["--import", pathToFileURL(require.resolve("tsx")).href, entry],
      {
        cwd: root,
        env: environment,
        stdio: ["ignore", "pipe", "pipe"],
      }
    );
    exited = new Promise<ApiProcessExit>((resolve, reject) => {
      child!.once("error", reject);
      child!.once("close", (code, signal) => resolve({ code, signal }));
    });
    // Observe early rejection immediately even if startup has not reached await.
    void exited.catch(() => {});
    let lines = "";
    child.stdout!.setEncoding("utf8");
    child.stderr!.setEncoding("utf8");
    child.stdout!.on("data", (chunk: string) => {
      output = (output + chunk).slice(-128_000);
      lines += chunk;
      const complete = lines.split("\n");
      lines = complete.pop() ?? "";
      for (const line of complete) {
        try {
          const record: unknown = JSON.parse(line);
          if (record && typeof record === "object" && !Array.isArray(record))
            records.push(record as Record<string, unknown>);
        } catch {
          /* Non-JSON module startup messages do not affect the process contract. */
        }
      }
    });
    child.stderr!.on("data", (chunk: string) => {
      output = (output + chunk).slice(-128_000);
    });
    const deadline = Date.now() + 25_000;
    for (;;) {
      const started = records.find(record => record.event === "server_started");
      if (started && typeof started.port === "number") {
        return {
          origin: `http://127.0.0.1:${started.port}`,
          pid: child.pid,
          proxy,
          records,
          providerRequests,
          diagnostics: () => output.slice(-6000),
          stop,
          close,
        };
      }
      if (
        child.exitCode !== null ||
        child.signalCode !== null ||
        Date.now() >= deadline
      )
        throw new Error(`API process did not start: ${output.slice(-6000)}`);
      await delay(100);
    }
  } catch (error) {
    await close();
    throw error;
  }
}
