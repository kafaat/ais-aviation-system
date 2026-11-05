import { createHash } from "node:crypto";
import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import {
  accountDeletionRequests,
  accountLocks,
  auditLogs,
  financialLedger,
  paymentReceipts,
  stripeEvents,
  users,
  wallets,
  walletTransactions,
} from "../../drizzle/schema";
import type { SettlementTx } from "./booking-settlement.service";
import {
  inspectWalletFunding,
  reconcileWalletFunding,
  WalletFundingReviewRequiredError,
} from "./wallet-funding.service";

const COMMAND = "wallet_funding.reconcile.v1";
const MAX_RECEIPTS = 25;
const MAX_RECEIPT_ROWS = 200;
const MAX_SOURCE_ROWS = 1000;
const MAX_RESTRICTIONS = 50;
const id = z.number().int().positive().max(2147483647);
const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);

export const walletFundingMaintenanceScope = z.strictObject({
  actorId: id,
  userId: id,
  paymentIntentIds: z
    .array(
      z
        .string()
        .regex(/^pi_[A-Za-z0-9_]+$/)
        .max(255)
    )
    .min(1)
    .max(MAX_RECEIPTS),
});
const approvalSchema = z.strictObject({
  approvedDigest: digestSchema,
  approvalReference: z.string().trim().min(3).max(200),
});
type Scope = z.infer<typeof walletFundingMaintenanceScope>;
type Receipt = typeof paymentReceipts.$inferSelect;
type Wallet = typeof wallets.$inferSelect;
type Movement = typeof walletTransactions.$inferSelect;
type Ledger = typeof financialLedger.$inferSelect;
type ProviderEvent = typeof stripeEvents.$inferSelect;

function review(reason: string): never {
  throw new WalletFundingReviewRequiredError(reason);
}

function scopeOf(raw: unknown): Scope {
  const scope = walletFundingMaintenanceScope.parse(raw);
  if (new Set(scope.paymentIntentIds).size !== scope.paymentIntentIds.length)
    review("duplicate receipt in maintenance scope");
  return { ...scope, paymentIntentIds: [...scope.paymentIntentIds].sort() };
}

function digest(value: unknown): string {
  // All source arrays have explicit stable ordering. Metadata/provider JSON is
  // retained verbatim so an otherwise unrecognised source change also invalidates approval.
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function objectJson(
  value: string | null,
  label: string
): Record<string, unknown> {
  if (value === null) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
      return parsed as Record<string, unknown>;
  } catch {
    /* Fail closed below; never include raw provider data in the error. */
  }
  return review(`${label} is not a readable object`);
}

function minorUnits(value: string): number {
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(value)) review("invalid source amount");
  const result = Math.round(Number(value) * 100);
  if (!Number.isSafeInteger(result))
    review("source amount exceeds safe limits");
  return result;
}

function cashEvidence(row: Ledger) {
  const evidence = objectJson(row.metadata, "ledger metadata");
  if (row.type !== "adjustment") return null;
  if (
    evidence.eventType !== "charge.dispute.funds_withdrawn" &&
    evidence.eventType !== "charge.dispute.funds_reinstated"
  ) {
    if (
      ![
        "charge.dispute.created",
        "charge.dispute.updated",
        "charge.dispute.closed",
      ].includes(String(evidence.eventType)) ||
      minorUnits(row.amount) !== 0
    )
      review("unsupported adjustment evidence in selected receipt");
    return null;
  }
  if (
    !row.stripeEventId ||
    typeof evidence.disputeId !== "string" ||
    !evidence.disputeId
  )
    review("cash dispute event identity is missing");
  return { row, evidence, eventId: row.stripeEventId };
}

function sourceId(value: unknown): unknown {
  return value && typeof value === "object" && "id" in value ? value.id : value;
}

