import { TRPCError } from "@trpc/server";
import { eq, desc } from "drizzle-orm";
import { getDb } from "../db";
import {
  users,
  userConsents,
  consentHistory,
  consentRecords,
  type InsertUserConsent,
} from "../../drizzle/schema";

export async function writePrivacyConsent(
  userId: number,
  updates: Partial<InsertUserConsent>,
  context: { ipAddress?: string; userAgent?: string } = {},
  expectedRevision?: number | null,
  checkRevision = false
) {
  const db = getDb();
  if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE" });
  return await db.transaction(async tx => {
    const [user] = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, userId))
      .for("update");
    if (!user) throw new TRPCError({ code: "NOT_FOUND" });
    const [latest] = await tx
      .select()
      .from(consentRecords)
      .where(eq(consentRecords.userId, userId))
      .orderBy(desc(consentRecords.id))
      .limit(1);
    if (checkRevision && (latest?.id ?? null) !== (expectedRevision ?? null))
      throw new TRPCError({
        code: "CONFLICT",
        message: "Consent changed; reload before choosing again",
      });
    await tx
      .insert(userConsents)
      .values({ userId })
      .onDuplicateKeyUpdate({ set: { userId } });
    const [previous] = await tx
      .select()
      .from(userConsents)
      .where(eq(userConsents.userId, userId))
      .for("update");
    const allowed = [
      "marketingEmails",
      "marketingSms",
      "marketingPush",
      "analyticsTracking",
      "performanceCookies",
      "thirdPartySharing",
      "partnerOffers",
      "personalizedAds",
      "personalizedContent",
    ] as const;
    const changes = Object.fromEntries(
      allowed.flatMap(key =>
        updates[key] === undefined ? [] : [[key, updates[key]]]
      )
    ) as Partial<InsertUserConsent>;
    for (const key of allowed)
      if (changes[key] !== undefined && changes[key] !== previous[key])
        await tx.insert(consentHistory).values({
          userId,
          consentType: key,
          previousValue: previous[key],
          newValue: Boolean(changes[key]),
          consentVersion: "1.0",
          changeReason: "user_update",
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
        });
    await tx
      .update(userConsents)
      .set({
        ...changes,
        consentVersion: "1.0",
        ipAddressAtConsent: context.ipAddress ?? null,
        userAgentAtConsent: context.userAgent ?? null,
      })
      .where(eq(userConsents.userId, userId));
    const [privacy] = await tx
      .select()
      .from(userConsents)
      .where(eq(userConsents.userId, userId));
    const [result] = await tx.insert(consentRecords).values({
      userId,
      consentVersion: "1.0",
      essential: true,
      analytics: privacy.analyticsTracking,
      marketing: privacy.personalizedAds,
      preferences: privacy.personalizedContent,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });
    const [cookie] = await tx
      .select()
      .from(consentRecords)
      .where(eq(consentRecords.id, result.insertId));
    return { privacy, cookie };
  });
}
