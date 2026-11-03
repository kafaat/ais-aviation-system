import { describe, expect, it } from "vitest";
import {
  generatePNRGOV,
  formOfPaymentCode,
  type PnrgovInput,
} from "../services/apis-pnrgov";
import { parseEdifact, segment, unoaElement } from "../services/edifact";

const leg = {
  flightNumber: "XX123",
  carrierCode: "XX",
  origin: { code: "RUH", timezone: "Asia/Riyadh" },
  destination: { code: "LHR", timezone: "Europe/London" },
  departureTime: new Date("2026-11-03T22:45:00Z"),
  arrivalTime: new Date("2026-11-04T04:30:00Z"),
  status: "scheduled",
};

function input(overrides: Partial<PnrgovInput> = {}): PnrgovInput {
  return {
    sender: { carrierCode: "XX", locationCode: "RUH" },
    recipient: "SANPSCTEST",
    interchangeControlReference: "ABCDEF123456",
    messageReference: "1",
    flight: leg,
    generatedAt: new Date("2026-11-02T22:45:00Z"),
    bookings: [
      {
        recordLocator: "AB1CD2",
        createdAt: new Date("2026-10-01T10:15:00Z"),
        updatedAt: new Date("2026-10-20T08:00:00Z"),
        status: "confirmed",
        cabinClass: "economy",
        totalAmountMinor: 123456,
        currency: "SAR",
        contactEmail: "traveller@example.com",
        payments: [
          {
            method: "mada",
            status: "completed",
            amountMinor: 123456,
            currency: "SAR",
          },
          {
            method: "card",
            status: "failed",
            amountMinor: 123456,
            currency: "SAR",
          },
        ],
        legs: [leg],
        passengers: [
          {
            passengerId: 1,
            surname: "O'Neal",
            givenNames: "A+B",
            type: "adult",
            ticketNumber: "0012345678901",
            seatNumber: "12A",
            checkedIn: true,
            document: {
              documentType: "passport",
              documentNumber: "P1234567",
              issuingCountry: "XB",
              nationality: "XB",
              dateOfBirth: "1988-02-29",
              gender: "F",
              expiryDate: "2030-12-31",
              surname: "ONEAL",
              givenNames: "AB",
              residenceCountry: "XB",
              residenceAddress: "1 MAIN ST",
              destinationAddress: "HOTEL LONDON",
            },
          },
        ],
      },
    ],
    ...overrides,
  };
}

