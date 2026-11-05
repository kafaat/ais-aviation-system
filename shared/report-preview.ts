import type { StandardReportFilters } from "./standard-reports";

/** Only the reviewed, read-only load-factor preview opts into HTTP QUERY. */
export const REPORT_PREVIEW_PATH = "/api/rest/reports/preview";
export const REPORT_PREVIEW_REPORT_ID = 44;

export type ReportPreviewInput = {
  reportId: typeof REPORT_PREVIEW_REPORT_ID;
  filters: StandardReportFilters;
  columns?: string[];
};
