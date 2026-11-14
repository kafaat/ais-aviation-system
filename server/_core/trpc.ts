import { NOT_ADMIN_ERR_MSG, UNAUTHED_ERR_MSG } from "@shared/const";
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { OpenApiMeta } from "trpc-to-openapi";
import type { TrpcContext } from "./context";
import { isAdmin } from "../services/rbac.service";
import {
  recordPrivilegedMutation,
  type PrivilegedScope,
} from "./middleware/privileged-audit";
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

type AuthenticatedContext = TrpcContext & {
  user: NonNullable<TrpcContext["user"]>;
};

const notAdmin = () =>
  new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
const noTenant = () =>
  new TRPCError({
    code: "FORBIDDEN",
    message: "Valid tenant context required",
  });

/**
 * Privileged builders share one middleware: the role check, then an audit row
 * for every mutation call (refused, failed or succeeded; scenario S-21). The
 * `privileged` meta mark lets the router sweep in
 * server/__tests__/privileged-mutation-audit.test.ts enumerate the surface.
 * Queries pass through the role check only.
 */
function privilegedProcedure(
  scope: PrivilegedScope,
  authorize: (ctx: AuthenticatedContext) => TRPCError | null
) {
  return protectedProcedure
    .meta({ privileged: scope })
    .use(async ({ ctx, path, type, next }) => {
      const started = Date.now();
      const refusal = authorize(ctx);
      if (refusal) {
        if (type === "mutation")
          await recordPrivilegedMutation({
            path,
            scope,
            outcome: "failure",
            ctx,
            durationMs: Date.now() - started,
            error: refusal,
          });
        throw refusal;
      }
      const result = await next({ ctx });
      if (type === "mutation")
        await recordPrivilegedMutation({
          path,
          scope,
          outcome: result.ok ? "success" : "error",
          ctx,
          durationMs: Date.now() - started,
          error: result.ok ? null : result.error,
        });
      return result;
    });
}

export const adminProcedure = privilegedProcedure("admin", ctx =>
  isAdmin(ctx.user.role) ? null : notAdmin()
);

/** Use only for operations whose queries and writes carry tenant predicates. */
export const airlineAdminProcedure = privilegedProcedure(
  "airline_admin",
  ctx => {
    if (!isAdmin(ctx.user.role) && ctx.user.role !== "airline_admin")
      return notAdmin();
    if (
      !isAdmin(ctx.user.role) &&
      (ctx.user.tenantId == null || ctx.tenantId !== ctx.user.tenantId)
    )
      return noTenant();
    return null;
  }
);

/** Scoped role builders are opt-in: apply only where the service carries a
 * tenant predicate through both reads and writes. */
function scopedAirlineProcedure(
  scope: PrivilegedScope,
  roles: readonly string[]
) {
  return privilegedProcedure(scope, ctx => {
    if (!isAdmin(ctx.user.role) && !roles.includes(ctx.user.role))
      return notAdmin();
    if (
      !isAdmin(ctx.user.role) &&
      (ctx.user.tenantId == null || ctx.tenantId !== ctx.user.tenantId)
    )
      return noTenant();
    return null;
  });
}
export const airlineOpsProcedure = scopedAirlineProcedure("ops", [
  "airline_admin",
  "ops",
]);
export const airlineFinanceProcedure = scopedAirlineProcedure("finance", [
  "airline_admin",
  "finance",
]);
