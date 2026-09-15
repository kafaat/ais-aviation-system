import { describe, expect, it } from "vitest";
import { transactionMemory } from "./helpers/transaction-memory";
import {
  CONCERN_THRESHOLDS,
  categoryFromReport,
  ceilingOf,
  concernsFromReport,
  deriveFlightCategory,
  icaoCode,
  weatherReport,
} from "../../shared/aviation-weather";
import {
  createAviationWeatherSource,
  decodeMetar,
  decodeTaf,
} from "../integrations/aviation-weather";
import {
  ingestReports,
  latestObservations,
  recordStationMapping,
  weatherAlertsFrom,
  flightWeatherAdvisory,
} from "../services/aviation-weather.service";

/** A shape matching the Aviation Weather Center JSON rows the adapter reads. */
const metarRow = (overrides: Record<string, unknown> = {}) => ({
  icaoId: "OEJN",
  rawOb: "OEJN 141200Z 34008KT 9999 FEW030 33/18 Q1006",
  reportTime: "2026-09-14 12:00:00",
  temp: 33,
  dewp: 18,
  wdir: 340,
  wspd: 8,
  wgst: null,
  visib: "10+",
  altim: 1006,
  clouds: [{ cover: "FEW", base: 3000 }],
  ...overrides,
});

const source = { mode: "sandbox" as const, reference: "sandbox:test" };

function seeded() {
  return transactionMemory({
    airports: [
      { id: 1, code: "JED", name: "Jeddah", city: "Jeddah", country: "SA" },
      { id: 2, code: "RUH", name: "Riyadh", city: "Riyadh", country: "SA" },
    ],
    flights: [{ id: 10, originId: 1, destinationId: 2 }],
    airport_weather_stations: [],
    weather_observations: [],
    outbox: [],
  });
}

describe("ICAO station identity", () => {
  it("accepts a station identifier and normalises its case", () => {
    expect(icaoCode.parse(" oejn ")).toBe("OEJN");
  });

  it("refuses anything that is not a four-character ICAO identifier", () => {
    for (const invalid of ["JED", "OEJNX", "0EJN", ""])
      expect(icaoCode.safeParse(invalid).success).toBe(false);
  });
});

describe("METAR decoding", () => {
  it("decodes a station bulletin into normalised measurements", () => {
    const report = decodeMetar(metarRow());
    expect(report).toMatchObject({
      icaoCode: "OEJN",
      kind: "metar",
      windDirection: 340,
      windSpeed: 8,
      windGust: null,
      visibilityStatuteMiles: 10,
      temperatureC: 33,
      dewpointC: 18,
      altimeterHpa: 1006,
    });
    expect(report.issuedAt).toBe("2026-09-14T12:00:00.000Z");
    expect(report.clouds).toEqual([{ cover: "FEW", baseFeetAgl: 3000 }]);
  });

  it("reads a variable wind as having no single direction", () => {
    // VRB is a real METAR value; treating it as a bearing would invent one.
    const report = decodeMetar(metarRow({ wdir: "VRB" }));
    expect(report.windDirection).toBeNull();
    expect(report.windSpeed).toBe(8);
  });

  it("decodes a fractional low visibility", () => {
    expect(
      decodeMetar(metarRow({ visib: "1 1/2" })).visibilityStatuteMiles
    ).toBe(1.5);
    expect(decodeMetar(metarRow({ visib: "1/2" })).visibilityStatuteMiles).toBe(
      0.5
    );
  });

  it("reads an absent measurement as absent, not as zero", () => {
    const report = decodeMetar(
      metarRow({ visib: null, wspd: null, temp: null })
    );
    expect(report.visibilityStatuteMiles).toBeNull();
    expect(report.windSpeed).toBeNull();
    expect(report.temperatureC).toBeNull();
  });

  it("refuses a present but undecodable field instead of nulling it", () => {
    // Silently nulling would turn provider schema drift into missing weather.
    expect(() => decodeMetar(metarRow({ visib: "about 3 miles" }))).toThrow(
      /undecodable visibility/
    );
    expect(() => decodeMetar(metarRow({ wdir: "northerly" }))).toThrow(
      /undecodable wind direction/
    );
    expect(() =>
      decodeMetar(metarRow({ clouds: [{ cover: "MOSTLY", base: 1000 }] }))
    ).toThrow(/undecodable sky cover/);
  });

  it("refuses a bulletin dated outside any plausible window", () => {
    expect(() =>
      decodeMetar(metarRow({ reportTime: "1970-01-01 00:00:00" }))
    ).toThrow(/undecodable observation time/);
  });

  it("accepts a unix observation time when no report time is given", () => {
    const obsTime = Math.floor(Date.now() / 1000);
    const report = decodeMetar(metarRow({ reportTime: undefined, obsTime }));
    expect(report.issuedAt).toBe(new Date(obsTime * 1000).toISOString());
  });
});