function verifyCashEvidence(row: Ledger, provider: ProviderEvent | undefined) {
  const cash = cashEvidence(row);
  if (!cash) return;
  if (
    !provider ||
    !provider.processed ||
    !provider.processedAt ||
    provider.error ||
    provider.id !== cash.eventId ||
    provider.type !== cash.evidence.eventType
  )
    review("cash dispute has no matching processed verified provider event");
  const data = objectJson(provider.data, "stored provider event");
  if (
    data.id !== cash.evidence.disputeId ||
    sourceId(data.payment_intent) !== row.stripePaymentIntentId ||
    sourceId(data.charge) !== row.stripeChargeId ||
    typeof data.amount !== "number" ||
    !Number.isSafeInteger(data.amount) ||
    data.amount <= 0 ||
    data.amount !== Math.abs(minorUnits(row.amount)) ||
    typeof data.currency !== "string" ||
    data.currency.toUpperCase() !== row.currency.toUpperCase() ||
    data.status !== cash.evidence.status ||
    data.reason !== cash.evidence.reason
  )
    review("cash dispute differs from its persisted verified provider event");
}

async function authority(tx: SettlementTx, scope: Scope, lock: boolean) {
  const query = tx
    .select({ id: users.id, role: users.role, tenantId: users.tenantId })
    .from(users)
    .where(inArray(users.id, [...new Set([scope.actorId, scope.userId])]))
    .orderBy(asc(users.id));
  const accounts = await (lock ? query.for("update") : query);
  const actor = accounts.find(account => account.id === scope.actorId);
  const owner = accounts.find(account => account.id === scope.userId);
  if (
    !actor ||
    !owner ||
    (!["admin", "super_admin"].includes(actor.role) &&
      (actor.role !== "finance" ||
        actor.tenantId === null ||
        actor.tenantId !== owner.tenantId))
  )
    review(
      "a current finance actor in the owner's tenant or platform administrator is required"
    );

  // Same account-access authority as session authentication. Current locking
  // reads also fence a role/lock/deletion change while an approved command waits.
  const lockQuery = tx
    .select()
    .from(accountLocks)
    .where(eq(accountLocks.userId, actor.id))
    .orderBy(asc(accountLocks.id))
    .limit(2);
  const locks = await (lock ? lockQuery.for("share") : lockQuery);
  const deletionQuery = tx
    .select()
    .from(accountDeletionRequests)
    .where(eq(accountDeletionRequests.userId, actor.id))
    .orderBy(asc(accountDeletionRequests.id))
    .limit(MAX_RESTRICTIONS + 1);
  const deletions = await (lock ? deletionQuery.for("share") : deletionQuery);
  if (locks.length > 1 || deletions.length > MAX_RESTRICTIONS)
    review("actor access evidence exceeds the supported review bound");
  const now = new Date();
  if (
    locks.some(
      row => row.isActive && (!row.autoUnlockAt || row.autoUnlockAt > now)
    )
  )
    review("approval actor is locked");
  if (
    deletions.some(
      row =>
        row.status !== "cancelled" &&
        (row.processedAt ||
          (row.confirmedAt &&
            row.scheduledDeletionAt &&
            row.scheduledDeletionAt <= now))
    )
  )
    review("approval actor is suspended for deletion");
  return { actor, owner, locks, deletions };
}
type Authority = Awaited<ReturnType<typeof authority>>;
type Sources = {
  receipt: Receipt;
  request: Movement;
  ledger: Ledger[];
  movements: Movement[];
};
type Snapshot = {
  scope: Scope;
  authority: Authority;
  wallet: Wallet;
  sources: Sources[];
  providerEvents: ProviderEvent[];
};

