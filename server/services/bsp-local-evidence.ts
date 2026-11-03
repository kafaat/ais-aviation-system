import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { and, asc, eq, gte, lt, sql } from "drizzle-orm";
import {
  bspMovement,
  localRetDraft,
  normalizedHot,
  normalizedBank,
  type Ret,
  type Hot,
  type Bank,
} from "../../shared/bsp-local-evidence";
import { bspEvidenceFiles } from "../../drizzle/operations-schema";
import { agentBookings, bookings, financialLedger } from "../../drizzle/schema";
import { getDb } from "../db";
import type { SettlementTx } from "./booking-settlement.service";
import { nonCashFundingCondition } from "./financial-reporting.service";

type Actor = { tenantId: number; userId: number };
type Kind = typeof bspEvidenceFiles.$inferSelect.kind;

function fail(message: string): never {
  throw new TRPCError({ code: "PRECONDITION_FAILED", message });
}

async function database() {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE" });
  return db;
}

async function dailyLedger(
  tx: SettlementTx,
  day: string,
  tenantId: number
): Promise<Ret> {
  const start = new Date(day + "T00:00:00Z");
  const end = new Date(start.getTime() + 86400000);
  if (end.getTime() > Date.now()) fail("The UTC reporting day is still open");
  const rows = await tx
    .select({
      ledgerId: financialLedger.id,
      bookingId: bookings.id,
      agentId: agentBookings.agentId,
      type: financialLedger.type,
      amountMinor: sql<string>`${financialLedger.amount} * 100`,
      currency: financialLedger.currency,
    })
    .from(financialLedger)
    .innerJoin(bookings, eq(bookings.id, financialLedger.bookingId))
    .innerJoin(agentBookings, eq(agentBookings.bookingId, bookings.id))
    .where(
      and(
        eq(bookings.tenantId, tenantId),
        gte(financialLedger.transactionDate, start),
        lt(financialLedger.transactionDate, end),
        sql`NOT (${nonCashFundingCondition()})`
      )
    )
    .orderBy(asc(financialLedger.id))
    .limit(1001);
  if (!rows.length || rows.length > 1000)
    fail("Day must contain 1–1000 agent cash movements");
  const mapped = rows.map(row => {
    if (
      row.currency !== "SAR" ||
      !["charge", "refund", "partial_refund"].includes(row.type)
    )
      fail("Unsupported currency or ledger movement requires manual mapping");
    return bspMovement.parse({
      ledgerId: row.ledgerId,
      bookingId: row.bookingId,
      agentId: row.agentId,
      kind: row.type === "charge" ? "sale" : "refund",
      amountMinor: Number(row.amountMinor),
    });
  });
  return {
    profile: "AIS-BSP-LOCAL-1",
    direction: "outbound_ret_draft",
    tenantId,
    day,
    currency: "SAR",
    lines: mapped,
  };
}

async function read(
  tx: SettlementTx,
  tenantId: number,
  kind: Kind,
  reference: string,
  lock = false
) {
  const query = tx
    .select()
    .from(bspEvidenceFiles)
    .where(
      and(
        eq(bspEvidenceFiles.tenantId, tenantId),
        eq(bspEvidenceFiles.kind, kind),
        eq(bspEvidenceFiles.reference, reference)
      )
    )
    .limit(1);
  const [row] = await (lock ? query.for("update") : query);
  if (!row)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "BSP evidence is missing for this tenant",
    });
  return row;
}

async function persist(
  tx: SettlementTx,
  actor: Actor,
  kind: Kind,
  reference: string,
  content: Ret | Hot | Bank
) {
  if (actor.tenantId !== content.tenantId)
    throw new TRPCError({ code: "FORBIDDEN" });
  const digest = createHash("sha256")
    .update(JSON.stringify(content))
    .digest("hex");
  await tx
    .insert(bspEvidenceFiles)
    .values({
      tenantId: actor.tenantId,
      kind,
      reference,
      digest,
      content,
      recordedBy: actor.userId,
    })
    .onDuplicateKeyUpdate({ set: { id: sql`id` } });
  const row = await read(tx, actor.tenantId, kind, reference, true);
  if (row.digest !== digest)
    throw new TRPCError({
      code: "CONFLICT",
      message: "Evidence reference already identifies different content",
    });
  return { reference, digest };
}

export async function stageDailyRet(day: string, actor: Actor) {
  return (await database()).transaction(async tx => {
    const draft = await dailyLedger(tx, day, actor.tenantId);
    const receipt = await persist(tx, actor, "ret_draft", day, draft);
    return { ...receipt, draft };
  });
}

export async function importBspEvidence(content: Hot | Bank, actor: Actor) {
  return (await database()).transaction(tx => {
    if (content.direction === "inbound_bank")
      return persist(tx, actor, "bank_input", content.statementLineId, content);
    return persist(
      tx,
      actor,
      "hot_input",
      content.settlementReference,
      content
    );
  });
}

function different(left: Ret["lines"], right: Ret["lines"]) {
  const r = new Map(right.map(row => [row.ledgerId, row]));
  const ids: number[] = [];
  for (const line of left) {
    const rhs = r.get(line.ledgerId);
    if (
      !rhs ||
      rhs.bookingId !== line.bookingId ||
      rhs.agentId !== line.agentId ||
      rhs.kind !== line.kind ||
      rhs.amountMinor !== line.amountMinor
    )
      ids.push(line.ledgerId);
    r.delete(line.ledgerId);
  }
  return ids.concat([...r.keys()]).sort((a, b) => a - b);
}

export function compareBspEvidence(
  current: Ret,
  draft: Ret,
  hot: Hot,
  bank: Bank
) {
  const ledgerDifferences = different(current.lines, draft.lines);
  const handoffDifferences = different(draft.lines, hot.lines);
  const netMinor = draft.lines.reduce(
    (sum, line) =>
      sum + (line.kind === "sale" ? line.amountMinor : -line.amountMinor),
    0
  );
  const sameScope = (a: Ret | Hot | Bank, b: Ret | Hot | Bank) =>
    a.day === b.day && a.tenantId === b.tenantId && a.currency === b.currency;
  const retMatchesLedger =
    sameScope(current, draft) && !ledgerDifferences.length;
  const hotMatchesRet =
    sameScope(draft, hot) &&
    !handoffDifferences.length &&
    hot.transferMinor === netMinor;
  const bankMatchesHot =
    sameScope(hot, bank) &&
    bank.settlementReference === hot.settlementReference &&
    bank.transferMinor === hot.transferMinor;
  return {
    basis: "local_evidence_only" as const,
    matches: retMatchesLedger && hotMatchesRet && bankMatchesHot,
    retMatchesLedger,
    hotMatchesRet,
    bankMatchesHot,
    netMinor,
    differingLedgerIds: [
      ...new Set([...ledgerDifferences, ...handoffDifferences]),
    ].sort((a, b) => a - b),
  };
}

export async function reconcileBspEvidence(
  day: string,
  settlementReference: string,
  statementLineId: string,
  tenantId: number
) {
  return (await database()).transaction(async tx =>
    compareBspEvidence(
      await dailyLedger(tx, day, tenantId),
      localRetDraft.parse((await read(tx, tenantId, "ret_draft", day)).content),
      normalizedHot.parse(
        (await read(tx, tenantId, "hot_input", settlementReference)).content
      ),
      normalizedBank.parse(
        (await read(tx, tenantId, "bank_input", statementLineId)).content
      )
    )
  );
}
