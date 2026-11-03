/**
 * Idempotency keys versus trace identifiers (workstream 13).
 *
 * Two identifiers travel with every money-moving operation and they must
 * never be confused:
 *
 * - The **operation key** names the financial operation. It is derived only
 *   from the operation's natural identity (the booking, the split share, the
 *   refund item, the top-up request, the frozen checkout claim) and therefore
 *   stays the same across every attempt: the customer's double click, the
 *   client's automatic retry, the worker's redelivery, the operator's manual
 *   re-run. It is what the provider receives as `Idempotency-Key`, and what
 *   `idempotency_requests` stores with the cached response and the
 *   in-progress lock. A key that contains a timestamp, a random id generated
 *   per call, an attempt counter or a trace id is not an operation key: it
 *   makes each retry a new operation, which is how a retry becomes a second
 *   charge.
 *
 * - The **trace id** names one attempt. It changes with every attempt by
 *   design, so the logs, the OpenTelemetry span and the provider request log
 *   can be lined up to see which attempt did what. It goes into logs and
 *   spans. It never goes into the operation key, and it never goes into a
 *   request body that is sent under an idempotency key: Stripe rejects a
 *   replay whose parameters differ from the first attempt, so a per-attempt
 *   field inside the keyed body turns the safe replay into an error.
 *
 * Call-site rule: `operationKey()` for the identity, `providerRequestOptions()`
 * when the call goes to Stripe, `runIdempotentOperation()` when the result must
 * be cached locally and concurrent attempts refused, and `traceId()` only for
 * logging and span attributes.
 */
import { TRPCError } from "@trpc/server";
import { createServiceLogger } from "./logger";
import { currentTrace } from "./trace";
import { newTraceContext } from "../../shared/trace-context";
import {
  withIdempotency,
  type IdempotencyScope,
} from "../services/idempotency-v2.service";

const log = createServiceLogger("idempotency");

/** Keys are stored in a VARCHAR(255) and Stripe accepts at most 255 chars. */
export const MAX_OPERATION_KEY_LENGTH = 255;
const SCOPE_PATTERN = /^[a-z][a-z0-9._-]*$/;
const PART_PATTERN = /^[A-Za-z0-9._:-]+$/;

export type NaturalKeyPart = string | number;

export interface OperationKey {
  /** Where the key is valid, e.g. `modification.checkout`. */
  readonly scope: string;
  /** The natural identity inside the scope, e.g. `17:5000`. */
  readonly key: string;
  /** `scope:key`, the value handed to a provider as its idempotency key. */
  readonly value: string;
}

export class InvalidOperationKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidOperationKeyError";
  }
}

function formatPart(part: NaturalKeyPart): string {
  if (typeof part === "number") {
    if (!Number.isSafeInteger(part))
      throw new InvalidOperationKeyError(
        "Operation key parts must be safe integers or strings"
      );
    return String(part);
  }
  if (!part || !PART_PATTERN.test(part))
    throw new InvalidOperationKeyError(
      "Operation key parts must be non-empty [A-Za-z0-9._:-] strings"
    );
  // Escape the separator inside a component so distinct tuples stay distinct.
  return part.replace(/:/g, "%3A");
}

/**
 * Build the stable key of one financial operation.
 *
 * `naturalKey` must be the identity of the operation (row ids, provider
 * object ids, a persisted request id), never something minted for this
 * attempt. The function cannot tell a persisted UUID from a fresh one, so the
 * caller carries that responsibility; it can and does reject empty parts,
 * non-integer numbers, unsafe characters and oversize keys.
 */
