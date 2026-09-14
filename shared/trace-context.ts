/** W3C Trace Context (R2-08).
 *
 * Parses and propagates `traceparent` for request/event correlation:
 *   https://www.w3.org/TR/trace-context/
 *
 * Deliberately dependency-free. The value of trace context here is the
 * *correlation*: today a domain event carries no link to the request that
 * produced it, so an event that misbehaves cannot be traced back to its cause.
 * That gap is closed by propagating the identifiers, which is a small, fully
 * specified string format — not by installing a tracing SDK.
 *
 * What this is **not**: it is not an OpenTelemetry installation. No spans are
 * sampled, batched, or exported to a collector, and no timing is measured. The
 * wire format is the standard one, so adding an SDK later is compatible with
 * everything stored here, but nothing in this file should be read as claiming
 * distributed tracing is deployed.
 */

/** Known prefix, including future additive versions. Hex is lowercase only. */
const TRACEPARENT =
  /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})/;

/** All-zero identifiers are explicitly invalid in the specification. */
const ZERO_TRACE = "0".repeat(32);
const ZERO_SPAN = "0".repeat(16);

export interface TraceContext {
  traceId: string;
  spanId: string;
  /** Bit 0 is sampled. Unknown bits are cleared when emitting version 00. */
  flags: string;
}

function hex(bytes: number): string {
  const values = new Uint8Array(bytes);
  crypto.getRandomValues(values);
  return Array.from(values, byte => byte.toString(16).padStart(2, "0")).join(
    ""
  );
}

/** A trace id that is not all zeroes. The retry is not theatre: a generator
 * that returned the invalid value would poison every downstream correlation. */
function randomTraceId(): string {
  let id = hex(16);
  while (id === ZERO_TRACE) id = hex(16);
  return id;
}

function randomSpanId(): string {
  let id = hex(8);
  while (id === ZERO_SPAN) id = hex(8);
  return id;
}

export function newTraceContext(sampled = false): TraceContext {
  return {
    traceId: randomTraceId(),
    spanId: randomSpanId(),
    flags: sampled ? "01" : "00",
  };
}

/** Parses a `traceparent`. Returns null for anything the specification calls
 * invalid, including the all-zero identifiers, so a malformed or hostile
 * header can never be adopted as a trace identity. */
export function parseTraceparent(
  value: string | string[] | undefined | null
): TraceContext | null {
  // A repeated header is ambiguous about which trace is the parent, and
  // guessing would attribute work to the wrong one.
  if (typeof value !== "string") return null;
  const header = value.replace(/^[ \t]+|[ \t]+$/g, "");
  if (/[\r\n]/.test(header)) return null;
  const match = TRACEPARENT.exec(header);
  if (!match) return null;
  const [, version, traceId, spanId, flags] = match;
  if (version === "ff") return null;
  if (
    version === "00"
      ? header.length !== 55
      : header.length > 55 && header[55] !== "-"
  )
    return null;
  if (traceId === ZERO_TRACE || spanId === ZERO_SPAN) return null;
  return { traceId, spanId, flags };
}

export function formatTraceparent(context: TraceContext): string {
  return `00-${context.traceId}-${context.spanId}-${isSampled(context) ? "01" : "00"}`;
}

/** Continues an inbound trace, or starts one when there is nothing valid to
 * continue. The caller always receives a usable context, so no code path has
 * to decide what to do without one. */
export function traceContextFrom(value: string | string[] | undefined | null): {
  context: TraceContext;
  continued: boolean;
} {
  const parent = parseTraceparent(value);
  if (!parent) return { context: newTraceContext(), continued: false };
  // A new span under the same trace: this system's work is a child of the
  // caller's, and reusing the caller's span id would merge two spans.
  return {
    context: {
      traceId: parent.traceId,
      spanId: randomSpanId(),
      flags: isSampled(parent) ? "01" : "00",
    },
    continued: true,
  };
}

/** A child span of the given context, for work this system causes downstream —
 * a relayed event, a queued job. Keeps the trace, takes a new span. */
export function childSpan(context: TraceContext): TraceContext {
  return {
    ...context,
    spanId: randomSpanId(),
    flags: isSampled(context) ? "01" : "00",
  };
}

export function isSampled(context: TraceContext): boolean {
  return (Number.parseInt(context.flags, 16) & 0x01) === 0x01;
}
