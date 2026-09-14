import { describe, expect, it } from "vitest";
import express from "express";
import {
  childSpan,
  formatTraceparent,
  isSampled,
  newTraceContext,
  parseTraceparent,
  traceContextFrom,
} from "../../shared/trace-context";
import {
  currentTrace,
  runInNewTrace,
  runWithTrace,
  traceMiddleware,
} from "../_core/trace";

const VALID = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";

describe("traceparent parsing", () => {
  it("accepts a specification example", () => {
    expect(parseTraceparent(VALID)).toEqual({
      traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
      spanId: "00f067aa0ba902b7",
      flags: "01",
    });
  });

  it("accepts HTTP whitespace but rejects uppercase hexadecimal", () => {
    expect(parseTraceparent(` \t${VALID}  `)?.traceId).toBe(
      "4bf92f3577b34da6a3ce929d0e0e4736"
    );
    expect(parseTraceparent(VALID.toUpperCase())).toBeNull();
    expect(parseTraceparent(`\n${VALID}`)).toBeNull();
  });

  it("refuses the all-zero identifiers the specification forbids", () => {
    expect(
      parseTraceparent(`00-${"0".repeat(32)}-00f067aa0ba902b7-01`)
    ).toBeNull();
    expect(
      parseTraceparent(
        `00-4bf92f3577b34da6a3ce929d0e0e4736-${"0".repeat(16)}-01`
      )
    ).toBeNull();
  });

  it("refuses malformed, truncated and non-hex values", () => {
    for (const invalid of [
      "",
      "garbage",
      "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7",
      "00-4bf92f3577b34da6a3ce929d0e0e473-00f067aa0ba902b7-01",
      "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-0",
      "00-zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz-00f067aa0ba902b7-01",
      `${VALID} trailing`,
    ])
      expect(parseTraceparent(invalid)).toBeNull();
  });

  it("continues additive future versions using their known prefix", () => {
    for (const version of ["01", "fe"]) {
      const future = version + VALID.slice(2);
      expect(parseTraceparent(future)).toEqual(parseTraceparent(VALID));
      expect(parseTraceparent(`${future}-extra`)).toEqual(
        parseTraceparent(VALID)
      );
      expect(traceContextFrom(future).continued).toBe(true);
      expect(parseTraceparent(`${future}extra`)).toBeNull();
    }
    expect(parseTraceparent("ff" + VALID.slice(2))).toBeNull();
    expect(parseTraceparent(`${VALID}-extra`)).toBeNull();
  });

  it("clears reserved flags on outgoing version 00 without losing the sampling bit", () => {
    for (const [flags, expected] of [
      ["ff", "01"],
      ["fe", "00"],
    ]) {
      const parent = parseTraceparent(VALID.slice(0, -2) + flags)!;
      expect(formatTraceparent(parent)).toBe(VALID.slice(0, -2) + expected);
      expect(childSpan(parent).flags).toBe(expected);
      expect(traceContextFrom(VALID.slice(0, -2) + flags).context.flags).toBe(
        expected
      );
    }
    expect(newTraceContext().flags).toBe("00");
  });

  it("refuses a repeated header, which does not say which trace is the parent", () => {
    expect(parseTraceparent([VALID, VALID])).toBeNull();
    expect(parseTraceparent(undefined)).toBeNull();
  });

  it("round-trips through its own formatter", () => {
    const context = newTraceContext();
    expect(parseTraceparent(formatTraceparent(context))).toEqual(context);
  });
});

describe("trace identity", () => {
  it("generates identifiers of the specified width", () => {
    for (let i = 0; i < 50; i++) {
      const context = newTraceContext();
      expect(context.traceId).toMatch(/^[0-9a-f]{32}$/);
      expect(context.spanId).toMatch(/^[0-9a-f]{16}$/);
      expect(context.traceId).not.toBe("0".repeat(32));
      expect(context.spanId).not.toBe("0".repeat(16));
    }
  });

  it("does not repeat a trace id", () => {
    const ids = new Set(
      Array.from({ length: 200 }, () => newTraceContext().traceId)
    );
    expect(ids.size).toBe(200);
  });

  it("reads the sampled flag without overruling it", () => {
    expect(isSampled({ ...newTraceContext(), flags: "01" })).toBe(true);
    expect(isSampled({ ...newTraceContext(), flags: "00" })).toBe(false);
    // Unknown higher bits must not change the sampled decision.
    expect(isSampled({ ...newTraceContext(), flags: "ff" })).toBe(true);
    expect(isSampled({ ...newTraceContext(), flags: "fe" })).toBe(false);
  });
});

