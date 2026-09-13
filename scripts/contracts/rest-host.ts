/** Disposable laboratory: mounts the production REST router and authentication. */
import express from "express";
import { randomUUID } from "node:crypto";
import { writeFile, unlink } from "node:fs/promises";
import { eq, inArray } from "drizzle-orm";
import { getDb, closePool } from "../../server/db";
import { users, notifications } from "../../drizzle/schema";
import { appRouter } from "../../server/routers";
import { createContext } from "../../server/_core/context";
import { createRestMiddleware } from "../../server/_core/rest";
import { getOpenApiDocument } from "../../server/openapi";
import { mobileAuthServiceV2 } from "../../server/services/mobile-auth-v2.service";

const target = new URL(process.env.DATABASE_URL ?? "mysql://invalid/invalid");
const descriptor = process.argv[2];
if (
  !descriptor ||
  process.env.NODE_ENV !== "test" ||
  process.env.AIS_DISPOSABLE_DATABASE !== "true" ||
  !["localhost", "127.0.0.1"].includes(target.hostname) ||
  !/^\/ais_[a-z0-9_]+_test$/.test(target.pathname)
)
  throw new Error(
    "Contract lab requires an explicitly disposable loopback test database"
  );
const db = getDb();
if (!db) throw new Error("Database unavailable");
if ((await db.select({ id: users.id }).from(users).limit(1)).length)
  throw new Error(
    "Contract lab requires empty users; never reset existing data"
  );
const userIds: number[] = [];
const notificationIds: number[][] = [];
const tokens: string[] = [];
for (let i = 0; i < 2; i++) {
  const [user] = await db.insert(users).values({
    openId: `contract-${randomUUID()}`,
    name: "Synthetic contract fixture",
  });
  userIds.push(user.insertId);
  tokens.push((await mobileAuthServiceV2.login(user.insertId)).accessToken);
  const ids: number[] = [];
  for (let j = 0; j < (i ? 1 : 10); j++) {
    const [row] = await db.insert(notifications).values({
      userId: user.insertId,
      type: "system",
      title: "Synthetic fixture",
      message: "Not a passenger message",
      isRead: false,
    });
    ids.push(row.insertId);
  }
  notificationIds.push(ids);
}
const paths = [
  "/notifications",
  "/notifications/unread-count",
  "/notifications/{id}/read",
  "/notifications/read-all",
];
const document = await getOpenApiDocument();
document.paths = Object.fromEntries(
  Object.entries(document.paths ?? {}).filter(([path]) => paths.includes(path))
);
const app = express();
app.use(express.json({ limit: "1mb" }));
const resetToken = randomUUID();
app.post("/__contract/reset", (req, res, next) => {
  if (req.header("x-lab-reset") !== resetToken) {
    res.sendStatus(403);
    return;
  }
  db.update(notifications)
    .set({ isRead: false, readAt: null })
    .where(inArray(notifications.id, notificationIds.flat()))
    .then(() => res.json({ ok: true }))
    .catch(next);
});
app.use(
  "/api/rest",
  (req, res, next) => {
    if (
      !(
        (req.method === "GET" &&
          ["/notifications", "/notifications/unread-count"].includes(
            req.path
          )) ||
        (req.method === "POST" &&
          /^\/notifications\/(read-all|[^/]+\/read)$/.test(req.path))
      )
    ) {
      res.sendStatus(404);
      return;
    }
    next();
  },
  createRestMiddleware({ router: appRouter, createContext })
);
const server = app.listen(0, "127.0.0.1", () => {
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("No lab address");
  const url = `http://127.0.0.1:${address.port}`;
  document.servers = [{ url: `${url}/api/rest` }];
  void writeFile(
    descriptor,
    JSON.stringify({
      url,
      schema: document,
      tokens,
      notificationIds,
      userIds,
      resetToken,
    }),
    { mode: 0o600 }
  );
});
async function stop() {
  server.close();
  // Delete only fixtures belonging to this run. The enclosing runner drops the database.
  for (const id of userIds)
    await db
      ?.update(users)
      .set({ name: "Completed contract fixture" })
      .where(eq(users.id, id));
  await closePool();
  await unlink(descriptor).catch(() => undefined);
  process.exit(0);
}
process.once("SIGTERM", () => {
  void stop();
});
process.once("SIGINT", () => {
  void stop();
});
