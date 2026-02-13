/**
 * Playwright Global Setup - Seed E2E Test Users
 *
 * Registers test users via auth service (creates DB rows with passwordHash),
 * then promotes the admin user's role via direct SQL.
 */
import mysql from "mysql2/promise";

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
    try {
      const res = await fetch(`${AUTH_SERVICE_URL}/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: user.email,
          password: user.password,
          name: user.name,
        }),
      });
      const data = await res.json();
      if (data.success || res.status === 409) {
        // Success or already registered - both are fine
        continue;
      }
      console.warn(
        `[e2e-setup] Auth service register for ${user.email}: ${JSON.stringify(data)}`
      );
    } catch {
      console.warn(
        `[e2e-setup] Auth service not reachable for ${user.email}, falling back to direct DB insert`
      );
      // Fallback: insert directly into DB (works with NODE_ENV=test fallback auth)
      await insertUserDirectly(user);
    }
  }
  console.info("[e2e-setup] Auth service registration complete");
}

async function insertUserDirectly(user: (typeof TEST_USERS)[number]) {
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
    await connection.execute(
      `INSERT IGNORE INTO users (openId, name, email, loginMethod, role)
       VALUES (?, ?, ?, 'password', ?)`,
      [`e2e-${Date.now()}`, user.name, user.email, user.role]
    );
  } finally {
    await connection.end();
  }
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

export default async function globalSetup() {
  console.info("[e2e-setup] Starting E2E test user setup...");
  await registerWithAuthService();
  await promoteAdminUsers();
  console.info("[e2e-setup] E2E setup complete");
}
