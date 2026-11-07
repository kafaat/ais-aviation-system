import { describe, expect, it } from "vitest";
import {
  applyLastMinuteChanges,
  computeLoadSheet,
  getStandardMassRuleSet,
  indexFromMacPercent,
  macPercentFromIndex,
  reviewAircraftChange,
  renderLoadSheetText,
  typeBalanceDataSchema,
  WeightBalanceDataError,
  type LmcEntry,
  type LoadInput,
  type TypeBalanceData,
} from "./weight-balance-engine";
import {
  TRAINING_REGISTRATION_AIS_TR1,
  TRAINING_REGISTRATION_AIS_TR2,
  TRAINING_TYPE_AIS_T1,
  TRAINING_TYPE_AIS_T1_HD,
} from "./weight-balance-training-fixture";

const easa = {
  ...getStandardMassRuleSet("easa-cat-pol-mab-100-20plus"),
  confirmation: "operator_confirmed" as const,
  confirmationReference: "test",
};

/**
 * Worked example on the fictional AIS-T1 (C = 1000, K = 50, RefSta 17.0 m,
 * LEMAC 15.0 m, MAC 4.0 m). Index per kg for an arm a is (a − 17) / 1000.
 */
const workedExample: LoadInput = {
  passengersByZone: [
    { zone: "OA", male: 10, female: 8, child: 2, infant: 1 },
    { zone: "OB", male: 30, female: 25, child: 5, infant: 0 },
    { zone: "OC", male: 20, female: 20, child: 0, infant: 0 },
  ],
  deadload: [
    {
      compartment: "1",
      baggagePieces: 60,
      baggageKg: 900,
      cargoKg: 0,
      mailKg: 0,
    },
    {
      compartment: "3",
      baggagePieces: 0,
      baggageKg: 0,
      cargoKg: 1200,
      mailKg: 100,
    },
    {
      compartment: "4",
      baggagePieces: 40,
      baggageKg: null,
      cargoKg: 0,
      mailKg: 0,
    },
  ],
  fuel: { blockKg: 9000, taxiKg: 200, tripKg: 4500 },
  performanceLimits: {},
  standardMasses: easa,
  crew: { cockpit: 2, cabin: 4 },
};

