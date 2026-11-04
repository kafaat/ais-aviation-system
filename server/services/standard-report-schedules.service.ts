import { createHash, randomUUID } from "node:crypto";
import {
  and,
  asc,
  desc,
  eq,
  getTableColumns,
  isNull,
  inArray,
  lte,
  or,
  sql,
} from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  standardReportRuns,
  standardReportTemplates,
  users,
} from "../../drizzle/schema";
import type { StandardReportFilters } from "../../shared/standard-reports";
import {
  reportTemplateInputSchema,
  type reportTemplateSchema,
} from "../contracts/standard-reports";
import { getDb } from "../db";
import { requireValue } from "./required-value";
import { isAdmin } from "./rbac.service";
import { isTenantActive } from "./tenant.service";
import { sendEmailWithReceipt } from "./email.service";
import {
  assertReportStaff,
  authorizeStandardReport,
  getStandardReportDefinition,
  listStandardReports,
  renderStandardReport,
  runStandardReport,
  validateStandardReportFilters,
  type ReportActor,
} from "./standard-reports.service";

type TemplateInput = z.infer<typeof reportTemplateInputSchema>;
type Template = typeof standardReportTemplates.$inferSelect;
type PublicTemplate = z.infer<typeof reportTemplateSchema>;
const {
  content: _content,
  leaseToken: _leaseToken,
  ...runMetadata
} = getTableColumns(standardReportRuns);
const LEASE_MS = 15 * 60_000;

/** Authorize with the stored owner and tenant before projecting the strict public response. */
function publicTemplate(template: Template): PublicTemplate {
  return {
    id: template.id,
    reportId: template.reportId,
    name: template.name,
    filters: template.filters,
    columns: template.columns ?? undefined,
    format: template.format,
    cadence: template.cadence,
    hourUtc: template.hourUtc,
    minuteUtc: template.minuteUtc,
    lookbackDays: template.lookbackDays,
    emailToOwner: template.emailToOwner,
    enabled: template.enabled,
    nextRunAt: template.nextRunAt,
    createdAt: template.createdAt,
    updatedAt: template.updatedAt,
  };
}

async function reportDb() {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "SERVICE_UNAVAILABLE",
      message: "Report database is unavailable",
    });
  return db;
}
function tenantPredicate(tenantId: number | null) {
  return tenantId === null
    ? isNull(standardReportTemplates.tenantId)
    : eq(standardReportTemplates.tenantId, tenantId);
}
function actorTenant(
  user: ReportActor,
  contextTenant: number | null,
  reportId: number
) {
  return (
    authorizeStandardReport(user, contextTenant, reportId).tenantId ?? null
  );
}
function assertSavedScope(
  savedTenant: number | null,
  currentTenant: number | null
) {
  if (savedTenant !== currentTenant)
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "This saved report belongs to a different access scope",
    });
}

/** Weekly means every seven days from the saved due date; monthly clamps to month end. All times are UTC. */
export function nextStandardReportRun(
  cadence: TemplateInput["cadence"],
  hourUtc: number,
  minuteUtc: number,
  after = new Date(),
  previousDue?: Date
): Date | null {
  if (cadence === "manual") return null;
  const next = new Date(previousDue ?? after);
  next.setUTCHours(hourUtc, minuteUtc, 0, 0);
  if (!previousDue && next > after) return next;
  do {
    if (cadence === "monthly") {
      const day = next.getUTCDate();
      const year = next.getUTCFullYear();
      const month = next.getUTCMonth() + 1;
      const maxDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
      next.setUTCDate(1);
      next.setUTCMonth(month);
      next.setUTCDate(Math.min(day, maxDay));
    } else next.setUTCDate(next.getUTCDate() + (cadence === "weekly" ? 7 : 1));
  } while (next <= after);
  return next;
}

export function scheduledStandardReportFilters(
  template: Pick<Template, "filters" | "lookbackDays">,
  due: Date
): StandardReportFilters {
  if (template.lookbackDays === null) return template.filters;
  const end = new Date(
    Date.UTC(due.getUTCFullYear(), due.getUTCMonth(), due.getUTCDate()) - 1
  );
  const start = new Date(
    end.getTime() - (template.lookbackDays - 1) * 86_400_000
  );
  return {
    ...template.filters,
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
  };
}

