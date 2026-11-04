import mysql, { type ResultSetHeader } from "mysql2/promise";
import { disposableDatabaseUrl } from "../disposable-database";
import { createReportingTenants } from "./reporting-tenants";

export const STANDARD_REPORT_PRIVATE_VALUE =
  "SYNTHETIC-PROVIDER-SECRET-NOT-A-REPORT-FIELD";

/** Isolated report-read fixtures, never evidence of an external payment.
 * The existing funded-journey suite writes real application settlements.
 * This fixture owns every added row and reuses production-issued staff sessions. */
export async function createStandardReportingTenants(day: string) {
  const fixtures = await createReportingTenants(day);
  let db: mysql.Connection | undefined;
  const paymentIds: number[] = [];
  const tenants: Array<
    (typeof fixtures.tenants)[number] & {
      payments: Array<{
        id: number;
        amount: number;
        createdAt: string;
        transactionId: string | null;
      }>;
      excludedPaymentIds: number[];
    }
  > = [];
  const cleanup = async () => {
    try {
      if (db) {
        for (const tenant of fixtures.tenants) {
          for (const actor of [tenant.finance, tenant.ops]) {
            await db.execute(
              "DELETE FROM standard_report_runs WHERE createdBy=?",
              [actor.id]
            );
            await db.execute(
              "DELETE FROM standard_report_templates WHERE createdBy=?",
              [actor.id]
            );
          }
        }
        for (const id of paymentIds)
          await db.execute("DELETE FROM payments WHERE id=?", [id]);
      }
    } finally {
      try {
        await db?.end();
      } finally {
        await fixtures.cleanup();
      }
    }
  };
  try {
    db = await mysql.createConnection(disposableDatabaseUrl());
    await db.query("SET SESSION time_zone = '+00:00'");
    for (const tenant of fixtures.tenants) {
      // An untrusted stored identifier exercises formula and markup escaping.
      // It is not used for ticket issuance or operational message generation.
      const flightNumber = "=F<&" + tenant.flightId;
      await db.execute("UPDATE flights SET flightNumber=? WHERE id=?", [
        flightNumber,
        tenant.flightId,
      ]);
      const included: (typeof tenants)[number]["payments"] = [];
      const excluded: number[] = [];
      for (const [amount, time, offset, transactionId] of [
        [0, "00:00:00", 0, `=1+1,<svg/onload=alert(1)>\"${tenant.reference}`],
        [tenant.amount, "23:59:59", 0, null],
        [777777, "23:59:59", -1, "outside-before-" + tenant.reference],
        [888888, "00:00:00", 1, "outside-after-" + tenant.reference],
      ] as const) {
        const [payment] = await db.execute<ResultSetHeader>(
          "INSERT INTO payments (tenantId,bookingId,amount,currency,method,provider,status,transactionId,providerSessionId,providerMetadata,createdAt,updatedAt) VALUES (?, ?, ?, 'SAR', 'card', 'stripe', 'completed', ?, ?, ?, DATE_ADD(CAST(? AS DATETIME), INTERVAL ? DAY), DATE_ADD(CAST(? AS DATETIME), INTERVAL ? DAY))",
          [
            tenant.tenantId,
            tenant.bookingId,
            amount,
            transactionId,
            STANDARD_REPORT_PRIVATE_VALUE,
            JSON.stringify({ privateValue: STANDARD_REPORT_PRIVATE_VALUE }),
            day + " " + time,
            offset,
            day + " " + time,
            offset,
          ]
        );
        paymentIds.push(payment.insertId);
        if (offset === 0)
          included.push({
            id: payment.insertId,
            amount,
            createdAt: day + "T" + time + ".000Z",
            transactionId,
          });
        else excluded.push(payment.insertId);
      }
      tenants.push({
        ...tenant,
        flightNumber,
        payments: included,
        excludedPaymentIds: excluded,
      });
    }
    return { tenants, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
