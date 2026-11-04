import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import mysql from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import * as schema from "../../drizzle/schema";

const state = vi.hoisted(() => ({
  db: null as unknown,
  read: vi.fn(),
  email: vi.fn(),
}));
vi.mock("../db", () => ({ getDb: () => state.db }));
vi.mock("../services/email.service", () => ({
  sendEmailWithReceipt: state.email,
}));
vi.mock("../services/standard-reports-ops.service", () => ({
  operationsReportDefinitions: [
    {
      id: 5,
      title: "Flight Load",
      category: "operations",
      availability: "available",
      description: "Recorded load",
      limitations: [],
      filters: ["startDate", "endDate"],
    },
  ],
  getOperationsStandardReport: state.read,
}));
vi.mock("../services/standard-reports-finance.service", () => ({
  financeReportDefinitions: [],
  getFinanceStandardReport: vi.fn(),
}));
vi.mock("../services/standard-reports-commercial.service", () => ({
  commercialReportDefinitions: [],
  getCommercialStandardReport: vi.fn(),
}));
import {
  deleteStandardReportTemplate,
  downloadStandardReportRun,
  listStandardReportRuns,
  listStandardReportTemplates,
  processStandardReportSchedules,
  runStandardReportTemplate,
  saveStandardReportTemplate,
  setStandardReportTemplateEnabled,
} from "../services/standard-report-schedules.service";
import { reportTemplateInputSchema } from "../contracts/standard-reports";

const nativeDescribe =
  process.env.AIS_DISPOSABLE_DATABASE === "true" &&
  process.env.NODE_ENV === "test" &&
  process.env.DATABASE_URL
    ? describe
    : describe.skip;

