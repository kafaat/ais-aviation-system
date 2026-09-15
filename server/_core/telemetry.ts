import {
  ROOT_CONTEXT,
  SpanKind,
  SpanStatusCode,
  trace,
  type Span,
} from "@opentelemetry/api";
import {
  BasicTracerProvider,
  BatchSpanProcessor,
  ParentBasedSampler,
  TraceIdRatioBasedSampler,
} from "@opentelemetry/sdk-trace-base";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { currentTrace, runWithTrace } from "./trace";
import {
  formatTraceparent,
  type TraceContext,
} from "../../shared/trace-context";

type Operation =
  | "http.request"
  | "worker.task"
  | "outbox.consume"
  | "provider.outbox"
  | "provider.oncall"
  | "provider.weather";
let provider: BasicTracerProvider | undefined;
export function tracingConfiguration() {
  const enabled = process.env.AIS_OTEL_ENABLED?.trim() || "false";
  if (!["true", "false"].includes(enabled))
    throw new Error("Invalid AIS_OTEL_ENABLED");
  if (enabled === "false") return null;
  const raw = process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT;
  const rate = Number(process.env.OTEL_TRACES_SAMPLER_ARG?.trim() || "0.1");
  if (!raw || !Number.isFinite(rate) || rate < 0 || rate > 1)
    throw new Error("Tracing endpoint and sampling ratio are required");
  const url = new URL(raw);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.hash ||
    url.search ||
    (process.env.NODE_ENV === "production" && url.protocol !== "https:")
  )
    throw new Error(
      "Tracing collector requires a supported URL and HTTPS in production"
    );
  return { endpoint: url.href, rate };
}
export function initTracing(component: "api" | "worker") {
  if (provider) return;
  const config = tracingConfiguration();
  if (!config) return;
  // A private provider coexists with Sentry without competing for its global
  // registration. Explicit parent contexts bridge the durable outbox boundary.
  provider = new BasicTracerProvider({
    resource: resourceFromAttributes({
      "service.name": `ais-${component}`,
      "service.version": process.env.npm_package_version ?? "unknown",
    }),
    sampler: new ParentBasedSampler({
      root: new TraceIdRatioBasedSampler(config.rate),
    }),
    spanProcessors: [
      new BatchSpanProcessor(
        new OTLPTraceExporter({ url: config.endpoint, timeoutMillis: 3000 }),
        {
          maxQueueSize: 2048,
          maxExportBatchSize: 256,
          scheduledDelayMillis: 1000,
          exportTimeoutMillis: 4000,
        }
      ),
    ],
  });
}
export async function flushTracing() {
  await provider?.forceFlush();
}
export async function stopTracing() {
  const active = provider;
  provider = undefined;
  await active?.shutdown();
}
export function beginTrace(
  name: Operation,
  kind: SpanKind,
  parent: TraceContext | null = currentTrace()
) {
  if (!provider) return null;
  const parentContext = parent
    ? trace.setSpanContext(ROOT_CONTEXT, {
        traceId: parent.traceId,
        spanId: parent.spanId,
        traceFlags: parseInt(parent.flags, 16) & 1,
        isRemote: true,
      })
    : ROOT_CONTEXT;
  const span = provider
    .getTracer("ais.boundaries", "1")
    .startSpan(name, { kind }, parentContext);
  const context = span.spanContext();
  return {
    span,
    context: {
      traceId: context.traceId,
      spanId: context.spanId,
      flags: context.traceFlags & 1 ? "01" : "00",
    },
  };
}
export async function tracedOperation<T>(
  name: Operation,
  kind: SpanKind,
  run: (span?: Span) => Promise<T>,
  parent: TraceContext | null = currentTrace()
): Promise<T> {
  const active = beginTrace(name, kind, parent);
  if (!active) return run();
  return await runWithTrace(active.context, async () => {
    try {
      return await run(active.span);
    } catch (error) {
      active.span.setStatus({ code: SpanStatusCode.ERROR });
      throw error;
    } finally {
      active.span.end();
    }
  });
}
/** Attributes deliberately exclude URLs, headers, bodies, IDs and error text.
 * Provider spans measure request-to-response-headers latency. */
export function tracedFetch(
  name: "provider.outbox" | "provider.oncall" | "provider.weather",
  url: string | URL,
  init: RequestInit
) {
  return tracedOperation(name, SpanKind.CLIENT, async span => {
    const context = span ? currentTrace() : null;
    const headers = context ? new Headers(init.headers) : undefined;
    if (context && headers)
      headers.set("traceparent", formatTraceparent(context));
    const response = await fetch(url, headers ? { ...init, headers } : init);
    span?.setAttribute("http.response.status_code", response.status);
    if (response.status >= 400) span?.setStatus({ code: SpanStatusCode.ERROR });
    return response;
  });
}
