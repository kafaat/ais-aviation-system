import { inArray } from "drizzle-orm";
import { disposableDatabaseUrl } from "../../e2e/disposable-database";
import { users } from "../../drizzle/schema";
import { getDb, closePool } from "../../server/db";
import {
  getMyConsent,
  recordConsent,
} from "../../server/services/consent.service";

disposableDatabaseUrl();
try {
  const db = getDb();
  if (!db) throw new Error("Disposable database unavailable");
  const accounts = await db
    .select({ id: users.id })
    .from(users)
    .where(
      inArray(users.email, [
        "test.user@example.com",
        "test.reporting@example.com",
        "admin@ais-aviation.com",
        "test.ops@example.com",
      ])
    );
  if (accounts.length !== 4)
    throw new Error("All four registered E2E accounts are required");
  for (const account of accounts) {
    const current = await getMyConsent(account.id);
    if (!current.needsReconsent) continue;
    await recordConsent(
      {
        expectedRevision: current.consent?.id ?? null,
        consentVersion: current.currentVersion,
        essential: true,
        analytics: false,
        marketing: false,
        preferences: false,
      },
      account.id,
      { userAgent: "AIS disposable E2E fixture" }
    );
  }
} finally {
  await closePool();
}