nativeDescribe("native report templates, leases and delivery receipts", () => {
  let admin: mysql.Connection;
  let pool: mysql.Pool;
  let databaseName = "";
  const owner = {
    id: 11,
    tenantId: 101,
    role: "ops",
    email: "report-owner@example.test",
  };
  const other = {
    id: 22,
    tenantId: 202,
    role: "ops",
    email: "other-owner@example.test",
  };
  const input = () =>
    reportTemplateInputSchema.parse({
      reportId: 5,
      name: "Daily load",
      filters: {},
      columns: ["record", "quantity"],
      format: "csv",
    });

  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL!);
    const options = {
      host: url.hostname,
      port: Number(url.port || 3306),
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      timezone: "Z",
    };
    databaseName = "ais_report_schedule_" + randomBytes(6).toString("hex");
    if (!/^ais_report_schedule_[0-9a-f]{12}$/.test(databaseName))
      throw new Error("Invalid isolated database name");
    admin = await mysql.createConnection(options);
    await admin.query("CREATE DATABASE " + databaseName);
    pool = mysql.createPool({
      ...options,
      database: databaseName,
      connectionLimit: 5,
    });
    for (const statement of readFileSync(
      new URL("../../drizzle/0066_standard_reporting.sql", import.meta.url),
      "utf8"
    )
      .split("--> statement-breakpoint")
      .map(statement => statement.trim())
      .filter(Boolean))
      await pool.query(statement);
    await pool.query(
      "CREATE TABLE users(id INT PRIMARY KEY, tenantId INT, role VARCHAR(30), email VARCHAR(320))"
    );
    await pool.query(
      "CREATE TABLE tenants(id INT PRIMARY KEY, slug VARCHAR(64), name VARCHAR(255), airlineCode VARCHAR(3), status VARCHAR(20), contactEmail VARCHAR(320), createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP)"
    );
    state.db = drizzle(pool, { schema, mode: "default" });
  });
  beforeEach(async () => {
    await pool.query("DELETE FROM standard_report_runs");
    await pool.query("DELETE FROM standard_report_templates");
    await pool.query("DELETE FROM users");
    await pool.query("DELETE FROM tenants");
    await pool.query(
      "INSERT INTO users(id,tenantId,role,email) VALUES (11,101,'ops','report-owner@example.test'),(22,202,'ops','other-owner@example.test')"
    );
    await pool.query(
      "INSERT INTO tenants(id,slug,name,status) VALUES(101,'one','One','active'),(202,'two','Two','active')"
    );
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("EMAIL_FROM", "");
    state.read.mockImplementation(async (_id, _filters, scope) => ({
      columns: [
        { key: "record", label: "Record", type: "text" },
        { key: "quantity", label: "Quantity", type: "number" },
      ],
      rows: [{ record: `tenant-${scope.tenantId}`, quantity: 0 }],
      notes: [],
    }));
    state.email.mockResolvedValue({
      id: "provider-acceptance-test",
      acceptedAt: new Date(),
    });
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    state.db = null;
    await pool?.end();
    if (admin) {
      if (databaseName) await admin.query("DROP DATABASE " + databaseName);
      await admin.end();
    }
  });

  it("uses the recovery index for sparse pending reads and stale sending updates", async () => {
    const indexName = "standard_report_run_recovery";
    const [indexRows] = await pool.query<mysql.RowDataPacket[]>(
      "SHOW INDEX FROM standard_report_runs WHERE Key_name = ?",
      [indexName]
    );
    expect(
      indexRows
        .sort((left, right) => left.Seq_in_index - right.Seq_in_index)
        .map(row => ({ column: row.Column_name, nonUnique: row.Non_unique }))
    ).toEqual([
      { column: "status", nonUnique: 1 },
      { column: "deliveryStatus", nonUnique: 1 },
      { column: "id", nonUnique: 1 },
    ]);

    // Put a small recovery backlog after substantial completed history so the
    // optimizer has representative selectivity and cannot satisfy LIMIT early
    // by scanning the beginning of the primary key. No index hints are used.
    const historyCount = 5000;
    for (let offset = 0; offset < historyCount; offset += 500) {
      const rows = Array.from({ length: 500 }, (_, position) => {
        const id = offset + position + 1;
        return [id, 11, 101, 5, "Archived report", `history-${id}`, "hash"];
      });
      await pool.query(
        "INSERT INTO standard_report_runs (id,createdBy,tenantId,reportId,name,requestKey,definitionHash,filters,format,status,deliveryStatus) VALUES " +
          rows
            .map(() => "(?,?,?,?,?,?,?,'{}','csv','ready','accepted')")
            .join(","),
        rows.flat()
      );
    }
    const recoveryRows = [
      [5001, "ready", "pending", null],
      [5002, "ready", "pending", null],
      [5003, "failed", "pending", null],
      [5004, "generating", "pending", null],
      [5005, "ready", "sending", "2030-01-02 11:59:59"],
      [5006, "ready", "sending", null],
      [5007, "ready", "sending", "2030-01-02 12:01:00"],
      [5008, "failed", "sending", "2030-01-02 11:59:59"],
      [5009, "generating", "sending", null],
    ];
    await pool.query(
      "INSERT INTO standard_report_runs (id,createdBy,tenantId,reportId,name,requestKey,definitionHash,filters,format,status,deliveryStatus,deliveryStartedAt) VALUES " +
        recoveryRows
          .map(() => "(?,11,101,5,'Recovery report',?,'hash','{}','csv',?,?,?)")
          .join(","),
      recoveryRows.flatMap(([id, status, deliveryStatus, startedAt]) => [
        id,
        `recovery-${id}`,
        status,
        deliveryStatus,
        startedAt,
      ])
    );
    await pool.query("ANALYZE TABLE standard_report_runs");

    // These are the two recovery query shapes. Existing tests cover the full
    // delivery state machine; here both native plans must avoid history scans.
    const pendingSql =
      "SELECT id,createdBy,tenantId,reportId FROM standard_report_runs WHERE status='ready' AND deliveryStatus='pending' ORDER BY id LIMIT 100";
    const staleSql =
      "UPDATE standard_report_runs SET deliveryStatus='unknown',errorMessage=? WHERE status='ready' AND deliveryStatus='sending' AND (deliveryStartedAt IS NULL OR deliveryStartedAt<=?)";
    const staleParams = ["Interrupted attempt", "2030-01-02 12:00:00"];
    for (const [query, params] of [
      [pendingSql, []],
      [staleSql, staleParams],
    ] as const) {
      const [plan] = await pool.query<mysql.RowDataPacket[]>(
        `EXPLAIN FORMAT=TRADITIONAL ${query}`,
        params
      );
      expect(plan).toHaveLength(1);
      expect(plan[0].key).toBe(indexName);
      expect(["ref", "range"]).toContain(plan[0].type);
      expect(Number(plan[0].rows)).toBeLessThan(historyCount / 10);
      expect(plan[0].Extra ?? "").not.toContain("filesort");
    }
    const [pending] = await pool.query<mysql.RowDataPacket[]>(pendingSql);
    expect(pending.map(row => row.id)).toEqual([5001, 5002]);
    const [updated] = await pool.execute<mysql.ResultSetHeader>(
      staleSql,
      staleParams
    );
    expect(updated.affectedRows).toBe(2);
    const [changed] = await pool.query<mysql.RowDataPacket[]>(
      "SELECT id FROM standard_report_runs WHERE deliveryStatus='unknown' ORDER BY id"
    );
    expect(changed.map(row => row.id)).toEqual([5005, 5006]);
  });

  it("persists a real selected-column template and denies other owners and scopes", async () => {
    const saved = await saveStandardReportTemplate(owner, 101, input());
    expect(saved.columns).toEqual(["record", "quantity"]);
    expect(
      (await listStandardReportTemplates(owner, 101)).map(row => row.id)
    ).toEqual([saved.id]);
    expect(await listStandardReportTemplates(other, 202)).toEqual([]);
    await expect(
      runStandardReportTemplate(other, 202, saved.id, randomUUID())
    ).rejects.toThrow("not found");
    await expect(
      deleteStandardReportTemplate(other, 202, saved.id)
    ).rejects.toThrow("not found");
    await expect(
      runStandardReportTemplate(
        { ...owner, tenantId: 202 },
        202,
        saved.id,
        randomUUID()
      )
    ).rejects.toThrow("different access scope");
  });
  it("claims concurrent requests once, preserves output, and detects changed idempotent configuration", async () => {
    const saved = await saveStandardReportTemplate(owner, 101, input());
    state.read.mockClear();
    const key = randomUUID();
    const pair = await Promise.all([
      runStandardReportTemplate(owner, 101, saved.id, key),
      runStandardReportTemplate(owner, 101, saved.id, key),
    ]);
    expect(pair[0].id).toBe(pair[1].id);
    expect(state.read).toHaveBeenCalledTimes(1);
    const run = await runStandardReportTemplate(owner, 101, saved.id, key);
    expect(run.status).toBe("ready");
    const output = await downloadStandardReportRun(owner, 101, run.id);
    expect(output.content).toContain("tenant-101,0");
    expect(output.checksum).toBe(run.checksum);
    expect(await listStandardReportRuns(other, 202)).toEqual([]);
    await saveStandardReportTemplate(
      owner,
      101,
      { ...input(), format: "xml" },
      saved.id
    );
    await expect(
      runStandardReportTemplate(owner, 101, saved.id, key)
    ).rejects.toThrow("different report configuration");
  });
  it("rechecks current permissions on historical downloads and refuses tampered content", async () => {
    const saved = await saveStandardReportTemplate(owner, 101, input());
    const run = await runStandardReportTemplate(
      owner,
      101,
      saved.id,
      randomUUID()
    );
    await expect(
      downloadStandardReportRun({ ...owner, role: "user" }, 101, run.id)
    ).rejects.toThrow("role");
    await expect(
      downloadStandardReportRun({ ...owner, role: "admin" }, 101, run.id)
    ).rejects.toThrow("different access scope");
    await expect(downloadStandardReportRun(other, 202, run.id)).rejects.toThrow(
      "not found"
    );
    await pool.execute(
      "UPDATE standard_report_runs SET content='changed' WHERE id=?",
      [run.id]
    );
    await expect(downloadStandardReportRun(owner, 101, run.id)).rejects.toThrow(
      "checksum"
    );
  });
  it("does not mark missing provider configuration as delivered", async () => {
    const saved = await saveStandardReportTemplate(owner, 101, {
      ...input(),
      emailToOwner: true,
    });
    const run = await runStandardReportTemplate(
      owner,
      101,
      saved.id,
      randomUUID()
    );
    expect(run.status).toBe("ready");
    expect(run.deliveryStatus).toBe("failed");
    expect(run.emailReceiptId).toBeNull();
    expect(state.email).not.toHaveBeenCalled();
    expect(
      (await downloadStandardReportRun(owner, 101, run.id)).recordCount
    ).toBe(1);
  });
  it("persists provider acceptance once, distinctly from recipient delivery", async () => {
    vi.stubEnv("RESEND_API_KEY", "unit-test-provider-placeholder");
    vi.stubEnv("EMAIL_FROM", "test@example.test");
    const saved = await saveStandardReportTemplate(owner, 101, {
      ...input(),
      emailToOwner: true,
    });
    const key = randomUUID();
    const run = await runStandardReportTemplate(owner, 101, saved.id, key);
    expect(run.deliveryStatus).toBe("accepted");
    expect(run.emailReceiptId).toBe("provider-acceptance-test");
    expect(run.emailAcceptedAt).toBeInstanceOf(Date);
    await runStandardReportTemplate(owner, 101, saved.id, key);
    expect(state.email).toHaveBeenCalledTimes(1);
    expect(state.email.mock.calls[0][0].to).toBe(owner.email);
  });
  it("does not automatically resend an ambiguous provider request", async () => {
    vi.stubEnv("RESEND_API_KEY", "unit-test-provider-placeholder");
    vi.stubEnv("EMAIL_FROM", "test@example.test");
    state.email.mockRejectedValue(
      new Error("timeout after provider acceptance")
    );
    const saved = await saveStandardReportTemplate(owner, 101, {
      ...input(),
      emailToOwner: true,
    });
    const key = randomUUID();
    const run = await runStandardReportTemplate(owner, 101, saved.id, key);
    expect(run.deliveryStatus).toBe("unknown");
    await runStandardReportTemplate(owner, 101, saved.id, key);
    expect(state.email).toHaveBeenCalledTimes(1);
  });
  it("runs due schedules once and disables a suspended tenant without starving valid schedules", async () => {
    const invalid = await saveStandardReportTemplate(other, 202, {
      ...input(),
      cadence: "daily",
      lookbackDays: 1,
    });
    const valid = await saveStandardReportTemplate(owner, 101, {
      ...input(),
      cadence: "daily",
      lookbackDays: 1,
    });
    await pool.query("UPDATE tenants SET status='suspended' WHERE id=202");
    await pool.query(
      "UPDATE standard_report_templates SET nextRunAt='2026-11-04 08:00:00'"
    );
    state.read.mockClear();
    await processStandardReportSchedules(new Date("2026-11-04T08:01:00Z"));
    await processStandardReportSchedules(new Date("2026-11-04T08:01:00Z"));
    expect(state.read).toHaveBeenCalledTimes(1);
    expect(state.read).toHaveBeenCalledWith(
      5,
      { startDate: "2026-11-03", endDate: "2026-11-03" },
      { userId: 11, tenantId: 101 }
    );
    const [rows] = await pool.query<mysql.RowDataPacket[]>(
      "SELECT id,enabled,nextRunAt FROM standard_report_templates ORDER BY id"
    );
    expect(rows.find(row => row.id === invalid.id)?.enabled).toBe(0);
    expect(rows.find(row => row.id === valid.id)?.nextRunAt).toBeInstanceOf(
      Date
    );
    expect(await listStandardReportRuns(owner, 101)).toHaveLength(1);
  });
  it("reconciles interrupted sending even when the schedule is paused or already advanced", async () => {
    const saved = await saveStandardReportTemplate(owner, 101, input());
    const run = await runStandardReportTemplate(
      owner,
      101,
      saved.id,
      randomUUID()
    );
    const now = new Date();
    await pool.execute(
      "UPDATE standard_report_runs SET deliveryStatus='sending',deliveryStartedAt=? WHERE id=?",
      [new Date(now.getTime() - 16 * 60_000), run.id]
    );
    await processStandardReportSchedules(now);
    expect((await listStandardReportRuns(owner, 101))[0].deliveryStatus).toBe(
      "unknown"
    );
    expect(state.email).not.toHaveBeenCalled();
  });
  it("recovers pending manual delivery and rechecks the owner's current authority", async () => {
    const saved = await saveStandardReportTemplate(owner, 101, {
      ...input(),
      emailToOwner: true,
    });
    const first = await runStandardReportTemplate(
      owner,
      101,
      saved.id,
      randomUUID()
    );
    await pool.execute(
      "UPDATE standard_report_runs SET deliveryStatus='pending' WHERE id=?",
      [first.id]
    );
    vi.stubEnv("RESEND_API_KEY", "unit-test-provider-placeholder");
    vi.stubEnv("EMAIL_FROM", "test@example.test");
    await processStandardReportSchedules();
    await processStandardReportSchedules();
    expect((await listStandardReportRuns(owner, 101))[0].deliveryStatus).toBe(
      "accepted"
    );
    expect(state.email).toHaveBeenCalledTimes(1);
    vi.stubEnv("RESEND_API_KEY", "");
    const second = await runStandardReportTemplate(
      owner,
      101,
      saved.id,
      randomUUID()
    );
    await pool.execute(
      "UPDATE standard_report_runs SET deliveryStatus='pending' WHERE id=?",
      [second.id]
    );
    await pool.query("UPDATE users SET role='user' WHERE id=11");
    vi.stubEnv("RESEND_API_KEY", "unit-test-provider-placeholder");
    await processStandardReportSchedules();
    const [rows] = await pool.execute<mysql.RowDataPacket[]>(
      "SELECT deliveryStatus FROM standard_report_runs WHERE id=?",
      [second.id]
    );
    expect(rows[0].deliveryStatus).toBe("failed");
    expect(state.email).toHaveBeenCalledTimes(1);
  });
  it("rechecks revoked authority between report generation and outbound email", async () => {
    vi.stubEnv("RESEND_API_KEY", "unit-test-provider-placeholder");
    vi.stubEnv("EMAIL_FROM", "test@example.test");
    const saved = await saveStandardReportTemplate(owner, 101, {
      ...input(),
      emailToOwner: true,
    });
    state.read.mockImplementationOnce(async () => {
      await pool.query("UPDATE users SET role='user' WHERE id=11");
      return {
        columns: [
          { key: "record", label: "Record", type: "text" },
          { key: "quantity", label: "Quantity", type: "number" },
        ],
        rows: [{ record: "tenant-101", quantity: 0 }],
        notes: [],
      };
    });
    const run = await runStandardReportTemplate(
      owner,
      101,
      saved.id,
      randomUUID()
    );
    expect(run.status).toBe("ready");
    expect(run.deliveryStatus).toBe("failed");
    expect(state.email).not.toHaveBeenCalled();
  });
  it("can pause a saved schedule during a source failure and validates before resuming", async () => {
    const saved = await saveStandardReportTemplate(owner, 101, {
      ...input(),
      cadence: "daily",
    });
    state.read.mockRejectedValue(new Error("source unavailable"));
    const paused = await setStandardReportTemplateEnabled(
      owner,
      101,
      saved.id,
      false
    );
    expect(paused.enabled).toBe(false);
    expect(paused.nextRunAt).toBeNull();
    await expect(
      setStandardReportTemplateEnabled(owner, 101, saved.id, true)
    ).rejects.toThrow("No partial output");
    expect((await listStandardReportTemplates(owner, 101))[0].enabled).toBe(
      false
    );
    await expect(
      setStandardReportTemplateEnabled(other, 202, saved.id, false)
    ).rejects.toThrow("not found");
  });
  it("records failed generation without publishing partial output", async () => {
    const saved = await saveStandardReportTemplate(owner, 101, input());
    state.read.mockRejectedValue(
      new Error("database password should never appear in receipt")
    );
    const run = await runStandardReportTemplate(
      owner,
      101,
      saved.id,
      randomUUID()
    );
    expect(run.status).toBe("failed");
    expect(run.errorMessage).not.toContain("password");
    await expect(downloadStandardReportRun(owner, 101, run.id)).rejects.toThrow(
      "not ready"
    );
  });
});
