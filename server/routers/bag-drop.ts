import { responseContracts } from "../contracts/bag-drop";
import { z } from "zod";
import { publicProcedure, adminProcedure, router } from "../_core/trpc";
import * as bagDropService from "../services/bag-drop.service";
import { TRPCError } from "@trpc/server";
import { verifyBoardingPass } from "../services/boarding-pass.service";
import {
  issueSelfServiceCapability,
  verifySelfServiceCapability,
} from "../services/self-service-capability.service";

const capabilityInput = z.string().min(32).max(4096);

function bagSession(token: string) {
  return verifySelfServiceCapability(token, "bag-drop-session");
}

export const bagDropRouter = router({
  registerUnit: adminProcedure
    .input(
      z.object({
        unitCode: z.string().min(1).max(50),
        airportId: z.number().int().positive(),
        terminal: z.string().max(50),
        zone: z.string().max(50),
        hasPrinter: z.boolean().optional(),
        hasScale: z.boolean().optional(),
        hasPayment: z.boolean().optional(),
        beltConnected: z.boolean().optional(),
      })
    )
    .output(responseContracts["registerUnit"])
    .mutation(({ input }) => bagDropService.registerBagDropUnit(input)),
  /**
   * Verify a cryptographically signed boarding pass and issue a short-lived
   * admission capability. Raw booking/passenger identifiers are never accepted
   * as authority for self-service bag drop.
   */
  scanPass: publicProcedure
    .input(z.object({ boardingPassToken: z.string().min(32).max(8192) }))
    .output(responseContracts["scanPass"])
    .mutation(async ({ input }) => {
      const verified = verifyBoardingPass(input.boardingPassToken);
      if (!verified.valid) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: verified.reason });
      }
      const capabilityToken = issueSelfServiceCapability({
        kind: "bag-drop-admission",
        bookingId: verified.data.bookingId,
        passengerId: verified.data.passengerId,
      });
      return {
        success: true,
        bookingId: verified.data.bookingId,
        passengerId: verified.data.passengerId,
        passengerName: verified.data.passengerName,
        flightNumber: verified.data.flightNumber,
        cabinClass: verified.data.cabinClass,
        capabilityToken,
      };
    }),

  initiate: publicProcedure
    .input(z.object({ capabilityToken: capabilityInput }))
    .output(responseContracts["initiate"])
    .mutation(async ({ input }) => {
      const admission = verifySelfServiceCapability(
        input.capabilityToken,
        "bag-drop-admission"
      );
      const session = await bagDropService.initiateBagDrop(
        admission.bookingId,
        admission.passengerId
      );
      const sessionToken = issueSelfServiceCapability({
        kind: "bag-drop-session",
        bookingId: admission.bookingId,
        passengerId: admission.passengerId,
        sessionId: session.id,
      });
      return { success: true, session, sessionToken };
    }),

  weighBag: publicProcedure
    .input(
      z.object({
        sessionToken: capabilityInput,
        weight: z.number().int().positive(),
        bagNumber: z.number().int().min(1).max(10).optional(),
      })
    )
    .output(responseContracts["weighBag"])
    .mutation(async ({ input }) => {
      const capability = bagSession(input.sessionToken);
      const result = await bagDropService.weighBag(
        capability.sessionId,
        input.weight,
        input.bagNumber
      );
      return { success: true, ...result };
    }),

  checkAllowance: publicProcedure
    .input(z.object({ sessionToken: capabilityInput }))
    .output(responseContracts["checkAllowance"])
    .query(async ({ input }) => {
      const capability = bagSession(input.sessionToken);
      return bagDropService.checkBagAllowance(
        capability.bookingId,
        capability.passengerId
      );
    }),

  calculateFee: publicProcedure
    .input(
      z.object({
        sessionToken: capabilityInput,
        totalWeight: z.number().int().positive(),
      })
    )
    .output(responseContracts["calculateFee"])
    .query(async ({ input }) => {
      const capability = bagSession(input.sessionToken);
      return bagDropService.calculateExcessFee(
        capability.bookingId,
        input.totalWeight
      );
    }),

  /**
   * Fail closed until an authenticated PSP/device callback exists. A browser or
   * kiosk must never be able to mark an excess-baggage charge as paid merely by
   * supplying an amount.
   */
  processPayment: publicProcedure
    .input(z.object({ sessionToken: capabilityInput }))
    .output(responseContracts["processPayment"])
    .mutation(async ({ input }) => {
      bagSession(input.sessionToken);
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message:
          "Self-service excess-baggage payment settlement is disabled until a verified payment-provider callback is integrated",
      });
    }),

  printTag: publicProcedure
    .input(
      z.object({
        sessionToken: capabilityInput,
        bagNumber: z.number().int().positive(),
      })
    )
    .output(responseContracts["printTag"])
    .mutation(async ({ input }) => {
      const capability = bagSession(input.sessionToken);
      const tag = await bagDropService.printBagTag(
        capability.sessionId,
        input.bagNumber
      );
      return { success: true, tag };
    }),

  confirm: publicProcedure
    .input(z.object({ sessionToken: capabilityInput }))
    .output(responseContracts["confirm"])
    .mutation(async ({ input }) => {
      const capability = bagSession(input.sessionToken);
      const result = await bagDropService.confirmBagDrop(capability.sessionId);
      return { success: true, ...result };
    }),

  getUnits: adminProcedure
    .input(
      z.object({ airportId: z.number().int().positive().optional() }).optional()
    )
    .output(responseContracts["getUnits"])
    .query(async ({ input }) => ({
      units: await bagDropService.getAllBagDropUnits(input?.airportId),
    })),

  getUnitStatus: adminProcedure
    .input(z.object({ unitId: z.number().int().positive() }))
    .output(responseContracts["getUnitStatus"])
    .query(async ({ input }) => bagDropService.getBagDropStatus(input.unitId)),

  getAnalytics: adminProcedure
    .input(
      z.object({
        airportId: z.number().int().positive(),
        startDate: z.string().datetime(),
        endDate: z.string().datetime(),
      })
    )
    .output(responseContracts["getAnalytics"])
    .query(async ({ input }) =>
      bagDropService.getBagDropAnalytics(input.airportId, {
        start: new Date(input.startDate),
        end: new Date(input.endDate),
      })
    ),
});
