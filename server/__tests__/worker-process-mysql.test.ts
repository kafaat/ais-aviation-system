import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import mysql from "mysql2/promise";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { startNativeRedis } from "./helpers/native-redis";
import {
  startWorkerProcessFixture,
  waitForWorkerCondition,
} from "./helpers/worker-process-fixture";

type Worker = Awaited<ReturnType<typeof startWorkerProcessFixture>>;
interface TaskRow extends mysql.RowDataPacket {
  name: string;
  leaseToken: string | null;
  leaseUntil: Date | null;
  lastTick: string | null;
  lastStartedAt: Date | null;
  lastSuccessAt: Date | null;
  lastError: string | null;
}
interface ReportRow extends mysql.RowDataPacket {
  id: number;
  status: string;
  content: string;
  checksum: string;
  requestKey: string;
  recordCount: number;
  completedAt: Date;
  deliveryStatus: string;
}
interface TraceRow extends mysql.RowDataPacket {
  id: number;
  kind: string;
  name: string;
  detail: string;
  occurredAt: Date;
}

const nativeDescribe =
  process.env.AIS_DISPOSABLE_DATABASE === "true" &&
  process.env.NODE_ENV === "test" &&
  process.env.DATABASE_URL
    ? describe
    : describe.skip;

/**
 * OPS-09: no vi.mock, fake clock, alternate worker, or direct scheduler call.
 * Fault seams are SQL row locks, an absent privacy source table, a replaced
 * lease token and a retained due date. They affect only this owned schema.
 */
