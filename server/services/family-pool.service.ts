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

  // Check if user already owns a group
  const [existingGroup] = await db
    .select()
    .from(familyGroups)
    .where(
      and(eq(familyGroups.ownerId, ownerId), eq(familyGroups.status, "active"))
    )
    .limit(1);

  if (existingGroup) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "You already have an active family group",
    });
  }

  // Check if user is already a member of another group
  const [existingMembership] = await db
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

  const [result] = await db.insert(familyGroups).values({
    name,
    ownerId,
    pooledMiles: 0,
    maxMembers: 6,
    status: "active",
  });

  const groupId = result.insertId;

  // Add owner as first member
  await db.insert(familyGroupMembers).values({
    groupId,
    userId: ownerId,
    role: "owner",
    status: "active",
  });

  const [group] = await db
    .select()
    .from(familyGroups)
    .where(eq(familyGroups.id, groupId))
    .limit(1);

  return group;
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

  // Verify ownership
  const [group] = await db
    .select()
    .from(familyGroups)
    .where(
      and(
        eq(familyGroups.id, groupId),
        eq(familyGroups.ownerId, ownerId),
        eq(familyGroups.status, "active")
      )
    )
    .limit(1);

  if (!group)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Family group not found or you are not the owner",
    });

  // Check member count
  const members = await db
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

  // Find user by email
  const [memberUser] = await db
    .select()
    .from(users)
    .where(eq(users.email, memberEmail))
    .limit(1);

  if (!memberUser)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "User not found with this email",
    });

  // Check if already a member of any group
  const [existingMembership] = await db
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

  await db.insert(familyGroupMembers).values({
    groupId,
    userId: memberUser.id,
    role: "member",
    status: "active",
  });

  return { success: true, memberName: memberUser.name };
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

  // Verify ownership
  const [group] = await db
    .select()
    .from(familyGroups)
    .where(and(eq(familyGroups.id, groupId), eq(familyGroups.ownerId, ownerId)))
    .limit(1);

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

  await db
    .update(familyGroupMembers)
    .set({ status: "removed" })
    .where(
      and(
        eq(familyGroupMembers.groupId, groupId),
        eq(familyGroupMembers.userId, memberId)
      )
    );

  return { success: true };
}

export async function getMyFamilyGroup(userId: number) {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  // Find user's active membership
  const [membership] = await db
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
  const [group] = await db
    .select()
    .from(familyGroups)
    .where(eq(familyGroups.id, membership.groupId))
    .limit(1);

  if (!group) return null;

  // Get all members with their loyalty info
  const members = await db
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

  // Calculate total pooled miles
  const totalPooledMiles = members.reduce(
    (sum, m) => sum + (m.currentMiles || 0),
    0
  );

  return {
    ...group,
    pooledMiles: totalPooledMiles,
    members,
    myRole: membership.role,
  };
}

export async function contributeMilesToPool(
  userId: number,
  groupId: number,
  miles: number
) {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  if (miles <= 0)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Miles must be positive",
    });

  // Verify membership
  const [membership] = await db
    .select()
    .from(familyGroupMembers)
    .where(
      and(
        eq(familyGroupMembers.groupId, groupId),
        eq(familyGroupMembers.userId, userId),
        eq(familyGroupMembers.status, "active")
      )
    )
    .limit(1);

  if (!membership)
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You are not a member of this group",
    });

  // Check user has enough miles
  const [account] = await db
    .select()
    .from(loyaltyAccounts)
    .where(eq(loyaltyAccounts.userId, userId))
    .limit(1);

  if (!account || account.currentMilesBalance < miles) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Insufficient miles balance",
    });
  }

  // Deduct from user's account
  await db
    .update(loyaltyAccounts)
    .set({
      currentMilesBalance: sql`${loyaltyAccounts.currentMilesBalance} - ${miles}`,
    })
    .where(eq(loyaltyAccounts.userId, userId));

  // Update member contribution
  await db
    .update(familyGroupMembers)
    .set({
      milesContributed: sql`${familyGroupMembers.milesContributed} + ${miles}`,
    })
    .where(
      and(
        eq(familyGroupMembers.groupId, groupId),
        eq(familyGroupMembers.userId, userId)
      )
    );

  // Update group pooled miles
  await db
    .update(familyGroups)
    .set({
      pooledMiles: sql`${familyGroups.pooledMiles} + ${miles}`,
    })
    .where(eq(familyGroups.id, groupId));

  return { success: true, milesContributed: miles };
}

export async function deleteFamilyGroup(ownerId: number, groupId: number) {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  const [group] = await db
    .select()
    .from(familyGroups)
    .where(and(eq(familyGroups.id, groupId), eq(familyGroups.ownerId, ownerId)))
    .limit(1);

  if (!group)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Family group not found or you are not the owner",
    });

  // Remove all members
  await db
    .update(familyGroupMembers)
    .set({ status: "removed" })
    .where(eq(familyGroupMembers.groupId, groupId));

  // Deactivate group
  await db
    .update(familyGroups)
    .set({ status: "inactive" })
    .where(eq(familyGroups.id, groupId));

  return { success: true };
}