describe("weight-balance engine: worked example on the fictional AIS-T1", () => {
  const figures = computeLoadSheet(
    TRAINING_TYPE_AIS_T1,
    TRAINING_REGISTRATION_AIS_TR1,
    workedExample
  );

  it("sums passengers by zone with EASA standard masses (88/70/35, infant 0)", () => {
    // OA: 10×88 + 8×70 + 2×35 + 1×0 = 880 + 560 + 70 = 1510 kg; arm 11.0 → −0.006/kg → −9.06
    // OB: 30×88 + 25×70 + 5×35 = 2640 + 1750 + 175 = 4565 kg; arm 16.5 → −0.0005/kg → −2.2825
    // OC: 20×88 + 20×70 = 1760 + 1400 = 3160 kg; arm 21.5 → +0.0045/kg → +14.22
    expect(figures.passengers.byZone.map(z => z.weightKg)).toEqual([
      1510, 4565, 3160,
    ]);
    expect(figures.passengers.byZone.map(z => z.index)).toEqual([
      -9.06, -2.2825, 14.22,
    ]);
    expect(figures.passengers.weightKg).toBe(9235);
    expect(figures.passengers.index).toBeCloseTo(2.8775, 4);
    expect(figures.passengers.total).toBe(121);
    expect(figures.passengers.seated).toBe(120);
    expect(figures.passengers.byCategory).toEqual({
      male: 60,
      female: 53,
      child: 7,
      infant: 1,
    });
  });

  it("sums deadload by compartment, using pieces × 13 kg where bags were not weighed", () => {
    // Hold 1: 900 kg weighed; arm 9.0 → −0.008/kg → −7.2
    // Hold 3: 1200 + 100 = 1300 kg; arm 21.0 → +0.004/kg → +5.2
    // Hold 4: 40 × 13 = 520 kg; arm 24.0 → +0.007/kg → +3.64
    expect(figures.deadload.byCompartment.map(c => c.totalKg)).toEqual([
      900, 1300, 520,
    ]);
    expect(figures.deadload.byCompartment[2].baggageWeighed).toBe(false);
    expect(figures.deadload.byCompartment.map(c => c.index)).toEqual([
      -7.2, 5.2, 3.64,
    ]);
    expect(figures.deadload.totalKg).toBe(2720);
    expect(figures.deadload.index).toBeCloseTo(1.64, 4);
  });

  it("chains DOW/DOI → ZFW/ZFI → TOW/TOI → LAW/LI with the fuel index table", () => {
    // Traffic load 9235 + 2720 = 11955; ZFW = 42000 + 11955 = 53955
    // ZFI = DOI 3.8 + 2.8775 + 1.64 = 8.3175
    expect(figures.trafficLoadKg).toBe(11955);
    expect(figures.zfw.weightKg).toBe(53955);
    expect(figures.zfw.index).toBeCloseTo(8.3175, 4);
    // Take-off fuel 9000 − 200 = 8800; TOW = 62755
    // Fuel index at 8800 between (8000, −4.0) and (10000, −4.6): −4.0 − 0.4×0.6 = −4.24
    // TOI = 8.3175 − 4.24 = 4.0775
    expect(figures.fuel.takeoffKg).toBe(8800);
    expect(figures.fuel.takeoffIndex).toBeCloseTo(-4.24, 4);
    expect(figures.tow.weightKg).toBe(62755);
    expect(figures.tow.index).toBeCloseTo(4.0775, 4);
    // Landing fuel 8800 − 4500 = 4300; LAW = 58255
    // Fuel index at 4300 between (2000, −1.0) and (5000, −2.5): −1.0 − (2300/3000)×1.5 = −2.15
    // LI = 8.3175 − 2.15 = 6.1675
    expect(figures.fuel.landingKg).toBe(4300);
    expect(figures.fuel.landingIndex).toBeCloseTo(-2.15, 4);
    expect(figures.law.weightKg).toBe(58255);
    expect(figures.law.index).toBeCloseTo(6.1675, 4);
    expect(figures.rampWeightKg).toBe(62955);
  });

  it("converts index to %MAC with [C(I−K)/W + (RefSta−LEMAC)]/MAC × 100", () => {
    // ZFW: 1000×(8.3175 − 50)/53955 = −0.772541 m; (−0.772541 + 2)/4 × 100 = 30.6865 %
    const zfwMac = (((1000 * (8.3175 - 50)) / 53955 + 2) / 4) * 100;
    expect(figures.zfw.macPct).toBeCloseTo(zfwMac, 3);
    expect(figures.zfw.macPct).toBeCloseTo(30.6865, 3);
    // TOW: 1000×(4.0775 − 50)/62755 = −0.731775 m; (1.268225)/4 × 100 = 31.7056 %
    expect(figures.tow.macPct).toBeCloseTo(31.7056, 3);
    // LAW: 1000×(6.1675 − 50)/58255 = −0.752442 m; (1.247558)/4 × 100 = 31.1890 %
    expect(figures.law.macPct).toBeCloseTo(31.189, 3);
    // Round trip through the inverse.
    expect(
      indexFromMacPercent(
        figures.tow.macPct,
        62755,
        TRAINING_TYPE_AIS_T1.payload.index
      )
    ).toBeCloseTo(4.0775, 3);
    // The reference station itself is at (17 − 15)/4 = 50 %MAC: index K at any weight.
    expect(
      macPercentFromIndex(50, 60000, TRAINING_TYPE_AIS_T1.payload.index)
    ).toBe(50);
  });

  it("interpolates the envelope at each weight and reports the CG inside it", () => {
    // ZFW envelope 40000→(15,35), 61000→(17,33); at 53955: t = 13955/21000 = 0.66452
    expect(figures.zfw.fwdLimitMacPct).toBeCloseTo(15 + 0.66452 * 2, 3);
    expect(figures.zfw.aftLimitMacPct).toBeCloseTo(35 - 0.66452 * 2, 3);
    // TOW envelope 40000→(14,36), 73500→(18,34); at 62755: t = 22755/33500 = 0.67925
    expect(figures.tow.fwdLimitMacPct).toBeCloseTo(14 + 0.67925 * 4, 3);
    expect(figures.tow.aftLimitMacPct).toBeCloseTo(36 - 0.67925 * 2, 3);
    expect(figures.zfw.withinEnvelope).toBe(true);
    expect(figures.tow.withinEnvelope).toBe(true);
    expect(figures.law.withinEnvelope).toBe(true);
  });

  it("checks every structural limit and reports the underload with its limiting factor", () => {
    const byCode = Object.fromEntries(
      figures.structuralChecks.map(c => [c.code, c])
    );
    expect(byCode.MZFW).toMatchObject({
      limitKg: 61000,
      actualKg: 53955,
      marginKg: 7045,
      ok: true,
    });
    expect(byCode.MTOW).toMatchObject({
      limitKg: 73500,
      actualKg: 62755,
      marginKg: 10745,
      ok: true,
    });
    expect(byCode.MLW).toMatchObject({
      limitKg: 64500,
      actualKg: 58255,
      marginKg: 6245,
      ok: true,
    });
    expect(byCode.MRW).toMatchObject({
      limitKg: 73900,
      actualKg: 62955,
      ok: true,
    });
    expect(byCode["CUMULATIVE:FWD"]).toMatchObject({
      limitKg: 5500,
      actualKg: 900,
    });
    expect(byCode["CUMULATIVE:AFT"]).toMatchObject({
      limitKg: 5800,
      actualKg: 1820,
    });
    expect(byCode["ZONE:OA"]).toMatchObject({
      limitKg: 48,
      actualKg: 20,
      ok: true,
    });
    expect(byCode.FUEL_CAPACITY).toMatchObject({
      limitKg: 18000,
      actualKg: 9000,
    });
    // Underload = min(MZFW − ZFW, MTOW − TOW, MLW − LAW) = min(7045, 10745, 6245) = 6245 (MLW)
    expect(figures.underload).toEqual({
      allowedTrafficLoadKg: 11955 + 6245,
      actualTrafficLoadKg: 11955,
      underloadKg: 6245,
      limitingFactor: "MLW",
    });
    expect(figures.ok).toBe(true);
    expect(figures.breaches).toEqual([]);
  });

  it("reads the stabiliser trim from the type table at the take-off %MAC", () => {
    // 31.7056 % between (30, 2.0) and (35, 0.5): 2.0 − (1.7056/5)×1.5 = 1.488
    expect(figures.trim.stabTrimUnits).toBeCloseTo(1.49, 2);
    expect(figures.trim.source).toContain("trim table");
  });

  it("carries the inputs, rule set and fictional flag so the record is reproducible", () => {
    expect(figures.inputs).toEqual(workedExample);
    expect(figures.passengers.ruleSetId).toBe("easa-cat-pol-mab-100-20plus");
    expect(figures.aircraft).toMatchObject({
      registration: "AIS-TR1",
      typeCode: "AIS-T1",
      fictional: true,
      envelopeRef: "AIS-T1-ENV-1",
    });
    expect(figures.lmc).toEqual({
      limitKg: 500,
      appliedKg: 0,
      remainingKg: 500,
      requiresNewLoadSheet: false,
    });
  });

  it("renders a printable load sheet that is marked not dispatch-approved", () => {
    const text = renderLoadSheetText(
      {
        flightNumber: "AIS101",
        date: "03NOV",
        origin: "RUH",
        destination: "JED",
        edition: 1,
        status: "preliminary",
        basis: "full",
        preparedBy: "controller",
        preparedAt: "2026-11-03T10:00:00Z",
        signedBy: null,
        signedAt: null,
        dispatchApproved: false,
        crew: { cockpit: 2, cabin: 4 },
      },
      figures,
      []
    );
    expect(text).toContain("NOT DISPATCH-APPROVED");
    expect(text).toContain("FICTIONAL TRAINING AIRCRAFT TYPE");
    expect(text).toContain("ZERO FUEL WEIGHT ACTUAL      53955  MAX    61000");
    expect(text).toContain("UNDERLOAD BEFORE LMC          6245  (MLW)");
    expect(text).toContain("PAX 60/53/7/1 TTL 121");
    expect(text).toContain("UNSIGNED - PRELIMINARY");
  });
});

