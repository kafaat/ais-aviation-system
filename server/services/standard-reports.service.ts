import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { escapeCSV } from "../../shared/csv";
import type {
  ReportCell,
  StandardReportCategory,
  StandardReportDefinition,
  StandardReportFilters,
  StandardReportFormat,
  StandardReportResult,
  StandardReportScope,
} from "../../shared/standard-reports";
import {
  operationsReportDefinitions,
  getOperationsStandardReport,
} from "./standard-reports-ops.service";
import {
  financeReportDefinitions,
  getFinanceStandardReport,
} from "./standard-reports-finance.service";
import {
  commercialReportDefinitions,
  getCommercialStandardReport,
} from "./standard-reports-commercial.service";
import { isAdmin } from "./rbac.service";
import { requireValue } from "./required-value";
import { reportTable, standardReportPeriod } from "./standard-report-utils";

export interface ReportActor {
  id: number;
  role: string;
  tenantId: number | null;
  email?: string | null;
}

export function assertReportStaff(
  user: ReportActor,
  contextTenant: number | null
) {
  if (
    !isAdmin(user.role) &&
    !["airline_admin", "finance", "ops"].includes(user.role)
  ) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Report access requires an authorized airline role",
    });
  }
  if (
    !isAdmin(user.role) &&
    (user.tenantId == null || contextTenant !== user.tenantId)
  ) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Valid tenant context required",
    });
  }
}

function allowedCategory(role: string, category: StandardReportCategory) {
  return (
    isAdmin(role) ||
    role === "airline_admin" ||
    (role === "finance" && category === "finance") ||
    (role === "ops" && category === "operations")
  );
}

export function getStandardReportDefinitions(): StandardReportDefinition[] {
  const all = [
    ...operationsReportDefinitions,
    ...financeReportDefinitions,
    ...commercialReportDefinitions,
  ];
  if (new Set(all.map(report => report.id)).size !== all.length)
    throw new Error("Duplicate standard report registration");
  return all.sort((left, right) => left.id - right.id);
}

export function getStandardReportDefinition(id: number) {
  const definition = getStandardReportDefinitions().find(
    report => report.id === id
  );
  if (!definition)
    throw new TRPCError({ code: "NOT_FOUND", message: "Unknown report" });
  return definition;
}

export function listStandardReports(
  user: ReportActor,
  contextTenant: number | null
) {
  assertReportStaff(user, contextTenant);
  return getStandardReportDefinitions().filter(report =>
    allowedCategory(user.role, report.category)
  );
}

export function authorizeStandardReport(
  user: ReportActor,
  contextTenant: number | null,
  reportId: number
): StandardReportScope {
  assertReportStaff(user, contextTenant);
  if (
    !allowedCategory(user.role, getStandardReportDefinition(reportId).category)
  ) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "This report is outside your role",
    });
  }
  return {
    userId: user.id,
    tenantId: isAdmin(user.role) ? undefined : requireValue(user.tenantId),
  };
}

export function validateStandardReportFilters(
  definition: StandardReportDefinition,
  filters: StandardReportFilters
) {
  standardReportPeriod(filters);
  for (const [key, value] of Object.entries(filters)) {
    if (
      value !== undefined &&
      !definition.filters.includes(key as keyof StandardReportFilters)
    ) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `The ${definition.title} report does not support filter ${key}`,
      });
    }
  }
}

export async function runStandardReport(
  input: {
    reportId: number;
    filters: StandardReportFilters;
    columns?: string[];
  },
  scope: StandardReportScope
): Promise<StandardReportResult> {
  const definition = getStandardReportDefinition(input.reportId);
  if (definition.availability === "blocked") {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        definition.limitations.join(" ") ||
        "The source evidence for this report is not available",
    });
  }
  validateStandardReportFilters(definition, input.filters);
  const reader =
    definition.category === "operations"
      ? getOperationsStandardReport
      : definition.category === "finance"
        ? getFinanceStandardReport
        : getCommercialStandardReport;
  let raw;
  try {
    raw = await reader(input.reportId, input.filters, scope);
  } catch (error) {
    if (error instanceof TRPCError) throw error;
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message:
        "The report could not be generated. No partial output was published.",
    });
  }
  if (!raw)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "The report reader is not configured",
    });
  let columns = raw.columns;
  if (new Set(columns.map(column => column.key)).size !== columns.length)
    throw new Error("Duplicate report column");
  if (input.columns) {
    if (
      input.columns.length === 0 ||
      new Set(input.columns).size !== input.columns.length ||
      input.columns.some(key => !columns.some(column => column.key === key))
    ) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Select unique columns from this report",
      });
    }
    columns = input.columns.map(key =>
      requireValue(raw.columns.find(column => column.key === key))
    );
  }
  const table = reportTable(columns, raw.rows, [
    ...new Set([...definition.limitations, ...raw.notes]),
  ]);
  if (Buffer.byteLength(JSON.stringify(table), "utf8") > 8 * 1024 * 1024) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "Report preview exceeds 8 MiB. Narrow the filters or select fewer columns.",
    });
  }
  return {
    ...table,
    reportId: definition.id,
    title: definition.title,
    generatedAt: new Date().toISOString(),
    filters: input.filters,
    total: table.rows.length,
  };
}

