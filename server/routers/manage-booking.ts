import { createHmac } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { ENV } from "../_core/env";
import { publicProcedure, router } from "../_core/trpc";
import {
  publicBookingLookupInput,
  publicBookingLookupResult,
} from "../contracts/manage-booking";
import { lookupPublicBooking } from "../services/manage-booking.service";
import { rateLimitService } from "../services/rate-limit.service";

export const manageBookingRouter = router({
  lookup: publicProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/manage-booking/lookup",
        tags: ["Bookings"],
        summary:
          "Read a limited itinerary using a booking reference and surname",
        description:
          "Returns only itinerary and booking status in the deployment's public tenant scope. Account ownership is still required for changes, payments and private booking data.",
      },
    })
    .input(publicBookingLookupInput)
    .output(publicBookingLookupResult)
    .mutation(async ({ input, ctx }) => {
      ctx.res?.setHeader("Cache-Control", "no-store, private");
      ctx.res?.setHeader("Pragma", "no-cache");
      // The procedure middleware applies an IP quota, including every member
      // of a batch. This second quota cannot be reset by changing the surname,
      // IP address or account. Never put the raw reference into cache keys.
      const referenceKey = createHmac("sha256", ENV.cookieSecret)
        .update(input.bookingReference)
        .digest("hex");
      const limit = await rateLimitService.checkStrictRateLimit(
        `reference:${referenceKey}`,
        "manageBookingReference"
      );
      for (const [key, value] of Object.entries(
        rateLimitService.getRateLimitHeaders(limit)
      ))
        ctx.res?.setHeader(key, value);
      if (!limit.allowed)
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: "Too many attempts. Please try again later.",
        });
      return lookupPublicBooking(input, ctx.user);
    }),
});