describe("continuation", () => {
  it("keeps the caller's trace but takes its own span", () => {
    const { context, continued } = traceContextFrom(VALID);
    expect(continued).toBe(true);
    expect(context.traceId).toBe("4bf92f3577b34da6a3ce929d0e0e4736");
    // Reusing the caller's span id would merge two spans into one.
    expect(context.spanId).not.toBe("00f067aa0ba902b7");
    // The upstream sampling decision is preserved, not re-made here.
    expect(context.flags).toBe("01");
  });

  it("preserves an upstream decision not to sample", () => {
    const { context } = traceContextFrom(
      "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-00"
    );
    expect(context.flags).toBe("00");
  });

  it("starts a fresh trace when the header is absent or unusable", () => {
    for (const header of [
      undefined,
      "garbage",
      `00-${"0".repeat(32)}-00f067aa0ba902b7-01`,
    ]) {
      const { context, continued } = traceContextFrom(header);
      expect(continued).toBe(false);
      expect(context.traceId).toMatch(/^[0-9a-f]{32}$/);
      expect(context.traceId).not.toBe("4bf92f3577b34da6a3ce929d0e0e4736");
    }
  });

  it("keeps the trace and changes the span for downstream work", () => {
    const parent = newTraceContext();
    const child = childSpan(parent);
    expect(child.traceId).toBe(parent.traceId);
    expect(child.spanId).not.toBe(parent.spanId);
    expect(child.flags).toBe(parent.flags);
  });
});

describe("ambient store", () => {
  it("reports no trace outside any entry point", () => {
    expect(currentTrace()).toBeNull();
  });

  it("survives awaits inside one scope", async () => {
    const context = newTraceContext();
    await runWithTrace(context, async () => {
      await Promise.resolve();
      await new Promise(resolve => setTimeout(resolve, 1));
      expect(currentTrace()).toEqual(context);
    });
    expect(currentTrace()).toBeNull();
  });

  it("does not leak between concurrent scopes", async () => {
    // The property a module-level variable could not provide: two overlapping
    // requests must never read each other's trace.
    const first = newTraceContext();
    const second = newTraceContext();
    const seen: string[] = [];
    await Promise.all([
      runWithTrace(first, async () => {
        await new Promise(resolve => setTimeout(resolve, 5));
        seen.push(currentTrace()!.traceId);
      }),
      runWithTrace(second, async () => {
        await new Promise(resolve => setTimeout(resolve, 1));
        seen.push(currentTrace()!.traceId);
      }),
    ]);
    expect(new Set(seen)).toEqual(new Set([first.traceId, second.traceId]));
  });

  it("gives background work its own trace", () => {
    runInNewTrace(() => {
      expect(currentTrace()?.traceId).toMatch(/^[0-9a-f]{32}$/);
    });
  });
});

describe("request middleware", () => {
  async function call(headers: Record<string, string> = {}) {
    const app = express();
    app.use(traceMiddleware);
    app.get("/probe", (_req, res) => {
      res.json({ trace: currentTrace() });
    });
    const server = app.listen(0, "127.0.0.1");
    await new Promise<void>(resolve =>
      server.once("listening", () => resolve())
    );
    try {
      const port = (server.address() as { port: number }).port;
      const response = await fetch(`http://127.0.0.1:${port}/probe`, {
        headers,
      });
      return {
        body: (await response.json()) as {
          trace: { traceId: string; spanId: string; flags: string } | null;
        },
        traceresponse: response.headers.get("traceresponse"),
      };
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  }

  it("makes the trace readable by the handler and echoes it back", async () => {
    const { body, traceresponse } = await call({ traceparent: VALID });
    expect(body.trace?.traceId).toBe("4bf92f3577b34da6a3ce929d0e0e4736");
    expect(traceresponse).toBe(formatTraceparent(body.trace!));
  });

  it("starts a trace for a request that carries none", async () => {
    const { body, traceresponse } = await call();
    expect(body.trace?.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(traceresponse).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/);
  });

  it("refuses to adopt a hostile header as a trace identity", async () => {
    const { body } = await call({
      traceparent: "00-notahexvalueatall-0000000000000000-zz",
    });
    expect(body.trace?.traceId).toMatch(/^[0-9a-f]{32}$/);
  });
});
