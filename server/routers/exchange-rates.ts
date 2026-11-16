/** Operator exchange-rate entry (#319 Wave 1, display path only).
 *
 * `exchange_rates` is deployment-wide reference data with no tenant column:
 * every tenant's display estimate reads the same quotes. Entry is therefore a
 * platform administration command (adminProcedure); a tenant-scoped finance,
 * ops or airline administrator is refused rather than allowed to change what
 * other tenants see. The privileged builder also writes its access audit row.
 */
import { z } from "zod";
import { adminProcedure, router } from "../_core/trpc";
import type { TrpcContext } from "../_core/context";
import {
  OPERATOR_QUOTE_CURRENCIES,
  displayRateAlarmStatus,
  listOperatorExchangeRates,
  operatorRateInput,
  operatorRateRow,
  recordOperatorExchangeRate,
  refreshDisplayRateAlarms,
} from "../services/currency/operator-rates.service";

function requestIdentity(ctx: TrpcContext) {
  const req = ctx.req as
    | { ip?: string; id?: unknown; headers?: Record<string, unknown> }
    | undefined;
  const header = req?.headers?.["x-request-id"];
  const requestId =
    typeof req?.id === "string"
      ? req.id
      : typeof header === "string"
        ? header
        : undefined;
  return { requestId: requestId?.slice(0, 64), sourceIp: req?.ip };
}

export const exchangeRatesRouter = router({
  /** Record a quote, or a correction naming the quote it supersedes. */
  record: adminProcedure
    .input(operatorRateInput)
    .output(operatorRateRow.extend({ auditEventId: z.string() }))
    .mutation(({ input, ctx }) =>
      recordOperatorExchangeRate(input, {
        userId: ctx.user.id,
        role: ctx.user.role,
        ...requestIdentity(ctx),
      })
    ),

  /** Recorded quotes of one SAR pair, newest first, with their provenance. */
  history: adminProcedure
    .input(
      z.object({
        quoteCurrency: z.enum(OPERATOR_QUOTE_CURRENCIES),
        limit: z.number().int().min(1).max(200).default(50),
      })
    )
    .output(z.array(operatorRateRow))
    .query(({ input }) =>
      listOperatorExchangeRates(input.quoteCurrency, input.limit)
    ),

  /** Re-evaluate the display-rate staleness alarm for every enabled pair. */
  refreshAlarms: adminProcedure
    .output(displayRateAlarmStatus)
    .mutation(() => refreshDisplayRateAlarms()),
});