describe("weight-balance engine: limit breach detection", () => {
  it("flags compartment, cumulative, MZFW and envelope breaches prominently", () => {
    const figures = computeLoadSheet(
      TRAINING_TYPE_AIS_T1,
      TRAINING_REGISTRATION_AIS_TR1,
      {
        ...workedExample,
        passengersByZone: [
          { zone: "OA", male: 0, female: 0, child: 0, infant: 0 },
          { zone: "OB", male: 0, female: 0, child: 0, infant: 0 },
          { zone: "OC", male: 60, female: 0, child: 0, infant: 0 },
        ],
        deadload: [
          {
            compartment: "3",
            baggagePieces: 0,
            baggageKg: 0,
            cargoKg: 3100,
            mailKg: 0,
          },
          {
            compartment: "4",
            baggagePieces: 0,
            baggageKg: 0,
            cargoKg: 2500,
            mailKg: 0,
          },
          {
            compartment: "5",
            baggagePieces: 0,
            baggageKg: 0,
            cargoKg: 1000,
            mailKg: 0,
          },
          {
            compartment: "1",
            baggagePieces: 0,
            baggageKg: 0,
            cargoKg: 2000,
            mailKg: 0,
          },
          {
            compartment: "2",
            baggagePieces: 0,
            baggageKg: 0,
            cargoKg: 3500,
            mailKg: 0,
          },
        ],
      }
    );
    expect(figures.ok).toBe(false);
    const codes = figures.structuralChecks.filter(c => !c.ok).map(c => c.code);
    expect(codes).toEqual(
      expect.arrayContaining(["COMPARTMENT:3", "CUMULATIVE:AFT"])
    );
    // 42000 + 5280 + 12100 = 59380 ≤ 61000 so MZFW holds, but the aft load pushes the CG aft.
    expect(figures.zfw.withinEnvelope).toBe(false);
    expect(figures.breaches.some(b => b.startsWith("ENVELOPE:ZFW"))).toBe(true);
    expect(
      figures.breaches.some(b =>
        b.startsWith("COMPARTMENT:3: 3100 exceeds 3000 by 100")
      )
    ).toBe(true);
  });

  it("flags MZFW, MTOW, MLW and zone seat limits", () => {
    const figures = computeLoadSheet(
      TRAINING_TYPE_AIS_T1,
      TRAINING_REGISTRATION_AIS_TR1,
      {
        ...workedExample,
        passengersByZone: [
          { zone: "OA", male: 49, female: 0, child: 0, infant: 0 },
          { zone: "OB", male: 72, female: 0, child: 0, infant: 0 },
          { zone: "OC", male: 60, female: 0, child: 0, infant: 0 },
        ],
        deadload: [
          {
            compartment: "1",
            baggagePieces: 0,
            baggageKg: 0,
            cargoKg: 2500,
            mailKg: 0,
          },
          {
            compartment: "2",
            baggagePieces: 0,
            baggageKg: 0,
            cargoKg: 3000,
            mailKg: 0,
          },
          {
            compartment: "3",
            baggagePieces: 0,
            baggageKg: 0,
            cargoKg: 3000,
            mailKg: 0,
          },
          {
            compartment: "4",
            baggagePieces: 0,
            baggageKg: 0,
            cargoKg: 2500,
            mailKg: 0,
          },
        ],
        fuel: { blockKg: 18000, taxiKg: 200, tripKg: 1000 },
      }
    );
    const failing = figures.structuralChecks
      .filter(c => !c.ok)
      .map(c => c.code);
    // 181 × 88 = 15928 + 11000 = 26928 traffic → ZFW 68928 > 61000; TOW 86728 > 73500; LAW 85728 > 64500
    // Aft holds 3000 + 2500 = 5500 ≤ 5800 so the cumulative limit still holds.
    expect(failing).toEqual(
      expect.arrayContaining(["ZONE:OA", "MZFW", "MTOW", "MLW", "MRW"])
    );
    expect(failing).not.toContain("CUMULATIVE:AFT");
    expect(figures.underload.underloadKg).toBeLessThan(0);
  });

  it("applies the performance-limited RTOW when it is lower than the structural MTOW", () => {
    const figures = computeLoadSheet(
      TRAINING_TYPE_AIS_T1,
      TRAINING_REGISTRATION_AIS_TR1,
      {
        ...workedExample,
        performanceLimits: { rtowKg: 62000 },
      }
    );
    expect(figures.structuralChecks.find(c => c.code === "RTOW")).toMatchObject(
      {
        limitKg: 62000,
        actualKg: 62755,
        ok: false,
      }
    );
    expect(figures.underload.limitingFactor).toBe("MTOW");
    expect(figures.underload.underloadKg).toBe(-755);
  });
});

