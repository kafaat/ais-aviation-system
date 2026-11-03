import { z } from "zod";
import { airlineOpsProcedure, router } from "../_core/trpc";
import {
  changeDcsFlightInput,
  dcsCheckInInput,
  dcsDesk,
  dcsFlightResult,
  dcsPassengerResult,
  dcsTransitionInput,
} from "../contracts/dcs-operations";
import {
  changeDcsFlightState,
  checkInDcsPassenger,
  getDcsDesk,
  transitionDcsPassenger,
  type DcsActor,
} from "../services/dcs-operations.service";
import type { TrpcContext } from "../_core/context";

function actor(ctx: TrpcContext): DcsActor {
  if (!ctx.user) throw new Error("Authenticated departure operator required");
  return { userId: ctx.user.id, role: ctx.user.role, tenantId: ctx.tenantId };
}
export const dcsOperationsRouter = router({
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
  transition: airlineOpsProcedure
    .input(dcsTransitionInput)
    .output(dcsPassengerResult)
    .mutation(({ input, ctx }) => transitionDcsPassenger(input, actor(ctx))),
});
