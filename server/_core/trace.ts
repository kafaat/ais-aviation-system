/** Ambient trace context (R2-08).
 *
 * Carried in an `AsyncLocalStorage` rather than threaded through every
 * signature. There are dozens of call sites between an HTTP handler and
 * `recordEvent`, and adding a parameter to all of them would be a large
 * refactor whose only purpose is to move one string — and any site that forgot
 * to forward it would silently lose the correlation. The store keeps the
 * context correct across awaits and cannot leak between concurrent requests,
 * which a module-level variable could not promise.
 *
 * Every entry point establishes a context, so nothing downstream has to decide
 * what to do without one. Where no trace exists — a path that never went
 * through an entry point — the reader returns null and the caller stores
 * nothing, rather than inventing an identifier that would correlate unrelated
 * work.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import type { RequestHandler } from "express";
import {
  formatTraceparent,
  traceContextFrom,
  newTraceContext,
  type TraceContext,
} from "../../shared/trace-context";

const storage = new AsyncLocalStorage<TraceContext>();

export function currentTrace(): TraceContext | null {
  return storage.getStore() ?? null;
}

export function runWithTrace<T>(context: TraceContext, run: () => T): T {
  return storage.run(context, run);
}

/** For background work — a scheduled task, a queue worker — which has no
 * inbound header but should still be attributable as one unit. */
export function runInNewTrace<T>(run: () => T): T {
  return storage.run(newTraceContext(), run);
}

/** Continues an inbound `traceparent`, or starts a trace when there is none.
 *
 * The context is echoed back in `traceresponse` so a caller can correlate its
 * own request without having to parse a log. Trace identifiers are random and
 * carry no user, tenant or payload data, so returning one discloses nothing.
 */
export const traceMiddleware: RequestHandler = (req, res, next) => {
  const { context } = traceContextFrom(req.headers.traceparent);
  res.setHeader("traceresponse", formatTraceparent(context));
  runWithTrace(context, next);
};
