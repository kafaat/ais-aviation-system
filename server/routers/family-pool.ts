import { responseContracts } from "../contracts/family-pool";
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import {
  createFamilyGroup,
  addFamilyMember,
  removeFamilyMember,
  getMyFamilyGroup,
  contributeMilesToPool,
  deleteFamilyGroup,
} from "../services/family-pool.service";
import { TRPCError } from "@trpc/server";

/**
 * Family Pool Router
 * Manages family mile pooling groups
 */
export const familyPoolRouter = router({
  /**
   * Create a new family group
   */
  createGroup: protectedProcedure
    .input(z.object({ name: z.string().min(2).max(100) }))
    .output(responseContracts["createGroup"])
    .mutation(async ({ ctx, input }) => {
      try {
        return await createFamilyGroup(ctx.user.id, input.name);
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            error instanceof Error
              ? error.message
              : "Failed to create family group",
        });
      }
    }),

  /**
   * Get current user's family group
   */
  myGroup: protectedProcedure
    .output(responseContracts["myGroup"])
    .query(async ({ ctx }) => {
      return await getMyFamilyGroup(ctx.user.id);
    }),

  /**
   * Add a member to the family group by email
   */
  addMember: protectedProcedure
    .input(
      z.object({
        groupId: z.number(),
        memberEmail: z.string().email(),
      })
    )
    .output(responseContracts["addMember"])
    .mutation(async ({ ctx, input }) => {
      try {
        return await addFamilyMember(
          ctx.user.id,
          input.groupId,
          input.memberEmail
        );
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            error instanceof Error ? error.message : "Failed to add member",
        });
      }
    }),

  /**
   * Remove a member from the family group
   */
  removeMember: protectedProcedure
    .input(
      z.object({
        groupId: z.number(),
        memberId: z.number(),
      })
    )
    .output(responseContracts["removeMember"])
    .mutation(async ({ ctx, input }) => {
      try {
        return await removeFamilyMember(
          ctx.user.id,
          input.groupId,
          input.memberId
        );
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            error instanceof Error ? error.message : "Failed to remove member",
        });
      }
    }),

  /**
   * Contribute miles from personal account to the family pool
   */
  contributeMiles: protectedProcedure
    .input(
      z.object({
        groupId: z.number(),
        miles: z.number().min(100).max(100000),
      })
    )
    .output(responseContracts["contributeMiles"])
    .mutation(async ({ ctx, input }) => {
      try {
        return await contributeMilesToPool(
          ctx.user.id,
          input.groupId,
          input.miles
        );
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            error instanceof Error
              ? error.message
              : "Failed to contribute miles",
        });
      }
    }),

  /**
   * Delete a family group (owner only)
   */
  deleteGroup: protectedProcedure
    .input(z.object({ groupId: z.number() }))
    .output(responseContracts["deleteGroup"])
    .mutation(async ({ ctx, input }) => {
      try {
        return await deleteFamilyGroup(ctx.user.id, input.groupId);
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            error instanceof Error
              ? error.message
              : "Failed to delete family group",
        });
      }
    }),
});
