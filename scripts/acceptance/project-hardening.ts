import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { cancelBooking } from "../../server/services/bookings.service";
import { eq, and } from "drizzle-orm";
import * as s from "../../drizzle/schema";
import type { SettlementTx } from "../../server/services/booking-settlement.service";
import { calculateYield } from "../../server/services/revenue-accounting.service";
import { ingestFlightCost } from "../../server/services/flight-economics-evidence.service";
import { calculateRequestHash } from "../../server/services/idempotency-v2.service";
import { refundInternalFunding } from "../../server/services/internal-refund.service";
import { useCredit } from "../../server/services/voucher.service";
import { payCorporateInvoice } from "../../server/services/corporate-settlement.service";
import {
  generateDataExport,
  processPrivacyRequests,
} from "../../server/services/gdpr.service";
import { openPrivacyDownload } from "../../server/services/privacy-export.service";
import { getFinancialSummary } from "../../server/services/financial-reporting.service";
import { getRefundStats } from "../../server/services/refunds-stats.service";
import {
  evaluateCrewCandidates,
  evaluateCrewDuty,
  ingestCrewRules,
} from "../../server/services/crew-rule.service";

export async function verifyProjectHardening(
  db: SettlementTx,
  seed: number,
  check: (name: string, run: () => Promise<void>) => Promise<void>
) {
  const id = seed + 100000;
  let boundaryIndex = 0;
  const boundaryOwner = id + 99;
  const [template] = await db
    .select()
    .from(s.flights)
    .where(eq(s.flights.id, seed));
  await db.insert(s.users).values([
    { id, openId: `hardening-${id}` },
    { id: id + 1, openId: `hardening-finance-${id}`, role: "admin" },
    { id: boundaryOwner, openId: `hardening-boundaries-${id}` },
  ]);
  await db
    .insert(s.airlines)
    .values({ id, code: "HAA", name: "Synthetic hardening airline" });
  await db.insert(s.flights).values(
    [0, 1].map(n => ({
      ...template,
      id: id + n,
      flightNumber: `HARD${n}`,
      tenantId: null,
      airlineId: id,
      aircraftType: "B737",
      status: "completed" as const,
      departureTime: new Date("2020-01-01T10:00:00Z"),
      arrivalTime: new Date("2020-01-01T12:00:00Z"),
    }))
  );
  await db.insert(s.bookings).values({
    id,
    userId: id,
    flightId: id,
    tenantId: null,
    bookingReference: `HR${String(id).slice(-4)}`,
    pnr: `HR${String(id).slice(-4)}`,
    totalAmount: 98765,
    cabinClass: "economy",
    numberOfPassengers: 2,
    paymentStatus: "paid",
    status: "confirmed",
    seatsReserved: true,
  });
  await db.insert(s.bookingSegments).values(
    [0, 1].map(n => ({
      bookingId: id,
      flightId: id + n,
      segmentOrder: n + 1,
      status: "confirmed" as const,
      departureDate: new Date("2020-01-01T10:00:00Z"),
      segmentAmount: n === 0 ? 50000 : 48765,
      seatsReserved: true,
    }))
  );
  await check(
    "Revenue: every funded leg is counted and missing distance/revenue stay null",
    async () => {
      for (const flightId of [id, id + 1]) {
        const result = await calculateYield(flightId);
        assert(result);
        assert.equal(result.passengerCount, 2);
        assert.equal(result.distanceKm, null);
        assert.equal(result.rpk, null);
        assert.equal(result.totalRevenue, null);
        assert.equal(result.yield, null);
        assert.equal(result.coverage, "missing_evidence");
      }
    }
  );
  await check(
    "Revenue: accepted leg evidence is used once and source revocation removes derived amounts",
    async () => {
      const saved = process.env.AVIATION_SOURCE_REGISTRY;
      const savedKey = process.env.HARDENING_EVIDENCE_KEY;
      const key = "local-hardening-evidence-key-not-for-production";
      process.env.HARDENING_EVIDENCE_KEY = key;
      process.env.AVIATION_SOURCE_REGISTRY = JSON.stringify([
        {
          sourceId: "hardening-cost",
          tenantId: null,
          capabilities: ["flight_cost", "crew_rules"],
          secretEnv: "HARDENING_EVIDENCE_KEY",
          validUntil: "2099-01-01T00:00:00Z",
          airlineIds: [id],
        },
      ]);
      try {
        const e = {
          sourceId: "hardening-cost",
          eventId: `cost-${id}`,
          issuedAt: new Date().toISOString(),
          observedAt: new Date().toISOString(),
          kind: "flight_cost",
          flightId: id + 1,
          payload: {
            version: "synthetic-v1",
            reference: "local-fixture",
            currency: "SAR",
            periodClosed: true,
            routeDistanceKm: 321,
            costs: {
              fuel: 1,
              crew: 1,
              maintenance: 1,
              airport: 1,
              navigation: 1,
              insurance: 1,
              overhead: 1,
            },
            recognizedRevenueMinor: 6420,
          },
        };
        await ingestFlightCost(
          e,
          createHmac("sha256", key)
            .update(calculateRequestHash(e))
            .digest("hex")
        );
        const result = await calculateYield(id + 1);
        assert(result);
        assert.equal(result.distanceKm, 321);
        assert.equal(result.totalRevenue, 6420);
        assert.equal(result.rpk, 642);
        assert.equal(result.yield, 10);
        assert.equal(result.coverage, "available");
        await check(
          "Crew: a batch uses two reads and matches individual duty/qualification decisions",
          async () => {
            const proposed = {
              departureTime: new Date("2030-01-01T10:00:00Z"),
              arrivalTime: new Date("2030-01-01T12:00:00Z"),
              tenantId: null,
              aircraftType: "B737",
            };
            const rule = {
              sourceId: "hardening-cost",
              eventId: `crew-${id}`,
              issuedAt: new Date().toISOString(),
              observedAt: new Date().toISOString(),
              kind: "crew_rules",
              flightId: null,
              payload: {
                airlineId: id,
                version: "synthetic-1",
                reference: "https://example.invalid/fixture",
                effectiveFrom: "2020-01-01T00:00:00Z",
                effectiveTo: "2090-01-01T00:00:00Z",
                timeZone: "UTC",
                aircraftTypes: ["B737"],
                reportBeforeMinutes: 30,
                releaseAfterMinutes: 15,
                maxDuty24Minutes: 600,
                maxDuty7DayMinutes: 3000,
                minRestMinutes: 600,
                minimumCrew: {
                  captain: 1,
                  first_officer: 1,
                  purser: 1,
                  cabin_crew: 2,
                },
                fdpBands: [
                  {
                    startHour: 0,
                    endHour: 24,
                    minSegments: 1,
                    maxSegments: 4,
                    maxMinutes: 600,
                  },
                ],
              },
            };
            await ingestCrewRules(
              rule,
              createHmac("sha256", key)
                .update(calculateRequestHash(rule))
                .digest("hex"),
              id + 1,
              null
            );
            await db.insert(s.crewMembers).values(
              Array.from({ length: 20 }, (_, n) => ({
                id: id + n,
                employeeId: `HC-${n}`,
                airlineId: id,
                firstName: "Synthetic",
                lastName: String(n),
                role: "captain" as const,
                qualifiedAircraft: n === 19 ? "[]" : '["B737"]',
                status: "active" as const,
                medicalExpiry: new Date("2037-01-01"),
                licenseExpiry: new Date("2037-01-01"),
              }))
            );
            const candidates = await db
              .select()
              .from(s.crewMembers)
              .where(eq(s.crewMembers.airlineId, id));
            await db.insert(s.flights).values([
              {
                ...template,
                id: id + 10,
                airlineId: id,
                flightNumber: "HDCONFLICT",
                departureTime: new Date("2030-01-01T08:00:00Z"),
                arrivalTime: new Date("2030-01-01T10:30:00Z"),
              },
              {
                ...template,
                id: id + 11,
                airlineId: id,
                flightNumber: "HDREST",
                departureTime: new Date("2029-12-31T22:00:00Z"),
                arrivalTime: new Date("2030-01-01T01:00:00Z"),
              },
            ]);
            await db.insert(s.crewAssignments).values([
              {
                flightId: id + 10,
                crewMemberId: id,
                role: "captain",
                assignedBy: id + 1,
                dutyStartTime: new Date("2030-01-01T07:30:00Z"),
                dutyEndTime: new Date("2030-01-01T10:45:00Z"),
              },
              {
                flightId: id + 11,
                crewMemberId: id + 1,
                role: "captain",
                assignedBy: id + 1,
                dutyStartTime: new Date("2029-12-31T21:30:00Z"),
                dutyEndTime: new Date("2030-01-01T01:15:00Z"),
              },
            ]);
            let reads = 0;
            const counted = new Proxy(db, {
              get(target, prop, receiver) {
                if (prop === "select")
                  return (...args: unknown[]) => {
                    reads++;
                    return Reflect.apply(target.select, target, args);
                  };
                return Reflect.get(target, prop, receiver);
              },
            });
            const batch = await evaluateCrewCandidates(
              counted,
              candidates,
              proposed
            );
            assert.equal(reads, 2);
            assert.equal(batch.length, 20);
            assert.equal(batch.filter(c => c.compliant).length, 17);
            assert.deepEqual(
              batch.find(c => c.crewMemberId === id)?.conflicts,
              ["HDCONFLICT"]
            );
            assert.equal(
              batch.find(c => c.crewMemberId === id + 1)?.dutyHours,
              1.25
            );
            for (const candidate of candidates.filter(c =>
              [id, id + 1, id + 2, id + 19].includes(c.id)
            )) {
              const single = await evaluateCrewDuty(db, candidate.id, proposed);
              const grouped = batch.find(c => c.crewMemberId === candidate.id);
              assert.deepEqual(grouped?.violations, single.violations);
              assert.equal(grouped?.compliant, single.compliant);
            }
          }
        );
        process.env.AVIATION_SOURCE_REGISTRY = "[]";
        const revoked = await calculateYield(id + 1);
        assert.equal(revoked?.coverage, "unavailable_source");
        assert.equal(revoked?.totalRevenue, null);
        assert.equal(revoked?.distanceKm, null);
      } finally {
        if (saved === undefined) delete process.env.AVIATION_SOURCE_REGISTRY;
        else process.env.AVIATION_SOURCE_REGISTRY = saved;
        if (savedKey === undefined) delete process.env.HARDENING_EVIDENCE_KEY;
        else process.env.HARDENING_EVIDENCE_KEY = savedKey;
      }
    }
  );
  await check(
    "Internal refunds: scoped approval, concurrent replay, partial restoration and full cancellation conserve credit and cash",
    async () => {
      const flightId = id + 2,
        bookingId = id + 2;
      await db.insert(s.flights).values({
        ...template,
        id: flightId,
        flightNumber: "HARD2",
        status: "scheduled",
        departureTime: new Date("2035-01-01T10:00:00Z"),
        arrivalTime: new Date("2035-01-01T12:00:00Z"),
        economyAvailable: 10,
      });
      await db.insert(s.bookings).values({
        id: bookingId,
        userId: id,
        flightId,
        bookingReference: "HRREF1",
        pnr: "HRREF1",
        totalAmount: 10000,
        cabinClass: "economy",
        numberOfPassengers: 1,
      });
      const [credit] = await db
        .insert(s.userCredits)
        .values({ userId: id, amount: 10000, source: "promo" });
      await useCredit(id, 10000, bookingId);
      const command = {
        bookingId,
        amount: 3000,
        requestId: "c326dfe6-51af-4867-93de-ec5eec062231",
        approvalReference: "synthetic-finance-approval",
        reason: "Synthetic partial refund",
        cancelItinerary: false,
      };
      await assert.rejects(refundInternalFunding(command, id), /FORBIDDEN/);
      const before = await getFinancialSummary();
      const cashBefore = await getRefundStats();
      const replies = await Promise.all([
        refundInternalFunding(command, id + 1),
        refundInternalFunding(command, id + 1),
      ]);
      assert.equal(replies[0].ledgerId, replies[1].ledgerId);
      assert.equal(replies[0].remaining, 7000);
      const [partial] = await db
        .select()
        .from(s.userCredits)
        .where(eq(s.userCredits.id, credit.insertId));
      assert.equal(partial.usedAmount, 7000);
      await assert.rejects(
        refundInternalFunding({ ...command, amount: 4000 }, id + 1),
        /different payload/
      );
      const full = await refundInternalFunding(
        {
          ...command,
          amount: 7000,
          requestId: "c326dfe6-51af-4867-93de-ec5eec062232",
          cancelItinerary: true,
        },
        id + 1
      );
      assert.equal(full.remaining, 0);
      const [booking] = await db
        .select()
        .from(s.bookings)
        .where(eq(s.bookings.id, bookingId));
      assert.equal(booking.paymentStatus, "refunded");
      assert.equal(booking.status, "cancelled");
      assert.equal(booking.seatsReserved, false);
      const [flight] = await db
        .select()
        .from(s.flights)
        .where(eq(s.flights.id, flightId));
      assert.equal(flight.economyAvailable, 10);
      const usages = await db
        .select()
        .from(s.creditUsage)
        .where(eq(s.creditUsage.bookingId, bookingId));
      assert.equal(
        usages.reduce((sum, u) => sum + u.amountUsed, 0),
        0
      );
      const after = await getFinancialSummary();
      assert.equal(after.refundedAmount, before.refundedAmount);
      assert.equal(after.netCollectedAmount, before.netCollectedAmount);
      assert.equal(
        after.nonCashRefundedAmount - before.nonCashRefundedAmount,
        10000
      );
      const cashAfter = await getRefundStats();
      assert.equal(
        cashAfter.totalRefundedAmount,
        cashBefore.totalRefundedAmount
      );
      assert.equal(cashAfter.totalRefunds, cashBefore.totalRefunds);
    }
  );
  for (const scenario of [
    { name: "below limit", amount: 3000, count: 2, total: 6000 },
    {
      name: "exact limit without cancellation",
      amount: 5000,
      count: 1,
      total: 5000,
    },
    { name: "above limit", amount: 6000, count: 1, total: 6000 },
    { name: "two units above limit", amount: 5001, count: 1, total: 5001 },
    {
      name: "same command replay",
      amount: 5000,
      count: 2,
      total: 5000,
      replay: true,
    },
    {
      name: "owner cancellation conflicts with partial refund",
      amount: 3000,
      count: 1,
      total: 3000,
      cancel: true,
    },
  ]) {
    await check(`Refund boundaries: ${scenario.name}`, async () => {
      const bookingId = id + 100 + boundaryIndex++;
      await db.insert(s.flights).values({
        ...template,
        id: bookingId,
        flightNumber: `BOUND${boundaryIndex}`,
        status: "scheduled",
        departureTime: new Date("2035-01-01T10:00:00Z"),
        arrivalTime: new Date("2035-01-01T12:00:00Z"),
        economyAvailable: 10,
      });
      await db.insert(s.bookings).values({
        id: bookingId,
        userId: boundaryOwner,
        flightId: bookingId,
        bookingReference: `BOUND${boundaryIndex}`,
        pnr: `BOUND${boundaryIndex}`,
        totalAmount: 10000,
        cabinClass: "economy",
        numberOfPassengers: 1,
      });
      await db.insert(s.bookingSegments).values({
        bookingId,
        flightId: bookingId,
        segmentOrder: 1,
        departureDate: new Date("2035-01-01T10:00:00Z"),
        segmentAmount: 10000,
        status: "confirmed",
        seatsReserved: false,
      });
      await db
        .insert(s.userCredits)
        .values({ userId: boundaryOwner, amount: 10000, source: "promo" });
      await useCredit(boundaryOwner, 10000, bookingId);
      const command = {
        bookingId,
        amount: scenario.amount,
        requestId: randomUUID(),
        approvalReference: "synthetic-boundary-approval",
        reason: "Synthetic boundary refund",
        cancelItinerary: false,
      };
      const started = performance.now();
      const results = await Promise.allSettled([
        refundInternalFunding(command, id + 1),
        scenario.cancel
          ? cancelBooking(bookingId, boundaryOwner)
          : refundInternalFunding(
              {
                ...command,
                requestId: scenario.replay ? command.requestId : randomUUID(),
              },
              id + 1
            ),
      ]);
      assert(
        performance.now() - started < 10000,
        "Concurrent commands exceeded 10 seconds"
      );
      assert.equal(
        results.filter(r => r.status === "fulfilled").length,
        scenario.count
      );
      for (const result of results) {
        if (result.status === "rejected") {
          assert(result.reason instanceof TRPCError);
          assert.equal(result.reason.code, "PRECONDITION_FAILED");
        }
      }
      if (scenario.replay) {
        assert.deepEqual(results[0], results[1]);
      }
      const ledger = await db
        .select()
        .from(s.financialLedger)
        .where(eq(s.financialLedger.bookingId, bookingId));
      const refunds = ledger.filter(row =>
        ["refund", "partial_refund"].includes(row.type)
      );
      assert.equal(refunds.length, scenario.replay ? 1 : scenario.count);
      assert.equal(
        refunds.reduce(
          (sum, row) => sum + Math.round(Number(row.amount) * 100),
          0
        ),
        scenario.total
      );
      const usage = await db
        .select()
        .from(s.creditUsage)
        .where(eq(s.creditUsage.bookingId, bookingId));
      assert.equal(
        usage.reduce((sum, row) => sum + row.amountUsed, 0),
        10000 - scenario.total
      );
      const [booking] = await db
        .select()
        .from(s.bookings)
        .where(eq(s.bookings.id, bookingId));
      const [segment] = await db
        .select()
        .from(s.bookingSegments)
        .where(eq(s.bookingSegments.bookingId, bookingId));
      const [flight] = await db
        .select()
        .from(s.flights)
        .where(eq(s.flights.id, bookingId));
      assert.equal(booking.status, "confirmed");
      assert.equal(booking.paymentStatus, "paid");
      assert.equal(booking.seatsReserved, true);
      assert.equal(segment.status, "confirmed");
      assert.equal(segment.seatsReserved, true);
      assert.equal(flight.economyAvailable, 9);
      // Exhausting the remaining funding requires an explicit cancellation.
      await refundInternalFunding(
        {
          ...command,
          requestId: randomUUID(),
          amount: 10000 - scenario.total,
          cancelItinerary: true,
        },
        id + 1
      );
      const [cancelled] = await db
        .select()
        .from(s.bookings)
        .where(eq(s.bookings.id, bookingId));
      const [released] = await db
        .select()
        .from(s.flights)
        .where(eq(s.flights.id, bookingId));
      assert.equal(cancelled.status, "cancelled");
      assert.equal(cancelled.seatsReserved, false);
      assert.equal(released.economyAvailable, 10);
      const [cancelledSegment] = await db
        .select()
        .from(s.bookingSegments)
        .where(eq(s.bookingSegments.bookingId, bookingId));
      assert.equal(cancelledSegment.status, "cancelled");
      assert.equal(cancelledSegment.seatsReserved, false);
    });
  }
  await check(
    "Internal refunds: corporate exposure is restored once and foreign finance is rejected",
    async () => {
      const bookingId = id + 3,
        flightId = id + 2;
      await db.insert(s.users).values({
        id: id + 3,
        openId: `foreign-finance-${id}`,
        role: "finance",
        tenantId: 777,
      });
      await db.insert(s.corporateAccounts).values({
        id,
        companyName: "Synthetic company",
        taxId: `HARD-${id}`,
        contactName: "Synthetic",
        contactEmail: "fixture@example.invalid",
        status: "active",
        creditLimit: 10000,
        balance: 0,
      });
      await db.insert(s.corporateUsers).values({
        corporateAccountId: id,
        userId: id,
        role: "booker",
        isActive: true,
      });
      await db.insert(s.bookings).values({
        id: bookingId,
        userId: id,
        flightId,
        bookingReference: "HRREF2",
        pnr: "HRREF2",
        totalAmount: 10000,
        cabinClass: "economy",
        numberOfPassengers: 1,
      });
      await db.insert(s.corporateBookings).values({
        corporateAccountId: id,
        bookingId,
        bookedByUserId: id,
        approvalStatus: "approved",
      });
      await payCorporateInvoice(bookingId, id);
      const command = {
        bookingId,
        amount: 10000,
        requestId: "c326dfe6-51af-4867-93de-ec5eec062233",
        approvalReference: "Synthetic approval",
        reason: "Synthetic corporate refund",
        cancelItinerary: true,
      };
      await assert.rejects(refundInternalFunding(command, id + 3), /FORBIDDEN/);
      const receipts = await Promise.all([
        refundInternalFunding(command, id + 1),
        refundInternalFunding(command, id + 1),
      ]);
      assert.equal(receipts[0].ledgerId, receipts[1].ledgerId);
      const [company] = await db
        .select()
        .from(s.corporateAccounts)
        .where(eq(s.corporateAccounts.id, id));
      assert.equal(company.balance, 0);
      const [booking] = await db
        .select()
        .from(s.bookings)
        .where(eq(s.bookings.id, bookingId));
      assert.equal(booking.paymentStatus, "refunded");
      assert.equal(booking.status, "cancelled");
    }
  );
  await check(
    "Privacy: keyset export above 16 MiB streams every row and preserves UTF-8 across chunk boundaries",
    async () => {
      const comment = "مراجعة ".repeat(4500);
      for (let start = 0; start < 320; start += 20) {
        const fixtures = Array.from({ length: 20 }, (_, n) => ({
          ...template,
          id: id + 1000 + start + n,
          flightNumber: `HP${start + n}`,
          tenantId: null,
        }));
        await db.insert(s.flights).values(fixtures);
        await db.insert(s.flightReviews).values(
          fixtures.map(f => ({
            userId: id,
            flightId: f.id,
            rating: 4,
            comment,
          }))
        );
      }
      const [request] = await db
        .insert(s.dataExportRequests)
        .values({ userId: id, format: "json" });
      const results = await Promise.all([
        generateDataExport(request.insertId),
        generateDataExport(request.insertId),
      ]);
      assert(
        results.every(r => r.success),
        JSON.stringify(results)
      );
      const file = await openPrivacyDownload(id, request.insertId);
      assert(file.size && file.size > 16 * 1024 * 1024);
      const bytes: Buffer[] = [];
      for await (const chunk of file.content()) {
        assert(chunk.length <= 64 * 1024);
        bytes.push(chunk);
      }
      const document = JSON.parse(Buffer.concat(bytes).toString("utf8"));
      assert.equal(document.reviews.length, 320);
      assert(
        document.reviews.every(
          (r: { comment: string }) => r.comment === comment
        )
      );
      assert.equal(document.bookings.length, 3);
      await assert.rejects(
        openPrivacyDownload(id + 1, request.insertId),
        /not found/
      );
      const [chunk] = await db
        .select()
        .from(s.privacyExportChunks)
        .where(
          and(
            eq(s.privacyExportChunks.requestId, request.insertId),
            eq(s.privacyExportChunks.part, 1)
          )
        );
      await db
        .update(s.privacyExportChunks)
        .set({ content: Buffer.from("altered").toString("base64") })
        .where(eq(s.privacyExportChunks.id, chunk.id));
      await assert.rejects(async () => {
        for await (const bytes of (
          await openPrivacyDownload(id, request.insertId)
        ).content())
          void bytes;
      }, /integrity/);
      await db
        .update(s.privacyExportChunks)
        .set({ content: chunk.content, expiresAt: new Date("2020-01-01") })
        .where(eq(s.privacyExportChunks.requestId, request.insertId));
      await db
        .update(s.privacyExportArtifacts)
        .set({ expiresAt: new Date("2020-01-01") })
        .where(eq(s.privacyExportArtifacts.requestId, request.insertId));
      await db
        .update(s.dataExportRequests)
        .set({ downloadExpiresAt: new Date("2020-01-01") })
        .where(eq(s.dataExportRequests.id, request.insertId));
      await assert.rejects(
        openPrivacyDownload(id, request.insertId),
        /not found/
      );
      // Cleanup may also report unrelated retention-review requests; expired data still must be removed.
      await processPrivacyRequests().catch(() => {});
      assert.equal(
        (
          await db
            .select()
            .from(s.privacyExportChunks)
            .where(eq(s.privacyExportChunks.requestId, request.insertId))
        ).length,
        0
      );
    }
  );
}
