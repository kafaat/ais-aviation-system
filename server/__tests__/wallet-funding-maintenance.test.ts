import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { transactionMemory } from "./helpers/transaction-memory";
import {
  applyWalletFundingMaintenance,
  previewWalletFundingMaintenance,
} from "../services/wallet-funding-maintenance.service";
import { parseWalletFundingMaintenanceArgs } from "../../scripts/db/reconcile-wallet-funding";

const at = new Date("2026-10-01T12:00:00Z");
const scope = { actorId: 10, userId: 9, paymentIntentIds: ["pi_legacy"] };
let fixture: ReturnType<typeof transactionMemory>;
const tables = [
  "users",
  "wallets",
  "wallet_transactions",
  "payment_receipts",
  "financial_ledger",
  "stripe_events",
  "audit_logs",
  "account_locks",
  "account_deletion_requests",
  "bookings",
  "outbox",
];
const snapshot = () =>
  Object.fromEntries(
    tables.map(name => [name, structuredClone(fixture.rows(name))])
  );
const preview = () => previewWalletFundingMaintenance(fixture.db, scope);
const apply = (
  approvedDigest: string,
  approvalReference = "FIN-APPROVAL-100"
) =>
  applyWalletFundingMaintenance(fixture.db, scope, {
    approvedDigest,
    approvalReference,
  });

function sources(pi = "pi_legacy", offset = 0) {
  const eventId = `evt_legacy_${offset}`;
  const provider = {
    id: `dp_legacy_${offset}`,
    object: "dispute",
    charge: `ch_legacy_${offset}`,
    payment_intent: pi,
    amount: 10000,
    currency: "sar",
    status: "under_review",
    reason: "fraudulent",
  };
  const evidence = {
    disputeId: provider.id,
    eventType: "charge.dispute.funds_withdrawn",
    status: provider.status,
    reason: provider.reason,
    providerMetadata: { keep: "original evidence" },
  };
  return {
    receipt: {
      paymentIntentId: pi,
      kind: "wallet_topup",
      targetId: 100 + offset,
      userId: 9,
      bookingId: null,
      amount: 10000,
      currency: "SAR",
      refundedAmount: 0,
      settlementStatus: "applied",
      settlementError: null,
      createdAt: at,
    },
    topup: {
      id: 100 + offset,
      walletId: 1,
      userId: 9,
      type: "top_up",
      amount: 10000,
      balanceAfter: 10000,
      status: "completed",
      stripePaymentIntentId: pi,
      bookingId: null,
      description: "Synthetic completed funding",
      createdAt: at,
    },
    charge: {
      id: 1 + offset,
      bookingId: null,
      userId: 9,
      type: "charge",
      amount: "100.00",
      currency: "SAR",
      stripeEventId: `evt_topup_${offset}`,
      stripePaymentIntentId: pi,
      stripeChargeId: null,
      metadata: null,
      description: "wallet_topup payment",
      createdAt: at,
    },
    cash: {
      id: 2 + offset,
      bookingId: null,
      userId: 9,
      type: "adjustment",
      amount: "-100.00",
      currency: "SAR",
      stripeEventId: eventId,
      stripePaymentIntentId: pi,
      stripeChargeId: provider.charge,
      metadata: JSON.stringify(evidence),
      description: "Provider dispute funds_withdrawn",
      createdAt: at,
    },
    providerEvent: {
      id: eventId,
      type: evidence.eventType,
      data: JSON.stringify(provider),
      apiVersion: "synthetic",
      processed: true,
      processedAt: at,
      error: null,
      retryCount: 0,
      createdAt: at,
    },
  };
}