export async function listStandardReportTemplates(
  user: ReportActor,
  contextTenant: number | null
) {
  assertReportStaff(user, contextTenant);
  const db = await reportDb();
  const rows = await db
    .select()
    .from(standardReportTemplates)
    .where(eq(standardReportTemplates.createdBy, user.id))
    .orderBy(desc(standardReportTemplates.id))
    .limit(501);
  if (rows.length > 500)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Too many saved reports. Remove unused templates.",
    });
  return rows
    .filter(row => {
      try {
        return row.tenantId === actorTenant(user, contextTenant, row.reportId);
      } catch {
        return false;
      }
    })
    .map(publicTemplate);
}

export async function saveStandardReportTemplate(
  user: ReportActor,
  contextTenant: number | null,
  input: TemplateInput,
  id?: number
) {
  const scope = authorizeStandardReport(user, contextTenant, input.reportId);
  const definition = getStandardReportDefinition(input.reportId);
  validateStandardReportFilters(definition, input.filters);
  if (
    input.lookbackDays !== null &&
    (!definition.filters.includes("startDate") ||
      !definition.filters.includes("endDate"))
  ) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "Rolling periods require a report with start and end date filters",
    });
  }
  if (
    input.emailToOwner &&
    (!user.email || !z.email().safeParse(user.email).success)
  ) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "An account email address is required for report delivery",
    });
  }
  // Validate the real reader and selected columns before persisting a runnable template.
  await runStandardReport(input, scope);
  const db = await reportDb();
  const tenantId = scope.tenantId ?? null;
  if (id !== undefined) {
    const [existing] = await db
      .select()
      .from(standardReportTemplates)
      .where(
        and(
          eq(standardReportTemplates.id, id),
          eq(standardReportTemplates.createdBy, user.id)
        )
      )
      .limit(1);
    if (!existing)
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Saved report not found",
      });
    assertSavedScope(
      existing.tenantId,
      actorTenant(user, contextTenant, existing.reportId)
    );
  } else {
    const [count] = await db
      .select({ total: sql<number>`count(*)` })
      .from(standardReportTemplates)
      .where(eq(standardReportTemplates.createdBy, user.id));
    if (Number(count.total) >= 500)
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Saved report limit reached",
      });
  }
  const values = {
    ...input,
    columns: input.columns ?? null,
    tenantId,
    nextRunAt: input.enabled
      ? nextStandardReportRun(input.cadence, input.hourUtc, input.minuteUtc)
      : null,
  };
  let savedId = id;
  if (savedId !== undefined)
    await db
      .update(standardReportTemplates)
      .set(values)
      .where(
        and(
          eq(standardReportTemplates.id, savedId),
          eq(standardReportTemplates.createdBy, user.id)
        )
      );
  else {
    const [created] = await db
      .insert(standardReportTemplates)
      .values({ ...values, createdBy: user.id });
    savedId = created.insertId;
  }
  const [saved] = await db
    .select()
    .from(standardReportTemplates)
    .where(eq(standardReportTemplates.id, requireValue(savedId)))
    .limit(1);
  return publicTemplate(saved);
}

export async function deleteStandardReportTemplate(
  user: ReportActor,
  contextTenant: number | null,
  id: number
) {
  const template = await getTemplate(user, contextTenant, id);
  const db = await reportDb();
  const [result] = await db
    .delete(standardReportTemplates)
    .where(
      and(
        eq(standardReportTemplates.id, template.id),
        eq(standardReportTemplates.createdBy, user.id),
        tenantPredicate(template.tenantId)
      )
    );
  return { deleted: result.affectedRows === 1 };
}

