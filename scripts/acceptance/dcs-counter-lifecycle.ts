import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import * as s from "../../drizzle/schema";
import {
  createInventoryLock,
  releaseInventoryLock,
} from "../../server/services/inventory-lock.service";
import { cancelBooking } from "../../server/services/bookings.service";
import type { SettlementTx } from "../../server/services/booking-settlement.service";
import {
  settleVerifiedPayment,
  settleVerifiedRefund,
} from "../../server/services/payment-settlement.service";
import { readTicketDocument } from "../../server/services/ticket-documents.service";
import { checkInPassengers } from "../../server/services/departure-control.service";
import {
  issueBoardingPass,
  verifyActiveBoardingPass,
} from "../../server/services/boarding-pass.service";
import {
  setBagReturnGrant,
  returnDcsBag,
  changeDcsFlightState,
  checkInDcsPassenger,
  getDcsDesk,
  transitionDcsPassenger,
  type DcsActor,
} from "../../server/services/dcs-operations.service";
import {
  correctCounterBag,
  registerBaggage,
  type BaggageRegistrationActor,
} from "../../server/services/baggage-registration.service";
import {
  addDeskNote,
  blockDeskSeats,
  confirmDeskDowngrade,
  dismissDeskCase,
  finalizeDesk,
  getStationReport,
  openDeskCase,
  quoteDeskDowngrade,
  remapDeskSeats,
  resolveDeskCase,
} from "../../server/services/dcs-station.service";
import { calculateRequestHash } from "../../server/services/idempotency-v2.service";
import type { EvidenceEnvelope } from "../../server/services/aviation-evidence.service";
import {
  getFlightBaggageCloseout,
  ingestBaggageCustody,
} from "../../server/services/baggage-custody.service";
import { generateFlightManifest } from "../../server/services/dcs.service";
import {
  changeSeat,
  releaseSeat,
  selectSeat,
} from "../../server/services/seat-map.service";

