import { TRPCError } from "@trpc/server";
import {
  STANDARD_REPORT_ROW_LIMIT,
  type ReportCell,
  type StandardReportColumn,
  type StandardReportFilters,
  type StandardReportTable,
} from "../../shared/standard-reports";

/** Date-only inputs describe complete UTC days. End bounds are exclusive. */
export function standardReportPeriod(filters: StandardReportFilters) {
  const start = filters.startDate
    ? new Date(`${filters.startDate}T00:00:00.000Z`)
    : undefined;
  const end = filters.endDate
    ? new Date(
        new Date(`${filters.endDate}T00:00:00.000Z`).getTime() + 86_400_000
      )
    : undefined;
  if (
    (start && !Number.isFinite(start.getTime())) ||
    (end && !Number.isFinite(end.getTime())) ||
    (start && end && start >= end)
  ) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Invalid report period",
    });
  }
  return { start, end };
}

export function reportCell(value: unknown): ReportCell {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  throw new TRPCError({
    code: "INTERNAL_SERVER_ERROR",
    message: "Unsupported report value",
  });
}

export function reportTable(
  columns: StandardReportColumn[],
  rows: Record<string, unknown>[],
  notes: string[] = []
): StandardReportTable {
  if (rows.length > STANDARD_REPORT_ROW_LIMIT) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "The report exceeds 10000 rows. Narrow the report filters; no rows were silently omitted.",
    });
  }
  return {
    columns,
    rows: rows.map(row =>
      Object.fromEntries(
        columns.map(column => [column.key, reportCell(row[column.key])])
      )
    ),
    notes,
  };
}

export function textColumn(key: string, label: string): StandardReportColumn {
  return { key, label, type: "text" };
}
export function numberColumn(key: string, label: string): StandardReportColumn {
  return { key, label, type: "number" };
}
export function dateColumn(key: string, label: string): StandardReportColumn {
  return { key, label, type: "date" };
}
