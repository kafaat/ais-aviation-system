/**
 * Tenant Service
 *
 * Minimal tenant (airline) management for the multi-tenancy foundation:
 * resolve, look up, and provision tenants. The tenant a request belongs to is
 * derived from the authenticated user (see _core/context.ts) and enforced via
 * `assertTenant` in access-control.service.ts.
 */

import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { tenants, type Tenant, type InsertTenant } from "../../drizzle/schema";
import { TRPCError } from "@trpc/server";

async function getDbOrThrow() {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });
  }
  return db;
}

export async function getTenantById(id: number): Promise<Tenant | null> {
  const db = await getDbOrThrow();
  const [row] = await db
    .select()
    .from(tenants)
    .where(eq(tenants.id, id))
    .limit(1);
  return row ?? null;
}

export async function getTenantBySlug(slug: string): Promise<Tenant | null> {
  const db = await getDbOrThrow();
  const [row] = await db
    .select()
    .from(tenants)
    .where(eq(tenants.slug, slug))
    .limit(1);
  return row ?? null;
}

export async function listTenants(): Promise<Tenant[]> {
  const db = await getDbOrThrow();
  return await db.select().from(tenants);
}

export async function createTenant(input: InsertTenant): Promise<Tenant> {
  const db = await getDbOrThrow();

  const existing = await getTenantBySlug(input.slug);
  if (existing) {
    throw new TRPCError({
      code: "CONFLICT",
      message: `Tenant slug "${input.slug}" already exists`,
    });
  }

  const [result] = await db.insert(tenants).values(input);
  const created = await getTenantById(result.insertId);
  if (!created) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to create tenant",
    });
  }
  return created;
}

/**
 * Returns true if a tenant exists and is active (usable for serving requests).
 */
export async function isTenantActive(id: number): Promise<boolean> {
  const tenant = await getTenantById(id);
  return !!tenant && tenant.status === "active";
}