function validateSource(source: Sources, wallet: Wallet, ownerId: number) {
  const { receipt, request, ledger, movements } = source;
  if (
    receipt.kind !== "wallet_topup" ||
    receipt.bookingId !== null ||
    receipt.userId !== ownerId ||
    receipt.settlementStatus !== "applied" ||
    wallet.userId !== ownerId ||
    wallet.currency !== "SAR" ||
    receipt.currency !== wallet.currency ||
    request.id !== receipt.targetId ||
    request.type !== "top_up" ||
    request.status !== "completed" ||
    request.userId !== ownerId ||
    request.walletId !== wallet.id ||
    request.amount !== receipt.amount ||
    request.stripePaymentIntentId !== receipt.paymentIntentId
  )
    review(
      "selected receipt, completed top-up and wallet have inconsistent bindings"
    );
  const charges = ledger.filter(row => row.type === "charge");
  if (
    charges.length !== 1 ||
    !charges[0] ||
    minorUnits(charges[0].amount) !== receipt.amount
  )
    review(
      "selected receipt lacks one matching original collection ledger row"
    );
  let refunded = 0;
  for (const row of ledger) {
    if (
      row.userId !== ownerId ||
      row.bookingId !== null ||
      row.stripePaymentIntentId !== receipt.paymentIntentId ||
      row.currency !== receipt.currency
    )
      review("selected receipt contains foreign ledger ownership or currency");
    if (row.type === "refund" || row.type === "partial_refund") {
      const amount = minorUnits(row.amount);
      if (amount <= 0) review("refund evidence has an invalid amount");
      refunded += amount;
    } else if (row.type === "adjustment") {
      cashEvidence(row);
    } else if (row.type !== "charge")
      review("unsupported ledger effect in selected receipt");
    else if (
      objectJson(row.metadata, "ledger metadata").walletFunding !== undefined
    )
      review("original collection contains an unsupported funding adjustment");
  }
  if (refunded !== receipt.refundedAmount)
    review("cumulative refund differs from its persisted ledger evidence");
  let appliedMovement = 0;
  let originalCount = 0;
  for (const row of movements) {
    if (
      row.userId !== ownerId ||
      row.walletId !== wallet.id ||
      row.stripePaymentIntentId !== receipt.paymentIntentId ||
      row.status !== "completed"
    )
      review("selected receipt contains an unsupported wallet movement");
    if (row.id === request.id) {
      originalCount++;
      continue;
    }
    if (
      (row.type === "withdrawal" &&
        row.amount < 0 &&
        row.description === "Provider reversed wallet funding") ||
      (row.type === "refund" &&
        row.amount > 0 &&
        row.description === "Provider reinstated wallet funding")
    )
      appliedMovement += row.amount;
    else review("selected receipt contains an unrecognised wallet adjustment");
  }
  const projection = inspectWalletFunding(receipt, wallet, ledger);
  if (originalCount !== 1 || -appliedMovement !== projection.appliedLoss)
    review("wallet movements do not prove the recorded funding adjustments");
  return projection;
}

/** The apply transaction uses locking reads until it owns the wallet. Its first
 * consistent read is the movement list: it therefore sees the current committed
 * wallet movements without locking unrelated pending top-up requests via walletId. */
