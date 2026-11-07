import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { transactionMemory } from "../__tests__/helpers/transaction-memory";
import {
  TRAINING_REGISTRATION_AIS_TR1,
  TRAINING_REGISTRATION_AIS_TR2,
  TRAINING_TYPE_AIS_T1,
  TRAINING_TYPE_AIS_T1_HD,
} from "./weight-balance-training-fixture";
import type {
  TypeBalanceData,
  RegistrationData,
} from "./weight-balance-engine";

const state = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("../db", () => ({ getDb: () => state.db }));

import {
  applyLastMinuteChange,
  changeAircraft,
  computeLoadSheet,
  getLatestLoadSheet,
  listAircraftChanges,
  listLoadSheetEditions,
  renderLoadSheetDocument,
  signLoadSheet,
} from "./weight-balance.service";
import { getFinalLoadSheetFigures } from "./load-sheet-figures.service";

const effective = new Date("2026-01-01T00:00:00Z");
const typeRow = (id: number, data: TypeBalanceData) => ({
  id,
  tenantId: null,
  typeCode: data.typeCode,
  variant: data.variant,
  version: data.version,
  description: data.description,
  dataSource: data.dataSource,
  fictional: data.fictional,
  approvalStatus: "draft",
  approvalReference: null,
  effectiveFrom: effective,
  effectiveTo: null,
  mtowKg: data.limits.mtowKg,
  mlwKg: data.limits.mlwKg,
  mzfwKg: data.limits.mzfwKg,
  mrwKg: data.limits.mrwKg ?? null,
  maxFuelKg: data.limits.maxFuelKg,
  lmcLimitKg: data.lmcLimitKg,
  payload: data.payload,
  createdBy: 1,
  createdAt: effective,
  updatedAt: effective,
});
const registrationRow = (
  id: number,
  balanceDataId: number,
  data: RegistrationData
) => ({
  id,
  tenantId: null,
  airlineId: 7,
  registration: data.registration,
  balanceDataId,
  typeCode: data.typeCode,
  variant: data.variant,
  dowKg: data.dowKg,
  doi: data.doi.toFixed(2),
  mtowKg: data.limits.mtowKg ?? null,
  mlwKg: data.limits.mlwKg ?? null,
  mzfwKg: data.limits.mzfwKg ?? null,
  mrwKg: data.limits.mrwKg ?? null,
  fuelCapacityKg: data.fuelCapacityKg,
  cabinConfigVersion: data.cabinConfigVersion,
  envelopeRef: data.envelopeRef,
  weighingReference: null,
  approvalStatus: "draft",
  approvalReference: null,
  effectiveFrom: effective,
  effectiveTo: null,
  createdBy: 1,
  createdAt: effective,
  updatedAt: effective,
});

