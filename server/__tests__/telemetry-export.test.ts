import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import express from "express";
import {
  initTracing,
  flushTracing,
  stopTracing,
  tracingConfiguration,
  tracedFetch,
} from "../_core/telemetry";
import { currentTrace, traceMiddleware } from "../_core/trace";
import { processEvents } from "../services/outbox.service";
import type { OutboxEvent } from "../../drizzle/schema";
import {
  formatTraceparent,
  parseTraceparent,
  type TraceContext,
} from "../../shared/trace-context";
import { z } from "zod";

const servers: Server[] = [];
async function listen(server: Server) {
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Server address unavailable");
  return `http://127.0.0.1:${address.port}`;
}
afterEach(async () => {
  await stopTracing();
  vi.unstubAllEnvs();
  await Promise.all(
    servers
      .splice(0)
      .map(
        server =>
          new Promise<void>((resolve, reject) =>
            server.close(e => (e ? reject(e) : resolve()))
          )
      )
  );
});
describe("OTLP causal boundaries", () => {
  it("exports API, durable consumer and provider spans linked to the original trace without request data", async () => {
    const exports: unknown[] = [];
    const collector = await listen(
      createServer(async (req, res) => {
        const body: Buffer[] = [];
        for await (const chunk of req) body.push(Buffer.from(chunk));
        exports.push(JSON.parse(Buffer.concat(body).toString()));
        res.setHeader("content-type", "application/json");
        res.end("{}");
      })
    );
    vi.stubEnv("AIS_OTEL_ENABLED", "true");
    vi.stubEnv("OTEL_TRACES_SAMPLER_ARG", "1");
    vi.stubEnv("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT", collector + "/v1/traces");
    initTracing("api");
    const app = express();
    app.use(traceMiddleware);
    app.get("/private", (_req, res) => res.json(currentTrace()));
    const api = await listen(createServer(app));
    const parent: TraceContext = {
      traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
      spanId: "00f067aa0ba902b7",
      flags: "01",
    };
    const response = await fetch(
      api + "/private?email=secret@example.invalid",
      {
        headers: {
          traceparent: formatTraceparent(parent),
          authorization: "Bearer synthetic-secret",
        },
      }
    );
    const produced = parseTraceparent(response.headers.get("traceresponse"));
    expect(produced).not.toBeNull();
    if (!produced) throw new Error("Trace response missing");
    await response.arrayBuffer();
    let receiver: TraceContext | null = null;
    const target = await listen(
      createServer((req, res) => {
        receiver = parseTraceparent(req.headers.traceparent);
        res.end("OK");
      })
    );
    const event: OutboxEvent = {
      id: 1,
      eventId: "synthetic-event",
      aggregateType: "booking",
      aggregateId: "1",
      eventType: "booking.created",
      schemaVersion: 1,
      payload: {},
      tenantId: null,
      status: "processing",
      attempts: 1,
      createdAt: new Date(),
      lockedAt: new Date(),
      lastError: null,
      leaseToken: "synthetic-lease",
      publishedAt: null,
      traceId: produced.traceId,
      spanId: produced.spanId,
      traceFlags: produced.flags,
    };
    expect(
      (
        await processEvents([event], async () => {
          await (
            await tracedFetch("provider.oncall", target, {
              method: "POST",
              body: "private body",
              headers: { authorization: "Bearer other-secret" },
            })
          ).arrayBuffer();
        })
      ).failed
    ).toEqual([]);
    await flushTracing();
    const schema = z.object({
      resourceSpans: z.array(
        z.object({
          scopeSpans: z.array(
            z.object({
              spans: z.array(
                z.object({
                  name: z.string(),
                  traceId: z.string(),
                  spanId: z.string(),
                  parentSpanId: z.string().optional(),
                  startTimeUnixNano: z.string(),
                  endTimeUnixNano: z.string(),
                })
              ),
            })
          ),
        })
      ),
    });
    const spans = exports.flatMap(e =>
      schema
        .parse(e)
        .resourceSpans.flatMap(r => r.scopeSpans.flatMap(s => s.spans))
    );
    expect(spans).toHaveLength(3);
    const request = spans.find(s => s.name === "http.request"),
      consumer = spans.find(s => s.name === "outbox.consume"),
      provider = spans.find(s => s.name === "provider.oncall");
    expect(request?.parentSpanId).toBe(parent.spanId);
    expect(consumer?.parentSpanId).toBe(request?.spanId);
    expect(provider?.parentSpanId).toBe(consumer?.spanId);
    expect(receiver).toEqual({
      traceId: parent.traceId,
      spanId: provider?.spanId,
      flags: "01",
    });
    expect(
      spans.every(
        s =>
          s.traceId === parent.traceId &&
          BigInt(s.endTimeUnixNano) >= BigInt(s.startTimeUnixNano)
      )
    ).toBe(true);
    expect(JSON.stringify(exports)).not.toMatch(
      /secret|private body|authorization|email=/
    );
    const count = exports.length;
    await (
      await fetch(api + "/private", {
        headers: { traceparent: formatTraceparent({ ...parent, flags: "00" }) },
      })
    ).arrayBuffer();
    await processEvents([{ ...event, traceFlags: "00" }], async () => {
      await (
        await tracedFetch("provider.oncall", target, { method: "POST" })
      ).arrayBuffer();
    });
    await flushTracing();
    expect(exports).toHaveLength(count);
  });
  it("remains disabled by default and rejects invalid collector/sampling configuration", () => {
    vi.stubEnv("AIS_OTEL_ENABLED", "false");
    expect(tracingConfiguration()).toBeNull();
    vi.stubEnv("AIS_OTEL_ENABLED", "true");
    vi.stubEnv(
      "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT",
      "http://collector.invalid/v1/traces"
    );
    vi.stubEnv("NODE_ENV", "production");
    expect(() => tracingConfiguration()).toThrow(/HTTPS/);
    vi.stubEnv(
      "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT",
      "https://collector.invalid/v1/traces"
    );
    vi.stubEnv("OTEL_TRACES_SAMPLER_ARG", "2");
    expect(() => tracingConfiguration()).toThrow();
  });
});
