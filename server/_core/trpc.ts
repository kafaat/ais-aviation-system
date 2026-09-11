import { NOT_ADMIN_ERR_MSG, UNAUTHED_ERR_MSG } from "@shared/const";
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { OpenApiMeta } from "trpc-to-openapi";
import type { TrpcContext } from "./context";
import { isAdmin } from "../services/rbac.service";
import { enforceProcedureRateLimit } from "./middleware/procedure-rate-limit";

/**
 * Initialize tRPC with OpenAPI metadata support
 *
 * The meta object allows attaching OpenAPI documentation to each procedure:
 * - openapi.method: HTTP method (GET, POST, PUT, DELETE, PATCH)
 * - openapi.path: REST path for the endpoint
 * - openapi.summary: Short description shown in Swagger UI
 * - openapi.description: Detailed description for documentation
 * - openapi.tags: Array of tags for grouping endpoints
 * - openapi.protect: Whether the endpoint requires authentication
 */
const t = initTRPC.context<TrpcContext>().meta<OpenApiMeta>().create({
  transformer: superjson,
});

export const router = t.router;
export const publicProcedure = t.procedure
  .meta({ restPublic: true })
  .use(async ({ ctx, path, type, next }) => {
    await enforceProcedureRateLimit(ctx, path, type);
    return next();
  });

const requireUser = t.middleware(opts => {
  const { ctx, next } = opts;

  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }

  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
    },
  });
});

export const protectedProcedure = publicProcedure
  .meta({ restPublic: false })
  .use(requireUser);

export const adminProcedure = protectedProcedure.use(
  t.middleware(opts => {
    const { ctx, next } = opts;

    if (!ctx.user || !isAdmin(ctx.user.role)) {
      throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }

    return next({
      ctx: {
        ...ctx,
        user: ctx.user,
      },
    });
  })
);

/** Use only for operations whose queries and writes carry tenant predicates. */
export const airlineAdminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (!isAdmin(ctx.user.role) && ctx.user.role !== "airline_admin") {
    throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
  }
  if (
    !isAdmin(ctx.user.role) &&
    (ctx.user.tenantId == null || ctx.tenantId !== ctx.user.tenantId)
  ) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Valid tenant context required",
    });
  }
  return next({ ctx });
});