async function snapshot(
  tx: SettlementTx,
  scope: Scope,
  owner: Authority,
  locked?: { discovery: Snapshot; providerEvents: ProviderEvent[] }
): Promise<Snapshot> {
  const receipts: Receipt[] = [];
  const requests: Movement[] = [];
  if (locked) {
    const targets = [
      ...new Set(
        locked.discovery.sources.map(source => source.receipt.targetId)
      ),
    ].sort((a, b) => a - b);
    for (const target of targets) {
      const [request] = await tx
        .select()
        .from(walletTransactions)
        .where(eq(walletTransactions.id, target))
        .limit(1)
        .for("update");
      if (!request) review("top-up source changed since discovery");
      requests.push(request);
    }
  }
  const walletQuery = tx
    .select()
    .from(wallets)
    .where(eq(wallets.userId, scope.userId))
    .limit(1);
  const [wallet] = await (locked ? walletQuery.for("update") : walletQuery);
  if (!wallet) review("scoped wallet is missing");
  for (const paymentIntentId of scope.paymentIntentIds) {
    const receiptQuery = tx
      .select()
      .from(paymentReceipts)
      .where(eq(paymentReceipts.paymentIntentId, paymentIntentId))
      .limit(1);
    const [receipt] = await (locked
      ? receiptQuery.for("update")
      : receiptQuery);
    if (
      !receipt ||
      receipt.paymentIntentId !== paymentIntentId ||
      receipt.userId !== scope.userId ||
      receipt.kind !== "wallet_topup"
    )
      review(
        "receipt is missing or outside the explicitly selected wallet scope"
      );
    if (locked) {
      const hint = locked.discovery.sources.find(
        source => source.receipt.paymentIntentId === paymentIntentId
      );
      if (!hint || hint.receipt.targetId !== receipt.targetId)
        review("receipt target changed; obtain a new preview");
    } else {
      const [request] = await tx
        .select()
        .from(walletTransactions)
        .where(eq(walletTransactions.id, receipt.targetId))
        .limit(1);
      if (!request) review("completed top-up source is missing");
      requests.push(request);
    }
    receipts.push(receipt);
  }
  const sources: Sources[] = [];
  let sourceRows =
    receipts.length +
    requests.length +
    owner.locks.length +
    owner.deletions.length +
    1;
  for (const receipt of receipts) {
    const query = tx
      .select()
      .from(financialLedger)
      .where(eq(financialLedger.stripePaymentIntentId, receipt.paymentIntentId))
      .orderBy(asc(financialLedger.id))
      .limit(MAX_RECEIPT_ROWS + 1);
    const ledger = await (locked ? query.for("update") : query);
    const movements = await tx
      .select()
      .from(walletTransactions)
      .where(
        and(
          eq(walletTransactions.walletId, wallet.id),
          eq(walletTransactions.stripePaymentIntentId, receipt.paymentIntentId)
        )
      )
      .orderBy(asc(walletTransactions.id))
      .limit(MAX_RECEIPT_ROWS + 1);
    if (ledger.length > MAX_RECEIPT_ROWS || movements.length > MAX_RECEIPT_ROWS)
      review("receipt evidence exceeds the supported review bound");
    sourceRows += ledger.length + movements.length;
    if (sourceRows > MAX_SOURCE_ROWS)
      review("selected evidence exceeds the maintenance batch bound");
    const request = requests.find(row => row.id === receipt.targetId);
    if (!request) review("scoped top-up target changed");
    const source = { receipt, request, ledger, movements };
    validateSource(source, wallet, scope.userId);
    sources.push(source);
  }
  const eventIds = sources
    .flatMap(source =>
      source.ledger.flatMap(row => {
        const cash = cashEvidence(row);
        return cash ? [cash.eventId] : [];
      })
    )
    .sort();
  if (new Set(eventIds).size !== eventIds.length)
    review("duplicate provider event identity in selected ledger evidence");
  let providerEvents: ProviderEvent[];
  if (locked) {
    providerEvents = locked.providerEvents;
    if (
      JSON.stringify(providerEvents.map(row => row.id).sort()) !==
      JSON.stringify(eventIds)
    )
      review("provider evidence changed; obtain a new preview");
  } else {
    providerEvents = eventIds.length
      ? await tx
          .select()
          .from(stripeEvents)
          .where(inArray(stripeEvents.id, eventIds))
          .orderBy(asc(stripeEvents.id))
          .limit(MAX_SOURCE_ROWS + 1)
      : [];
  }
  if (sourceRows + providerEvents.length > MAX_SOURCE_ROWS)
    review("selected evidence exceeds the maintenance batch bound");
  const byId = new Map(providerEvents.map(row => [row.id, row]));
  for (const source of sources)
    for (const row of source.ledger)
      verifyCashEvidence(row, byId.get(row.stripeEventId ?? ""));
  return { scope, authority: owner, wallet, sources, providerEvents };
}

const countSchema = z.record(z.string(), z.number().int().nonnegative());
const rowSchema = z.strictObject({
  paymentIntentId: z.string(),
  collectedAmount: z.number().int(),
  refundedAmount: z.number().int(),
  appliedLoss: z.number().int(),
  fundingLoss: z.number().int(),
  adjustment: z.number().int(),
  eventId: z.string().nullable(),
  sourceCounts: countSchema,
});
const planSchema = z.strictObject({
  version: z.literal(1),
  scope: walletFundingMaintenanceScope,
  digest: digestSchema,
  sourceCounts: countSchema,
  wallet: z.strictObject({
    id,
    currency: z.literal("SAR"),
    balanceBefore: z.number().int(),
    projectedBalance: z.number().int(),
    statusBefore: z.enum(["active", "frozen", "closed"]),
    projectedStatus: z.enum(["active", "frozen", "closed"]),
  }),
  receipts: z.array(rowSchema),
});
const appliedSchema = planSchema.extend({
  mode: z.literal("applied"),
  approvalReference: z.string(),
  auditEventId: digestSchema,
  appliedAt: z.string().datetime(),
});
type Plan = z.infer<typeof planSchema>;
export type WalletFundingMaintenanceResult = z.infer<typeof appliedSchema>;

