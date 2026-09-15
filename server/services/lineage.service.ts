/** Data lineage recording (R2-08).
 *
 * Persists OpenLineage run events for the data jobs. Two honest limits stated
 * up front, because a lineage graph is trusted once it exists:
 *
 *  - **Nothing is transmitted.** No OpenLineage backend is configured, and
 *    none is claimed. The events are stored in the spec's own shape so a later
 *    transport can ship exactly what was recorded.
 *  - **Inputs are read off the queries, not described.** `EXPORT_INPUT_TABLES`
 *    lists the tables each export actually reads. An inaccurate input list is
 *    worse than none, since it would be believed.
 *
 * Emission never fails its caller: a data job that produced a correct export
 * must not be reported as failed because its lineage row could not be written.
 * A lost lineage event is a gap in observability; a lost export is a gap in
 * the data.
 */
import { createHash } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { lineageEvents } from "../../drizzle/schema";
import {
  buildRunEvent,
  type LineageDataset,
  type LineageEventType,
} from "../../shared/lineage";
import { getDb } from "../db";
import { currentTrace } from "../_core/trace";
import { createServiceLogger } from "../_core/logger";

const log = createServiceLogger("lineage");

export interface EmitLineageInput {
  eventType: LineageEventType;
  runId: string;
  jobName: string;
  inputs?: readonly string[];
  outputs?: LineageDataset[];
  runFacets?: Record<string, unknown>;
  jobFacets?: Record<string, unknown>;
}

/** Records one run event. Idempotent per (run, event type), so a retried
 * emission does not produce a second START for the same run. */
export async function emitLineageEvent(
  input: EmitLineageInput
): Promise<boolean> {
  try {
    const db = getDb();
    if (!db) return false;
    const event = buildRunEvent(input);
    await db
      .insert(lineageEvents)
      .values({
        runId: event.run.runId,
        jobNamespace: event.job.namespace,
        jobName: event.job.name,
        eventType: event.eventType,
        eventTime: new Date(event.eventTime),
        traceId: currentTrace()?.traceId ?? null,
        document: event,
      })
      .onDuplicateKeyUpdate({
        set: { runId: sql`${lineageEvents.runId}` },
      });
    return true;
  } catch (error) {
    // Deliberately swallowed, and logged so the gap is visible rather than
    // silent. See the module comment for why this must not fail the job.
    log.warn(
      { err: error, job: input.jobName, eventType: input.eventType },
      "Lineage event was not recorded"
    );
    return false;
  }
}

export interface LineageRunView {
  runId: string;
  jobName: string;
  startedAt: string | null;
  finishedAt: string | null;
  outcome: "running" | "complete" | "failed";
  traceId: string | null;
  inputs: string[];
  outputs: string[];
}

/** Groups stored events into runs for the operations view. A run with a START
 * and no terminal event is reported as `running`, not as succeeded. */
export async function readLineageRuns(limit = 50): Promise<LineageRunView[]> {
  const db = getDb();
  if (!db) throw new Error("Lineage database unavailable");
  const rows = await db
    .select()
    .from(lineageEvents)
    .orderBy(desc(lineageEvents.eventTime), desc(lineageEvents.id))
    .limit(Math.min(Math.max(limit, 1), 200) * 3);

  const runs = new Map<string, LineageRunView>();
  for (const row of rows) {
    const existing = runs.get(row.runId) ?? {
      runId: row.runId,
      jobName: row.jobName,
      startedAt: null,
      finishedAt: null,
      outcome: "running" as const,
      traceId: row.traceId,
      inputs: [],
      outputs: [],
    };
    const document = row.document as {
      inputs?: { name: string }[];
      outputs?: { name: string }[];
    };
    if (row.eventType === "START") {
      existing.startedAt = row.eventTime.toISOString();
      existing.inputs = (document.inputs ?? []).map(entry => entry.name);
    }
    if (row.eventType === "COMPLETE" || row.eventType === "FAIL") {
      existing.finishedAt = row.eventTime.toISOString();
      existing.outcome = row.eventType === "COMPLETE" ? "complete" : "failed";
      if (document.outputs?.length)
        existing.outputs = document.outputs.map(entry => entry.name);
    }
    runs.set(row.runId, existing);
  }
  return [...runs.values()].slice(0, Math.min(Math.max(limit, 1), 200));
}

export async function readLineageRun(
  runId: string
): Promise<LineageRunView | null> {
  const db = getDb();
  if (!db) throw new Error("Lineage database unavailable");
  const rows = await db
    .select({ id: lineageEvents.id })
    .from(lineageEvents)
    .where(and(eq(lineageEvents.runId, runId)))
    .limit(1);
  if (!rows.length) return null;
  const runs = await readLineageRuns(200);
  return runs.find(run => run.runId === runId) ?? null;
}

/** A stable run identifier for a repeatable unit of work.
 *
 * Derived rather than random so a retried export reports the *same* run
 * instead of appearing as a second, unrelated one — the retry is the same
 * logical run of the same job. Formatted as a UUID because the specification
 * requires one: RFC 9562 version 8 (custom) with the correct variant bits.
 */
export function deterministicRunId(seed: string): string {
  const hash = createHash("sha256").update(`ais-lineage:${seed}`).digest("hex");
  const variant = ((Number.parseInt(hash.slice(16, 18), 16) & 0x3f) | 0x80)
    .toString(16)
    .padStart(2, "0");
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    `8${hash.slice(13, 16)}`,
    `${variant}${hash.slice(18, 20)}`,
    hash.slice(20, 32),
  ].join("-");
}

export function exportRunId(exportId: number): string {
  return deterministicRunId(`warehouse-export:${exportId}`);
}
