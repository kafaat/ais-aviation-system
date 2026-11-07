/**
 * Gateway logic that does not need a database: station-file routing, the
 * outbound delivery core against the in-memory and file-drop transports,
 * inbound parsing, configuration and the PNL timing rule.
 */
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../db", () => ({ getDb: () => null }));

import {
  normalizeAddressInput,
  parseInbound,
  processOutbound,
  recipientsFor,
  stationsFor,
  typeBConfig,
} from "./gateway.service";
import {
  FileDropTransport,
  InMemoryTransport,
  configuredTypeBTransport,
} from "./transport";
import { pnlDue } from "./triggers.service";

const rows = [
  {
    address: "RUHKPXY",
    stationCode: "RUH",
    messageTypes: ["PNL", "ADL", "BSM"],
    enabled: true,
    tenantId: null,
  },
  {
    address: "JEDKPXY",
    stationCode: "JED",
    messageTypes: ["MVT", "LDM", "BSM"],
    enabled: true,
    tenantId: 1,
  },
  {
    address: "RUHOCXY",
    stationCode: null,
    messageTypes: ["MVT"],
    enabled: true,
    tenantId: null,
  },
  {
    address: "RUHKPZZ",
    stationCode: "RUH",
    messageTypes: ["PNL"],
    enabled: false,
    tenantId: null,
  },
  {
    address: "RUHKPT2",
    stationCode: "RUH",
    messageTypes: ["PNL"],
    enabled: true,
    tenantId: 2,
  },
];

describe("station file routing", () => {
  it("routes each message type to the stations a handler expects", () => {
    expect(stationsFor("PNL", "RUH", "JED")).toEqual(["RUH"]);
    expect(stationsFor("ADL", "RUH", "JED")).toEqual(["RUH"]);
    expect(stationsFor("LDM", "RUH", "JED")).toEqual(["JED"]);
    expect(stationsFor("MVT", "RUH", "JED")).toEqual(["RUH", "JED"]);
    expect(stationsFor("BSM", "RUH", "JED")).toEqual(["RUH", "JED"]);
  });

  it("selects enabled, tenant-visible, subscribed addresses for the stations", () => {
    expect(recipientsFor(rows, "PNL", ["RUH"], 1)).toEqual(["RUHKPXY"]);
    expect(recipientsFor(rows, "PNL", ["RUH"], 2)).toEqual([
      "RUHKPT2",
      "RUHKPXY",
    ]);
    expect(recipientsFor(rows, "MVT", ["RUH", "JED"], 1)).toEqual([
      "JEDKPXY",
      "RUHOCXY",
    ]);
    expect(recipientsFor(rows, "MVT", ["RUH", "JED"], 2)).toEqual(["RUHOCXY"]);
    expect(recipientsFor(rows, "BSM", ["RUH", "JED"], 1)).toEqual([
      "JEDKPXY",
      "RUHKPXY",
    ]);
    expect(recipientsFor(rows, "LDM", ["RUH"], 1)).toEqual([]);
  });

  it("normalises station-file input and rejects unknown types", () => {
    expect(
      normalizeAddressInput({
        address: "jedkpxy",
        stationCode: "jed",
        handlerName: " Saudi Ground Services ",
        messageTypes: ["pnl", "PNL", "mvt"],
      })
    ).toEqual({
      address: "JEDKPXY",
      stationCode: "JED",
      handlerName: "Saudi Ground Services",
      messageTypes: ["PNL", "MVT"],
      enabled: true,
      notes: null,
    });
    expect(() =>
      normalizeAddressInput({
        address: "JEDKPXY",
        handlerName: "x",
        messageTypes: ["PTM"],
      })
    ).toThrow(/Unknown message types/);
    expect(() =>
      normalizeAddressInput({
        address: "JEDKP",
        handlerName: "x",
        messageTypes: ["PNL"],
      })
    ).toThrow(/7 characters/);
  });
});

describe("outbound delivery core", () => {
  const message = (id: number) => ({
    id,
    messageType: "MVT",
    addresses: ["JEDKPXY"],
    body: `QU JEDKPXY\n.RUHKKXY 031205\nMVT\nXY${id}/03.HZASA.RUH\nNI1300`,
  });

  it("partitions sent and failed messages without aborting the batch", async () => {
    const transport = new InMemoryTransport();
    const ok = await processOutbound([message(1), message(2)], transport);
    expect(ok.sent.map(s => s.id)).toEqual([1, 2]);
    expect(ok.sent[0].transportReference).toMatch(/^memory:1:/);
    transport.failWith = new Error("link down");
    const bad = await processOutbound([message(3)], transport);
    expect(bad.sent).toEqual([]);
    expect(bad.failed).toEqual([{ id: 3, error: "link down" }]);
    expect(transport.sent).toHaveLength(2);
  });

  describe("file drop transport", () => {
    let dir: string;
    afterEach(() => rmSync(dir, { recursive: true, force: true }));

    it("writes CRLF files to outbound/ and consumes inbound/ files once", async () => {
      dir = mkdtempSync(join(tmpdir(), "typeb-"));
      const transport = new FileDropTransport(dir);
      const result = await processOutbound([message(7)], transport);
      expect(result.sent[0].transportReference).toMatch(
        /^filedrop:.*-MVT-7\.txt$/
      );
      const files = readdirSync(join(dir, "outbound"));
      expect(files).toHaveLength(1);
      expect(readFileSync(join(dir, "outbound", files[0]), "utf8")).toContain(
        "\r\nMVT\r\n"
      );
      writeFileSync(
        join(dir, "inbound", "a.txt"),
        "MVT\r\nXY123/03.HZASA.JED\r\nAA1358/1406\r\n"
      );
      const first = await transport.receive();
      expect(first).toHaveLength(1);
      expect(first[0].raw).toContain("AA1358/1406");
      expect(await transport.receive()).toEqual([]);
      expect(readdirSync(join(dir, "inbound", "processed"))).toEqual(["a.txt"]);
    });
  });

  it("refuses live mode and unknown transports, disabled by default", () => {
    expect(configuredTypeBTransport({})).toBeNull();
    expect(configuredTypeBTransport({ TYPEB_TRANSPORT: "memory" })?.id).toBe(
      "memory"
    );
    expect(() => configuredTypeBTransport({ TYPEB_TRANSPORT: "live" })).toThrow(
      /No live/
    );
    expect(() =>
      configuredTypeBTransport({ TYPEB_TRANSPORT: "filedrop" })
    ).toThrow(/TYPEB_FILEDROP_DIR/);
    expect(() => configuredTypeBTransport({ TYPEB_TRANSPORT: "sita" })).toThrow(
      /Invalid/
    );
  });
});