let fixture: ReturnType<typeof transactionMemory>;
const controller = { id: 42, name: "Load Controller" };
const supervisor = { id: 43, name: "Ramp Supervisor" };

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("AIS_ENABLE_DEMOS", "true");
  fixture = transactionMemory({
    flights: [
      {
        id: 101,
        flightNumber: "AIS101",
        airlineId: 7,
        tenantId: null,
        originId: 1,
        destinationId: 2,
        departureTime: new Date("2026-11-03T08:00:00Z"),
        arrivalTime: new Date("2026-11-03T10:00:00Z"),
        status: "scheduled",
      },
    ],
    airports: [
      { id: 1, code: "RUH" },
      { id: 2, code: "JED" },
    ],
    crew_assignments: [
      { id: 1, flightId: 101, role: "captain", status: "confirmed" },
      { id: 2, flightId: 101, role: "first_officer", status: "confirmed" },
      { id: 3, flightId: 101, role: "purser", status: "assigned" },
      { id: 4, flightId: 101, role: "cabin_crew", status: "removed" },
    ],
    bookings: [
      { id: 1, flightId: 101, status: "confirmed", cabinClass: "business" },
      { id: 2, flightId: 101, status: "confirmed", cabinClass: "economy" },
      { id: 3, flightId: 101, status: "cancelled", cabinClass: "economy" },
    ],
    passengers: [
      { id: 1, bookingId: 1, type: "adult", title: "Mr", seatNumber: "2A" },
      { id: 2, bookingId: 1, type: "adult", title: "Mrs", seatNumber: "2B" },
      { id: 3, bookingId: 1, type: "infant", title: null, seatNumber: null },
      { id: 4, bookingId: 2, type: "adult", title: "Mr", seatNumber: "25C" },
      { id: 5, bookingId: 2, type: "child", title: null, seatNumber: "25D" },
      { id: 6, bookingId: 2, type: "adult", title: "Ms", seatNumber: null },
      { id: 7, bookingId: 3, type: "adult", title: "Mr", seatNumber: "12A" },
    ],
    baggage_items: [
      {
        id: 1,
        bookingId: 1,
        passengerId: 1,
        weight: "18.50",
        status: "checked_in",
      },
      {
        id: 2,
        bookingId: 2,
        passengerId: 4,
        weight: "22.00",
        status: "loading",
      },
      { id: 3, bookingId: 2, passengerId: 4, weight: "9.00", status: "lost" },
      {
        id: 4,
        bookingId: 3,
        passengerId: 7,
        weight: "20.00",
        status: "checked_in",
      },
    ],
    users: [
      { id: 42, name: "Load Controller", email: "lc@example.test" },
      { id: 43, name: "Ramp Supervisor", email: "ramp@example.test" },
    ],
    aircraft_type_balance_data: [
      typeRow(1, TRAINING_TYPE_AIS_T1),
      typeRow(2, TRAINING_TYPE_AIS_T1_HD),
    ],
    aircraft_registrations: [
      registrationRow(10, 1, TRAINING_REGISTRATION_AIS_TR1),
      registrationRow(11, 2, TRAINING_REGISTRATION_AIS_TR2),
    ],
    load_sheets: [],
    load_sheet_aircraft_changes: [],
  });
  state.db = fixture.db;
});
afterEach(() => vi.unstubAllEnvs());

const baseRequest = {
  flightId: 101,
  registrationId: 10,
  ruleSetId: "easa-cat-pol-mab-100-20plus",
  ruleSetConfirmationReference: "OM-A 8.1.8 rev 12",
  passengerSource: "system" as const,
  systemBaggageCompartment: "1",
  deadload: [
    {
      compartment: "3",
      baggagePieces: 0,
      baggageKg: 0,
      cargoKg: 2200,
      mailKg: 0,
    },
  ],
  fuel: { blockKg: 9000, taxiKg: 200, tripKg: 4500 },
  performanceLimits: {},
};