describe("PNRGOV EDIFACT draft", () => {
  it("builds the header with airport-local TVL times, the PNR count and a balanced envelope", () => {
    const draft = generatePNRGOV(input());
    const lines = draft.message.split("\n");
    expect(lines[0]).toBe("UNB+IATA:1+XX+SANPSCTEST+261102:2245+ABCDEF123456'");
    expect(lines[1]).toBe("UNH+1+PNRGOV:21:1:IA'");
    expect(lines[2]).toBe("MSG+:22'");
    expect(lines[3]).toBe("ORG+XX:RUH'");
    // 22:45Z on 3 Nov is 01:45 on 4 Nov in Riyadh; 04:30Z is 04:30 in London (GMT).
    expect(lines[4]).toBe("TVL+041126:0145:041126:0430+RUH+LHR+XX+123'");
    expect(lines[5]).toBe("EQN+1'");
    expect(lines.at(-1)).toBe("UNZ+1+ABCDEF123456'");
    // UNT counts UNH through UNT itself (everything except UNB and UNZ).
    expect(lines.at(-2)).toBe(`UNT+${lines.length - 2}+1'`);
    expect(draft.segmentCount).toBe(lines.length);
    expect(draft.pnrCount).toBe(1);
    expect(draft.passengerCount).toBe(1);
    expect(draft.documentedPassengerCount).toBe(1);
  });

  it("populates PNR, passenger, document, ticket, payment and itinerary groups from the held data", () => {
    const lines = generatePNRGOV(input()).message.split("\n");
    for (const expected of [
      "SRC'",
      "RCI+XX:AB1CD2'",
      "SSR+CTCE+HK+1+XX+TRAVELLER//EXAMPLE.COM'",
      "DAT+700:261001:1015'",
      "DAT+710:261020:0800'",
      "TIF+O?'NEAL+A?+B:A:1'",
      "SSR+DOCS+HK+1+XX+/P/XB/P1234567/XB/29FEB88/F/31DEC30/ONEAL/AB'",
      "SSR+DOCA+HK+1+XX+/R/XB/1 MAIN ST'",
      "SSR+DOCA+HK+1+XX+/D//HOTEL LONDON'",
      "TKT+0012345678901:T'",
      "MON+T:1234.56:SAR'",
      "FOP+CC'",
      "RPI+1+HK'",
      "SSR+SEAT+HK+1+XX+12A'",
    ])
      expect(lines).toContain(expected);
    // Only the completed payment is reported.
    expect(lines.filter(l => l.startsWith("FOP")).length).toBe(1);
  });

  it("reports which groups are populated, partial or unavailable from the current data model", () => {
    const draft = generatePNRGOV(input());
    const byGroup = Object.fromEntries(
      draft.groups.map(g => [g.group, g.status])
    );
    expect(byGroup["Header"]).toBe("populated");
    expect(byGroup["Group 2 passenger"]).toBe("populated");
    expect(byGroup["Group 3 ticket"]).toBe("partial");
    expect(byGroup["Group 4 form of payment"]).toBe("partial");
    expect(byGroup["Group 2 frequent traveller"]).toBe("unavailable");
    expect(byGroup["Travel agent"]).toBe("unavailable");
    expect(draft.unverified.length).toBeGreaterThan(0);
  });

  it("omits MON for multi-passenger PNRs because per-passenger fares are not stored", () => {
    const base = input();
    const booking = base.bookings[0];
    booking.passengers.push({
      ...booking.passengers[0],
      passengerId: 2,
      surname: "Second",
      givenNames: "Pax",
      type: "child",
      document: null,
      seatNumber: null,
    });
    const draft = generatePNRGOV(base);
    expect(draft.message).not.toContain("MON+");
    expect(draft.message).toContain("TIF+SECOND+PAX:C:2'");
    expect(draft.message).toContain("RPI+2+HK'");
    expect(draft.documentedPassengerCount).toBe(1);
  });

  it("drops a non-UNOA contact e-mail but keeps the PNR", () => {
    const base = input();
    base.bookings[0].contactEmail = "علي@example.com";
    const draft = generatePNRGOV(base);
    expect(draft.message).not.toContain("CTCE");
    expect(draft.message).toContain("RCI+XX:AB1CD2'");
  });

  it.each(["Aß", "علي", "ABC\nUNZ", "Name\r"])(
    "rejects non-UNOA passenger text naming PNR, passenger and field without echoing it",
    value => {
      const base = input();
      base.bookings[0].passengers[0].surname = value;
      let caught: unknown;
      try {
        generatePNRGOV(base);
      } catch (error) {
        caught = error;
      }
      expect(caught).toMatchObject({ code: "BAD_REQUEST" });
      const message = (caught as Error).message;
      expect(message).toContain("PNR AB1CD2 passenger 1 (surname)");
      expect(message).not.toContain(value.trim());
    }
  );

  it("round-trips through the shared parser with released service characters", () => {
    const parsed = parseEdifact(generatePNRGOV(input()).message);
    const tif = parsed.find(s => s.tag === "TIF");
    expect(tif?.elements[0][0]).toBe("O'NEAL");
    expect(tif?.elements[1]).toEqual(["A+B", "A", "1"]);
    expect(parsed[0].tag).toBe("UNB");
    expect(parsed.at(-1)?.tag).toBe("UNZ");
  });

  it("maps payment methods to form-of-payment codes without account data", () => {
    expect(formOfPaymentCode("card")).toBe("CC");
    expect(formOfPaymentCode("mada")).toBe("CC");
    expect(formOfPaymentCode("bank_transfer")).toBe("CA");
    expect(formOfPaymentCode("tabby")).toBe("MS");
  });
});

describe("EDIFACT helpers", () => {
  it("trims trailing empty elements and components in segments", () => {
    expect(segment("TVL", ["A", "B", "", ""], "X", undefined, null)).toBe(
      "TVL+A:B+X'"
    );
    expect(segment("SRC")).toBe("SRC'");
  });
  it("releases ? + : ' * and refuses anything outside UNOA", () => {
    expect(unoaElement("a?b+c:d'e*f")).toBe("A??B?+C?:D?'E?*F");
    expect(() => unoaElement("a_b", "x")).toThrow();
  });
  it("parses released characters and rejects unterminated input", () => {
    const [seg] = parseEdifact("NAD+FL+++O?'NEAL:A?+B'");
    expect(seg.elements[3]).toEqual(["O'NEAL", "A+B"]);
    expect(() => parseEdifact("NAD+FL")).toThrow(/Unterminated/);
  });
});
