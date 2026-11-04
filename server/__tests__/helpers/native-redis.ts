import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";

/** Owns a disposable native Redis process; never accepts a shared Redis URL. */
export async function startNativeRedis(
  binary = process.env.AIS_TEST_REDIS_SERVER_BIN
): Promise<{ url: string; stop(): Promise<void> }> {
  if (!binary || !isAbsolute(binary))
    throw new Error(
      "AIS_TEST_REDIS_SERVER_BIN must name an absolute Redis binary"
    );

  const reservation = createServer();
  reservation.listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const address = reservation.address();
  if (!address || typeof address === "string")
    throw new Error("No fixture port");
  const port = address.port;
  await new Promise<void>((resolve, reject) =>
    reservation.close(error => (error ? reject(error) : resolve()))
  );

  const directory = await mkdtemp(join(tmpdir(), "ais-native-redis-"));
  const child = spawn(
    binary,
    [
      "--bind",
      "127.0.0.1",
      "--port",
      String(port),
      "--protected-mode",
      "yes",
      "--save",
      "",
      "--appendonly",
      "no",
      "--daemonize",
      "no",
      "--dir",
      directory,
    ],
    { stdio: ["ignore", "pipe", "pipe"] }
  );
  const exited = new Promise<void>((resolve, reject) => {
    child.once("exit", () => resolve());
    child.once("error", reject);
  });
  // A failed spawn can settle before readiness listeners are attached below.
  void exited.catch(() => {});
  let stopped = false;
  async function stop() {
    if (stopped) return;
    stopped = true;
    let force: NodeJS.Timeout | undefined;
    try {
      if (child.pid && child.exitCode === null && child.signalCode === null) {
        child.kill("SIGTERM");
        force = setTimeout(() => child.kill("SIGKILL"), 2000);
      }
      await exited.catch(() => {});
    } finally {
      clearTimeout(force);
      await rm(directory, { recursive: true, force: true });
    }
  }

  let output = "";
  const record = (chunk: Buffer) => {
    output = (output + chunk.toString()).slice(-8192);
  };
  child.stdout.on("data", record);
  child.stderr.on("data", record);
  let timer: NodeJS.Timeout | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      const onOutput = () => {
        if (output.includes("Ready to accept connections")) resolve();
      };
      child.stdout.on("data", onOutput);
      child.stderr.on("data", onOutput);
      child.once("error", reject);
      child.once("exit", code => {
        reject(
          new Error(`Native Redis exited before ready (${code}): ${output}`)
        );
      });
      timer = setTimeout(
        () => reject(new Error(`Native Redis readiness timed out: ${output}`)),
        10_000
      );
    });
    return { url: `redis://127.0.0.1:${port}`, stop };
  } catch (error) {
    await stop();
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