function planFor(source: Snapshot): Plan {
  if (Buffer.byteLength(JSON.stringify(source), "utf8") > 10 * 1024 * 1024)
    review("source payload exceeds the maintenance review bound");
  const receipts = source.sources
    .map(entry => {
      const projection = validateSource(
        entry,
        source.wallet,
        source.scope.userId
      );
      const candidates = entry.ledger.filter(
        row =>
          cashEvidence(row) &&
          objectJson(row.metadata, "ledger metadata").walletFunding ===
            undefined
      );
      const eventId =
        projection.adjustment === 0 ? null : candidates[0]?.stripeEventId;
      if (projection.adjustment !== 0 && !eventId)
        review(
          "funding mismatch has no unmarked verified cash event for repair"
        );
      return {
        paymentIntentId: entry.receipt.paymentIntentId,
        collectedAmount: entry.receipt.amount,
        refundedAmount: entry.receipt.refundedAmount,
        ...projection,
        eventId: eventId ?? null,
        sourceCounts: {
          ledgerRows: entry.ledger.length,
          walletMovements: entry.movements.length,
          providerEvents: entry.ledger.filter(row => cashEvidence(row)).length,
        },
      };
    })
    .sort(
      (a, b) =>
        b.adjustment - a.adjustment ||
        a.paymentIntentId.localeCompare(b.paymentIntentId)
    );
  // Proven restoration credits precede debits, avoiding an artificial transient
  // debt freeze when this approved batch has a nonnegative final balance.
  let balance = source.wallet.balance;
  let status = source.wallet.status;
  for (const row of receipts) {
    if (row.adjustment < -2147483648 || row.adjustment > 2147483647)
      review("projected wallet movement exceeds storage limits");
    balance += row.adjustment;
    if (
      !Number.isSafeInteger(balance) ||
      balance < -2147483648 ||
      balance > 2147483647
    )
      review("projected wallet balance exceeds storage limits");
    if (row.adjustment !== 0 && balance < 0 && status === "active")
      status = "frozen";
  }
  const wallet = {
    id: source.wallet.id,
    currency: source.wallet.currency,
    balanceBefore: source.wallet.balance,
    projectedBalance: balance,
    statusBefore: source.wallet.status,
    projectedStatus: status,
  };
  return planSchema.parse({
    version: 1,
    scope: source.scope,
    digest: digest({
      command: COMMAND,
      source,
      projection: { wallet, receipts },
    }),
    sourceCounts: {
      receipts: source.sources.length,
      topUps: source.sources.length,
      ledgerRows: source.sources.reduce(
        (sum, row) => sum + row.ledger.length,
        0
      ),
      walletMovements: source.sources.reduce(
        (sum, row) => sum + row.movements.length,
        0
      ),
      providerEvents: source.providerEvents.length,
      actorLocks: source.authority.locks.length,
      actorDeletionRequests: source.authority.deletions.length,
    },
    wallet,
    receipts,
  });
}

function previewSource(db: SettlementTx, scope: Scope) {
  return db.transaction(
    async tx => snapshot(tx, scope, await authority(tx, scope, false)),
    { isolationLevel: "repeatable read", accessMode: "read only" }
  );
}

export async function previewWalletFundingMaintenance(
  db: SettlementTx,
  rawScope: unknown
) {
  return {
    mode: "preview" as const,
    ...planFor(await previewSource(db, scopeOf(rawScope))),
  };
}

/** Only an explicit exact-digest approval mutates the selected wallet. No actor,
 * provider event, collection, refund or cash ledger identity is reconstructed. */
