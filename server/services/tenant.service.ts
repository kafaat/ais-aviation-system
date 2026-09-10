import type { SettlementTx } from "./booking-settlement.service";
import { recordEvent } from "./outbox.service";
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
import {
  tenants,
  users,
  type Tenant,
  type InsertTenant,
} from "../../drizzle/schema";
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

/** A shared row lock keeps suspension and a new operational write ordered. */
export async function assertTenantOperational(
  tx: SettlementTx,
  tenantId: number | null | undefined
) {
  if (tenantId == null) return; // Explicit legacy platform pool; never synthesize an airline tenant.
  const [tenant] = await tx
    .select()
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1)
    .for("share");
  if (!tenant || tenant.status !== "active")
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Airline tenant is not active",
    });
}

export async function setTenantStatus(
  tenantId: number,
  status: Tenant["status"],
  actorId: number
) {
  const database = await getDbOrThrow();
  return database.transaction(async tx => {
    const [tenant] = await tx
      .select()
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1)
      .for("update");
    if (!tenant)
      throw new TRPCError({ code: "NOT_FOUND", message: "Tenant not found" });
    await tx.update(tenants).set({ status }).where(eq(tenants.id, tenantId));
    await recordEvent(tx, {
      aggregateType: "tenant",
      aggregateId: tenantId,
      tenantId,
      eventType: "tenant.status_changed",
      payload: { tenantId, previous: tenant.status, status, actorId },
    });
    return { ...tenant, status };
  });
}

export async function assignUserTenant(
  userId: number,
  tenantId: number,
  actorId: number
) {
  const database = await getDbOrThrow();
  return database.transaction(async tx => {
    await assertTenantOperational(tx, tenantId);
    const [user] = await tx
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)
      .for("update");
    if (!user)
      throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
    await tx.update(users).set({ tenantId }).where(eq(users.id, userId));
    await recordEvent(tx, {
      aggregateType: "tenant",
      aggregateId: tenantId,
      tenantId,
      eventType: "tenant.user_assigned",
      payload: { userId, previousTenantId: user.tenantId, tenantId, actorId },
    });
    return { userId, tenantId };
  });
}
