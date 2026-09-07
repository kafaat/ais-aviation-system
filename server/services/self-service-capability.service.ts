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
      bookingId: number;
      passengerId: number;
    }
  | {
      kind: "bag-drop-session";
      bookingId: number;
      passengerId: number;
      sessionId: number;
    };

const TTL_SECONDS: Record<SelfServiceCapability["kind"], number> = {
  "kiosk-session": 15 * 60,
  "bag-drop-admission": 5 * 60,
  "bag-drop-session": 10 * 60,
};

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
    expiresIn: opts.expiresInSeconds ?? TTL_SECONDS[capability.kind],
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
