/** Runs against an empty disposable MySQL database. All source receipts and payment inputs are synthetic. No external provider calls. */
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { eq } from "drizzle-orm";
import * as s from "../../drizzle/schema";
if (
  process.env.AIS_DISPOSABLE_DATABASE !== "true" ||
  !process.env.DATABASE_URL ||
  !/\/[a-z0-9_]+_test$/i.test(new URL(process.env.DATABASE_URL).pathname) ||
  process.env.NODE_ENV === "production"
)
  throw new Error("Use an empty disposable *_test database");
const { getDb, closePool } = await import("../../server/db");
const { calculateRequestHash } =
  await import("../../server/services/idempotency-v2.service");
const { settleVerifiedPayment } =
  await import("../../server/services/payment-settlement.service");
const { getFinancialSummary } =
  await import("../../server/services/financial-reporting.service");
const {
  createDisruptionEvent,
  autoTriggerProtection,
  getIROPSEventDetail,
  countProtectedPassengers,
} = await import("../../server/services/irops.service");
const { proposeRecovery, approveRecovery, executeRecovery } =
  await import("../../server/services/irops-recovery.service");
const { ingestCrewRules, assignCrewWithRules } =
  await import("../../server/services/crew-rule.service");
const { ingestMaintenance, assignAircraftRotation } =
  await import("../../server/services/aircraft-rotation.service");
const { ingestFlightCost, getFlightEconomics } =
  await import("../../server/services/flight-economics-evidence.service");
const { acceptPremiumPolicy, premiumAdjustment, premiumResults } =
  await import("../../server/services/premium-experiment.service");
const { ingestTravelEvidence, sourcedCarbon } =
  await import("../../server/services/travel-evidence.service");
const { getClearanceContext, ingestTravelClearance, assertTravelClearance } =
  await import("../../server/services/travel-clearance.service");
const { collectPassengerInfo } =
  await import("../../server/services/apis.service");
const db = getDb();
assert(db, "MySQL required");
const id = 995000,
  now = new Date(Math.floor(Date.now() / 1000) * 1000),
  hour = (h: number) => new Date(now.getTime() + h * 3600000),
  statePath = process.argv[3];