/** Pausing is an ownership operation and must still work when a source is down. */
export async function setStandardReportTemplateEnabled(
  user: ReportActor,
  contextTenant: number | null,
  id: number,
  enabled: boolean
) {
  const template = await getTemplate(user, contextTenant, id);
  if (enabled) {
    await runStandardReport(
      {
        reportId: template.reportId,
        filters: template.filters,
        columns: template.columns ?? undefined,
      },
      authorizeStandardReport(user, contextTenant, template.reportId)
    );
  }
  const db = await reportDb();
  await db
    .update(standardReportTemplates)
    .set({
      enabled,
      nextRunAt: enabled
        ? nextStandardReportRun(
            template.cadence,
            template.hourUtc,
            template.minuteUtc
          )
        : null,
    })
    .where(
      and(
        eq(standardReportTemplates.id, id),
        eq(standardReportTemplates.createdBy, user.id),
        tenantPredicate(template.tenantId)
      )
    );
  const saved = await getTemplate(user, contextTenant, id);
  return publicTemplate(saved);
}

async function getTemplate(
  user: ReportActor,
  contextTenant: number | null,
  id: number
) {
  assertReportStaff(user, contextTenant);
  const db = await reportDb();
  const [template] = await db
    .select()
    .from(standardReportTemplates)
    .where(
      and(
        eq(standardReportTemplates.id, id),
        eq(standardReportTemplates.createdBy, user.id)
      )
    )
    .limit(1);
  if (!template)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Saved report not found",
    });
  assertSavedScope(
    template.tenantId,
    actorTenant(user, contextTenant, template.reportId)
  );
  return template;
}

export async function listStandardReportRuns(
  user: ReportActor,
  contextTenant: number | null,
  beforeId?: number
) {
  assertReportStaff(user, contextTenant);
  const db = await reportDb();
  const allowedIds = listStandardReports(user, contextTenant).map(
    report => report.id
  );
  const currentTenant = isAdmin(user.role) ? null : user.tenantId;
  const rows = await db
    .select(runMetadata)
    .from(standardReportRuns)
    .where(
      and(
        eq(standardReportRuns.createdBy, user.id),
        inArray(standardReportRuns.reportId, allowedIds),
        currentTenant === null
          ? isNull(standardReportRuns.tenantId)
          : eq(standardReportRuns.tenantId, currentTenant),
        beforeId === undefined
          ? undefined
          : sql`${standardReportRuns.id} < ${beforeId}`
      )
    )
    .orderBy(desc(standardReportRuns.id))
    .limit(100);
  return rows.filter(row => {
    try {
      return row.tenantId === actorTenant(user, contextTenant, row.reportId);
    } catch {
      return false;
    }
  });
}

export async function downloadStandardReportRun(
  user: ReportActor,
  contextTenant: number | null,
  id: number
) {
  assertReportStaff(user, contextTenant);
  const db = await reportDb();
  const [run] = await db
    .select()
    .from(standardReportRuns)
    .where(
      and(
        eq(standardReportRuns.id, id),
        eq(standardReportRuns.createdBy, user.id)
      )
    )
    .limit(1);
  if (!run)
    throw new TRPCError({ code: "NOT_FOUND", message: "Report run not found" });
  assertSavedScope(
    run.tenantId,
    actorTenant(user, contextTenant, run.reportId)
  );
  if (
    run.status !== "ready" ||
    run.content === null ||
    !run.filename ||
    !run.contentType ||
    !run.checksum
  )
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Report output is not ready",
    });
  if (createHash("sha256").update(run.content).digest("hex") !== run.checksum)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Stored report checksum does not match",
    });
  return {
    filename: run.filename,
    contentType: run.contentType,
    content: run.content,
    checksum: run.checksum,
    recordCount: run.recordCount,
  };
}

