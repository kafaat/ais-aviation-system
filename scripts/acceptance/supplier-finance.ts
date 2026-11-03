import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import * as s from "../../drizzle/schema";
import type { TrpcContext } from "../../server/_core/context";
import type { SettlementTx } from "../../server/services/booking-settlement.service";
import { supplierFinanceRouter } from "../../server/routers/supplier-finance";

export async function verifySupplierFinance(db: SettlementTx) {
  const id = 1996000;
  await db.insert(s.tenants).values(
    [id, id + 1].map(i => ({
      id: i,
      slug: "supplier-proof-" + i,
      name: "Supplier proof",
      status: "active" as const,
    }))
  );
  await db.insert(s.users).values(
    Array.from({ length: 5 }, (_, i) => ({
      id: id + i,
      tenantId: i === 4 ? id + 1 : id,
      openId: "supplier-actor-" + i,
      role: i === 3 ? ("ops" as const) : ("finance" as const),
    }))
  );
  const actors = await db
    .select()
    .from(s.users)
    .where(inArray(s.users.id, [id, id + 1, id + 2, id + 3, id + 4]));
  const [editor, requester, checker, ops, other] = actors
    .sort((a, b) => a.id - b.id)
    .map(user =>
      supplierFinanceRouter.createCaller({
        user,
        tenantId: user.tenantId,
        authMethod: "bearer",
        req: { headers: {} },
        res: {},
      } as TrpcContext)
    );
  const supplierRef = randomUUID(),
    invoiceRef = randomUUID();
  const change = {
    action: "bank_change" as const,
    supplierRef,
    bankVersion: 0,
    requestId: randomUUID(),
    vaultRef: randomUUID(),
    lastFour: "0123",
  };
  await assert.rejects(ops.record(change), { code: "FORBIDDEN" });
  await assert.rejects(
    editor.record({ ...change, vaultRef: "SA1234567890000000000000" }),
    { code: "BAD_REQUEST" }
  );
  const [first, replay] = await Promise.all([
    editor.record(change),
    editor.record(change),
  ]);
  assert.deepEqual(first, replay);
  await assert.rejects(editor.record({ ...change, lastFour: "0124" }), {
    code: "CONFLICT",
  });
  assert.equal(
    (await other.review({ supplierRef, invoiceRef })).bankVersion,
    0
  );
  const approveBank = {
    action: "bank_approved" as const,
    requestId: randomUUID(),
    supplierRef,
    bankVersion: 1,
  };
  await assert.rejects(editor.record(approveBank), {
    code: "PRECONDITION_FAILED",
  });
  const request = {
    action: "payout_request" as const,
    requestId: randomUUID(),
    supplierRef,
    bankVersion: 1,
    amountMinor: 12500,
    invoiceRef,
  };
  await assert.rejects(requester.record(request), {
    code: "PRECONDITION_FAILED",
  });
  await checker.record(approveBank);
  await requester.record(request);
  const approve = {
    ...request,
    action: "payout_approved" as const,
    requestId: randomUUID(),
  };
  await assert.rejects(editor.record(approve), { code: "PRECONDITION_FAILED" });
  await assert.rejects(requester.record(approve), {
    code: "PRECONDITION_FAILED",
  });
  await assert.rejects(checker.record({ ...approve, amountMinor: 12499 }), {
    code: "PRECONDITION_FAILED",
  });
  await assert.rejects(other.record(approve), { code: "PRECONDITION_FAILED" });
  const receipt = await checker.record(approve);
  assert.deepEqual(await checker.record(approve), receipt);
  const review = await checker.review({ supplierRef, invoiceRef });
  assert.equal(review.history.length, 4);
  assert.equal(review.invoice?.status, "approved_internal");
  assert.equal(JSON.stringify(review).includes(change.vaultRef), false);
  const another = {
    ...change,
    requestId: randomUUID(),
    bankVersion: 1,
    vaultRef: randomUUID(),
    lastFour: "4444",
  };
  const superseding = await editor.record(another);
  assert.equal(
    (await checker.review({ supplierRef, invoiceRef })).invoice?.status,
    "stale_bank"
  );
  await assert.rejects(
    checker.record({ ...approve, requestId: randomUUID() }),
    { code: "PRECONDITION_FAILED" }
  );
  await assert.rejects(
    requester.record({ ...request, bankVersion: 2, requestId: randomUUID() }),
    { code: "PRECONDITION_FAILED" }
  );
  await checker.record({
    ...approveBank,
    requestId: randomUUID(),
    bankVersion: 2,
  });
  await requester.record({
    ...request,
    requestId: randomUUID(),
    bankVersion: 2,
  });
  const renewed = await checker.record({
    ...approve,
    requestId: randomUUID(),
    bankVersion: 2,
  });
  const latest = await checker.review({ supplierRef, invoiceRef });
  const authorizations = latest.history.filter(
    row => row.invoiceRef === invoiceRef && row.action === "payout_approved"
  );
  assert.deepEqual(
    authorizations.map(row => [row.id, row.supersededByReceiptId]),
    [
      [renewed.receiptId, null],
      [receipt.receiptId, superseding.receiptId],
    ]
  );
  assert.equal(
    latest.history.find(row => row.id === superseding.receiptId)
      ?.supersedesBankVersion,
    1
  );
  assert.equal(latest.invoice?.bankVersion, 2);
  await db
    .update(s.users)
    .set({ role: "ops" })
    .where(eq(s.users.id, id + 2));
  await assert.rejects(checker.record(approve), { code: "FORBIDDEN" });
  await assert.rejects(
    db
      .update(s.supplierFinanceEvents)
      .set({ amountMinor: 1 })
      .where(eq(s.supplierFinanceEvents.id, receipt.receiptId)),
    err =>
      String((err as Error & { cause?: Error }).cause?.message ?? err).includes(
        "append-only"
      )
  );
  await assert.rejects(
    db
      .delete(s.supplierFinanceEvents)
      .where(eq(s.supplierFinanceEvents.id, receipt.receiptId)),
    err =>
      String((err as Error & { cause?: Error }).cause?.message ?? err).includes(
        "append-only"
      )
  );
}