describe("weight-balance engine: envelope boundary", () => {
  // Flat envelope 20–30 %MAC; DOW 50 000 kg; choose DOI so the empty aircraft
  // sits exactly on the aft limit: CG at 30 % = LEMAC + 1.2 m = 16.2 m, so
  // DOI = 50 + 50000 × (16.2 − 17) / 1000 = 10.
  const flatType: TypeBalanceData = {
    ...TRAINING_TYPE_AIS_T1,
    payload: {
      ...TRAINING_TYPE_AIS_T1.payload,
      fuelIndexTable: [
        { fuelKg: 0, index: 0 },
        { fuelKg: 18000, index: 0 },
      ],
      envelopes: [
        {
          ref: "AIS-T1-ENV-1",
          zfw: [
            { weightKg: 40000, fwdMacPct: 20, aftMacPct: 30 },
            { weightKg: 73500, fwdMacPct: 20, aftMacPct: 30 },
          ],
          tow: [
            { weightKg: 40000, fwdMacPct: 20, aftMacPct: 30 },
            { weightKg: 73500, fwdMacPct: 20, aftMacPct: 30 },
          ],
          law: [
            { weightKg: 40000, fwdMacPct: 20, aftMacPct: 30 },
            { weightKg: 73500, fwdMacPct: 20, aftMacPct: 30 },
          ],
        },
      ],
    },
  };
  const empty: LoadInput = {
    passengersByZone: [],
    deadload: [],
    fuel: { blockKg: 0, taxiKg: 0, tripKg: 0 },
    performanceLimits: {},
    standardMasses: easa,
  };

  it("accepts a CG exactly on the aft limit", () => {
    const figures = computeLoadSheet(
      flatType,
      { ...TRAINING_REGISTRATION_AIS_TR1, dowKg: 50000, doi: 10 },
      empty
    );
    expect(figures.zfw.macPct).toBeCloseTo(30, 9);
    expect(figures.zfw.withinEnvelope).toBe(true);
    expect(figures.tow.withinEnvelope).toBe(true);
    expect(figures.law.withinEnvelope).toBe(true);
    expect(figures.ok).toBe(true);
  });

  it("accepts a CG exactly on the forward limit", () => {
    // 20 % = LEMAC + 0.8 m = 15.8 m → DOI = 50 + 50000 × (−1.2) / 1000 = −10
    const figures = computeLoadSheet(
      flatType,
      { ...TRAINING_REGISTRATION_AIS_TR1, dowKg: 50000, doi: -10 },
      empty
    );
    expect(figures.zfw.macPct).toBeCloseTo(20, 9);
    expect(figures.ok).toBe(true);
  });

  it("rejects a CG one index unit aft of the limit", () => {
    const figures = computeLoadSheet(
      flatType,
      { ...TRAINING_REGISTRATION_AIS_TR1, dowKg: 50000, doi: 10.01 },
      empty
    );
    expect(figures.zfw.withinEnvelope).toBe(false);
    expect(figures.breaches).toHaveLength(3);
  });

  it("rejects a weight below the envelope's first point", () => {
    const figures = computeLoadSheet(
      flatType,
      { ...TRAINING_REGISTRATION_AIS_TR1, dowKg: 39999, doi: 10 },
      empty
    );
    expect(figures.zfw.fwdLimitMacPct).toBeNull();
    expect(figures.breaches[0]).toContain("outside the certified envelope");
  });
});

