import { updateFlightStatus } from "../../server/services/flight-status.service";
import {
  getRevenueDashboard,
  getRefundImpact,
} from "../../server/services/revenue-accounting.service";
import {
  cancelBookingResources,
  type SettlementTx,
} from "../../server/services/booking-settlement.service";
import { reserveBookingCheckout } from "../../server/services/booking-checkout.service";
import { payCorporateInvoice } from "../../server/services/corporate-settlement.service";
import {
  inviteCorporateUser,
  acceptCorporateInvitation,
} from "../../server/services/corporate-invitations.service";
import {
  createClaim,
  processClaim,
  autoAssessEligibility,
  getCompensationStats,
} from "../../server/services/compensation.service";
import {
  getShareableItinerary,
  processAutoCheckIns,
  setAutoCheckIn,
} from "../../server/services/travel-scenarios.service";
import { getFlightAPISStatus } from "../../server/services/apis.service";
import { getFinancialSummary } from "../../server/services/financial-reporting.service";
import { transitionFlight } from "../../server/services/flight-state.service";
import { configuredOnCallProvider } from "../../server/integrations/on-call";
import assert from "node:assert/strict";
import { and, eq } from "drizzle-orm";
import * as s from "../../drizzle/schema";
import { applyVoucher, useCredit } from "../../server/services/voucher.service";
import { createPriceLock } from "../../server/services/price-lock.service";
import {
  approveCorporateBooking,
  rejectCorporateBooking,
  addUserToCorporate,
  createCorporateBooking,
} from "../../server/services/corporate.service";
import {
  exportUserData,
  generateDataExport,
  downloadDataExport,
  withdrawAllConsent,
  processAccountDeletion,
} from "../../server/services/gdpr.service";
import {
  recordConsent,
  getMyConsent,
} from "../../server/services/consent.service";
import { mobileAuthServiceV2 } from "../../server/services/mobile-auth-v2.service";
import {
  getStationWeather,
  ingestReports,
  recordStationMapping,
} from "../../server/services/aviation-weather.service";
import { refreshWeatherOperations } from "../../server/services/weather-operations.service";
import { decodeMetar } from "../../server/integrations/aviation-weather";
import { deliverDispatch } from "../../server/services/on-call.service";