/** Only the guarded, disposable *_test runner calls this. No provider I/O. */
export async function verifyDcsCounterLifecycle(
  db: SettlementTx,
  seed: number,
  check: (name: string, run: () => Promise<void>) => Promise<void>
) {
  const [airline] = await db
    .select()
    .from(s.airlines)
    .where(eq(s.airlines.id, seed));
  const [origin] = await db
    .select()
    .from(s.airports)
    .where(eq(s.airports.id, seed));
  const [destination] = await db
    .select()
    .from(s.airports)
    .where(eq(s.airports.id, seed + 1));
  assert(
    airline && origin && destination,
    "The runner's synthetic reference data is required"
  );
  assert.equal(
    origin.country,
    destination.country,
    "This fixture tests domestic clearance, not an external border verdict"
  );

  const runId = randomUUID();
  const [{ id: tenantId }, { id: otherTenantId }] = await db
    .insert(s.tenants)
    .values([
      {
        slug: `dcs-counter-${runId}`,
        name: "Synthetic counter airline",
        airlineCode: airline.code,
        status: "active",
      },
      {
        slug: `dcs-other-${runId}`,
        name: "Synthetic unrelated airline",
        status: "active",
      },
    ])
    .$returningId();
  const [{ id: ownerId }, { id: operatorId }, { id: otherOperatorId }] =
    await db
      .insert(s.users)
      .values([
        {
          openId: `dcs-owner-${runId}`,
          tenantId,
          name: "Synthetic passenger owner",
          role: "user",
        },
        {
          openId: `dcs-ops-${runId}`,
          tenantId,
          name: "Synthetic counter operator",
          role: "ops",
        },
        {
          openId: `dcs-other-${runId}`,
          tenantId: otherTenantId,
          name: "Synthetic unrelated operator",
          role: "ops",
        },
      ])
      .$returningId();
  const actor: DcsActor = { userId: operatorId, role: "ops", tenantId };
  const bagActor: BaggageRegistrationActor = {
    id: operatorId,
    role: "ops",
    tenantId,
  };
  const otherActor: DcsActor = {
    userId: otherOperatorId,
    role: "ops",
    tenantId: otherTenantId,
  };
  const [{ id: seatMapId }] = await db
    .insert(s.seatMaps)
    .values({
      aircraftType: "DCS-FIXTURE",
      airlineId: airline.id,
      configName: `Counter ${runId}`,
      cabinLayout: JSON.stringify({
        rows: [
          { row: 1, seats: ["A", "B"] },
          { row: 2, seats: ["A", "B"] },
        ],
      }),
      totalSeats: 4,
      economySeats: 4,
    })
    .$returningId();
  let fixtureIndex = 0;
  const command = () => ({
    reason: "Disposable MySQL counter acceptance",
    idempotencyKey: randomUUID(),
  });

  async function journey(
    people = 1,
    sectors = 1,
    cabin: "economy" | "business" = "economy"
  ) {
    const index = ++fixtureIndex;
    const departure = new Date(Date.now() + 6 * 3600000);
    const flightRows = await db
      .insert(s.flights)
      .values(
        Array.from({ length: sectors }, (_, i) => ({
          tenantId,
          airlineId: airline.id,
          flightNumber: `${airline.code}${8000 + index * 10 + i}`,
          originId: i % 2 ? destination.id : origin.id,
          destinationId: i % 2 ? origin.id : destination.id,
          departureTime: new Date(departure.getTime() + i * 3 * 3600000),
          arrivalTime: new Date(departure.getTime() + (i * 3 + 1) * 3600000),
          aircraftType: "DCS-FIXTURE",
          status: "scheduled" as const,
          economySeats: 4,
          businessSeats: cabin === "business" ? 2 : 0,
          economyAvailable: 4,
          businessAvailable: cabin === "business" ? 2 : 0,
          economyPrice: 10000,
          businessPrice: 20000,
        }))
      )
      .$returningId();
    const flightIds = flightRows.map(f => f.id);
    await db.insert(s.seatInventory).values(
      flightIds.flatMap(flightId =>
        ["1A", "1B", "2A", "2B"].map(seatNumber => ({
          flightId,
          seatMapId,
          seatNumber,
          row: Number(seatNumber[0]),
          column: seatNumber[1],
          cabinClass: "economy" as const,
          seatType: "window" as const,
          status: "available" as const,
          seatPrice: 0,
          priceTier: "free" as const,
        }))
      )
    );
    const reference = `D${(seed + index).toString(36).toUpperCase().padStart(5, "0")}`;
    assert.equal(reference.length, 6);
    const sectorAmount = (cabin === "business" ? 85000 : 10000) * people;
    const amount = sectorAmount * sectors;
    const [{ id: bookingId }] = await db
      .insert(s.bookings)
      .values({
        tenantId,
        userId: ownerId,
        flightId: flightIds[0],
        bookingReference: reference,
        pnr: reference,
        cabinClass: cabin,
        numberOfPassengers: people,
        totalAmount: amount,
        status: "pending",
        paymentStatus: "pending",
        seatsReserved: false,
      })
      .$returningId();
    const segmentRows = await db
      .insert(s.bookingSegments)
      .values(
        flightIds.map((flightId, i) => ({
          bookingId,
          flightId,
          segmentOrder: i + 1,
          departureDate: new Date(departure.getTime() + i * 3 * 3600000),
          segmentAmount: sectorAmount,
          status: "pending" as const,
          seatsReserved: false,
        }))
      )
      .$returningId();
    const passengerRows = await db
      .insert(s.passengers)
      .values(
        Array.from({ length: people }, (_, i) => ({
          tenantId,
          bookingId,
          firstName: "Synthetic",
          lastName: i ? "Birch" : "Alder",
          type: "adult" as const,
        }))
      )
      .$returningId();
    // The same authority used by a verified provider event writes funding,
    // receipts, inventory and outbox. This is synthetic evidence in *_test only.
    await db.transaction(tx =>
      settleVerifiedPayment(tx, {
        paymentIntentId: `pi_dcs_counter_${bookingId}`,
        amount,
        currency: "sar",
        metadata: { bookingId: String(bookingId), userId: String(ownerId) },
        eventId: `evt_dcs_counter_${randomUUID()}`,
      })
    );
    const [funded] = await db
      .select()
      .from(s.bookings)
      .where(eq(s.bookings.id, bookingId));
    assert.equal(funded.status, "confirmed");
    assert.equal(funded.paymentStatus, "paid");
    assert.equal(funded.seatsReserved, true);
    const [receipt] = await db
      .select()
      .from(s.paymentReceipts)
      .where(
        eq(s.paymentReceipts.paymentIntentId, `pi_dcs_counter_${bookingId}`)
      );
    assert.equal(receipt.settlementStatus, "applied");
    for (const p of passengerRows)
      await readTicketDocument(bookingId, p.id, ownerId);
    return {
      bookingId,
      flightIds,
      key: (person = 0, sector = 0) => ({
        bookingId,
        passengerId: passengerRows[person].id,
        flightId: flightIds[sector],
      }),
      bag: (weight: number, person = 0, sector = 0) => ({
        bookingId,
        passengerId: passengerRows[person].id,
        flightId: flightIds[sector],
        segmentId: segmentRows[sector].id,
        weight,
        idempotencyKey: randomUUID(),
      }),
    };
  }
  async function storedSeat(key: {
    bookingId: number;
    passengerId: number;
    flightId: number;
  }) {
    const [seat] = await db
      .select()
      .from(s.seatInventory)
      .where(
        and(
          eq(s.seatInventory.bookingId, key.bookingId),
          eq(s.seatInventory.passengerId, key.passengerId),
          eq(s.seatInventory.flightId, key.flightId)
        )
      );
    return seat;
  }
  const bags = (bookingId: number) =>
    db
      .select()
      .from(s.baggageItems)
      .where(eq(s.baggageItems.bookingId, bookingId));
  const staffCheckIn = (key: {
    bookingId: number;
    passengerId: number;
    flightId: number;
  }) => checkInDcsPassenger({ ...key, ...command() }, actor);

  await check(
    "DCS: same baggage key creates one physical counter receipt on MySQL",
    async () => {
      const j = await journey();
      await staffCheckIn(j.key());
      const input = {
        ...j.bag(10),
        expectedActorId: operatorId,
        expectedTenantId: tenantId,
      };
      const results = await Promise.all(
        Array.from({ length: 4 }, () => registerBaggage(input, bagActor))
      );
      assert(
        results.every(
          row =>
            row.id === results[0].id && row.tagNumber === results[0].tagNumber
        )
      );
      assert.equal((await bags(j.bookingId)).length, 1);
      const tracking = await db
        .select()
        .from(s.baggageTracking)
        .where(eq(s.baggageTracking.baggageId, results[0].id));
      assert.equal(tracking.length, 1);
      assert.equal(tracking[0].scannedBy, operatorId);
      // Reuse only the isolated fixture operators. A changed same-airline
      // browser session must not turn the original key into a second receipt.
      await db
        .update(s.users)
        .set({ tenantId })
        .where(eq(s.users.id, otherOperatorId));
      try {
        await assert.rejects(
          registerBaggage(input, { ...bagActor, id: otherOperatorId }),
          { code: "FORBIDDEN", message: /identity changed/ }
        );
      } finally {
        await db
          .update(s.users)
          .set({ tenantId: otherTenantId })
          .where(eq(s.users.id, otherOperatorId));
      }
      await db
        .update(s.users)
        .set({ tenantId: otherTenantId })
        .where(eq(s.users.id, operatorId));
      try {
        await assert.rejects(
          registerBaggage(input, { ...bagActor, tenantId: otherTenantId }),
          { code: "FORBIDDEN", message: /identity changed/ }
        );
      } finally {
        await db
          .update(s.users)
          .set({ tenantId })
          .where(eq(s.users.id, operatorId));
      }
      assert.equal((await bags(j.bookingId)).length, 1);
      const commands = await db
        .select()
        .from(s.idempotencyRequests)
        .where(
          and(
            eq(s.idempotencyRequests.scope, "baggage.register"),
            eq(s.idempotencyRequests.idempotencyKey, input.idempotencyKey)
          )
        );
      assert.equal(commands.length, 1);
      assert.equal(commands[0].userId, operatorId);
      assert.equal(commands[0].status, "COMPLETED");
      assert.equal(
        (
          await db
            .select()
            .from(s.baggageCustodyEvents)
            .where(eq(s.baggageCustodyEvents.baggageId, results[0].id))
        ).length,
        0
      );
      await assert.rejects(
        registerBaggage({ ...input, weight: 11 }, bagActor),
        /different payload/
      );
      await changeDcsFlightState(
        { flightId: j.key().flightId, action: "close", ...command() },
        actor
      );
      const replay = await registerBaggage(input, bagActor);
      assert.deepEqual(replay, results[0]);
      assert(
        replay.createdAt instanceof Date,
        "Receipt replay must restore dates"
      );
      await assert.rejects(
        registerBaggage({ ...input, idempotencyKey: randomUUID() }, bagActor),
        /closed/
      );
    }
  );

  await check(
    "DCS: distinct baggage keys cannot race beyond passenger-sector allowance",
    async () => {
      const j = await journey();
      await staffCheckIn(j.key());
      const result = await Promise.allSettled([
        registerBaggage(j.bag(15), bagActor),
        registerBaggage(j.bag(15), bagActor),
      ]);
      assert.equal(result.filter(r => r.status === "fulfilled").length, 1);
      const failure = result.find(r => r.status === "rejected");
      assert(
        failure?.status === "rejected" &&
          /exceeds funded allowance/.test(failure.reason.message)
      );
      assert.equal((await bags(j.bookingId)).length, 1);
      await registerBaggage(j.bag(8), bagActor);
      await assert.rejects(
        registerBaggage(j.bag(0.01), bagActor),
        /exceeds funded allowance/
      );
      const grams = (await bags(j.bookingId)).reduce(
        (sum, b) => sum + Math.round(Number(b.weight) * 1000),
        0
      );
      assert.equal(grams, 23000);
    }
  );

  await check(
    "DCS: physical registration and offload serialize without an abandoned bag",
    async () => {
      const j = await journey();
      await staffCheckIn(j.key());
      const [registration, offload] = await Promise.allSettled([
        registerBaggage(j.bag(10), bagActor),
        transitionDcsPassenger(
          { ...j.key(), action: "offload", ...command() },
          actor
        ),
      ]);
      assert.equal(
        [registration, offload].filter(r => r.status === "fulfilled").length,
        1
      );
      const seat = await storedSeat(j.key());
      if (registration.status === "fulfilled") {
        assert.equal(offload.status, "rejected");
        assert(
          offload.status === "rejected" &&
            /baggage/i.test(offload.reason.message)
        );
        assert.equal(seat.status, "checked_in");
        assert(seat.checkInNonce);
        assert.equal((await bags(j.bookingId)).length, 1);
      } else {
        assert.equal(offload.status, "fulfilled");
        assert.equal(registration.reason.code, "PRECONDITION_FAILED");
        assert.equal(seat.status, "occupied");
        assert.equal(seat.checkInNonce, null);
        assert.equal((await bags(j.bookingId)).length, 0);
      }
    }
  );

  await check(
    "DCS: flight closure and customer check-in serialize on the same flight row",
    async () => {
      const j = await journey();
      const customer = () =>
        checkInPassengers({
          bookingId: j.bookingId,
          flightId: j.key().flightId,
          assignments: [{ passengerId: j.key().passengerId }],
          owner: { userId: ownerId, tenantId },
        });
      const [closure, checkIn] = await Promise.allSettled([
        changeDcsFlightState(
          { flightId: j.key().flightId, action: "close", ...command() },
          actor
        ),
        customer(),
      ]);
      assert.equal(closure.status, "fulfilled");
      const desk = await getDcsDesk(j.key().flightId, actor);
      assert.equal(desk.checkInState, "closed");
      assert.equal(
        desk.passengers[0].checkedIn,
        checkIn.status === "fulfilled"
      );
      if (checkIn.status === "rejected")
        assert.equal(checkIn.reason.code, "PRECONDITION_FAILED");
      await assert.rejects(customer(), /closed by departure control/);
      await changeDcsFlightState(
        { flightId: j.key().flightId, action: "reopen", ...command() },
        actor
      );
      await customer();
      assert.equal((await storedSeat(j.key())).status, "checked_in");
    }
  );

  await check(
    "DCS: denial survives offload and nonce rotates only after authorized recheck-in",
    async () => {
      const j = await journey(2);
      await staffCheckIn(j.key());
      await staffCheckIn(j.key(1));
      const nonce = (await storedSeat(j.key())).checkInNonce;
      assert(nonce);
      await transitionDcsPassenger(
        { ...j.key(), action: "deny", ...command() },
        actor
      );
      await assert.rejects(staffCheckIn(j.key()), /denied/);
      const offloaded = await transitionDcsPassenger(
        { ...j.key(), action: "offload", ...command() },
        actor
      );
      assert.equal(offloaded.state, "boarding_denied");
      const denied = (
        await getDcsDesk(j.key().flightId, actor)
      ).passengers.find(p => p.passengerId === j.key().passengerId);
      assert(denied);
      assert.equal(denied.boardingDenied, true);
      assert.equal(denied.attendanceState, "offloaded");
      assert.equal((await storedSeat(j.key())).checkInNonce, null);
      await assert.rejects(staffCheckIn(j.key()), /denied/);
      const [coupon] = await db
        .select()
        .from(s.ticketCoupons)
        .where(
          and(
            eq(s.ticketCoupons.bookingId, j.bookingId),
            eq(s.ticketCoupons.passengerId, j.key().passengerId),
            eq(s.ticketCoupons.flightId, j.key().flightId)
          )
        );
      assert.equal(coupon.status, "O");
      assert.equal((await storedSeat(j.key(1))).status, "checked_in");
      await transitionDcsPassenger(
        { ...j.key(), action: "allow", ...command() },
        actor
      );
      await assert.rejects(
        transitionDcsPassenger(
          { ...j.key(), action: "board", ...command() },
          actor
        ),
        /check in again/
      );
      await staffCheckIn(j.key());
      assert.notEqual((await storedSeat(j.key())).checkInNonce, nonce);
      const board = { ...j.key(), action: "board" as const, ...command() };
      const [first, retry] = await Promise.all([
        transitionDcsPassenger(board, actor),
        transitionDcsPassenger(board, actor),
      ]);
      assert.deepEqual(first, retry);
      assert.equal(first.state, "boarded");
      await assert.rejects(
        transitionDcsPassenger({ ...board, action: "deplane" }, actor),
        /different payload/
      );
      await assert.rejects(
        transitionDcsPassenger(
          { ...j.key(), action: "offload", ...command() },
          actor
        ),
        /Deplane/
      );
      await transitionDcsPassenger(
        { ...j.key(), action: "deplane", ...command() },
        actor
      );
      const events = await db
        .select()
        .from(s.dcsOperationEvents)
        .where(
          and(
            eq(s.dcsOperationEvents.bookingId, j.bookingId),
            eq(s.dcsOperationEvents.passengerId, j.key().passengerId)
          )
        );
      assert.equal(events.filter(e => e.action === "board").length, 1);
      assert(
        events.every(
          e =>
            e.actorId === operatorId &&
            e.reason.length >= 5 &&
            e.requestHash.length === 64
        )
      );
      const [booking] = await db
        .select()
        .from(s.bookings)
        .where(eq(s.bookings.id, j.bookingId));
      assert.equal(
        booking.userId,
        ownerId,
        "Staff check-in must not impersonate or transfer the owner"
      );
    }
  );

  await check(
    "DCS: recovery after cutoff or cancellation preserves receipts and cannot reopen boarding",
    async () => {
      for (const status of ["delayed", "cancelled"] as const) {
        const j = await journey();
        await staffCheckIn(j.key());
        await transitionDcsPassenger(
          { ...j.key(), action: "board", ...command() },
          actor
        );
        const nonce = (await storedSeat(j.key())).checkInNonce;
        assert(nonce);
        // Preserve the paid active sector and current seat. No movement or
        // financial event is fabricated by changing this fixture's flight row.
        await db
          .update(s.flights)
          .set({
            status,
            departureTime: new Date(Date.now() - 60000),
          })
          .where(eq(s.flights.id, j.key().flightId));
        const deplane = {
          ...j.key(),
          action: "deplane" as const,
          ...command(),
        };
        const [first, retry] = await Promise.all([
          transitionDcsPassenger(deplane, actor),
          transitionDcsPassenger(deplane, actor),
        ]);
        assert.deepEqual(retry, first);
        assert.equal(first.state, "checked_in");
        assert.equal((await storedSeat(j.key())).checkInNonce, nonce);
        for (const action of ["board", "deny", "allow"] as const)
          await assert.rejects(
            transitionDcsPassenger({ ...j.key(), action, ...command() }, actor),
            { code: "PRECONDITION_FAILED" }
          );
        const offload = {
          ...j.key(),
          action: "offload" as const,
          ...command(),
        };
        const [offloaded, offloadRetry] = await Promise.all([
          transitionDcsPassenger(offload, actor),
          transitionDcsPassenger(offload, actor),
        ]);
        assert.deepEqual(offloadRetry, offloaded);
        assert.equal(offloaded.state, "offloaded");
        assert.equal((await storedSeat(j.key())).status, "occupied");
        assert.equal((await storedSeat(j.key())).checkInNonce, null);
        const [coupon] = await db
          .select()
          .from(s.ticketCoupons)
          .where(
            and(
              eq(s.ticketCoupons.bookingId, j.bookingId),
              eq(s.ticketCoupons.passengerId, j.key().passengerId),
              eq(s.ticketCoupons.flightId, j.key().flightId)
            )
          );
        assert.equal(coupon.status, "O");
        const events = await db
          .select()
          .from(s.dcsOperationEvents)
          .where(eq(s.dcsOperationEvents.bookingId, j.bookingId));
        assert.equal(events.filter(e => e.action === "deplane").length, 1);
        assert.equal(events.filter(e => e.action === "offload").length, 1);
        assert.equal(events.length, 4);
        assert(
          events.every(e => e.actorId === operatorId && e.reason.length >= 5)
        );
        const current = await getDcsDesk(j.key().flightId, actor);
        assert.equal(current.passengers[0].attendanceState, "offloaded");
        assert.equal(current.passengers[0].checkedIn, false);
      }
    }
  );

  await check(
    "DCS: recovery retains tenant and baggage guards and refuses completed flights",
    async () => {
      const j = await journey();
      await staffCheckIn(j.key());
      const bag = await registerBaggage(j.bag(10), bagActor);
      await transitionDcsPassenger(
        { ...j.key(), action: "board", ...command() },
        actor
      );
      const nonce = (await storedSeat(j.key())).checkInNonce;
      await db
        .update(s.flights)
        .set({
          status: "cancelled",
          departureTime: new Date(Date.now() - 60000),
        })
        .where(eq(s.flights.id, j.key().flightId));
      await assert.rejects(
        transitionDcsPassenger(
          { ...j.key(), action: "deplane", ...command() },
          otherActor
        ),
        { code: "FORBIDDEN" }
      );
      await transitionDcsPassenger(
        { ...j.key(), action: "deplane", ...command() },
        actor
      );
      await assert.rejects(
        transitionDcsPassenger(
          { ...j.key(), action: "offload", ...command() },
          actor
        ),
        { code: "PRECONDITION_FAILED", message: /baggage/i }
      );
      assert.equal((await storedSeat(j.key())).status, "checked_in");
      assert.equal((await storedSeat(j.key())).checkInNonce, nonce);
      assert.equal((await bags(j.bookingId))[0].id, bag.id);
      const blocked = await getDcsDesk(j.key().flightId, actor);
      assert.equal(blocked.passengers[0].attendanceState, "checked_in");
      assert.equal(
        blocked.history.filter(e => e.action === "offload").length,
        0
      );

      const completed = await journey();
      await staffCheckIn(completed.key());
      await transitionDcsPassenger(
        { ...completed.key(), action: "board", ...command() },
        actor
      );
      await db
        .update(s.flights)
        .set({ status: "completed" })
        .where(eq(s.flights.id, completed.key().flightId));
      for (const action of ["deplane", "offload"] as const)
        await assert.rejects(
          transitionDcsPassenger(
            { ...completed.key(), action, ...command() },
            actor
          ),
          { code: "PRECONDITION_FAILED" }
        );
      assert.equal((await storedSeat(completed.key())).status, "checked_in");
      assert.equal(
        (await getDcsDesk(completed.key().flightId, actor)).passengers[0]
          .attendanceState,
        "boarded"
      );
    }
  );

  await check(
    "DCS: seat selection honors denial while release cannot grant boarding permission",
    async () => {
      const j = await journey();
      const { flightId, passengerId } = j.key();
      await selectSeat(flightId, "1A", j.bookingId, passengerId);
      await transitionDcsPassenger(
        { ...j.key(), action: "deny", ...command() },
        actor
      );
      await assert.rejects(
        changeSeat(flightId, "1A", "1B", j.bookingId, passengerId),
        /denied/i
      );
      await assert.rejects(
        selectSeat(flightId, "1B", j.bookingId, passengerId),
        /denied/i
      );
      assert.equal((await storedSeat(j.key())).seatNumber, "1A");
      await transitionDcsPassenger(
        { ...j.key(), action: "allow", ...command() },
        actor
      );
      await selectSeat(flightId, "1B", j.bookingId, passengerId);
      await staffCheckIn(j.key());
      await transitionDcsPassenger(
        { ...j.key(), action: "deny", ...command() },
        actor
      );
      await transitionDcsPassenger(
        { ...j.key(), action: "offload", ...command() },
        actor
      );
      await releaseSeat(flightId, "1B");
      const current = await getDcsDesk(flightId, actor);
      assert.equal(current.passengers[0].boardingDenied, true);
      assert.equal(current.passengers[0].attendanceState, "offloaded");
      assert.equal(current.passengers[0].seatNumber, null);
      await assert.rejects(staffCheckIn(j.key()), /denied/i);
      await assert.rejects(
        transitionDcsPassenger(
          { ...j.key(), action: "board", ...command() },
          actor
        ),
        /denied/i
      );
    }
  );

  await check(
    "DCS: unrelated tenant operators cannot read or mutate the departure desk",
    async () => {
      const j = await journey();
      await assert.rejects(getDcsDesk(j.key().flightId, otherActor), {
        code: "FORBIDDEN",
      });
      await assert.rejects(
        checkInDcsPassenger({ ...j.key(), ...command() }, otherActor),
        { code: "FORBIDDEN" }
      );
      await assert.rejects(
        changeDcsFlightState(
          { flightId: j.key().flightId, action: "close", ...command() },
          otherActor
        ),
        { code: "FORBIDDEN" }
      );
      await assert.rejects(
        registerBaggage(j.bag(10), {
          id: otherOperatorId,
          role: "ops",
          tenantId: otherTenantId,
        }),
        { code: "NOT_FOUND" }
      );
      await assert.rejects(
        getDcsDesk(j.key().flightId, { ...actor, role: "finance" }),
        { code: "FORBIDDEN" }
      );
      assert.equal((await bags(j.bookingId)).length, 0);
      assert.equal(
        (
          await db
            .select()
            .from(s.dcsOperationEvents)
            .where(eq(s.dcsOperationEvents.flightId, j.key().flightId))
        ).length,
        0
      );
    }
  );

  await check(
    "DCS: exact counter sector is excluded from onward baggage closeout and manifest",
    async () => {
      const j = await journey(1, 2);
      await staffCheckIn(j.key());
      await staffCheckIn(j.key(0, 1));
      const bag = await registerBaggage(j.bag(10), bagActor);
      assert.equal(bag.flightId, j.flightIds[0]);
      const first = await getFlightBaggageCloseout(j.flightIds[0], tenantId);
      const onward = await getFlightBaggageCloseout(j.flightIds[1], tenantId);
      assert.equal(first.expectedBags, 1);
      assert.equal(first.readyToClose, false);
      assert.equal(
        first.acceptedOrTransferred,
        0,
        "A staff receipt is not signed custody evidence"
      );
      assert.equal(onward.expectedBags, 0);
      assert.equal(
        (await generateFlightManifest(j.flightIds[0])).manifest.baggage.pieces,
        1
      );
      assert.equal(
        (await generateFlightManifest(j.flightIds[1])).manifest.baggage.pieces,
        0
      );
      // A provably different sector is not a reason to block this passenger's
      // onward offload; the first-sector receipt remains protected and unchanged.
      await transitionDcsPassenger(
        { ...j.key(0, 1), action: "offload", ...command() },
        actor
      );
      await assert.rejects(
        transitionDcsPassenger(
          { ...j.key(), action: "offload", ...command() },
          actor
        ),
        /baggage/i
      );
      assert.equal((await bags(j.bookingId))[0].id, bag.id);
    }
  );

  await check(
    "DCS: a late full refund cannot erase unresolved physical baggage or recorded boarding",
    async () => {
      const j = await journey(1, 2);
      await staffCheckIn(j.key());
      const bag = await registerBaggage(j.bag(10), bagActor);
      await transitionDcsPassenger(
        { ...j.key(), action: "board", ...command() },
        actor
      );
      const baglessSector = j.key(0, 1);
      await staffCheckIn(baglessSector);
      await transitionDcsPassenger(
        { ...baglessSector, action: "board", ...command() },
        actor
      );
      const before = (await generateFlightManifest(baglessSector.flightId))
        .manifest;
      assert.equal(before.baggage.pieces, 0);
      assert.deepEqual(
        before.passengers.list.map(p => p.id),
        [baglessSector.passengerId]
      );
      const validSeat = await storedSeat(baglessSector);
      await db
        .update(s.seatInventory)
        .set({ checkInNonce: null })
        .where(eq(s.seatInventory.id, validSeat.id));
      for (const read of [
        () => generateFlightManifest(baglessSector.flightId),
        () => getDcsDesk(baglessSector.flightId, actor),
      ])
        await assert.rejects(read(), {
          code: "PRECONDITION_FAILED",
          message: /reconciliation.*boarded passenger/i,
        });
      await db
        .update(s.seatInventory)
        .set({ checkInNonce: validSeat.checkInNonce })
        .where(eq(s.seatInventory.id, validSeat.id));
      const [funded] = await db
        .select()
        .from(s.bookings)
        .where(eq(s.bookings.id, j.bookingId));
      const paymentIntentId = `pi_dcs_counter_${j.bookingId}`;
      await db.transaction(tx =>
        settleVerifiedRefund(tx, {
          paymentIntentId,
          chargeId: `ch_dcs_counter_${j.bookingId}`,
          amount: funded.totalAmount,
          amountRefunded: funded.totalAmount,
          currency: "sar",
          eventId: `evt_dcs_counter_refund_${randomUUID()}`,
        })
      );
      const [refunded] = await db
        .select()
        .from(s.bookings)
        .where(eq(s.bookings.id, j.bookingId));
      const [receipt] = await db
        .select()
        .from(s.paymentReceipts)
        .where(eq(s.paymentReceipts.paymentIntentId, paymentIntentId));
      assert.equal(refunded.paymentStatus, "refunded");
      assert.equal(refunded.status, "cancelled");
      assert.equal(receipt.refundedAmount, funded.totalAmount);
      assert.equal(await storedSeat(j.key()), undefined);
      const [state] = await db
        .select()
        .from(s.dcsPassengerStates)
        .where(
          and(
            eq(s.dcsPassengerStates.bookingId, j.bookingId),
            eq(s.dcsPassengerStates.passengerId, j.key().passengerId),
            eq(s.dcsPassengerStates.flightId, j.key().flightId)
          )
        );
      assert.equal(state.state, "boarded");
      await assert.rejects(getDcsDesk(j.key().flightId, actor), {
        code: "PRECONDITION_FAILED",
        message: /reconciliation/i,
      });
      await assert.rejects(generateFlightManifest(baglessSector.flightId), {
        code: "PRECONDITION_FAILED",
        message: /reconciliation.*boarded passenger/i,
      });
      const closeout = await getFlightBaggageCloseout(
        j.key().flightId,
        tenantId
      );
      assert.equal(closeout.readyToClose, false);
      assert(closeout.unexpectedBags >= 1);
      assert(closeout.unresolvedRegistrations.includes(bag.tagNumber));
      await assert.rejects(generateFlightManifest(j.key().flightId), {
        code: "PRECONDITION_FAILED",
        message: /reconciliation/i,
      });
      assert.equal(
        (
          await db
            .select()
            .from(s.baggageCustodyEvents)
            .where(eq(s.baggageCustodyEvents.baggageId, bag.id))
        ).length,
        0,
        "A financial refund cannot invent physical baggage return evidence"
      );
      const history = await db
        .select()
        .from(s.dcsOperationEvents)
        .where(eq(s.dcsOperationEvents.bookingId, j.bookingId));
      assert.deepEqual(
        history.map(event => event.action).sort(),
        ["board", "board", "check_in", "check_in"],
        "Readers must not invent a deplane or offload event"
      );
      assert.equal((await bags(j.bookingId))[0].id, bag.id);
    }
  );
  const supervisor = { ...actor, role: "airline_admin" as const };
  await check(
    "DCS station: scoped APFAX, meal status and case resolution",
    async () => {
      const j = await journey(1, 2);
      const key = j.key(),
        onward = j.key(0, 1);
      const commandInput = { ...key, ...command() };
      const entry = await openDeskCase(
        { ...commandInput, kind: "no_rec", stationReference: "DESK-9" },
        actor
      );
      await resolveDeskCase(
        { ...key, ...command(), caseId: entry.eventId },
        actor
      );
      await addDeskNote(
        { ...key, ...command(), reason: "Assistance requested at gate" },
        actor
      );
      const meal = {
        bookingId: j.bookingId,
        passengerId: key.passengerId,
        serviceType: "meal" as const,
        serviceCode: "VGML",
        status: "confirmed" as const,
      };
      await db.insert(s.specialServices).values([
        {
          ...meal,
          flightId: key.flightId,
          bookingSegmentId: j.bag(1).segmentId,
        },
        {
          ...meal,
          serviceType: "wheelchair",
          serviceCode: "WCHR",
          status: "pending",
          flightId: key.flightId,
          bookingSegmentId: j.bag(1).segmentId,
        },
        {
          ...meal,
          serviceCode: "GFML",
          flightId: onward.flightId,
          bookingSegmentId: j.bag(1, 0, 1).segmentId,
        },
        { ...meal, serviceCode: "AVML" },
      ]);
      const report = await getStationReport(key.flightId, actor);
      assert.deepEqual(
        report.items.map(i => [i.code, i.status]),
        [
          ["VGML", "confirmed"],
          ["WCHR", "pending"],
          ["OSI", "recorded"],
        ]
      );
      assert.equal(report.unresolvedServices, 1);
      assert.equal(report.cases[0].resolvedPassengerId, key.passengerId);
      assert.deepEqual(
        (await getStationReport(onward.flightId, actor)).items.map(i => i.code),
        ["GFML"]
      );
      await assert.rejects(getStationReport(key.flightId, otherActor), {
        code: "FORBIDDEN",
      });
    }
  );
  await check(
    "DCS station: check-in close, final close, supervised reopening and observed OUT",
    async () => {
      const j = await journey(),
        key = j.key(),
        flightId = key.flightId;
      const entry = await openDeskCase(
        {
          flightId,
          ...command(),
          kind: "go_show",
          stationReference: "DESK-OUT",
        },
        actor
      );
      await staffCheckIn(key);
      await changeDcsFlightState(
        { flightId, action: "close", ...command() },
        actor
      );
      await assert.rejects(
        finalizeDesk({ flightId, action: "close", ...command() }, supervisor),
        /checked-in passengers/
      );
      await transitionDcsPassenger(
        { ...key, action: "board", ...command() },
        actor
      );
      await assert.rejects(
        finalizeDesk({ flightId, action: "close", ...command() }, supervisor),
        /open station cases/
      );
      await dismissDeskCase(
        { flightId, ...command(), caseId: entry.eventId },
        actor
      );
      const close = { flightId, action: "close" as const, ...command() };
      assert.deepEqual(
        await finalizeDesk(close, supervisor),
        await finalizeDesk(close, supervisor)
      );
      assert((await getStationReport(flightId, actor)).closedAt);
      await assert.rejects(
        transitionDcsPassenger(
          { ...key, action: "deplane", ...command() },
          actor
        ),
        /final DCS closure/i
      );
      await finalizeDesk(
        { flightId, action: "reopen", ...command() },
        supervisor
      );
      assert.equal((await getStationReport(flightId, actor)).closedAt, null);
      await finalizeDesk(
        { flightId, action: "close", ...command() },
        supervisor
      );
      await finalizeDesk(
        {
          flightId,
          action: "record_out",
          offBlocksAt: new Date().toISOString(),
          ...command(),
        },
        supervisor
      );
      assert((await getStationReport(flightId, actor)).stationOffBlocksAt);
      await assert.rejects(
        finalizeDesk({ flightId, action: "reopen", ...command() }, supervisor),
        /OUT/
      );
    }
  );
  await check(
    "DCS station: inventory admission, funded receipts and departure evidence across final closure",
    async () => {
      const j = await journey(1, 2);
      const key = j.key(0, 1);
      const flightId = key.flightId;
      const note = { ...key, ...command() };
      const [, noteReceipt] = await Promise.all([
        staffCheckIn(key),
        addDeskNote(note, actor),
      ]);
      await transitionDcsPassenger(
        { ...key, action: "board", ...command() },
        actor
      );
      await changeDcsFlightState(
        { flightId, action: "close", ...command() },
        actor
      );
      const close = { flightId, action: "close" as const, ...command() };
      const hold = await createInventoryLock(
        flightId,
        1,
        "economy",
        randomUUID()
      );
      await assert.rejects(
        finalizeDesk(close, supervisor),
        /active seat holds/
      );
      await releaseInventoryLock(hold.lockId);
      const [{ id: legacy }] = await db
        .insert(s.seatHolds)
        .values({
          flightId,
          cabinClass: "economy",
          seats: 1,
          sessionId: randomUUID(),
          expiresAt: new Date(Date.now() + 600000),
        })
        .$returningId();
      await assert.rejects(
        finalizeDesk(close, supervisor),
        /active seat holds/
      );
      await db
        .update(s.seatHolds)
        .set({ status: "expired" })
        .where(eq(s.seatHolds.id, legacy));
      const reference = randomUUID()
        .replaceAll("-", "")
        .slice(0, 6)
        .toUpperCase();
      const [{ id: late }] = await db
        .insert(s.bookings)
        .values({
          tenantId,
          userId: ownerId,
          flightId,
          bookingReference: reference,
          pnr: reference,
          cabinClass: "economy",
          numberOfPassengers: 1,
          totalAmount: 10000,
          status: "pending",
          paymentStatus: "pending",
          seatsReserved: true,
        })
        .$returningId();
      await assert.rejects(
        finalizeDesk(close, supervisor),
        /pending reserved bookings/
      );
      await db
        .update(s.bookings)
        .set({ seatsReserved: false })
        .where(eq(s.bookings.id, late));
      await finalizeDesk(close, supervisor);
      assert.deepEqual(await addDeskNote(note, actor), noteReceipt);
      await assert.rejects(
        createInventoryLock(flightId, 1, "economy", randomUUID()),
        /Final DCS closure/
      );
      await db.transaction(tx =>
        settleVerifiedPayment(tx, {
          paymentIntentId: "pi_station_late_" + late,
          amount: 10000,
          currency: "sar",
          eventId: randomUUID(),
          metadata: { bookingId: String(late), userId: String(ownerId) },
        })
      );
      const [lateReceipt] = await db
        .select()
        .from(s.paymentReceipts)
        .where(eq(s.paymentReceipts.bookingId, late));
      assert.equal(lateReceipt.settlementStatus, "review_required");
      const [lateBooking] = await db
        .select()
        .from(s.bookings)
        .where(eq(s.bookings.id, late));
      assert.equal(lateBooking.seatsReserved, false);
      await assert.rejects(
        cancelBooking(j.bookingId, ownerId, tenantId),
        /Final DCS closure/
      );
      await finalizeDesk(
        {
          flightId,
          action: "record_out",
          offBlocksAt: new Date().toISOString(),
          ...command(),
        },
        supervisor
      );
      await assert.rejects(
        cancelBooking(j.bookingId, ownerId, tenantId),
        /Final DCS closure/
      );
      const seat = await storedSeat(key);
      const [paid] = await db
        .select()
        .from(s.paymentReceipts)
        .where(eq(s.paymentReceipts.bookingId, j.bookingId));
      const refund = {
        paymentIntentId: paid.paymentIntentId,
        chargeId: "ch_station_" + j.bookingId,
        amount: paid.amount,
        amountRefunded: paid.amount,
        currency: "sar",
        eventId: randomUUID(),
      };
      for (let i = 0; i < 2; i++)
        await db.transaction(tx => settleVerifiedRefund(tx, refund));
      const [receipt] = await db
        .select()
        .from(s.paymentReceipts)
        .where(eq(s.paymentReceipts.bookingId, j.bookingId));
      assert.equal(receipt.refundedAmount, paid.amount);
      assert.equal(receipt.settlementStatus, "review_required");
      assert.equal(
        (
          await db
            .select()
            .from(s.financialLedger)
            .where(eq(s.financialLedger.stripeEventId, refund.eventId))
        ).length,
        1
      );
      assert.deepEqual(await storedSeat(key), seat);
      assert.equal(
        (await getDcsDesk(flightId, actor)).passengers[0].attendanceState,
        "boarded"
      );
      assert.deepEqual(
        (await generateFlightManifest(flightId)).manifest.passengers.list.map(
          p => p.id
        ),
        [key.passengerId]
      );
    }
  );
  for (const reopen of [false, true])
    await check(
      `DCS station: refunded departure blocks new admission on ${reopen ? "a supervised reopened" : "another open"} sector`,
      async () => {
        const j = await journey(2, 2);
        const closed = j.key(0, 0);
        const target = j.key(0, reopen ? 0 : 1);
        const newPassenger = j.key(1, reopen ? 0 : 1);
        await staffCheckIn(closed);
        if (!reopen) await staffCheckIn(target);
        const pass = await issueBoardingPass(target, { userId: ownerId });
        await transitionDcsPassenger(
          { ...closed, action: "board", ...command() },
          actor
        );
        await changeDcsFlightState(
          { flightId: closed.flightId, action: "close", ...command() },
          actor
        );
        await finalizeDesk(
          { flightId: closed.flightId, action: "close", ...command() },
          supervisor
        );
        if (!reopen)
          await finalizeDesk(
            {
              flightId: closed.flightId,
              action: "record_out",
              offBlocksAt: new Date().toISOString(),
              ...command(),
            },
            supervisor
          );
        const seat = await storedSeat(closed);
        const manifest = (await generateFlightManifest(closed.flightId))
          .manifest.passengers.list;
        const [paid] = await db
          .select()
          .from(s.paymentReceipts)
          .where(eq(s.paymentReceipts.bookingId, j.bookingId));
        const refund = {
          paymentIntentId: paid.paymentIntentId,
          chargeId: "ch_departure_hold_" + j.bookingId,
          amount: paid.amount,
          amountRefunded: paid.amount,
          currency: "sar",
          eventId: randomUUID(),
        };
        for (let i = 0; i < 2; i++)
          await db.transaction(tx => settleVerifiedRefund(tx, refund));
        const [receipt] = await db
          .select()
          .from(s.paymentReceipts)
          .where(eq(s.paymentReceipts.paymentIntentId, paid.paymentIntentId));
        assert.equal(receipt.refundedAmount, paid.amount);
        assert.equal(receipt.settlementStatus, "review_required");
        assert.match(receipt.settlementError ?? "", /departure reconciliation/);
        assert.equal(
          (
            await db
              .select()
              .from(s.financialLedger)
              .where(eq(s.financialLedger.stripeEventId, refund.eventId))
          ).length,
          1
        );
        assert.deepEqual(await storedSeat(closed), seat);
        assert.deepEqual(
          (await generateFlightManifest(closed.flightId)).manifest.passengers
            .list,
          manifest
        );
        if (reopen) {
          await finalizeDesk(
            { flightId: closed.flightId, action: "reopen", ...command() },
            supervisor
          );
          await changeDcsFlightState(
            { flightId: closed.flightId, action: "reopen", ...command() },
            actor
          );
        }
        await assert.rejects(
          staffCheckIn(newPassenger),
          /departure reconciliation/i
        );
        await assert.rejects(
          checkInPassengers({
            bookingId: j.bookingId,
            flightId: target.flightId,
            assignments: [{ passengerId: newPassenger.passengerId }],
            owner: { userId: ownerId, tenantId },
          }),
          /departure reconciliation/i
        );
        await assert.rejects(
          transitionDcsPassenger(
            { ...target, action: "board", ...command() },
            actor
          ),
          /departure reconciliation/i
        );
        await assert.rejects(
          issueBoardingPass(target, { userId: ownerId }),
          /departure reconciliation/i
        );
        assert.equal((await verifyActiveBoardingPass(pass.token)).valid, false);
        assert.equal((await verifyActiveBoardingPass(pass.bcbp)).valid, false);
        await assert.rejects(
          selectSeat(
            target.flightId,
            "2A",
            j.bookingId,
            newPassenger.passengerId
          ),
          /departure reconciliation/i
        );
        await assert.rejects(
          registerBaggage(j.bag(10, 0, reopen ? 0 : 1), bagActor),
          /departure reconciliation/i
        );
        assert.deepEqual(await storedSeat(closed), seat);
        assert.equal(
          (await getDcsDesk(closed.flightId, actor)).passengers.find(
            p => p.passengerId === closed.passengerId
          )?.attendanceState,
          "boarded"
        );
        if (reopen) {
          assert.equal(
            (
              await transitionDcsPassenger(
                { ...closed, action: "deplane", ...command() },
                actor
              )
            ).state,
            "checked_in"
          );
          assert.equal(
            (
              await transitionDcsPassenger(
                { ...closed, action: "offload", ...command() },
                actor
              )
            ).state,
            "offloaded"
          );
          await assert.rejects(
            staffCheckIn(closed),
            /departure reconciliation/i
          );
        }
      }
    );
  await check(
    "DCS station: cancellation after final closure allows supervised recovery before OUT",
    async () => {
      const j = await journey(),
        key = j.key(),
        flightId = key.flightId;
      await staffCheckIn(key);
      await transitionDcsPassenger(
        { ...key, action: "board", ...command() },
        actor
      );
      await changeDcsFlightState(
        { flightId, action: "close", ...command() },
        actor
      );
      await finalizeDesk(
        { flightId, action: "close", ...command() },
        supervisor
      );
      assert((await getStationReport(flightId, actor)).closedAt);
      const [before] = await db
        .select()
        .from(s.bookings)
        .where(eq(s.bookings.id, j.bookingId));
      await db
        .update(s.flights)
        .set({ status: "cancelled" })
        .where(eq(s.flights.id, flightId));
      await assert.rejects(
        transitionDcsPassenger(
          { ...key, action: "deplane", ...command() },
          actor
        ),
        /final DCS closure/i
      );
      for (const action of ["close", "record_out"] as const)
        await assert.rejects(
          finalizeDesk(
            {
              flightId,
              action,
              ...(action === "record_out"
                ? { offBlocksAt: new Date().toISOString() }
                : {}),
              ...command(),
            },
            supervisor
          ),
          /outside active station operations/i
        );
      const reopen = { flightId, action: "reopen" as const, ...command() };
      assert.throws(() => finalizeDesk(reopen, actor), { code: "FORBIDDEN" });
      const receipt = await finalizeDesk(reopen, supervisor);
      assert.deepEqual(await finalizeDesk(reopen, supervisor), receipt);
      const desk = await getDcsDesk(flightId, actor);
      assert.equal(desk.flight.status, "cancelled");
      assert.equal(desk.flight.dcsClosedAt, null);
      assert.equal(desk.flight.stationOffBlocksAt, null);
      assert.equal(desk.checkInState, "closed");
      assert.equal(
        (
          await transitionDcsPassenger(
            { ...key, action: "deplane", ...command() },
            actor
          )
        ).state,
        "checked_in"
      );
      await assert.rejects(
        transitionDcsPassenger({ ...key, action: "board", ...command() }, actor)
      );
      assert.equal(
        (
          await transitionDcsPassenger(
            { ...key, action: "offload", ...command() },
            actor
          )
        ).state,
        "offloaded"
      );
      const [after] = await db
        .select()
        .from(s.bookings)
        .where(eq(s.bookings.id, j.bookingId));
      assert.equal(after.status, before.status);
      assert.equal(after.paymentStatus, before.paymentStatus);
      assert.equal(after.totalAmount, before.totalAmount);
      assert.equal(after.seatsReserved, before.seatsReserved);
      assert.equal((await storedSeat(key)).checkInNonce, null);
      const [payment] = await db
        .select()
        .from(s.paymentReceipts)
        .where(
          eq(s.paymentReceipts.paymentIntentId, `pi_dcs_counter_${j.bookingId}`)
        );
      assert.equal(payment.refundedAmount, 0);
    }
  );
  await check(
    "DCS station: final closure rejects a registered bag without a boarded passenger",
    async () => {
      const j = await journey(2);
      const first = j.key(),
        second = j.key(1);
      await staffCheckIn(first);
      await staffCheckIn(second);
      await registerBaggage(j.bag(2, 1), bagActor);
      await transitionDcsPassenger(
        { ...first, action: "board", ...command() },
        actor
      );
      await changeDcsFlightState(
        { flightId: first.flightId, action: "close", ...command() },
        actor
      );
      // An inconsistent legacy seat release must not clear the passenger-to-bag check.
      const secondSeat = await storedSeat(second);
      await db
        .update(s.seatInventory)
        .set({
          status: "available",
          bookingId: null,
          passengerId: null,
          checkInNonce: null,
        })
        .where(eq(s.seatInventory.id, secondSeat.id));
      await assert.rejects(
        finalizeDesk(
          { flightId: first.flightId, action: "close", ...command() },
          supervisor
        ),
        /baggage for passengers who have not boarded/i
      );
      assert.equal(
        (await getStationReport(first.flightId, actor)).closedAt,
        null
      );
    }
  );
  await check(
    "DCS station: range blocks roll back on conflict, preserve capacity and survive compatible remap",
    async () => {
      const a = await journey(),
        b = await journey(),
        idA = a.key().flightId,
        idB = b.key().flightId;
      const [source] = await db
        .select()
        .from(s.flights)
        .where(eq(s.flights.id, idA));
      await db
        .update(s.flights)
        .set({ flightNumber: source.flightNumber })
        .where(eq(s.flights.id, idB));
      const range = {
        flightId: idA,
        startDate: source.departureTime.toISOString().slice(0, 10),
        endDate: source.departureTime.toISOString().slice(0, 10),
        seatNumbers: ["2B"],
        ...command(),
      };
      const row = (id: number) =>
        and(
          eq(s.seatInventory.flightId, id),
          eq(s.seatInventory.seatNumber, "2B")
        );
      await db
        .update(s.seatInventory)
        .set({ status: "blocked" })
        .where(row(idB));
      await assert.rejects(blockDeskSeats(range, supervisor), /available/);
      const [reverted] = await db
        .select()
        .from(s.seatInventory)
        .where(row(idA));
      assert.equal(reverted.status, "available");
      await db
        .update(s.seatInventory)
        .set({ status: "available" })
        .where(row(idB));
      const [result, opposite] = await Promise.all([
        blockDeskSeats(range, supervisor),
        blockDeskSeats(
          { ...range, ...command(), flightId: idB, seatNumbers: ["2A"] },
          supervisor
        ),
      ]);
      assert.deepEqual(opposite, { flights: 2, seats: 2 });
      assert.deepEqual(result, { flights: 2, seats: 2 });
      assert.deepEqual(await blockDeskSeats(range, supervisor), result);
      for (const id of [idA, idB]) {
        const [f] = await db
          .select()
          .from(s.flights)
          .where(eq(s.flights.id, id));
        assert.equal(f.economyAvailable, source.economyAvailable - 2);
      }
      const [{ id: replacement }] = await db
        .insert(s.seatMaps)
        .values({
          aircraftType: "DCS-FIXTURE",
          airlineId: airline.id,
          configName: "Replacement " + runId,
          totalSeats: 4,
          economySeats: 4,
          cabinLayout: JSON.stringify({
            rows: [1, 2].map(row => ({
              row,
              cabinClass: "economy",
              seats: ["A", "B"].map(column => ({
                column,
                seatType: "window",
                priceTier: "free",
              })),
            })),
          }),
        })
        .$returningId();
      await remapDeskSeats(
        { flightId: idA, seatMapId: replacement, ...command() },
        supervisor
      );
      const [protectedSeat] = await db
        .select()
        .from(s.seatInventory)
        .where(row(idA));
      assert.equal(protectedSeat.status, "blocked");
      assert.equal(protectedSeat.seatMapId, replacement);
    }
  );
  await check(
    "DCS station: confirm quoted cabin exchange without inventing a refund",
    async () => {
      const j = await journey(1, 1, "business"),
        key = j.key();
      const quote = await quoteDeskDowngrade(
        { ...key, ...command() },
        supervisor
      );
      assert(quote.refundDue > 0);
      await assert.rejects(
        confirmDeskDowngrade(
          {
            ...key,
            ...command(),
            quoteEventId: quote.eventId,
            expectedRefund: quote.refundDue - 1,
          },
          supervisor
        ),
        /quote/
      );
      const confirm = {
        ...key,
        ...command(),
        quoteEventId: quote.eventId,
        expectedRefund: quote.refundDue,
      };
      const receipt = await confirmDeskDowngrade(confirm, supervisor);
      assert.equal(receipt.refundDue, quote.refundDue);
      assert.deepEqual(
        await confirmDeskDowngrade(confirm, supervisor),
        receipt
      );
      const [changed] = await db
        .select()
        .from(s.bookings)
        .where(eq(s.bookings.id, j.bookingId));
      assert.equal(changed.cabinClass, "economy");
      const [paid] = await db
        .select()
        .from(s.paymentReceipts)
        .where(
          eq(s.paymentReceipts.paymentIntentId, `pi_dcs_counter_${j.bookingId}`)
        );
      assert.equal(paid.refundedAmount, 0);
    }
  );
  await check(
    "DCS station: reweigh, signed handback and one linked replacement on a funded flight",
    async () => {
      const j = await journey(1, 2),
        key = j.key(),
        next = j.key(0, 1);
      await staffCheckIn(key);
      const input = j.bag(8),
        bag = await registerBaggage(input, bagActor);
      const correction = {
        ...input,
        ...command(),
        baggageId: bag.id,
        previousWeight: 8,
        weight: 7,
        expectedActorId: operatorId,
        expectedTenantId: tenantId,
      };
      await correctCounterBag(correction, bagActor);
      assert.equal(Number((await bags(j.bookingId))[0].weight), 7);
      await staffCheckIn(next);
      const replace = { ...j.bag(7, 0, 1), replacesTag: bag.tagNumber };
      await assert.rejects(
        registerBaggage(replace, bagActor),
        /verified handback/
      );
      let staffReturnedTag: string;
      const previous = process.env.AVIATION_SOURCE_REGISTRY;
      const previousKey = process.env.DCS_FIXTURE_RECOVERY_KEY;
      process.env.DCS_FIXTURE_RECOVERY_KEY = randomUUID();
      process.env.AVIATION_SOURCE_REGISTRY = JSON.stringify([
        {
          sourceId: "disposable-handler",
          tenantId,
          capabilities: ["baggage_recovery"],
          airlineIds: [airline.id],
          airportIds: [origin.id],
          deviceIds: ["fixture-reader"],
          secretEnv: "DCS_FIXTURE_RECOVERY_KEY",
          validUntil: new Date(Date.now() + 86400000).toISOString(),
        },
      ]);
      try {
        const e: EvidenceEnvelope = {
          sourceId: "disposable-handler",
          eventId: randomUUID(),
          issuedAt: new Date().toISOString(),
          observedAt: new Date().toISOString(),
          flightId: key.flightId,
          kind: "baggage_custody",
          payload: {
            tagNumber: bag.tagNumber,
            stage: "return",
            airportId: origin.id,
            deviceId: "fixture-reader",
            previousEvidenceId: null,
          },
        };
        const sig = createHmac("sha256", process.env.DCS_FIXTURE_RECOVERY_KEY)
          .update(calculateRequestHash(e))
          .digest("hex");
        await ingestBaggageCustody(e, sig);
        await setBagReturnGrant(
          {
            flightId: key.flightId,
            airlineId: airline.id,
            airportId: origin.id,
            staffId: operatorId,
            enabled: true,
            ...command(),
          },
          supervisor
        );
        await assert.rejects(
          returnDcsBag(
            {
              ...key,
              ...command(),
              tagNumber: bag.tagNumber,
              segmentId: input.segmentId,
            },
            actor
          ),
          /already returned/
        );
        const otherBag = await registerBaggage(j.bag(1), bagActor);
        staffReturnedTag = otherBag.tagNumber;
        await returnDcsBag(
          {
            ...key,
            ...command(),
            tagNumber: otherBag.tagNumber,
            segmentId: input.segmentId,
          },
          actor
        );
        const duplicate = {
          ...e,
          eventId: randomUUID(),
          payload: { ...e.payload, tagNumber: otherBag.tagNumber },
        };
        const duplicateSignature = createHmac(
          "sha256",
          process.env.DCS_FIXTURE_RECOVERY_KEY
        )
          .update(calculateRequestHash(duplicate))
          .digest("hex");
        await assert.rejects(
          ingestBaggageCustody(duplicate, duplicateSignature),
          /returned to the passenger/
        );
      } finally {
        if (previous === undefined) delete process.env.AVIATION_SOURCE_REGISTRY;
        else process.env.AVIATION_SOURCE_REGISTRY = previous;
        if (previousKey === undefined)
          delete process.env.DCS_FIXTURE_RECOVERY_KEY;
        else process.env.DCS_FIXTURE_RECOVERY_KEY = previousKey;
      }
      await assert.rejects(
        registerBaggage(replace, bagActor),
        /departure station/
      );
      await db
        .update(s.flights)
        .set({ originId: origin.id, destinationId: destination.id })
        .where(eq(s.flights.id, next.flightId));
      const staffReissue = await registerBaggage(
        { ...j.bag(1, 0, 1), replacesTag: staffReturnedTag },
        bagActor
      );
      assert.notEqual(staffReissue.tagNumber, staffReturnedTag);
      const replacement = await registerBaggage(replace, bagActor);
      assert.notEqual(replacement.tagNumber, bag.tagNumber);
      assert.deepEqual(await registerBaggage(replace, bagActor), replacement);
      assert.equal(
        (await bags(j.bookingId)).find(v => v.id === replacement.id)
          ?.replacesBaggageId,
        bag.id
      );
      await assert.rejects(
        registerBaggage({ ...replace, idempotencyKey: randomUUID() }, bagActor),
        /already has a replacement/
      );
      assert.equal(
        (await getFlightBaggageCloseout(key.flightId, tenantId)).expectedBags,
        0
      );
      assert.equal(
        (await getFlightBaggageCloseout(next.flightId, tenantId)).expectedBags,
        2
      );
    }
  );
}
