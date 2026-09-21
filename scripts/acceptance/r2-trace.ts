import assert from "node:assert/strict";
import { asc, eq } from "drizzle-orm";
import { eventInbox, lineageEvents, outbox } from "../../drizzle/schema";
import type { SettlementTx } from "../../server/services/booking-settlement.service";
import {
  processEvents,
  recordEvent,
} from "../../server/services/outbox.service";
import { consumeLocalEvent } from "../../server/services/event-inbox.service";
import { currentTrace, runWithTrace } from "../../server/_core/trace";
import { newTraceContext } from "../../shared/trace-context";
import { createExportJob } from "../../server/services/data-warehouse.service";
import {
  deterministicRunId,
  emitLineageEvent,
  exportRunId,
  readLineageRuns,
} from "../../server/services/lineage.service";
import {
  EXPORT_INPUT_TABLES,
  LINEAGE_PRODUCER,
  lineageRunEvent,
} from "../../shared/lineage";

/** R2-08 acceptance against real MySQL.
 *
 * The claim being tested is causal, not cosmetic: an event must carry the
 * trace of the request that produced it, a consumer must inherit that trace
 * rather than the relay tick's, and a path with no trace must store none
 * instead of a fabricated identifier.
 */
export async function verifyR2Trace(
  db: SettlementTx,
  seed: number,
  check: (name: string, run: () => Promise<void>) => Promise<void>
) {
  const station = `OT${String(seed % 100).padStart(2, "0")}`;
  const bulletin = (suffix: string) => ({
    aggregateType: "weather_station",
    aggregateId: `${station}${suffix}`,
    eventType: "weather.observed",
    tenantId: null,
    payload: {
      icaoCode: station,
      kind: "metar" as const,
      issuedAt: new Date().toISOString(),
      flightCategory: null,
      sourceMode: "sandbox" as const,
    },
  });

  const trace = newTraceContext();
  let eventId = "";

  await check(
    "R2 trace: an event carries the trace of the request that produced it",
    async () => {
      eventId = await runWithTrace(trace, () =>
        db.transaction(tx => recordEvent(tx, bulletin("A")))
      );
      const [row] = await db
        .select()
        .from(outbox)
        .where(eq(outbox.eventId, eventId));
      assert.equal(row.traceId, trace.traceId);
      assert.equal(row.spanId, trace.spanId);
    }
  );

  await check(
    "R2 trace: a consumed event keeps the origin trace on its inbox receipt",
    async () => {
      const [event] = await db
        .select()
        .from(outbox)
        .where(eq(outbox.eventId, eventId));
      await consumeLocalEvent(event);
      const [receipt] = await db
        .select()
        .from(eventInbox)
        .where(eq(eventInbox.eventId, eventId));
      assert.equal(receipt.traceId, trace.traceId);
      assert.equal(receipt.spanId, trace.spanId);
    }
  );

  await check(
    "R2 trace: delivery runs under the event's trace, not the relay tick's",
    async () => {
      const [event] = await db
        .select()
        .from(outbox)
        .where(eq(outbox.eventId, eventId));
      const observed: (string | null)[] = [];
      const tickTrace = newTraceContext();
      await runWithTrace(tickTrace, () =>
        processEvents([event], async () => {
          observed.push(currentTrace()?.traceId ?? null);
          observed.push(currentTrace()?.spanId ?? null);
        })
      );
      // The delivery joins the producing request's trace, so a consumer that
      // records a further event continues the same causal chain.
      assert.equal(observed[0], trace.traceId);
      // Under its own span, though: the delivery is not the original work.
      assert.notEqual(observed[1], trace.spanId);
      assert.notEqual(observed[0], tickTrace.traceId);
    }
  );

  await check(
    "R2 trace: an untraced event keeps the ambient trace instead of inventing one",
    async () => {
      const untracedId = await db.transaction(tx =>
        recordEvent(tx, bulletin("B"))
      );
      const [row] = await db
        .select()
        .from(outbox)
        .where(eq(outbox.eventId, untracedId));
      // No entry point ran, so there is nothing to correlate with and the
      // columns stay empty rather than holding a made-up identifier.
      assert.equal(row.traceId, null);
      assert.equal(row.spanId, null);

      const ambient = newTraceContext();
      const observed: (string | null)[] = [];
      await runWithTrace(ambient, () =>
        processEvents([row], async () => {
          observed.push(currentTrace()?.traceId ?? null);
        })
      );
      assert.equal(observed[0], ambient.traceId);
    }
  );
}

