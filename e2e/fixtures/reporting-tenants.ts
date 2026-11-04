import type { Page } from "@playwright/test";
import mysql, { type ResultSetHeader } from "mysql2/promise";
import { randomUUID } from "node:crypto";
import { COOKIE_NAME } from "../../shared/const";
import { disposableDatabaseUrl } from "../disposable-database";
import { fixtureFlight, rpc } from "./hardening";

interface ReportingStaff {
  id: number;
  openId: string;
  tenantId: number;
  role: "finance" | "ops";
}

async function insertStaff(
  db: mysql.Connection,
  tenantId: number,
  role: ReportingStaff["role"]
): Promise<ReportingStaff> {
  const key = randomUUID();
  const openId = "report-" + key + "-" + role;
  const [user] = await db.execute<ResultSetHeader>(
    "INSERT INTO users (openId, tenantId, name, email, role) VALUES (?, ?, ?, ?, ?)",
    [
      openId,
      tenantId,
      "Synthetic reporting " + role,
      key + "." + role + "@example.invalid",
      role,
    ]
  );
  return { id: user.insertId, openId, tenantId, role };
}

async function removeStaff(db: mysql.Connection, userIds: number[]) {
  for (const id of userIds) {
    await db.execute("DELETE FROM refresh_tokens WHERE userId=?", [id]);
    await db.execute("DELETE FROM consent_records WHERE userId=?", [id]);
    await db.execute("DELETE FROM users WHERE id=?", [id]);
  }
}

/** A separate finance actor keeps refund retries out of the shared admin's
 * payment-write quota without changing any user's role or the rate policy. */
export async function createReportingStaff(
  tenantId: number,
  role: ReportingStaff["role"]
) {
  const db = await mysql.createConnection(disposableDatabaseUrl());
  try {
    const staff = await insertStaff(db, tenantId, role);
    return {
      staff,
      cleanup: async () => {
        try {
          await removeStaff(db, [staff.id]);
        } finally {
          await db.end();
        }
      },
    };
  } catch (error) {
    await db.end();
    throw error;
  }
}

/** Independent SQL read fixtures, not proof of external payment settlement.
 * The payment/refund journey is exercised separately through the application.
 * Every row and session belongs only to this test, including on a retry. */
export async function createReportingTenants(day: string) {
  const db = await mysql.createConnection(disposableDatabaseUrl());
  const tenantIds: number[] = [];
  const userIds: number[] = [];
  const flightIds: number[] = [];
  const bookingIds: number[] = [];
  const tenants: Array<{
    tenantId: number;
    finance: ReportingStaff;
    ops: ReportingStaff;
    flightId: number;
    flightNumber: string;
    bookingId: number;
    reference: string;
    amount: number;
    refund: number;
    bookedSeats: number;
  }> = [];

  const cleanup = async () => {
    try {
      for (const id of bookingIds) {
        await db.execute("DELETE FROM financial_ledger WHERE bookingId=?", [
          id,
        ]);
        await db.execute("DELETE FROM bookings WHERE id=?", [id]);
      }
      for (const id of flightIds)
        await db.execute("DELETE FROM flights WHERE id=?", [id]);
      await removeStaff(db, userIds);
      for (const id of tenantIds)
        await db.execute("DELETE FROM tenants WHERE id=?", [id]);
    } finally {
      await db.end();
    }
  };

  try {
    await db.query("SET SESSION time_zone = '+00:00'");
    for (const [label, amount, refund, bookedSeats] of [
      ["A", 12345, 2345, 1],
      ["B", 98765, 8765, 2],
    ] as const) {
      const key = randomUUID();
      const [tenant] = await db.execute<ResultSetHeader>(
        "INSERT INTO tenants (slug, name, status) VALUES (?, ?, 'active')",
        ["e2e-report-" + key, "Synthetic report tenant " + label]
      );
      const tenantId = tenant.insertId;
      tenantIds.push(tenantId);
      const staff = async (role: ReportingStaff["role"]) => {
        const user = await insertStaff(db, tenantId, role);
        userIds.push(user.id);
        return user;
      };
      const finance = await staff("finance");
      const ops = await staff("ops");
      const flightId = await fixtureFlight(tenantId);
      flightIds.push(flightId);
      const suffix = String(flightId).padStart(4, "0");
      const flightNumber = "RP" + label + suffix;
      const reference = "R" + suffix + label;
      await db.execute(
        "UPDATE flights SET flightNumber=?, departureTime=?, arrivalTime=?, status='completed', economySeats=10, economyAvailable=?, businessSeats=0, businessAvailable=0, economyPrice=?, businessPrice=0 WHERE id=?",
        [
          flightNumber,
          day + " 12:00:00",
          day + " 14:00:00",
          10 - bookedSeats,
          amount,
          flightId,
        ]
      );
      const [booking] = await db.execute<ResultSetHeader>(
        "INSERT INTO bookings (userId, tenantId, flightId, bookingReference, pnr, status, paymentStatus, seatsReserved, cabinClass, totalAmount, createdAt) VALUES (?, ?, ?, ?, ?, 'confirmed', 'paid', true, 'economy', ?, ?)",
        [
          finance.id,
          tenantId,
          flightId,
          reference,
          "P" + suffix + label,
          amount,
          day + " 12:00:00",
        ]
      );
      bookingIds.push(booking.insertId);
      for (const [type, minor] of [
        ["charge", amount],
        ["partial_refund", refund],
      ] as const)
        await db.execute(
          "INSERT INTO financial_ledger (bookingId, userId, type, amount, transactionDate) VALUES (?, ?, ?, ?, ?)",
          [
            booking.insertId,
            finance.id,
            type,
            (minor / 100).toFixed(2),
            day + " 12:00:00",
          ]
        );
      tenants.push({
        tenantId,
        finance,
        ops,
        flightId,
        flightNumber,
        bookingId: booking.insertId,
        reference,
        amount,
        refund,
        bookedSeats,
      });
    }
    return { tenants, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

/** A pre-authenticated staff fixture issued by the production session service.
 * This is not another password-login test. It creates a real persisted session
 * family, then the browser/API perform normal cookie, role and tenant checks.
 * The four global UI logins and their IP quota remain unchanged. */
export async function useReportingStaff(page: Page, staff: ReportingStaff) {
  disposableDatabaseUrl();
  const { sdk } = await import("../../server/_core/sdk");
  const { closePool } = await import("../../server/db");
  let cookie: string;
  try {
    cookie = await sdk.createSessionToken(staff.openId, {
      name: "Synthetic reporting staff",
      expiresInMs: 60 * 60 * 1000,
    });
  } finally {
    // Only the Playwright worker's fixture connection, not the app server pool.
    await closePool();
  }
  const url = process.env.E2E_BASE_URL ?? "http://localhost:3000";
  await page.context().clearCookies();
  await page.context().addCookies([
    {
      name: COOKIE_NAME,
      value: cookie,
      url,
      httpOnly: true,
      secure: new URL(url).protocol === "https:",
      sameSite: "Lax",
    },
  ]);
  const client = rpc(page);
  const user = await client.auth.me.query();
  if (
    user?.id !== staff.id ||
    user.tenantId !== staff.tenantId ||
    user.role !== staff.role
  )
    throw new Error("Independent report staff session did not authenticate");
  const consent = await client.consent.getMyConsent.query();
  if (consent.needsReconsent)
    await client.consent.updateConsent.mutate({
      expectedRevision: consent.consent?.id ?? null,
      consentVersion: consent.currentVersion,
      essential: true,
      analytics: false,
      marketing: false,
      preferences: false,
    });
}
