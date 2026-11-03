import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decode } from "bcbp";
import {
  appendBcbpSecurityData,
  BCBP_MANDATORY_LENGTH,
  bcbpJulianDate,
  bcbpMandatoryItems,
  BcbpFormatError,
  decodeBcbpM1,
  encodeBcbpM1,
  formatBcbpFlightNumber,
  formatBcbpName,
  formatBcbpSeat,
  isBcbpBarcode,
  normalizeBcbpSeat,
  type BcbpM1Fields,
} from "./bcbp.service";
import { bcbpSecurityData } from "./boarding-pass.service";

interface Vector {
  name: string;
  input: Omit<BcbpM1Fields, "departureTime" | "issuedAt"> & {
    departureTime: string;
    issuedAt: string;
  };
  base: string;
  securityData: string;
  bcbp: string;
}
const samples = JSON.parse(
  readFileSync(
    new URL("../__tests__/fixtures/bcbp-samples.json", import.meta.url),
    "utf8"
  )
) as {
  secret: string;
  passDigest: string;
  encoded: Vector[];
  iataGuideExample: { bcbp: string; expected: Record<string, unknown> };
};
const fields = (v: Vector): BcbpM1Fields => ({
  ...v.input,
  departureTime: new Date(v.input.departureTime),
  issuedAt: new Date(v.input.issuedAt),
});
const sample = (name: string) => {
  const v = samples.encoded.find(s => s.name === name);
  if (!v) throw new Error(`Missing fixture ${name}`);
  return v;
};