describe("weight-balance engine: last-minute changes", () => {
  const base = computeLoadSheet(
    TRAINING_TYPE_AIS_T1,
    TRAINING_REGISTRATION_AIS_TR1,
    workedExample
  );
  const entry = (sequence: number, partial: Partial<LmcEntry>): LmcEntry => ({
    sequence,
    kind: "cargo",
    location: "3",
    deltaKg: 0,
    appliedKg: 0,
    description: "test",
    actorId: 1,
    actorName: "ops",
    appliedAt: "2026-11-03T10:00:00Z",
    ...partial,
  });

  it("recomputes figures for an LMC within the 500 kg type limit", () => {
    const lmc = [entry(1, { deltaKg: 300, appliedKg: 300 })];
    const figures = applyLastMinuteChanges(
      TRAINING_TYPE_AIS_T1,
      TRAINING_REGISTRATION_AIS_TR1,
      base,
      lmc
    );
    expect(
      figures.deadload.byCompartment.find(c => c.compartment === "3")?.cargoKg
    ).toBe(1500);
    expect(figures.zfw.weightKg).toBe(54255);
    // Extra 300 kg at arm 21.0 → +1.2 index: ZFI 8.3175 + 1.2 = 9.5175
    expect(figures.zfw.index).toBeCloseTo(9.5175, 4);
    expect(figures.lmc).toEqual({
      limitKg: 500,
      appliedKg: 300,
      remainingKg: 200,
      requiresNewLoadSheet: false,
    });
    expect(figures.ok).toBe(true);
  });

  it("requires a new load sheet once the absolute LMC total exceeds the limit", () => {
    const lmc = [
      entry(1, { deltaKg: 300, appliedKg: 300 }),
      entry(2, {
        kind: "baggage",
        location: "1",
        deltaKg: -250,
        appliedKg: -250,
      }),
    ];
    const figures = applyLastMinuteChanges(
      TRAINING_TYPE_AIS_T1,
      TRAINING_REGISTRATION_AIS_TR1,
      base,
      lmc
    );
    expect(figures.lmc.appliedKg).toBe(550);
    expect(figures.lmc.requiresNewLoadSheet).toBe(true);
    expect(figures.ok).toBe(false);
    expect(figures.breaches.at(-1)).toContain("a new load sheet is required");
  });

  it("converts passenger LMCs with the load sheet's standard masses", () => {
    const lmc = [
      entry(1, {
        kind: "passenger",
        location: "OC",
        category: "male",
        deltaCount: -2,
        deltaKg: undefined,
        appliedKg: -176,
      }),
    ];
    const figures = applyLastMinuteChanges(
      TRAINING_TYPE_AIS_T1,
      TRAINING_REGISTRATION_AIS_TR1,
      base,
      lmc
    );
    expect(figures.passengers.byCategory.male).toBe(58);
    expect(figures.passengers.weightKg).toBe(9235 - 176);
    expect(figures.lmc.appliedKg).toBe(176);
  });

  it("refuses to offload more than is on board", () => {
    expect(() =>
      applyLastMinuteChanges(
        TRAINING_TYPE_AIS_T1,
        TRAINING_REGISTRATION_AIS_TR1,
        base,
        [
          entry(1, {
            kind: "mail",
            location: "3",
            deltaKg: -500,
            appliedKg: -500,
          }),
        ]
      )
    ).toThrow(WeightBalanceDataError);
  });
});

