import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "../_core/context";
import { authorityRelationalFixture } from "./helpers/authority-relational-fixture";
import { vouchers, voucherUsage } from "../../drizzle/schema";
const state = vi.hoisted(() => ({ db: null as any }));
vi.mock("../db", () => ({ getDb: () => state.db }));
vi.mock("../_core/middleware/procedure-rate-limit", () => ({
  enforceProcedureRateLimit: vi.fn(),
}));
import { vouchersRouter } from "../routers/vouchers";
import { createVoucher, updateVoucher } from "../services/voucher.service";
let fixture: ReturnType<typeof authorityRelationalFixture>;
const caller = (role = "admin") =>
  vouchersRouter.createCaller({
    user: { id: 7, role },
    tenantId: null,
    req: { headers: {} },
    res: {},
  } as TrpcContext);
const input = (overrides: Record<string, unknown> = {}) => ({
  code: "SAVE10",
  type: "percentage" as const,
  value: 10,
  validFrom: new Date("2020-01-01T12:00:00Z"),
  validUntil: new Date("2035-01-01T12:00:00Z"),
  ...overrides,
});
beforeEach(() => {
  fixture = authorityRelationalFixture([vouchers, voucherUsage]);
  state.db = fixture.db;
});
afterEach(() => fixture.close());
describe("voucher unit and validation boundary", () => {
  it.each([null, 2000, 500])(
    "keeps raw 10 percent with cap %s in SAR minor units",
    async maxDiscount => {
      const stored = await caller().create({ ...input(), maxDiscount });
      expect(stored.value).toBe(10);
      const discountAmount = maxDiscount === 500 ? 500 : 1000;
      await expect(
        caller().validate({ code: "SAVE10", amount: 10000 })
      ).resolves.toMatchObject({
        discountAmount,
        finalAmount: 10000 - discountAmount,
      });
    }
  );
  it("keeps fixed SAR 10 as 1000 minor units", async () => {
    await caller().create({ ...input(), type: "fixed", value: 1000 });
    await expect(
      caller().validate({ code: "SAVE10", amount: 10000 })
    ).resolves.toMatchObject({ discountAmount: 1000, finalAmount: 9000 });
  });
  it.each([0, -1, 10.5, 101, 1000, Infinity, NaN])(
    "rejects invalid percentage %s on create and update",
    async value => {
      await expect(
        caller().create({ ...input(), value })
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      const stored = await caller().create({ ...input(), isActive: false });
      await expect(
        caller().update({ id: stored.id, value })
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect((await caller().getById({ id: stored.id }))?.value).toBe(10);
    }
  );
  it.each([0, -1, 1.5, 2_147_483_648])(
    "rejects invalid fixed minor amount %s",
    async value => {
      await expect(
        caller().create({ ...input(), type: "fixed", value })
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      await expect(
        createVoucher({ ...input(), type: "fixed", value }, 7)
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
  );
  it("validates merged type transitions instead of only supplied fields", async () => {
    const stored = await caller().create({
      ...input(),
      type: "fixed",
      value: 1000,
      isActive: false,
    });
    await expect(
      caller().update({ id: stored.id, type: "percentage" })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      caller().update({
        id: stored.id,
        type: "percentage",
        value: 10,
        maxDiscount: 2000,
      })
    ).resolves.toMatchObject({
      type: "percentage",
      value: 10,
      maxDiscount: 2000,
    });
    await expect(
      caller().update({ id: stored.id, type: "fixed", value: 1000 })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      caller().update({
        id: stored.id,
        type: "fixed",
        value: 1000,
        maxDiscount: null,
      })
    ).resolves.toMatchObject({ type: "fixed", value: 1000, maxDiscount: null });
  });
  it("rejects invalid monetary limits, dates and unsupported currency fields", async () => {
    for (const patch of [
      { minPurchase: -1 },
      { minPurchase: 0.5 },
      { maxDiscount: 0 },
      { maxDiscount: 0.5 },
      { maxUses: 0 },
      { maxUses: 1.5 },
      { validUntil: new Date("2019-01-01") },
      { currency: "USD" },
    ]) {
      await expect(
        caller().create({ ...input(), ...patch } as any)
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
    const stored = await caller().create({ ...input(), isActive: false });
    await expect(
      caller().update({ id: stored.id, validFrom: new Date("2036-01-01") })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      caller().validate({ code: stored.code, amount: 10000.5 })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
  it("protects direct service updates and omitted fields", async () => {
    const stored = await caller().create({
      ...input(),
      isActive: false,
      minPurchase: 5000,
      maxUses: 9,
      maxDiscount: 2000,
    });
    await expect(
      updateVoucher(stored.id, { value: 1000 })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      updateVoucher(stored.id, { description: "Updated note" })
    ).resolves.toMatchObject({
      isActive: false,
      minPurchase: 5000,
      maxUses: 9,
      maxDiscount: 2000,
      value: 10,
    });
    expect(
      fixture.queries.some(q => q.inTransaction && q.sql.includes("for update"))
    ).toBe(true);
  });
});
describe("voucher edit policy", () => {
  it("requires deactivation before changing unused economic terms", async () => {
    const stored = await caller().create(input());
    await expect(
      caller().update({ id: stored.id, value: 20 })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await caller().deactivate({ id: stored.id });
    await expect(
      caller().update({ id: stored.id, value: 20 })
    ).resolves.toMatchObject({ value: 20, isActive: false });
    await expect(
      caller().update({ id: stored.id, isActive: true })
    ).resolves.toMatchObject({ value: 20, isActive: true });
  });
  it.each([0, 1])(
    "keeps historical terms immutable even if current usedCount is %s",
    async usedCount => {
      const stored = await caller().create({ ...input(), isActive: false });
      fixture.sqlite
        .prepare("UPDATE vouchers SET usedCount = ? WHERE id = ?")
        .run(usedCount, stored.id);
      fixture.insert(voucherUsage, {
        id: 1,
        voucherId: stored.id,
        bookingId: 9,
        userId: 11,
        discountApplied: 1000,
        releasedAt: usedCount ? null : "2026-01-01 00:00:00",
      });
      await expect(
        caller().update({ id: stored.id, value: 20 })
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
      await expect(
        caller().update({
          id: stored.id,
          description: "History preserved",
          validUntil: new Date("2036-01-01"),
          maxUses: 20,
        })
      ).resolves.toMatchObject({ value: 10, description: "History preserved" });
    }
  );
  it("rejects code and usedCount changes and quota below recorded usage", async () => {
    const stored = await caller().create(input());
    fixture.sqlite
      .prepare("UPDATE vouchers SET usedCount = 2 WHERE id = ?")
      .run(stored.id);
    for (const patch of [
      { code: "CHANGED" },
      { usedCount: 0 },
      { maxUses: 1 },
    ]) {
      await expect(
        caller().update({ id: stored.id, ...patch } as any)
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
  });
  it("rejects but never normalizes historical bad percentages, and always allows deactivation", async () => {
    const stored = await caller().create({ ...input(), maxDiscount: 2000 });
    fixture.sqlite
      .prepare("UPDATE vouchers SET value = 1000 WHERE id = ?")
      .run(stored.id);
    await expect(
      caller().validate({ code: stored.code, amount: 10000 })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      caller().update({ id: stored.id, description: "Unrepaired" })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller().deactivate({ id: stored.id })).resolves.toMatchObject(
      { value: 1000, isActive: false }
    );
    await expect(
      caller().update({ id: stored.id, isActive: true })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      caller().update({ id: stored.id, value: 10 })
    ).resolves.toMatchObject({ value: 10, isActive: false });
  });
  it("does not hide missing records as internal errors", async () => {
    await expect(
      caller().update({ id: 999, description: "No record" })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(caller().deactivate({ id: 999 })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
  it.each(["user", "support", "ops", "finance", "airline_admin"])(
    "denies administrative voucher edits to %s",
    async role => {
      await expect(caller(role).create(input())).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      await expect(
        caller(role).update({ id: 1, description: "Denied" })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
  );
  it("allows super_admin to use the same voucher management API", async () => {
    const stored = await caller("super_admin").create(input());
    await expect(
      caller("super_admin").update({ id: stored.id, description: "Updated" })
    ).resolves.toMatchObject({ description: "Updated" });
  });
});