function escapeMarkup(value: unknown) {
  return String(value ?? "")
    .replace(
      /[^\u0009\u000A\u000D\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu,
      "\uFFFD"
    )
    .replace(
      /[&<>"']/g,
      character =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&apos;",
        })[character] ?? character
    );
}

function serializeReportCSVCell(value: ReportCell) {
  // reportTable normalizes cells before export. A real finite number is safe
  // numeric data; numeric-looking text must still receive formula protection.
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  // A quoted empty field is a record even when it is the only column at EOF.
  if (value === null || value === "") return '""';
  return escapeCSV(String(value));
}

export function renderStandardReport(
  result: StandardReportResult,
  format: StandardReportFormat
) {
  let content: string;
  const contentTypes = {
    csv: "text/csv;charset=utf-8",
    html: "text/html;charset=utf-8",
    xml: "application/xml;charset=utf-8",
  };
  if (format === "csv") {
    // Unknown cells stay empty but retain their record; signed amounts and zero stay numeric.
    content =
      "\uFEFF" +
      [
        result.columns.map(column => escapeCSV(column.label)).join(","),
        ...result.rows.map(row =>
          result.columns
            .map(column => serializeReportCSVCell(row[column.key]))
            .join(",")
        ),
      ].join("\r\n");
  } else if (format === "html") {
    content = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>${escapeMarkup(result.title)}</title><style>body{font:14px system-ui;margin:2rem;color:#172337}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ccd4df;padding:.5rem;text-align:start}th{background:#eef3fa}caption{text-align:start;margin:.75rem 0}</style></head><body><h1>${escapeMarkup(result.title)}</h1><p>Generated: ${escapeMarkup(result.generatedAt)} · ${result.total} rows · Date filters use UTC</p>${result.notes.map(note => `<p>${escapeMarkup(note)}</p>`).join("")}<table><caption>${escapeMarkup(JSON.stringify(result.filters))}</caption><thead><tr>${result.columns.map(column => `<th scope="col">${escapeMarkup(column.label)}</th>`).join("")}</tr></thead><tbody>${result.rows.map(row => `<tr>${result.columns.map(column => `<td>${row[column.key] === null ? "Not recorded" : escapeMarkup(row[column.key])}</td>`).join("")}</tr>`).join("")}</tbody></table></body></html>`;
  } else {
    content = `<?xml version="1.0" encoding="UTF-8"?><report id="${result.reportId}" title="${escapeMarkup(result.title)}" generatedAt="${escapeMarkup(result.generatedAt)}" total="${result.total}" timezone="UTC"><filters>${Object.entries(
      result.filters
    )
      .filter(([, value]) => value !== undefined)
      .map(
        ([key, value]) =>
          `<filter name="${escapeMarkup(key)}">${escapeMarkup(value)}</filter>`
      )
      .join(
        ""
      )}</filters><notes>${result.notes.map(note => `<note>${escapeMarkup(note)}</note>`).join("")}</notes><columns>${result.columns.map(column => `<column key="${escapeMarkup(column.key)}" type="${column.type}">${escapeMarkup(column.label)}</column>`).join("")}</columns><rows>${result.rows.map(row => `<row>${result.columns.map(column => (row[column.key] === null ? `<cell key="${escapeMarkup(column.key)}" nil="true"/>` : `<cell key="${escapeMarkup(column.key)}">${escapeMarkup(row[column.key])}</cell>`)).join("")}</row>`).join("")}</rows></report>`;
  }
  if (Buffer.byteLength(content, "utf8") > 8 * 1024 * 1024)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "Report exceeds 8 MiB. Narrow the filters or select fewer columns.",
    });
  return {
    filename: `report-${result.reportId}-${result.generatedAt.slice(0, 10)}.${format}`,
    contentType: contentTypes[format],
    content,
    checksum: createHash("sha256").update(content).digest("hex"),
    recordCount: result.total,
  };
}
