import { describe, expect, it } from "vitest";
import {
  EXPORT_INPUT_TABLES,
  LINEAGE_NAMESPACE,
  LINEAGE_PRODUCER,
  LINEAGE_SCHEMA_URL,
  buildRunEvent,
  lineageRunEvent,
  tableDataset,
} from "../../shared/lineage";
import { deterministicRunId, exportRunId } from "../services/lineage.service";

describe("run identity", () => {
  it("is stable, so a retried export is the same run", () => {
    // A random id per attempt would turn one retried export into several
    // unrelated runs in the lineage graph.
    expect(exportRunId(41)).toBe(exportRunId(41));
    expect(exportRunId(41)).not.toBe(exportRunId(42));
  });

  it("is a valid UUID, which the specification requires", () => {
    for (const seed of ["a", "warehouse-export:1", "x".repeat(200)]) {
      const id = deterministicRunId(seed);
      expect(id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
      );
      // The schema is what the emitter validates against, so it has to accept
      // these ids or nothing would ever be recorded.
      expect(
        lineageRunEvent.safeParse({
          eventType: "START",
          eventTime: new Date().toISOString(),
          run: { runId: id },
          job: { namespace: LINEAGE_NAMESPACE, name: "probe" },
          producer: LINEAGE_PRODUCER,
          schemaURL: LINEAGE_SCHEMA_URL,
        }).success
      ).toBe(true);
    }
  });
});

describe("run events", () => {
  it("builds a specification-shaped START with its real inputs", () => {
    const event = buildRunEvent({
      eventType: "START",
      runId: exportRunId(7),
      jobName: "warehouse-export.bookings",
      inputs: EXPORT_INPUT_TABLES.bookings,
    });
    expect(event.eventType).toBe("START");
    expect(event.producer).toBe(LINEAGE_PRODUCER);
    expect(event.schemaURL).toContain("OpenLineage.json");
    expect(event.job).toEqual({
      namespace: LINEAGE_NAMESPACE,
      name: "warehouse-export.bookings",
    });
    expect(event.inputs).toEqual([
      tableDataset("bookings"),
      tableDataset("flights"),
      tableDataset("airlines"),
    ]);
    // A START asserts nothing about outputs, because none exist yet.
    expect(event.outputs).toBeUndefined();
  });

  it("carries output statistics and a checksum on COMPLETE", () => {
    const event = buildRunEvent({
      eventType: "COMPLETE",
      runId: exportRunId(7),
      jobName: "warehouse-export.bookings",
      outputs: [
        {
          namespace: LINEAGE_NAMESPACE,
          name: "warehouse_exports/7",
          facets: {
            outputStatistics: {
              _producer: LINEAGE_PRODUCER,
              _schemaURL: LINEAGE_SCHEMA_URL,
              rowCount: 12,
              size: 340,
            },
          },
        },
      ],
    });
    expect(event.outputs?.[0].facets?.outputStatistics).toMatchObject({
      rowCount: 12,
      size: 340,
    });
  });

  it("refuses a malformed event rather than storing it", () => {
    expect(() =>
      buildRunEvent({
        eventType: "START",
        runId: "not-a-uuid",
        jobName: "warehouse-export.bookings",
      })
    ).toThrow();
    expect(() =>
      buildRunEvent({
        eventType: "START",
        runId: exportRunId(1),
        jobName: "",
      })
    ).toThrow();
  });
});

describe("declared inputs", () => {
  it("covers every export type the warehouse service supports", () => {
    expect(Object.keys(EXPORT_INPUT_TABLES).sort()).toEqual([
      "bookings",
      "customers",
      "flights",
      "operational",
      "revenue",
    ]);
  });

  it("names the revenue source tables, which are not the obvious ones", () => {
    // The revenue export reads through getFinancialDays, so its inputs are
    // the ledger and bookings — not a revenue table, which does not exist.
    expect(EXPORT_INPUT_TABLES.revenue).toEqual([
      "bookings",
      "financial_ledger",
    ]);
  });

  it("declares no input it does not read", () => {
    // Every declared table must be a real one. A lineage graph that names a
    // table nobody queries would be believed and would be wrong.
    const every = new Set(Object.values(EXPORT_INPUT_TABLES).flat());
    expect([...every].sort()).toEqual([
      "airlines",
      "bookings",
      "financial_ledger",
      "flights",
      "users",
    ]);
  });
});
