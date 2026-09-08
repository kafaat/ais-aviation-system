/**
 * Tenant-Scope Query Helpers
 *
 * Security invariant:
 * - A request carrying a tenant context must never match rows assigned to a
 *   different tenant or rows whose tenant is unknown.
 * - Legacy NULL passthrough is available only through the explicitly named
 *   `legacyTenantCondition` helper while historical data is backfilled.
 *
 * Usage:
 * ```ts
 * const where = tenantCondition(bookings.tenantId, ctx.tenantId);
 * const rows = await db.select().from(bookings)
 *   .where(where ? and(eq(bookings.id, id), where) : eq(bookings.id, id));
 *
 * // On insert, stamp the tenant:
 * await db.insert(bookings).values({ ...data, ...tenantStamp(ctx.tenantId) });
 * ```
 */

import { eq, isNull, or, type SQL } from "drizzle-orm";
import type { MySqlColumn } from "drizzle-orm/mysql-core";

/**
 * Build the default tenant-isolation WHERE condition for a `tenantId` column.
 *
 * When a tenant is present this is STRICT: legacy NULL rows are not visible.
 * Returns `undefined` only when there is no tenant context at all.
 */
export function tenantCondition(
  column: MySqlColumn,
  tenantId: number | null | undefined
): SQL | undefined {
  if (tenantId == null) return undefined;
  return eq(column, tenantId);
}

/**
 * Explicit compatibility helper for controlled migration/backfill tooling.
 *
 * @deprecated Do not use on request-serving query paths. It intentionally
 * permits legacy rows with `tenantId IS NULL` and therefore is not fail-closed.
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
): SQL | undefined {
  return tenantCondition(column, tenantId);
}

/**
 * Returns an object to spread into an insert's `.values()` that stamps the
 * tenant. Returns `{}` (no stamp) when there is no tenant context, so platform
 * or legacy flows can be handled explicitly by their caller.
 */
export function tenantStamp(tenantId: number | null | undefined): {
  tenantId?: number;
} {
  return tenantId == null ? {} : { tenantId };
}
