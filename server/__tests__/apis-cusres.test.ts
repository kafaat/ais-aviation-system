import { describe, expect, it } from "vitest";
import { parseAcknowledgement } from "../services/apis-cusres";

const ack = [
  "UNB+UNOA:4+SANPSCTEST+XX+261103:0100+77'",
  "UNH+1+CUSRES:D:05B:UN:IATA'",
  "BGM+962'",
  "RFF+ACW:ABCDEF123456'",
  "UNT+4+1'",
  "UNZ+1+77'",
].join("\n");

const nak = [
  "UNB+UNOA:4+SANPSCTEST+XX+261103:0100+78'",
  "UNH+1+CUSRES:D:05B:UN:IATA'",
  "BGM+962'",
  "RFF+ACW:ABCDEF123456'",
  "ERP+2'",
  "ERC+108'",
  "FTX+AAO+++INVALID DOCUMENT EXPIRY'",
  "ERP+3'",
  "ERC+112'",
  "UNT+9+1'",
  "UNZ+1+78'",
].join("");

describe("CUSRES / CONTRL acknowledgement parsing", () => {
  it("treats a CUSRES without error segments as a positive acknowledgement", () => {
    const parsed = parseAcknowledgement(ack);
    expect(parsed.messageType).toBe("CUSRES");
    expect(parsed.disposition).toBe("ack");
    expect(parsed.references).toContain("ABCDEF123456");
    expect(parsed.errors).toEqual([]);
  });

  it("collects error points, codes and free text from a CUSRES rejection", () => {
    const parsed = parseAcknowledgement(nak);
    expect(parsed.disposition).toBe("nak");
    expect(parsed.errors).toEqual([
      { code: "108", point: "2", text: "INVALID DOCUMENT EXPIRY" },
      { code: "112", point: "3", text: null },
    ]);
  });

  it("reads CONTRL UCI action codes", () => {
    expect(
      parseAcknowledgement(
        "UNB+UNOA:4+A+B+261103:0100+9'UNH+1+CONTRL:D:3:UN'UCI+ABCDEF123456+XX+A+7'UNT+3+1'UNZ+1+9'"
      )
    ).toMatchObject({
      messageType: "CONTRL",
      disposition: "ack",
      references: expect.arrayContaining(["ABCDEF123456"]),
    });
    const rejected = parseAcknowledgement(
      "UNH+1+CONTRL:D:3:UN'UCI+ABCDEF123456+XX+A+4+18'UNT+3+1'"
    );
    expect(rejected.disposition).toBe("nak");
    expect(rejected.errors).toEqual([{ code: "18", point: null, text: null }]);
  });

  it("returns unknown for messages it does not recognise", () => {
    const parsed = parseAcknowledgement("UNH+1+PAXLST:D:05B:UN:IATA'UNT+2+1'");
    expect(parsed.messageType).toBe("unknown");
    expect(parsed.disposition).toBe("unknown");
  });
});
