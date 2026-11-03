import assert from "node:assert/strict";
import {
  agentBookings,
  financialLedger,
  travelAgents,
} from "../../drizzle/schema";
import type { TrpcContext } from "../../server/_core/context";
import { bspReportingRouter } from "../../server/routers/bsp-reporting";
import type { SettlementTx } from "../../server/services/booking-settlement.service";

export async function verifyBspLocalEvidence(
  db: SettlementTx,
  ctx: TrpcContext,
  bookingId: number
) {
  assert(ctx.user && ctx.tenantId);
  const tenantId = ctx.tenantId;
  const finance = bspReportingRouter.createCaller({
    ...ctx,
    user: { ...ctx.user, role: "finance" },
  });
  const other = bspReportingRouter.createCaller({
    ...ctx,
    tenantId: tenantId + 1,
    user: { ...ctx.user, tenantId: tenantId + 1, role: "finance" },
  });
  const day = "2020-01-05";
  const [agent] = await db.insert(travelAgents).values({
    agencyName: "BSP synthetic agency",
    iataNumber: "FIX-BSP-LOCAL",
    contactName: "Synthetic",
    email: "bsp@fixture.invalid",
    phone: "000",
    apiKey: "local-bsp-test",
    apiSecret: "fixture-only",
  });
  await db.insert(agentBookings).values({
    agentId: agent.insertId,
    bookingId,
    commissionRate: "0",
    commissionAmount: 0,
    bookingAmount: 1500,
  });
  await db.insert(financialLedger).values([
    {
      bookingId,
      type: "charge",
      amount: "15.00",
      transactionDate: new Date(day + "T04:00:00Z"),
    },
    {
      bookingId,
      type: "partial_refund",
      amount: "10.00",
      transactionDate: new Date(day + "T05:00:00Z"),
    },
  ]);
  const [draft, replay] = await Promise.all([
    finance.stageDailyRet({ day }),
    finance.stageDailyRet({ day }),
  ]);
  assert.deepEqual(draft, replay);
  assert.equal(draft.draft.lines.length, 2);
  const hot = {
    ...draft.draft,
    direction: "inbound_hot" as const,
    settlementReference: "TEST-BSP-1",
    transferMinor: 500,
  };
  const bank = {
    profile: hot.profile,
    tenantId,
    day,
    currency: hot.currency,
    direction: "inbound_bank" as const,
    settlementReference: hot.settlementReference,
    statementLineId: "TEST-BANK-1",
    transferMinor: 500,
  };
  await assert.rejects(other.importEvidence(hot), { code: "FORBIDDEN" });
  const h = await finance.importEvidence(hot);
  assert.deepEqual(await finance.importEvidence(hot), h);
  await assert.rejects(finance.importEvidence({ ...hot, transferMinor: 501 }), {
    code: "CONFLICT",
  });
  await finance.importEvidence(bank);
  const request = {
    day,
    settlementReference: hot.settlementReference,
    statementLineId: bank.statementLineId,
  };
  assert.equal((await finance.reconcileEvidence(request)).matches, true);
  await db.insert(financialLedger).values({
    bookingId,
    type: "refund",
    amount: "1.00",
    transactionDate: new Date(day + "T06:00:00Z"),
  });
  assert.equal(
    (await finance.reconcileEvidence(request)).retMatchesLedger,
    false
  );
  await assert.rejects(finance.stageDailyRet({ day }), { code: "CONFLICT" });
  return {
    localRetHotBankMatched: true,
    changedReplayRejected: true,
    latePostingDetected: true,
    outboundRequests: 0,
  };
}
