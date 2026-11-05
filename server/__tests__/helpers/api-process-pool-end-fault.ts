/** Explicit child-process fault injection, loaded only with --import by the
 * native API fixture. It retains the actual mysql2 pool and native connections,
 * but replaces end() with a rejected or unresolved promise. The test proves the
 * API process's reaction to that driver outcome, not a native MySQL failure. */
import mysql from "mysql2/promise";

const fault = process.env.AIS_API_PROCESS_POOL_END_FAULT;
const database = new URL(process.env.DATABASE_URL ?? "");
if (
  !["reject", "hang"].includes(fault ?? "") ||
  process.env.AIS_PROVIDER_BOUNDARY !== "isolated" ||
  database.protocol !== "mysql:" ||
  database.hostname !== "127.0.0.1" ||
  !/^\/ais_api_process_[0-9a-f]{12}$/.test(database.pathname)
)
  throw new Error(
    "Refusing pool-end fault outside the owned API process fixture"
  );

const createPool = mysql.createPool;
mysql.createPool = ((...args: Parameters<typeof mysql.createPool>) => {
  const pool = createPool(...args);
  pool.end = () => {
    process.stdout.write(
      JSON.stringify({
        event: "fixture_pool_end_fault",
        fault,
        evidence: "injected mysql2 end outcome; not a native MySQL failure",
      }) + "\n"
    );
    if (fault === "reject")
      return Promise.reject(
        new Error("Intentional fixture pool.end rejection")
      );
    return new Promise<void>(() => {});
  };
  return pool;
}) as typeof mysql.createPool;