describe("inbound parsing", () => {
  const reference = new Date("2026-11-10T00:00:00Z");

  it("parses an enveloped MVT into a typed record with flight identity", () => {
    const parsed = parseInbound(
      "QU RUHKKXY RUHOCXY\r\n.JEDKPXY 031410\r\nMVT\r\nXY123/03.HZASA.JED\r\nAA1358/1406\r\nSI ON TIME\r\n",
      reference
    );
    expect(parsed.type).toBe("MVT");
    expect(parsed.header?.origin).toBe("JEDKPXY");
    expect(parsed.flightDesignator).toBe("XY123");
    expect(parsed.flightDate).toBe("2026-11-03");
    expect(parsed.station).toBe("JED");
    expect((parsed.parsed as { arrival: unknown }).arrival).toEqual({
      touchdown: "1358",
      onBlocks: "1406",
    });
  });

  it("parses header-less LDM and BSM text and rejects PNL as unparsed", () => {
    const ldm = parseInbound(
      "LDM\nXY123/03.HZASA.C14Y165.4/12\n-JED.102/5/2.T2850.1/1200.3/1650.PAX/8/94",
      reference
    );
    expect(ldm.type).toBe("LDM");
    expect(ldm.station).toBe("JED");
    const bsm = parseInbound(
      "BSM\n.V/1LRUH\n.F/XY0123/03NOV/JED/Y\n.N/0065123456001\n.P/SMITH/JOHN\nENDBSM",
      reference
    );
    expect(bsm.flightDesignator).toBe("XY123");
    expect(bsm.flightDate).toBe("2026-11-03");
    expect(bsm.station).toBe("RUH");
    expect(() =>
      parseInbound("PNL\nXY123/03NOV RUH PART1\nENDPNL", reference)
    ).toThrow(/not parsed/);
    expect(() =>
      parseInbound("MVT\nXY123/03.HZASA.JED\nAA2560", reference)
    ).toThrow(/HHMM/);
  });
});

describe("configuration and PNL timing", () => {
  it("reads a valid origin address and clamps the PNL lead to defaults", () => {
    expect(typeBConfig({})).toEqual({
      originAddress: null,
      pnlLeadMinutes: 180,
      transportMode: "disabled",
      ingestTokenConfigured: false,
    });
    expect(
      typeBConfig({
        TYPEB_ORIGIN_ADDRESS: "ruhkkxy",
        TYPEB_PNL_LEAD_MINUTES: "240",
        TYPEB_TRANSPORT: "memory",
        TYPEB_INGEST_TOKEN: "x".repeat(32),
      })
    ).toEqual({
      originAddress: "RUHKKXY",
      pnlLeadMinutes: 240,
      transportMode: "memory",
      ingestTokenConfigured: true,
    });
    expect(typeBConfig({ TYPEB_PNL_LEAD_MINUTES: "5" }).pnlLeadMinutes).toBe(
      180
    );
    expect(
      typeBConfig({ TYPEB_ORIGIN_ADDRESS: "RUH" }).originAddress
    ).toBeNull();
  });

  it("queues a PNL only inside the lead window for a live flight", () => {
    const now = new Date("2026-11-03T09:00:00Z");
    const at = (iso: string, status = "scheduled") => ({
      departureTime: new Date(iso),
      status,
    });
    expect(pnlDue(at("2026-11-03T13:00:00Z"), now, 180)).toBe(false);
    expect(pnlDue(at("2026-11-03T11:30:00Z"), now, 180)).toBe(true);
    expect(pnlDue(at("2026-11-03T09:10:00Z"), now, 180)).toBe(true);
    expect(pnlDue(at("2026-11-03T05:00:00Z"), now, 180)).toBe(false);
    expect(pnlDue(at("2026-11-03T11:30:00Z", "cancelled"), now, 180)).toBe(
      false
    );
    expect(pnlDue(at("2026-11-03T11:30:00Z", "completed"), now, 180)).toBe(
      false
    );
  });
});
