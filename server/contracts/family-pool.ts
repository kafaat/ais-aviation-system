// Explicit response field allowlists. Review contract changes with producers and consumers.
import { z } from "zod";
import { outputNumber } from "./primitives";
export const responseContracts = {
  createGroup: z.object({
    id: outputNumber,
    name: z.string(),
    ownerId: outputNumber,
    pooledMiles: outputNumber,
    maxMembers: outputNumber,
    status: z.enum(["active", "inactive"]),
    createdAt: z.date(),
    updatedAt: z.date(),
  }),
  myGroup: z.union([
    z.null(),
    z.object({
      pooledMiles: outputNumber,
      members: z.array(
        z.object({
          id: outputNumber,
          userId: outputNumber,
          role: z.enum(["owner", "member"]),
          milesContributed: outputNumber,
          milesRedeemed: outputNumber,
          joinedAt: z.date(),
          userName: z.union([z.null(), z.string()]),
          userEmail: z.union([z.null(), z.string()]),
          currentMiles: z.union([z.null(), outputNumber]),
          tier: z.union([
            z.null(),
            z.literal("bronze"),
            z.literal("silver"),
            z.literal("gold"),
            z.literal("platinum"),
          ]),
        })
      ),
      myRole: z.enum(["owner", "member"]),
      id: outputNumber,
      name: z.string(),
      ownerId: outputNumber,
      maxMembers: outputNumber,
      status: z.enum(["active", "inactive"]),
      createdAt: z.date(),
      updatedAt: z.date(),
    }),
  ]),
  addMember: z.object({
    success: z.boolean(),
    memberName: z.union([z.null(), z.string()]),
  }),
  removeMember: z.object({ success: z.boolean() }),
  contributeMiles: z.object({
    success: z.boolean(),
    milesContributed: outputNumber,
  }),
  deleteGroup: z.object({ success: z.boolean() }),
};
