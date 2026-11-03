import { createHash } from "node:crypto";
import jwt from "jsonwebtoken";
import { TRPCError } from "@trpc/server";

const ISSUER = "ais-self-service";
const ALGORITHM: jwt.Algorithm = "HS256";

export type SelfServiceCapability =
  | {
      kind: "kiosk-session";
      bookingId: number;
      sessionId: number;
      passengerIds: number[];
    }
  | {
      kind: "bag-drop-admission";
      flightId: number;
      passDigest: string;
      bookingId: number;
      passengerId: number;
    }
  | {
      kind: "bag-drop-session";
      bookingId: number;
      passengerId: number;
      sessionId: number;
    }
  | {
      /**
       * Authority for an assistant-surfaced alternative to be executed.
       * Fetching alternatives is read-only and needs no capability; executing
       * one needs this token, bound to the user who saw the offer, the exact
       * amount they were shown and the offer version it was priced at. A
       * repriced or re-ranked offer yields a new version and the old token
       * no longer authorises anything.
       */
      kind: "assistant-execution";
      userId: number;
      conversationId: number;
      suggestionId: number;
      flightId: number;
      cabinClass: "economy" | "business";
      /** Integer minor units the user was shown. */
      amount: number;
      /** SHA-256 over the priced offer, see assistantOfferVersion(). */
      offerVersion: string;
    };

const TTL_SECONDS: Record<SelfServiceCapability["kind"], number> = {
  "kiosk-session": 15 * 60,
  "bag-drop-admission": 5 * 60,
  "bag-drop-session": 10 * 60,
  "assistant-execution": 10 * 60,
};

export type AssistantExecutionCapability = Extract<
  SelfServiceCapability,
  { kind: "assistant-execution" }
>;

/** The version of a priced alternative: changes whenever flight, cabin or
 * price change, so an execution authorised against one price cannot be
 * applied to another. */
export function assistantOfferVersion(offer: {
  suggestionId: number;
  flightId: number;
  cabinClass: string;
  totalPrice: number;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        offer.suggestionId,
        offer.flightId,
        offer.cabinClass,
        offer.totalPrice,
      ])
    )
    .digest("hex");
}

function isPositiveInt(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function getSecret(override?: string): string {
  const secret =
    override ||
    process.env.SELF_SERVICE_CAPABILITY_SECRET ||
    (process.env.NODE_ENV === "production"
      ? undefined
      : "dev-only-self-service-capability-secret-change-me");

  if (!secret || secret.length < 32) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message:
        "SELF_SERVICE_CAPABILITY_SECRET must be configured with at least 32 characters",
    });
  }
  return secret;
}

function audience(kind: SelfServiceCapability["kind"]): string {
  return `ais-${kind}`;
}

export function issueSelfServiceCapability(
  capability: SelfServiceCapability,
  opts: { secret?: string; expiresInSeconds?: number } = {}
): string {
  return jwt.sign(capability, getSecret(opts.secret), {
    algorithm: ALGORITHM,
    issuer: ISSUER,
    audience: audience(capability.kind),
    expiresIn: Math.min(
      opts.expiresInSeconds ?? TTL_SECONDS[capability.kind],
      TTL_SECONDS[capability.kind]
    ),
  });
}

export function verifySelfServiceCapability<
  K extends SelfServiceCapability["kind"],
