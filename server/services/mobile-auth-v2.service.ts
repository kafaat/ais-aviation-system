import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { TRPCError } from "@trpc/server";
import { and, eq, gt, isNull, lt } from "drizzle-orm";
import { getDb } from "../db";
import {
  refreshTokens,
  users,
  mfaSettings,
  type User,
} from "../../drizzle/schema";
import { type MfaProof } from "./mfa.service";
import { ENV } from "../_core/env";

const JWT_SECRET = process.env.JWT_SECRET;
const PEPPER = process.env.REFRESH_TOKEN_PEPPER || JWT_SECRET || "";
export const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const ACCESS_SECONDS = 15 * 60;
const hashToken = (token: string) =>
  crypto.createHmac("sha256", PEPPER).update(token).digest("hex");
const randomToken = () => crypto.randomBytes(32).toString("hex");
const expiry = () => new Date(Date.now() + SESSION_MAX_AGE_MS);
const unauthorized = (message = "Invalid or expired session") =>
  new TRPCError({ code: "UNAUTHORIZED", message });
async function database() {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "SERVICE_UNAVAILABLE",
      message: "Database unavailable",
    });
  return db;
}
export interface JwtPayload {
  userId: number;
  email: string;
  role: string;
  sid: string;
  purpose: "access";
  iat: number;
  exp: number;
}
export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  tokenType: "Bearer";
  sessionId: string;
}
export interface RefreshResult {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  sessionId: string;
  user: User;
}
type DeviceInfo = { userAgent?: string; ipAddress?: string; deviceId?: string };

