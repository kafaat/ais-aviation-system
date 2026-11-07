import { responseContracts } from "../contracts/weight-balance";
/**
 * Weight & Balance Router
 *
 * Admin-only endpoints for the aircraft registry (AHM 560/565 datasets and
 * registrations), load sheet computation on real flight data, signing, LMC,
 * aircraft change review and the printable load sheet document.
 */

import { z } from "zod";
import { adminProcedure, router } from "../_core/trpc";
import * as registry from "../services/aircraft-registry.service";
import * as wb from "../services/weight-balance.service";

const actor = (user: { id: number; name: string | null }) => ({
  id: user.id,
  name: user.name,
});

export const weightBalanceRouter = router({
  // ========================================================================
  // Aircraft registry
  // ========================================================================

  listTypeBalanceData: adminProcedure
    .input(
      z
        .object({
          typeCode: z.string().min(1).max(10).optional(),
          includeWithdrawn: z.boolean().optional(),
        })
        .optional()
    )
    .output(responseContracts["listTypeBalanceData"])
    .query(({ input }) => registry.listTypeBalanceData(input)),

  getTypeBalanceData: adminProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .output(responseContracts["getTypeBalanceData"])
    .query(({ input }) => registry.getTypeBalanceDataDetail(input.id)),

  /** Validated JSON import of one type/variant dataset; stored as a new draft version. */
  importTypeBalanceData: adminProcedure
    .input(z.object({ dataset: z.unknown() }))
    .output(responseContracts["importTypeBalanceData"])
    .mutation(({ input, ctx }) =>
      registry.importTypeBalanceData(input.dataset, actor(ctx.user))
    ),

  setTypeBalanceApproval: adminProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        approvalStatus: z.enum(["operator_approved", "withdrawn"]),
        approvalReference: z.string().trim().min(3).max(80),
      })
    )
    .output(responseContracts["setTypeBalanceApproval"])
    .mutation(({ input, ctx }) =>
      registry.setTypeBalanceApproval(
        input.id,
        {
          approvalStatus: input.approvalStatus,
          approvalReference: input.approvalReference,
        },
        actor(ctx.user)
      )
    ),

  listRegistrations: adminProcedure
    .input(
      z
        .object({
          airlineId: z.number().int().positive().optional(),
          registration: z.string().min(2).max(10).optional(),
          includeWithdrawn: z.boolean().optional(),
        })
        .optional()
    )
    .output(responseContracts["listRegistrations"])
    .query(({ input }) => registry.listRegistrations(input)),

  importRegistration: adminProcedure
    .input(z.object({ record: z.unknown() }))
    .output(responseContracts["importRegistration"])
    .mutation(({ input, ctx }) =>
      registry.importRegistration(input.record, actor(ctx.user))
    ),

  setRegistrationApproval: adminProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        approvalStatus: z.enum(["operator_approved", "withdrawn"]),
        approvalReference: z.string().trim().min(3).max(80),
      })
    )
    .output(responseContracts["setRegistrationApproval"])
    .mutation(({ input, ctx }) =>
      registry.setRegistrationApproval(
        input.id,
        {
          approvalStatus: input.approvalStatus,
          approvalReference: input.approvalReference,
        },
        actor(ctx.user)
      )
    ),

  /** Development only: fictional AIS-T1 datasets and registrations. */
  seedTrainingFixture: adminProcedure
    .input(z.object({ airlineId: z.number().int().positive() }))
    .output(responseContracts["seedTrainingFixture"])
    .mutation(({ input, ctx }) =>
      registry.seedTrainingFixture(input.airlineId, actor(ctx.user))
    ),

  // ========================================================================
  // Load sheets
  // ========================================================================

  listStandardMassRuleSets: adminProcedure
    .output(responseContracts["listStandardMassRuleSets"])
    .query(() => wb.listStandardMassRuleSets()),

  compute: adminProcedure
    .input(wb.computeRequestSchema)
    .output(responseContracts["compute"])
    .mutation(({ input, ctx }) => wb.computeLoadSheet(input, actor(ctx.user))),

  getLatest: adminProcedure
    .input(z.object({ flightId: z.number().int().positive() }))
    .output(responseContracts["getLatest"])
    .query(({ input }) => wb.getLatestLoadSheet(input.flightId)),

  listEditions: adminProcedure
    .input(z.object({ flightId: z.number().int().positive() }))
    .output(responseContracts["listEditions"])
    .query(({ input }) => wb.listLoadSheetEditions(input.flightId)),

  getEdition: adminProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .output(responseContracts["getEdition"])
    .query(({ input }) => wb.getLoadSheetEdition(input.id)),

  /** Freezes a preliminary edition as final under the signing admin's identity. */
  sign: adminProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .output(responseContracts["sign"])
    .mutation(({ input, ctx }) => wb.signLoadSheet(input.id, actor(ctx.user))),

  applyLmc: adminProcedure
    .input(wb.lmcRequestSchema)
    .output(responseContracts["applyLmc"])
    .mutation(({ input, ctx }) =>
      wb.applyLastMinuteChange(input, actor(ctx.user))
    ),

  renderDocument: adminProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .output(responseContracts["renderDocument"])
    .query(({ input }) => wb.renderLoadSheetDocument(input.id)),

  /** Registration swap: invalidates active editions, re-evaluates, records audit. */
  changeAircraft: adminProcedure
    .input(wb.aircraftChangeRequestSchema)
    .output(responseContracts["changeAircraft"])
    .mutation(({ input, ctx }) => wb.changeAircraft(input, actor(ctx.user))),

  listAircraftChanges: adminProcedure
    .input(z.object({ flightId: z.number().int().positive() }))
    .output(responseContracts["listAircraftChanges"])
    .query(({ input }) => wb.listAircraftChanges(input.flightId)),
});