>(
  token: string,
  expectedKind: K,
  opts: { secret?: string } = {}
): Extract<SelfServiceCapability, { kind: K }> {
  try {
    const decoded = jwt.verify(token, getSecret(opts.secret), {
      algorithms: [ALGORITHM],
      issuer: ISSUER,
      audience: audience(expectedKind),
    }) as jwt.JwtPayload & SelfServiceCapability;

    if (decoded.kind !== expectedKind) {
      throw new Error("Capability scope mismatch");
    }
    if (decoded.kind === "assistant-execution") {
      if (
        !isPositiveInt(decoded.userId) ||
        !isPositiveInt(decoded.conversationId) ||
        !isPositiveInt(decoded.suggestionId) ||
        !isPositiveInt(decoded.flightId) ||
        !["economy", "business"].includes(decoded.cabinClass) ||
        !isPositiveInt(decoded.amount) ||
        !/^[a-f0-9]{64}$/.test(decoded.offerVersion)
      )
        throw new Error("Invalid assistant execution scope");
      return decoded as Extract<SelfServiceCapability, { kind: K }>;
    }
    if (!Number.isInteger(decoded.bookingId) || decoded.bookingId <= 0) {
      throw new Error("Invalid booking scope");
    }
    if (expectedKind === "kiosk-session") {
      const kiosk = decoded as Extract<
        SelfServiceCapability,
        { kind: "kiosk-session" }
      >;
      if (!Number.isInteger(kiosk.sessionId) || kiosk.sessionId <= 0) {
        throw new Error("Invalid kiosk session scope");
      }
      if (
        !Array.isArray(kiosk.passengerIds) ||
        kiosk.passengerIds.length === 0 ||
        kiosk.passengerIds.some(id => !Number.isInteger(id) || id <= 0)
      ) {
        throw new Error("Invalid passenger scope");
      }
    } else {
      const bag = decoded as Extract<
        SelfServiceCapability,
        { kind: "bag-drop-admission" | "bag-drop-session" }
      >;
      if (!Number.isInteger(bag.passengerId) || bag.passengerId <= 0) {
        throw new Error("Invalid passenger scope");
      }
      if (
        bag.kind === "bag-drop-admission" &&
        (!Number.isSafeInteger(bag.flightId) ||
          bag.flightId <= 0 ||
          !/^[a-f0-9]{64}$/.test(bag.passDigest))
      )
        throw new Error("Missing boarding pass scope");
      if (
        expectedKind === "bag-drop-session" &&
        (!Number.isInteger((bag as { sessionId?: number }).sessionId) ||
          (bag as { sessionId: number }).sessionId <= 0)
      ) {
        throw new Error("Invalid bag-drop session scope");
      }
    }

    return decoded as Extract<SelfServiceCapability, { kind: K }>;
  } catch (error) {
    if (error instanceof TRPCError) throw error;
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Invalid, expired, or out-of-scope self-service capability",
    });
  }
}

/**
 * Gate for any path that executes an assistant-surfaced alternative. The
 * token alone is not enough: it must belong to the acting user, name the
 * same suggestion, and carry the amount and offer version the execution is
 * about to commit. Absence is UNAUTHORIZED, another user's token is
 * FORBIDDEN, a stale price or version is PRECONDITION_FAILED so the client
 * fetches alternatives again instead of silently paying a different amount.
 */
export function assertAssistantExecutionAuthorised(
  token: string | null | undefined,
  expected: {
    userId: number;
    suggestionId: number;
    amount: number;
    offerVersion: string;
  },
  opts: { secret?: string } = {}
): AssistantExecutionCapability {
  if (!token)
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Executing an assistant alternative requires an authorisation",
    });
  const capability = verifySelfServiceCapability(
    token,
    "assistant-execution",
    opts
  );
  if (capability.userId !== expected.userId)
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Authorisation belongs to a different user",
    });
  if (capability.suggestionId !== expected.suggestionId)
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Authorisation names a different alternative",
    });
  if (
    capability.amount !== expected.amount ||
    capability.offerVersion !== expected.offerVersion
  )
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "The alternative was repriced after it was authorised; fetch alternatives again",
    });
  return capability;
}

export function assertPassengerInKioskCapability(
  capability: Extract<SelfServiceCapability, { kind: "kiosk-session" }>,
  passengerId: number
): void {
  if (!capability.passengerIds.includes(passengerId)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Passenger is outside this kiosk session",
    });
  }
}
