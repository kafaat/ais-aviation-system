/** Real TCP faults plus process death, layered on the real transaction fixture. */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { fork, type ChildProcess } from "node:child_process";
import { createServer } from "node:http";
import { writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { and, eq, sql } from "drizzle-orm";
import * as schema from "../../drizzle/schema";
import { getDb, closePool } from "../../server/db";
import {
  claimPendingEvents,
  markFailed,
  markPublished,
  recordEvent,
} from "../../server/services/outbox.service";
import { consumeLocalEvent } from "../../server/services/event-inbox.service";

function loopback(value: string) {
  const url = new URL(value);
  assert(
    ["127.0.0.1", "localhost"].includes(url.hostname),
    "Lab URLs must be loopback"
  );
  return url;
}
assert.equal(process.env.NODE_ENV, "test");
assert.equal(process.env.AIS_DISPOSABLE_DATABASE, "true");
assert.match(
  loopback(process.env.DATABASE_URL ?? "mysql://invalid").pathname,
  /^\/ais_[a-z0-9_]+_test$/
);
const db = getDb();
assert(db);
async function shutdown() {
  const { cacheService } = await import("../../server/services/cache.service");
  const { redisCacheService } =
    await import("../../server/services/redis-cache.service");
  await Promise.allSettled([
    cacheService.disconnect(),
    redisCacheService.shutdown(),
    closePool(),
  ]);
}

if (process.argv[2] === "worker") {
  const eventId = process.argv[3];
  const endpoint = loopback(process.argv[4] ?? "http://invalid");
  const [event] = await claimPendingEvents(1);
  assert(
    event?.eventId === eventId && event.leaseToken,
    "Worker must claim this lab event first"
  );
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      body: JSON.stringify(event),
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(200),
    });
    assert.equal(response.status, 200);
    process.send?.({
      delivered: true,
      id: event.id,
      leaseToken: event.leaseToken,
    });
    if (process.argv[5] === "hold")
      await new Promise(() => {
        setInterval(() => undefined, 1000);
      });
    assert.equal(await markPublished([event]), 1);
  } catch (error) {
    await markFailed(event.id, "Synthetic transport fault", event.leaseToken);
    if (process.argv[5] !== "fail") throw error;
    process.send?.({ failed: true });
  }
  await shutdown();
  process.exit(0);
}

