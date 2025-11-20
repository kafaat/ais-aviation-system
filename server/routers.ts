import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";

// Import domain routers
import { flightsRouter } from "./routers/flights";
import { bookingsRouter } from "./routers/bookings";
import { paymentsRouter } from "./routers/payments";
import { adminRouter } from "./routers/admin";
import { analyticsRouter } from "./routers/analytics";
import { referenceRouter } from "./routers/reference";

/**
 * Main Application Router
 * Combines all domain routers into a single API
 */
export const appRouter = router({
  // System router (AI, notifications, etc.)
  system: systemRouter,

  // Authentication routes
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),

  // Domain routers
  flights: flightsRouter,
  bookings: bookingsRouter,
  payments: paymentsRouter,
  admin: adminRouter,
  analytics: analyticsRouter,
  reference: referenceRouter,
});

export type AppRouter = typeof appRouter;
