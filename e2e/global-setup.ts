/**
 * Playwright Global Setup - Seed E2E Test Users
 *
 * Registers test users via auth service (creates DB rows with passwordHash),
 * then promotes the admin user's role via direct SQL.
 */
import mysql from "mysql2/promise";
import { disposableDatabaseUrl } from "./disposable-database";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { FullConfig } from "@playwright/test";
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
    name: "Admin User",
    email: "admin@ais-aviation.com",
    password: "AdminPassword123!",
    role: "admin" as const,
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
    console.info("[e2e-setup] Admin roles promoted");
  } finally {
    await connection.end();
  }
}

export default async function globalSetup(config: FullConfig) {
  disposableDatabaseUrl();
  console.info("[e2e-setup] Starting E2E test user setup...");
  await registerWithAuthService();
  await promoteAdminUsers();
  // Authenticated consent is server-authoritative; localStorage only dismisses
  // the anonymous banner. Use the real writer for the two synthetic accounts.
  await promisify(execFile)(
    process.execPath,
    ["--import", "tsx", "scripts/e2e/prepare-consent.ts"],
    { timeout: 30000 }
  );
  const cleanup = await prepareBrowserSessions(config);
  console.info("[e2e-setup] Real user/admin UI logins complete");
  return cleanup;
}
