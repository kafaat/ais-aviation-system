/**
 * Tenant-Scope Query Helpers
 *
 * Security invariant:
 * - Request-serving tenant helpers are fail-closed: missing tenant context is
 *   an error, never an instruction to omit the tenant predicate/stamp.
 * - Legacy NULL/no-context passthrough is available only through the explicitly
 *   named `legacyTenantCondition` helper for controlled migration/backfill work.
 *
 * Usage:
 * ```ts
 * const where = tenantCondition(bookings.tenantId, ctx.tenantId);
 * const rows = await db.select().from(bookings)
 *   .where(and(eq(bookings.id, id), where));
 *
 * // On insert, stamp the tenant:
 * await db.insert(bookings).values({ ...data, ...tenantStamp(ctx.tenantId) });
 * ```
 */

import { eq, isNull, or, type SQL } from "drizzle-orm";
import type { MySqlColumn } from "drizzle-orm/mysql-core";

function requireTenantId(tenantId: number | null | undefined): number {
  if (tenantId == null) {
    throw new Error("Tenant context required");
  }
  return tenantId;
}

/**
 * Build the default tenant-isolation WHERE condition for a `tenantId` column.
 *
 * Request-serving code must always carry tenant context. Missing context throws
 * instead of returning `undefined`, so callers cannot accidentally drop the
 * tenant predicate.
 */
export function tenantCondition(
  column: MySqlColumn,
  tenantId: number | null | undefined
): SQL {
  return eq(column, requireTenantId(tenantId));
}

/**
 * Explicit compatibility helper for controlled migration/backfill tooling.
 *
 * @deprecated Do not use on request-serving query paths. It intentionally
 * permits legacy rows with `tenantId IS NULL` and allows absent tenant context.
 */
export function legacyTenantCondition(
  column: MySqlColumn,
  tenantId: number | null | undefined
): SQL | undefined {
  if (tenantId == null) return undefined;
  return or(eq(column, tenantId), isNull(column));
}

/**
 * Backward-compatible strict alias. New code should prefer `tenantCondition`.
 */
export function strictTenantCondition(
  column: MySqlColumn,
  tenantId: number | null | undefined
): SQL {
  return tenantCondition(column, tenantId);
}

/**
 * Stamp a tenant on an insert. Missing tenant context throws rather than
 * creating an unscoped operational row.
 */
export function tenantStamp(tenantId: number | null | undefined): {
  tenantId: number;
} {
  return { tenantId: requireTenantId(tenantId) };
}
