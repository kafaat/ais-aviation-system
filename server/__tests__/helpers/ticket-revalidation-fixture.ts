import { createHash, randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import mysql from "mysql2/promise";
import type { TrpcContext } from "../../_core/context";
import type { User } from "../../../drizzle/schema";

export type TicketDatabaseSnapshot = Record<string, string[]>;

/** No domain adapter is mocked. DATABASE_URL must be changed to this owned
 * schema before importing the application's actual database module/routers. */
export async function createTicketDatabase(sourceUrl: string) {
  if (
    process.env.AIS_DISPOSABLE_DATABASE !== "true" ||
    process.env.NODE_ENV !== "test"
  )
    throw new Error("Ticket acceptance requires an explicitly disposable lab");
  const url = new URL(sourceUrl);
  const source = url.pathname.slice(1);
  if (
    !/^[A-Za-z0-9_]+_test$/.test(source) ||
    !["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname)
  )
    throw new Error("Ticket acceptance requires a loopback _test database");
  const databaseName = `ais_ticket_revalidation_${randomBytes(6).toString("hex")}`;
  const admin = await mysql.createConnection({
    host: url.hostname.replace(/^\[|\]$/g, ""),
    port: Number(url.port || 3306),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    timezone: "Z",
  });
  let created = false;
  try {
    const [tables] = await admin.query<mysql.RowDataPacket[]>(
      "SELECT TABLE_NAME AS name, ENGINE AS engine FROM information_schema.tables WHERE TABLE_SCHEMA=? AND TABLE_TYPE='BASE TABLE' ORDER BY TABLE_NAME",
      [source]
    );
    const tableNames = tables.map(row => String(row.name));
    if (
      !tableNames.includes("retail_offers") ||
      !tableNames.includes("ticket_coupons") ||
      tableNames.some(name => !/^[A-Za-z0-9_]+$/.test(name)) ||
      tables.some(row => row.engine !== "InnoDB")
    )
      throw new Error("Ticket acceptance requires a migrated InnoDB catalog");
    await admin.query(`CREATE DATABASE \`${databaseName}\``);
    created = true;
    // LIKE retains migrated types/defaults/indexes, but not foreign keys. This
    // suite proves domain transactions; migration/foreign-key gates are separate.
    // Clone every table so a new dependency cannot silently use the source data.
    for (const name of tableNames)
      await admin.query(
        `CREATE TABLE \`${databaseName}\`.\`${name}\` LIKE \`${source}\`.\`${name}\``
      );
    await admin.query("SET SESSION time_zone = '+00:00'");
    await admin.query(`USE \`${databaseName}\``);
    const [settings] = await admin.query<mysql.RowDataPacket[]>(
      "SELECT DATABASE() AS name, @@SESSION.sql_mode AS mode"
    );
    if (
      settings[0]?.name !== databaseName ||
      !String(settings[0]?.mode).includes("STRICT_TRANS_TABLES")
    )
      throw new Error("Ticket acceptance did not bind strict owned storage");
    url.pathname = `/${databaseName}`;
    return {
      databaseName,
      databaseUrl: url.toString(),
      tableNames,
      async reset() {
        // Keep increasing identities: caches cannot mistake a later fixture's
        // flight/user for an earlier one. No TRUNCATE, source writes or FLUSH.
        for (const name of tableNames)
          await admin.query(`DELETE FROM \`${name}\``);
      },
      async snapshot(): Promise<TicketDatabaseSnapshot> {
        const snapshot: TicketDatabaseSnapshot = {};
        for (const name of tableNames) {
          const [rows] = await admin.query<mysql.RowDataPacket[]>(
            `SELECT * FROM \`${name}\``
          );
          snapshot[name] = rows.map(row => JSON.stringify(row)).sort();
        }
        return snapshot;
      },
      async close() {
        try {
          await admin.query(`DROP DATABASE \`${databaseName}\``);
        } finally {
          await admin.end();
        }
      },
    };
  } catch (error) {
    try {
      if (created) await admin.query(`DROP DATABASE \`${databaseName}\``);
    } finally {
      await admin.end();
    }
    throw error;
  }
}

export function snapshotHash(snapshot: TicketDatabaseSnapshot) {
  return createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
}

/** Trusted native callers exercise production router authorization from real
 * owned user rows. They do not claim to test cookies or the auth provider. */
export function ticketContext(user: User): TrpcContext {
  return {
    user,
    tenantId: user.tenantId,
    authMethod: "cookie",
  } as TrpcContext;
}

export async function loadTicketApplication() {
  const [
    database,
    { priceQuoteRouter },
    { bookingsRouter },
    { vouchersRouter },
    { eticketRouter },
    { modificationsRouter },
    { ndcRouter },
    { planSchema },
    offers,
    { redisCacheService },
    { cacheService },
  ] = await Promise.all([
    import("../../db"),
    import("../../routers/price-quote"),
    import("../../routers/bookings"),
    import("../../routers/vouchers"),
    import("../../routers/eticket"),
    import("../../routers/modifications"),
    import("../../routers/ndc"),
    import("../../services/order-servicing.service"),
    import("../../services/retail-offer.service"),
    import("../../services/redis-cache.service"),
    import("../../services/cache.service"),
  ]);
  const db = database.getDb();
  if (!db) throw new Error("Actual application database is unavailable");
  return {
    db,
    database,
    priceQuoteRouter,
    bookingsRouter,
    vouchersRouter,
    eticketRouter,
    modificationsRouter,
    ndcRouter,
    planSchema,
    offers,
    async close() {
      const results = await Promise.allSettled([
        redisCacheService.shutdown(),
        cacheService.disconnect(),
        database.closePool(),
      ]);
      const failures = results.flatMap(result =>
        result.status === "rejected" ? [result.reason] : []
      );
      if (failures.length)
        throw new AggregateError(failures, "Ticket application cleanup failed");
    },
  };
}

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
    throw new Error("Ticket transport did not receive a loopback port");
  return `http://127.0.0.1:${address.port}`;
}

async function closeServer(server: Server) {
  if (!server.listening) return;
  const closed = new Promise<void>((resolve, reject) => {
    server.close(error => (error ? reject(error) : resolve()));
  });
  server.closeAllConnections();
  await closed;
}

/** Explicit transport fault: read the production router's complete successful
 * HTTP response (the transaction has committed), then close only the caller's
 * socket. This is not a provider failure, process crash or authentication test. */
export async function startLostTicketResponse(
  application: Awaited<ReturnType<typeof loadTicketApplication>>,
  user: User
) {
  const [{ default: express }, { createExpressMiddleware }] = await Promise.all(
    [import("express"), import("@trpc/server/adapters/express")]
  );
  const app = express();
  app.use(
    "/trpc",
    createExpressMiddleware({
      router: application.ndcRouter,
      createContext: ({ req, res }) => ({
        req,
        res,
        user,
        tenantId: user.tenantId,
        authMethod: "cookie" as const,
      }),
    })
  );
  const upstream = createServer(app);
  let armed = true;
  let lost: { status: number; body: string } | null = null;
  const upstreamOrigin = await listen(upstream);
  const proxy = createServer(async (req, res) => {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const response = await fetch(`${upstreamOrigin}${req.url}`, {
        method: req.method,
        headers: { "content-type": "application/json" },
        ...(chunks.length ? { body: Buffer.concat(chunks) } : {}),
        signal: AbortSignal.timeout(10000),
      });
      const body = await response.text();
      if (
        armed &&
        req.url === "/trpc/confirmNoChargeService" &&
        response.status === 200
      ) {
        armed = false;
        lost = { status: response.status, body };
        res.destroy();
        return;
      }
      res.writeHead(response.status, { "content-type": "application/json" });
      res.end(body);
    } catch (error) {
      res.statusCode = 502;
      res.end(String(error));
    }
  });
  try {
    const origin = await listen(proxy);
    return {
      url: `${origin}/trpc`,
      lost: () => lost,
      async close() {
        await closeServer(proxy);
        await closeServer(upstream);
      },
    };
  } catch (error) {
    await closeServer(proxy);
    await closeServer(upstream);
    throw error;
  }
}
