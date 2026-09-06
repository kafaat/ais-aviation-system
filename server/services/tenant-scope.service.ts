/**
 * Tenant-Scope Query Helpers
 *
 * Migration-aware helpers for applying tenant isolation to Drizzle queries.
 * The design is intentionally BACKWARD-COMPATIBLE so it can be rolled out
 * gradually without breaking the current single-tenant deployment:
 *
 *  - When the request has no tenant context (`tenantId == null`, e.g. platform
 *    users or legacy sessions) the helpers add NO condition — behaviour is
 *    unchanged.
 *  - When a tenant IS present, queries match that tenant's rows AND legacy
 *    rows whose `tenantId` is still NULL (not yet backfilled). Once the
 *    backfill completes and columns become NOT NULL, tighten `tenantCondition`
 *    to a strict `eq` (remove the isNull branch) for hard isolation.
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
 * Build a tenant-isolation WHERE condition for a `tenantId` column.
 * Returns `undefined` when there is no tenant context (no filtering).
 */
export function tenantCondition(
  column: MySqlColumn,
  tenantId: number | null | undefined
): SQL | undefined {
  if (tenantId == null) return undefined;
  // Match the tenant's rows, plus not-yet-backfilled legacy rows (tenantId IS NULL).
  return or(eq(column, tenantId), isNull(column));
}

/**
 * Strict variant (no legacy NULL passthrough). Use after backfill completes.
 * Returns `undefined` only when there is no tenant context.
 */
export function strictTenantCondition(
  column: MySqlColumn,
  tenantId: number | null | undefined
): SQL | undefined {
  if (tenantId == null) return undefined;
  return eq(column, tenantId);
}

/**
 * Returns an object to spread into an insert's `.values()` that stamps the
 * tenant. Returns `{}` (no stamp) when there is no tenant context, so existing
 * single-tenant inserts keep working.
 */
export function tenantStamp(tenantId: number | null | undefined): {
  tenantId?: number;
} {
  return tenantId == null ? {} : { tenantId };
}
