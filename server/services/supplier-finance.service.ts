import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { alias } from "drizzle-orm/mysql-core";
import {
  supplierBankProfiles as profiles,
  supplierFinanceEvents as events,
  users,
} from "../../drizzle/schema";
import { getDb } from "../db";
import { assertTenantOperational } from "./tenant.service";
import { isAdmin } from "./rbac.service";
import { withTransactionalIdempotency } from "./idempotency-v2.service";
import type { SettlementTx } from "./booking-settlement.service";

const uuid = z.string().uuid().toLowerCase();
const base = z.object({
  supplierRef: uuid,
  bankVersion: z.number().int().min(0).max(2147483646),
  requestId: uuid,
});
const payout = base.extend({
  invoiceRef: uuid,
  amountMinor: z.number().int().positive().max(2147483647),
});
export const supplierCommand = z.discriminatedUnion("action", [
  base
    .extend({
      action: z.literal("bank_change"),
      vaultRef: uuid,
      lastFour: z.string().regex(/^\d{4}$/),
    })
    .strict(),
  base.extend({ action: z.literal("bank_approved") }).strict(),
  payout.extend({ action: z.literal("payout_request") }).strict(),
  payout.extend({ action: z.literal("payout_approved") }).strict(),
]);
export const supplierQuery = z
  .object({ supplierRef: uuid, invoiceRef: uuid.optional() })
  .strict();
const action = z.enum([
  "bank_change",
  "bank_approved",
  "payout_request",
  "payout_approved",
]);
export const supplierReceipt = z.object({
  receiptId: z.number().int().positive(),
  bankVersion: z.number().int().positive(),
  action,
});
export const supplierState = z.object({
  bankVersion: z.number().int(),
  lastFour: z.string().nullable(),
  bankApproved: z.boolean(),
  bankFingerprint: z.string().nullable(),
  invoice: z
    .object({
      bankVersion: z.number().int(),
      amountMinor: z.number().int(),
      status: z.enum(["requested", "approved_internal", "stale_bank"]),
    })
    .nullable(),
  history: z.array(
    z.object({
      id: z.number(),
      action,
      actorId: z.number(),
      bankVersion: z.number(),
      invoiceRef: z.string(),
      amountMinor: z.number().nullable(),
      lastFour: z.string().nullable(),
      supersedesBankVersion: z.number().int().nullable(),
      supersededByReceiptId: z.number().int().nullable(),
      createdAt: z.date(),
    })
  ),
});
function unavailable(message: string) {
  return new TRPCError({ code: "PRECONDITION_FAILED", message });
}
function store() {
  const db = getDb();
  if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE" });
  return db;
}
async function authorize(
  tx: SettlementTx,
  tenantId: number | null,
  actorId: number
) {
  if (tenantId === null) throw new TRPCError({ code: "FORBIDDEN" });
  await assertTenantOperational(tx, tenantId);
  const [actor] = await tx
    .select({ tenantId: users.tenantId, role: users.role })
    .from(users)
    .where(eq(users.id, actorId))
    .for("share");
  if (
    !actor ||
    actor.tenantId !== tenantId ||
    (!isAdmin(actor.role) && !["airline_admin", "finance"].includes(actor.role))
  )
    throw new TRPCError({ code: "FORBIDDEN" });
  return tenantId;
}