export async function verifyAuditGapClosure(
  db: SettlementTx,
  seed: number,
  check: (name: string, run: () => Promise<void>) => Promise<void>
) {
  const id = seed + 30000;
  await db.insert(s.users).values(
    [0, 1, 2].map(n => ({
      id: id + n,
      openId: `audit-closure-${id + n}`,
      email: `fixture-${n}@example.invalid`,
      role: "user" as const,
    }))
  );
  const [template] = await db
    .select()
    .from(s.flights)
    .where(eq(s.flights.id, seed));
  await db.insert(s.flights).values(
    [0, 1, 2].map(n => ({
      ...template,
      status: "scheduled" as const,
      id: id + n,
      flightNumber: `AC00${n}`,
      economyAvailable: n === 2 ? 0 : 10,
      departureTime: new Date("2035-01-01T10:00:00Z"),
      arrivalTime: new Date("2035-01-01T12:00:00Z"),
    }))
  );
  async function booking(n: number, owner = id, amount = 8000, flight = id) {
    await db.insert(s.bookings).values({
      id: id + n,
      userId: owner,
      flightId: flight,
      bookingReference: `AC${String(n).padStart(4, "0")}`,
      pnr: `AC${String(n).padStart(4, "0")}`,
      totalAmount: amount,
      numberOfPassengers: 1,
      cabinClass: "economy",
    });
    return id + n;
  }
  await db
    .insert(s.userCredits)
    .values({ userId: id, amount: 10000, source: "promo" });
  const first = await booking(0),
    second = await booking(1);
  await check(
    "F02: competing bookings cannot spend beyond one credit balance; invoice and ledger agree",
    async () => {
      const outcomes = await Promise.allSettled([
        useCredit(id, 8000, first),
        useCredit(id, 8000, second),
      ]);
      assert.equal(
        outcomes.filter(o => o.status === "fulfilled").length,
        1,
        outcomes
          .filter(o => o.status === "rejected")
          .map(o => String(o.reason))
          .join("; ")
      );
      const used = await db
        .select()
        .from(s.creditUsage)
        .where(eq(s.creditUsage.userId, id));
      const credits = await db
        .select()
        .from(s.userCredits)
        .where(eq(s.userCredits.userId, id));
      assert.equal(
        used.reduce((n, u) => n + u.amountUsed, 0),
        8000
      );
      assert.equal(
        credits.reduce((n, c) => n + c.usedAmount, 0),
        8000
      );
      const paid = used[0].bookingId;
      const [invoice] = await db
        .select()
        .from(s.bookings)
        .where(eq(s.bookings.id, paid));
      assert.equal(invoice.paymentStatus, "paid");
      assert.equal(invoice.seatsReserved, true);
      await useCredit(id, 8000, paid);
      assert.equal(
        (
          await db
            .select()
            .from(s.creditUsage)
            .where(eq(s.creditUsage.userId, id))
        ).length,
        used.length
      );
      assert.equal(
        (
          await db
            .select()
            .from(s.financialLedger)
            .where(
              eq(s.financialLedger.stripeEventId, `internal-credit:${paid}`)
            )
        ).length,
        1
      );
    }
  );
  await check(
    "F01: failed inventory settlement rolls back every credit debit",
    async () => {
      const failedBooking = await booking(2, id, 1000, id + 2);
      await assert.rejects(useCredit(id, 1000, failedBooking));
      assert.equal(
        (
          await db
            .select()
            .from(s.creditUsage)
            .where(eq(s.creditUsage.bookingId, failedBooking))
        ).length,
        0
      );
      const [credit] = await db
        .select()
        .from(s.userCredits)
        .where(eq(s.userCredits.userId, id));
      assert.equal(credit.usedAmount, 8000);
    }
  );
  const voucherA = await booking(3, id, 10000),
    voucherB = await booking(4, id + 1, 10000);
  await db.insert(s.vouchers).values({
    code: `AUDIT${id}`,
    type: "fixed",
    value: 1000,
    maxUses: 1,
    validFrom: new Date("2020-01-01"),
    validUntil: new Date("2035-01-01"),
  });
  await check(
    "F04: foreign voucher and credit commands write nothing",
    async () => {
      await assert.rejects(
        applyVoucher(`AUDIT${id}`, voucherA, id + 1, 1),
        /Owned booking/
      );
      await assert.rejects(useCredit(id + 1, 10000, voucherA), /Owned booking/);
      assert.equal(
        (
          await db
            .select()
            .from(s.voucherUsage)
            .where(eq(s.voucherUsage.bookingId, voucherA))
        ).length,
        0
      );
    }
  );
  await check(
    "F03/F01: last voucher quota has one winner and the server invoice determines discount",
    async () => {
      const outcomes = await Promise.allSettled([
        applyVoucher(`AUDIT${id}`, voucherA, id, 1),
        applyVoucher(`AUDIT${id}`, voucherB, id + 1, 999999),
      ]);
      assert.equal(outcomes.filter(o => o.status === "fulfilled").length, 1);
      const [voucher] = await db
        .select()
        .from(s.vouchers)
        .where(eq(s.vouchers.code, `AUDIT${id}`));
      const usage = await db
        .select()
        .from(s.voucherUsage)
        .where(eq(s.voucherUsage.voucherId, voucher.id));
      assert.equal(voucher.usedCount, 1);
      assert.equal(usage.length, 1);
      assert.equal(usage[0].discountApplied, 1000);
      const [invoice] = await db
        .select()
        .from(s.bookings)
        .where(eq(s.bookings.id, usage[0].bookingId));
      assert.equal(invoice.totalAmount, 9000);
      await applyVoucher(voucher.code, invoice.id, invoice.userId, 500);
      const [again] = await db
        .select()
        .from(s.vouchers)
        .where(eq(s.vouchers.id, voucher.id));
      assert.equal(again.usedCount, 1);
    }
  );
  await check(
    "F01/F03: unpaid cancellation releases voucher quota exactly once and retains history",
    async () => {
      const [voucher] = await db
        .select()
        .from(s.vouchers)
        .where(eq(s.vouchers.code, `AUDIT${id}`));
      const [usage] = await db
        .select()
        .from(s.voucherUsage)
        .where(eq(s.voucherUsage.voucherId, voucher.id));
      for (let attempt = 0; attempt < 2; attempt++)
        await db.transaction(async tx => {
          const [invoice] = await tx
            .select()
            .from(s.bookings)
            .where(eq(s.bookings.id, usage.bookingId))
            .for("update");
          await cancelBookingResources(
            tx,
            invoice,
            "Synthetic unpaid cancellation"
          );
        });
      const [released] = await db
        .select()
        .from(s.voucherUsage)
        .where(eq(s.voucherUsage.id, usage.id));
      assert(released.releasedAt);
      const [quota] = await db
        .select()
        .from(s.vouchers)
        .where(eq(s.vouchers.id, voucher.id));
      assert.equal(quota.usedCount, 0);
      await assert.rejects(
        applyVoucher(voucher.code, usage.bookingId, usage.userId, 1),
        /released/
      );
      const next = await booking(8, usage.userId, 10000);
      await applyVoucher(voucher.code, next, usage.userId, 1);
      const [reused] = await db
        .select()
        .from(s.vouchers)
        .where(eq(s.vouchers.id, voucher.id));
      assert.equal(reused.usedCount, 1);
    }
  );
  await check(
    "F20: concurrent price holds replay one active row; expired hold permits replacement",
    async () => {
      const results = await Promise.all([
        createPriceLock(id, id + 1, "economy"),
        createPriceLock(id, id + 1, "economy"),
      ]);
      assert.equal(results[0].lock.id, results[1].lock.id);
      await db
        .update(s.priceLocks)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(s.priceLocks.id, results[0].lock.id));
      const replacement = await createPriceLock(id, id + 1, "economy");
      assert.notEqual(replacement.lock.id, results[0].lock.id);
      assert.equal(replacement.alreadyExists, false);
    }
  );
  await db.insert(s.corporateAccounts).values({
    id,
    companyName: "Fixture company",
    taxId: `AUDIT-${id}`,
    contactName: "Fixture",
    contactEmail: "fixture@example.invalid",
    status: "active",
  });
  await db.insert(s.corporateUsers).values({
    corporateAccountId: id,
    userId: id + 1,
    role: "booker",
    isActive: true,
  });
  await check(
    "F05: company membership does not authorize another user's booking",
    async () => {
      await assert.rejects(
        createCorporateBooking({
          corporateAccountId: id,
          bookingId: first,
          bookedByUserId: id + 1,
        }),
        /Owned booking/
      );
      assert.equal(
        (
          await db
            .select()
            .from(s.corporateBookings)
            .where(eq(s.corporateBookings.bookingId, first))
        ).length,
        0
      );
    }
  );
  await db
    .update(s.corporateUsers)
    .set({ role: "admin" })
    .where(eq(s.corporateUsers.userId, id + 1));
  await db
    .update(s.corporateAccounts)
    .set({ creditLimit: 10000, discountPercent: "10.00" })
    .where(eq(s.corporateAccounts.id, id));
  const corporateInvoices = [
    await booking(20, id + 1, 10000),
    await booking(21, id + 1, 10000),
  ];
  const links = await Promise.all(
    corporateInvoices.map(bookingId =>
      createCorporateBooking({
        corporateAccountId: id,
        bookingId,
        bookedByUserId: id + 1,
      })
    )
  );
  await check(
    "F21: approval gates checkout; corporate discount is a single server invoice revision",
    async () => {
      for (const bookingId of corporateInvoices) {
        await assert.rejects(
          reserveBookingCheckout({
            bookingId,
            userId: id + 1,
            appBaseUrl: "https://fixture.example.invalid",
          }),
          /approval/
        );
        await createCorporateBooking({
          corporateAccountId: id,
          bookingId,
          bookedByUserId: id + 1,
        });
        const [invoice] = await db
          .select()
          .from(s.bookings)
          .where(eq(s.bookings.id, bookingId));
        assert.equal(invoice.totalAmount, 9000);
        assert.equal(
          (
            await db
              .select()
              .from(s.bookingCheckoutRequests)
              .where(eq(s.bookingCheckoutRequests.bookingId, bookingId))
          ).length,
          0
        );
      }
    }
  );
  await check(
    "F21: competing approved invoices cannot exceed company credit; replay posts once",
    async () => {
      for (const link of links) await approveCorporateBooking(link.id, id + 1);
      const results = await Promise.allSettled(
        corporateInvoices.map(bookingId =>
          payCorporateInvoice(bookingId, id + 1)
        )
      );
      assert.equal(
        results.filter(r => r.status === "fulfilled").length,
        1,
        JSON.stringify(results)
      );
      const winner =
        corporateInvoices[results.findIndex(r => r.status === "fulfilled")];
      const receipt = await payCorporateInvoice(winner, id + 1);
      assert.equal(receipt.settled, true);
      const [account] = await db
        .select()
        .from(s.corporateAccounts)
        .where(eq(s.corporateAccounts.id, id));
      assert.equal(account.balance, -9000);
      assert.equal(
        (
          await db
            .select()
            .from(s.financialLedger)
            .where(
              eq(s.financialLedger.stripeEventId, `corporate-credit:${winner}`)
            )
        ).length,
        1
      );
      await assert.rejects(
        rejectCorporateBooking(
          links[results.findIndex(r => r.status === "fulfilled")].id,
          id + 1,
          "late rejection"
        )
      );
    }
  );
  await check(
    "F22: invitation has one durable notification; foreign acceptance fails and replay is idempotent",
    async () => {
      const before = (
        await db
          .select()
          .from(s.notifications)
          .where(eq(s.notifications.userId, id))
      ).length;
      const input = {
        corporateAccountId: id,
        email: "fixture-0@example.invalid",
        role: "traveler" as const,
      };
      const invited = await inviteCorporateUser(id + 1, input),
        replayed = await inviteCorporateUser(id + 1, input);
      assert.equal(invited.id, replayed.id);
      assert.equal(
        (
          await db
            .select()
            .from(s.notifications)
            .where(eq(s.notifications.userId, id))
        ).length,
        before + 1
      );
      await assert.rejects(acceptCorporateInvitation(id + 2, invited.id));
      await Promise.all([
        acceptCorporateInvitation(id, invited.id),
        acceptCorporateInvitation(id, invited.id),
      ]);
      assert.equal(
        (
          await db
            .select()
            .from(s.corporateUsers)
            .where(eq(s.corporateUsers.userId, id))
        ).length,
        1
      );
      await assert.rejects(
        addUserToCorporate({
          corporateAccountId: id,
          userId: id,
          role: "booker",
        }),
        /already/
      );
    }
  );
  const multi = await booking(22, id + 1, 10000);
  await db
    .update(s.bookings)
    .set({ status: "confirmed", paymentStatus: "paid", seatsReserved: true })
    .where(eq(s.bookings.id, multi));
  const [traveler] = await db
    .insert(s.passengers)
    .values({ bookingId: multi, firstName: "Synthetic", lastName: "TwoLeg" });
  const multiFlights = [id + 200, id + 201];
  await db.insert(s.flights).values(
    multiFlights.map((flightId, n) => ({
      ...template,
      status: "scheduled" as const,
      id: flightId,
      flightNumber: `AL00${n}`,
      departureTime: new Date(Date.now() + (2 + n * 3) * 3600000),
      arrivalTime: new Date(Date.now() + (3 + n * 3) * 3600000),
      economyAvailable: 9,
    }))
  );
  await db.insert(s.bookingSegments).values(
    multiFlights.map((flightId, n) => ({
      bookingId: multi,
      flightId,
      segmentOrder: n + 1,
      departureDate: new Date(),
      status: "confirmed" as const,
      seatsReserved: true,
      segmentAmount: 5000,
    }))
  );
  await check(
    "F15/F16: APIS and itinerary use all current legs; foreign compensation legs are rejected",
    async () => {
      for (const flightId of multiFlights)
        assert.equal(
          (await getFlightAPISStatus(flightId)).passengerStatuses.some(
            p => p.passengerId === traveler.insertId
          ),
          true
        );
      const itinerary = await getShareableItinerary(multi, id + 1);
      assert.deepEqual(
        itinerary.segments.map(leg => leg.flightId),
        multiFlights
      );
      await assert.rejects(
        autoAssessEligibility(multi, "delay", id + 1, id + 2),
        /not part/
      );
      await assert.rejects(
        autoAssessEligibility(multi, "delay", id + 1),
        /Choose/
      );
      await assert.rejects(getShareableItinerary(multi, id), /Owned/);
    }
  );
  await check(
    "F17: scheduled auto check-in checks every active leg once through the departure authority",
    async () => {
      // Fixture airports share a country; international document acceptance is a separate gate.
      await db.insert(s.airports).values([
        {
          id: id + 202,
          code: "AL1",
          name: "Domestic fixture A",
          city: "A",
          country: "Fixture",
        },
        {
          id: id + 203,
          code: "AL2",
          name: "Domestic fixture B",
          city: "B",
          country: "Fixture",
        },
      ]);
      for (const flightId of multiFlights)
        await db
          .update(s.flights)
          .set({ originId: id + 202, destinationId: id + 203 })
          .where(eq(s.flights.id, flightId));
      await db.insert(s.seatMaps).values({
        id: id + 200,
        airlineId: template.airlineId,
        aircraftType: "A320",
        configName: "Audit fixture",
        totalSeats: 1,
        economySeats: 1,
        cabinLayout: JSON.stringify({ rows: [] }),
      });
      await db.insert(s.seatInventory).values(
        multiFlights.map(flightId => ({
          flightId,
          seatMapId: id + 200,
          seatNumber: "1A",
          row: 1,
          column: "A",
          cabinClass: "economy" as const,
          seatType: "window" as const,
          seatPrice: 0,
        }))
      );
      await setAutoCheckIn(id + 1, true);
      await processAutoCheckIns();
      const first = await db
        .select()
        .from(s.seatInventory)
        .where(eq(s.seatInventory.bookingId, multi));
      assert.equal(first.length, 2);
      assert(first.every(seat => seat.status === "checked_in"));
      const nonces = first.map(seat => seat.checkInNonce);
      await processAutoCheckIns();
      const second = await db
        .select()
        .from(s.seatInventory)
        .where(eq(s.seatInventory.bookingId, multi));
      assert.deepEqual(
        second.map(seat => seat.checkInNonce),
        nonces
      );
      await setAutoCheckIn(id + 1, false);
    }
  );
  await check(
    "F23: missing evidence remains unassessed; approval requires recorded evidence and cannot imply payout",
    async () => {
      const eligibility = await autoAssessEligibility(
        multi,
        "delay",
        id + 1,
        multiFlights[1]
      );
      assert.equal(eligibility.assessmentStatus, "needs_review");
      assert.equal(eligibility.estimatedAmount, null);
      const claim = await createClaim({
        bookingId: multi,
        flightId: multiFlights[1],
        passengerId: traveler.insertId,
        userId: id + 1,
        regulationType: "local",
        claimType: "delay",
      });
      assert.equal(claim.calculatedAmount, null);
      assert.equal(claim.status, "under_review");
      await assert.rejects(
        processClaim({
          claimId: claim.id,
          actorId: id + 1,
          decision: "approved",
          approvedAmount: 1000,
        }),
        /evidence/
      );
      const approved = await processClaim({
        claimId: claim.id,
        actorId: id + 1,
        decision: "approved",
        approvedAmount: 1000,
        evidence: {
          policyReference: "synthetic:policy:1",
          fxReference: "synthetic:SAR",
          distanceReference: "synthetic:distance",
          distanceKm: 400,
        },
      });
      assert.equal(approved.status, "approved");
      assert.equal(approved.paidAt, null);
      const [stored] = await db
        .select()
        .from(s.compensationClaims)
        .where(eq(s.compensationClaims.id, claim.id));
      assert.deepEqual(
        stored.reviewEvidence &&
          JSON.parse(JSON.stringify(stored.reviewEvidence)).actorId,
        id + 1
      );
      const stats = await getCompensationStats();
      assert(stats.unassessedClaims >= 1);
      assert.equal(stats.totalPaid, 0);
    }
  );
  await check(
    "F24: scoped flight mutation rejects a foreign tenant inside the transaction",
    async () => {
      const before = (
        await db
          .select()
          .from(s.flightStatusHistory)
          .where(eq(s.flightStatusHistory.flightId, multiFlights[0]))
      ).length;
      await assert.rejects(
        db.transaction(tx =>
          transitionFlight(tx, {
            flightId: multiFlights[0],
            status: "delayed",
            tenantId: 999999,
          })
        ),
        /not found/
      );
      await assert.rejects(
        updateFlightStatus({
          flightId: multiFlights[0],
          status: "cancelled",
          tenantId: 999999,
          reason: "Foreign cancellation fixture",
        }),
        /not found/
      );
      assert.equal(
        (
          await db
            .select()
            .from(s.flightCancellationJobs)
            .where(eq(s.flightCancellationJobs.flightId, multiFlights[0]))
        ).length,
        0
      );
      assert.equal(
        (
          await db
            .select()
            .from(s.flightStatusHistory)
            .where(eq(s.flightStatusHistory.flightId, multiFlights[0]))
        ).length,
        before
      );
    }
  );
  await check(
    "F12: posted ledger dates count full and partial refunds once; unpaid invoices are not collected",
    async () => {
      const a = await booking(23, id, 10000),
        b = await booking(24, id, 10000);
      await booking(25, id, 70000);
      await db
        .update(s.bookings)
        .set({ paymentStatus: "refunded", status: "cancelled" })
        .where(eq(s.bookings.id, a));
      await db.insert(s.financialLedger).values(
        [
          {
            bookingId: a,
            userId: id,
            type: "charge" as const,
            amount: "100.00",
            transactionDate: new Date("2024-02-01T00:00:00Z"),
          },
          {
            bookingId: a,
            userId: id,
            type: "refund" as const,
            amount: "100.00",
            transactionDate: new Date("2024-02-02T00:00:00Z"),
          },
          {
            bookingId: b,
            userId: id,
            type: "charge" as const,
            amount: "100.00",
            transactionDate: new Date("2024-02-01T00:00:00Z"),
          },
          {
            bookingId: b,
            userId: id,
            type: "partial_refund" as const,
            amount: "25.00",
            transactionDate: new Date("2024-02-02T00:00:00Z"),
          },
        ].map((row, n) => ({
          ...row,
          currency: "SAR",
          stripeEventId: `audit-report-${id}-${n}`,
        }))
      );
      const report = await getFinancialSummary({
        startDate: new Date("2024-02-01T00:00:00Z"),
        endDate: new Date("2024-02-29T23:59:59Z"),
      });
      assert.equal(report.collectedAmount, 20000);
      assert.equal(report.refundedAmount, 12500);
      assert.equal(report.netCollectedAmount, 7500);
      const overview = await getRevenueDashboard(
        new Date("2024-02-01T00:00:00Z"),
        new Date("2024-02-29T23:59:59Z")
      );
      assert.equal(overview.totalRevenue, 20000);
      assert.equal(overview.refundTotal, 12500);
      assert.equal(overview.netRevenue, 7500);
      const impact = await getRefundImpact(
        new Date("2024-02-01T00:00:00Z"),
        new Date("2024-02-29T23:59:59Z")
      );
      assert.equal(impact.totalRefunds, 12500);
      assert.equal(impact.refundCount, 2);
      const all = await getFinancialSummary();
      assert(all.nonCashFundedAmount >= 17000);
    }
  );
  const exportBookings = [
    await booking(5, id + 2),
    await booking(6, id + 2),
    await booking(7, id + 2),
  ];
  await db.insert(s.passengers).values(
    exportBookings.map((bookingId, n) => ({
      bookingId,
      firstName: `Synthetic${n}`,
      lastName: "Traveller",
    }))
  );
  await db.insert(s.savedPassengers).values({
    userId: id + 2,
    firstName: "Saved",
    lastName: "Fixture",
    passportNumber: "SYNTHETIC",
  });
  await check(
    "F06/F07: concurrent export workers publish one owner-only artifact containing every booking",
    async () => {
      const request = await exportUserData(id + 2, "json");
      const results = await Promise.all([
        generateDataExport(request.requestId),
        generateDataExport(request.requestId),
      ]);
      assert(results.every(r => r.success));
      const file = await downloadDataExport(id + 2, request.requestId);
      const data = JSON.parse(file.content);
      assert.equal(
        data.bookings.flatMap((b: { passengers: unknown[] }) => b.passengers)
          .length,
        3
      );
      assert.equal(data.savedPassengers.length, 1);
      await assert.rejects(
        downloadDataExport(id, request.requestId),
        /not found/
      );
      assert.equal(
        (
          await db
            .select()
            .from(s.privacyExportArtifacts)
            .where(eq(s.privacyExportArtifacts.requestId, request.requestId))
        ).length,
        1
      );
      await db
        .update(s.privacyExportArtifacts)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(s.privacyExportArtifacts.requestId, request.requestId));
      await assert.rejects(
        downloadDataExport(id + 2, request.requestId),
        /expired/
      );
    }
  );
  await check(
    "F09: withdrawal updates both consent authorities and a stale browser cannot restore consent",
    async () => {
      const initial = await recordConsent(
        {
          essential: true,
          analytics: true,
          marketing: true,
          preferences: true,
          consentVersion: "1.0",
          expectedRevision: null,
        },
        id + 2,
        {}
      );
      await withdrawAllConsent(id + 2);
      const { consent: latest } = await getMyConsent(id + 2);
      assert.equal(latest?.analytics, false);
      assert.equal(latest?.marketing, false);
      await assert.rejects(
        recordConsent(
          {
            essential: true,
            analytics: true,
            marketing: true,
            preferences: true,
            consentVersion: "1.0",
            expectedRevision: initial.id,
          },
          id + 2,
          {}
        ),
        /Consent changed/
      );
      const [privacy] = await db
        .select()
        .from(s.userConsents)
        .where(eq(s.userConsents.userId, id + 2));
      assert.equal(privacy.analyticsTracking, false);
      assert.equal(privacy.marketingEmails, false);
    }
  );
  await check(
    "F08: due confirmed erasure revokes access and refresh; unapproved erasure cannot claim completion",
    async () => {
      const tokens = await mobileAuthServiceV2.login(id + 2);
      const [created] = await db.insert(s.accountDeletionRequests).values({
        userId: id + 2,
        confirmedAt: new Date(),
        scheduledDeletionAt: new Date(Date.now() - 1000),
      });
      const result = await processAccountDeletion(created.insertId);
      assert.equal(result.success, false);
      assert.match(result.error ?? "", /RETENTION_REVIEW_REQUIRED/);
      await assert.rejects(
        mobileAuthServiceV2.authenticateAccessToken(tokens.accessToken)
      );
      await assert.rejects(
        mobileAuthServiceV2.refreshTokens(tokens.refreshToken)
      );
      await assert.rejects(mobileAuthServiceV2.login(id + 2), /suspended/);
      const [request] = await db
        .select()
        .from(s.accountDeletionRequests)
        .where(eq(s.accountDeletionRequests.id, created.insertId));
      assert.equal(request.status, "failed");
      assert.equal(request.completedAt, null);
    }
  );
  const weatherId = id + 100;
  await db.insert(s.airports).values([
    {
      id: weatherId,
      code: "AQ1",
      name: "Weather fixture",
      city: "Fixture",
      country: "Fixture",
    },
    {
      id: weatherId + 1,
      code: "AQ2",
      name: "Weather fixture",
      city: "Fixture",
      country: "Fixture",
    },
  ]);
  await db.insert(s.flights).values({
    ...template,
    status: "scheduled",
    id: weatherId,
    flightNumber: "AQ001",
    originId: weatherId,
    destinationId: weatherId + 1,
    departureTime: new Date(Date.now() + 3600_000),
    arrivalTime: new Date(Date.now() + 7200_000),
  });
  await db.transaction(async tx => {
    for (const [airportId, icaoCode] of [
      [weatherId, "OA01"],
      [weatherId + 1, "OA02"],
    ] as const)
      await recordStationMapping(tx, {
        airportId,
        icaoCode,
        mappingEvidence: "Synthetic acceptance mapping",
        recordedBy: seed,
      });
  });
  const now = new Date(Math.floor(Date.now() / 1000) * 1000);
  const report = (station: string, age: number, visib = "0.5") =>
    decodeMetar({
      icaoId: station,
      reportTime: new Date(now.getTime() - age * 60000).toISOString(),
      rawOb: `${station} SYNTHETIC METAR`,
      temp: 20,
      dewp: 10,
      wdir: 90,
      wspd: 5,
      wgst: null,
      visib,
      altim: 1008,
      clouds: [{ cover: "OVC", base: 200 }],
    });
  await check(
    "F32: stale station output preserves history but cannot assert current weather",
    async () => {
      await db.transaction(tx =>
        ingestReports(tx, { mode: "sandbox", reference: "synthetic:weather" }, [
          report("OA01", 180),
        ])
      );
      const [station] = await getStationWeather(["OA01"], "metar", now);
      assert.equal(station.coverage, "stale_observation");
      assert.equal(station.currentCategory, null);
      assert.deepEqual(station.currentConcerns, []);
      assert.equal(station.observation?.flightCategory, "LIFR");
      assert(station.observation?.rawText);
    }
  );
  await check(
    "F32: exact expiry and future timestamps cannot assert current weather",
    async () => {
      const issued = new Date(now.getTime() - 180 * 60000);
      const [atLimit] = await getStationWeather(
        ["OA01"],
        "metar",
        new Date(issued.getTime() + 90 * 60000)
      );
      assert.equal(atLimit.currentCategory, "LIFR");
      for (const clock of [
        new Date(issued.getTime() + 90 * 60000 + 1),
        new Date(issued.getTime() - 1),
      ]) {
        const [outside] = await getStationWeather(["OA01"], "metar", clock);
        assert.equal(outside.currentCategory, null);
        assert.deepEqual(outside.currentConcerns, []);
      }
    }
  );
  await check(
    "F19: source report becomes a durable alert and provider receipt; stale coverage never resolves bad weather",
    async () => {
      const old = {
        mode: process.env.ONCALL_MODE,
        url: process.env.ONCALL_BASE_URL,
        token: process.env.ONCALL_TOKEN,
      };
      process.env.ONCALL_MODE = "sandbox";
      process.env.ONCALL_BASE_URL = "https://oncall.example.invalid";
      process.env.ONCALL_TOKEN = "synthetic";
      try {
        await refreshWeatherOperations(now, {
          mode: "sandbox",
          reference: "synthetic:weather",
          fetch: async (_kind, stations) =>
            stations
              .filter(code => ["OA01", "OA02"].includes(code))
              .map(code => report(code, 1)),
        });
        const key = `weather:${weatherId}:origin`;
        const [alert] = await db
          .select()
          .from(s.operationsAlerts)
          .where(eq(s.operationsAlerts.key, key));
        assert.equal(alert.status, "active");
        const [dispatch] = await db
          .select()
          .from(s.alertDispatches)
          .where(
            and(
              eq(s.alertDispatches.alertKey, key),
              eq(s.alertDispatches.action, "raise")
            )
          );
        assert(dispatch);
        let sent = 0;
        assert.equal(
          // Advance to the persisted scheduler deadline (MySQL TIMESTAMP(0)
          // can round a newly queued deadline up to the next whole second).
          await deliverDispatch(
            db,
            dispatch.id,
            {
              ...configuredOnCallProvider()!,
              send: async () => {
                sent++;
              },
            },
            new Date(
              Math.max(Date.now(), dispatch.nextAttemptAt?.getTime() ?? 0)
            )
          ),
          "delivered"
        );
        assert.equal(sent, 1);
        await refreshWeatherOperations(new Date(now.getTime() + 95 * 60000), {
          mode: "sandbox",
          reference: "synthetic:weather",
          fetch: async () => [],
        });
        const [stale] = await db
          .select()
          .from(s.operationsAlerts)
          .where(eq(s.operationsAlerts.key, key));
        assert.equal(stale.status, "active");
        const [coverage] = await db
          .select()
          .from(s.operationsAlerts)
          .where(eq(s.operationsAlerts.key, `${key}:coverage`));
        assert.equal(coverage.status, "active");
      } finally {
        for (const [key, value] of [
          ["ONCALL_MODE", old.mode],
          ["ONCALL_BASE_URL", old.url],
          ["ONCALL_TOKEN", old.token],
        ]) {
          if (value === undefined) delete process.env[key!];
          else process.env[key!] = value;
        }
      }
    }
  );
}
