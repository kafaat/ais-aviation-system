import { randomBytes, randomUUID } from "node:crypto";
import { eq, getTableName } from "drizzle-orm";
import { drizzle, type MySql2Database } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import * as schema from "../../drizzle/schema";

const state = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("../db", () => ({ getDb: () => state.db }));
// These are internal funding operations. No provider is contacted by the fixture.
vi.mock("../stripe", () => ({ stripe: {} }));
import { refundInternalFunding } from "../services/internal-refund.service";
import {
  adminAgencyCredit,
  agencyCreditBalance,
  approveAgencyCredit,
  requireCreditDisabledForTransfer,
  reserveAgencyCredit,
} from "../services/agency-credit.service";
import { inventoryTransactionConfig } from "../services/inventory-capacity.service";

const tables = [
  schema.users,
  schema.bookings,
  schema.bookingSegments,
  schema.flights,
  schema.financialLedger,
  schema.wallets,
  schema.walletTransactions,
  schema.userCredits,
  schema.creditUsage,
  schema.corporateAccounts,
  schema.corporateBookings,
  schema.idempotencyRequests,
  schema.seatInventory,
  schema.dcsPassengerStates,
  schema.paymentReceipts,
  schema.bookingModifications,
  schema.orderServiceRefunds,
  schema.outbox,
  schema.bookingStatusHistory,
  schema.ticketCoupons,
  schema.ndcOrders,
  schema.passengers,
  schema.travelAgents,
  schema.agencyCreditTerms,
  schema.agencyCreditObligations,
];
const allowed =
  process.env.AIS_DISPOSABLE_DATABASE === "true" &&
  process.env.NODE_ENV === "test" &&
  Boolean(process.env.DATABASE_URL);
const nativeDescribe = allowed ? describe : describe.skip;
type Tender = "wallet" | "user_credit" | "corporate_credit";

