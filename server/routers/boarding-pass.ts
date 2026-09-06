import { z } from "zod";
import { publicProcedure, protectedProcedure, router } from "../_core/trpc";
import {
  issueBoardingPass,
  verifyBoardingPass,
} from "../services/boarding-pass.service";

/**
 * Boarding Pass Router
 * - issue: passenger obtains a signed, tamper-proof boarding pass (auth + ownership).
 * - verify: gate scanner validates a pass offline (public; pure crypto, no data
 *   beyond what is already printed on the pass).
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
          "Issue a cryptographically signed, offline-verifiable boarding pass token for a passenger on one of the caller's paid bookings.",
        protect: true,
      },
    })
    .input(
      z.object({
        bookingId: z.number().int().positive(),
        passengerId: z.number().int().positive(),
      })
    )
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
          "Verify a boarding-pass token's signature and expiry (offline-capable, for gate scanners). Returns validity and the decoded boarding details.",
      },
    })
    .input(z.object({ token: z.string().min(1) }))
    .query(({ input }) => {
      return verifyBoardingPass(input.token);
    }),
});