export function operationKey(
  scope: string,
  naturalKey: NaturalKeyPart | readonly NaturalKeyPart[]
): OperationKey {
  if (!SCOPE_PATTERN.test(scope))
    throw new InvalidOperationKeyError(
      "Operation scope must be lower-case dotted identifier"
    );
  const parts = Array.isArray(naturalKey)
    ? (naturalKey as readonly NaturalKeyPart[])
    : [naturalKey as NaturalKeyPart];
  if (!parts.length)
    throw new InvalidOperationKeyError("Operation key requires a natural key");
  const key = parts.map(formatPart).join(":");
  const value = `${scope}:${key}`;
  if (value.length > MAX_OPERATION_KEY_LENGTH)
    throw new InvalidOperationKeyError(
      `Operation key exceeds ${MAX_OPERATION_KEY_LENGTH} characters`
    );
  return Object.freeze({ scope, key, value });
}

/**
 * The trace id of the current attempt: the ambient W3C trace when an entry
 * point established one, otherwise a fresh one for this attempt. It is for
 * logs and spans only. It is never an idempotency key and never part of one.
 */
export function traceId(): string {
  return currentTrace()?.traceId ?? newTraceContext().traceId;
}

export function requireSafeCheckoutReplay(startedAt: number) {
  const age = Date.now() - startedAt;
  if (!Number.isFinite(age) || age < 0 || age >= 23 * 3600_000)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Checkout outcome requires provider reconciliation",
    });
}

/** Stripe request options for a keyed call. Retries are owned by the caller's
 * own replay logic, so the SDK's transparent network retry is disabled and a
 * hung call fails fast instead of holding the operation lock. */
export function providerRequestOptions(key: OperationKey | string): {
  idempotencyKey: string;
  timeout: number;
  maxNetworkRetries: 0;
} {
  const idempotencyKey = typeof key === "string" ? key : key?.value;
  if (
    typeof idempotencyKey !== "string" ||
    !idempotencyKey.length ||
    idempotencyKey.length > MAX_OPERATION_KEY_LENGTH ||
    /[^\x21-\x7e]/.test(idempotencyKey)
  )
    throw new InvalidOperationKeyError("Provider idempotency key is invalid");
  return { idempotencyKey, timeout: 15000, maxNetworkRetries: 0 };
}

export interface IdempotentOperation<T> {
  key: OperationKey;
  /** The owner of the operation; null for system/webhook work. */
  userId: number | null;
  /** The request, hashed to detect a key reused with a different payload. */
  request: unknown;
  /** How long a result or an in-progress lock is retained. */
  ttlSeconds?: number;
  run: () => Promise<T>;
}

/**
 * Run a financial operation once per key.
 *
 * Backed by `idempotency_requests`: a completed key replays the stored
 * response without calling `run`, a key still in progress is refused with
 * `IDEMPOTENCY_IN_PROGRESS`, a failed key may be retried. Each attempt is
 * logged with the stable key and its own trace id, so the two can be read
 * side by side. For DB-only commands that must commit atomically with their
 * receipt, use `withTransactionalIdempotency` from idempotency-v2 instead.
 */
export async function runIdempotentOperation<T>(
  operation: IdempotentOperation<T>
): Promise<T> {
  const attempt = {
    scope: operation.key.scope,
    key: operation.key.key,
    userId: operation.userId,
    traceId: traceId(),
  };
  let executed = false;
  log.info({ ...attempt, phase: "attempt" }, "Idempotent operation attempt");
  try {
    const result = await withIdempotency<T>({
      scope: operation.key.scope as IdempotencyScope,
      key: operation.key.key,
      userId: operation.userId,
      request: operation.request,
      ttlSeconds: operation.ttlSeconds,
      run: () => {
        executed = true;
        return operation.run();
      },
    });
    log.info(
      { ...attempt, phase: executed ? "completed" : "replayed" },
      executed
        ? "Idempotent operation completed"
        : "Idempotent operation replayed stored result"
    );
    return result;
  } catch (error) {
    const code = (error as { code?: string }).code;
    log.warn(
      {
        ...attempt,
        phase: code === "IDEMPOTENCY_IN_PROGRESS" ? "in_progress" : "failed",
        errorCode: code,
      },
      "Idempotent operation did not complete"
    );
    throw error;
  }
}
