import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import type { AddressInfo, Server, Socket } from "node:net";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import mysql from "mysql2";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../../", import.meta.url));
type Scenario = "normal" | "hold-quit" | "query-error" | "quit-reset" | "drain";

// Exercise the real singleton with work pending, not a mock of pool.end().
const drainProgram = `
  import { disposableDatabaseUrl } from './e2e/disposable-database.ts';
  import { getPool, closePool } from './server/db.ts';
  disposableDatabaseUrl();
  const pool = getPool();
  if (!pool) throw new Error('Fixture pool unavailable');
  const connection = await pool.getConnection();
  try {
    let workCompleted = false;
    const work = connection.query('SELECT 7 AS id').then(result => {
      workCompleted = true;
      return result;
    });
    const verifyClose = () => {
      if (!workCompleted) throw new Error('Shutdown returned before query completion');
      if (!connection.connection.stream.closed) throw new Error('Shutdown returned before transport closure');
    };
    const firstClose = closePool().then(verifyClose);
    const secondClose = closePool().then(verifyClose);
    const [result] = await Promise.all([work, firstClose, secondClose]);
    if (result[0][0]?.id !== 7) throw new Error('Pending query result lost');
    process.stdout.write('[privacy-drain] complete\\n');
  } finally {
    await closePool();
  }
`;

