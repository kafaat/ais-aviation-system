import type { RequestHandler } from "express";
import { SpanKind, SpanStatusCode } from "@opentelemetry/api";
import { beginTrace } from "./telemetry";
import {
  formatTraceparent,
  traceContextFrom,
  parseTraceparent,
} from "../../shared/trace-context";

import { runWithTrace } from "./trace-storage";
export { currentTrace, runInNewTrace, runWithTrace } from "./trace-storage";

/** Continues an inbound `traceparent`, or starts a trace when there is none.
 *
 * The context is echoed back in `traceresponse` so a caller can correlate its
 * own request without having to parse a log. Trace identifiers are random and
 * carry no user, tenant or payload data, so returning one discloses nothing.
 */
export const traceMiddleware: RequestHandler = (req, res, next) => {
  const active = beginTrace(
    "http.request",
    SpanKind.SERVER,
    parseTraceparent(req.headers.traceparent)
  );
  if (active) {
    const method = [
      "GET",
      "POST",
      "PUT",
      "PATCH",
      "DELETE",
      "OPTIONS",
      "HEAD",
      "QUERY",
    ].includes(req.method)
      ? req.method
      : "OTHER";
    active.span.setAttribute("http.request.method", method);
    let finished = false;
    const end = () => {
      if (finished) return;
      finished = true;
      active.span.setAttribute("http.response.status_code", res.statusCode);
      if (res.statusCode >= 500 || !res.writableFinished)
        active.span.setStatus({ code: SpanStatusCode.ERROR });
      active.span.end();
    };
    res.once("finish", end);
    res.once("close", end);
    res.setHeader("traceresponse", formatTraceparent(active.context));
    runWithTrace(active.context, next);
    return;
  }
  const { context } = traceContextFrom(req.headers.traceparent);
  res.setHeader("traceresponse", formatTraceparent(context));
  runWithTrace(context, next);
};