export async function runStandardReportTemplate(
  user: ReportActor,
  contextTenant: number | null,
  id: number,
  requestId: string,
  due?: Date
) {
  const template = await getTemplate(user, contextTenant, id);
  if (
    due &&
    (!template.enabled || template.nextRunAt?.getTime() !== due.getTime())
  )
    throw new TRPCError({
      code: "CONFLICT",
      message: "Report schedule changed",
    });
  const scope = authorizeStandardReport(user, contextTenant, template.reportId);
  const filters = scheduledStandardReportFilters(template, due ?? new Date());
  const requestKey = due
    ? `schedule:${id}:${due.toISOString()}`
    : `manual:${user.id}:${id}:${requestId}`;
  const definitionHash = createHash("sha256")
    .update(
      JSON.stringify({
        reportId: template.reportId,
        filters,
        columns: template.columns,
        format: template.format,
        tenantId: template.tenantId,
        emailToOwner: template.emailToOwner,
      })
    )
    .digest("hex");
  const token = randomUUID();
  const db = await reportDb();
  const { row, claimed } = await db.transaction(async tx => {
    await tx
      .insert(standardReportRuns)
      .values({
        templateId: template.id,
        createdBy: user.id,
        tenantId: template.tenantId,
        reportId: template.reportId,
        name: template.name,
        requestKey,
        definitionHash,
        filters,
        columns: template.columns,
        format: template.format,
        status: "generating",
        deliveryStatus: template.emailToOwner ? "pending" : "none",
      })
      .onDuplicateKeyUpdate({
        set: { requestKey: sql`${standardReportRuns.requestKey}` },
      });
    const [existing] = await tx
      .select()
      .from(standardReportRuns)
      .where(eq(standardReportRuns.requestKey, requestKey))
      .limit(1)
      .for("update");
    if (existing.definitionHash !== definitionHash)
      throw new TRPCError({
        code: "CONFLICT",
        message:
          "The request key already belongs to a different report configuration",
      });
    if (
      existing.status === "ready" ||
      (existing.leaseUntil && existing.leaseUntil > new Date())
    )
      return { row: existing, claimed: false };
    await tx
      .update(standardReportRuns)
      .set({
        status: "generating",
        leaseToken: token,
        leaseUntil: new Date(Date.now() + LEASE_MS),
        errorMessage: null,
      })
      .where(eq(standardReportRuns.id, existing.id));
    return { row: existing, claimed: true };
  });
  if (claimed) {
    const fence = and(
      eq(standardReportRuns.id, row.id),
      eq(standardReportRuns.leaseToken, token)
    );
    try {
      const result = await runStandardReport(
        {
          reportId: row.reportId,
          filters: row.filters,
          columns: row.columns ?? undefined,
        },
        scope
      );
      const rendered = renderStandardReport(result, row.format);
      const [updated] = await db
        .update(standardReportRuns)
        .set({
          ...rendered,
          status: "ready",
          completedAt: new Date(),
          leaseToken: null,
          leaseUntil: null,
        })
        .where(fence);
      if (updated.affectedRows !== 1)
        throw new Error("Report generation lease lost");
    } catch (error) {
      const message =
        error instanceof TRPCError &&
        ["BAD_REQUEST", "PRECONDITION_FAILED"].includes(error.code)
          ? error.message.slice(0, 500)
          : "Report generation failed; the report was not published.";
      await db
        .update(standardReportRuns)
        .set({
          status: "failed",
          errorMessage: message,
          completedAt: new Date(),
          leaseToken: null,
          leaseUntil: null,
        })
        .where(fence);
    }
  }
  await deliverStandardReportRun(row.id, user, contextTenant);
  const [finished] = await db
    .select(runMetadata)
    .from(standardReportRuns)
    .where(eq(standardReportRuns.id, row.id))
    .limit(1);
  return finished;
}

