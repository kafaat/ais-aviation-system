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
      `UNB+IATA:1+GOV+SV+261103:0102+1'\nUNH+1+ACKRES:21:1:IA+ABC'\n${body}'\nUNT+${body.includes("ERC+") ? 4 : 3}+1'\nUNZ+1+1'`
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

describe("authority response correlation", () => {
  const outgoing = {
    messageType: "PAXLST",
    messageContent:
      "UNB+UNOA:4+AIR+AUTH+20261103:0102+INT1'UNH+M1+PAXLST:D:05B:UN:IATA+CA1'BGM+745'RFF+TN:TX1::2'UNT+4+M1'UNZ+1+INT1'",
  };
  const wrapper = (body: string[]) =>
    "UNB+UNOA:4+AUTH+AIR+20261103:0102+REPLY'" +
    body.join("'") +
    "'UNZ+1+REPLY'";
  const cusres = (tn: string, code: string, point = "1") =>
    wrapper([
      "UNH+R1+CUSRES:D:12B:UN:IATA",
      "BGM+962",
      "RFF+TN:" + tn,
      "ERP+" + point,
      "ERC+" + code,
      "UNT+6+R1",
    ]);

  it("accepts the matching transaction and revision as receipt only", () => {
    expect(
      parseAuthorityAcknowledgment(cusres("TX1::2", "ACK"), outgoing).status
    ).toBe("received");
    expect(
      parseAuthorityAcknowledgment(cusres("TX1::2", "X"), outgoing).status
    ).toBe("rejected");
    for (const invalid of [
      cusres("REPLY", "ACK"),
      cusres("TX1::1", "ACK"),
      cusres("TX1::2", "ZZ"),
      cusres("TX1::2", "ACK", "2"),
      cusres("TX1::2", "ACK").replace("+AUTH+AIR", "+WRONG+AIR"),
    ])
      expect(() => parseAuthorityAcknowledgment(invalid, outgoing)).toThrow();
  });

  it("scopes syntax rejections to the original interchange and message", () => {
    const reply = wrapper([
      "UNH+C+CONTRL:4:1:UN",
      "UCI+INT1+AIR+AUTH+8",
      "UCM+M1+PAXLST:D:05B:UN:IATA+4+15",
      "UNT+4+C",
    ]);
    expect(parseAuthorityAcknowledgment(reply, outgoing)).toMatchObject({
      status: "rejected",
      errorCodes: ["15"],
    });
    for (const invalid of [
      reply.replace("UCI+INT1", "UCI+WRONG"),
      reply.replace("UCM+M1", "UCM+M2"),
      reply.replace("UCI+INT1+AIR", "UCI+INT1+WRONG"),
    ])
      expect(() => parseAuthorityAcknowledgment(invalid, outgoing)).toThrow();
  });

  it("rejects ambiguous or escaped fake controls and checks PNR common reference", () => {
    const pnrgov = {
      messageType: "PNRGOV",
      messageContent: generatePNRGOV(input()),
    };
    const reference = pnrgov.messageContent.match(/UNH\+([^+]+)/)![1];
    const reply = wrapper([
      "UNH+R+ACKRES:21:1:IA+" + reference,
      "MSG+:23+3",
      "UNT+3+R",
    ]).replace("+AUTH+AIR", "+SAGOV+SV");
    expect(parseAuthorityAcknowledgment(reply, pnrgov).status).toBe(
      "acknowledged"
    );
    for (const invalid of [
      reply.replace(reference, "OTHER"),
      reply.replace("MSG+:23+3", "FTX+ZZZ+++FAKE?'MSG?+:23?+3"),
      reply
        .replace("MSG+:23+3", "MSG+:23+3'MSG+:23+8")
        .replace("UNT+3", "UNT+4"),
      reply.replace("UNT+3", "UNT+4"),
    ])
      expect(() => parseAuthorityAcknowledgment(invalid, pnrgov)).toThrow();
  });
});
