import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import * as s from "../../drizzle/schema";
import type { SettlementTx } from "../../server/services/booking-settlement.service";
import {
  settleVerifiedPayment,
  settleVerifiedRefund,
} from "../../server/services/payment-settlement.service";
import { readTicketDocument } from "../../server/services/ticket-documents.service";
import { checkInPassengers } from "../../server/services/departure-control.service";
import {
  changeDcsFlightState,
  checkInDcsPassenger,
  getDcsDesk,
  transitionDcsPassenger,
  type DcsActor,
} from "../../server/services/dcs-operations.service";
import {
  registerBaggage,
  type BaggageRegistrationActor,
} from "../../server/services/baggage-registration.service";
import { getFlightBaggageCloseout } from "../../server/services/baggage-custody.service";
import { generateFlightManifest } from "../../server/services/dcs.service";

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

  async function journey(people = 1, sectors = 1) {
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
          businessSeats: 0,
          economyAvailable: 4,
          businessAvailable: 0,
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
    const amount = 10000 * people * sectors;
    const [{ id: bookingId }] = await db
      .insert(s.bookings)
      .values({
        tenantId,
        userId: ownerId,
        flightId: flightIds[0],
        bookingReference: reference,
        pnr: reference,
        cabinClass: "economy",
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
          segmentAmount: 10000 * people,
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
}
