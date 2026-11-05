/**
 * Playwright Global Setup - Seed E2E Test Users
 *
 * Registers test users via auth service (creates DB rows with passwordHash),
 * then promotes the admin user's role via direct SQL.
 */
import mysql, { type RowDataPacket } from "mysql2/promise";
import { disposableDatabaseUrl } from "./disposable-database";
import type { FullConfig } from "@playwright/test";
import { testUsers } from "./fixtures/test-data";
import { prepareBrowserSessions } from "./fixtures/browser-session";

const AUTH_SERVICE_URL =
  process.env.AUTH_SERVICE_URL || "http://localhost:8000";
const DATABASE_URL = process.env.DATABASE_URL;

const TEST_USERS = [
  {
    name: "Test User",
    email: "test.user@example.com",
    password: "TestPassword123!",
    role: "user" as const,
  },
  {
    ...testUsers.reporting,
    name: "Reporting User",
    role: "user" as const,
  },
  {
    name: "Admin User",
    email: "admin@ais-aviation.com",
    password: "AdminPassword123!",
    role: "admin" as const,
  },
  {
    name: "Operations User",
    email: "test.ops@example.com",
    password: "TestPassword123!",
    role: "ops" as const,
  },
];

async function registerWithAuthService() {
  for (const user of TEST_USERS) {
    const res = await fetch(`${AUTH_SERVICE_URL}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: user.email,
        password: user.password,
        name: user.name,
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (res.status !== 409) {
      const data = await res.json();
      if (!res.ok || !data.success)
        throw new Error("Auth service could not register the E2E account");
    }
  }
  console.info("[e2e-setup] Auth service registration complete");
}

async function promoteAdminUsers() {
  if (!DATABASE_URL) return;
  const url = new URL(DATABASE_URL);
  const connection = await mysql.createConnection({
    host: url.hostname,
    port: parseInt(url.port || "3306", 10),
    user: url.username,
    password: url.password,
    database: url.pathname.slice(1),
  });
  try {
    const adminUsers = TEST_USERS.filter(u => u.role === "admin");
    for (const user of adminUsers) {
      await connection.execute(
        `UPDATE users SET role = 'admin' WHERE email = ?`,
        [user.email]
      );
    }
    // The shared reporting/departure passenger and operator belong to one
    // synthetic airline. The regular owner and admin remain separate accounts.
    await connection.execute(
      "INSERT IGNORE INTO tenants (slug, name, status) VALUES ('e2e-dcs-operations', 'Synthetic DCS E2E airline', 'active')"
    );
    const [tenants] = await connection.execute<
      (RowDataPacket & { id: number })[]
    >("SELECT id FROM tenants WHERE slug = 'e2e-dcs-operations'");
    if (tenants.length !== 1) throw new Error("DCS E2E tenant unavailable");
    await connection.execute(
      "UPDATE users SET role = 'ops', tenantId = ? WHERE email = 'test.ops@example.com'",
      [tenants[0].id]
    );
    // The reporting customer doubles as the other airline's passenger in the
    // agency ownership test, using the same authenticated browser session.
    await connection.execute(
      "UPDATE users SET tenantId = ? WHERE email = ? AND role = 'user'",
      [tenants[0].id, testUsers.reporting.email]
    );
    console.info("[e2e-setup] Admin and airline fixtures prepared");
  } finally {
    await connection.end();
  }
}

export default async function globalSetup(config: FullConfig) {
  disposableDatabaseUrl();
  console.info("[e2e-setup] Starting E2E test user setup...");
  await registerWithAuthService();
  await promoteAdminUsers();
  const cleanup = await prepareBrowserSessions(config);
  console.info(
    "[e2e-setup] Selected real browser sessions and consent complete"
  );
  return cleanup;
}
