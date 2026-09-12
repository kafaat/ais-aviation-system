import { responseContracts } from "../contracts/data-warehouse";
/**
 * Data Warehouse Router
 *
 * Admin-only endpoints for managing data warehouse exports and ETL pipelines.
 * Supports on-demand exports, scheduled exports, and ETL pipeline monitoring.
 */

import { z } from "zod";
import { router, adminProcedure } from "../_core/trpc";
import * as dwService from "../services/data-warehouse.service";

const exportTypeEnum = z.enum([
  "bookings",
  "flights",
  "revenue",
  "customers",
  "operational",
]);

const exportFormatEnum = z.enum(["csv", "json", "jsonl"]);

const exportStatusEnum = z.enum([
  "pending",
  "processing",
  "completed",
  "failed",
]);

const frequencyEnum = z.enum(["daily", "weekly", "monthly"]);

export const dataWarehouseRouter = router({
  /**
   * Trigger a new data warehouse export job.
   */
  createExport: adminProcedure
    .input(
      z.object({
        exportType: exportTypeEnum,
        startDate: z.date(),
        endDate: z.date(),
        format: exportFormatEnum.default("csv"),
        incremental: z.boolean().default(false),
        lastExportTimestamp: z.date().optional(),
      })
    )
    .output(responseContracts["createExport"])
    .mutation(async ({ input, ctx }) => {
      const result = await dwService.createExportJob(
        input.exportType,
        { startDate: input.startDate, endDate: input.endDate },
        input.format,
        ctx.user.id,
        input.incremental,
        input.lastExportTimestamp
      );

      return {
        id: result.id,
        exportType: result.exportType,
        format: result.format,
        status: result.status,
        recordCount: result.recordCount,
        fileSize: result.fileSize,
        filePath: result.filePath,
        createdAt: result.createdAt,
        completedAt: result.completedAt,
        errorMessage: result.errorMessage ?? null,
      };
    }),

  /**
   * List export jobs with pagination and optional filters.
   */
  getExports: adminProcedure
    .input(
      z
        .object({
          page: z.number().min(1).default(1),
          limit: z.number().min(1).max(100).default(20),
          exportType: exportTypeEnum.optional(),
          status: exportStatusEnum.optional(),
        })
        .optional()
    )
    .output(responseContracts["getExports"])
    .query(async ({ input }) => {
      const { exports, total, page, limit } = await dwService.getExportJobs(
        input?.page || 1,
        input?.limit || 20,
        input?.exportType,
        input?.status
      );

      return {
        exports: exports.map(e => ({
          id: e.id,
          exportType: e.exportType,
          dateRangeStart: e.dateRangeStart,
          dateRangeEnd: e.dateRangeEnd,
          format: e.format,
          status: e.status,
          filePath: e.filePath,
          recordCount: e.recordCount,
          fileSize: e.fileSize,
          createdBy: e.createdBy,
          createdAt: e.createdAt,
          completedAt: e.completedAt,
          errorMessage: e.errorMessage ?? null,
        })),
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      };
    }),

  /**
   * Check the status of a specific export job.
   */
  getExportStatus: adminProcedure
    .input(z.object({ id: z.number() }))
    .output(responseContracts["getExportStatus"])
    .query(async ({ input }) => {
      const exportRecord = await dwService.getExportJobById(input.id);

      if (!exportRecord) {
        return { found: false as const };
      }

      return {
        found: true as const,
        id: exportRecord.id,
        exportType: exportRecord.exportType,
        status: exportRecord.status,
        recordCount: exportRecord.recordCount,
        fileSize: exportRecord.fileSize,
        filePath: exportRecord.filePath,
        createdAt: exportRecord.createdAt,
        completedAt: exportRecord.completedAt,
        errorMessage: exportRecord.errorMessage ?? null,
      };
    }),

  /**
   * Get the download URL for a completed export.
   */
  downloadExport: adminProcedure
    .input(z.object({ id: z.number() }))
    .output(responseContracts["downloadExport"])
    .query(async ({ input }) => {
      const downloadUrl = await dwService.getExportDownloadUrl(input.id);
      const exportRecord = await dwService.getExportJobById(input.id);

      return {
        downloadUrl,
        available: downloadUrl !== null,
        exportType: exportRecord?.exportType ?? null,
        format: exportRecord?.format ?? null,
        fileSize: exportRecord?.fileSize ?? 0,
        recordCount: exportRecord?.recordCount ?? 0,
      };
    }),

  /**
   * Create a scheduled export.
   */
  createSchedule: adminProcedure
    .input(
      z.object({
        name: z.string().min(1).max(255),
        exportType: exportTypeEnum,
        frequency: frequencyEnum,
        format: exportFormatEnum.default("csv"),
        config: z.record(z.string(), z.unknown()).optional(),
      })
    )
    .output(responseContracts["createSchedule"])
    .mutation(async ({ input, ctx }) => {
      const schedule = await dwService.createSchedule({
        createdBy: ctx.user.id,
        name: input.name,
        exportType: input.exportType,
        frequency: input.frequency,
        format: input.format,
        config: input.config,
      });

      return {
        id: schedule.id,
        name: schedule.name,
        exportType: schedule.exportType,
        frequency: schedule.frequency,
        format: schedule.format,
        lastRunAt: schedule.lastRunAt,
        nextRunAt: schedule.nextRunAt,
        isActive: schedule.isActive,
        createdAt: schedule.createdAt,
      };
    }),

  /**
   * List all scheduled exports.
   */
  getSchedules: adminProcedure
    .input(
      z
        .object({
          activeOnly: z.boolean().default(false),
        })
        .optional()
    )
    .output(responseContracts["getSchedules"])
    .query(async ({ input }) => {
      const schedules = await dwService.getSchedules(
        input?.activeOnly || false
      );

      return schedules.map(s => ({
        id: s.id,
        name: s.name,
        exportType: s.exportType,
        frequency: s.frequency,
        format: s.format,
        lastRunAt: s.lastRunAt,
        nextRunAt: s.nextRunAt,
        isActive: s.isActive,
        config: s.config,
        createdAt: s.createdAt,
      }));
    }),

  /**
   * Update a scheduled export.
   */
  updateSchedule: adminProcedure
    .input(
      z.object({
        id: z.number(),
        name: z.string().min(1).max(255).optional(),
        frequency: frequencyEnum.optional(),
        format: exportFormatEnum.optional(),
        isActive: z.boolean().optional(),
        config: z.record(z.string(), z.unknown()).optional(),
      })
    )
    .output(responseContracts["updateSchedule"])
    .mutation(async ({ input }) => {
      const { id, ...updates } = input;
      const schedule = await dwService.updateSchedule(id, updates);

      if (!schedule) {
        return { success: false as const, message: "Schedule not found" };
      }

      return {
        success: true as const,
        schedule: {
          id: schedule.id,
          name: schedule.name,
          exportType: schedule.exportType,
          frequency: schedule.frequency,
          format: schedule.format,
          lastRunAt: schedule.lastRunAt,
          nextRunAt: schedule.nextRunAt,
          isActive: schedule.isActive,
          createdAt: schedule.createdAt,
        },
      };
    }),

  /**
   * Delete a scheduled export.
   */
  deleteSchedule: adminProcedure
    .input(z.object({ id: z.number() }))
    .output(responseContracts["deleteSchedule"])
    .mutation(async ({ input }) => {
      const deleted = await dwService.deleteSchedule(input.id);
      return {
        success: deleted,
        message: deleted
          ? "Schedule deleted successfully"
          : "Schedule not found",
      };
    }),

  /**
   * Get overall ETL pipeline health and status.
   */
  getETLStatus: adminProcedure
    .output(responseContracts["getETLStatus"])
    .query(() => {
      return dwService.getETLPipelineStatus();
    }),
});
