import { z } from "zod";
import { eq } from "drizzle-orm";
import { adminProcedure, airlineFinanceProcedure, router } from "../_core/trpc";
import { responseContracts } from "../contracts/tax-invoices";
import { requireValue } from "../services/required-value";
import { isAdmin } from "../services/rbac.service";
import {
  getTaxInvoice,
  listTaxInvoices,
  resolveZatcaSeller,
  submitTaxInvoice,
  verifyInvoiceChain,
} from "../services/tax-invoice.service";
import {
  listFareComponents,
  sumComponents,
  vatOfComponents,
} from "../services/fare-components.service";
import { getDb } from "../db";
import { bookings } from "../../drizzle/schema";

/**
 * Tax Invoices Router
 * Finance/admin reads of locally generated ZATCA simplified documents and the
 * fare component ledger behind them. Submission goes through the Fatoora
 * adapter, which is a mock until the operator completes CSID onboarding.
 */
const present = <T extends { currency: string }>(row: T) => {
  if (row.currency !== "SAR")
    throw new Error("Tax documents are issued in SAR");
  return {
    ...row,
    currency: "SAR" as const,
    amountUnit: "minor" as const,
    reporting:
      "local_record_fatoora_submission_requires_operator_csid" as const,
  };
};
const tenantScope = (ctx: {
  user: { role: string };
  tenantId: number | null;
}) => (isAdmin(ctx.user.role) ? undefined : requireValue(ctx.tenantId));

export const taxInvoicesRouter = router({
  list: airlineFinanceProcedure
    .input(
      z
        .object({
          bookingId: z.number().int().positive().optional(),
          status: z
            .enum(["generated", "reported", "cleared", "failed"])
            .optional(),
          limit: z.number().int().min(1).max(200).optional(),
        })
        .optional()
    )
    .output(responseContracts.list)
    .query(async ({ input, ctx }) =>
      (
        await listTaxInvoices({ ...(input ?? {}), tenantId: tenantScope(ctx) })
      ).map(present)
    ),
  get: airlineFinanceProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .output(responseContracts.get)
    .query(async ({ input, ctx }) => {
      const row = await getTaxInvoice(input.id, tenantScope(ctx));
      return row ? present(row) : null;
    }),
  verifyChain: adminProcedure
    .input(z.object({ issuingUnit: z.string().min(1).max(64) }))
    .output(responseContracts.verifyChain)
    .query(({ input }) => {
      const db = getDb();
      if (!db) throw new Error("Database unavailable");
      return verifyInvoiceChain(db, input.issuingUnit);
    }),
  sellerConfiguration: adminProcedure
    .output(responseContracts.sellerConfiguration)
    .query(() => {
      const seller = resolveZatcaSeller();
      return seller.configured
        ? { configured: true, issuingUnit: seller.issuingUnit, reason: null }
        : { configured: false, issuingUnit: null, reason: seller.reason };
    }),
  /** Mock adapter: records that reporting needs operator credentials. */
  submit: adminProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .output(responseContracts.submit)
    .mutation(({ input }) => submitTaxInvoice(input.id)),
  fareComponents: airlineFinanceProcedure
    .input(z.object({ bookingId: z.number().int().positive() }))
    .output(responseContracts.fareComponents)
    .query(async ({ input, ctx }) => {
      const db = getDb();
      if (!db) throw new Error("Database unavailable");
      const scope = tenantScope(ctx);
      const [booking] = await db
        .select({ id: bookings.id, tenantId: bookings.tenantId })
        .from(bookings)
        .where(eq(bookings.id, input.bookingId))
        .limit(1);
      if (!booking || (scope != null && booking.tenantId !== scope))
        throw new Error("Booking not found");
      const components = await listFareComponents(db, input.bookingId);
      return {
        bookingId: input.bookingId,
        total: sumComponents(components),
        vat: vatOfComponents(components),
        currency: "SAR" as const,
        amountUnit: "minor" as const,
        components,
      };
    }),
});
