import { randomUUID } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import {
  corporateAccounts,
  corporateUsers,
  corporateInvitations,
  users,
  notifications,
} from "../../drizzle/schema";
const database = () => {
  const db = getDb();
  if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE" });
  return db;
};

export async function inviteCorporateUser(
  actorId: number,
  input: {
    corporateAccountId: number;
    email: string;
    role: "admin" | "booker" | "traveler";
  }
) {
  const db = database();
  return await db.transaction(async tx => {
    const recipients = await tx
      .select()
      .from(users)
      .where(eq(users.email, input.email.trim().toLowerCase()))
      .limit(2)
      .for("update");
    if (recipients.length !== 1)
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message:
          "Invitation requires one registered employee account with this email",
      });
    const recipient = recipients[0];
    const [account] = await tx
      .select()
      .from(corporateAccounts)
      .where(eq(corporateAccounts.id, input.corporateAccountId))
      .for("update");
    const [actor] = await tx
      .select()
      .from(corporateUsers)
      .where(
        and(
          eq(corporateUsers.corporateAccountId, input.corporateAccountId),
          eq(corporateUsers.userId, actorId),
          eq(corporateUsers.role, "admin"),
          eq(corporateUsers.isActive, true)
        )
      )
      .for("update");
    if (!actor) throw new TRPCError({ code: "FORBIDDEN" });
    if (!account || account.status !== "active")
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Company is not active",
      });
    const [member] = await tx
      .select()
      .from(corporateUsers)
      .where(
        and(
          eq(corporateUsers.userId, recipient.id),
          eq(corporateUsers.isActive, true)
        )
      )
      .for("update");
    if (member)
      throw new TRPCError({
        code: "CONFLICT",
        message: "Employee already has an active company membership",
      });
    const [prior] = await tx
      .select()
      .from(corporateInvitations)
      .where(
        and(
          eq(corporateInvitations.recipientUserId, recipient.id),
          eq(corporateInvitations.corporateAccountId, account.id),
          isNull(corporateInvitations.acceptedAt),
          gt(corporateInvitations.expiresAt, new Date())
        )
      )
      .for("update");
    if (prior) {
      if (prior.role !== input.role)
        throw new TRPCError({
          code: "CONFLICT",
          message: "A pending invitation already exists with a different role",
        });
      return {
        id: prior.id,
        expiresAt: prior.expiresAt,
        status: "pending" as const,
      };
    }
    const invitation = {
      id: randomUUID(),
      corporateAccountId: account.id,
      recipientUserId: recipient.id,
      invitedBy: actorId,
      role: input.role,
      expiresAt: new Date(Date.now() + 7 * 86400000),
    };
    await tx.insert(corporateInvitations).values(invitation);
    await tx.insert(notifications).values({
      userId: recipient.id,
      type: "system",
      title: "Corporate invitation / دعوة شركة",
      message: `${account.companyName}: ${input.role}. Review this invitation before accepting.`,
      data: JSON.stringify({
        invitationId: invitation.id,
        link: "/corporate",
      }),
    });
    return {
      id: invitation.id,
      expiresAt: invitation.expiresAt,
      status: "pending" as const,
    };
  });
}

export async function listCorporateInvitations(userId: number) {
  return await database()
    .select({
      id: corporateInvitations.id,
      companyName: corporateAccounts.companyName,
      role: corporateInvitations.role,
      expiresAt: corporateInvitations.expiresAt,
    })
    .from(corporateInvitations)
    .innerJoin(
      corporateAccounts,
      eq(corporateAccounts.id, corporateInvitations.corporateAccountId)
    )
    .where(
      and(
        eq(corporateInvitations.recipientUserId, userId),
        isNull(corporateInvitations.acceptedAt),
        gt(corporateInvitations.expiresAt, new Date()),
        eq(corporateAccounts.status, "active")
      )
    );
}
export async function acceptCorporateInvitation(
  userId: number,
  invitationId: string
) {
  return await database().transaction(async tx => {
    await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, userId))
      .for("update");
    const [invitation] = await tx
      .select()
      .from(corporateInvitations)
      .where(
        and(
          eq(corporateInvitations.id, invitationId),
          eq(corporateInvitations.recipientUserId, userId)
        )
      )
      .for("update");
    if (!invitation) throw new TRPCError({ code: "NOT_FOUND" });
    if (invitation.acceptedAt) return { accepted: true as const };
    if (invitation.expiresAt <= new Date())
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Invitation expired",
      });
    const [account] = await tx
      .select()
      .from(corporateAccounts)
      .where(eq(corporateAccounts.id, invitation.corporateAccountId))
      .for("update");
    if (account?.status !== "active")
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Company is not active",
      });
    const [inviter] = await tx
      .select()
      .from(corporateUsers)
      .where(
        and(
          eq(corporateUsers.corporateAccountId, account.id),
          eq(corporateUsers.userId, invitation.invitedBy),
          eq(corporateUsers.role, "admin"),
          eq(corporateUsers.isActive, true)
        )
      )
      .for("update");
    if (!inviter)
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Inviter no longer administers this company",
      });
    const memberships = await tx
      .select()
      .from(corporateUsers)
      .where(eq(corporateUsers.userId, userId))
      .for("update");
    if (memberships.some(m => m.isActive))
      throw new TRPCError({
        code: "CONFLICT",
        message: "Employee already has an active membership",
      });
    await tx
      .insert(corporateUsers)
      .values({
        userId,
        corporateAccountId: account.id,
        role: invitation.role,
        isActive: true,
      })
      .onDuplicateKeyUpdate({ set: { role: invitation.role, isActive: true } });
    await tx
      .update(corporateInvitations)
      .set({ acceptedAt: new Date() })
      .where(eq(corporateInvitations.id, invitation.id));
    return { accepted: true as const };
  });
}
