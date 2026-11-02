import { describe, expect, it } from "vitest";
import { generatePAXLST } from "../services/apis-paxlst";

function draft(lastName = "O'Neal", firstName = "A+B:C?D*E") {
  return generatePAXLST({
    flight: {
      id: 1,
      flightNumber: "XX1",
      departureTime: new Date("2026-11-03T22:45:00Z"),
      arrivalTime: new Date("2026-11-04T01:30:00Z"),
    },
    origin: { code: "RUH", country: "SA", timezone: "Asia/Riyadh" },
    destination: { code: "LHR", country: "GB", timezone: "Europe/London" },
    airline: { code: "XX", name: "TEST AIRLINE" },
    passengers: [
      { passengerId: 1, firstName, lastName, bookingReference: "ABC123" },
      {
        passengerId: 2,
        firstName: "Other",
        lastName: "Person",
        bookingReference: "ABC124",
      },
    ],
    apisMap: new Map([
      [
        1,
        {
          date_of_birth: "1988-02-29",
          expiry_date: "2030-12-31",
          document_type: "visa",
          document_number: "A012",
          gender: "F",
        },
      ],
    ]),
  });
}

describe("PAXLST local draft", () => {
  it("serializes airport-local times with 201, six-digit civil dates and document attributes", () => {
    const message = draft();
    for (const segment of [
      "DTM+189:2611040145:201'",
      "DTM+232:2611040130:201'",
      "DTM+329:880229'",
      "DTM+36:301231'",
      "ATT+2++F'",
      "DOC+V+A012'",
    ])
      expect(message).toContain(segment);
  });
  it("releases delimiters, counts the included records and balances the envelope", () => {
    const lines = draft().split("\n");
    expect(lines).toContain("NAD+FL+++O?'NEAL:A?+B?:C??D?*E'");
    expect(lines).toContain("CNT+42:1'");
    expect(lines).toContain(`UNT+${lines.length - 2}+1'`);
  });
  it.each(["ABC\nCNT", "ABC\r", "Aß", "علي"])(
    "rejects unsupported text without exposing it",
    value => {
      expect(() => draft(value)).toThrow(
        "PAXLST field contains unsupported UNOA characters"
      );
    }
  );
});