describe("weight-balance service: load sheet lifecycle on registry data", () => {
  it("builds the load from confirmed bookings, seats and weighed bags, then persists a preliminary edition", async () => {
    const record = await computeLoadSheet(baseRequest, controller);
    expect(record.status).toBe("preliminary");
    expect(record.edition).toBe(1);
    expect(record.dispatchApproved).toBe(false);
    expect(record.flight).toMatchObject({
      flightNumber: "AIS101",
      origin: "RUH",
      destination: "JED",
      crew: { cockpit: 2, cabin: 1 },
    });
    // Booking 3 is cancelled: its passenger and bag are excluded.
    // Seats 2A/2B -> OA (business), 25C/25D -> OC; the unseated Ms -> economy default zone OB.
    expect(record.figures.passengers.byZone).toEqual([
      expect.objectContaining({ zone: "OA", count: 3 }),
      expect.objectContaining({ zone: "OB", count: 1 }),
      expect.objectContaining({ zone: "OC", count: 2 }),
    ]);
    expect(record.figures.passengers.byCategory).toEqual({
      male: 2,
      female: 2,
      child: 1,
      infant: 1,
    });
    const hold1 = record.figures.deadload.byCompartment.find(
      c => c.compartment === "1"
    );
    // Two bags, 18.5 + 22 = 40.5 -> 41 kg weighed; the lost bag is excluded.
    expect(hold1).toMatchObject({
      baggagePieces: 2,
      baggageKg: 41,
      baggageWeighed: true,
    });
    expect(record.figures.ok).toBe(true);
    expect(record.approval.operatorApproved).toBe(false);
    expect(record.approval.ruleSetConfirmation).toBe("operator_confirmed");
    expect(record.remarks).toEqual(
      expect.arrayContaining([
        expect.stringContaining("without a seat assignment"),
        expect.stringContaining("not operator-approved"),
        expect.stringContaining("Fictional training aircraft type"),
      ])
    );
    expect(record.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(await getFinalLoadSheetFigures(101)).toBeNull();
  });

  it("supersedes earlier editions, signs the current one and exposes the final figures to downstream readers", async () => {
    const first = await computeLoadSheet(baseRequest, controller);
    const second = await computeLoadSheet(baseRequest, controller);
    expect(second.edition).toBe(2);
    expect(
      (await listLoadSheetEditions(101)).map(e => [e.edition, e.status])
    ).toEqual([
      [2, "preliminary"],
      [1, "superseded"],
    ]);
    const signed = await signLoadSheet(second.id, supervisor);
    expect(signed).toMatchObject({
      status: "final",
      signedBy: 43,
      signedByName: "Ramp Supervisor",
    });
    expect(signed.signedAt).toBeInstanceOf(Date);
    await expect(signLoadSheet(first.id, supervisor)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    const final = await getFinalLoadSheetFigures(101);
    expect(final?.id).toBe(second.id);
    expect(final?.figures.schemaVersion).toBe(1);
    expect(final?.dispatchApproved).toBe(false);
    const document = await renderLoadSheetDocument(second.id);
    expect(document.text).toContain("SIGNED BY Ramp Supervisor");
    expect(document.text).toContain("NOT DISPATCH-APPROVED");
  });

  it("refuses to sign an edition with limit breaches", async () => {
    const breached = await computeLoadSheet(
      {
        ...baseRequest,
        deadload: [
          {
            compartment: "3",
            baggagePieces: 0,
            baggageKg: 0,
            cargoKg: 3100,
            mailKg: 0,
          },
        ],
      },
      controller
    );
    expect(breached.figures.ok).toBe(false);
    await expect(signLoadSheet(breached.id, supervisor)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
  });

  it("records LMC as a new signed edition within the limit and refuses beyond it", async () => {
    const preliminary = await computeLoadSheet(baseRequest, controller);
    await expect(
      applyLastMinuteChange(
        {
          flightId: 101,
          changes: [
            {
              kind: "cargo",
              location: "3",
              deltaKg: 100,
              description: "late cargo",
            },
          ],
        },
        supervisor
      )
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await signLoadSheet(preliminary.id, supervisor);
    const lmc = await applyLastMinuteChange(
      {
        flightId: 101,
        changes: [
          {
            kind: "cargo",
            location: "3",
            deltaKg: 100,
            description: "late cargo",
          },
          {
            kind: "passenger",
            location: "OC",
            category: "male",
            deltaCount: -1,
            description: "no-show",
          },
        ],
      },
      supervisor
    );
    expect(lmc).toMatchObject({
      edition: 2,
      basis: "lmc",
      status: "final",
      baseEditionId: preliminary.id,
    });
    expect(lmc.lmcList.map(l => l.appliedKg)).toEqual([100, -88]);
    expect(lmc.figures.lmc).toMatchObject({ appliedKg: 188, remainingKg: 312 });
    expect(lmc.figures.deadload.cargoKg).toBe(2300);
    expect((await getLatestLoadSheet(101))?.id).toBe(lmc.id);
    await expect(
      applyLastMinuteChange(
        {
          flightId: 101,
          changes: [
            {
              kind: "mail",
              location: "3",
              deltaKg: 400,
              description: "late mail",
            },
          ],
        },
        supervisor
      )
    ).rejects.toThrow(/new load sheet is required/);
    expect((await getFinalLoadSheetFigures(101))?.id).toBe(lmc.id);
  });

  it("rejects a registration of another operator and a missing registration", async () => {
    fixture.rows("aircraft_registrations")[1].airlineId = 99;
    await expect(
      computeLoadSheet({ ...baseRequest, registrationId: 11 }, controller)
    ).rejects.toThrow(/another operator/);
    await expect(
      computeLoadSheet({ ...baseRequest, registrationId: 404 }, controller)
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("weight-balance service: aircraft registration change", () => {
  it("flags the signed edition, re-evaluates limits under the new variant, requires a new preliminary and records the audit row", async () => {
    const preliminary = await computeLoadSheet(baseRequest, controller);
    const signed = await signLoadSheet(preliminary.id, supervisor);
    expect(signed.status).toBe("final");

    const result = await changeAircraft(
      {
        flightId: 101,
        newRegistrationId: 11,
        reason: "AIS-TR1 AOG, swapped to AIS-TR2 (HD variant)",
      },
      controller
    );

    // The old version is flagged, not deleted, and nothing active remains.
    expect(result.invalidatedEditionIds).toEqual([signed.id]);
    const editions = await listLoadSheetEditions(101);
    expect(editions.map(e => e.status)).toEqual([
      "superseded_by_aircraft_change",
    ]);
    expect(editions[0].signedByName).toBe("Ramp Supervisor");
    expect(await getFinalLoadSheetFigures(101)).toBeNull();
    expect(result.requiresNewLoadSheet).toBe(true);

    // Limits re-evaluated on the new registration's data: hold 3 max falls
    // from 3000 to 2000 kg, so the 2200 kg of cargo now requires review while
    // the weight limits remain valid.
    expect(result.review.sameTypeAndVariant).toBe(false);
    expect(result.review.dataDifferences).toEqual(
      expect.arrayContaining([
        "Balance dataset AIS-T1 v1 → AIS-T1-HD v1",
        "DOW 42000 → 42600 kg",
        "Compartment 3 max 3000 → 2000 kg, arm 21 → 21 m",
      ])
    );
    expect(result.review.checksRequiringReview).toEqual(
      expect.arrayContaining(["COMPARTMENT:3: 2200/2000 kg"])
    );
    expect(result.review.checksStillValid).toEqual(
      expect.arrayContaining([expect.stringMatching(/^MTOW: /)])
    );
    expect(result.review.recomputed?.ok).toBe(false);

    // Audit row: who, when, why, what was invalidated.
    const audit = await listAircraftChanges(101);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      id: result.auditId,
      flightId: 101,
      fromRegistrationId: 10,
      toRegistrationId: 11,
      invalidatedEditionIds: [signed.id],
      reason: "AIS-TR1 AOG, swapped to AIS-TR2 (HD variant)",
      changedBy: 42,
      changedByName: "Load Controller",
    });
    expect(audit[0].changedAt).toBeInstanceOf(Date);
    expect(audit[0].review).toMatchObject({
      referenceEditionId: signed.id,
      recomputedOk: false,
    });

    // A new preliminary on the new registration starts a fresh edition chain.
    const next = await computeLoadSheet(
      { ...baseRequest, registrationId: 11 },
      controller
    );
    expect(next).toMatchObject({
      edition: 2,
      status: "preliminary",
      registrationId: 11,
    });
    expect(next.figures.ok).toBe(false);
    expect(next.figures.breaches[0]).toMatch(/^COMPARTMENT:3/);
  });

  it("refuses a swap to the registration already planned or when no load sheet exists", async () => {
    await expect(
      changeAircraft(
        { flightId: 101, newRegistrationId: 11, reason: "no sheet" },
        controller
      )
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await computeLoadSheet(baseRequest, controller);
    await expect(
      changeAircraft(
        { flightId: 101, newRegistrationId: 10, reason: "same aircraft" },
        controller
      )
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await listAircraftChanges(101)).toEqual([]);
  });
});