describe("weight-balance engine: data validation", () => {
  it("rejects a registration whose envelope reference is not in the dataset", () => {
    expect(() =>
      computeLoadSheet(
        TRAINING_TYPE_AIS_T1,
        { ...TRAINING_REGISTRATION_AIS_TR1, envelopeRef: "MISSING" },
        workedExample
      )
    ).toThrow(/references envelope MISSING/);
  });

  it("rejects a registration of a different type or variant than the dataset", () => {
    expect(() =>
      computeLoadSheet(
        TRAINING_TYPE_AIS_T1,
        TRAINING_REGISTRATION_AIS_TR2,
        workedExample
      )
    ).toThrow(/is AIS-T1-HD but the dataset is AIS-T1/);
  });

  it("rejects loads that name unknown zones or compartments", () => {
    expect(() =>
      computeLoadSheet(TRAINING_TYPE_AIS_T1, TRAINING_REGISTRATION_AIS_TR1, {
        ...workedExample,
        deadload: [
          {
            compartment: "9",
            baggagePieces: 0,
            baggageKg: 0,
            cargoKg: 1,
            mailKg: 0,
          },
        ],
      })
    ).toThrow(/Compartment 9 is not defined/);
    expect(() =>
      computeLoadSheet(TRAINING_TYPE_AIS_T1, TRAINING_REGISTRATION_AIS_TR1, {
        ...workedExample,
        passengersByZone: [
          { zone: "OZ", male: 1, female: 0, child: 0, infant: 0 },
        ],
      })
    ).toThrow(/Cabin zone OZ is not defined/);
  });

  it("rejects incomplete type datasets (missing index constants, inverted envelope, bad fuel table)", () => {
    const { index: _index, ...withoutIndex } = TRAINING_TYPE_AIS_T1.payload;
    expect(
      typeBalanceDataSchema.safeParse({
        ...TRAINING_TYPE_AIS_T1,
        payload: withoutIndex,
      }).success
    ).toBe(false);
    expect(
      typeBalanceDataSchema.safeParse({
        ...TRAINING_TYPE_AIS_T1,
        payload: {
          ...TRAINING_TYPE_AIS_T1.payload,
          envelopes: [
            {
              ...TRAINING_TYPE_AIS_T1.payload.envelopes[0],
              zfw: [
                { weightKg: 40000, fwdMacPct: 35, aftMacPct: 15 },
                { weightKg: 61000, fwdMacPct: 17, aftMacPct: 33 },
              ],
            },
          ],
        },
      }).success
    ).toBe(false);
    expect(
      typeBalanceDataSchema.safeParse({
        ...TRAINING_TYPE_AIS_T1,
        payload: {
          ...TRAINING_TYPE_AIS_T1.payload,
          fuelIndexTable: [
            { fuelKg: 1000, index: 0 },
            { fuelKg: 2000, index: 1 },
          ],
        },
      }).success
    ).toBe(false);
    expect(
      typeBalanceDataSchema.safeParse({
        ...TRAINING_TYPE_AIS_T1,
        limits: { ...TRAINING_TYPE_AIS_T1.limits, mzfwKg: 80000 },
      }).success
    ).toBe(false);
  });

  it("refuses the GACA placeholder rule set until the operator supplies masses", () => {
    expect(() =>
      computeLoadSheet(TRAINING_TYPE_AIS_T1, TRAINING_REGISTRATION_AIS_TR1, {
        ...workedExample,
        standardMasses: getStandardMassRuleSet("gaca-gacar-121-operator"),
      })
    ).toThrow(/no usable passenger masses/);
  });

  it("rejects fuel inputs where taxi or trip exceed what is on board", () => {
    expect(() =>
      computeLoadSheet(TRAINING_TYPE_AIS_T1, TRAINING_REGISTRATION_AIS_TR1, {
        ...workedExample,
        fuel: { blockKg: 5000, taxiKg: 200, tripKg: 4900 },
      })
    ).toThrow();
  });
});

