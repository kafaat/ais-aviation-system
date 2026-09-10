import { z } from "zod";
import { adminProcedure, router } from "../_core/trpc";
import * as tenants from "../services/tenant.service";
const status = z.enum(["active", "suspended", "pending"]);
const tenant = z.object({
  id: z.number().int(),
  slug: z.string(),
  name: z.string(),
  airlineCode: z.string().nullable(),
  status,
  contactEmail: z.string().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export const tenantsRouter = router({
  list: adminProcedure
    .output(z.array(tenant))
    .query(() => tenants.listTenants()),
  create: adminProcedure
    .input(
      z.object({
        slug: z.string().regex(/^[a-z0-9-]{2,100}$/),
        name: z.string().min(1).max(255),
        airlineCode: z.string().max(3).optional(),
        contactEmail: z.string().email().optional(),
      })
    )
    .output(tenant)
    .mutation(({ input }) =>
      tenants.createTenant({ ...input, status: "pending" })
    ),
  setStatus: adminProcedure
    .input(z.object({ tenantId: z.number().int().positive(), status }))
    .output(tenant)
    .mutation(({ input, ctx }) =>
      tenants.setTenantStatus(input.tenantId, input.status, ctx.user.id)
    ),
  assignUser: adminProcedure
    .input(
      z.object({
        userId: z.number().int().positive(),
        tenantId: z.number().int().positive(),
      })
    )
    .output(z.object({ userId: z.number().int(), tenantId: z.number().int() }))
    .mutation(({ input, ctx }) =>
      tenants.assignUserTenant(input.userId, input.tenantId, ctx.user.id)
    ),
});
