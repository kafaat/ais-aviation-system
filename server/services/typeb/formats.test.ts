/**
 * Type B format vectors.
 *
 * Expected texts follow the publicly documented layouts cited in each
 * describe block (KIU MVT manual, Evionica/AHM 583 LDM examples, SITA
 * BagMessage/RP 1745 BSM examples, AeroCRS and Videcom PNL/ADL notes). Where
 * the licensed IATA text could not be consulted the generator implements the
 * widely documented form and the docs flag the assumption.
 */
import { describe, expect, it } from "vitest";
import {
  buildHeader,
  composeMessage,
  parseAddress,
  parseEnvelope,
  renderMessage,
} from "./envelope";
import { generateLdm, parseLdm } from "./ldm";
import { generateMvt, parseMvt } from "./mvt";
import { buildLicensePlate, generateBpm, generateBsm, parseBsm } from "./bsm";
import { generateAdl, generatePnl } from "./pnl-adl";
import { bixSerializer, typeBSerializer } from "./serializer";
import type { PnlPassenger } from "./model";
import { designatorFromFlightNumber, parseDdmmm } from "./text";

const flight = { carrier: "XY", number: "123" };
const day = new Date("2026-11-03T12:00:00Z");

describe("addressing and envelope", () => {
  it("accepts seven-character addresses and splits them into station, department and company", () => {
    expect(parseAddress("ruhkkxy")).toEqual({
      address: "RUHKKXY",
      station: "RUH",
      department: "KK",
      company: "XY",
    });
    expect(() => parseAddress("RUHKK")).toThrow(/7 characters/);
    expect(() => parseAddress("1UHKKXY")).toThrow();
  });

  it("builds QU/QD header lines with eight addresses per line and a DDHHMM origin line", () => {
    const addresses = Array.from(
      { length: 9 },
      (_, i) => `JEDKP${String(i).padStart(2, "0")}`
    );
    const header = buildHeader({
      priority: "QD",
      addresses,
      origin: "RUHKKXY",
      sentAt: new Date("2026-11-03T12:05:00Z"),
    });
    expect(header).toEqual([
      "QD JEDKP00 JEDKP01 JEDKP02 JEDKP03 JEDKP04 JEDKP05 JEDKP06 JEDKP07",
      "QD JEDKP08",
      ".RUHKKXY 031205",
    ]);
    expect(() =>
      buildHeader({ priority: "SS" as never, addresses, origin: "RUHKKXY" })
    ).toThrow(/priority/);
  });

  it("composes header, text and double signature trailer, then parses it back", () => {
    const lines = composeMessage(
      {
        addresses: ["JEDKPXY", "JEDKPXY"],
        origin: "RUHKKXY",
        sentAt: new Date("2026-11-03T12:05:00Z"),
      },
      ["MVT", "XY123/03.HZASA.RUH", "AD1205/1218 EA1405 JED"]
    );
    expect(lines).toEqual([
      "QU JEDKPXY",
      ".RUHKKXY 031205",
      "MVT",
      "XY123/03.HZASA.RUH",
      "AD1205/1218 EA1405 JED",
      "",
      "RUHKKXY",
      "RUHKKXY",
    ]);
    const parsed = parseEnvelope(renderMessage(lines));
    expect(parsed.header).toEqual({
      priority: "QU",
      addresses: ["JEDKPXY"],
      origin: "RUHKKXY",
      dateTime: "031205",
      identity: null,
    });
    expect(parsed.type).toBe("MVT");
    expect(parsed.textLines).toEqual([
      "MVT",
      "XY123/03.HZASA.RUH",
      "AD1205/1218 EA1405 JED",
    ]);
    expect(parsed.trailerLines).toEqual(["RUHKKXY", "RUHKKXY"]);
  });

  it("accepts header-less text and rejects characters outside the Type B set", () => {
    expect(
      parseEnvelope("LDM\nXY123/03.HZASA.Y180.2/5\n-JED.1/0/0.T0.PAX/1").type
    ).toBe("LDM");
    expect(() => parseEnvelope("MVT\nXY123/03.HZASA.RUH\nSI café")).toThrow(
      /Type B set/
    );
    expect(() => parseEnvelope("HELLO")).toThrow(/Unrecognised/);
  });
});

