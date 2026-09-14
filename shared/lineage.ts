/** Data lineage (R2-08).
 *
 * Emits OpenLineage run events, using the specification's field names and
 * event shape so the documents are consumable by an OpenLineage backend
 * (Marquez and others) without translation:
 *   https://openlineage.io/docs/spec/object-model
 *
 * Dependency-free by choice. The value is the recorded fact — which job read
 * which datasets and produced which output, in which run — and that is a
 * document shape, not a library. No client is installed and nothing is
 * transmitted anywhere; the events are persisted locally and can be shipped by
 * a later transport that reads the same rows.
 *
 * The input datasets are read off the export queries themselves rather than
 * described from memory. A lineage graph that lists the wrong inputs is worse
 * than no graph, because it will be trusted.
 */
import { z } from "zod";

export const LINEAGE_PRODUCER = "https://github.com/kafaat/ais-aviation-system";
export const LINEAGE_SCHEMA_URL =
  "https://openlineage.io/spec/2-0-2/OpenLineage.json#/$defs/RunEvent";

/** The specification's namespace for datasets in one logical store. */
export const LINEAGE_NAMESPACE = "ais-aviation";

export const lineageEventType = z.enum([
  "START",
  "RUNNING",
  "COMPLETE",
  "ABORT",
  "FAIL",
  "OTHER",
]);
export type LineageEventType = z.infer<typeof lineageEventType>;

const dataset = z.object({
  namespace: z.string().min(1).max(255),
  name: z.string().min(1).max(255),
  facets: z.record(z.string(), z.json()).optional(),
});
export type LineageDataset = z.infer<typeof dataset>;

export const lineageRunEvent = z.object({
  eventType: lineageEventType,
  eventTime: z.string().datetime({ offset: true }),
  run: z.object({
    runId: z.string().uuid(),
    facets: z.record(z.string(), z.json()).optional(),
  }),
  job: z.object({
    namespace: z.string().min(1).max(255),
    name: z.string().min(1).max(255),
    facets: z.record(z.string(), z.json()).optional(),
  }),
  inputs: z.array(dataset).max(50).optional(),
  outputs: z.array(dataset).max(50).optional(),
  producer: z.string().min(1),
  schemaURL: z.string().min(1),
});
export type LineageRunEvent = z.infer<typeof lineageRunEvent>;

export function tableDataset(table: string): LineageDataset {
  return { namespace: LINEAGE_NAMESPACE, name: table };
}

/** Which tables each warehouse export actually reads.
 *
 * Taken from the queries in `data-warehouse.service.ts` and, for revenue, from
 * `getFinancialDays` in `financial-reporting.service.ts`, which is where that
 * export's data comes from. Kept here so a lineage claim and the query it
 * describes can be compared side by side in review.
 */
export const EXPORT_INPUT_TABLES: Record<string, readonly string[]> = {
  bookings: ["bookings", "flights", "airlines"],
  flights: ["flights", "airlines"],
  revenue: ["bookings", "financial_ledger"],
  customers: ["users"],
  operational: ["flights", "airlines"],
};

export function buildRunEvent(input: {
  eventType: LineageEventType;
  runId: string;
  jobName: string;
  eventTime?: Date;
  inputs?: readonly string[];
  outputs?: LineageDataset[];
  runFacets?: Record<string, unknown>;
  jobFacets?: Record<string, unknown>;
}): LineageRunEvent {
  return lineageRunEvent.parse({
    eventType: input.eventType,
    eventTime: (input.eventTime ?? new Date()).toISOString(),
    run: {
      runId: input.runId,
      ...(input.runFacets ? { facets: input.runFacets } : {}),
    },
    job: {
      namespace: LINEAGE_NAMESPACE,
      name: input.jobName,
      ...(input.jobFacets ? { facets: input.jobFacets } : {}),
    },
    ...(input.inputs ? { inputs: input.inputs.map(tableDataset) } : {}),
    ...(input.outputs ? { outputs: input.outputs } : {}),
    producer: LINEAGE_PRODUCER,
    schemaURL: LINEAGE_SCHEMA_URL,
  });
}
