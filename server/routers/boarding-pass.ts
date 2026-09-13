import { responseContracts } from "../contracts/boarding-pass";
import { z } from "zod";
import { publicProcedure, protectedProcedure, router } from "../_core/trpc";
import {
  issueBoardingPass,
  verifyActiveBoardingPass,
} from "../services/boarding-pass.service";

/**
 * Boarding Pass Router
 * - issue: passenger obtains a signed, tamper-proof boarding pass (auth + ownership).
 * - verify: validates the signature and current passenger/flight eligibility online.
 */
export const boardingPassRouter = router({
  issue: protectedProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/boarding-pass/issue",
        tags: ["Boarding Pass"],
        summary: "Issue a signed boarding pass",
        description:
          "Issue a cryptographically signed, state-verified boarding pass token for a passenger on one of the caller's checked-in, active paid reservations.",
        protect: true,
      },
    })
    .input(
      z.object({
        bookingId: z.number().int().positive(),
        passengerId: z.number().int().positive(),
        flightId: z.number().int().positive().optional(),
      })
    )
    .output(responseContracts["issue"])
    .mutation(async ({ input, ctx }) => {
      return await issueBoardingPass(input, {
        userId: ctx.user.id,
        role: ctx.user.role,
      });
    }),

  verify: publicProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/boarding-pass/verify",
        tags: ["Boarding Pass"],
        summary: "Verify a boarding pass",
        description:
          "Verify a boarding-pass token's signature, expiry and current eligibility online. Returns validity and the decoded boarding details.",
      },
    })
    .input(z.object({ token: z.string().min(1).max(8192) }))
    .output(responseContracts["verify"])
    .query(({ input }) => {
      return verifyActiveBoardingPass(input.token);
    }),
});
