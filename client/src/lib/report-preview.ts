import {
  REPORT_PREVIEW_PATH,
  REPORT_PREVIEW_REPORT_ID,
  type ReportPreviewInput,
} from "@shared/report-preview";
import type { StandardReportResult } from "@shared/standard-reports";

type PreviewRequest = Omit<ReportPreviewInput, "reportId"> & {
  reportId: number;
};
type PreviewFallback = (input: PreviewRequest) => Promise<StandardReportResult>;

export class ReportPreviewError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = "ReportPreviewError";
  }
}

/** Only the allowlisted preview uses QUERY; existing mutations keep their transport. */
export async function previewStandardReport(
  input: PreviewRequest,
  fallback: PreviewFallback,
  { signal }: { signal?: AbortSignal } = {}
): Promise<StandardReportResult> {
  signal?.throwIfAborted();
  if (input.reportId !== REPORT_PREVIEW_REPORT_ID) return fallback(input);

  const response = await globalThis.fetch(REPORT_PREVIEW_PATH, {
    method: "QUERY",
    credentials: "include",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(input),
    signal,
  });
  signal?.throwIfAborted();

  // An older server or intermediary can reject the new method. Authentication,
  // throttling, server failures and uncertain network outcomes must stay visible.
  if ([404, 405, 501].includes(response.status)) return fallback(input);
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const message =
      body !== null &&
      typeof body === "object" &&
      "message" in body &&
      typeof body.message === "string" &&
      body.message.trim()
        ? body.message.slice(0, 500)
        : `Report preview failed (HTTP ${response.status})`;
    throw new ReportPreviewError(message, response.status);
  }

  const result: StandardReportResult = await response.json();
  signal?.throwIfAborted();
  if (result.reportId !== input.reportId)
    throw new Error("Report preview returned an unexpected report");
  return result;
}