assert(statePath, "Pass a state/report JSON path");
const checks: string[] = [];
let sequence = 0;
async function check(name: string, run: () => Promise<void>) {
  await run();
  checks.push(name);
  console.info(`PASS ${name}`);
}
const sourceKey = "synthetic-acceptance-hmac-key-32-characters";
process.env.AVIATION_RESEARCH_ACCEPTANCE_KEY = sourceKey;
process.env.AVIATION_SOURCE_REGISTRY = JSON.stringify([
  {
    sourceId: "synthetic-research",
    tenantId: id,
    airlineIds: [id],
    capabilities: [
      "crew_rules",
      "maintenance",
      "flight_cost",
      "premium_policy",
      "carbon",
      "travel_clearance",
    ],
    secretEnv: "AVIATION_RESEARCH_ACCEPTANCE_KEY",
    validUntil: hour(24 * 365).toISOString(),
  },
]);
function signed(
  kind: string,
  flightId: number | null,
  payload: Record<string, unknown>
) {
  const envelope = {
    sourceId: "synthetic-research",
    eventId: `research-${kind}-${++sequence}`,
    issuedAt: new Date().toISOString(),
    observedAt: new Date(Date.now() - 10000 + sequence * 10).toISOString(),
    flightId,
    kind,
    payload,
  };
  return {
    envelope,
    signature: createHmac("sha256", sourceKey)
      .update(calculateRequestHash(envelope))
      .digest("hex"),
  };
}
try {
  if (process.argv[2] === "verify") {
    const state = JSON.parse(await readFile(statePath, "utf8")) as {
      planId: string;
      digest: string;
      receiptId: string;
      eventId: number;
      checks: string[];
    };
    await check(
      "restart retains recovery plan, protected passenger and execution receipt",
      async () => {
        assert.equal(
          (await executeRecovery(state.planId, state.digest, id, id)).receiptId,
          state.receiptId
        );
        const detail = await getIROPSEventDetail(state.eventId);
        assert(detail);
        assert.equal(countProtectedPassengers(detail.actions), 1);
        assert(
          detail.actions.some(
            a => a.actionType === "meal_voucher" && a.status === "pending"
          )
        );
      }
    );
    await writeFile(
      statePath,
      JSON.stringify(
        { ...state, checks: [...state.checks, ...checks], result: "PASS" },
        null,
        2
      )
    );
  } else {
    for (const table of [
      s.users,
      s.airlines,
      s.airports,
      s.bookings,
      s.aviationEvidence,
    ])
      assert.equal(
        (await db.select().from(table).limit(1)).length,
        0,
        "Refusing to overwrite existing data"
      );
    await db.insert(s.tenants).values({
      id,
      name: "Synthetic research",
      slug: "synthetic-research",
      status: "active",
    });
    await db.insert(s.users).values({
      id,
      openId: "synthetic-research",
      tenantId: id,
      role: "admin",
    });
    await db
      .insert(s.airlines)
      .values({ id, code: "ZY", name: "Synthetic research" });
    await db.insert(s.airports).values([
      { id, code: "ZZA", name: "A", city: "A", country: "SA" },
      { id: id + 1, code: "ZZB", name: "B", city: "B", country: "SA" },
      { id: id + 2, code: "ZZC", name: "C", city: "C", country: "AE" },
    ]);
    await db.insert(s.flights).values(
      [0, 1, 2, 3, 4, 5].map(i => ({
        id: id + i,
        tenantId: id,
        airlineId: id,
        flightNumber: `ZY90${i}`,
        originId: id,
        destinationId: i === 5 ? id + 2 : id + 1,
        departureTime: hour(i === 3 ? -24 : 24 + i * 2),
        arrivalTime: hour(i === 3 ? -22 : 25 + i * 2),
        aircraftType: "A320",
        status: i === 3 ? ("completed" as const) : ("scheduled" as const),
        economySeats: 10,
        economyAvailable: i === 1 ? 1 : 10,
        businessSeats: 10,
        businessAvailable: 10,
        economyPrice: 10000,
        businessPrice: 20000,
      }))
    );
    for (const i of [0, 1, 5]) {
      await db.insert(s.bookings).values({
        id: id + i,
        tenantId: id,
        userId: id,
        flightId: i === 5 ? id + 5 : id,
        bookingReference: `RA000${i}`,
        pnr: `RP000${i}`,
        cabinClass: "economy",
        numberOfPassengers: 1,
        totalAmount: 10000,
      });
      await db.insert(s.passengers).values({
        id: id + i,
        tenantId: id,
        bookingId: id + i,
        type: "adult",
        firstName: "Synthetic",
        lastName: `Traveler${i}`,
        nationality: "SA",
        passportNumber: `PA1000${i}`,
        passportExpiry: hour(24 * 365),
      });
      await db.transaction(tx =>
        settleVerifiedPayment(tx, {
          paymentIntentId: `pi_synthetic_research_${i}`,
          amount: 10000,
          currency: "sar",
          metadata: { bookingId: String(id + i), userId: String(id) },
          eventId: `evt_synthetic_research_${i}`,
        })
      );
    }
    await check(
      "financial projection counts posted collections once",
      async () => {
        const summary = await getFinancialSummary();
        assert.equal(summary.collectedAmount, 30000);
        assert.equal(summary.earnedRevenue, null);
      }
    );
    const disruption = await createDisruptionEvent(id, "cancellation", {
      reason: "Synthetic acceptance disruption",
      severity: "high",
      createdBy: id,
    });
    await autoTriggerProtection(id);
    await autoTriggerProtection(id);
    const plans: Array<Awaited<ReturnType<typeof proposeRecovery>>> = [];
    for (const bookingId of [id, id + 1]) {
      const p = await proposeRecovery(
        {
          eventId: disruption.id,
          bookingIds: [bookingId],
          candidateFlightIds: [id + 1],
        },
        id
      );
      assert.equal(p.unassignedPassengers, 0);
      await approveRecovery(p.id, p.digest, id, id);
      plans.push(p);
    }
    let winner = 0,
      receiptId = "";
    await check(
      "two approved recovery plans cannot oversell one remaining seat",
      async () => {
        const results = await Promise.allSettled(
          plans.map(p => executeRecovery(p.id, p.digest, id, id))
        );
        assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
        winner = results.findIndex(r => r.status === "fulfilled");
        const result = results[winner];
        assert.equal(result.status, "fulfilled");
        if (result.status === "fulfilled") receiptId = result.value.receiptId;
        const [flight] = await db
          .select()
          .from(s.flights)
          .where(eq(s.flights.id, id + 1));
        assert.equal(flight.economyAvailable, 0);
        const detail = await getIROPSEventDetail(disruption.id);
        assert(detail);
        assert.equal(countProtectedPassengers(detail.actions), 1);
      }
    );
    const rule = {
      airlineId: id,
      version: "synthetic-operator-v1",
      reference: "https://example.org/crew-profile",
      effectiveFrom: hour(-24).toISOString(),
      effectiveTo: hour(24 * 365).toISOString(),
      timeZone: "Asia/Riyadh",
      aircraftTypes: ["A320"],
      reportBeforeMinutes: 60,
      releaseAfterMinutes: 30,
      maxDuty24Minutes: 840,
      maxDuty7DayMinutes: 3600,
      minRestMinutes: 600,
      minimumCrew: { captain: 1, first_officer: 1, purser: 1, cabin_crew: 3 },
      fdpBands: [
        {
          startHour: 0,
          endHour: 24,
          minSegments: 1,
          maxSegments: 4,
          maxMinutes: 780,
        },
      ],
    };
    const crewEvidence = signed("crew_rules", null, rule);
    await ingestCrewRules(
      crewEvidence.envelope,
      crewEvidence.signature,
      id,
      id
    );
    await db.insert(s.crewMembers).values({
      id,
      employeeId: "RESEARCH-CREW",
      firstName: "Synthetic",
      lastName: "Captain",
      role: "captain",
      airlineId: id,
      licenseExpiry: hour(24 * 365),
      medicalExpiry: hour(24 * 365),
      qualifiedAircraft: JSON.stringify(["A320"]),
    });
    await check(
      "crew writer enforces shared operator rest and qualification evidence",
      async () => {
        await assignCrewWithRules({
          flightId: id + 1,
          crewMemberId: id,
          role: "captain",
          assignedBy: id,
          tenantId: id,
        });
        await assert.rejects(
          assignCrewWithRules({
            flightId: id + 2,
            crewMemberId: id,
            role: "captain",
            assignedBy: id,
            tenantId: id,
          })
        );
      }
    );
    const maintenance = {
      airlineId: id,
      tailNumber: "HZ-TEST",
      aircraftType: "A320",
      status: "released",
      validUntil: hour(24 * 365).toISOString(),
      reference: "synthetic-MRO-release",
      minimumTurnaroundMinutes: 45,
    };
    let e = signed("maintenance", null, maintenance);
    await ingestMaintenance(e.envelope, e.signature);
    await check(
      "tail planning rejects disconnected rotation and superseded release",
      async () => {
        await assignAircraftRotation(id + 1, "HZ-TEST", id, id);
        await assert.rejects(assignAircraftRotation(id + 2, "HZ-TEST", id, id));
        e = signed("maintenance", null, { ...maintenance, status: "grounded" });
        await ingestMaintenance(e.envelope, e.signature);
        await assert.rejects(assignAircraftRotation(id + 1, "HZ-TEST", id, id));
      }
    );
    const cost = signed("flight_cost", id + 3, {
      version: "synthetic-close-1",
      reference: "synthetic-ledger-period",
      currency: "SAR",
      periodClosed: true,
      routeDistanceKm: 500,
      costs: {
        fuel: 1000,
        crew: 1000,
        maintenance: 500,
        airport: 500,
        navigation: 100,
        insurance: 100,
        overhead: 300,
      },
      recognizedRevenueMinor: 10000,
    });
    await check(
      "closed cost replay retains one full snapshot and explicit operating result",
      async () => {
        await ingestFlightCost(cost.envelope, cost.signature);
        await ingestFlightCost(cost.envelope, cost.signature);
        const result = await getFlightEconomics(id + 3, id);
        assert.equal(result.totalCostMinor, 3500);
        assert.equal(result.operatingResultMinor, 6500);
        assert.equal(result.availableSeatKm, 10000);
      }
    );
    const premium = signed("premium_policy", id + 4, {
      version: "synthetic-premium-1",
      reference: "synthetic-budget",
      effectiveFrom: hour(-1).toISOString(),
      effectiveTo: hour(10).toISOString(),
      analysisAfter: hour(24 * 30).toISOString(),
      discountBps: 1000,
      protectedSeats: 2,
      minimumPerPassengerMinor: 100,
      expectedVariableCostMinor: 100,
      minimumContributionMinor: 100,
      displacedDemandValueMinor: 100,
      minimumSamplePerArm: 30,
    });
    const policy = await acceptPremiumPolicy(
      premium.envelope,
      premium.signature,
      id,
      id
    );
    await check(
      "repeated premium exposures retain one randomized visitor",
      async () => {
        const a = await db.transaction(tx =>
            premiumAdjustment(tx, id + 4, id, 1, 20000)
          ),
          b = await db.transaction(tx =>
            premiumAdjustment(tx, id + 4, id, 1, 20000)
          );
        assert(a && b);
        assert.deepEqual(a, b);
        const r = await premiumResults(policy.id, id);
        assert.equal(
          r.arms.reduce((n, a) => n + a.randomizedUsers, 0),
          1
        );
        assert.equal(r.effect, null);
      }
    );
    const carbon = signed("carbon", id + 4, {
      method: "synthetic-method",
      version: "1",
      reference: "https://example.org/method",
      basis: "estimated",
      validUntil: hour(24 * 2).toISOString(),
      originId: id,
      destinationId: id + 1,
      departureTime: hour(32).toISOString(),
      distanceKm: 500,
      fuelKg: 1000,
      co2KgPerFuelKg: 3,
      passengerFuelShare: 0.8,
      economyEquivalentPassengers: 120,
      businessWeight: 2,
    });
    await check(
      "carbon requires exact schedule and explicit allocation",
      async () => {
        await ingestTravelEvidence(carbon.envelope, carbon.signature);
        assert.equal((await sourcedCarbon(id + 4)).co2Economy, 20);
      }
    );
    await check(
      "international clearance is invalidated by a new APIS document",
      async () => {
        const c = await getClearanceContext(id + 5, id + 5, id);
        const e = signed("travel_clearance", id + 5, {
          bookingId: id + 5,
          passengerId: id + 5,
          documentDigest: c.documentDigest,
          itineraryDigest: c.itineraryDigest,
          verdict: "cleared",
          validUntil: hour(24 * 2).toISOString(),
          providerTransactionId: "synthetic-document-review",
          reference: "operator-desk",
        });
        await ingestTravelClearance(e.envelope, e.signature);
        await db.transaction(tx => assertTravelClearance(tx, id + 5, id + 5));
        await collectPassengerInfo(id + 5, {
          documentType: "passport",
          documentNumber: "NEW123456",
          issuingCountry: "SA",
          nationality: "SA",
          dateOfBirth: "1990-01-01",
          gender: "M",
          expiryDate: "2030-01-01",
          givenNames: "Synthetic",
          surname: "Traveler5",
        });
        await assert.rejects(
          db.transaction(tx => assertTravelClearance(tx, id + 5, id + 5))
        );
      }
    );
    await db.insert(s.flights).values(
      [6, 7].map(i => ({
        id: id + i,
        tenantId: id,
        airlineId: id,
        flightNumber: `ZY90${i}`,
        originId: id,
        destinationId: id + 2,
        departureTime: hour(24 + i * 2),
        arrivalTime: hour(25 + i * 2),
        aircraftType: "A320",
        economySeats: 10,
        economyAvailable: 10,
        businessSeats: 10,
        businessAvailable: 10,
        economyPrice: i === 6 ? 20000 : 1000,
        businessPrice: 30000,
      }))
    );
    const { createRetailOffer } =
      await import("../../server/services/retail-offer.service");
    const { quotePaidOrderService, confirmNoChargeService } =
      await import("../../server/services/order-servicing.service");
    const { recordVerifiedOrderRefund } =
      await import("../../server/services/order-refunds.service");
    let paidDelta = 0;
    await check(
      "paid itinerary settlement atomically moves a real MySQL reservation",
      async () => {
        const offer = await createRetailOffer({
          flightId: id + 6,
          userId: id,
          channel: "direct",
          cabinClass: "economy",
          passengerTypes: ["adult"],
        });
        const quote = await quotePaidOrderService(
          {
            bookingId: id + 5,
            offerIds: [offer.id],
            idempotencyKey: "synthetic-paid-itinerary",
          },
          id,
          id
        );
        assert(quote.totalCost > 0);
        paidDelta = quote.totalCost;
        // Provider transport is covered by boundary tests. Supply a synthetic saved checkout identity to exercise the trusted settlement authority without network calls.
        await db
          .update(s.bookingModifications)
          .set({ checkoutRequestId: "synthetic-checkout-request" })
          .where(eq(s.bookingModifications.id, quote.modificationId));
        const payment = {
          paymentIntentId: "pi_synthetic_paid_servicing",
          amount: quote.totalCost,
          currency: "sar",
          eventId: "evt_synthetic_paid_servicing",
          metadata: {
            type: "modification",
            bookingId: String(id + 5),
            userId: String(id),
            modificationId: String(quote.modificationId),
            checkoutRequestId: "synthetic-checkout-request",
          },
        };
        await db.transaction(tx => settleVerifiedPayment(tx, payment));
        await db.transaction(tx => settleVerifiedPayment(tx, payment));
        const [booking] = await db
          .select()
          .from(s.bookings)
          .where(eq(s.bookings.id, id + 5));
        assert.equal(booking.flightId, id + 6);
        assert.equal(booking.totalAmount, quote.newAmount);
        const [receipt] = await db
          .select()
          .from(s.paymentReceipts)
          .where(
            eq(s.paymentReceipts.paymentIntentId, payment.paymentIntentId)
          );
        assert.equal(receipt.settlementStatus, "applied");
      }
    );
    await check(
      "lower fare records a liability before verified refunds to original payer receipts",
      async () => {
        const offer = await createRetailOffer({
          flightId: id + 7,
          userId: id,
          channel: "direct",
          cabinClass: "economy",
          passengerTypes: ["adult"],
        });
        const quote = await quotePaidOrderService(
          {
            bookingId: id + 5,
            offerIds: [offer.id],
            idempotencyKey: "synthetic-lower-itinerary",
          },
          id,
          id
        );
        assert(quote.refundDue > 0);
        await confirmNoChargeService(quote.modificationId, id);
        let result = await getFinancialSummary();
        assert.equal(result.refundedAmount, 0);
        const refunds = await db
          .select()
          .from(s.orderServiceRefunds)
          .where(
            eq(s.orderServiceRefunds.modificationId, quote.modificationId)
          );
        assert.equal(
          refunds.reduce((sum, r) => sum + r.amount, 0),
          quote.refundDue
        );
        assert.deepEqual(
          refunds.map(r => r.paymentIntentId).sort(),
          ["pi_synthetic_paid_servicing", "pi_synthetic_research_5"].sort()
        );
        for (const item of refunds) {
          const refund: import("stripe").default.Refund = {
            id: `re_synthetic_${item.id}`,
            object: "refund",
            amount: item.amount,
            balance_transaction: null,
            charge: "ch_synthetic_original",
            created: Math.floor(Date.now() / 1000),
            currency: "sar",
            metadata: { orderServiceRefundId: item.id },
            payment_intent: item.paymentIntentId,
            reason: null,
            receipt_number: null,
            source_transfer_reversal: null,
            status: "succeeded",
            transfer_reversal: null,
          };
          await db.transaction(tx =>
            recordVerifiedOrderRefund(tx, refund, `evt_${refund.id}`)
          );
          await db.transaction(tx =>
            recordVerifiedOrderRefund(tx, refund, `evt_${refund.id}`)
          );
        }
        result = await getFinancialSummary();
        assert.equal(result.refundedAmount, quote.refundDue);
        assert.equal(
          result.netCollectedAmount,
          30000 + paidDelta - quote.refundDue
        );
      }
    );
    await writeFile(
      statePath,
      JSON.stringify(
        {
          planId: plans[winner].id,
          digest: plans[winner].digest,
          receiptId,
          eventId: disruption.id,
          checks,
          result: "restart_pending",
        },
        null,
        2
      )
    );
  }
} finally {
  await closePool();
  const { cacheService } = await import("../../server/services/cache.service");
  await cacheService.disconnect();
  const { redisCacheService } =
    await import("../../server/services/redis-cache.service");
  await redisCacheService.shutdown();
}
