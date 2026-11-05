import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { safeReturnTo } from "../../shared/return-to";
import { oauthLoginStates } from "../../drizzle/schema";
import { getDb } from "../db";

export const OAUTH_STATE_MAX_AGE_MS = 10 * 60 * 1000;
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");

export class OAuthStateUnavailableError extends Error {
  constructor() {
    super("OAuth login-state storage is unavailable");
    this.name = "OAuthStateUnavailableError";
  }
}

export async function beginOAuthLogin(redirectUri: string, returnTo: unknown) {
  const state = randomBytes(32).toString("base64url");
  const browserNonce = randomBytes(32).toString("base64url");
  try {
    const database = await getDb();
    if (!database) throw new OAuthStateUnavailableError();
    await database.insert(oauthLoginStates).values({
      stateHash: hash(state),
      browserNonceHash: hash(browserNonce),
      redirectUri,
      returnTo: safeReturnTo(returnTo),
      expiresAt: new Date(Date.now() + OAUTH_STATE_MAX_AGE_MS),
    });
    return { state, browserNonce };
  } catch {
    throw new OAuthStateUnavailableError();
  }
}

/** Consume exactly once, including when callbacks race on different workers. */
export async function consumeOAuthLogin(input: {
  state: string;
  browserNonce: string | undefined;
  redirectUri: string;
}): Promise<{ redirectUri: string; returnTo: string } | null> {
  if (
    !tokenPattern.test(input.state) ||
    !input.browserNonce ||
    !tokenPattern.test(input.browserNonce)
  ) {
    return null;
  }

  try {
    const database = await getDb();
    if (!database) throw new OAuthStateUnavailableError();
    const eligible = and(
      eq(oauthLoginStates.stateHash, hash(input.state)),
      eq(oauthLoginStates.browserNonceHash, hash(input.browserNonce)),
      eq(oauthLoginStates.redirectUri, input.redirectUri),
      isNull(oauthLoginStates.consumedAt),
      gt(oauthLoginStates.expiresAt, new Date())
    );
    const [record] = await database
      .select({
        redirectUri: oauthLoginStates.redirectUri,
        returnTo: oauthLoginStates.returnTo,
      })
      .from(oauthLoginStates)
      .where(eligible)
      .limit(1);
    if (!record || safeReturnTo(record.returnTo) !== record.returnTo)
      return null;

    const [result] = await database
      .update(oauthLoginStates)
      .set({ consumedAt: new Date() })
      .where(
        and(
          eligible,
          // Re-check expiry at the claim itself, not only at the preceding read.
          gt(oauthLoginStates.expiresAt, new Date()),
          eq(oauthLoginStates.returnTo, record.returnTo)
        )
      );
    return result.affectedRows === 1 ? record : null;
  } catch {
    throw new OAuthStateUnavailableError();
  }
}