async function deliverStandardReportRun(
  id: number,
  user: ReportActor,
  contextTenant: number | null
) {
  const db = await reportDb();
  const [row] = await db
    .select()
    .from(standardReportRuns)
    .where(
      and(
        eq(standardReportRuns.id, id),
        eq(standardReportRuns.createdBy, user.id)
      )
    )
    .limit(1);
  if (!row || row.status !== "ready") return;
  assertSavedScope(
    row.tenantId,
    actorTenant(user, contextTenant, row.reportId)
  );
  if (
    row.deliveryStatus === "sending" &&
    row.deliveryStartedAt &&
    Date.now() - row.deliveryStartedAt.getTime() > LEASE_MS
  ) {
    await db
      .update(standardReportRuns)
      .set({
        deliveryStatus: "unknown",
        errorMessage:
          "Email acceptance is unknown after an interrupted attempt. Review the provider receipt before sending again.",
      })
      .where(
        and(
          eq(standardReportRuns.id, id),
          eq(standardReportRuns.deliveryStatus, "sending")
        )
      );
    return;
  }
  if (row.deliveryStatus !== "pending") return;
  let recipient: ReportActor;
  try {
    const [currentOwner] = await db
      .select({
        id: users.id,
        role: users.role,
        tenantId: users.tenantId,
        email: users.email,
      })
      .from(users)
      .where(eq(users.id, row.createdBy))
      .limit(1);
    if (
      !currentOwner ||
      (!isAdmin(currentOwner.role) &&
        (currentOwner.tenantId === null ||
          !(await isTenantActive(currentOwner.tenantId))))
    )
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "The report owner is no longer authorized for email delivery",
      });
    assertSavedScope(
      row.tenantId,
      actorTenant(currentOwner, currentOwner.tenantId, row.reportId)
    );
    recipient = currentOwner;
  } catch (error) {
    if (
      !(error instanceof TRPCError) ||
      !["FORBIDDEN", "NOT_FOUND"].includes(error.code)
    )
      throw error;
    await db
      .update(standardReportRuns)
      .set({
        deliveryStatus: "failed",
        errorMessage:
          "The report owner is no longer authorized for email delivery.",
      })
      .where(
        and(
          eq(standardReportRuns.id, id),
          eq(standardReportRuns.deliveryStatus, "pending")
        )
      );
    return;
  }
  if (
    !recipient.email ||
    !process.env.RESEND_API_KEY ||
    !process.env.EMAIL_FROM
  ) {
    await db
      .update(standardReportRuns)
      .set({
        deliveryStatus: "failed",
        errorMessage:
          "Email delivery requires an account address and configured email provider. The report remains available in the dashboard.",
      })
      .where(
        and(
          eq(standardReportRuns.id, id),
          eq(standardReportRuns.deliveryStatus, "pending")
        )
      );
    return;
  }
  const [claimed] = await db
    .update(standardReportRuns)
    .set({ deliveryStatus: "sending", deliveryStartedAt: new Date() })
    .where(
      and(
        eq(standardReportRuns.id, id),
        eq(standardReportRuns.deliveryStatus, "pending")
      )
    );
  if (claimed.affectedRows !== 1) return;
  try {
    const receipt = await sendEmailWithReceipt({
      to: recipient.email,
      subject: `AIS report: ${row.name}`,
      idempotencyKey: `standard-report-${row.id}`,
      html: "<p>Your requested AIS report is attached. Its evidence notes and dates describe the scope of the data.</p>",
      attachments: [
        {
          filename: requireValue(row.filename),
          content: Buffer.from(requireValue(row.content), "utf8"),
          contentType: requireValue(row.contentType),
        },
      ],
    });
    await db
      .update(standardReportRuns)
      .set({
        deliveryStatus: "accepted",
        emailReceiptId: receipt.id,
        emailAcceptedAt: receipt.acceptedAt,
        errorMessage: null,
      })
      .where(
        and(
          eq(standardReportRuns.id, id),
          eq(standardReportRuns.deliveryStatus, "sending")
        )
      );
  } catch {
    // A network timeout can happen after provider acceptance. Never automatically resend an ambiguous email.
    await db
      .update(standardReportRuns)
      .set({
        deliveryStatus: "unknown",
        errorMessage:
          "Email provider acceptance could not be confirmed. Review the provider before sending again; the dashboard output is available.",
      })
      .where(
        and(
          eq(standardReportRuns.id, id),
          eq(standardReportRuns.deliveryStatus, "sending")
        )
      );
  }
}