export function recordSupplierDecision(
  input: z.infer<typeof supplierCommand>,
  tenantId: number | null,
  actorId: number
) {
  return store().transaction(async tx => {
    const scope = await authorize(tx, tenantId, actorId);
    return withTransactionalIdempotency(
      {
        scope: "supplier.finance",
        userId: actorId,
        key: input.requestId,
        request: { scope, input },
        run: async current => {
          if (input.action === "bank_change" && input.bankVersion === 0)
            await current
              .insert(profiles)
              .values({ tenantId: scope, supplierRef: input.supplierRef })
              .onDuplicateKeyUpdate({ set: { id: sql`${profiles.id}` } });
          const [profile] = await current
            .select()
            .from(profiles)
            .where(
              and(
                eq(profiles.tenantId, scope),
                eq(profiles.supplierRef, input.supplierRef)
              )
            )
            .for("update");
          if (!profile || profile.bankVersion !== input.bankVersion)
            throw unavailable(
              "Supplier bank version changed; reload the review."
            );
          let version = profile.bankVersion;
          const banking = and(
            eq(events.profileId, profile.id),
            eq(events.bankVersion, version)
          );
          const invoiceRef = "invoiceRef" in input ? input.invoiceRef : "";
          if (input.action === "bank_change") {
            const [used] = await current
              .select({ id: events.id })
              .from(events)
              .where(
                and(
                  eq(events.profileId, profile.id),
                  eq(events.vaultRef, input.vaultRef)
                )
              )
              .limit(1)
              .for("update");
            if (used)
              throw unavailable(
                "Each bank change requires a new immutable vault reference."
              );
            version++;
          } else {
            const [change] = await current
              .select()
              .from(events)
              .where(and(banking, eq(events.action, "bank_change")))
              .for("update");
            if (!change)
              throw unavailable("Supplier bank details are unavailable.");
            if (
              (input.action === "bank_approved" ||
                input.action === "payout_approved") &&
              change.actorId === actorId
            )
              throw unavailable(
                "The bank editor cannot approve this bank or a linked payout."
              );
            const [existing] = await current
              .select({ id: events.id })
              .from(events)
              .where(
                and(
                  banking,
                  eq(events.action, input.action),
                  eq(events.invoiceRef, invoiceRef)
                )
              )
              .for("update");
            if (existing)
              throw unavailable(
                "This decision already exists; retrieve its receipt."
              );
            if (input.action !== "bank_approved") {
              const [approved] = await current
                .select({ id: events.id })
                .from(events)
                .where(and(banking, eq(events.action, "bank_approved")))
                .for("update");
              if (!approved)
                throw unavailable(
                  "The current bank version requires independent approval."
                );
              if (input.action === "payout_approved") {
                const [request] = await current
                  .select()
                  .from(events)
                  .where(
                    and(
                      banking,
                      eq(events.action, "payout_request"),
                      eq(events.invoiceRef, invoiceRef)
                    )
                  )
                  .for("update");
                if (
                  !request ||
                  request.actorId === actorId ||
                  request.amountMinor !== input.amountMinor
                )
                  throw unavailable(
                    "Independent approval of the exact invoice and SAR amount is required."
                  );
              }
            }
          }
          const [row] = await current.insert(events).values({
            profileId: profile.id,
            bankVersion: version,
            action: input.action,
            invoiceRef,
            supersedesBankVersion:
              input.action === "bank_change" && profile.bankVersion > 0
                ? profile.bankVersion
                : null,
            vaultRef: input.action === "bank_change" ? input.vaultRef : null,
            lastFour: input.action === "bank_change" ? input.lastFour : null,
            amountMinor: "amountMinor" in input ? input.amountMinor : null,
            actorId,
          });
          if (input.action === "bank_change") {
            await current
              .update(profiles)
              .set({ bankVersion: version })
              .where(eq(profiles.id, profile.id));
          }
          return {
            receiptId: Number(row.insertId),
            bankVersion: version,
            action: input.action,
          };
        },
      },
      tx
    );
  });
}

export function readSupplierState(
  input: z.infer<typeof supplierQuery>,
  tenantId: number | null,
  actorId: number
) {
  return store().transaction(async tx => {
    const scope = await authorize(tx, tenantId, actorId);
    const [profile] = await tx
      .select()
      .from(profiles)
      .where(
        and(
          eq(profiles.tenantId, scope),
          eq(profiles.supplierRef, input.supplierRef)
        )
      )
      .for("share");
    if (!profile)
      return {
        bankVersion: 0,
        lastFour: null,
        bankApproved: false,
        bankFingerprint: null,
        invoice: null,
        history: [],
      };
    const inProfile = eq(events.profileId, profile.id);
    const banking = await tx
      .select({
        action: events.action,
        lastFour: events.lastFour,
        vaultRef: events.vaultRef,
      })
      .from(events)
      .where(
        and(
          inProfile,
          eq(events.bankVersion, profile.bankVersion),
          eq(events.invoiceRef, "")
        )
      );
    const [item] = input.invoiceRef
      ? await tx
          .select({
            action: events.action,
            amountMinor: events.amountMinor,
            bankVersion: events.bankVersion,
          })
          .from(events)
          .where(and(inProfile, eq(events.invoiceRef, input.invoiceRef)))
          .orderBy(desc(events.id))
          .limit(1)
      : [];
    const supersession = alias(events, "supersession");
    const history = await tx
      .select({
        id: events.id,
        supersedesBankVersion: events.supersedesBankVersion,
        supersededByReceiptId: supersession.id,
        action: events.action,
        actorId: events.actorId,
        bankVersion: events.bankVersion,
        invoiceRef: events.invoiceRef,
        amountMinor: events.amountMinor,
        lastFour: events.lastFour,
        createdAt: events.createdAt,
      })
      .from(events)
      .leftJoin(
        supersession,
        and(
          eq(supersession.profileId, events.profileId),
          eq(supersession.bankVersion, sql`${events.bankVersion} + 1`),
          eq(supersession.action, "bank_change"),
          eq(supersession.supersedesBankVersion, events.bankVersion)
        )
      )
      .where(inProfile)
      .orderBy(desc(events.id))
      .limit(50);
    const status: "stale_bank" | "approved_internal" | "requested" =
      item?.bankVersion !== profile.bankVersion
        ? "stale_bank"
        : item?.action === "payout_approved"
          ? "approved_internal"
          : "requested";
    const bank = banking.find(b => b.action === "bank_change");
    return {
      bankFingerprint: bank?.vaultRef
        ? createHash("sha256").update(bank.vaultRef).digest("hex")
        : null,
      bankVersion: profile.bankVersion,
      lastFour: bank?.lastFour ?? null,
      bankApproved: banking.some(b => b.action === "bank_approved"),
      invoice:
        item && item.amountMinor != null
          ? {
              bankVersion: item.bankVersion,
              amountMinor: item.amountMinor,
              status,
            }
          : null,
      history,
    };
  });
}
