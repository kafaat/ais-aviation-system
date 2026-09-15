import assert from "node:assert/strict";
import { eq, sql } from "drizzle-orm";
import { readFileSync } from "node:fs";
import * as s from "../../drizzle/schema";
import type { SettlementTx } from "../../server/services/booking-settlement.service";
import {
  computeBaggageEntitlement,
  listOwnedBaggageEntitlements,
} from "../../server/services/baggage-entitlement.service";

/** Called only by the guarded empty *_test database integration runner. */
export async function verifyBaggageEntitlements(
  db: SettlementTx,
  bookingId: number,
  ownerId: number,
  record: (
    key: string,
    description: string,
    run: () => Promise<unknown>
  ) => Promise<void>
) {
  const [booking] = await db
    .select()
    .from(s.bookings)
    .where(eq(s.bookings.id, bookingId));
  const people = await db
    .select()
    .from(s.passengers)
    .where(eq(s.passengers.bookingId, bookingId));
  assert.equal(people.length, 2);
  const segments = await db
    .insert(s.bookingSegments)
    .values(
      [1, 2].map(segmentOrder => ({
        bookingId,
        flightId: booking.flightId,
        segmentOrder,
        departureDate: new Date("2035-01-01T00:00:00Z"),
        status: "confirmed" as const,
      }))
    )
    .$returningId();
  const [service] = await db
    .insert(s.ancillaryServices)
    .values({
      code: "AUDIT_BAG_STRUCTURED",
      category: "baggage",
      name: "Synthetic baggage",
      weightGrams: 10000,
      price: 5000,
    })
    .$returningId();
  const intent = `pi_baggage_audit_${bookingId}`;
  await db
    .update(s.bookings)
    .set({ stripePaymentIntentId: intent })
    .where(eq(s.bookings.id, bookingId));
  await db.insert(s.paymentReceipts).values({
    paymentIntentId: intent,
    kind: "booking",
    bookingId,
    userId: ownerId,
    targetId: bookingId,
    amount: booking.totalAmount,
    currency: "SAR",
    settlementStatus: "applied",
  });
  const item = {
    bookingId,
    passengerId: people[0].id,
    segmentId: segments[0].id,
    scopeState: "specific_segment" as const,
    ancillaryServiceId: service.id,
    quantity: 1,
    unitPrice: 5000,
    totalPrice: 5000,
    weightSnapshotGrams: 10000,
    fundedAt: new Date(),
    fundingReference: {
      kind: "collected_booking" as const,
      bookingId,
      paymentIntentId: intent,
    },
  };
  const [purchase] = await db
    .insert(s.bookingAncillaries)
    .values(item)
    .$returningId();
  const read = (passengerId = people[0].id, segmentId = segments[0].id) =>
    computeBaggageEntitlement(db, { bookingId, passengerId, segmentId });
  await record(
    "BAG-MYSQL-1",
    "Funded snapshot survives catalog change",
    async () => {
      assert.equal((await read()).totalWeightGrams, 33000);
      await db
        .update(s.ancillaryServices)
        .set({ weightGrams: 99000 })
        .where(eq(s.ancillaryServices.id, service.id));
      assert.equal((await read()).totalWeightGrams, 33000);
      return { totalWeightGrams: 33000, catalogDoesNotRewritePurchase: true };
    }
  );
  await record(
    "BAG-MYSQL-2",
    "Passenger and segment scopes do not share purchased weight",
    async () => {
      assert.equal((await read(people[1].id)).totalWeightGrams, 23000);
      assert.equal(
        (await read(people[0].id, segments[1].id)).totalWeightGrams,
        23000
      );
      await assert.rejects(read(people[0].id, -1), { code: "NOT_FOUND" });
      return { foreignPassengerExcluded: true, otherSegmentExcluded: true };
    }
  );
  await record(
    "BAG-MYSQL-3",
    "Funding timestamp and applied receipt are both required",
    async () => {
      await db
        .update(s.bookingAncillaries)
        .set({ fundedAt: null })
        .where(eq(s.bookingAncillaries.id, purchase.id));
      assert.equal((await read()).totalWeightGrams, 23000);
      assert((await read()).warnings.some(w => w.code === "missing_funding"));
      await db
        .update(s.bookingAncillaries)
        .set({ fundedAt: new Date() })
        .where(eq(s.bookingAncillaries.id, purchase.id));
      await db
        .update(s.paymentReceipts)
        .set({ settlementStatus: "review_required" })
        .where(eq(s.paymentReceipts.paymentIntentId, intent));
      assert.equal((await read()).totalWeightGrams, 23000);
      assert(
        (await read()).warnings.some(w => w.code === "invalid_funding_evidence")
      );
      await db
        .update(s.paymentReceipts)
        .set({ settlementStatus: "applied" })
        .where(eq(s.paymentReceipts.paymentIntentId, intent));
      assert.equal((await read()).totalWeightGrams, 33000);
      return { timestampRequired: true, receiptReviewExcluded: true };
    }
  );
  await record(
    "BAG-MYSQL-4",
    "Cancelled and refunded states exclude a previously proven allowance",
    async () => {
      for (const status of ["cancelled", "refunded"] as const) {
        assert.equal((await read()).totalWeightGrams, 33000);
        await db
          .update(s.bookingAncillaries)
          .set({ status })
          .where(eq(s.bookingAncillaries.id, purchase.id));
        assert.equal((await read()).totalWeightGrams, 23000);
        await db
          .update(s.bookingAncillaries)
          .set({ status: "active" })
          .where(eq(s.bookingAncillaries.id, purchase.id));
      }
      return { statusExclusionOnly: true, financialRefundExecuted: false };
    }
  );
  await record(
    "BAG-MYSQL-5",
    "Ambiguous scope grants no extra allowance",
    async () => {
      await db
        .update(s.bookingAncillaries)
        .set({ scopeState: "unresolved", segmentId: null })
        .where(eq(s.bookingAncillaries.id, purchase.id));
      const result = await read();
      assert.equal(result.totalWeightGrams, 23000);
      assert(result.requiresOperationalReview);
      await db
        .update(s.bookingAncillaries)
        .set({ scopeState: "specific_segment", segmentId: segments[0].id })
        .where(eq(s.bookingAncillaries.id, purchase.id));
      return { unresolvedExcluded: true };
    }
  );
  await record(
    "BAG-MYSQL-REPORT",
    "Inventory separates catalog notes from entitlement deficiencies without writes",
    async () => {
      const query = readFileSync("scripts/audit-baggage-matching.sql", "utf8");
      const summary = readFileSync("scripts/audit-baggage-summary.sql", "utf8");
      const rows = async (queryText: string) => {
        const [result] = await db.execute(sql.raw(queryText));
        return result as unknown as Record<string, unknown>[];
      };
      const list = (value: unknown): string[] =>
        typeof value === "string" ? JSON.parse(value) : (value as string[]);
      const find = async () => {
        const row = (await rows(query)).find(r => r.id === purchase.id);
        assert(row, "Expected inventory row");
        for (const key of ["entitlementReasons", "catalogNotes", "dataNotes"]) {
          assert(Array.isArray(list(row[key])));
          assert(!list(row[key]).includes(null as unknown as string));
        }
        return row;
      };
      await db
        .update(s.ancillaryServices)
        .set({ weightGrams: null })
        .where(eq(s.ancillaryServices.id, service.id));
      await db
        .update(s.bookingAncillaries)
        .set({ metadata: "not-json" })
        .where(eq(s.bookingAncillaries.id, purchase.id));
      const before = await db
        .select()
        .from(s.bookingAncillaries)
        .where(eq(s.bookingAncillaries.id, purchase.id));
      const row = await find();
      assert.deepEqual(list(row.entitlementReasons), []);
      assert.deepEqual(list(row.catalogNotes), ["catalog_weight_undefined"]);
      assert.deepEqual(list(row.dataNotes), ["invalid_legacy_metadata"]);
      assert.equal(row.metadataFlightId, null);
      assert.equal((await read()).totalWeightGrams, 33000);
      const totals = (await rows(summary)).filter(
        r => r.serviceCode === "AUDIT_BAG_STRUCTURED"
      );
      assert.equal(totals.length, 1);
      assert.equal(Number(totals[0].totalItems), 1);
      assert.deepEqual(
        await db
          .select()
          .from(s.bookingAncillaries)
          .where(eq(s.bookingAncillaries.id, purchase.id)),
        before
      );
      for (const [change, reason] of [
        [{ fundingReference: null }, "missing_funding_reference"],
        [{ segmentId: null }, "invalid_specific_segment_scope"],
        [
          { scopeState: "all_segments", segmentId: null },
          "unapproved_all_segments_scope",
        ],
        [{ status: "cancelled" }, "status_not_active"],
        [{ weightSnapshotGrams: 0 }, "invalid_weight_snapshot"],
      ] as const) {
        await db
          .update(s.bookingAncillaries)
          .set(change)
          .where(eq(s.bookingAncillaries.id, purchase.id));
        assert(list((await find()).entitlementReasons).includes(reason));
        await db
          .update(s.bookingAncillaries)
          .set({ ...item, status: "active", metadata: null })
          .where(eq(s.bookingAncillaries.id, purchase.id));
      }
      await db
        .update(s.ancillaryServices)
        .set({ weightGrams: 99000 })
        .where(eq(s.ancillaryServices.id, service.id));
      assert(!(await rows(query)).some(r => r.id === purchase.id));
      return {
        reportsReadOnly: true,
        catalogIsNotPurchaseEvidence: true,
        malformedMetadataHandled: true,
      };
    }
  );
  await record(
    "BAG-MYSQL-6",
    "Business allowance keeps independent piece limit and enforces reader ownership",
    async () => {
      await db
        .update(s.bookings)
        .set({ cabinClass: "business" })
        .where(eq(s.bookings.id, bookingId));
      assert.equal((await read()).totalWeightGrams, 42000);
      assert.equal((await read()).maxBagWeightGrams, 32000);
      const actor = { id: ownerId, role: "user", tenantId: booking.tenantId };
      assert.equal(
        (await listOwnedBaggageEntitlements(db, bookingId, actor)).length,
        4
      );
      await assert.rejects(
        listOwnedBaggageEntitlements(db, bookingId, {
          ...actor,
          id: ownerId + 1,
        }),
        { code: "FORBIDDEN" }
      );
      await assert.rejects(
        listOwnedBaggageEntitlements(db, bookingId, {
          ...actor,
          role: "admin",
          tenantId: -1,
        }),
        { code: "NOT_FOUND" }
      );
      return {
        businessWeightGrams: 42000,
        maximumPieceGrams: 32000,
        tenantAndOwnerChecks: true,
      };
    }
  );
}
