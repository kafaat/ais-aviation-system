// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import {
  REPORT_PREVIEW_PATH,
  REPORT_PREVIEW_REPORT_ID,
  type ReportPreviewInput,
} from "@shared/report-preview";
import type { StandardReportResult } from "@shared/standard-reports";
import { previewStandardReport, ReportPreviewError } from "../report-preview";

afterEach(() => vi.unstubAllGlobals());

const input: ReportPreviewInput = {
  reportId: REPORT_PREVIEW_REPORT_ID,
  filters: {
    startDate: "2026-11-01",
    endDate: "2026-11-05",
    origin: "RUH",
    status: "scheduled",
  },
  columns: ["flightNumber", "capacity", "sold", "loadFactorPercent"],
};
const report: StandardReportResult = {
  reportId: REPORT_PREVIEW_REPORT_ID,
  title: "Load Factors",
  generatedAt: "2026-11-05T12:00:00.000Z",
  filters: input.filters,
  total: 1,
  columns: [
    {
      key: "loadFactorPercent",
      label: "Booked load factor percent",
      type: "number",
    },
  ],
  rows: [{ loadFactorPercent: 0 }],
  notes: ["Booked inventory, not flown passengers."],
};

it("sends the allowlisted preview as one credentialed JSON QUERY with the complete filters and columns", async () => {
  const fetch = vi.fn().mockResolvedValue(Response.json(report));
  vi.stubGlobal("fetch", fetch);
  const fallback = vi.fn().mockResolvedValue(report);
  const controller = new AbortController();

  await expect(
    previewStandardReport(input, fallback, { signal: controller.signal })
  ).resolves.toEqual(report);

  expect(fetch).toHaveBeenCalledExactlyOnceWith(REPORT_PREVIEW_PATH, {
    method: "QUERY",
    credentials: "include",
    cache: "no-store",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(input),
    signal: controller.signal,
  });
  expect(fallback).not.toHaveBeenCalled();
});

it.each([404, 405, 501])(
  "uses the existing POST once only when QUERY returns HTTP %i",
  async status => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status }));
    vi.stubGlobal("fetch", fetch);
    const fallback = vi.fn().mockResolvedValue(report);

    await expect(previewStandardReport(input, fallback)).resolves.toEqual(
      report
    );

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fallback).toHaveBeenCalledExactlyOnceWith(input);
  }
);

it.each([400, 401, 403, 409, 412, 415, 422, 429, 500, 503])(
  "surfaces HTTP %i without a compatibility fallback or retry",
  async status => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        Response.json(
          { code: "REJECTED", message: "Preview was rejected" },
          { status }
        )
      );
    vi.stubGlobal("fetch", fetch);
    const fallback = vi.fn().mockResolvedValue(report);

    await expect(previewStandardReport(input, fallback)).rejects.toMatchObject({
      name: "ReportPreviewError",
      message: "Preview was rejected",
      status,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fallback).not.toHaveBeenCalled();
  }
);

it("uses a bounded server message and a generic message for an HTML failure", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json({ message: "x".repeat(1000) }, { status: 403 })
    )
    .mockResolvedValueOnce(
      new Response("<html>Proxy failure</html>", { status: 500 })
    );
  vi.stubGlobal("fetch", fetch);
  const fallback = vi.fn();

  await expect(previewStandardReport(input, fallback)).rejects.toMatchObject({
    message: "x".repeat(500),
  });
  await expect(previewStandardReport(input, fallback)).rejects.toEqual(
    new ReportPreviewError("Report preview failed (HTTP 500)", 500)
  );
  expect(fallback).not.toHaveBeenCalled();
});

it.each([
  new TypeError("Network unavailable"),
  new DOMException("Cancelled", "AbortError"),
])(
  "does not retry or fall back after an uncertain transport outcome: %s",
  async failure => {
    const fetch = vi.fn().mockRejectedValue(failure);
    vi.stubGlobal("fetch", fetch);
    const fallback = vi.fn();

    await expect(previewStandardReport(input, fallback)).rejects.toBe(failure);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fallback).not.toHaveBeenCalled();
  }
);

it("does not send a cancelled preview or fall back if it is cancelled before method rejection is handled", async () => {
  const controller = new AbortController();
  controller.abort();
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const fallback = vi.fn();

  await expect(
    previewStandardReport(input, fallback, { signal: controller.signal })
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(fetch).not.toHaveBeenCalled();

  const inFlight = new AbortController();
  fetch.mockImplementationOnce(async () => {
    inFlight.abort();
    return new Response(null, { status: 405 });
  });
  await expect(
    previewStandardReport(input, fallback, { signal: inFlight.signal })
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fallback).not.toHaveBeenCalled();
});

it("surfaces a rejected POST fallback without sending another QUERY or POST", async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 405 }));
  vi.stubGlobal("fetch", fetch);
  const failure = new Error("The existing report service is unavailable");
  const fallback = vi.fn().mockRejectedValue(failure);

  await expect(previewStandardReport(input, fallback)).rejects.toBe(failure);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fallback).toHaveBeenCalledTimes(1);
});

it("keeps other reports on the existing transport without trying QUERY", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const otherInput = { ...input, reportId: 55 };
  const otherReport = { ...report, reportId: 55 };
  const fallback = vi.fn().mockResolvedValue(otherReport);

  await expect(previewStandardReport(otherInput, fallback)).resolves.toEqual(
    otherReport
  );
  expect(fetch).not.toHaveBeenCalled();
  expect(fallback).toHaveBeenCalledExactlyOnceWith(otherInput);
});

it("rejects a response for another report without falling back", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(Response.json({ ...report, reportId: 55 }))
  );
  const fallback = vi.fn();

  await expect(previewStandardReport(input, fallback)).rejects.toThrow(
    "unexpected report"
  );
  expect(fallback).not.toHaveBeenCalled();
});

it("keeps malformed success responses visible without a fallback", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response("not JSON", { status: 200 }))
  );
  const fallback = vi.fn();

  await expect(previewStandardReport(input, fallback)).rejects.toBeInstanceOf(
    SyntaxError
  );
  expect(fallback).not.toHaveBeenCalled();
});