async function runWorker(scenario: Scenario) {
  const sockets = new Set<Socket>();
  const replyTimers = new Set<ReturnType<typeof setTimeout>>();
  const warnings: string[] = [];
  const commands: string[] = [];
  let quitCount = 0;
  let completedSelects = 0;
  let closedSockets = 0;
  let workWasPendingAtQuit = false;

  // mysql2's test server supplies the real wire protocol parser. This fixture
  // exposes only an empty synthetic privacy database on an ephemeral loopback
  // port; no service, provider credential, or external database is inherited.
  const mysqlServer = mysql.createServer(connection => {
    const socket = (connection as unknown as { stream: Socket }).stream;
    sockets.add(socket);
    socket.once("close", () => {
      sockets.delete(socket);
      closedSockets++;
    });
    connection.on("error", () => {
      // The server helper reports a normal client FIN as connection-lost.
      // Parent assertions check actual closure and the child's exit status.
    });
    connection.on("warn", (error: Error) => warnings.push(error.message));
    connection.serverHandshake({
      protocolVersion: 10,
      serverVersion: "8.0.0-privacy-fixture",
      connectionId: 1,
      statusFlags: 2,
      characterSet: 45,
      capabilityFlags: 512,
      authCallback: (_params: unknown, done: (error: null) => void) => {
        done(null);
        connection.sequenceId = 0;
      },
    });

    // ServerHandshake handles every command in one parser instance. Explicit
    // per-command sequence reset keeps both immediate and delayed replies valid.
    const reply = (write: () => void) => {
      connection.sequenceId = 1;
      write();
      connection.sequenceId = 0;
    };
    const rejectQuery = () =>
      reply(() =>
        connection.writeError({
          code: 1064,
          message: "Synthetic privacy fixture query failure",
        })
      );
    // This server helper routes text SET statements to stmt_prepare.
    connection.on("stmt_prepare", (query: string) => {
      if (query === "SET SESSION time_zone = '+00:00'")
        reply(() => connection.writeOk());
      else rejectQuery();
    });
    connection.on("query", (query: string) => {
      const kind = query.split(" ")[0].toLowerCase();
      commands.push(kind);
      if (kind === "select") {
        if (scenario === "query-error") {
          rejectQuery();
          return;
        }
        const sendRows = () => {
          completedSelects++;
          reply(() =>
            connection.writeTextResult(
              scenario === "drain" ? [{ id: 7 }] : [],
              [
                {
                  catalog: "def",
                  schema: "ais_test",
                  table: "",
                  orgTable: "",
                  name: "id",
                  orgName: "id",
                  columnType: 3,
                  characterSet: 63,
                  columnLength: 11,
                  flags: 0,
                  decimals: 0,
                },
              ]
            )
          );
        };
        if (scenario === "drain") {
          const timer = setTimeout(() => {
            replyTimers.delete(timer);
            if (!socket.destroyed) sendRows();
          }, 150);
          replyTimers.add(timer);
        } else sendRows();
      } else if (
        ["begin", "delete", "update", "commit", "rollback"].includes(kind)
      ) {
        reply(() => connection.writeOk());
      } else rejectQuery();
    });
    connection.on("quit", () => {
      quitCount++;
      workWasPendingAtQuit ||= replyTimers.size > 0;
      if (scenario === "normal" || scenario === "query-error") socket.end();
      if (scenario === "quit-reset") socket.resetAndDestroy();
      // hold-quit/drain deliberately send no FIN. The application owns cleanup.
    });
  });
  const server = (mysqlServer as unknown as { _server: Server })._server;
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as AddressInfo).port;
  const args =
    scenario === "drain"
      ? ["--import", "tsx", "--input-type=module", "--eval", drainProgram]
      : ["--import", "tsx", "scripts/e2e/process-privacy.ts"];
  const child = spawn(process.execPath, args, {
    cwd: root,
    env: {
      PATH: process.env.PATH,
      NODE_ENV: "test",
      AIS_DISPOSABLE_DATABASE: "true",
      DATABASE_URL: `mysql://fixture:fixture@127.0.0.1:${port}/ais_test`,
      JWT_SECRET: "privacy-shutdown-fixture-only",
      // LOG_FORMAT is intentionally omitted, as in the browser CI job.
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", data => (stdout += data));
  child.stderr.on("data", data => (stderr += data));
  const closed = new Promise<{ code: number | null; signal: string | null }>(
    (resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) => resolve({ code, signal }));
    }
  );
  let timedOut = false;
  // This is a failing test watchdog, never a successful application exit path.
  const deadline = setTimeout(() => {
    timedOut = true;
    child.kill("SIGKILL");
  }, 8000);
  try {
    const exit = await closed;
    expect(stderr).not.toContain("got packets out of order");
    // Wait for the peer's close event rather than relying on one event-loop
    // turn; a loaded CI runner can observe child exit before the peer FIN.
    let peerDeadline: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        Promise.all(
          [...sockets].map(
            socket =>
              new Promise<void>(resolve => socket.once("close", resolve))
          )
        ),
        new Promise<void>(resolve => {
          peerDeadline = setTimeout(resolve, 1000);
        }),
      ]);
    } finally {
      clearTimeout(peerDeadline);
    }
    return {
      ...exit,
      timedOut,
      stdout,
      stderr,
      warnings,
      commands,
      quitCount,
      completedSelects,
      closedSockets,
      workWasPendingAtQuit,
      openSockets: sockets.size,
    };
  } finally {
    clearTimeout(deadline);
    if (child.exitCode === null && child.signalCode === null)
      child.kill("SIGKILL");
    for (const timer of replyTimers) clearTimeout(timer);
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve, reject) =>
      server.close(error => (error ? reject(error) : resolve()))
    );
  }
}