/** A family of rotating refresh records is the shared authority for cookie and Bearer sessions. */
export const mobileAuthServiceV2 = {
  generateAccessToken(
    user: { id: number; email: string | null; role: string },
    sessionId: string
  ): string {
    if (!JWT_SECRET || !/^[a-f0-9]{64}$/.test(sessionId))
      throw new Error("Signing key and session family are required");
    return jwt.sign(
      {
        userId: user.id,
        email: user.email || "",
        role: user.role,
        sid: sessionId,
        purpose: "access",
      },
      JWT_SECRET,
      {
        algorithm: "HS256",
        expiresIn: ACCESS_SECONDS,
        issuer: "ais-aviation",
        audience: ENV.appId,
      }
    );
  },

  verifyAccessToken(token: string): JwtPayload {
    if (!JWT_SECRET) throw new Error("JWT_SECRET is required");
    try {
      const payload = jwt.verify(token, JWT_SECRET, {
        algorithms: ["HS256"],
        issuer: "ais-aviation",
        audience: ENV.appId,
      }) as JwtPayload;
      if (
        payload.purpose !== "access" ||
        !Number.isInteger(payload.userId) ||
        !/^[a-f0-9]{64}$/.test(payload.sid || "")
      )
        throw unauthorized();
      return payload;
    } catch {
      throw unauthorized("Invalid or expired access token");
    }
  },

  async authenticateSession(sessionId: string): Promise<User> {
    if (!/^[a-f0-9]{64}$/.test(sessionId)) throw unauthorized();
    const db = await database();
    const [row] = await db
      .select({
        user: users,
        mfaEnabled: mfaSettings.isEnabled,
        mfaVerified: refreshTokens.mfaVerified,
      })
      .from(refreshTokens)
      .innerJoin(users, eq(refreshTokens.userId, users.id))
      .leftJoin(mfaSettings, eq(mfaSettings.userId, users.id))
      .where(
        and(
          eq(refreshTokens.familyId, sessionId),
          isNull(refreshTokens.revokedAt),
          gt(refreshTokens.expiresAt, new Date())
        )
      )
      .limit(1);
    if (!row || (row.mfaEnabled && !row.mfaVerified)) throw unauthorized();
    return row.user;
  },

  async authenticateAccessToken(token: string): Promise<User> {
    const payload = this.verifyAccessToken(token);
    const user = await this.authenticateSession(payload.sid);
    if (user.id !== payload.userId) throw unauthorized();
    return user;
  },

  async login(
    userId: number,
    deviceInfo?: DeviceInfo,
    proof?: MfaProof
  ): Promise<AuthTokens> {
    const db = await database();
    const sessionId = randomToken();
    const token = randomToken();
    const user = await db.transaction(async tx => {
      const [user] = await tx
        .select()
        .from(users)
        .where(eq(users.id, userId))
        .limit(1)
        .for("update");
      if (!user) throw unauthorized();
      const [mfa] = await tx
        .select()
        .from(mfaSettings)
        .where(eq(mfaSettings.userId, userId))
        .limit(1)
        .for("update");
      const mfaVerified = !!(
        proof &&
        proof.userId === userId &&
        proof.secret === mfa?.secret &&
        mfa.isEnabled
      );
      if (mfa?.isEnabled && !mfaVerified)
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "MFA_REQUIRED",
        });
      await tx.insert(refreshTokens).values({
        userId,
        familyId: sessionId,
        mfaVerified,
        token: hashToken(token),
        expiresAt: expiry(),
        deviceInfo: deviceInfo ? JSON.stringify(deviceInfo) : null,
        ipAddress: deviceInfo?.ipAddress || null,
      });
      await tx
        .update(users)
        .set({ lastSignedIn: new Date() })
        .where(eq(users.id, userId));
      return user;
    });
    return {
      accessToken: this.generateAccessToken(user, sessionId),
      refreshToken: token,
      expiresIn: ACCESS_SECONDS,
      tokenType: "Bearer",
      sessionId,
    };
  },

  async verifyRefreshToken(
    token: string
  ): Promise<{ userId: number; tokenId: number } | null> {
    const db = await database();
    const row = await db.query.refreshTokens.findFirst({
      where: (t, { and, eq, gt, isNull }) =>
        and(
          eq(t.token, hashToken(token)),
          gt(t.expiresAt, new Date()),
          isNull(t.revokedAt)
        ),
    });
    if (!row?.familyId) return null;
    await this.authenticateSession(row.familyId);
    return { userId: row.userId, tokenId: row.id };
  },

  async refreshTokens(
    token: string,
    deviceInfo?: DeviceInfo
  ): Promise<RefreshResult> {
    const db = await database();
    const result = await db.transaction(async tx => {
      const record = await tx.query.refreshTokens.findFirst({
        where: (t, { and, eq, gt, isNull }) =>
          and(
            eq(t.token, hashToken(token)),
            gt(t.expiresAt, new Date()),
            isNull(t.revokedAt)
          ),
      });
      if (!record?.familyId)
        throw unauthorized("Invalid or expired refresh token");
      const user = await tx.query.users.findFirst({
        where: (t, { eq }) => eq(t.id, record.userId),
      });
      if (!user) throw unauthorized();
      const [mfa] = await tx
        .select()
        .from(mfaSettings)
        .where(eq(mfaSettings.userId, user.id))
        .limit(1);
      if (mfa?.isEnabled && !record.mfaVerified)
        throw unauthorized("MFA_REQUIRED");
      // The current read performed by UPDATE rechecks revokedAt after row-lock waits.
      // Exactly one concurrent request can claim the old token; a loser inserts nothing.
      const [claimed] = await tx
        .update(refreshTokens)
        .set({ revokedAt: new Date(), lastUsedAt: new Date() })
        .where(
          and(
            eq(refreshTokens.id, record.id),
            isNull(refreshTokens.revokedAt),
            gt(refreshTokens.expiresAt, new Date())
          )
        );
      if (claimed.affectedRows !== 1)
        throw unauthorized("Refresh token already used");
      const nextToken = randomToken();
      await tx.insert(refreshTokens).values({
        userId: user.id,
        familyId: record.familyId,
        mfaVerified: record.mfaVerified,
        token: hashToken(nextToken),
        expiresAt: expiry(),
        deviceInfo: deviceInfo ? JSON.stringify(deviceInfo) : record.deviceInfo,
        ipAddress: deviceInfo?.ipAddress || record.ipAddress,
      });
      return { user, nextToken, sessionId: record.familyId };
    });
    return {
      accessToken: this.generateAccessToken(result.user, result.sessionId),
      refreshToken: result.nextToken,
      expiresIn: ACCESS_SECONDS,
      sessionId: result.sessionId,
      user: result.user,
    };
  },

  async revokeFamily(sessionId: string, userId?: number): Promise<void> {
    const db = await database();
    await db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(refreshTokens.familyId, sessionId),
          userId == null ? undefined : eq(refreshTokens.userId, userId)
        )
      );
  },

  async logout(token: string): Promise<void> {
    const db = await database();
    // Include rotated records, so an old device token can still revoke its family.
    const record = await db.query.refreshTokens.findFirst({
      where: (t, { eq }) => eq(t.token, hashToken(token)),
    });
    if (record?.familyId)
      await this.revokeFamily(record.familyId, record.userId);
  },

  async logoutAllDevices(userId: number): Promise<number> {
    const db = await database();
    const [result] = await db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(
        and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt))
      );
    return result.affectedRows;
  },

  async revokeSession(userId: number, tokenId: number): Promise<void> {
    const db = await database();
    const record = await db.query.refreshTokens.findFirst({
      where: (t, { and, eq }) => and(eq(t.id, tokenId), eq(t.userId, userId)),
    });
    if (!record?.familyId)
      throw new TRPCError({ code: "NOT_FOUND", message: "Session not found" });
    await this.revokeFamily(record.familyId, userId);
  },

  async cleanupExpiredTokens(): Promise<number> {
    const db = await database();
    const [result] = await db
      .delete(refreshTokens)
      .where(lt(refreshTokens.expiresAt, new Date()));
    return result.affectedRows;
  },

  async getActiveSessions(userId: number) {
    const db = await database();
    return db.query.refreshTokens.findMany({
      where: (t, { and, eq, gt, isNull, isNotNull }) =>
        and(
          eq(t.userId, userId),
          gt(t.expiresAt, new Date()),
          isNull(t.revokedAt),
          isNotNull(t.familyId)
        ),
      columns: {
        id: true,
        deviceInfo: true,
        ipAddress: true,
        createdAt: true,
        expiresAt: true,
      },
      orderBy: (t, { desc }) => [desc(t.createdAt)],
    });
  },
};
export default mobileAuthServiceV2;
