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
    id: "split_refund_under_review",
    severity: "error",
    owner: "split-refund",
    sql: "SELECT bookingId AS recordId FROM booking_refund_plans WHERE status = 'review_required'",
  },
  {
    id: "split_refund_allocation_mismatch",
    severity: "error",
    owner: "split-refund",
    sql: "SELECT p.bookingId AS recordId FROM booking_refund_plans p LEFT JOIN bookings b ON b.id = p.bookingId LEFT JOIN (SELECT bookingId, COUNT(*) AS itemCount, SUM(collectedAmount) AS collectedTotal, SUM(refundAmount) AS refundTotal, COUNT(DISTINCT planId) AS planCount, MIN(planId) AS planId, SUM(refundAmount <= 0 OR refundAmount > collectedAmount) AS invalidAmounts, SUM(status <> 'succeeded') AS unfinishedItems FROM booking_refund_items GROUP BY bookingId) i ON i.bookingId = p.bookingId WHERE COALESCE(i.itemCount, 0) < 2 OR i.collectedTotal <> p.totalAmount OR i.refundTotal <> p.refundAmount OR p.refundAmount + p.cancellationFee <> p.totalAmount OR i.planCount <> 1 OR i.planId <> p.id OR i.invalidAmounts > 0 OR b.status <> 'cancelled' OR b.status IS NULL OR (p.status = 'completed' AND i.unfinishedItems > 0)",
  },
  {
    id: "split_refund_worker_overdue",
    severity: "review",
    owner: "split-refund",
    sql: "SELECT DISTINCT bookingId AS recordId FROM booking_refund_items WHERE status IN ('queued','requesting','pending') AND nextAttemptAt < DATE_SUB(NOW(), INTERVAL 15 MINUTE)",
  },
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
  {
    id: "loyalty_credit_adoption_pending",
    severity: "review",
    owner: "loyalty-balance",
    sql: "SELECT id AS recordId FROM loyalty_accounts WHERE creditLotsInitializedAt IS NULL",
  },
  {
    id: "loyalty_account_missing_owner",
    severity: "error",
    owner: "loyalty-balance",
    sql: "SELECT a.id AS recordId FROM loyalty_accounts a LEFT JOIN users u ON u.id = a.userId WHERE u.id IS NULL",
  },
  {
    id: "loyalty_ledger_owner_mismatch",
    severity: "error",
    owner: "loyalty-balance",
    sql: "SELECT t.id AS recordId FROM miles_transactions t LEFT JOIN loyalty_accounts a ON a.id = t.loyaltyAccountId WHERE a.id IS NULL OR t.userId <> a.userId",
  },
  {
    id: "loyalty_ledger_transition_mismatch",
    severity: "error",
    owner: "loyalty-balance",
    // A matching final sum cannot conceal an incorrect intermediate balance.
    sql: "SELECT id AS recordId FROM (SELECT id, balanceAfter, SUM(amount) OVER (PARTITION BY loyaltyAccountId ORDER BY id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS recordedBalance FROM miles_transactions) ledger WHERE balanceAfter <> recordedBalance",
  },
  {
    id: "loyalty_ledger_balance_mismatch",
    severity: "error",
    owner: "loyalty-balance",
    sql: "SELECT a.id AS recordId FROM loyalty_accounts a LEFT JOIN miles_transactions t ON t.loyaltyAccountId = a.id GROUP BY a.id, a.currentMilesBalance, a.totalMilesEarned, a.milesRedeemed HAVING a.currentMilesBalance <> COALESCE(SUM(t.amount), 0) OR (COUNT(t.id) = 0 AND (a.totalMilesEarned <> 0 OR a.milesRedeemed <> 0))",
  },
  {
    id: "loyalty_credit_lot_conservation_mismatch",
    severity: "error",
    owner: "loyalty-balance",
    sql: "SELECT transactionId AS recordId FROM loyalty_credit_lots WHERE creditedMiles <= 0 OR remainingMiles < 0 OR spentMiles < 0 OR expiredMiles < 0 OR reversedMiles < 0 OR creditedMiles <> remainingMiles + spentMiles + expiredMiles + reversedMiles",
  },
  {
    id: "loyalty_credit_lot_identity_mismatch",
    severity: "error",
    owner: "loyalty-balance",
    sql: "SELECT l.transactionId AS recordId FROM loyalty_credit_lots l LEFT JOIN miles_transactions t ON t.id = l.transactionId LEFT JOIN loyalty_accounts a ON a.id = l.loyaltyAccountId WHERE a.id IS NULL OR t.id IS NULL OR t.loyaltyAccountId <> l.loyaltyAccountId OR t.userId <> a.userId OR t.type NOT IN ('earn','bonus','adjustment') OR t.amount <> l.creditedMiles OR NOT (t.bookingId <=> l.bookingId) OR NOT (t.expiresAt <=> l.expiresAt)",
  },
  {
    id: "loyalty_initialized_credit_missing_lot",
    severity: "error",
    owner: "loyalty-balance",
    sql: "SELECT t.id AS recordId FROM miles_transactions t JOIN loyalty_accounts a ON a.id = t.loyaltyAccountId LEFT JOIN loyalty_credit_lots l ON l.transactionId = t.id WHERE a.creditLotsInitializedAt IS NOT NULL AND t.amount > 0 AND t.type IN ('earn','bonus','adjustment') AND l.transactionId IS NULL",
  },
  {
    id: "loyalty_available_credit_mismatch",
    severity: "error",
    owner: "loyalty-balance",
    // Refunding spent credit can legitimately leave debt with zero available lots.
    sql: "SELECT a.id AS recordId FROM loyalty_accounts a LEFT JOIN loyalty_credit_lots l ON l.loyaltyAccountId = a.id WHERE a.creditLotsInitializedAt IS NOT NULL GROUP BY a.id, a.currentMilesBalance HAVING COALESCE(SUM(l.remainingMiles), 0) <> GREATEST(0, a.currentMilesBalance)",
  },
  {
    id: "loyalty_uninitialized_account_has_lots",
    severity: "error",
    owner: "loyalty-balance",
    sql: "SELECT a.id AS recordId FROM loyalty_accounts a WHERE a.creditLotsInitializedAt IS NULL AND EXISTS (SELECT 1 FROM loyalty_credit_lots l WHERE l.loyaltyAccountId = a.id)",
  },
  {
    id: "family_pool_balance_mismatch",
    severity: "error",
    owner: "family-pool",
    // Removed members retain their historical contributions to the persisted pool.
    sql: "SELECT g.id AS recordId FROM family_groups g LEFT JOIN family_group_members m ON m.groupId = g.id GROUP BY g.id, g.pooledMiles HAVING g.pooledMiles < 0 OR g.pooledMiles <> COALESCE(SUM(m.milesContributed - m.milesRedeemed), 0) OR SUM(m.milesContributed < 0 OR m.milesRedeemed < 0) > 0",
  },
  {
    id: "family_contribution_ledger_mismatch",
    severity: "error",
    owner: "family-pool",
    // Aggregate repeated memberships for the same user without losing removed rows.
    sql: "SELECT DISTINCT m.groupId AS recordId FROM (SELECT groupId, userId, SUM(milesContributed) AS contributed FROM family_group_members GROUP BY groupId, userId) m LEFT JOIN (SELECT reason, userId, -SUM(amount) AS contributed FROM miles_transactions WHERE type = 'adjustment' AND amount < 0 AND bookingId IS NULL GROUP BY reason, userId) t ON t.reason = CONCAT('family-pool:', m.groupId) AND t.userId = m.userId WHERE m.contributed <> COALESCE(t.contributed, 0)",
  },
  {
    id: "family_transfer_missing_membership",
    severity: "error",
    owner: "family-pool",
    sql: "SELECT t.id AS recordId FROM miles_transactions t LEFT JOIN family_groups g ON t.reason = CONCAT('family-pool:', g.id) WHERE t.reason LIKE 'family-pool:%' AND (g.id IS NULL OR t.type <> 'adjustment' OR t.amount >= 0 OR t.bookingId IS NOT NULL OR NOT EXISTS (SELECT 1 FROM family_group_members m WHERE m.groupId = g.id AND m.userId = t.userId))",
  },
  {
    id: "inactive_family_retains_miles",
    severity: "error",
    owner: "family-pool",
    sql: "SELECT id AS recordId FROM family_groups WHERE status = 'inactive' AND pooledMiles <> 0",
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
    console.info(forensicSql().trimEnd());
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