describe("weight-balance engine: aircraft change review", () => {
  it("lists dataset differences and re-evaluates the load under the new registration", () => {
    const figures = computeLoadSheet(
      TRAINING_TYPE_AIS_T1,
      TRAINING_REGISTRATION_AIS_TR1,
      {
        ...workedExample,
        deadload: [
          {
            compartment: "3",
            baggagePieces: 0,
            baggageKg: 0,
            cargoKg: 2200,
            mailKg: 0,
          },
          {
            compartment: "1",
            baggagePieces: 60,
            baggageKg: 900,
            cargoKg: 0,
            mailKg: 0,
          },
        ],
      }
    );
    expect(figures.ok).toBe(true);
    const review = reviewAircraftChange(
      {
        type: TRAINING_TYPE_AIS_T1,
        registration: TRAINING_REGISTRATION_AIS_TR1,
      },
      {
        type: TRAINING_TYPE_AIS_T1_HD,
        registration: TRAINING_REGISTRATION_AIS_TR2,
      },
      figures
    );
    expect(review.requiresNewLoadSheet).toBe(true);
    expect(review.sameTypeAndVariant).toBe(false);
    expect(review.dataDifferences).toEqual(
      expect.arrayContaining([
        "Balance dataset AIS-T1 v1 → AIS-T1-HD v1",
        "DOW 42000 → 42600 kg",
        "DOI 3.8 → -1.12",
        "Cabin configuration Y180-v1 → Y186-v1",
        "MLW 64500 → 64000 kg",
        "Compartment 3 max 3000 → 2000 kg, arm 21 → 21 m",
      ])
    );
    // 2200 kg in hold 3 was legal on the base type (max 3000) but not on the HD variant (max 2000).
    expect(review.checksRequiringReview).toEqual(
      expect.arrayContaining(["COMPARTMENT:3: 2200/2000 kg"])
    );
    // New DOW 42600 + traffic (9235 + 900 + 2200) = 54935 kg stays under MZFW.
    expect(review.checksStillValid).toEqual(
      expect.arrayContaining(["MZFW: 54935/61000 kg"])
    );
    expect(review.recomputed?.ok).toBe(false);
  });
});