const reportPath = process.argv[2];
assert(reportPath, "Report path required");
const control = loopback(process.env.TOXIPROXY_CONTROL_URL ?? "http://invalid");
assert.equal(control.protocol, "http:");
const proxyName = `ais-${randomUUID()}`;
const checks: string[] = [];
const children = new Set<ChildProcess>();
let eventId = "";
let deliveries = 0;
let receiverError: unknown;
const receiver = createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on("data", chunk => chunks.push(Buffer.from(chunk)));
  req.on("end", () => {
    void (async () => {
      const event = JSON.parse(Buffer.concat(chunks).toString());
      assert.equal(event.eventId, eventId);
      await consumeLocalEvent(event);
      deliveries++;
      res
        .writeHead(200, { "Content-Type": "application/json" })
        .end('{"accepted":true}');
    })().catch(error => {
      receiverError = error;
      res.writeHead(500).end();
    });
  });
});
async function api(path: string, method = "GET", body?: unknown) {
  const response = await fetch(new URL(path, control), {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(5000),
  });
  assert(response.ok, `Toxiproxy control HTTP ${response.status}`);
}
async function until(predicate: () => boolean) {
  for (let n = 0; n < 100; n++) {
    if (receiverError) throw receiverError;
    if (predicate()) return;
    await delay(50);
  }
  throw new Error("Transport assertion timeout");
}
async function unusedPort() {
  const server = createServer();
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address !== "string");
  await new Promise<void>(resolve => server.close(() => resolve()));
  return address.port;
}
function worker(endpoint: string, mode: string) {
  const child = fork(
    fileURLToPath(import.meta.url),
    ["worker", eventId, endpoint, mode],
    { stdio: ["ignore", "ignore", "inherit", "ipc"] }
  );
  children.add(child);
  const messages: Array<{
    delivered?: boolean;
    failed?: boolean;
    id: number;
    leaseToken: string;
  }> = [];
  child.on("message", message =>
    messages.push(message as (typeof messages)[number])
  );
  const done = new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", code => {
      children.delete(child);
      resolve(code);
    });
  });
  return { child, done, messages };
}
async function immutableSnapshot() {
  assert(db);
  const result = [];
  for (const table of [
    schema.bookings,
    schema.flights,
    schema.paymentReceipts,
    schema.payments,
    schema.bookingRefundItems,
    schema.wallets,
    schema.walletTransactions,
    schema.inventoryLocks,
  ]) {
    const rows = await db.select().from(table);
    result.push(rows.map(row => JSON.stringify(row)).sort());
  }
  return createHash("sha256").update(JSON.stringify(result)).digest("hex");
}
let completed = false;
try {
  const [fixture] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, 984001));
  assert.equal(
    fixture?.openId,
    "live-acceptance",
    "Run the complete disposable transaction fixture first"
  );
  const before = await immutableSnapshot();
  eventId = await db.transaction(tx =>
    recordEvent(tx, {
      aggregateType: "booking",
      aggregateId: 984001,
      eventType: "booking.created",
      tenantId: null,
      payload: {},
    })
  );
  await db
    .update(schema.outbox)
    .set({ createdAt: new Date("2000-01-01T00:00:00Z") })
    .where(eq(schema.outbox.eventId, eventId));
  await new Promise<void>(resolve => receiver.listen(0, "127.0.0.1", resolve));
  const address = receiver.address();
  assert(address && typeof address !== "string");
  const port = await unusedPort();
  const endpoint = `http://127.0.0.1:${port}`;
  await api("/proxies", "POST", {
    name: proxyName,
    listen: `127.0.0.1:${port}`,
    upstream: `127.0.0.1:${address.port}`,
    enabled: false,
  });
  const outage = worker(endpoint, "fail");
  assert.equal(await outage.done, 0);
  assert(outage.messages.some(m => m.failed));
  assert.equal(deliveries, 0);
  checks.push("TCP outage leaves the event retryable without an effect");

  await api(`/proxies/${proxyName}`, "POST", { enabled: true });
  await api(`/proxies/${proxyName}/toxics`, "POST", {
    name: "late-ack",
    type: "latency",
    stream: "downstream",
    toxicity: 1,
    attributes: { latency: 1000, jitter: 0 },
  });
  const late = worker(endpoint, "fail");
  assert.equal(await late.done, 0);
  assert(late.messages.some(m => m.failed));
  await until(() => deliveries === 1);
  checks.push(
    "Consumer commits while downstream acknowledgement exceeds the sender deadline"
  );

  await api(`/proxies/${proxyName}/toxics/late-ack`, "DELETE");
  const killed = worker(endpoint, "hold");
  await until(() => killed.messages.some(m => m.delivered));
  const oldClaim = killed.messages.find(m => m.delivered);
  assert(oldClaim);
  killed.child.kill("SIGKILL");
  assert.equal(await killed.done, null);
  const [orphan] = await db
    .select()
    .from(schema.outbox)
    .where(eq(schema.outbox.eventId, eventId));
  assert.equal(orphan?.status, "processing");
  // Advance only this fixture's stored lease clock; no production lease duration is weakened.
  await db
    .update(schema.outbox)
    .set({ lockedAt: new Date(Date.now() - 600000) })
    .where(eq(schema.outbox.eventId, eventId));
  assert.equal(await worker(endpoint, "publish").done, 0);
  assert.equal(await markPublished([oldClaim]), 0);
  checks.push(
    "A killed worker is reclaimed and its old lease cannot acknowledge the new claim"
  );

  const [published] = await db
    .select()
    .from(schema.outbox)
    .where(eq(schema.outbox.eventId, eventId));
  assert.equal(published?.status, "published");
  assert(deliveries >= 3);
  assert.equal(
    (
      await db
        .select()
        .from(schema.notifications)
        .where(
          sql`JSON_UNQUOTE(JSON_EXTRACT(${schema.notifications.data}, '$.eventId')) = ${eventId}`
        )
    ).length,
    1
  );
  const receipts = await db
    .select()
    .from(schema.eventDeliveries)
    .where(
      and(
        eq(schema.eventDeliveries.eventId, eventId),
        eq(schema.eventDeliveries.consumer, "notifications")
      )
    );
  assert.equal(receipts.length, 1);
  assert.equal(receipts[0]?.status, "processed");
  assert.equal(await immutableSnapshot(), before);
  checks.push(
    "Repeated delivery creates one notification; money receipts, balances and capacity remain identical"
  );
  completed = true;
} finally {
  for (const child of children) child.kill("SIGKILL");
  await api(`/proxies/${proxyName}`, "DELETE").catch(() => undefined);
  receiver.closeAllConnections();
  await new Promise<void>(resolve => receiver.close(() => resolve()));
  await shutdown();
  await writeFile(
    reportPath,
    JSON.stringify(
      {
        completed,
        checks,
        passed: checks.length,
        providerCalls: 0,
        transport: "real Toxiproxy TCP",
        processTermination: "SIGKILL",
      },
      null,
      2
    )
  );
}