describe("privacy worker database shutdown", () => {
  it.each(["normal", "hold-quit", "quit-reset"] as const)(
    "naturally exits after completed privacy work with a %s peer",
    async scenario => {
      const result = await runWorker(scenario);
      expect(result, result.stderr).toMatchObject({
        code: 0,
        signal: null,
        timedOut: false,
        quitCount: 1,
        completedSelects: 2,
        closedSockets: 1,
        openSockets: 0,
        warnings: [],
      });
      expect(result.stderr).toContain(
        '"phase":"processPrivacyRequests:return"'
      );
      expect(result.stderr).toContain('"phase":"closePool:return"');
      expect(result.stderr).toContain('"phase":"closeLogger:return"');
      expect(result.stdout).toContain("Database connection pool closed");
    },
    12000
  );

  it("cleans up while preserving a failed privacy query as a nonzero exit", async () => {
    const result = await runWorker("query-error");
    expect(result).toMatchObject({
      code: 1,
      signal: null,
      timedOut: false,
      quitCount: 1,
      closedSockets: 1,
      openSockets: 0,
      warnings: [],
    });
    expect(result.stderr).toContain("Synthetic privacy fixture query failure");
    expect(result.stderr).toContain('"phase":"closePool:return"');
    expect(result.stderr).toContain('"phase":"closeLogger:return"');
    expect(result.stderr).not.toContain(
      '"phase":"processPrivacyRequests:return"'
    );
  }, 12000);

  it("drains a pending query and closes once for concurrent shutdown callers", async () => {
    const result = await runWorker("drain");
    expect(result, result.stderr).toMatchObject({
      code: 0,
      signal: null,
      timedOut: false,
      quitCount: 1,
      completedSelects: 1,
      workWasPendingAtQuit: false,
      closedSockets: 1,
      openSockets: 0,
      warnings: [],
    });
    expect(result.stdout).toContain("[privacy-drain] complete");
  }, 12000);

  it.each(["pretty", "json"])(
    "flushes final %s logs and closes the worker for concurrent callers",
    async format => {
      const program = `
        import pino from 'pino';
        import { createServiceLogger, closeLogger, pinoLogger } from './server/_core/logger.ts';
        const transport = pinoLogger[pino.symbols.streamSym];
        const log = createServiceLogger('shutdown-fixture');
        for (let i = 0; i < 10; i++)
          log.info({ email: 'private-fixture@example.test' }, 'FINAL_LOG_' + i);
        await Promise.all([closeLogger(), closeLogger()]);
        if (!transport.closed) throw new Error('Logger returned before worker closure');
        await closeLogger();
        process.stdout.write('[logger-close] complete\\n');
      `;
      // execFile uses the same default piped stdio as the browser test.
      const { stdout } = await promisify(execFile)(
        process.execPath,
        ["--import", "tsx", "--input-type=module", "--eval", program],
        {
          cwd: root,
          timeout: 8000,
          env: { PATH: process.env.PATH, NODE_ENV: "test", LOG_FORMAT: format },
        }
      );
      for (let i = 0; i < 10; i++)
        expect(stdout.match(new RegExp(`FINAL_LOG_${i}\\b`, "g"))).toHaveLength(
          1
        );
      expect(stdout).toContain("[logger-close] complete");
      expect(stdout).not.toContain("private-fixture@example.test");
    },
    12000
  );

  it("reports flush rejection without an unhandled delayed transport error", async () => {
    const program = `
      import { once } from 'node:events';
      import pino from 'pino';
      import { closeLogger, pinoLogger } from './server/_core/logger.ts';
      const transport = pinoLogger[pino.symbols.streamSym];
      if (!transport.ready) await once(transport, 'ready');
      // Observe the delayed failure and closure even after shutdown rejects.
      transport.ref();
      // thread-stream rejects flush callbacks before emitting its error event.
      transport.flush = callback => {
        const error = new Error('fixture_flush_failure');
        process.nextTick(() => callback(error));
        setImmediate(() => transport.emit('error', error));
        setImmediate(() => transport.end());
      };
      let rejected = false;
      try { await closeLogger(); }
      catch (error) {
        if (error.message !== 'fixture_flush_failure') throw error;
        rejected = true;
      }
      if (!rejected) throw new Error('Flush failure was reported as success');
      if (!transport.closed)
        await new Promise(resolve => transport.once('close', resolve));
      process.stdout.write('[logger-error] observed\\n');
    `;
    const { stdout } = await promisify(execFile)(
      process.execPath,
      ["--import", "tsx", "--input-type=module", "--eval", program],
      {
        cwd: root,
        timeout: 8000,
        env: { PATH: process.env.PATH, NODE_ENV: "test", LOG_FORMAT: "json" },
      }
    );
    expect(stdout).toContain("[logger-error] observed");
  }, 12000);
});
