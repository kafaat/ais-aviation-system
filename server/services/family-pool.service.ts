import { withTransactionalIdempotency } from "./idempotency-v2.service";
import type { SettlementTx } from "./booking-settlement.service";
import {
  lockMilesState,
  expireMilesLots,
  spendMiles,
  requireMiles,
} from "./loyalty-balance.service";
import { recordEvent } from "./outbox.service";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import {
  familyGroups,
  familyGroupMembers,
  users,
  loyaltyAccounts,
} from "../../drizzle/schema";
import { eq, and, sql } from "drizzle-orm";

export async function createFamilyGroup(ownerId: number, name: string) {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  return db.transaction(
    async tx => {
      // Serialize creating an ownership membership and joining an existing group.
      const [owner] = await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, ownerId))
        .limit(1)
        .for("update");
      if (!owner)
        throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
      // Check if user already owns a group
      const [existingGroup] = await tx
        .select()
        .from(familyGroups)
        .where(
          and(
            eq(familyGroups.ownerId, ownerId),
            eq(familyGroups.status, "active")
          )
        )
        .limit(1);

      if (existingGroup) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "You already have an active family group",
        });
      }

      // Check if user is already a member of another group
      const [existingMembership] = await tx
        .select()
        .from(familyGroupMembers)
        .where(
          and(
            eq(familyGroupMembers.userId, ownerId),
            eq(familyGroupMembers.status, "active")
          )
        )
        .limit(1);

      if (existingMembership) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "You are already a member of a family group",
        });
      }

      const [result] = await tx.insert(familyGroups).values({
        name,
        ownerId,
        pooledMiles: 0,
        maxMembers: 6,
        status: "active",
      });

      const groupId = result.insertId;

      // Add owner as first member
      await tx.insert(familyGroupMembers).values({
        groupId,
        userId: ownerId,
        role: "owner",
        status: "active",
      });

      const [group] = await tx
        .select()
        .from(familyGroups)
        .where(eq(familyGroups.id, groupId))
        .limit(1);

      return group;
    },
    { isolationLevel: "read committed" }
  );
}