describe("TAF decoding", () => {
  it("keeps a forecast as a bulletin with no observed measurements", () => {
    const report = decodeTaf({
      icaoId: "OERK",
      rawTAF: "TAF OERK 141100Z 1412/1518 34010KT 9999 SCT030",
      issueTime: "2026-09-14 11:00:00",
    });
    expect(report.kind).toBe("taf");
    expect(report.rawText).toContain("TAF OERK");
    expect(report.visibilityStatuteMiles).toBeNull();
    expect(report.clouds).toEqual([]);
    // A forecast is not an observation, so it never carries a category.
    expect(categoryFromReport(report)).toBeNull();
  });
});

describe("ceiling and flight category", () => {
  it("reports no ceiling when only few and scattered layers are present", () => {
    expect(
      ceilingOf([
        { cover: "FEW", baseFeetAgl: 800 },
        { cover: "SCT", baseFeetAgl: 1200 },
      ])
    ).toEqual({ kind: "none" });
  });

  it("takes the lowest broken or overcast layer as the ceiling", () => {
    expect(
      ceilingOf([
        { cover: "SCT", baseFeetAgl: 200 },
        { cover: "OVC", baseFeetAgl: 1500 },
        { cover: "BKN", baseFeetAgl: 900 },
      ])
    ).toEqual({ kind: "at", feet: 900 });
  });

  it("marks a ceiling layer with no reported base as unmeasured", () => {
    expect(ceilingOf([{ cover: "OVX", baseFeetAgl: null }])).toEqual({
      kind: "indeterminate",
    });
  });

  it("applies the more restrictive of ceiling and visibility", () => {
    // Good visibility, low ceiling -> the ceiling decides.
    expect(
      deriveFlightCategory({
        visibilityStatuteMiles: 10,
        ceiling: { kind: "at", feet: 700 },
      })
    ).toBe("IFR");
    // Good ceiling, poor visibility -> the visibility decides.
    expect(
      deriveFlightCategory({
        visibilityStatuteMiles: 0.5,
        ceiling: { kind: "at", feet: 5000 },
      })
    ).toBe("LIFR");
    expect(
      deriveFlightCategory({
        visibilityStatuteMiles: 4,
        ceiling: { kind: "none" },
      })
    ).toBe("MVFR");
    expect(
      deriveFlightCategory({
        visibilityStatuteMiles: 10,
        ceiling: { kind: "none" },
      })
    ).toBe("VFR");
  });

  it("declines to classify rather than assuming the unrestricted category", () => {
    // An unmeasured ceiling or a missing visibility is not clear weather.
    expect(
      deriveFlightCategory({
        visibilityStatuteMiles: 10,
        ceiling: { kind: "indeterminate" },
      })
    ).toBeNull();
    expect(
      deriveFlightCategory({
        visibilityStatuteMiles: null,
        ceiling: { kind: "none" },
      })
    ).toBeNull();
  });
});