/** Recover delivery metadata independently of the next schedule due date. */
async function recoverStandardReportDeliveries(now: Date) {
  const db = await reportDb();
  await db
    .update(standardReportRuns)
    .set({
      deliveryStatus: "unknown",
      errorMessage:
        "Email acceptance is unknown after an interrupted attempt. Review the provider receipt before sending again.",
    })
    .where(
      and(
        eq(standardReportRuns.status, "ready"),
        eq(standardReportRuns.deliveryStatus, "sending"),
        or(
          isNull(standardReportRuns.deliveryStartedAt),
          lte(
            standardReportRuns.deliveryStartedAt,
            new Date(now.getTime() - LEASE_MS)
          )
        )
      )
    );
  const pending = await db
    .select({
      id: standardReportRuns.id,
      createdBy: standardReportRuns.createdBy,
      tenantId: standardReportRuns.tenantId,
      reportId: standardReportRuns.reportId,
    })
    .from(standardReportRuns)
    .where(
      and(
        eq(standardReportRuns.status, "ready"),
        eq(standardReportRuns.deliveryStatus, "pending")
      )
    )
    .orderBy(asc(standardReportRuns.id))
    .limit(100);
  for (const run of pending) {
    const [owner] = await db
      .select({
        id: users.id,
        role: users.role,
        tenantId: users.tenantId,
        email: users.email,
      })
      .from(users)
      .where(eq(users.id, run.createdBy))
      .limit(1);
    try {
      if (
        !owner ||
        (!isAdmin(owner.role) &&
          (owner.tenantId === null || !(await isTenantActive(owner.tenantId))))
      )
        throw new TRPCError({
          code: "FORBIDDEN",
          message:
            "The report owner is no longer authorized for email delivery",
        });
      assertSavedScope(
        run.tenantId,
        actorTenant(owner, owner.tenantId, run.reportId)
      );
    } catch (error) {
      if (
        !(error instanceof TRPCError) ||
        !["FORBIDDEN", "NOT_FOUND"].includes(error.code)
      )
        throw error;
      await db
        .update(standardReportRuns)
        .set({
          deliveryStatus: "failed",
          errorMessage:
            "The report owner is no longer authorized for email delivery.",
        })
        .where(
          and(
            eq(standardReportRuns.id, run.id),
            eq(standardReportRuns.deliveryStatus, "pending")
          )
        );
      continue;
    }
    await deliverStandardReportRun(
      run.id,
      requireValue(owner),
      requireValue(owner).tenantId
    );
  }
}

/** Invoked under the worker's durable cross-process scheduler lease. */
export async function processStandardReportSchedules(now = new Date()) {
  const db = await reportDb();
  await recoverStandardReportDeliveries(now);
  const due = await db
    .select()
    .from(standardReportTemplates)
    .where(
      and(
        eq(standardReportTemplates.enabled, true),
        lte(standardReportTemplates.nextRunAt, now)
      )
    )
    .orderBy(
      asc(standardReportTemplates.nextRunAt),
      asc(standardReportTemplates.id)
    )
    .limit(100);
  for (const template of due) {
    if (!template.nextRunAt) continue;
    try {
      const [owner] = await db
        .select({
          id: users.id,
          role: users.role,
          tenantId: users.tenantId,
          email: users.email,
        })
        .from(users)
        .where(eq(users.id, template.createdBy))
        .limit(1);
      if (!owner)
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Report owner no longer exists",
        });
      if (
        !isAdmin(owner.role) &&
        (owner.tenantId === null || !(await isTenantActive(owner.tenantId)))
      )
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Report owner tenant is not active",
        });
      const result = await runStandardReportTemplate(
        owner,
        owner.tenantId,
        template.id,
        "scheduled",
        template.nextRunAt
      );
      if (result.status === "generating") continue;
      await db
        .update(standardReportTemplates)
        .set({
          nextRunAt: nextStandardReportRun(
            template.cadence,
            template.hourUtc,
            template.minuteUtc,
            now,
            template.nextRunAt
          ),
        })
        .where(
          and(
            eq(standardReportTemplates.id, template.id),
            eq(standardReportTemplates.nextRunAt, template.nextRunAt)
          )
        );
    } catch (error) {
      if (
        error instanceof TRPCError &&
        ["FORBIDDEN", "PRECONDITION_FAILED"].includes(error.code)
      ) {
        await db
          .update(standardReportTemplates)
          .set({ enabled: false, nextRunAt: null })
          .where(
            and(
              eq(standardReportTemplates.id, template.id),
              eq(standardReportTemplates.nextRunAt, template.nextRunAt)
            )
          );
      } else if (!(error instanceof TRPCError && error.code === "CONFLICT"))
        throw error;
    }
  }
}
