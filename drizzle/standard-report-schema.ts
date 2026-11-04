import {
  boolean,
  index,
  int,
  json,
  longtext,
  mysqlEnum,
  mysqlTable,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";
import type { StandardReportFilters } from "../shared/standard-reports";

/** Owner-bound report configurations. A null tenant is an explicit platform scope. */
export const standardReportTemplates = mysqlTable(
  "standard_report_templates",
  {
    id: int("id").autoincrement().primaryKey(),
    createdBy: int("createdBy").notNull(),
    tenantId: int("tenantId"),
    reportId: int("reportId").notNull(),
    name: varchar("name", { length: 120 }).notNull(),
    filters: json("filters").$type<StandardReportFilters>().notNull(),
    columns: json("columns").$type<string[]>(),
    format: mysqlEnum("format", ["csv", "html", "xml"]).notNull(),
    cadence: mysqlEnum("cadence", [
      "manual",
      "daily",
      "weekly",
      "monthly",
    ]).notNull(),
    hourUtc: int("hourUtc").notNull().default(0),
    minuteUtc: int("minuteUtc").notNull().default(0),
    lookbackDays: int("lookbackDays"),
    emailToOwner: boolean("emailToOwner").notNull().default(false),
    enabled: boolean("enabled").notNull().default(true),
    nextRunAt: timestamp("nextRunAt"),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
    updatedAt: timestamp("updatedAt").notNull().defaultNow().onUpdateNow(),
  },
  table => ({
    owner: index("standard_report_template_owner").on(
      table.createdBy,
      table.id
    ),
    due: index("standard_report_template_due").on(
      table.enabled,
      table.nextRunAt
    ),
  })
);

/** Stored output is accessible only after rechecking the owner's current role and tenant. */
export const standardReportRuns = mysqlTable(
  "standard_report_runs",
  {
    id: int("id").autoincrement().primaryKey(),
    templateId: int("templateId"),
    createdBy: int("createdBy").notNull(),
    tenantId: int("tenantId"),
    reportId: int("reportId").notNull(),
    name: varchar("name", { length: 120 }).notNull(),
    requestKey: varchar("requestKey", { length: 150 }).notNull(),
    definitionHash: varchar("definitionHash", { length: 64 }).notNull(),
    filters: json("filters").$type<StandardReportFilters>().notNull(),
    columns: json("columns").$type<string[]>(),
    format: mysqlEnum("format", ["csv", "html", "xml"]).notNull(),
    status: mysqlEnum("status", ["generating", "ready", "failed"]).notNull(),
    leaseToken: varchar("leaseToken", { length: 36 }),
    leaseUntil: timestamp("leaseUntil"),
    content: longtext("content"),
    filename: varchar("filename", { length: 160 }),
    contentType: varchar("contentType", { length: 100 }),
    recordCount: int("recordCount").notNull().default(0),
    checksum: varchar("checksum", { length: 64 }),
    deliveryStatus: mysqlEnum("deliveryStatus", [
      "none",
      "pending",
      "sending",
      "accepted",
      "failed",
      "unknown",
    ])
      .notNull()
      .default("none"),
    deliveryStartedAt: timestamp("deliveryStartedAt"),
    emailReceiptId: varchar("emailReceiptId", { length: 160 }),
    emailAcceptedAt: timestamp("emailAcceptedAt"),
    errorMessage: varchar("errorMessage", { length: 500 }),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
    completedAt: timestamp("completedAt"),
  },
  table => ({
    request: uniqueIndex("standard_report_run_request").on(table.requestKey),
    owner: index("standard_report_run_owner").on(table.createdBy, table.id),
    template: index("standard_report_run_template").on(
      table.templateId,
      table.id
    ),
  })
);