describe("BCBP M1 encoding", () => {
  it("round-trips every committed vector through encode and the library decoder", () => {
    for (const v of samples.encoded) {
      const base = encodeBcbpM1(fields(v));
      expect(base).toBe(v.base);
      const security = bcbpSecurityData(base, samples.passDigest, {
        secret: samples.secret,
      });
      expect(security).toBe(v.securityData);
      const full = appendBcbpSecurityData(base, security);
      expect(full).toBe(v.bcbp);
      expect(full).toMatch(/^[\x20-\x7E]+$/);

      const ours = decodeBcbpM1(full);
      expect(ours.pnr).toBe(v.input.pnr);
      expect(ours.departureAirport).toBe(v.input.departureAirport);
      expect(ours.arrivalAirport).toBe(v.input.arrivalAirport);
      expect(ours.carrier).toBe(v.input.carrier);
      expect(normalizeBcbpSeat(ours.seatNumber)).toBe(
        v.input.seatNumber.toUpperCase()
      );
      expect(ours.sequence).toBe(v.input.sequence);
      expect(ours.version).toBe(6);
      expect(ours.securityDataType).toBe("1");
      expect(ours.securityData).toBe(v.securityData);
      expect(ours.base).toBe(v.base);
      expect(ours.mandatory).toBe(v.base.slice(0, BCBP_MANDATORY_LENGTH));
      expect(bcbpMandatoryItems(fields(v))).toBe(ours.mandatory);

      const lib = decode(full);
      expect(lib.meta?.formatCode).toBe("M");
      expect(lib.meta?.numberOfLegs).toBe(1);
      expect(lib.meta?.electronicTicketIndicator).toBe("E");
      expect(lib.data?.legs?.[0]?.passengerStatus).toBe("1");
      expect(lib.data?.documentType).toBe("B");
      expect(lib.data?.securityData).toBe(v.securityData);
    }
  });

  it("decodes the IATA implementation-guide example independently of our encoder", () => {
    const d = decodeBcbpM1(samples.iataGuideExample.bcbp);
    expect(d).toMatchObject(samples.iataGuideExample.expected);
    expect(d.securityData).toBeUndefined();
    expect(d.version).toBeUndefined();
  });

  it("formats names as SURNAME/GIVEN in Latin capitals and truncates given names first", () => {
    expect(formatBcbpName("Alqahtani", "Mohammed")).toBe("ALQAHTANI/MOHAMMED");
    expect(formatBcbpName("Ortiz", "Lucía")).toBe("ORTIZ/LUCIA");
    expect(formatBcbpName("O'Neill-Smith", "Seán")).toBe("ONEILLSMITH/SEAN");
    const long = formatBcbpName(
      "Al-Shammari Alqahtani",
      "Abdulrahman Mohammed"
    );
    expect(long).toBe("ALSHAMMARI ALQAHTA/A");
    expect(long).toHaveLength(20);
    expect(formatBcbpName("Abcdefghijklmnopqrstuvwxyz", "")).toHaveLength(20);
    expect(formatBcbpName("Abcdefghijklmnopqrst", "Zed")).toBe(
      "ABCDEFGHIJKLMNOPQR/Z"
    );
    const v = sample("long_name_business_ticket");
    expect(v.base.slice(2, 22)).toBe("ALSHAMMARI ALQAHTA/A");
    expect(v.base[22]).toBe("E");
  });

  it.each([
    ["محمد", "Ali"],
    ["Alقحطاني", "Ali"],
    ["Smith", "Aعلي"],
    ["Smith", "-"],
    ["", "Sample"],
  ])("rejects fields that cannot preserve the name", (surname, given) => {
    expect(() => formatBcbpName(surname, given)).toThrow(BcbpFormatError);
  });

  it("uses the departure airport's civil day for the Julian date, across year boundaries", () => {
    const newYear = new Date("2026-12-31T22:30:00.000Z");
    expect(bcbpJulianDate(newYear, "Asia/Riyadh")).toBe("001");
    expect(bcbpJulianDate(newYear, "UTC")).toBe("365");
    for (const zone of [null, undefined, "", "Not/AZone", "+03:00"]) {
      expect(() => bcbpJulianDate(newYear, zone)).toThrow(BcbpFormatError);
    }
    expect(
      bcbpJulianDate(
        new Date("2026-01-01T06:30:00.000Z"),
        "America/Los_Angeles"
      )
    ).toBe("365");
    expect(
      bcbpJulianDate(new Date("2026-01-01T06:30:00.000Z"), "Asia/Riyadh")
    ).toBe("001");
    // Riyadh midnight edge: 20:59Z is still the same civil day, 21:00Z is the next.
    expect(
      bcbpJulianDate(new Date("2026-03-10T20:59:59.000Z"), "Asia/Riyadh")
    ).toBe("069");
    expect(
      bcbpJulianDate(new Date("2026-03-10T21:00:00.000Z"), "Asia/Riyadh")
    ).toBe("070");
    // Leap year: 31 Dec 2028 is day 366.
    expect(bcbpJulianDate(new Date("2028-12-31T12:00:00.000Z"), "UTC")).toBe(
      "366"
    );
    expect(sample("riyadh_new_year").base.slice(44, 47)).toBe("001");
    expect(sample("la_previous_day_child").base.slice(44, 47)).toBe("365");
  });

  it("maps flight numbers, seats and sequences to fixed-width items", () => {
    expect(formatBcbpFlightNumber("SV123", "SV")).toBe("0123");
    expect(formatBcbpFlightNumber("SV 0556", "SV")).toBe("0556");
    expect(formatBcbpFlightNumber("XX7A", "XX")).toBe("0007A");
    expect(formatBcbpFlightNumber("1234", "SV")).toBe("1234");
    expect(() => formatBcbpFlightNumber("SV12345", "SV")).toThrow(
      BcbpFormatError
    );
    expect(formatBcbpSeat("12A")).toBe("012A");
    expect(formatBcbpSeat("1f")).toBe("001F");
    expect(normalizeBcbpSeat("012A")).toBe("12A");
    const v = sample("riyadh_new_year");
    expect(v.base.slice(39, 44)).toBe("0123 ");
    expect(v.base.slice(48, 52)).toBe("012A");
    expect(v.base.slice(52, 57)).toBe("0001 ");
    expect(v.base[57]).toBe("1");
    expect(() => encodeBcbpM1({ ...fields(v), sequence: 10000 })).toThrow(
      BcbpFormatError
    );
    expect(() =>
      encodeBcbpM1({ ...fields(v), departureAirport: "RUHX" })
    ).toThrow(BcbpFormatError);
    expect(() => encodeBcbpM1({ ...fields(v), cabinClass: "suite" })).toThrow(
      BcbpFormatError
    );
  });

  it("binds the security data to the barcode so an altered item or digest no longer verifies", () => {
    const v = sample("riyadh_new_year");
    const expected = bcbpSecurityData(v.base, samples.passDigest, {
      secret: samples.secret,
    });
    expect(expected).toBe(v.securityData);
    const seatChanged = v.base.replace("012A", "013A");
    expect(
      bcbpSecurityData(seatChanged, samples.passDigest, {
        secret: samples.secret,
      })
    ).not.toBe(v.securityData);
    expect(
      bcbpSecurityData(v.base, "e".repeat(64), { secret: samples.secret })
    ).not.toBe(v.securityData);
    expect(
      bcbpSecurityData(v.base, samples.passDigest, { secret: "other" })
    ).not.toBe(v.securityData);
    // Security section must be well formed.
    expect(() => decodeBcbpM1(`${v.base}^1`)).toThrow(BcbpFormatError);
    expect(() => decodeBcbpM1(`${v.base}^140abc`)).toThrow(BcbpFormatError);
    expect(() => decodeBcbpM1(`${v.base}x`)).toThrow(BcbpFormatError);
    expect(() => decodeBcbpM1(v.bcbp + "ignored")).toThrow(BcbpFormatError);
    expect(() =>
      decodeBcbpM1(v.base.slice(0, 58) + "1Z" + v.base.slice(60))
    ).toThrow(BcbpFormatError);
    expect(() => decodeBcbpM1(v.base.replace(">60B", ">6FE"))).toThrow(
      BcbpFormatError
    );
    expect(() => decodeBcbpM1(v.base.slice(0, -2) + "FF")).toThrow(
      BcbpFormatError
    );
    expect(() => decodeBcbpM1(v.base + "^110" + "x".repeat(15))).toThrow(
      BcbpFormatError
    );
    expect(() => decodeBcbpM1(v.base + "^11Zx")).toThrow(BcbpFormatError);
    expect(() => appendBcbpSecurityData(v.base, "")).toThrow(BcbpFormatError);
    expect(() => appendBcbpSecurityData(v.base, "a".repeat(101))).toThrow(
      BcbpFormatError
    );
  });

  it("recognises BCBP scans and rejects other formats", () => {
    expect(isBcbpBarcode(sample("riyadh_new_year").bcbp)).toBe(true);
    expect(isBcbpBarcode("eyJhbGciOiJIUzI1NiJ9.eyJib29raW5nSWQiOjF9.sig")).toBe(
      false
    );
    expect(() => decodeBcbpM1("M2" + "A".repeat(70))).toThrow(/single-leg/);
    expect(() =>
      decodeBcbpM1("M1ALQAHTANI/MOHAMMED  N" + " ".repeat(40))
    ).toThrow(BcbpFormatError);
  });
});