nativeDescribe.sequential(
  "actual worker process and native scheduled receipts",
  () => {
    let admin: mysql.Connection | undefined;
    let pool: mysql.Pool | undefined;
    let redis: Awaited<ReturnType<typeof startNativeRedis>> | undefined;
    let databaseName = "";
    let databaseUrl = "";
    let created = false;
    let templateDue: Date;
    let privacySourceMissing = false;
    let lock: mysql.PoolConnection | undefined;
    const workers: Worker[] = [];

    beforeAll(async () => {
      const source = new URL(process.env.DATABASE_URL!);
      const sourceDatabase = source.pathname.slice(1);
      if (
        source.protocol !== "mysql:" ||
        !/^[A-Za-z0-9_]+_test$/.test(sourceDatabase) ||
        !["127.0.0.1", "localhost", "[::1]"].includes(source.hostname)
      )
        throw new Error(
          "Worker acceptance requires a disposable loopback _test source"
        );
      const options = {
        host: source.hostname.replace(/^\[|\]$/g, ""),
        port: Number(source.port || 3306),
        user: decodeURIComponent(source.username),
        password: decodeURIComponent(source.password),
        timezone: "Z",
      };
      databaseName = "ais_worker_process_" + randomBytes(6).toString("hex");
      if (!/^ais_worker_process_[0-9a-f]{12}$/.test(databaseName))
        throw new Error("Invalid owned worker schema");
      admin = await mysql.createConnection(options);
      await admin.query("CREATE DATABASE " + databaseName);
      created = true;
      pool = mysql.createPool({
        ...options,
        database: databaseName,
        connectionLimit: 4,
      });
      // Clone native table/index definitions from the migration-verified source,
      // without copying its data. All real cron callbacks can query their tables.
      // CREATE TABLE LIKE does not assert foreign-key/migration replay coverage.
      const [tables] = await admin.query<mysql.RowDataPacket[]>(
        "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_TYPE='BASE TABLE' ORDER BY TABLE_NAME",
        [sourceDatabase]
      );
      if (tables.length < 50)
        throw new Error("The disposable source schema is not migrated");
      for (const row of tables) {
        const table = String(row.TABLE_NAME);
        if (!/^[A-Za-z0-9_]+$/.test(table))
          throw new Error("Unsafe source table name");
        if (table.startsWith("__drizzle")) continue;
        await pool.query(
          `CREATE TABLE \`${table}\` LIKE \`${sourceDatabase}\`.\`${table}\``
        );
      }
      // Test-only SQL observers record actual writes; they do not decide claims,
      // alter results, delay callbacks, or manufacture production receipts.
      await pool.query(`CREATE TABLE fixture_worker_trace (
      id INT AUTO_INCREMENT PRIMARY KEY, kind VARCHAR(30) NOT NULL,
      name VARCHAR(100) NOT NULL, detail TEXT,
      occurredAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
    ) ENGINE=InnoDB`);
      await pool.query(`CREATE TRIGGER fixture_scheduled_trace AFTER UPDATE ON scheduled_tasks
      FOR EACH ROW BEGIN
        IF NEW.leaseToken IS NOT NULL AND NOT (NEW.leaseToken <=> OLD.leaseToken) THEN
          INSERT INTO fixture_worker_trace(kind,name,detail) VALUES('claim',NEW.name,NEW.leaseToken);
        ELSEIF NEW.leaseToken IS NOT NULL AND NEW.leaseUntil > OLD.leaseUntil THEN
          INSERT INTO fixture_worker_trace(kind,name,detail) VALUES('renew',NEW.name,NEW.leaseToken);
        END IF;
        IF NEW.lastSuccessAt IS NOT NULL AND NOT (NEW.lastTick <=> OLD.lastTick) THEN
          INSERT INTO fixture_worker_trace(kind,name,detail) VALUES('success',NEW.name,NEW.lastTick);
        END IF;
        IF NEW.lastError IS NOT NULL AND NOT (NEW.lastError <=> OLD.lastError) THEN
          INSERT INTO fixture_worker_trace(kind,name,detail) VALUES('failure',NEW.name,NEW.lastError);
        END IF;
      END`);
      await pool.query(`CREATE TRIGGER fixture_report_trace AFTER UPDATE ON standard_report_runs
      FOR EACH ROW BEGIN
        IF NEW.status='ready' AND OLD.status<>'ready' THEN
          INSERT INTO fixture_worker_trace(kind,name,detail) VALUES('report_ready',NEW.id,NEW.checksum);
        END IF;
      END`);
      await pool.query(`CREATE TRIGGER fixture_stopped_trace AFTER INSERT ON operational_samples
      FOR EACH ROW BEGIN
        IF NEW.component='worker' AND NEW.status='stopped' THEN
          INSERT INTO fixture_worker_trace(kind,name,detail) VALUES('worker_stopped',NEW.instanceId,NEW.status);
        END IF;
      END`);
      source.pathname = "/" + databaseName;
      databaseUrl = source.toString();
      redis = await startNativeRedis();
    }, 60_000);

    async function releaseTemplateLock() {
      const held = lock;
      lock = undefined;
      if (!held) return;
      try {
        await held.rollback();
      } finally {
        held.release();
      }
    }
    async function restorePrivacySource() {
      if (!privacySourceMissing) return;
      await pool!.query(
        "RENAME TABLE fixture_privacy_chunks_unavailable TO privacy_export_chunks"
      );
      privacySourceMissing = false;
    }
    afterEach(async context => {
      await releaseTemplateLock();
      const closed = await Promise.allSettled(
        workers.splice(0).map(worker => worker.close())
      );
      await restorePrivacySource();
      const artifactDirectory = process.env.AIS_TEST_PROCESS_ARTIFACT_DIR;
      if (artifactDirectory) {
        if (!isAbsolute(artifactDirectory))
          throw new Error("Worker artifact directory must be absolute");
        const [scheduler] = await pool!.query<TaskRow[]>(
          "SELECT * FROM scheduled_tasks ORDER BY name"
        );
        const [reports] = await pool!.query<mysql.RowDataPacket[]>(
          "SELECT id,templateId,status,requestKey,recordCount,checksum,deliveryStatus,completedAt FROM standard_report_runs ORDER BY id"
        );
        const [events] = await pool!.query<TraceRow[]>(
          "SELECT * FROM fixture_worker_trace ORDER BY id"
        );
        await mkdir(artifactDirectory, { recursive: true });
        const name = context.task.name
          .replace(/[^a-z0-9]+/gi, "-")
          .slice(0, 100);
        await writeFile(
          join(artifactDirectory, name + ".json"),
          JSON.stringify(
            { scenario: context.task.name, scheduler, reports, events },
            null,
            2
          ) + "\n"
        );
      }
      for (const result of closed)
        if (result.status === "rejected") throw result.reason;
    }, 45_000);
    afterAll(async () => {
      try {
        await redis?.stop();
      } finally {
        try {
          await pool?.end();
        } finally {
          if (admin) {
            try {
              if (created) await admin.query("DROP DATABASE " + databaseName);
            } finally {
              await admin.end();
            }
          }
        }
      }
    }, 20_000);

    beforeEach(async () => {
      for (const table of [
        "standard_report_runs",
        "standard_report_templates",
        "scheduled_tasks",
        "operational_samples",
        "fixture_worker_trace",
        "flights",
        "airports",
        "airlines",
        "users",
      ])
        await pool!.query(`DELETE FROM \`${table}\``);
      await pool!.query(
        "INSERT INTO users(id,openId,role,name,email) VALUES(11,'worker-fixture-owner','admin','Worker fixture','worker@example.test')"
      );
      await pool!.query(
        "INSERT INTO airlines(id,code,name) VALUES(11,'WF','Worker fixture')"
      );
      await pool!.query(
        "INSERT INTO airports(id,code,name,city,country,timezone) VALUES(11,'WFA','Origin','Origin','Test','UTC'),(12,'WFB','Destination','Destination','Test','UTC')"
      );
      const day = new Date().toISOString().slice(0, 10);
      await pool!.query(
        "INSERT INTO flights(id,flightNumber,airlineId,originId,destinationId,departureTime,arrivalTime,aircraftType,status,economySeats,businessSeats,economyAvailable,businessAvailable,economyPrice,businessPrice) VALUES(7,'WF700',11,11,12,?,?,'A320','scheduled',100,10,75,6,50000,100000)",
        [`${day} 12:00:00`, `${day} 14:00:00`]
      );
      templateDue = new Date(Math.floor((Date.now() - 120_000) / 1000) * 1000);
      await pool!.query(
        "INSERT INTO standard_report_templates(id,createdBy,reportId,name,filters,columns,format,cadence,hourUtc,minuteUtc,emailToOwner,enabled,nextRunAt) VALUES(1,11,15,'Worker actual inventory',?,?,'csv','daily',0,0,false,true,?)",
        [
          JSON.stringify({ startDate: day, flightId: 7 }),
          JSON.stringify([
            "flightId",
            "flightNumber",
            "capacity",
            "sold",
            "economyAvailable",
            "businessAvailable",
          ]),
          templateDue,
        ]
      );
    });

    async function launch(label: string) {
      const worker = await startWorkerProcessFixture({
        databaseUrl,
        redisUrl: redis!.url,
        label,
      });
      workers.push(worker);
      return worker;
    }
    async function task(name = "standardReports") {
      const [rows] = await pool!.query<TaskRow[]>(
        "SELECT * FROM scheduled_tasks WHERE name=?",
        [name]
      );
      return rows[0] ?? null;
    }
    async function trace(kind: string, name?: string) {
      const [rows] = await pool!.query<TraceRow[]>(
        "SELECT * FROM fixture_worker_trace WHERE kind=?" +
          (name ? " AND name=?" : "") +
          " ORDER BY id",
        name ? [kind, name] : [kind]
      );
      return rows;
    }
    async function readyReport() {
      const rows = await waitForWorkerCondition(
        async () => {
          const [reports] = await pool!.query<ReportRow[]>(
            "SELECT * FROM standard_report_runs WHERE templateId=1 ORDER BY id"
          );
          return reports;
        },
        reports => reports.length === 1 && reports[0].status === "ready",
        75_000,
        "the real minute tick's report receipt"
      );
      const report = rows[0];
      expect(report.requestKey).toBe(`schedule:1:${templateDue.toISOString()}`);
      expect(report.recordCount).toBe(1);
      expect(report.deliveryStatus).toBe("none");
      expect(
        report.content
          .replace(/^\uFEFF/, "")
          .split("\r\n")
          .at(-1)
      ).toBe("7,WF700,110,29,75,6");
      expect(createHash("sha256").update(report.content).digest("hex")).toBe(
        report.checksum
      );
      return report;
    }
    async function holdTemplateUpdate() {
      lock = await pool!.getConnection();
      await lock.beginTransaction();
      await lock.query(
        "SELECT id FROM standard_report_templates WHERE id=1 FOR UPDATE"
      );
    }
    async function launchWindow() {
      // Keep both processes' startup away from the minute edge. Production cron,
      // its minute tick and the 30-second lease interval remain unchanged.
      while (60_000 - (Date.now() % 60_000) < 20_000) await delay(250);
    }
    function cronAttempts(worker: Worker) {
      return worker.records.filter(
        row => row.message === "Running cron job: standardReports"
      );
    }

    it("keeps two live workers' readiness independent and compatible with the deployed probe", async () => {
      // No cron task is needed for this focused process-isolation regression.
      await pool!.query("UPDATE standard_report_templates SET enabled=false");
      const first = await launch("readiness-first");
      const second = await launch("readiness-second");
      expect(first.pid).not.toBe(second.pid);
      expect(first.readinessPath).not.toBe(second.readinessPath);
      expect(await first.probe()).toBe(0);
      expect(await second.probe()).toBe(0);
      expect(await first.stop()).toEqual({ code: 0, signal: null });
      expect(await first.probe()).not.toBe(0);
      expect(second.alive()).toBe(true);
      expect(await second.probe()).toBe(0);
      expect(await second.stop()).toEqual({ code: 0, signal: null });
      expect(await second.probe()).not.toBe(0);
    }, 60_000);

    it("claims one real minute tick, renews beyond 30 seconds, isolates failure, drains on SIGTERM and replays without a duplicate effect", async () => {
      await launchWindow();
      // Deliberate callback fault: only privacyRequests loses its first SQL
      // source. Its real error must not stop the independent standardReports job.
      await pool!.query(
        "RENAME TABLE privacy_export_chunks TO fixture_privacy_chunks_unavailable"
      );
      privacySourceMissing = true;
      await holdTemplateUpdate();
      const first = await launch("drain-first");
      const second = await launch("drain-second");
      expect(await first.probe()).toBe(0);
      expect(await second.probe()).toBe(0);
      const report = await readyReport();
      const claimed = await task();
      if (!claimed?.leaseToken || !claimed.leaseUntil)
        throw new Error("The real report tick did not hold a lease");
      const originalLease = claimed.leaseUntil.getTime();
      expect(claimed.lastSuccessAt).toBeNull();
      expect(claimed.lastTick).toBeNull();
      expect(await trace("claim", "standardReports")).toHaveLength(1);
      expect(cronAttempts(first)).toHaveLength(1);
      expect(cronAttempts(second)).toHaveLength(1);
      const independentFailure = await waitForWorkerCondition(
        () => task("privacyRequests"),
        row => Boolean(row?.lastError),
        10_000,
        "independent task's native failure receipt"
      );
      expect(independentFailure?.lastSuccessAt).toBeNull();
      expect(independentFailure?.lastError).toContain("privacy_export_chunks");
      const independentSuccess = await task("onCallDelivery");
      expect(independentSuccess?.lastSuccessAt).toBeInstanceOf(Date);

      const renewed = await waitForWorkerCondition(
        task,
        row =>
          Boolean(
            row?.leaseUntil &&
            row.leaseUntil.getTime() >= originalLease + 29_000
          ),
        40_000,
        "native 30-second lease renewal while the template row is locked"
      );
      expect(renewed?.leaseToken).toBe(claimed.leaseToken);
      expect(await trace("renew", "standardReports")).not.toHaveLength(0);
      const claims = await trace("claim", "standardReports");
      expect(
        Date.now() - claims[0].occurredAt.getTime()
      ).toBeGreaterThanOrEqual(30_000);
      expect(await first.probe()).toBe(0);
      expect(await second.probe()).toBe(0);
      // The lock covers only the template. Reads/lease writes in scheduled_tasks
      // above are real independent MySQL statements, not an in-memory barrier.
      first.signal();
      second.signal();
      await waitForWorkerCondition(
        async () => [await first.ready(), await second.ready()],
        values => values.every(value => !value),
        3000,
        "SIGTERM readiness removal"
      );
      expect(await first.probe()).not.toBe(0);
      expect(await second.probe()).not.toBe(0);
      await waitForWorkerCondition(
        async () =>
          [...first.records, ...second.records].some(
            row => row.message === "Waiting for in-flight cron ticks"
          ),
        Boolean,
        3000,
        "worker drain of the blocked callback"
      );
      expect(first.alive() || second.alive()).toBe(true);
      expect((await task())?.lastSuccessAt).toBeNull();
      await releaseTemplateLock();
      expect(await first.waitForExit()).toEqual({ code: 0, signal: null });
      expect(await second.waitForExit()).toEqual({ code: 0, signal: null });
      const completed = await task();
      expect(completed).toMatchObject({
        leaseToken: null,
        leaseUntil: null,
        lastError: null,
      });
      expect(completed?.lastSuccessAt).toBeInstanceOf(Date);
      expect(await trace("success", "standardReports")).toHaveLength(1);
      expect(await trace("report_ready")).toHaveLength(1);
      expect(await trace("worker_stopped")).toHaveLength(2);
      const success = (await trace("success", "standardReports"))[0];
      const drainingWorker = [first, second].find(worker =>
        worker.records.some(
          row => row.message === "Waiting for in-flight cron ticks"
        )
      );
      const closing = drainingWorker?.records.find(
        row => row.message === "Closing database connection pool..."
      );
      expect(closing).toBeDefined();
      expect(success.occurredAt.getTime()).toBeLessThanOrEqual(
        Date.parse(String(closing!.timestamp))
      );
      expect(
        drainingWorker?.records.some(
          row => row.message === "Graceful shutdown completed"
        )
      ).toBe(true);

      // Deliberate crash-state seam: the durable report already exists but the
      // due cursor was not advanced. A restarted real worker must reuse it.
      await restorePrivacySource();
      await pool!.query(
        "UPDATE standard_report_templates SET nextRunAt=? WHERE id=1",
        [templateDue]
      );
      await launchWindow();
      const restarted = await launch("restarted");
      expect(await restarted.probe()).toBe(0);
      const replayedTask = await waitForWorkerCondition(
        task,
        row =>
          Boolean(
            row?.lastTick &&
            row.lastTick !== completed?.lastTick &&
            row.lastSuccessAt
          ),
        75_000,
        "the restarted worker's next native minute tick"
      );
      expect(replayedTask?.lastError).toBeNull();
      const replayedReport = await readyReport();
      expect(replayedReport.id).toBe(report.id);
      expect(replayedReport.checksum).toBe(report.checksum);
      expect(replayedReport.completedAt).toEqual(report.completedAt);
      expect(await trace("report_ready")).toHaveLength(1);
      expect(await trace("claim", "standardReports")).toHaveLength(2);
      expect((await task("privacyRequests"))?.lastError).toBeNull();
      expect((await task("privacyRequests"))?.lastSuccessAt).toBeInstanceOf(
        Date
      );
      expect(await restarted.stop()).toEqual({ code: 0, signal: null });
    }, 240_000);

    it("does not claim scheduler success after a real running tick loses its lease token", async () => {
      await launchWindow();
      await holdTemplateUpdate();
      const worker = await launch("lease-loss");
      expect(await worker.probe()).toBe(0);
      await readyReport();
      const original = await task();
      expect(original?.leaseToken).toBeTruthy();
      expect(await trace("claim", "standardReports")).toHaveLength(1);
      const replacementToken = randomUUID();
      const replacementUntil = new Date(
        Math.floor((Date.now() + 600_000) / 1000) * 1000
      );
      // Deliberate fencing fault: another owner takes the scheduler token while
      // this callback is blocked. No production timing or completion is mocked.
      await pool!.query(
        "UPDATE scheduled_tasks SET leaseToken=?,leaseUntil=? WHERE name='standardReports'",
        [replacementToken, replacementUntil]
      );
      await releaseTemplateLock();
      await waitForWorkerCondition(
        async () => worker.diagnostics(),
        output => output.includes("Scheduled task lost its lease"),
        10_000,
        "real worker's lease-loss error"
      );
      expect(await task()).toMatchObject({
        leaseToken: replacementToken,
        leaseUntil: replacementUntil,
        lastTick: null,
        lastSuccessAt: null,
      });
      expect(await trace("success", "standardReports")).toHaveLength(0);
      expect(await trace("report_ready")).toHaveLength(1);
      expect(await worker.stop()).toEqual({ code: 0, signal: null });
      expect(await worker.probe()).not.toBe(0);
      expect((await task())?.leaseToken).toBe(replacementToken);
    }, 120_000);
  }
);
