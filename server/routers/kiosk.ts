import { responseContracts } from "../contracts/kiosk";
/** Self-Service Kiosk Router */

import { z } from "zod";
import { publicProcedure, adminProcedure, router } from "../_core/trpc";
import * as kioskService from "../services/kiosk.service";
import {
  assertPassengerInKioskCapability,
  issueSelfServiceCapability,
  verifySelfServiceCapability,
} from "../services/self-service-capability.service";

const capabilityInput = z.string().min(32).max(4096);

function kioskCapability(token: string) {
  return verifySelfServiceCapability(token, "kiosk-session");
}

export const kioskRouter = router({
  authenticate: publicProcedure
    .input(
      z.object({
        bookingRef: z.string().min(1).max(6),
        lastName: z.string().min(1).max(100),
      })
    )
    .output(responseContracts["authenticate"])
    .mutation(async ({ input }) => {
      const result = await kioskService.authenticatePassenger(
        input.bookingRef,
        input.lastName
      );
      const capabilityToken = issueSelfServiceCapability({
        kind: "kiosk-session",
        bookingId: result.bookingId,
        sessionId: result.sessionId,
        passengerIds: result.passengers.map(passenger => passenger.id),
      });
      return { ...result, capabilityToken };
    }),

  getCheckInData: publicProcedure
    .input(z.object({ capabilityToken: capabilityInput }))
    .output(responseContracts["getCheckInData"])
    .query(async ({ input }) => {
      const capability = kioskCapability(input.capabilityToken);
      return await kioskService.getCheckInData(capability.bookingId);
    }),

  checkIn: publicProcedure
    .input(
      z.object({
        capabilityToken: capabilityInput,
        passengerId: z.number().positive(),
        seatNumber: z.string().max(5).optional(),
        baggageCount: z.number().nonnegative().optional(),
      })
    )
    .output(responseContracts["checkIn"])
    .mutation(async ({ input }) => {
      const capability = kioskCapability(input.capabilityToken);
      assertPassengerInKioskCapability(capability, input.passengerId);
      return await kioskService.performCheckIn(
        capability.bookingId,
        input.passengerId,
        { seatNumber: input.seatNumber, baggageCount: input.baggageCount }
      );
    }),

  selectSeat: publicProcedure
    .input(
      z.object({
        capabilityToken: capabilityInput,
        passengerId: z.number().positive(),
        seatNumber: z.string().min(1).max(5),
      })
    )
    .output(responseContracts["selectSeat"])
    .mutation(async ({ input }) => {
      const capability = kioskCapability(input.capabilityToken);
      assertPassengerInKioskCapability(capability, input.passengerId);
      return await kioskService.selectSeat(
        capability.bookingId,
        input.passengerId,
        input.seatNumber
      );
    }),

  printBoardingPass: publicProcedure
    .input(
      z.object({
        capabilityToken: capabilityInput,
        passengerId: z.number().positive(),
      })
    )
    .output(responseContracts["printBoardingPass"])
    .mutation(async ({ input }) => {
      const capability = kioskCapability(input.capabilityToken);
      assertPassengerInKioskCapability(capability, input.passengerId);
      return await kioskService.printBoardingPass(
        capability.bookingId,
        input.passengerId
      );
    }),

  printBagTag: publicProcedure
    .input(
      z.object({
        capabilityToken: capabilityInput,
        passengerId: z.number().positive(),
        bagCount: z.number().min(1).max(10),
      })
    )
    .output(responseContracts["printBagTag"])
    .mutation(async ({ input }) => {
      const capability = kioskCapability(input.capabilityToken);
      assertPassengerInKioskCapability(capability, input.passengerId);
      return await kioskService.printBagTag(
        capability.bookingId,
        input.passengerId,
        input.bagCount
      );
    }),

  addAncillary: publicProcedure
    .input(
      z.object({
        capabilityToken: capabilityInput,
        serviceType: z.string().min(1).max(50),
        passengerId: z.number().positive(),
      })
    )
    .output(responseContracts["addAncillary"])
    .mutation(async ({ input }) => {
      const capability = kioskCapability(input.capabilityToken);
      assertPassengerInKioskCapability(capability, input.passengerId);
      return await kioskService.addAncillary(
        capability.bookingId,
        input.serviceType,
        input.passengerId
      );
    }),

  getDevices: adminProcedure
    .input(
      z
        .object({
          airportId: z.number().optional(),
          status: z.enum(["online", "offline", "maintenance"]).optional(),
        })
        .optional()
    )
    .output(responseContracts["getDevices"])
    .query(async ({ input }) =>
      kioskService.getKioskDevices(input ?? undefined)
    ),

  registerDevice: adminProcedure
    .input(
      z.object({
        airportId: z.number().positive(),
        terminal: z.string().min(1).max(50),
        location: z.string().min(1).max(255),
        hardwareType: z.string().max(100).optional(),
        hasPrinter: z.boolean().optional(),
        hasScanner: z.boolean().optional(),
        hasPayment: z.boolean().optional(),
      })
    )
    .output(responseContracts["registerDevice"])
    .mutation(async ({ input }) =>
      kioskService.registerKiosk(
        input.airportId,
        input.terminal,
        input.location,
        {
          hardwareType: input.hardwareType,
          hasPrinter: input.hasPrinter,
          hasScanner: input.hasScanner,
          hasPayment: input.hasPayment,
        }
      )
    ),

  getAnalytics: adminProcedure
    .input(
      z.object({
        airportId: z.number().positive(),
        from: z.date(),
        to: z.date(),
      })
    )
    .output(responseContracts["getAnalytics"])
    .query(async ({ input }) =>
      kioskService.getKioskAnalytics(input.airportId, {
        from: input.from,
        to: input.to,
      })
    ),

  getDeviceStatus: adminProcedure
    .input(z.object({ kioskId: z.number().positive() }))
    .output(responseContracts["getDeviceStatus"])
    .query(async ({ input }) => kioskService.getKioskStatus(input.kioskId)),
});
