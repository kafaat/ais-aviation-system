/** W3C Trace Context (R2-08).
 *
 * Implements the `traceparent` header exactly as specified:
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

/** `00-<32 hex trace id>-<16 hex span id>-<2 hex flags>`.
 *
 * Version `00` only. The spec says a future version must be parsed
 * best-effort, but accepting one here would mean storing identifiers this code
 * cannot interpret, so an unknown version is treated as absent and a fresh
 * context is started instead. That is a loss of correlation, never a loss of
 * correctness.
 */
const TRACEPARENT = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;

/** All-zero identifiers are explicitly invalid in the specification. */
const ZERO_TRACE = "0".repeat(32);
const ZERO_SPAN = "0".repeat(16);

export interface TraceContext {
  traceId: string;
  spanId: string;
  /** Bit 0 is `sampled`. Preserved as received: this system is not the
   * sampling authority and must not overrule an upstream decision. */
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

export function newTraceContext(sampled = true): TraceContext {
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
  const match = TRACEPARENT.exec(value.trim().toLowerCase());
  if (!match) return null;
  const [, traceId, spanId, flags] = match;
  if (traceId === ZERO_TRACE || spanId === ZERO_SPAN) return null;
  return { traceId, spanId, flags };
}

export function formatTraceparent(context: TraceContext): string {
  return `00-${context.traceId}-${context.spanId}-${context.flags}`;
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
      flags: parent.flags,
    },
    continued: true,
  };
}

/** A child span of the given context, for work this system causes downstream —
 * a relayed event, a queued job. Keeps the trace, takes a new span. */
export function childSpan(context: TraceContext): TraceContext {
  return { ...context, spanId: randomSpanId() };
}

export function isSampled(context: TraceContext): boolean {
  return (Number.parseInt(context.flags, 16) & 0x01) === 0x01;
}