/** R2-08 lineage acceptance against real MySQL.
 *
 * Runs a real warehouse export and checks what was recorded about it: the
 * declared inputs, the output checksum, the trace linkage, and that a retry is
 * reported as the same run rather than a second one.
 */
export async function verifyR2Lineage(
  db: SettlementTx,
  seed: number,
  check: (name: string, run: () => Promise<void>) => Promise<void>
) {
  const trace = newTraceContext();
  const range = {
    startDate: new Date(Date.now() - 86400000),
    endDate: new Date(),
  };
  let runId = "";

  await check(
    "R2 lineage: a real export records its declared inputs and its output checksum",
    async () => {
      const job = await runWithTrace(trace, () =>
        createExportJob("customers", range, "json", seed)
      );
      // The export records its own failure reason; surface it here, because a
      // bare status mismatch is unreadable when this runs on a server version
      // nobody has a local copy of.
      assert.equal(
        job.status,
        "completed",
        `customers export did not complete: ${job.errorMessage ?? "no error recorded"}`
      );
      runId = exportRunId(job.id);

      const rows = await db
        .select()
        .from(lineageEvents)
        .where(eq(lineageEvents.runId, runId))
        .orderBy(asc(lineageEvents.id));
      assert.deepEqual(
        rows.map(row => row.eventType),
        ["START", "COMPLETE"]
      );
      // The data job run is attributable to the request that caused it.
      assert.equal(rows[0].traceId, trace.traceId);

      const start = lineageRunEvent.parse(rows[0].document);
      assert.deepEqual(
        start.inputs?.map(input => input.name),
        ["users"]
      );
      assert.equal(start.producer, LINEAGE_PRODUCER);

      const complete = lineageRunEvent.parse(rows[1].document);
      const output = complete.outputs?.[0];
      assert.equal(output?.name, `warehouse_exports/${job.id}`);
      // The recorded checksum must be the one over the bytes actually stored,
      // or the lineage record could not be used to verify the export.
      assert.equal(
        (output?.facets?.checksum as { value?: string } | undefined)?.value,
        job.checksum
      );
      assert.equal(
        (output?.facets?.outputStatistics as { size?: number } | undefined)
          ?.size,
        job.fileSize
      );
    }
  );

  await check(
    "R2 lineage: a repeated export is the same run, and runs group correctly",
    async () => {
      const before = await db
        .select()
        .from(lineageEvents)
        .where(eq(lineageEvents.runId, runId));
      await createExportJob("customers", range, "json", seed);
      const after = await db
        .select()
        .from(lineageEvents)
        .where(eq(lineageEvents.runId, runId));
      // The identity index holds: a retry is the same logical run, so it adds
      // no second START and no duplicate COMPLETE.
      assert.equal(after.length, before.length);

      const runs = await readLineageRuns(50);
      const run = runs.find(entry => entry.runId === runId);
      assert(run);
      assert.equal(run.outcome, "complete");
      assert.equal(run.jobName, "warehouse-export.customers");
      assert.deepEqual(run.inputs, ["users"]);
      assert.equal(run.traceId, trace.traceId);
    }
  );

  await check(
    "R2 lineage: an unfinished run is reported as running, never as complete",
    async () => {
      const orphan = deterministicRunId(`r2-lineage-orphan:${seed}`);
      const recorded = await emitLineageEvent({
        eventType: "START",
        runId: orphan,
        jobName: "warehouse-export.bookings",
        inputs: EXPORT_INPUT_TABLES.bookings,
      });
      assert.equal(recorded, true);
      const run = (await readLineageRuns(50)).find(
        entry => entry.runId === orphan
      );
      assert(run);
      assert.equal(run.outcome, "running");
      assert.equal(run.finishedAt, null);
      assert.deepEqual(run.inputs, ["bookings", "flights", "airlines"]);
    }
  );
}