beforeEach(() => {
  const rows = sources();
  fixture = transactionMemory({
    users: [
      { id: 9, role: "user", tenantId: 3 },
      { id: 10, role: "finance", tenantId: 3 },
      { id: 11, role: "finance", tenantId: 4 },
      { id: 12, role: "admin", tenantId: null },
      { id: 13, role: "super_admin", tenantId: null },
      { id: 14, role: "ops", tenantId: 3 },
    ],
    wallets: [
      {
        id: 1,
        userId: 9,
        balance: 10000,
        status: "active",
        currency: "SAR",
        createdAt: at,
        updatedAt: at,
      },
    ],
    payment_receipts: [rows.receipt],
    wallet_transactions: [rows.topup],
    financial_ledger: [rows.charge, rows.cash],
    stripe_events: [rows.providerEvent],
    audit_logs: [],
    account_locks: [],
    account_deletion_requests: [],
    outbox: [],
    bookings: [
      {
        id: 7,
        userId: 9,
        status: "confirmed",
        paymentStatus: "paid",
        seatsReserved: true,
      },
    ],
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("Provider calls are forbidden in maintenance");
    })
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("scoped wallet funding maintenance", () => {
  it("previews a stable source digest and projected debit without any writes", async () => {
    const before = snapshot();
    for (const method of ["insert", "update", "delete"])
      vi.spyOn(fixture.db, method).mockImplementation(() => {
        throw new Error("Preview attempted a write");
      });
    const result = await preview();
    expect(result).toMatchObject({
      mode: "preview",
      version: 1,
      scope,
      digest: expect.stringMatching(/^[a-f0-9]{64}$/),
      sourceCounts: {
        receipts: 1,
        topUps: 1,
        ledgerRows: 2,
        walletMovements: 1,
        providerEvents: 1,
      },
      wallet: {
        balanceBefore: 10000,
        projectedBalance: 0,
        statusBefore: "active",
        projectedStatus: "active",
      },
      receipts: [
        {
          paymentIntentId: "pi_legacy",
          appliedLoss: 0,
          fundingLoss: 10000,
          adjustment: -10000,
          eventId: "evt_legacy_0",
        },
      ],
    });
    expect(await preview()).toEqual(result);
    expect(snapshot()).toEqual(before);
    expect(fixture.lockedTables).toHaveLength(0);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("applies only the approved projection, preserves cash evidence and records the actual actor", async () => {
    const result = await preview();
    const before = snapshot();
    const applied = await apply(result.digest);
    expect(applied).toMatchObject({
      mode: "applied",
      digest: result.digest,
      approvalReference: "FIN-APPROVAL-100",
    });
    expect(fixture.rows("wallets")[0]).toMatchObject({
      balance: 0,
      status: "active",
    });
    expect(fixture.rows("wallet_transactions")).toHaveLength(2);
    expect(fixture.rows("wallet_transactions")[1]).toMatchObject({
      type: "withdrawal",
      amount: -10000,
      balanceAfter: 0,
      status: "completed",
    });
    const ledger = fixture.rows("financial_ledger");
    expect(ledger).toHaveLength(2);
    const { metadata, ...cashIdentity } = ledger[1];
    const { metadata: previousMetadata, ...previousIdentity } =
      before.financial_ledger[1];
    expect(cashIdentity).toEqual(previousIdentity);
    expect(JSON.parse(metadata)).toEqual({
      ...JSON.parse(previousMetadata),
      walletFunding: {
        version: 1,
        walletId: 1,
        adjustment: -10000,
        loss: 10000,
      },
    });
    expect(fixture.rows("stripe_events")).toEqual(before.stripe_events);
    expect(fixture.rows("bookings")).toEqual(before.bookings);
    expect(fixture.rows("outbox")).toEqual([]);
    expect(fixture.rows("audit_logs")).toMatchObject([
      {
        eventId: applied.auditEventId,
        eventCategory: "payment",
        outcome: "success",
        userId: 10,
        userRole: "finance",
        resourceType: "wallet",
        resourceId: "1",
        requestId: result.digest,
      },
    ]);
    expect((await preview()).receipts[0].adjustment).toBe(0);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("replays the exact approved command without repeating money or audit effects", async () => {
    const { digest } = await preview();
    const applied = await apply(digest);
    const beforeReplay = snapshot();
    expect(await apply(digest)).toEqual(applied);
    expect(snapshot()).toEqual(beforeReplay);
    fixture.rows("wallets")[0].balance = 5000;
    expect(await apply(digest)).toEqual(applied);
    expect(fixture.rows("wallets")[0].balance).toBe(5000);
    expect(fixture.rows("audit_logs")).toHaveLength(1);
    await expect(apply("0".repeat(64))).rejects.toThrow(
      "already used for a different command"
    );
  });

  it.each([
    [
      "wallet balance",
      () => {
        fixture.rows("wallets")[0].balance = 9000;
      },
    ],
    [
      "wallet status",
      () => {
        fixture.rows("wallets")[0].status = "closed";
      },
    ],
    [
      "original movement",
      () => {
        fixture.rows("wallet_transactions")[0].description =
          "Changed source note";
      },
    ],
    [
      "ledger metadata",
      () => {
        const row = fixture.rows("financial_ledger")[1];
        row.metadata = JSON.stringify({
          ...JSON.parse(row.metadata),
          extra: "changed",
        });
      },
    ],
    [
      "provider metadata",
      () => {
        const row = fixture.rows("stripe_events")[0];
        row.data = JSON.stringify({
          ...JSON.parse(row.data),
          metadata: { changed: true },
        });
      },
    ],
  ])("rejects stale approval after a %s change", async (_label, mutate) => {
    const { digest } = await preview();
    mutate();
    const before = snapshot();
    await expect(apply(digest)).rejects.toThrow("source digest changed");
    expect(snapshot()).toEqual(before);
  });

  it.each([
    {},
    { approvedDigest: "0".repeat(64) },
    { approvalReference: "approval" },
    { approvedDigest: "bad", approvalReference: "approval" },
    { approvedDigest: "0".repeat(64), approvalReference: " " },
  ])(
    "requires an explicit digest and approval reference (%j)",
    async approval => {
      const before = snapshot();
      await expect(
        applyWalletFundingMaintenance(fixture.db, scope, approval)
      ).rejects.toThrow();
      expect(snapshot()).toEqual(before);
    }
  );

  it.each(["audit_logs", "wallet_transactions"])(
    "rolls back the entire approved command when %s insertion fails",
    async table => {
      const { digest } = await preview();
      const before = snapshot();
      fixture.failInsert(table);
      await expect(apply(digest)).rejects.toThrow("Injected insert failure");
      expect(snapshot()).toEqual(before);
    }
  );

  it.each([
    [
      "missing provider event",
      () => {
        fixture.rows("stripe_events").length = 0;
      },
    ],
    [
      "unprocessed provider event",
      () => {
        fixture.rows("stripe_events")[0].processed = false;
      },
    ],
    [
      "provider amount mismatch",
      () => {
        const row = fixture.rows("stripe_events")[0];
        row.data = JSON.stringify({ ...JSON.parse(row.data), amount: 9999 });
      },
    ],
    [
      "provider intent mismatch",
      () => {
        const row = fixture.rows("stripe_events")[0];
        row.data = JSON.stringify({
          ...JSON.parse(row.data),
          payment_intent: "pi_other",
        });
      },
    ],
    [
      "unknown manual debit",
      () => {
        fixture.rows("wallet_transactions").push({
          ...sources().topup,
          id: 101,
          type: "withdrawal",
          amount: -10000,
          description: "Manual disputed funding adjustment",
        });
      },
    ],
    [
      "unmarked prior provider debit",
      () => {
        fixture.rows("wallet_transactions").push({
          ...sources().topup,
          id: 101,
          type: "withdrawal",
          amount: -10000,
          description: "Provider reversed wallet funding",
        });
      },
    ],
    [
      "refund amount mismatch",
      () => {
        fixture.rows("payment_receipts")[0].refundedAmount = 5000;
      },
    ],
    [
      "top-up owner mismatch",
      () => {
        fixture.rows("wallet_transactions")[0].userId = 99;
      },
    ],
    [
      "duplicate event identity",
      () => {
        fixture.rows("financial_ledger").push({ ...sources().cash, id: 3 });
      },
    ],
  ])("fails closed on %s", async (_label, mutate) => {
    mutate();
    const before = snapshot();
    await expect(preview()).rejects.toThrow();
    expect(snapshot()).toEqual(before);
  });

  it("keeps repairs bounded to the chosen receipts and never scans into a blanket backfill", async () => {
    const other = sources("pi_other", 10);
    fixture.rows("payment_receipts").push(other.receipt);
    fixture.rows("wallet_transactions").push(other.topup);
    fixture.rows("financial_ledger").push(other.charge, other.cash);
    fixture.rows("stripe_events").push(other.providerEvent);
    fixture.rows("wallets")[0].balance = 20000;
    const { digest } = await preview();
    await apply(digest);
    expect(fixture.rows("wallets")[0].balance).toBe(10000);
    expect(
      fixture.rows("financial_ledger").find(row => row.id === other.cash.id)
    ).toEqual(other.cash);
    expect(
      fixture
        .rows("wallet_transactions")
        .filter(row => row.type === "withdrawal")
    ).toHaveLength(1);
  });

  it("supports one explicitly approved multi-receipt batch with a deterministic digest", async () => {
    const other = sources("pi_other", 10);
    fixture.rows("payment_receipts").push(other.receipt);
    fixture.rows("wallet_transactions").push(other.topup);
    fixture.rows("financial_ledger").push(other.charge, other.cash);
    fixture.rows("stripe_events").push(other.providerEvent);
    fixture.rows("wallets")[0].balance = 20000;
    const selected = { ...scope, paymentIntentIds: ["pi_other", "pi_legacy"] };
    const planned = await previewWalletFundingMaintenance(fixture.db, selected);
    expect(
      await previewWalletFundingMaintenance(fixture.db, {
        ...selected,
        paymentIntentIds: [...selected.paymentIntentIds].reverse(),
      })
    ).toEqual(planned);
    await applyWalletFundingMaintenance(fixture.db, selected, {
      approvedDigest: planned.digest,
      approvalReference: "FIN-BATCH",
    });
    expect(fixture.rows("wallets")[0]).toMatchObject({
      balance: 0,
      status: "active",
    });
    expect(
      fixture
        .rows("wallet_transactions")
        .filter(row => row.type === "withdrawal")
    ).toHaveLength(2);
    expect(fixture.rows("audit_logs")).toHaveLength(1);
  });

  it.each(
    [
      [],
      ["pi_legacy", "pi_legacy"],
      ["*"],
      Array.from({ length: 26 }, (_, i) => `pi_${i}`),
    ].map(paymentIntentIds => ({ paymentIntentIds }))
  )(
    "rejects an empty, ambiguous or excessive receipt scope (%j)",
    async ({ paymentIntentIds }) => {
      const before = snapshot();
      await expect(
        previewWalletFundingMaintenance(fixture.db, {
          ...scope,
          paymentIntentIds,
        })
      ).rejects.toThrow();
      expect(snapshot()).toEqual(before);
    }
  );

  it("refuses to truncate a receipt's evidence at the review bound", async () => {
    for (let i = 0; i < 200; i++)
      fixture.rows("financial_ledger").push({
        ...sources().cash,
        id: 200 + i,
        amount: "0.00",
        stripeEventId: `evt_status_${i}`,
        metadata: JSON.stringify({
          eventType: "charge.dispute.updated",
          disputeId: "dp_legacy_0",
          status: "under_review",
          reason: "fraudulent",
        }),
      });
    const before = snapshot();
    await expect(preview()).rejects.toThrow("evidence exceeds");
    expect(snapshot()).toEqual(before);
  });

  it("records debt without cancelling already purchased travel or automatically thawing", async () => {
    fixture.rows("wallets")[0].balance = 3000;
    const planned = await preview();
    expect(planned.wallet).toMatchObject({
      projectedBalance: -7000,
      projectedStatus: "frozen",
    });
    const beforeTravel = structuredClone(fixture.rows("bookings"));
    await apply(planned.digest);
    expect(fixture.rows("wallets")[0]).toMatchObject({
      balance: -7000,
      status: "frozen",
    });
    expect(fixture.rows("bookings")).toEqual(beforeTravel);
  });

  it.each(["active", "frozen", "closed"])(
    "restores only proven removed funding while preserving %s status",
    async status => {
      const withdrawn = fixture.rows("financial_ledger")[1];
      withdrawn.metadata = JSON.stringify({
        ...JSON.parse(withdrawn.metadata),
        walletFunding: {
          version: 1,
          walletId: 1,
          adjustment: -10000,
          loss: 10000,
        },
      });
      fixture.rows("wallet_transactions").push({
        ...sources().topup,
        id: 101,
        type: "withdrawal",
        amount: -10000,
        description: "Provider reversed wallet funding",
        balanceAfter: 0,
      });
      fixture.rows("wallets")[0].balance = 0;
      fixture.rows("wallets")[0].status = status;
      const evidence = {
        ...JSON.parse(sources().cash.metadata),
        eventType: "charge.dispute.funds_reinstated",
        status: "won",
      };
      fixture.rows("financial_ledger").push({
        ...sources().cash,
        id: 3,
        amount: "100.00",
        stripeEventId: "evt_reinstated",
        metadata: JSON.stringify(evidence),
      });
      fixture.rows("stripe_events").push({
        ...sources().providerEvent,
        id: "evt_reinstated",
        type: evidence.eventType,
        data: JSON.stringify({
          ...JSON.parse(sources().providerEvent.data),
          status: "won",
        }),
      });
      const planned = await preview();
      expect(planned.receipts[0].adjustment).toBe(10000);
      await apply(planned.digest);
      expect(fixture.rows("wallets")[0]).toMatchObject({
        balance: 10000,
        status,
      });
    }
  );

  it.each([11, 14, 99])(
    "does not turn actor ID %s into a finance-role bypass",
    async actorId => {
      const before = snapshot();
      await expect(
        previewWalletFundingMaintenance(fixture.db, { ...scope, actorId })
      ).rejects.toThrow("current finance actor");
      expect(snapshot()).toEqual(before);
    }
  );
  it.each([12, 13])(
    "retains intended global platform administrator scope (%s)",
    async actorId => {
      const selected = { ...scope, actorId };
      const planned = await previewWalletFundingMaintenance(
        fixture.db,
        selected
      );
      await applyWalletFundingMaintenance(fixture.db, selected, {
        approvedDigest: planned.digest,
        approvalReference: "GLOBAL-APPROVAL",
      });
      expect(fixture.rows("wallets")[0].balance).toBe(0);
      expect(fixture.rows("audit_logs")[0].userId).toBe(actorId);
    }
  );

  it.each([
    [
      "revoked role",
      () => {
        fixture.rows("users")[1].role = "user";
      },
    ],
    [
      "changed tenant",
      () => {
        fixture.rows("users")[1].tenantId = 4;
      },
    ],
    [
      "account lock",
      () => {
        fixture
          .rows("account_locks")
          .push({ id: 1, userId: 10, isActive: true, autoUnlockAt: null });
      },
    ],
    [
      "processed deletion",
      () => {
        fixture
          .rows("account_deletion_requests")
          .push({ id: 1, userId: 10, status: "completed", processedAt: at });
      },
    ],
    [
      "due confirmed deletion",
      () => {
        fixture.rows("account_deletion_requests").push({
          id: 1,
          userId: 10,
          status: "pending",
          confirmedAt: at,
          scheduledDeletionAt: at,
        });
      },
    ],
  ])("rechecks %s before apply and cached replay", async (_label, mutate) => {
    const planned = await preview();
    await apply(planned.digest);
    mutate();
    const before = snapshot();
    await expect(apply(planned.digest)).rejects.toThrow();
    expect(snapshot()).toEqual(before);
  });

  it("allows an expired lock and a cancelled deletion without fabricating actor state", async () => {
    fixture
      .rows("account_locks")
      .push({ id: 1, userId: 10, isActive: true, autoUnlockAt: at });
    fixture
      .rows("account_deletion_requests")
      .push({ id: 1, userId: 10, status: "cancelled", processedAt: at });
    const planned = await preview();
    await apply(planned.digest);
    expect(fixture.rows("wallets")[0].balance).toBe(0);
    expect(fixture.rows("account_locks")[0].isActive).toBe(true);
    expect(fixture.rows("account_deletion_requests")[0].status).toBe(
      "cancelled"
    );
  });

  it("denies a newly locked approval actor before its first apply", async () => {
    const planned = await preview();
    fixture
      .rows("account_locks")
      .push({ id: 1, userId: 10, isActive: true, autoUnlockAt: null });
    const before = snapshot();
    await expect(apply(planned.digest)).rejects.toThrow("actor is locked");
    expect(snapshot()).toEqual(before);
  });

  it("recognizes a legacy refund debit and does not debit consumed principal again", async () => {
    fixture.rows("payment_receipts")[0].refundedAmount = 10000;
    fixture.rows("wallets")[0].balance = 0;
    fixture.rows("financial_ledger").push({
      ...sources().charge,
      id: 3,
      type: "refund",
      stripeEventId: "evt_legacy_refund",
      description: "Verified refund delta",
    });
    fixture.rows("wallet_transactions").push({
      ...sources().topup,
      id: 101,
      type: "withdrawal",
      amount: -10000,
      balanceAfter: 0,
      description: "Provider reversed wallet funding",
    });
    const planned = await preview();
    expect(planned.receipts[0]).toMatchObject({
      appliedLoss: 10000,
      fundingLoss: 10000,
      adjustment: 0,
      eventId: null,
    });
    await apply(planned.digest);
    expect(fixture.rows("wallets")[0]).toMatchObject({
      balance: 0,
      status: "active",
    });
    expect(fixture.rows("wallet_transactions")).toHaveLength(2);
    expect(
      JSON.parse(fixture.rows("financial_ledger")[1].metadata).walletFunding
    ).toBeUndefined();
  });
});

describe("wallet maintenance CLI selection", () => {
  it("defaults to a read-only preview", () => {
    expect(parseWalletFundingMaintenanceArgs(["scope.json"])).toEqual({
      path: "scope.json",
      approval: undefined,
    });
  });
  it("requires exact digest and explicit approval reference together", () => {
    expect(
      parseWalletFundingMaintenanceArgs([
        "scope.json",
        `--apply=${"a".repeat(64)}`,
        "--approval-reference=FIN-100",
      ])
    ).toEqual({
      path: "scope.json",
      approval: {
        approvedDigest: "a".repeat(64),
        approvalReference: "FIN-100",
      },
    });
  });
  it.each(
    [
      [],
      ["scope.json", "--apply"],
      ["scope.json", `--apply=${"a".repeat(64)}`],
      ["scope.json", "--approval-reference=FIN-100"],
      ["scope.json", "--all"],
      ["scope.json", "--apply=bad", "--approval-reference=FIN-100"],
      [
        "scope.json",
        `--apply=${"a".repeat(64)}`,
        `--apply=${"a".repeat(64)}`,
        "--approval-reference=FIN-100",
      ],
    ].map(args => ({ args }))
  )("rejects incomplete or unsupported CLI invocation (%j)", ({ args }) => {
    expect(() => parseWalletFundingMaintenanceArgs(args)).toThrow("Usage:");
  });
});
