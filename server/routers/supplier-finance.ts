import { airlineFinanceProcedure, router } from "../_core/trpc";
import {
  readSupplierState,
  recordSupplierDecision,
  supplierQuery,
  supplierState,
  supplierCommand,
  supplierReceipt,
} from "../services/supplier-finance.service";
export const supplierFinanceRouter = router({
  review: airlineFinanceProcedure
    .input(supplierQuery)
    .output(supplierState)
    .query(({ input, ctx }) =>
      readSupplierState(input, ctx.tenantId, ctx.user.id)
    ),
  record: airlineFinanceProcedure
    .input(supplierCommand)
    .output(supplierReceipt)
    .mutation(({ input, ctx }) =>
      recordSupplierDecision(input, ctx.tenantId, ctx.user.id)
    ),
});
