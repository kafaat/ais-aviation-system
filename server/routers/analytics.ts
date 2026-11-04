import { responseContracts } from "../contracts/analytics";
import { z } from "zod";
import { adminProcedure, router } from "../_core/trpc";
import * as analyticsService from "../services/analytics.service";

const periodFields = {
  startDate: z.date().optional(),
  endDate: z.date().optional(),
  allTime: z.boolean().optional(),
};

type PeriodInput = z.infer<z.ZodObject<typeof periodFields>>;

function validPeriod(input: PeriodInput) {
  return (
    !(input.allTime && (input.startDate || input.endDate)) &&
    !(input.startDate && input.endDate && input.startDate > input.endDate)
  );
}

const periodError = {
  message: "Select all time or a valid ordered date range",
};
const periodInput = z.object(periodFields).refine(validPeriod, periodError);
const seriesInput = z
  .object({
    ...periodFields,
    days: z.number().int().min(1).max(365).default(30),
  })
  .refine(validPeriod, periodError);
const rankingInput = z
  .object({
    ...periodFields,
    limit: z.number().int().min(1).max(50).default(10),
  })
  .refine(validPeriod, periodError);

// An explicit empty period is unbounded; undefined retains legacy series defaults.
function requestedPeriod(
  input?: PeriodInput
): analyticsService.AnalyticsPeriod | undefined {
  if (input?.allTime) return {};
  if (input?.startDate || input?.endDate)
    return { startDate: input.startDate, endDate: input.endDate };
  return undefined;
}

/**
 * Analytics Router
 * Admin-only endpoints for business intelligence and reporting
 */
export const analyticsRouter = router({
  /**
   * Get overall KPI metrics
   */
  getKPIs: adminProcedure
    .input(periodInput.optional())
    .output(responseContracts["getKPIs"])
    .query(async ({ input }) => {
      return await analyticsService.getKPIMetrics(
        input?.startDate,
        input?.endDate
      );
    }),

  /**
   * Get revenue over time (daily breakdown)
   */
  getRevenueOverTime: adminProcedure
    .input(seriesInput.optional())
    .output(responseContracts["getRevenueOverTime"])
    .query(async ({ input }) => {
      return await analyticsService.getRevenueOverTime(
        input?.days ?? 30,
        requestedPeriod(input)
      );
    }),

  /**
   * Get most popular destinations
   */
  getPopularDestinations: adminProcedure
    .input(rankingInput.optional())
    .output(responseContracts["getPopularDestinations"])
    .query(async ({ input }) => {
      return await analyticsService.getPopularDestinations(
        input?.limit ?? 10,
        requestedPeriod(input)
      );
    }),

  /**
   * Get booking trends over time
   */
  getBookingTrends: adminProcedure
    .input(seriesInput.optional())
    .output(responseContracts["getBookingTrends"])
    .query(async ({ input }) => {
      return await analyticsService.getBookingTrends(
        input?.days ?? 30,
        requestedPeriod(input)
      );
    }),

  /**
   * Get flight occupancy details
   */
  getFlightOccupancy: adminProcedure
    .output(responseContracts["getFlightOccupancy"])
    .query(async () => {
      return await analyticsService.getFlightOccupancyDetails();
    }),

  /**
   * Get ancillary services KPI metrics
   */
  getAncillaryMetrics: adminProcedure
    .input(periodInput.optional())
    .output(responseContracts["getAncillaryMetrics"])
    .query(async ({ input }) => {
      return await analyticsService.getAncillaryMetrics(
        input?.startDate,
        input?.endDate
      );
    }),

  /**
   * Get ancillary revenue breakdown by category
   */
  getAncillaryRevenueByCategory: adminProcedure
    .input(periodInput.optional())
    .output(responseContracts["getAncillaryRevenueByCategory"])
    .query(async ({ input }) => {
      return await analyticsService.getAncillaryRevenueByCategory(
        requestedPeriod(input)
      );
    }),

  /**
   * Get most popular ancillary services
   */
  getPopularAncillaries: adminProcedure
    .input(rankingInput.optional())
    .output(responseContracts["getPopularAncillaries"])
    .query(async ({ input }) => {
      return await analyticsService.getPopularAncillaries(
        input?.limit ?? 10,
        requestedPeriod(input)
      );
    }),
});
