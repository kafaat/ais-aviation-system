/**
 * Fictional training aircraft type "AIS-T1" (AIS Trainer 1).
 *
 * Every number here is invented so that the arithmetic in the engine tests can
 * be followed by hand. It is not derived from any manufacturer or operator
 * document and must never be approved for dispatch; the registry refuses to
 * mark a fictional dataset `operator_approved`.
 *
 * Geometry: reference station 17.0 m, LEMAC 15.0 m, MAC 4.0 m, so the
 * reference station sits at 50 %MAC and an arm of 16.0 m is 25 %MAC.
 * Index constants: C = 1000, K = 50 (the same scale as the public A321 AHM 560
 * example, with fictional geometry).
 */
import type {
  RegistrationData,
  TypeBalanceData,
} from "./weight-balance-engine";

export const TRAINING_TYPE_AIS_T1: TypeBalanceData = {
  typeCode: "AIS-T1",
  variant: "",
  version: 1,
  description: "AIS Trainer 1 (fictional narrow-body, 180 seats)",
  dataSource: "Fictional training dataset shipped with the repository",
  fictional: true,
  limits: {
    mtowKg: 73500,
    mlwKg: 64500,
    mzfwKg: 61000,
    mrwKg: 73900,
    maxFuelKg: 18000,
  },
  lmcLimitKg: 500,
  payload: {
    unitSystem: "kg_m",
    index: {
      c: 1000,
      k: 50,
      referenceStationM: 17.0,
      lemacM: 15.0,
      macLengthM: 4.0,
    },
    compartments: [
      { code: "1", name: "Forward hold 1", armM: 9.0, maxKg: 2500 },
      { code: "2", name: "Forward hold 2", armM: 12.5, maxKg: 3500 },
      { code: "3", name: "Aft hold 3", armM: 21.0, maxKg: 3000 },
      { code: "4", name: "Aft hold 4", armM: 24.0, maxKg: 2500 },
      { code: "5", name: "Bulk hold 5", armM: 27.0, maxKg: 1000 },
    ],
    cumulativeLimits: [
      { code: "FWD", compartments: ["1", "2"], maxKg: 5500 },
      { code: "AFT", compartments: ["3", "4", "5"], maxKg: 5800 },
    ],
    cabinZones: [
      {
        code: "OA",
        name: "Zone A rows 1-8",
        armM: 11.0,
        seats: 48,
        rows: { from: 1, to: 8 },
        cabinClass: "business",
      },
      {
        code: "OB",
        name: "Zone B rows 9-20",
        armM: 16.5,
        seats: 72,
        rows: { from: 9, to: 20 },
        cabinClass: "economy",
      },
      {
        code: "OC",
        name: "Zone C rows 21-30",
        armM: 21.5,
        seats: 60,
        rows: { from: 21, to: 30 },
        cabinClass: "economy",
      },
    ],
    // Tanks forward of the reference station: index decreases as fuel is added.
    fuelIndexTable: [
      { fuelKg: 0, index: 0 },
      { fuelKg: 2000, index: -1.0 },
      { fuelKg: 5000, index: -2.5 },
      { fuelKg: 8000, index: -4.0 },
      { fuelKg: 10000, index: -4.6 },
      { fuelKg: 14000, index: -4.0 },
      { fuelKg: 18000, index: -3.0 },
    ],
    envelopes: [
      {
        ref: "AIS-T1-ENV-1",
        zfw: [
          { weightKg: 40000, fwdMacPct: 15, aftMacPct: 35 },
          { weightKg: 61000, fwdMacPct: 17, aftMacPct: 33 },
        ],
        tow: [
          { weightKg: 40000, fwdMacPct: 14, aftMacPct: 36 },
          { weightKg: 73500, fwdMacPct: 18, aftMacPct: 34 },
        ],
        law: [
          { weightKg: 40000, fwdMacPct: 14, aftMacPct: 36 },
          { weightKg: 64500, fwdMacPct: 17, aftMacPct: 34 },
        ],
      },
    ],
    trimTable: [
      { macPct: 15, trimUnits: 6.5 },
      { macPct: 20, trimUnits: 5.0 },
      { macPct: 25, trimUnits: 3.5 },
      { macPct: 30, trimUnits: 2.0 },
      { macPct: 35, trimUnits: 0.5 },
    ],
  },
};

/** Variant "HD" (high density): one more seat row aft, tighter aft holds. */
export const TRAINING_TYPE_AIS_T1_HD: TypeBalanceData = {
  ...TRAINING_TYPE_AIS_T1,
  variant: "HD",
  description: "AIS Trainer 1 HD (fictional high-density variant, 186 seats)",
  payload: {
    ...TRAINING_TYPE_AIS_T1.payload,
    compartments: [
      { code: "1", name: "Forward hold 1", armM: 9.0, maxKg: 2500 },
      { code: "2", name: "Forward hold 2", armM: 12.5, maxKg: 3500 },
      { code: "3", name: "Aft hold 3", armM: 21.0, maxKg: 2000 },
      { code: "4", name: "Aft hold 4", armM: 24.0, maxKg: 2000 },
      { code: "5", name: "Bulk hold 5", armM: 27.0, maxKg: 800 },
    ],
    cumulativeLimits: [
      { code: "FWD", compartments: ["1", "2"], maxKg: 5500 },
      { code: "AFT", compartments: ["3", "4", "5"], maxKg: 4500 },
    ],
    cabinZones: [
      {
        code: "OA",
        name: "Zone A rows 1-8",
        armM: 11.0,
        seats: 48,
        rows: { from: 1, to: 8 },
        cabinClass: "economy",
      },
      {
        code: "OB",
        name: "Zone B rows 9-20",
        armM: 16.5,
        seats: 72,
        rows: { from: 9, to: 20 },
        cabinClass: "economy",
      },
      {
        code: "OC",
        name: "Zone C rows 21-31",
        armM: 21.7,
        seats: 66,
        rows: { from: 21, to: 31 },
        cabinClass: "economy",
      },
    ],
  },
};

/**
 * Fictional registrations. DOI is derived from a stated DOW arm so the figure
 * can be checked: DOI = K + DOW × (arm − RefSta) / C.
 *   AIS-TR1: 42 000 kg at 15.9 m → 50 + 42000 × (−1.1) / 1000 = 3.8
 *   AIS-TR2: 42 600 kg at 15.8 m → 50 + 42600 × (−1.2) / 1000 = −1.12
 */
export const TRAINING_REGISTRATION_AIS_TR1: RegistrationData = {
  registration: "AIS-TR1",
  typeCode: "AIS-T1",
  variant: "",
  dowKg: 42000,
  doi: 3.8,
  limits: {},
  fuelCapacityKg: 18000,
  cabinConfigVersion: "Y180-v1",
  envelopeRef: "AIS-T1-ENV-1",
};

export const TRAINING_REGISTRATION_AIS_TR2: RegistrationData = {
  registration: "AIS-TR2",
  typeCode: "AIS-T1",
  variant: "HD",
  dowKg: 42600,
  doi: -1.12,
  limits: { mlwKg: 64000 },
  fuelCapacityKg: 18000,
  cabinConfigVersion: "Y186-v1",
  envelopeRef: "AIS-T1-ENV-1",
};
