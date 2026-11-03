import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import type { TrpcContext } from "../_core/context";
import {
  agentPortalAgency,
  agentPortalBookingInput,
  agentPortalDashboard,
  agentPortalDashboardInput,
  agentPortalFlight,
  agentPortalSearchInput,
} from "../contracts/agent-portal";
import {
  createSessionAgencyBooking,
  getSessionAgencyDashboard,
  listSessionAgencies,
  searchSessionAgencyFlights,
} from "../services/agent-portal.service";

function actor(ctx: TrpcContext) {
  if (!ctx.user || ctx.user.tenantId !== ctx.tenantId)
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Valid account context required",
    });
  return { userId: ctx.user.id, tenantId: ctx.tenantId };
}

const sessionProcedure = protectedProcedure.use(({ ctx, next }) => {
  ctx.res?.setHeader?.("Cache-Control", "no-store, private");
  return next();
});

export const agentPortalRouter = router({
  agencies: sessionProcedure
    .output(z.array(agentPortalAgency))
    .query(({ ctx }) => listSessionAgencies(actor(ctx))),
  search: sessionProcedure
    .input(agentPortalSearchInput)
    .output(z.array(agentPortalFlight))
    .mutation(({ ctx, input }) =>
      searchSessionAgencyFlights(actor(ctx), input)
    ),
  dashboard: sessionProcedure
    .input(agentPortalDashboardInput)
    .output(agentPortalDashboard)
    .query(({ ctx, input }) =>
      getSessionAgencyDashboard(actor(ctx), input.agencyId, input.page)
    ),
  createBooking: sessionProcedure
    .input(agentPortalBookingInput)
    .output(
      z
        .object({
          bookingId: z.number().int().positive(),
          bookingReference: z.string(),
          commission: z.number().int(),
        })
        .strict()
    )
    .mutation(({ ctx, input }) =>
      createSessionAgencyBooking(actor(ctx), input)
    ),
});