describe("MVT (AHM 780)", () => {
  // Vector shape from the KIU movement-message manual: AD off-blocks/airborne,
  // EA + destination, DL codes/durations, SI free text.
  it("generates departure, delay, pax and SI lines with UTC HHMM times", () => {
    const lines = generateMvt({
      type: "MVT",
      flight,
      date: day,
      registration: "HZ-ASA",
      station: "RUH",
      movement: {
        kind: "AD",
        offBlocks: new Date("2026-11-03T12:05:00Z"),
        airborne: new Date("2026-11-03T12:18:00Z"),
        estimatedArrival: new Date("2026-11-03T14:05:00Z"),
        destination: "JED",
        delays: [
          { code: "89", minutes: 15 },
          { code: "41", minutes: 10 },
        ],
        passengers: { byClass: [8, 172] },
      },
      remarks: ["Delayed inbound aircraft"],
    });
    expect(lines).toEqual([
      "MVT",
      "XY123/03.HZASA.RUH",
      "AD1205/1218 EA1405 JED",
      "DL89/41/0015/0010",
      "PX8/172",
      "SI DELAYED INBOUND AIRCRAFT",
    ]);
  });

  it("generates AA, ED and NI variants", () => {
    const base = {
      type: "MVT" as const,
      flight,
      date: day,
      registration: "HZASA",
    };
    expect(
      generateMvt({
        ...base,
        station: "JED",
        movement: {
          kind: "AA",
          touchdown: new Date("2026-11-03T13:58:00Z"),
          onBlocks: new Date("2026-11-03T14:06:00Z"),
        },
      })
    ).toEqual(["MVT", "XY123/03.HZASA.JED", "AA1358/1406"]);
    expect(
      generateMvt({
        ...base,
        station: "RUH",
        movement: {
          kind: "ED",
          estimatedDeparture: new Date("2026-11-03T12:30:00Z"),
          delays: [{ code: "93", minutes: 90 }],
        },
      })
    ).toEqual(["MVT", "XY123/03.HZASA.RUH", "ED1230", "DL93/0130"]);
    expect(
      generateMvt({
        ...base,
        station: "RUH",
        movement: {
          kind: "NI",
          nextInformation: new Date("2026-11-03T13:00:00Z"),
        },
      })
    ).toEqual(["MVT", "XY123/03.HZASA.RUH", "NI1300"]);
  });

  it("parses the generated departure message into a typed record with resolved UTC times", () => {
    const parsed = parseMvt(
      [
        "MVT",
        "XY123/03.HZASA.RUH",
        "AD1205/1218 EA1405 JED",
        "DL89/41/0015/0010",
        "PX180",
        "SI DELAYED INBOUND AIRCRAFT",
        "CREW ON TIME",
      ],
      new Date("2026-11-10T00:00:00Z")
    );
    expect(parsed.flight).toEqual({ carrier: "XY", number: "123" });
    expect(parsed.day).toBe(3);
    expect(parsed.registration).toBe("HZASA");
    expect(parsed.departure).toEqual({
      offBlocks: "1205",
      airborne: "1218",
      estimatedArrival: "1405",
      destination: "JED",
    });
    expect(parsed.delays).toEqual([
      { code: "89", minutes: 15 },
      { code: "41", minutes: 10 },
    ]);
    expect(parsed.passengers).toEqual([180]);
    expect(parsed.remarks).toEqual([
      "DELAYED INBOUND AIRCRAFT",
      "CREW ON TIME",
    ]);
    expect(parsed.times?.offBlocks).toBe("2026-11-03T12:05:00.000Z");
    expect(parsed.times?.estimatedArrival).toBe("2026-11-03T14:05:00.000Z");
  });

  it("rejects malformed times, unknown elements and movement-less messages", () => {
    expect(() => parseMvt(["MVT", "XY123/03.HZASA.RUH", "AD2505"])).toThrow(
      /HHMM/
    );
    expect(() => parseMvt(["MVT", "XY123/03.HZASA.RUH", "ZZ1205"])).toThrow(
      /Unknown MVT element/
    );
    expect(() => parseMvt(["MVT", "XY123/03.HZASA.RUH"])).toThrow(
      /no movement element/
    );
    expect(() =>
      parseMvt(["MVT", "XY123/03.HZASA.RUH", "DL89/0015/0010"])
    ).toThrow(/delay element/);
  });
});

