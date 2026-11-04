/** Public, allowlisted report contracts. No database identifiers or SQL come from clients. */
export type StandardReportCategory = "operations" | "finance" | "commercial";
export type StandardReportAvailability = "available" | "partial" | "blocked";
export type StandardReportFilterKey =
  | "startDate"
  | "endDate"
  | "flightId"
  | "bookingReference"
  | "ticketNumber"
  | "couponNumber"
  | "origin"
  | "destination"
  | "memberId"
  | "officeId"
  | "status";

export interface StandardReportFilters {
  startDate?: string;
  endDate?: string;
  flightId?: number;
  bookingReference?: string;
  ticketNumber?: string;
  couponNumber?: number;
  origin?: string;
  destination?: string;
  memberId?: number;
  officeId?: number;
  status?: string;
}

export interface StandardReportDefinition {
  id: number;
  title: string;
  category: StandardReportCategory;
  availability: StandardReportAvailability;
  description: string;
  limitations: string[];
  filters: StandardReportFilterKey[];
}

export type ReportCell = string | number | boolean | null;
export interface StandardReportColumn {
  key: string;
  label: string;
  type: "text" | "number" | "date" | "boolean";
}

export interface StandardReportTable {
  columns: StandardReportColumn[];
  rows: Record<string, ReportCell>[];
  notes: string[];
}

export interface StandardReportResult extends StandardReportTable {
  reportId: number;
  title: string;
  generatedAt: string;
  filters: StandardReportFilters;
  total: number;
}

export interface StandardReportScope {
  /** Undefined only for an explicitly authorized platform administrator. */
  tenantId?: number;
  userId: number;
}

export const STANDARD_REPORT_ROW_LIMIT = 10_000;
export const STANDARD_REPORT_FORMATS = ["csv", "html", "xml"] as const;
export type StandardReportFormat = (typeof STANDARD_REPORT_FORMATS)[number];
