import { z } from "zod";
import {
  airlineAdminProcedure,
  airlineOpsProcedure,
  router,
} from "../_core/trpc";
import {
  changeDcsFlightInput,
  dcsCheckInInput,
  dcsDesk,
  dcsFlightResult,
  dcsPassengerResult,
  dcsTransitionInput,
  dcsBagReturnGrantInput,
  dcsBagReturnGrantResult,
  dcsBagReturnGrantListInput,
  dcsBagReturnGrantList,
  dcsReturnBagInput,
  dcsReturnBagResult,
} from "../contracts/dcs-operations";
import {
  changeDcsFlightState,
  checkInDcsPassenger,
  getDcsDesk,
  returnDcsBag,
  setBagReturnGrant,
  listBagReturnGrants,
  transitionDcsPassenger,
  type DcsActor,
} from "../services/dcs-operations.service";
import type { TrpcContext } from "../_core/context";

import {
  remapStationSeats,
  downgradeQuote,
  downgradeConfirm,
  downgradeReceipt,
  stationCommand,
  finalizeStation,
  openStationCase,
  resolveStationCase,
  addStationNote,
  eventReceipt,
  blockStationSeats,
  blockedSeatsReceipt,
  stationReport,
} from "../contracts/dcs-station";
import {
  remapDeskSeats,
  quoteDeskDowngrade,
  confirmDeskDowngrade,
  dismissDeskCase,
  finalizeDesk,
  openDeskCase,
  resolveDeskCase,
  addDeskNote,
  getStationReport,
  blockDeskSeats,
} from "../services/dcs-station.service";

function actor(ctx: TrpcContext): DcsActor {
  if (!ctx.user) throw new Error("Authenticated departure operator required");
  return { userId: ctx.user.id, role: ctx.user.role, tenantId: ctx.tenantId };
}
export const dcsOperationsRouter = router({
  dismissCase: airlineOpsProcedure
    .input(stationCommand.extend({ caseId: z.number().int().positive() }))
    .output(eventReceipt)
    .mutation(({ input, ctx }) => dismissDeskCase(input, actor(ctx))),
  quoteDowngrade: airlineOpsProcedure
    .input(downgradeQuote)
    .output(downgradeReceipt)
    .mutation(({ input, ctx }) => quoteDeskDowngrade(input, actor(ctx))),
  confirmDowngrade: airlineOpsProcedure
    .input(downgradeConfirm)
    .output(downgradeReceipt)
    .mutation(({ input, ctx }) => confirmDeskDowngrade(input, actor(ctx))),
  finalize: airlineOpsProcedure
    .input(finalizeStation)
    .output(eventReceipt)
    .mutation(({ input, ctx }) => finalizeDesk(input, actor(ctx))),
  remapSeats: airlineOpsProcedure
    .input(remapStationSeats)
    .output(eventReceipt)
    .mutation(({ input, ctx }) => remapDeskSeats(input, actor(ctx))),
  stationReport: airlineOpsProcedure
    .input(z.object({ flightId: z.number().int().positive() }))
    .output(stationReport)
    .query(({ input, ctx }) => getStationReport(input.flightId, actor(ctx))),
  openCase: airlineOpsProcedure
    .input(openStationCase)
    .output(eventReceipt)
    .mutation(({ input, ctx }) => openDeskCase(input, actor(ctx))),
  resolveCase: airlineOpsProcedure
    .input(resolveStationCase)
    .output(eventReceipt)
    .mutation(({ input, ctx }) => resolveDeskCase(input, actor(ctx))),
  addOsi: airlineOpsProcedure
    .input(addStationNote)
    .output(eventReceipt)
    .mutation(({ input, ctx }) => addDeskNote(input, actor(ctx))),
  blockSeats: airlineOpsProcedure
    .input(blockStationSeats)
    .output(blockedSeatsReceipt)
    .mutation(({ input, ctx }) => blockDeskSeats(input, actor(ctx))),
  getDesk: airlineOpsProcedure
    .input(z.object({ flightId: z.number().int().positive() }))
    .output(dcsDesk)
    .query(({ input, ctx }) => getDcsDesk(input.flightId, actor(ctx))),
  changeFlightState: airlineOpsProcedure
    .input(changeDcsFlightInput)
    .output(dcsFlightResult)
    .mutation(({ input, ctx }) => changeDcsFlightState(input, actor(ctx))),
  checkIn: airlineOpsProcedure
    .input(dcsCheckInInput)
    .output(dcsPassengerResult)
    .mutation(({ input, ctx }) => checkInDcsPassenger(input, actor(ctx))),
  setBagReturnGrant: airlineAdminProcedure
    .input(dcsBagReturnGrantInput)
    .output(dcsBagReturnGrantResult)
    .mutation(({ input, ctx }) => setBagReturnGrant(input, actor(ctx))),
  bagReturnGrants: airlineAdminProcedure
    .input(dcsBagReturnGrantListInput)
    .output(dcsBagReturnGrantList)
    .query(({ input, ctx }) => listBagReturnGrants(input, actor(ctx))),
  returnBag: airlineOpsProcedure
    .input(dcsReturnBagInput)
    .output(dcsReturnBagResult)
    .mutation(({ input, ctx }) => returnDcsBag(input, actor(ctx))),
  transition: airlineOpsProcedure
    .input(dcsTransitionInput)
    .output(dcsPassengerResult)
    .mutation(({ input, ctx }) => transitionDcsPassenger(input, actor(ctx))),
});