describe("LDM (AHM 583)", () => {
  // Destination line shape as in public Evionica/AHM 583 examples:
  // -DEST.A/C/I.Tnnnn.compartment/weight...PAX/c/y.PAD/c/y
  it("generates flight, destination and SI lines", () => {
    const lines = generateLdm({
      type: "LDM",
      flight,
      departureDate: day,
      registration: "HZ-ASA",
      configuration: [
        { classCode: "C", seats: 14 },
        { classCode: "Y", seats: 165 },
      ],
      crew: { cockpit: 4, cabin: 12 },
      destinations: [
        {
          station: "JED",
          passengers: { adults: 102, children: 5, infants: 2 },
          totalLoadKg: 2850,
          compartments: [
            { compartment: "1", weightKg: 1200 },
            { compartment: "3", weightKg: 1650 },
          ],
          paxByClass: [8, 94],
          padByClass: [0, 0],
          baggage: { pieces: 120, weightKg: 1400 },
          cargoKg: 1250,
          mailKg: 200,
        },
      ],
      totals: {
        totalLoadKg: 2850,
        underloadKg: 1250,
        zeroFuelWeightKg: 55000,
        takeOffWeightKg: 65000,
        landingWeightKg: 60000,
      },
      remarks: ["pax weights actual"],
    });
    expect(lines).toEqual([
      "LDM",
      "XY123/03.HZASA.C14Y165.4/12",
      "-JED.102/5/2.T2850.1/1200.3/1650.PAX/8/94.PAD/0/0",
      "SI",
      "TOTAL LOAD 2850 KG",
      "UNDERLOAD BEFORE LMC 1250 KG",
      "ZFW 55000 TOW 65000 LAW 60000 KG",
      "JED BAG 120/1400 KG CARGO 1250 KG MAIL 200 KG",
      "PAX WEIGHTS ACTUAL",
    ]);
    const parsed = parseLdm(lines);
    expect(parsed.registration).toBe("HZASA");
    expect(parsed.configuration).toEqual([
      { classCode: "C", seats: 14 },
      { classCode: "Y", seats: 165 },
    ]);
    expect(parsed.crew).toEqual({ cockpit: 4, cabin: 12 });
    expect(parsed.destinations[0]).toEqual({
      station: "JED",
      passengers: { adults: 102, children: 5, infants: 2 },
      totalLoadKg: 2850,
      compartments: [
        { compartment: "1", weightKg: 1200 },
        { compartment: "3", weightKg: 1650 },
      ],
      paxByClass: [8, 94],
      padByClass: [0, 0],
    });
    expect(parsed.remarks[0]).toBe("TOTAL LOAD 2850 KG");
  });

  it("parses the M/F/C/I passenger form and rejects a PAX class mismatch", () => {
    const parsed = parseLdm([
      "LDM",
      "XY123/03.HZASA.Y180.2/5",
      "-JED.60/42/5/2.T1400.1/1400.PAX/107",
    ]);
    expect(parsed.destinations[0].passengers).toEqual({
      males: 60,
      females: 42,
      children: 5,
      infants: 2,
    });
    expect(() =>
      generateLdm({
        type: "LDM",
        flight,
        departureDate: day,
        registration: "HZASA",
        configuration: [{ classCode: "Y", seats: 180 }],
        crew: { cockpit: 2, cabin: 5 },
        destinations: [
          {
            station: "JED",
            passengers: { adults: 1, children: 0, infants: 0 },
            totalLoadKg: 0,
            compartments: [],
            paxByClass: [1, 0],
          },
        ],
      })
    ).toThrow(/PAX\//);
  });
});

describe("BSM / BPM (RP 1745)", () => {
  // Element layout from public SITA BagMessage / RP 1745 examples:
  // .V/1L<STN> .F/<flt>/<date>/<dest>/<class> .N/<10-digit plate><3-digit count> .S/ .P/ .L/ .W/
  it("generates a BSM for an accepted local bag", () => {
    const lines = generateBsm({
      type: "BSM",
      version: { indicator: "L", station: "RUH" },
      outbound: { flight, date: day, station: "JED", classCode: "Y" },
      licensePlates: [{ plate: buildLicensePlate("065", 123456) }],
      passengerStatus: {
        checkedIn: true,
        seat: "14A",
        cabinClass: "Y",
        sequence: 74,
      },
      passenger: { surname: "Smith", givenNames: "John" },
      locator: "ABC123",
      baggage: { unit: "K", pieces: 1, weight: 23 },
      onward: {
        flight: { carrier: "XY", number: "456" },
        date: day,
        station: "DXB",
        classCode: "Y",
      },
    });
    expect(lines).toEqual([
      "BSM",
      ".V/1LRUH",
      ".F/XY0123/03NOV/JED/Y",
      ".N/0065123456001",
      ".S/Y/14A/Y/074",
      ".P/SMITH/JOHN",
      ".L/ABC123",
      ".W/K/1/23",
      ".O/XY0456/03NOV/DXB/Y",
      "ENDBSM",
    ]);
    const parsed = parseBsm(lines, new Date("2026-11-01T00:00:00Z"));
    expect(parsed.action).toBe("ADD");
    expect(parsed.version).toEqual({ indicator: "L", station: "RUH" });
    expect(parsed.outbound?.flight).toEqual({ carrier: "XY", number: "123" });
    expect(parsed.outbound?.dateIso).toBe("2026-11-03");
    expect(parsed.licensePlates).toEqual([{ plate: "0065123456", count: 1 }]);
    expect(parsed.passengerStatus).toEqual({
      checkedIn: true,
      seat: "14A",
      cabinClass: "Y",
      sequence: 74,
    });
    expect(parsed.baggage).toEqual({ unit: "K", pieces: 1, weight: 23 });
    expect(parsed.onward?.station).toBe("DXB");
  });

  it("emits CHG/DEL indicators and rejects non-IATA tags", () => {
    const lines = generateBsm({
      type: "BSM",
      action: "DEL",
      version: { indicator: "T", station: "JED" },
      outbound: { flight, date: day, station: "JED" },
      licensePlates: [{ plate: "0065123456", count: 2 }],
    });
    expect(lines.slice(0, 2)).toEqual(["BSM", "DEL"]);
    expect(lines).toContain(".N/0065123456002");
    expect(parseBsm(lines).action).toBe("DEL");
    expect(() =>
      generateBsm({
        type: "BSM",
        version: { indicator: "L", station: "RUH" },
        outbound: { flight, date: day, station: "JED" },
        licensePlates: [{ plate: "AIS123456" }],
      })
    ).toThrow(/10 digits/);
  });

  it("generates and parses a BPM with the .J/ processing element", () => {
    const lines = generateBpm({
      type: "BPM",
      version: { indicator: "L", station: "RUH" },
      processing: {
        indicator: "L",
        time: new Date("2026-11-03T10:15:00Z"),
        location: "RUH",
        device: "BC12",
      },
      outbound: { flight, date: day, station: "JED" },
      licensePlates: [{ plate: "0065123456" }],
    });
    expect(lines).toEqual([
      "BPM",
      ".V/1LRUH",
      ".J/L/1015/RUH/BC12",
      ".F/XY0123/03NOV/JED",
      ".N/0065123456001",
      "ENDBPM",
    ]);
    expect(parseBsm(lines).processing).toEqual({
      indicator: "L",
      time: "1015",
      location: "RUH",
      device: "BC12",
    });
    expect(() => parseBsm(["BSM", ".V/1LRUH", "ENDBSM"])).toThrow(
      /licence plate/
    );
    expect(() => parseBsm(["BSM", ".N/0065123456001"])).toThrow(/ENDBSM/);
  });

  it("renders the same BSM payload as a BIX mapping document", () => {
    const payload = {
      type: "BSM" as const,
      version: { indicator: "L" as const, station: "RUH" },
      outbound: { flight, date: day, station: "JED", classCode: "Y" },
      licensePlates: [{ plate: "0065123456" }],
      passenger: { surname: "SMITH", givenNames: "JOHN" },
      baggage: { unit: "K" as const, pieces: 1, weight: 23 },
    };
    const typeb = typeBSerializer.serialize(payload);
    const bix = JSON.parse(bixSerializer.serialize(payload).parts[0]);
    expect(typeb.parts[0].startsWith("BSM\n")).toBe(true);
    expect(bix.conformance).toBe("mapping_target_not_certified");
    expect(bix.bags).toEqual([
      { licencePlate: "0065123456", consecutiveCount: 1 },
    ]);
    expect(bix.outboundSegment.scheduledDate).toBe("2026-11-03");
    expect(bix.baggageWeight.unit).toBe("KGM");
    expect(() =>
      bixSerializer.serialize({
        type: "MVT",
        flight,
        date: day,
        registration: "HZASA",
        station: "RUH",
        movement: { kind: "NI", nextInformation: day },
      })
    ).toThrow(/baggage messages only/);
  });
});

describe("PNL / ADL (RP 1708 family)", () => {
  const pax = (
    overrides: Partial<PnlPassenger> &
      Pick<PnlPassenger, "surname" | "givenNames">
  ): PnlPassenger => ({
    type: "adult",
    title: "MR",
    locator: "ABC123",
    destination: "JED",
    classCode: "Y",
    ...overrides,
  });

  it("groups names by destination and class, folds families and renders SSR/OSI elements", () => {
    const parts = generatePnl({
      type: "PNL",
      flight,
      departureDate: day,
      boardPoint: "RUH",
      configuration: [
        { classCode: "C", seats: 16 },
        { classCode: "Y", seats: 150 },
      ],
      rbd: [{ classCode: "Y", bookingClasses: "YBHKMLQ" }],
      passengers: [
        pax({ surname: "Smith", givenNames: "John", locator: "DEF456" }),
        pax({
          surname: "Smith",
          givenNames: "Jane",
          title: "MRS",
          locator: "DEF456",
          ssrs: [{ code: "VGML" }],
        }),
        pax({
          surname: "Al-Harbi",
          givenNames: "Ahmed",
          ssrs: [{ code: "WCHR", text: "cannot walk long distance" }],
          osi: ["CTCM 966500000000"],
          seat: "12a",
          ticketNumber: "0651234567890",
        }),
        pax({ surname: "Al-Harbi", givenNames: "Sara", type: "infant" }),
        pax({
          surname: "Brown",
          givenNames: "Tom",
          classCode: "C",
          locator: "GHI789",
          type: "child",
        }),
      ],
    });
    expect(parts).toHaveLength(1);
    expect(parts[0]).toEqual([
      "PNL",
      "XY123/03NOV RUH PART1",
      "CFG/016C150Y",
      "RBD/Y/YBHKMLQ",
      "-JED001C",
      "1BROWN/TOMCHD .L/GHI789",
      "-JED003Y",
      "1ALHARBI/AHMEDMR .L/ABC123",
      " .R/WCHR HK1 CANNOT WALK LONG DISTANCE",
      " .R/TKNE HK1 0651234567890/1",
      " .R/SEAT HK1 12A",
      " .R/INFT HK1 ALHARBI/SARA",
      " .OSI/CTCM 966500000000",
      "2SMITH/JANEMRS/JOHNMR .L/DEF456",
      " .R/VGML HK1",
      "ENDPNL",
    ]);
  });

  it("splits long lists into parts with per-part destination counts", () => {
    const passengers = Array.from({ length: 220 }, (_, i) =>
      pax({
        surname: `Passenger${String(i).padStart(3, "0")}`,
        givenNames: "Test",
        locator: `L${String(i).padStart(5, "0")}`,
        ssrs: [{ code: "VGML" }, { code: "WCHR" }],
      })
    );
    const parts = generatePnl({
      type: "PNL",
      flight,
      departureDate: day,
      boardPoint: "RUH",
      passengers,
    });
    expect(parts.length).toBeGreaterThan(1);
    expect(parts[0][1]).toBe("XY123/03NOV RUH PART1");
    expect(parts[0].at(-1)).toBe("ENDPART1");
    expect(parts.at(-1)?.at(-1)).toBe("ENDPNL");
    const counts = parts.map(p => {
      const header = p.find(line => /^-JED\d{3}Y$/.test(line)) as string;
      return Number(header.slice(4, 7));
    });
    expect(counts.reduce((a, b) => a + b, 0)).toBe(220);
    for (const part of parts) {
      expect(part.join("\n").length).toBeLessThanOrEqual(3700);
      for (const line of part) expect(line.length).toBeLessThanOrEqual(64);
    }
  });

  it("generates an ADL with ADD, CHG and DEL sections under one destination header", () => {
    const parts = generateAdl({
      type: "ADL",
      flight,
      departureDate: day,
      boardPoint: "RUH",
      add: [pax({ surname: "Brown", givenNames: "Tom", locator: "GHI789" })],
      change: [
        pax({
          surname: "Smith",
          givenNames: "John",
          seat: "3C",
          classCode: "C",
        }),
      ],
      delete: [
        pax({
          surname: "Doe",
          givenNames: "Jane",
          title: "MS",
          locator: "JKL012",
        }),
      ],
    });
    expect(parts).toEqual([
      [
        "ADL",
        "XY123/03NOV RUH PART1",
        "-JED000C",
        "CHG",
        "1SMITH/JOHNMR .L/ABC123",
        " .R/SEAT HK1 3C",
        "-JED001Y",
        "ADD",
        "1BROWN/TOMMR .L/GHI789",
        "DEL",
        "1DOE/JANEMS .L/JKL012",
        "ENDADL",
      ],
    ]);
    expect(() =>
      generateAdl({
        type: "ADL",
        flight,
        departureDate: day,
        boardPoint: "RUH",
        add: [],
        change: [],
        delete: [],
      })
    ).toThrow(/at least one/);
  });

  it("uses supplied booked totals in ADL headers and rejects infants without an adult", () => {
    const parts = generateAdl({
      type: "ADL",
      flight,
      departureDate: day,
      boardPoint: "RUH",
      add: [],
      change: [],
      delete: [pax({ surname: "Doe", givenNames: "Jane", title: "MS" })],
      totals: [{ destination: "JED", classCode: "Y", booked: 57 }],
    });
    expect(parts[0]).toContain("-JED057Y");
    expect(() =>
      generatePnl({
        type: "PNL",
        flight,
        departureDate: day,
        boardPoint: "RUH",
        passengers: [
          pax({ surname: "Lone", givenNames: "Infant", type: "infant" }),
        ],
      })
    ).toThrow(/accompanying adult/);
  });
});

describe("text helpers", () => {
  it("derives designators from AIS flight numbers and resolves DDMMM across year end", () => {
    expect(designatorFromFlightNumber("XY123")).toEqual({
      carrier: "XY",
      number: "123",
    });
    expect(designatorFromFlightNumber("XY0123")).toEqual({
      carrier: "XY",
      number: "123",
    });
    expect(designatorFromFlightNumber("9W 456")).toEqual({
      carrier: "9W",
      number: "456",
    });
    expect(designatorFromFlightNumber("123", "XY")).toEqual({
      carrier: "XY",
      number: "123",
    });
    expect(
      parseDdmmm("03JAN", new Date("2026-12-20T00:00:00Z")).toISOString()
    ).toBe("2027-01-03T00:00:00.000Z");
    expect(() => parseDdmmm("31FEB")).toThrow(/calendar/);
  });
});