export async function applyWalletFundingMaintenance(
  db: SettlementTx,
  rawScope: unknown,
  rawApproval: unknown
): Promise<WalletFundingMaintenanceResult> {
  const scope = scopeOf(rawScope);
  const approval = approvalSchema.parse(rawApproval);
  const auditEventId = digest({
    command: COMMAND,
    actorId: scope.actorId,
    approvalReference: approval.approvalReference,
  });
  const requestHash = digest({ scope, approval });
  const [auditHint] = await db
    .select({ id: auditLogs.id })
    .from(auditLogs)
    .where(eq(auditLogs.eventId, auditEventId))
    .limit(1);
  // Discovery is a separate read-only transaction. Apply performs only current
  // locking reads until the wallet is held; see snapshot() for the movement read.
  const discovery = auditHint ? undefined : await previewSource(db, scope);
  return db.transaction(
    async tx => {
      // Webhooks own stripe_events BEFORE account/wallet. Match that order when
      // pinning verified evidence, rather than creating an inversion during replay.
      const providerEvents: ProviderEvent[] = [];
      for (const hint of discovery?.providerEvents ?? []) {
        const [event] = await tx
          .select()
          .from(stripeEvents)
          .where(eq(stripeEvents.id, hint.id))
          .limit(1)
          .for("share");
        if (!event) review("provider evidence changed; obtain a new preview");
        providerEvents.push(event);
      }
      const owner = await authority(tx, scope, true);
      const [existing] = await tx
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.eventId, auditEventId))
        .limit(1)
        .for("update");
      if (existing) {
        const saved = objectJson(
          existing.metadata,
          "maintenance audit receipt"
        );
        if (
          existing.eventType !== COMMAND ||
          existing.outcome !== "success" ||
          existing.userId !== scope.actorId ||
          saved.command !== COMMAND ||
          saved.requestHash !== requestHash
        )
          review("approval reference was already used for a different command");
        const response = appliedSchema.parse(saved.result);
        if (
          response.auditEventId !== auditEventId ||
          response.digest !== approval.approvedDigest ||
          response.approvalReference !== approval.approvalReference ||
          JSON.stringify(response.scope) !== JSON.stringify(scope)
        )
          review("maintenance audit receipt is inconsistent");
        return response;
      }
      if (!discovery)
        review("previous approval receipt disappeared; manual review required");
      const source = await snapshot(tx, scope, owner, {
        discovery,
        providerEvents,
      });
      const plan = planFor(source);
      if (plan.digest !== approval.approvedDigest)
        review("source digest changed; obtain a new preview and approval");
      let wallet = source.wallet;
      for (const row of plan.receipts) {
        if (row.adjustment === 0) continue;
        const entry = source.sources.find(
          item => item.receipt.paymentIntentId === row.paymentIntentId
        );
        if (!entry || !row.eventId)
          review("approved reconciliation source is missing");
        const applied = await reconcileWalletFunding(tx, {
          receipt: entry.receipt,
          wallet,
          eventId: row.eventId,
        });
        if (
          applied.adjustment !== row.adjustment ||
          applied.fundingLoss !== row.fundingLoss
        )
          review("funding authority changed during approved reconciliation");
        wallet = {
          ...wallet,
          balance: applied.balance,
          status:
            applied.balance < 0 && wallet.status === "active"
              ? "frozen"
              : wallet.status,
        };
      }
      if (
        wallet.balance !== plan.wallet.projectedBalance ||
        wallet.status !== plan.wallet.projectedStatus
      )
        review("approved wallet result does not match its preview");
      const result = appliedSchema.parse({
        ...plan,
        mode: "applied",
        approvalReference: approval.approvalReference,
        auditEventId,
        appliedAt: new Date().toISOString(),
      });
      await tx.insert(auditLogs).values({
        eventId: auditEventId,
        eventType: COMMAND,
        eventCategory: "payment",
        outcome: "success",
        severity: "high",
        userId: owner.actor.id,
        userRole: owner.actor.role,
        actorType: "admin",
        resourceType: "wallet",
        resourceId: String(wallet.id),
        requestId: approval.approvedDigest,
        previousValue: JSON.stringify({
          balance: source.wallet.balance,
          status: source.wallet.status,
        }),
        newValue: JSON.stringify({
          balance: wallet.balance,
          status: wallet.status,
        }),
        changeDescription: `Approved scoped wallet funding reconciliation: ${approval.approvalReference}`,
        metadata: JSON.stringify({ command: COMMAND, requestHash, result }),
      });
      return result;
    },
    { isolationLevel: "repeatable read" }
  );
}
