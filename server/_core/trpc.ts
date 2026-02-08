import { NOT_ADMIN_ERR_MSG, UNAUTHED_ERR_MSG } from "@shared/const";
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { OpenApiMeta } from "trpc-openapi";
import type { TrpcContext } from "./context";
import { isAdmin } from "../services/rbac.service";

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
export const publicProcedure = t.procedure;

const requireUser = t.middleware(async opts => {
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

export const protectedProcedure = t.procedure.use(requireUser);

export const adminProcedure = t.procedure.use(
  t.middleware(async opts => {
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
