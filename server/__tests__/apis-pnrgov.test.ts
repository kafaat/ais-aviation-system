import { describe, expect, it } from "vitest";
import {
  generatePNRGOV,
  parseAuthorityAcknowledgment,
} from "../services/apis-pnrgov";

function input() {
  return {
    generatedAt: new Date("2026-11-03T01:02:03Z"),
    authorityRecipient: "SAGOV",
    flight: {
      id: 77,
      flightNumber: "SV123",
      departureTime: new Date("2026-11-03T22:00:00Z"),
      arrivalTime: new Date("2026-11-04T02:00:00Z"),
    },
    origin: { code: "RUH", country: "SA", timezone: "Asia/Riyadh" },
    destination: { code: "LHR", country: "GB", timezone: "Europe/London" },
    airline: { code: "SV", name: "SAUDI ARABIAN AIRLINES" },
    passengers: [
      {
        passengerId: 8,
        firstName: "ALI",
        lastName: "SALEH",
        bookingReference: "ABC123",
      },
      {
        passengerId: 9,
        firstName: "SARA",
        lastName: "SALEH",
        bookingReference: "ABC123",
      },
    ],
    apisMap: new Map([
      [
        8,
        {
          document_type: "passport",
          document_number: "P123456",
          issuing_country: "SA",
          nationality: "SA",
          date_of_birth: "1990-01-02",
          expiry_date: "2030-12-31",
          gender: "M",
          given_names: "ALI",
          surname: "SALEH",
        },
      ],
    ]),
  };
}

describe("PNRGOV 21.1 structural draft", () => {
  it("uses PADIS envelopes, one PNR group and airport-local flight times", () => {
    const message = generatePNRGOV(input());
    expect(message).toContain("UNH+");
    expect(message).toContain("+PNRGOV:21:1:IA+");
    expect(message).toContain("MSG+:22'");
    expect(message).toContain("TVL+041126:0100:041126:0200+RUH+LHR+SV+123'");
    expect(message.match(/\nSRC'/g)).toHaveLength(1);
    expect(message).toContain("EQN+1'");
    expect(message).toContain(
      "SSR+DOCS:HK:1:SV::::/P/SA/P123456/SA/02JAN90/M/31DEC30/SALEH/ALI'"
    );
    const lines = message.split("\n");
    const unh = lines.findIndex(line => line.startsWith("UNH+"));
    const unt = lines.find(line => line.startsWith("UNT+"));
    expect(Number(unt?.split("+")[1])).toBe(lines.length - unh - 2);
  });

  it("rejects unsupported names rather than silently changing them", () => {
    const data = input();
    data.passengers[0].lastName = "صالح";
    data.apisMap.delete(8);
    expect(() => generatePNRGOV(data)).toThrow(/passenger 8/);
  });

  it.each([
    ["MSG+23+2", "received"],
    ["MSG+23+3", "acknowledged"],
    ["MSG+23+8'\nERC+102", "rejected"],
  ])("maps ACKRES %s to %s", (body, status) => {
    const result = parseAuthorityAcknowledgment(
      `UNB+IATA:1+GOV+SV+261103:0102+1'\nUNH+1+ACKRES:21:1:IA+ABC'\n${body}'\nUNT+3+1'\nUNZ+1+1'`
    );
    expect(result.status).toBe(status);
    if (status === "rejected") expect(result.errorCodes).toEqual(["102"]);
  });

  it("distinguishes a CONTRL receipt from a structural rejection", () => {
    expect(
      parseAuthorityAcknowledgment(
        "UNH+1+CONTRL:4:1:UN'\nUCI+1+GOV+SV+7'\nUNT+3+1'"
      ).status
    ).toBe("received");
    expect(
      parseAuthorityAcknowledgment(
        "UNH+1+CONTRL:4:1:UN'\nUCI+1+GOV+SV+4+18'\nUNT+3+1'"
      ).status
    ).toBe("rejected");
  });
});