export async function addFamilyMember(
  ownerId: number,
  groupId: number,
  memberEmail: string
) {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  return db.transaction(
    async tx => {
      // Take the stable user row before the group row. Separate group owners
      // competing for one user and separate users competing for the final place
      // must both serialize, even if no membership currently exists.
      // Find user by email
      const [memberUser] = await tx
        .select()
        .from(users)
        .where(eq(users.email, memberEmail))
        .limit(1)
        .for("update");
      // Verify ownership
      const [group] = await tx
        .select()
        .from(familyGroups)
        .where(
          and(
            eq(familyGroups.id, groupId),
            eq(familyGroups.ownerId, ownerId),
            eq(familyGroups.status, "active")
          )
        )
        .limit(1)
        .for("update");

      if (!group)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Family group not found or you are not the owner",
        });

      // Check member count
      const members = await tx
        .select()
        .from(familyGroupMembers)
        .where(
          and(
            eq(familyGroupMembers.groupId, groupId),
            eq(familyGroupMembers.status, "active")
          )
        );

      if (members.length >= group.maxMembers) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Maximum ${group.maxMembers} members allowed`,
        });
      }

      if (!memberUser)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "User not found with this email",
        });

      // Check if already a member of any group
      const [existingMembership] = await tx
        .select()
        .from(familyGroupMembers)
        .where(
          and(
            eq(familyGroupMembers.userId, memberUser.id),
            eq(familyGroupMembers.status, "active")
          )
        )
        .limit(1);

      if (existingMembership) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This user is already in a family group",
        });
      }

      await tx.insert(familyGroupMembers).values({
        groupId,
        userId: memberUser.id,
        role: "member",
        status: "active",
      });

      return { success: true, memberName: memberUser.name };
    },
    { isolationLevel: "read committed" }
  );
}

export async function removeFamilyMember(
  ownerId: number,
  groupId: number,
  memberId: number
) {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  return db.transaction(
    async tx => {
      // Verify ownership
      const [group] = await tx
        .select()
        .from(familyGroups)
        .where(
          and(eq(familyGroups.id, groupId), eq(familyGroups.ownerId, ownerId))
        )
        .limit(1)
        .for("update");

      if (!group)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Family group not found or you are not the owner",
        });

      // Cannot remove self (owner)
      if (memberId === ownerId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Owner cannot be removed. Delete the group instead.",
        });
      }

      await tx
        .update(familyGroupMembers)
        .set({ status: "removed" })
        .where(
          and(
            eq(familyGroupMembers.groupId, groupId),
            eq(familyGroupMembers.userId, memberId)
          )
        );

      return { success: true };
    },
    { isolationLevel: "read committed" }
  );
}

export async function getMyFamilyGroup(userId: number) {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  return db.transaction(
    async tx => {
      // Find user's active membership
      const [membership] = await tx
        .select({
          groupId: familyGroupMembers.groupId,
          role: familyGroupMembers.role,
        })
        .from(familyGroupMembers)
        .where(
          and(
            eq(familyGroupMembers.userId, userId),
            eq(familyGroupMembers.status, "active")
          )
        )
        .limit(1);

      if (!membership) return null;

      // Get group details
      const [group] = await tx
        .select()
        .from(familyGroups)
        .where(eq(familyGroups.id, membership.groupId))
        .limit(1);

      if (!group) return null;

      // Get all members with their loyalty info
      const members = await tx
        .select({
          id: familyGroupMembers.id,
          userId: familyGroupMembers.userId,
          role: familyGroupMembers.role,
          milesContributed: familyGroupMembers.milesContributed,
          milesRedeemed: familyGroupMembers.milesRedeemed,
          joinedAt: familyGroupMembers.joinedAt,
          userName: users.name,
          userEmail: users.email,
          currentMiles: loyaltyAccounts.currentMilesBalance,
          tier: loyaltyAccounts.tier,
        })
        .from(familyGroupMembers)
        .innerJoin(users, eq(familyGroupMembers.userId, users.id))
        .leftJoin(
          loyaltyAccounts,
          eq(familyGroupMembers.userId, loyaltyAccounts.userId)
        )
        .where(
          and(
            eq(familyGroupMembers.groupId, membership.groupId),
            eq(familyGroupMembers.status, "active")
          )
        );

      return {
        ...group,
        members: members.map(member =>
          member.userId === userId
            ? member
            : {
                ...member,
                userEmail: null,
                currentMiles: null,
                tier: null,
              }
        ),
        myRole: membership.role,
      };
    },
    { isolationLevel: "repeatable read" }
  );
}

export async function contributeMilesToPool(
  userId: number,
  groupId: number,
  miles: number,
  requestKey?: string
) {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  requireMiles(miles);
  const run = async (tx: SettlementTx) => {
    const [group] = await tx
      .select()
      .from(familyGroups)
      .where(eq(familyGroups.id, groupId))
      .for("update");
    if (!group || group.status !== "active")
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Active family group not found",
      });
    const [membership] = await tx
      .select()
      .from(familyGroupMembers)
      .where(
        and(
          eq(familyGroupMembers.groupId, groupId),
          eq(familyGroupMembers.userId, userId),
          eq(familyGroupMembers.status, "active")
        )
      )
      .for("update");
    if (!membership)
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "You are not a member of this group",
      });
    const state = await lockMilesState(tx, userId);
    await expireMilesLots(tx, state);
    await spendMiles(tx, state, miles, {
      type: "adjustment",
      reason: `family-pool:${groupId}`,
    });
    if (
      !Number.isSafeInteger(group.pooledMiles + miles) ||
      group.pooledMiles + miles > 2147483647
    )
      throw new Error("Family pool balance exceeds storage bounds");
    await tx
      .update(familyGroupMembers)
      .set({
        milesContributed: sql`${familyGroupMembers.milesContributed} + ${miles}`,
      })
      .where(eq(familyGroupMembers.id, membership.id));
    await tx
      .update(familyGroups)
      .set({ pooledMiles: group.pooledMiles + miles })
      .where(eq(familyGroups.id, groupId));
    const [user] = await tx.select().from(users).where(eq(users.id, userId));
    await recordEvent(tx, {
      aggregateType: "family",
      aggregateId: groupId,
      tenantId: user?.tenantId ?? null,
      eventType: "family.miles_contributed",
      payload: { groupId, userId, miles },
    });
    return { success: true, milesContributed: miles };
  };
  return requestKey
    ? withTransactionalIdempotency({
        scope: "family.contribute",
        key: requestKey,
        userId,
        request: { groupId, miles },
        run,
      })
    : db.transaction(run);
}

export async function deleteFamilyGroup(ownerId: number, groupId: number) {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  return await db.transaction(async tx => {
    const [group] = await tx
      .select()
      .from(familyGroups)
      .where(
        and(eq(familyGroups.id, groupId), eq(familyGroups.ownerId, ownerId))
      )
      .for("update");
    if (!group)
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Family group not found or you are not the owner",
      });
    if (group.pooledMiles !== 0)
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message:
          "Reconcile the family's contributed balance before deactivating the group",
      });
    await tx
      .update(familyGroupMembers)
      .set({ status: "removed" })
      .where(eq(familyGroupMembers.groupId, groupId));
    await tx
      .update(familyGroups)
      .set({ status: "inactive" })
      .where(eq(familyGroups.id, groupId));
    return { success: true };
  });
}