describe("advisory concerns", () => {
  const report = (overrides: Record<string, unknown>) =>
    weatherReport.parse({
      icaoCode: "OEJN",
      kind: "metar",
      issuedAt: new Date().toISOString(),
      rawText: "OEJN 141200Z",
      windDirection: 340,
      windSpeed: 8,
      windGust: null,
      visibilityStatuteMiles: 10,
      clouds: [],
      temperatureC: 30,
      dewpointC: 10,
      altimeterHpa: 1006,
      ...overrides,
    });

  it("raises no concern for a calm, clear field", () => {
    expect(concernsFromReport(report({}))).toEqual([]);
  });

  it("names each threshold it crosses", () => {
    expect(
      concernsFromReport(
        report({
          visibilityStatuteMiles: 1,
          clouds: [{ cover: "OVC", baseFeetAgl: 400 }],
        })
      )
    ).toEqual(["low_visibility", "low_ceiling"]);
    expect(concernsFromReport(report({ windSpeed: 32, windGust: 48 }))).toEqual(
      ["strong_wind", "gusting"]
    );
    expect(concernsFromReport(report({ temperatureC: 0 }))).toEqual([
      "freezing",
    ]);
  });

  it("does not call a steady strong wind gusting", () => {
    // A gust needs both an absolute value and a spread over the steady wind.
    const spread = CONCERN_THRESHOLDS.gustSpreadKnots - 1;
    expect(
      concernsFromReport(report({ windSpeed: 26, windGust: 26 + spread }))
    ).toEqual([]);
  });
});

