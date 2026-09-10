import {
  createConnection,
  type Connection,
  type RowDataPacket,
} from "mysql2/promise";
import { writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";

/** Canonical read-only findings. The SQL handoff is generated from this registry. */
export const forensicFindings = [
  {
    id: "booking_missing_owner",
    severity: "error",
    owner: "bookings",
    sql: "SELECT b.id AS recordId FROM bookings b LEFT JOIN users u ON u.id = b.userId WHERE b.userId <= 0 OR u.id IS NULL",
  },
  {
    id: "legacy_tenant_unassigned",
    severity: "review",
    owner: "tenant",
    sql: "SELECT id AS recordId FROM bookings WHERE tenantId IS NULL",
  },
  {
    id: "agency_without_owner",
    severity: "error",
    owner: "travel-agent",
    sql: "SELECT a.id AS recordId FROM travel_agents a LEFT JOIN users u ON u.id = a.ownerUserId WHERE a.ownerUserId IS NULL OR u.id IS NULL",
  },
  {
    id: "passenger_count_mismatch",
    severity: "error",
    owner: "bookings",
    sql: "SELECT b.id AS recordId FROM bookings b LEFT JOIN passengers p ON p.bookingId = b.id GROUP BY b.id, b.numberOfPassengers HAVING COUNT(p.id) <> b.numberOfPassengers",
  },
  {
    id: "orphan_passenger",
    severity: "error",
    owner: "bookings",
    sql: "SELECT p.id AS recordId FROM passengers p LEFT JOIN bookings b ON b.id = p.bookingId WHERE b.id IS NULL",
  },
  {
    id: "segment_reservation_mismatch",
    severity: "error",
    owner: "booking-settlement",
    sql: "SELECT b.id AS recordId FROM bookings b JOIN booking_segments s ON s.bookingId = b.id WHERE b.paymentStatus = 'paid' AND b.status = 'confirmed' GROUP BY b.id, b.seatsReserved HAVING SUM(s.seatsReserved) <> COUNT(s.id) OR b.seatsReserved = 0",
  },
  {
    id: "segment_allocation_mismatch",
    severity: "error",
    owner: "booking-settlement",
    sql: "SELECT b.id AS recordId FROM bookings b JOIN booking_segments s ON s.bookingId = b.id GROUP BY b.id, b.totalAmount HAVING COUNT(s.segmentAmount) <> COUNT(s.id) OR SUM(s.segmentAmount) <> b.totalAmount",
  },
  {
    id: "segment_identity_mismatch",
    severity: "error",
    owner: "multi-city",
    sql: "SELECT s.id AS recordId FROM booking_segments s LEFT JOIN bookings b ON b.id = s.bookingId LEFT JOIN flights f ON f.id = s.flightId WHERE b.id IS NULL OR f.id IS NULL OR NOT (b.tenantId <=> f.tenantId)",
  },
  {
    id: "invoice_ancillary_inconsistency",
    severity: "error",
    owner: "bookings",
    sql: "SELECT b.id AS recordId FROM bookings b JOIN booking_ancillaries a ON a.bookingId = b.id AND a.status = 'active' GROUP BY b.id, b.totalAmount HAVING SUM(a.totalPrice) > b.totalAmount OR SUM(a.quantity <= 0 OR a.unitPrice < 0 OR a.totalPrice <> a.quantity * a.unitPrice) > 0",
  },
  {
    id: "booking_flight_tenant_mismatch",
    severity: "error",
    owner: "tenant",
    sql: "SELECT b.id AS recordId FROM bookings b LEFT JOIN flights f ON f.id = b.flightId WHERE f.id IS NULL OR NOT (b.tenantId <=> f.tenantId)",
  },
  {
    id: "passenger_tenant_mismatch",
    severity: "error",
    owner: "tenant",
    sql: "SELECT p.id AS recordId FROM passengers p JOIN bookings b ON b.id = p.bookingId WHERE NOT (p.tenantId <=> b.tenantId)",
  },
  {
    id: "unlinked_legacy_hold",
    severity: "review",
    owner: "inventory-capacity",
    sql: "SELECT id AS recordId FROM seat_holds WHERE inventoryLockId IS NULL AND status = 'active'",
  },
  {
    id: "collected_funds_under_review",
    severity: "error",
    owner: "payment-settlement",
    sql: "SELECT SHA2(paymentIntentId, 256) AS recordId FROM payment_receipts WHERE settlementStatus = 'review_required'",
  },
  {
    id: "terminal_booking_retains_resources",
    severity: "error",
    owner: "booking-settlement",
    sql: "SELECT b.id AS recordId FROM bookings b WHERE b.status = 'cancelled' AND (b.seatsReserved = 1 OR EXISTS (SELECT 1 FROM booking_segments s WHERE s.bookingId = b.id AND (s.seatsReserved = 1 OR s.status <> 'cancelled')) OR EXISTS (SELECT 1 FROM seat_inventory si WHERE si.bookingId = b.id))",
  },
  {
    id: "ndc_booking_status_mismatch",
    severity: "error",
    owner: "ndc",
    sql: "SELECT n.id AS recordId FROM ndc_orders n LEFT JOIN bookings b ON b.id = n.bookingId WHERE b.id IS NULL OR n.totalAmount <> b.totalAmount OR (b.paymentStatus = 'refunded' AND n.status <> 'refunded') OR (b.status = 'cancelled' AND n.status NOT IN ('cancelled','refunded')) OR (b.status = 'confirmed' AND b.paymentStatus = 'paid' AND n.status = 'pending')",
  },
] as const;

type Finding = {
  id: string;
  severity: "error" | "review";
  owner: string;
  count: number | null;
  recordIds: Array<number | string>;
  truncated: boolean;
  error: "QUERY_FAILED" | null;
};
export type ForensicDataReport = {
  schemaVersion: 1;
  observedAt: string;
  readOnly: true;
  snapshot: "repeatable-read";
  status: "pass" | "review_required" | "blocked";
  sampleLimit: number;
  findings: Finding[];
};
function bounded(value: number, maximum: number, name: string) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum)
    throw new Error(`INVALID_${name}`);
  return value;
}
function recordId(value: unknown): number | string {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0)
    return value;
  if (typeof value === "string" && /^[a-f0-9]{64}$/.test(value)) return value;
  throw new Error("INVALID_RECORD_IDENTIFIER");
}
export function forensicSql(sampleLimit = 50): string {
  bounded(sampleLimit, 200, "SAMPLE_LIMIT");
  return (
    "-- Generated by scripts/ci/forensic-data-audit.ts --print-sql. Read only.\n-- Identifiers only; hashed provider references. No automatic reconciliation.\nSET TRANSACTION ISOLATION LEVEL REPEATABLE READ;\nSTART TRANSACTION READ ONLY;\n" +
    forensicFindings
      .map(
        f =>
          `-- ${f.id} (${f.severity}; owner: ${f.owner})\nSELECT /*+ MAX_EXECUTION_TIME(5000) */ '${f.id}' AS finding, COUNT(*) AS total FROM (${f.sql}) findings;\nSELECT /*+ MAX_EXECUTION_TIME(5000) */ '${f.id}' AS finding, recordId FROM (${f.sql}) findings ORDER BY recordId LIMIT ${sampleLimit};`
      )
      .join("\n") +
    "\nROLLBACK;\n"
  );
}
export async function inspectForensicData(
  connection: Connection,
  sampleLimit = 50
): Promise<ForensicDataReport> {
  bounded(sampleLimit, 200, "SAMPLE_LIMIT");
  const report: ForensicDataReport = {
    schemaVersion: 1,
    observedAt: new Date().toISOString(),
    readOnly: true,
    snapshot: "repeatable-read",
    status: "pass",
    sampleLimit,
    findings: [],
  };
  await connection.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
  await connection.query("START TRANSACTION READ ONLY");
  try {
    for (const f of forensicFindings) {
      const result: Finding = {
        id: f.id,
        severity: f.severity,
        owner: f.owner,
        count: null,
        recordIds: [],
        truncated: false,
        error: null,
      };
      try {
        const [count] = await connection.query<RowDataPacket[]>(
          `SELECT /*+ MAX_EXECUTION_TIME(5000) */ COUNT(*) AS total FROM (${f.sql}) findings`
        );
        const total = Number(count[0].total);
        if (!Number.isSafeInteger(total) || total < 0)
          throw new Error("INVALID_COUNT");
        const [rows] = await connection.query<RowDataPacket[]>(
          `SELECT /*+ MAX_EXECUTION_TIME(5000) */ recordId FROM (${f.sql}) findings ORDER BY recordId LIMIT ${sampleLimit}`
        );
        result.recordIds = rows.map(row => recordId(row.recordId));
        result.count = total;
        result.truncated = total > result.recordIds.length;
        if (total > 0 && report.status === "pass")
          report.status = "review_required";
      } catch {
        // Driver errors may embed SQL, connection details or values. Never persist them.
        result.error = "QUERY_FAILED";
        report.status = "blocked";
      }
      report.findings.push(result);
    }
    return report;
  } finally {
    await connection.rollback();
  }
}
export async function runForensicDataAudit(
  output: string,
  databaseUrl: string,
  sampleLimit = 50
) {
  bounded(sampleLimit, 200, "SAMPLE_LIMIT");
  if (!databaseUrl) throw new Error("DATABASE_URL_REQUIRED");
  const sourceSha = execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  const connection = await createConnection({
    uri: databaseUrl,
    multipleStatements: false,
    connectTimeout: 10000,
  });
  try {
    const report = {
      sourceSha,
      ...(await inspectForensicData(connection, sampleLimit)),
    };
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, JSON.stringify(report, null, 2) + "\n", {
      mode: 0o600,
    });
    console.info(
      JSON.stringify({
        status: report.status,
        findings: report.findings.map(({ id, count, error }) => ({
          id,
          count,
          error,
        })),
      })
    );
    return report;
  } finally {
    await connection.end();
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  if (process.argv.includes("--print-sql"))
    console.log(forensicSql().trimEnd());
  else {
    const output = process.argv.find(a => a.startsWith("--output="))?.slice(9);
    if (!process.argv.includes("--run") || !output)
      throw new Error("USE --run --output=<report.json> OR --print-sql");
    runForensicDataAudit(output, process.env.DATABASE_URL ?? "")
      .then(report => {
        process.exitCode =
          report.status === "pass"
            ? 0
            : report.status === "review_required"
              ? 2
              : 1;
      })
      .catch(() => {
        console.error(
          "FORENSIC_AUDIT_FAILED: inspect configuration and schema; raw database errors are suppressed"
        );
        process.exitCode = 1;
      });
  }
}