nativeDescribe(
  "financial authorities on isolated native MySQL transactions",
  () => {
    let admin: mysql.Connection | null = null;
    let pool: mysql.Pool | null = null;
    let db: MySql2Database<typeof schema>;
    let databaseName = "";
    let created = false;
    const actorId = 10;
    const owner = { userId: 9, tenantId: 3 };
    const actor = { userId: actorId, tenantId: 3 };
    const departure = new Date("2030-11-20T12:00:00Z");
    const input = (overrides = {}) => ({
      bookingId: 71,
      requestId: randomUUID(),
      amount: 4000,
      approvalReference: "synthetic-native-finance-approval",
      reason: "Approved return to the original funding account",
      cancelItinerary: false,
      ...overrides,
    });

    beforeAll(async () => {
      const url = new URL(process.env.DATABASE_URL!);
      const sourceDatabase = url.pathname.slice(1);
      if (
        !/^[A-Za-z0-9_]+_test$/.test(sourceDatabase) ||
        !["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname)
      )
        throw new Error(
          "Native finance fixtures require a loopback disposable _test database"
        );
      const options = {
        host: url.hostname.replace(/^\[|\]$/g, ""),
        port: Number(url.port || 3306),
        user: decodeURIComponent(url.username),
        password: decodeURIComponent(url.password),
        timezone: "Z",
      };
      databaseName = "ais_finance_" + randomBytes(6).toString("hex");
      if (!/^ais_finance_[0-9a-f]{12}$/.test(databaseName))
        throw new Error("Invalid disposable finance schema identity");
      admin = await mysql.createConnection(options);
      await admin.query(`CREATE DATABASE \`${databaseName}\``);
      created = true;
      // Clone migrated production types, defaults, primary keys, unique keys and
      // indexes. CREATE TABLE LIKE does not copy foreign keys; catalog/restore
      // gates verify those separately. No existing database is written here.
      for (const table of tables) {
        const name = getTableName(table);
        if (!/^[a-z_]+$/.test(name))
          throw new Error("Invalid finance table name");
        await admin.query(
          `CREATE TABLE \`${databaseName}\`.\`${name}\` LIKE \`${sourceDatabase}\`.\`${name}\``
        );
      }
      pool = mysql.createPool({
        ...options,
        database: databaseName,
        connectionLimit: 6,
      });
      db = drizzle(pool, { schema, mode: "default" });
      state.db = db;
      const [settings] = await pool.query<mysql.RowDataPacket[]>(
        "SELECT @@SESSION.sql_mode AS sqlMode"
      );
      expect(String(settings[0]?.sqlMode)).toContain("STRICT_TRANS_TABLES");
      const [engines] = await pool.query<mysql.RowDataPacket[]>(
        "SELECT ENGINE FROM information_schema.tables WHERE TABLE_SCHEMA=? AND TABLE_NAME IN ('bookings','idempotency_requests','wallets','agency_credit_terms','agency_credit_obligations')",
        [databaseName]
      );
      expect(engines).toHaveLength(5);
      expect(engines.every(row => row.ENGINE === "InnoDB")).toBe(true);
    }, 60000);

    afterAll(async () => {
      state.db = null;
      if (pool) await pool.end();
      if (admin) {
        try {
          if (created) await admin.query(`DROP DATABASE \`${databaseName}\``);
        } finally {
          await admin.end();
        }
      }
    });

    beforeEach(async () => {
      for (const table of tables)
        await pool!.query(`TRUNCATE TABLE \`${getTableName(table)}\``);
      await db.insert(schema.users).values([
        { id: 9, openId: "synthetic-finance-owner", tenantId: 3, role: "user" },
        {
          id: actorId,
          openId: "synthetic-finance-approver",
          tenantId: 3,
          role: "finance",
        },
        { id: 11, openId: "synthetic-other-owner", tenantId: 4, role: "user" },
      ]);
      await db.insert(schema.flights).values({
        id: 41,
        tenantId: 3,
        airlineId: 3,
        originId: 1,
        destinationId: 2,
        flightNumber: "SYN041",
        departureTime: departure,
        arrivalTime: new Date("2030-11-20T14:00:00Z"),
        economySeats: 5,
        economyAvailable: 4,
        economyPrice: 10001,
        businessSeats: 0,
        businessAvailable: 0,
        businessPrice: 20000,
      });
      await db.insert(schema.bookings).values({
        ...invoice(71, 10001),
        status: "confirmed",
        paymentStatus: "paid",
        seatsReserved: true,
      });
      await db.insert(schema.bookingSegments).values({
        id: 72,
        bookingId: 71,
        flightId: 41,
        segmentOrder: 1,
        segmentAmount: 10001,
        departureDate: departure,
        seatsReserved: true,
        status: "confirmed",
      });
      await db.insert(schema.wallets).values({
        id: 3,
        userId: 9,
        balance: 4000,
        currency: "SAR",
        status: "active",
      });
      await db.insert(schema.travelAgents).values({
        id: 6,
        ownerUserId: 9,
        agencyName: "Synthetic finance agency",
        iataNumber: "SYNTHETIC006",
        contactName: "Synthetic contact",
        email: "agency@example.invalid",
        phone: "0000000000",
        apiKey: "synthetic-noncredential-key",
        apiSecret: "synthetic-noncredential-hash",
      });
    }, 30000);

    function invoice(
      id: number,
      amount: number
    ): typeof schema.bookings.$inferInsert {
      return {
        id,
        tenantId: 3,
        userId: 9,
        flightId: 41,
        bookingReference: "F" + String(id).padStart(5, "0"),
        pnr: "F" + String(id).padStart(5, "0"),
        cabinClass: "economy",
        numberOfPassengers: 1,
        totalAmount: amount,
        status: "pending",
        paymentStatus: "pending",
        seatsReserved: false,
      };
    }

    async function fund(tender: Tender) {
      const prefix = {
        wallet: "wallet-credit",
        user_credit: "internal-credit",
        corporate_credit: "corporate-credit",
      }[tender];
      await db.insert(schema.financialLedger).values({
        id: 50,
        bookingId: 71,
        userId: 9,
        type: "charge",
        amount: "100.01",
        currency: "SAR",
        stripeEventId: `${prefix}:71`,
        metadata: JSON.stringify({
          tender,
          ...(tender === "corporate_credit" ? { corporateAccountId: 5 } : {}),
        }),
      });
      if (tender === "user_credit") {
        await db.insert(schema.userCredits).values([
          {
            id: 21,
            userId: 9,
            amount: 6000,
            usedAmount: 6000,
            source: "refund",
            expiresAt: new Date("2020-11-01T00:00:00Z"),
          },
          {
            id: 22,
            userId: 9,
            amount: 4001,
            usedAmount: 4001,
            source: "refund",
          },
        ]);
        await db.insert(schema.creditUsage).values([
          { userId: 9, bookingId: 71, userCreditId: 21, amountUsed: 6000 },
          { userId: 9, bookingId: 71, userCreditId: 22, amountUsed: 4001 },
        ]);
      } else if (tender === "corporate_credit") {
        await db.insert(schema.corporateAccounts).values({
          id: 5,
          companyName: "Synthetic corporation",
          taxId: "SYNTHETIC-TAX-005",
          contactName: "Synthetic contact",
          contactEmail: "corporate@example.invalid",
          balance: -10001,
        });
        await db
          .insert(schema.corporateBookings)
          .values({ corporateAccountId: 5, bookingId: 71, bookedByUserId: 9 });
      }
    }

    async function walletBalance() {
      const [row] = await db
        .select()
        .from(schema.wallets)
        .where(eq(schema.wallets.id, 3));
      return row.balance;
    }
    async function approve(limitMinor = 10000) {
      return approveAgencyCredit(
        {
          agencyId: 6,
          expectedTermsId: null,
          limitMinor,
          reason: "Synthetic initial approval",
        },
        actor
      );
    }
    // The real booking caller locks the agency before creating the invoice and
    // reserving the credit obligation. Reproduce that transaction boundary here.
    async function reserve(id: number, amount: number, debtor = owner) {
      return db.transaction(async tx => {
        await tx
          .select()
          .from(schema.travelAgents)
          .where(eq(schema.travelAgents.id, 6))
          .for("update");
        await tx.insert(schema.bookings).values(invoice(id, amount));
        await reserveAgencyCredit(tx, 6, debtor, id, amount);
        return id;
      }, inventoryTransactionConfig);
    }

    it.each<Tender>(["wallet", "user_credit", "corporate_credit"])(
      "commits concurrent identical %s refunds once, then cancels only with the full remainder",
      async tender => {
        await fund(tender);
        const partial = input();
        const [first, duplicate] = await Promise.all([
          refundInternalFunding(partial, actorId),
          refundInternalFunding(partial, actorId),
        ]);
        expect(duplicate).toEqual(first);
        expect(first).toMatchObject({
          amount: 4000,
          remaining: 6001,
          tender,
          cancelled: false,
        });
        expect(await db.select().from(schema.financialLedger)).toHaveLength(2);
        const [stillFunded] = await db
          .select()
          .from(schema.bookings)
          .where(eq(schema.bookings.id, 71));
        expect(stillFunded).toMatchObject({
          status: "confirmed",
          paymentStatus: "paid",
          seatsReserved: true,
        });
        const finalRequest = input({ amount: 6001, cancelItinerary: true });
        const result = await refundInternalFunding(finalRequest, actorId);
        expect(await refundInternalFunding(finalRequest, actorId)).toEqual(
          result
        );
        expect(result).toMatchObject({ remaining: 0, cancelled: true });
        const [cancelled] = await db
          .select()
          .from(schema.bookings)
          .where(eq(schema.bookings.id, 71));
        expect(cancelled).toMatchObject({
          status: "cancelled",
          paymentStatus: "refunded",
          seatsReserved: false,
          totalAmount: 10001,
        });
        const [flight] = await db.select().from(schema.flights);
        expect(flight.economyAvailable).toBe(5);
        const events = await db.select().from(schema.outbox);
        expect(
          events.filter(row => row.eventType === "booking.cancelled")
        ).toHaveLength(1);
        expect(
          events.filter(row => row.eventType === "payment.internal_refunded")
        ).toHaveLength(2);
        expect(await db.select().from(schema.idempotencyRequests)).toHaveLength(
          2
        );
        expect(await db.select().from(schema.financialLedger)).toHaveLength(3);
        if (tender === "wallet") {
          expect(await walletBalance()).toBe(14001);
          expect(
            await db.select().from(schema.walletTransactions)
          ).toHaveLength(2);
        } else if (tender === "corporate_credit") {
          const [account] = await db.select().from(schema.corporateAccounts);
          expect(account.balance).toBe(0);
        } else {
          const lots = await db
            .select()
            .from(schema.userCredits)
            .orderBy(schema.userCredits.id);
          expect(lots.map(row => row.usedAmount)).toEqual([0, 0]);
          expect(lots[0].expiresAt).toEqual(new Date("2020-11-01T00:00:00Z"));
          const usages = await db.select().from(schema.creditUsage);
          expect(usages.reduce((sum, row) => sum + row.amountUsed, 0)).toBe(0);
        }
      }
    );

    it("serializes distinct competing refunds against the remaining original funding", async () => {
      await fund("wallet");
      const results = await Promise.allSettled([
        refundInternalFunding(input({ amount: 6000 }), actorId),
        refundInternalFunding(input({ amount: 6000 }), actorId),
      ]);
      expect(
        results.filter(result => result.status === "fulfilled")
      ).toHaveLength(1);
      const rejection = results.find(result => result.status === "rejected");
      expect(
        rejection?.status === "rejected" && rejection.reason
      ).toMatchObject({ code: "PRECONDITION_FAILED" });
      expect(await walletBalance()).toBe(10000);
      expect(await db.select().from(schema.financialLedger)).toHaveLength(2);
      expect(await db.select().from(schema.walletTransactions)).toHaveLength(1);
      expect(await db.select().from(schema.idempotencyRequests)).toHaveLength(
        1
      );
    });

    it("rolls back wallet, inventory, ledger, outbox and idempotency when native outbox insertion fails", async () => {
      await fund("wallet");
      await pool!.query(
        "CREATE TRIGGER finance_reject_outbox BEFORE INSERT ON outbox FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Synthetic finance outbox failure'"
      );
      const full = input({ amount: 10001, cancelItinerary: true });
      try {
        await expect(refundInternalFunding(full, actorId)).rejects.toThrow();
        expect(await walletBalance()).toBe(4000);
        expect(await db.select().from(schema.financialLedger)).toHaveLength(1);
        expect(await db.select().from(schema.walletTransactions)).toHaveLength(
          0
        );
        expect(await db.select().from(schema.outbox)).toHaveLength(0);
        expect(
          await db.select().from(schema.bookingStatusHistory)
        ).toHaveLength(0);
        expect(await db.select().from(schema.idempotencyRequests)).toHaveLength(
          0
        );
        const [booking] = await db
          .select()
          .from(schema.bookings)
          .where(eq(schema.bookings.id, 71));
        expect(booking).toMatchObject({
          status: "confirmed",
          paymentStatus: "paid",
          seatsReserved: true,
        });
        const [flight] = await db.select().from(schema.flights);
        expect(flight.economyAvailable).toBe(4);
      } finally {
        await pool!.query("DROP TRIGGER finance_reject_outbox");
      }
      // No durable claim from the failed transaction may prevent a safe retry.
      await expect(refundInternalFunding(full, actorId)).resolves.toMatchObject(
        { remaining: 0, cancelled: true }
      );
      expect(await walletBalance()).toBe(14001);
    });

    it("checks replay authorization and payload identity after the original command commits", async () => {
      await fund("wallet");
      const original = input();
      await refundInternalFunding(original, actorId);
      await expect(
        refundInternalFunding({ ...original, amount: 4001 }, actorId)
      ).rejects.toMatchObject({ code: "CONFLICT" });
      await db
        .update(schema.users)
        .set({ tenantId: 4 })
        .where(eq(schema.users.id, actorId));
      await expect(
        refundInternalFunding(original, actorId)
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(await walletBalance()).toBe(8000);
      expect(await db.select().from(schema.financialLedger)).toHaveLength(2);
    });

    it("rejects an unrelated user's ledger refund without crediting the wallet", async () => {
      await fund("wallet");
      await db.insert(schema.financialLedger).values({
        bookingId: 71,
        userId: 11,
        type: "partial_refund",
        amount: "1.00",
        currency: "SAR",
        metadata: JSON.stringify({ tender: "wallet", originalLedgerId: 50 }),
      });
      await expect(
        refundInternalFunding(input(), actorId)
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
      expect(await walletBalance()).toBe(4000);
      expect(await db.select().from(schema.walletTransactions)).toHaveLength(0);
      expect(await db.select().from(schema.idempotencyRequests)).toHaveLength(
        0
      );
    });

    it("approves, idempotently repeats, and enforces an exact agency credit boundary", async () => {
      const first = await approve();
      expect(first).toMatchObject({
        limitMinor: 10000,
        outstandingMinor: 0,
        availableMinor: 10000,
      });
      expect(await approve()).toEqual(first);
      expect(await db.select().from(schema.agencyCreditTerms)).toHaveLength(1);
      await reserve(72, 10000);
      await expect(reserve(73, 1)).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
        message: "Agency credit limit exceeded",
      });
      expect(
        await db
          .select()
          .from(schema.bookings)
          .where(eq(schema.bookings.id, 73))
      ).toHaveLength(0);
      expect(await adminAgencyCredit(6, 3)).toMatchObject({
        outstandingMinor: 10000,
        availableMinor: 0,
      });
      await expect(
        approveAgencyCredit(
          {
            agencyId: 6,
            expectedTermsId: null,
            limitMinor: 20000,
            reason: "Stale approval",
          },
          actor
        )
      ).rejects.toMatchObject({ code: "CONFLICT" });
      await expect(
        approveAgencyCredit(
          {
            agencyId: 6,
            expectedTermsId: first.termsId,
            limitMinor: 9999,
            reason: "Below outstanding",
          },
          actor
        )
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
      expect(await db.select().from(schema.agencyCreditTerms)).toHaveLength(1);
    });

    it("prevents two concurrent agency invoices from overspending the same approved limit", async () => {
      await approve();
      const results = await Promise.allSettled([
        reserve(72, 6000),
        reserve(73, 6000),
      ]);
      expect(
        results.filter(result => result.status === "fulfilled")
      ).toHaveLength(1);
      const rejected = results.find(result => result.status === "rejected");
      expect(rejected?.status === "rejected" && rejected.reason).toMatchObject({
        code: "PRECONDITION_FAILED",
      });
      expect(
        await db.select().from(schema.agencyCreditObligations)
      ).toHaveLength(1);
      expect(await adminAgencyCredit(6, 3)).toMatchObject({
        outstandingMinor: 6000,
        availableMinor: 4000,
      });
      expect(await db.select().from(schema.bookings)).toHaveLength(2);
    });

    it("requires current owner and invoice tenant identities for approved credit", async () => {
      await approve();
      await expect(
        reserve(72, 2000, { userId: 11, tenantId: 3 })
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
      await expect(
        reserve(72, 2000, { userId: 9, tenantId: 4 })
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
      await expect(
        db.transaction(async tx => {
          await tx
            .select()
            .from(schema.travelAgents)
            .where(eq(schema.travelAgents.id, 6))
            .for("update");
          await tx
            .insert(schema.bookings)
            .values({ ...invoice(72, 2000), tenantId: 4 });
          await reserveAgencyCredit(tx, 6, owner, 72, 2000);
        }, inventoryTransactionConfig)
      ).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
        message: "Invoice does not belong to the approved agency credit terms",
      });
      await expect(adminAgencyCredit(6, 4)).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
      expect(
        await db.select().from(schema.agencyCreditObligations)
      ).toHaveLength(0);
      expect(await db.select().from(schema.bookings)).toHaveLength(1);
    });

    it("reduces obligations only by posted SAR charges or cancellation; a refund does not reopen debt", async () => {
      const terms = await approve();
      await reserve(72, 6000);
      await db.insert(schema.financialLedger).values([
        {
          bookingId: 72,
          userId: 9,
          type: "charge",
          amount: "50.00",
          currency: "SAR",
        },
        {
          bookingId: 72,
          userId: 9,
          type: "charge",
          amount: "999.00",
          currency: "USD",
        },
        {
          bookingId: 72,
          userId: 9,
          type: "partial_refund",
          amount: "15.00",
          currency: "SAR",
        },
      ]);
      expect(await adminAgencyCredit(6, 3)).toMatchObject({
        outstandingMinor: 1000,
        availableMinor: 9000,
      });
      await expect(
        approveAgencyCredit(
          {
            agencyId: 6,
            expectedTermsId: terms.termsId,
            limitMinor: null,
            reason: "Disable before transfer",
          },
          actor
        )
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
      await db
        .update(schema.bookings)
        .set({ status: "cancelled" })
        .where(eq(schema.bookings.id, 72));
      expect(await adminAgencyCredit(6, 3)).toMatchObject({
        outstandingMinor: 0,
        availableMinor: 10000,
      });
      await expect(
        db.transaction(tx => requireCreditDisabledForTransfer(tx, 6))
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
      await approveAgencyCredit(
        {
          agencyId: 6,
          expectedTermsId: terms.termsId,
          limitMinor: null,
          reason: "Disable after settlement",
        },
        actor
      );
      await expect(
        db.transaction(tx => requireCreditDisabledForTransfer(tx, 6))
      ).resolves.toBeUndefined();
    });

    it("holds agency credit until the same dispute and payment intent are reinstated", async () => {
      const terms = await approve();
      await reserve(72, 6000);
      const movement = (
        id: string,
        amount: string,
        disputeId: string,
        intent = "pi_synthetic_original"
      ) => ({
        bookingId: 72,
        userId: 9,
        type: "adjustment" as const,
        currency: "SAR",
        amount,
        stripeEventId: id,
        stripePaymentIntentId: intent,
        description: `Provider dispute ${amount.startsWith("-") ? "funds_withdrawn" : "funds_reinstated"}`,
        metadata: JSON.stringify({ disputeId }),
      });
      await db
        .insert(schema.financialLedger)
        .values([
          movement("evt_synthetic_withdrawal", "-10.00", "dp_original"),
          movement("evt_synthetic_other_dispute", "10.00", "dp_unrelated"),
          movement(
            "evt_synthetic_other_intent",
            "10.00",
            "dp_original",
            "pi_synthetic_unrelated"
          ),
        ]);
      expect(await adminAgencyCredit(6, 3)).toMatchObject({
        settlementReview: true,
        availableMinor: 0,
      });
      await expect(reserve(73, 1000)).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
        message: "Agency credit is on hold pending settlement review",
      });
      await expect(
        approveAgencyCredit(
          {
            agencyId: 6,
            expectedTermsId: terms.termsId,
            limitMinor: 20000,
            reason: "Blocked during review",
          },
          actor
        )
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
      await db
        .insert(schema.financialLedger)
        .values(
          movement(
            "evt_synthetic_matching_reinstatement",
            "10.00",
            "dp_original"
          )
        );
      expect(
        await db.transaction(tx => agencyCreditBalance(tx, 6, owner))
      ).toMatchObject({
        settlementReview: false,
        outstandingMinor: 6000,
        availableMinor: 4000,
      });
      await expect(reserve(73, 1000)).resolves.toBe(73);
    });
  }
);