describe("source responses", () => {
  it("refuses a response describing a station nobody asked for", async () => {
    const rows = [metarRow({ icaoId: "OERK" })];
    const weather = createAviationWeatherSource({
      mode: "sandbox",
      reference: "sandbox:test",
      baseUrl: "https://weather.invalid/api/data",
    });
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(rows), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as typeof fetch;
    try {
      await expect(weather.fetch("metar", ["OEJN"])).rejects.toThrow(
        /unrequested station/
      );
    } finally {
      globalThis.fetch = original;
    }
  });

  it("refuses a body that is not JSON", async () => {
    const weather = createAviationWeatherSource({
      mode: "sandbox",
      reference: "sandbox:test",
      baseUrl: "https://weather.invalid/api/data",
    });
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response("<html>outage</html>", { status: 200 })) as typeof fetch;
    try {
      await expect(weather.fetch("metar", ["OEJN"])).rejects.toThrow(
        /not JSON/
      );
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe("station mapping", () => {
  it("records a station against an airport with its evidence", async () => {
    const fixture = seeded();
    await fixture.db.transaction(async (tx: any) => {
      const mapped = await recordStationMapping(tx, {
        airportId: 1,
        icaoCode: "oejn",
        mappingEvidence: "ICAO Doc 7910 location indicators, 2026 edition",
        recordedBy: 5,
      });
      expect(mapped).toEqual({ airportId: 1, icaoCode: "OEJN" });
    });
    expect(fixture.rows("airport_weather_stations")).toHaveLength(1);
  });

  it("refuses a station that already belongs to a different airport", async () => {
    const fixture = seeded();
    await fixture.db.transaction((tx: any) =>
      recordStationMapping(tx, {
        airportId: 1,
        icaoCode: "OEJN",
        mappingEvidence: "ICAO Doc 7910 location indicators",
        recordedBy: 5,
      })
    );
    await expect(
      fixture.db.transaction((tx: any) =>
        recordStationMapping(tx, {
          airportId: 2,
          icaoCode: "OEJN",
          mappingEvidence: "ICAO Doc 7910 location indicators",
          recordedBy: 5,
        })
      )
    ).rejects.toThrow(/already mapped to another airport/);
  });

  it("refuses a mapping with no recorded evidence", async () => {
    const fixture = seeded();
    await expect(
      fixture.db.transaction((tx: any) =>
        recordStationMapping(tx, {
          airportId: 1,
          icaoCode: "OEJN",
          mappingEvidence: "n/a",
          recordedBy: 5,
        })
      )
    ).rejects.toThrow(/recorded evidence/);
  });

  it("refuses a mapping for an airport that does not exist", async () => {
    const fixture = seeded();
    await expect(
      fixture.db.transaction((tx: any) =>
        recordStationMapping(tx, {
          airportId: 999,
          icaoCode: "OEJN",
          mappingEvidence: "ICAO Doc 7910 location indicators",
          recordedBy: 5,
        })
      )
    ).rejects.toThrow(/Airport not found/);
  });
});

describe("bulletin ingestion", () => {
  it("stores a bulletin once and emits one public event for it", async () => {
    const fixture = seeded();
    const report = decodeMetar(metarRow());
    const first = await fixture.db.transaction((tx: any) =>
      ingestReports(tx, source, [report])
    );
    expect(first).toEqual({ stored: 1, duplicates: 0 });

    const again = await fixture.db.transaction((tx: any) =>
      ingestReports(tx, source, [report])
    );
    expect(again).toEqual({ stored: 0, duplicates: 1 });

    expect(fixture.rows("weather_observations")).toHaveLength(1);
    const events = fixture.rows("outbox");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      eventType: "weather.observed",
      aggregateType: "weather_station",
      aggregateId: "OEJN",
      tenantId: null,
    });
  });

  it("treats an identical bulletin at a different time as a new observation", async () => {
    // A METAR body carries only a day and a time, so the same text can recur.
    const fixture = seeded();
    const report = decodeMetar(metarRow());
    const later = { ...report, issuedAt: "2026-10-14T12:00:00.000Z" };
    await fixture.db.transaction((tx: any) =>
      ingestReports(tx, source, [report, later])
    );
    expect(fixture.rows("weather_observations")).toHaveLength(2);
  });

  it("stores the bulletin text and its source beside the classification", async () => {
    const fixture = seeded();
    await fixture.db.transaction((tx: any) =>
      ingestReports(tx, source, [decodeMetar(metarRow())])
    );
    const [row] = fixture.rows("weather_observations");
    expect(row).toMatchObject({
      rawText: "OEJN 141200Z 34008KT 9999 FEW030 33/18 Q1006",
      sourceMode: "sandbox",
      sourceReference: "sandbox:test",
      flightCategory: "VFR",
      ceilingIndeterminate: false,
      ceilingFeet: null,
    });
    expect(row.bodyDigest).toMatch(/^[0-9a-f]{64}$/);
  });

  it("records an unmeasured ceiling as unmeasured and leaves it unclassified", async () => {
    const fixture = seeded();
    await fixture.db.transaction((tx: any) =>
      ingestReports(tx, source, [
        decodeMetar(metarRow({ clouds: [{ cover: "OVX", base: null }] })),
      ])
    );
    const [row] = fixture.rows("weather_observations");
    expect(row.ceilingIndeterminate).toBe(true);
    expect(row.flightCategory).toBeNull();
  });

  it("never gives a forecast an observed category", async () => {
    const fixture = seeded();
    await fixture.db.transaction((tx: any) =>
      ingestReports(tx, source, [
        decodeTaf({
          icaoId: "OEJN",
          rawTAF: "TAF OEJN 141100Z 1412/1518 34010KT 9999 SCT030",
          issueTime: "2026-09-14 11:00:00",
        }),
      ])
    );
    expect(fixture.rows("weather_observations")[0].flightCategory).toBeNull();
  });

  it("returns the newest bulletin per station", async () => {
    const fixture = seeded();
    await fixture.db.transaction((tx: any) =>
      ingestReports(tx, source, [
        decodeMetar(metarRow({ reportTime: "2026-09-14 11:00:00" })),
        decodeMetar(
          metarRow({
            reportTime: "2026-09-14 12:00:00",
            rawOb: "OEJN 141200Z 34012KT 9999 FEW030 33/18 Q1006",
            wspd: 12,
          })
        ),
      ])
    );
    const latest = await latestObservations(fixture.db, ["OEJN"], "metar");
    expect(latest.get("OEJN")?.windSpeed).toBe(12);
  });
});

describe("flight advisory", () => {
  const at = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000);

  async function advisoryFor(
    fixture: ReturnType<typeof transactionMemory>,
    now = new Date()
  ) {
    return await flightWeatherAdvisory(fixture.db, 10, now);
  }

  it("reports an unmapped field as uncovered rather than as calm", async () => {
    const fixture = seeded();
    const advisory = await advisoryFor(fixture);
    expect(advisory.fields.map(field => field.coverage)).toEqual([
      "station_unmapped",
      "station_unmapped",
    ]);
    expect(advisory.complete).toBe(false);
    // An uncovered field must not produce a weather alert: there is nothing
    // observed to alert about.
    expect(weatherAlertsFrom(advisory)).toEqual([]);
  });

  it("distinguishes a mapped station with no stored bulletin", async () => {
    const fixture = seeded();
    await fixture.db.transaction((tx: any) =>
      recordStationMapping(tx, {
        airportId: 1,
        icaoCode: "OEJN",
        mappingEvidence: "ICAO Doc 7910 location indicators",
        recordedBy: 5,
      })
    );
    const advisory = await advisoryFor(fixture);
    expect(advisory.fields[0].coverage).toBe("no_observation");
    expect(advisory.fields[1].coverage).toBe("station_unmapped");
  });

  it("classifies a current bulletin and keeps the text for audit", async () => {
    const fixture = seeded();
    await fixture.db.transaction(async (tx: any) => {
      await recordStationMapping(tx, {
        airportId: 1,
        icaoCode: "OEJN",
        mappingEvidence: "ICAO Doc 7910 location indicators",
        recordedBy: 5,
      });
      await ingestReports(tx, source, [
        decodeMetar(
          metarRow({
            reportTime: at(10).toISOString(),
            visib: 0.5,
            clouds: [{ cover: "OVC", base: 300 }],
          })
        ),
      ]);
    });
    const advisory = await advisoryFor(fixture);
    const [origin] = advisory.fields;
    expect(origin).toMatchObject({
      coverage: "classified",
      icaoCode: "OEJN",
      flightCategory: "LIFR",
    });
    expect(origin.concerns).toEqual(["low_visibility", "low_ceiling"]);
    expect(origin.rawText).toContain("OEJN");
    expect(origin.ageMinutes).toBeGreaterThanOrEqual(9);

    const alerts = weatherAlertsFrom(advisory);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ type: "weather", severity: "high" });
    expect(alerts[0].suggestedAction).toMatch(/Advisory only/);
  });

  it("stops classifying once a bulletin outlives its issue cycle", async () => {
    const fixture = seeded();
    await fixture.db.transaction(async (tx: any) => {
      await recordStationMapping(tx, {
        airportId: 1,
        icaoCode: "OEJN",
        mappingEvidence: "ICAO Doc 7910 location indicators",
        recordedBy: 5,
      });
      await ingestReports(tx, source, [
        decodeMetar(
          metarRow({
            reportTime: at(200).toISOString(),
            visib: 0.5,
            clouds: [{ cover: "OVC", base: 300 }],
          })
        ),
      ]);
    });
    const advisory = await advisoryFor(fixture);
    const [origin] = advisory.fields;
    expect(origin.coverage).toBe("stale_observation");
    // The text stays visible, but an expired bulletin asserts nothing.
    expect(origin.rawText).toContain("OEJN");
    expect(origin.flightCategory).toBeNull();
    expect(origin.concerns).toEqual([]);
    expect(weatherAlertsFrom(advisory)).toEqual([]);
  });

  it("raises no alert for an unrestricted field", async () => {
    const fixture = seeded();
    await fixture.db.transaction(async (tx: any) => {
      await recordStationMapping(tx, {
        airportId: 1,
        icaoCode: "OEJN",
        mappingEvidence: "ICAO Doc 7910 location indicators",
        recordedBy: 5,
      });
      await ingestReports(tx, source, [
        decodeMetar(metarRow({ reportTime: at(5).toISOString() })),
      ]);
    });
    const advisory = await advisoryFor(fixture);
    expect(advisory.fields[0].flightCategory).toBe("VFR");
    expect(weatherAlertsFrom(advisory)).toEqual([]);
  });
});
