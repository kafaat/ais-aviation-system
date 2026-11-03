import { z } from "zod";
import type { inferRouterInputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";

export type BagRegistrationCommand =
  inferRouterInputs<AppRouter>["baggage"]["register"];
export type BagRegistrationScope = Pick<
  BagRegistrationCommand,
  "bookingId" | "passengerId" | "flightId" | "segmentId"
> & { actorId: number; tenantId: number };

const identifier = z.number().int().positive().safe();
const scopeSchema = z
  .object({
    actorId: identifier,
    tenantId: identifier,
    bookingId: identifier,
    passengerId: identifier,
    flightId: identifier,
    segmentId: identifier,
  })
  .strict();
const commandSchema = z
  .object({
    bookingId: identifier,
    passengerId: identifier,
    flightId: identifier,
    segmentId: identifier,
    weight: z
      .number()
      .positive()
      .max(32)
      .refine(value => Math.abs(value * 100 - Math.round(value * 100)) <= 1e-8),
    idempotencyKey: z.string().uuid(),
    expectedActorId: identifier,
    expectedTenantId: identifier,
    description: z.string().max(500).optional(),
    specialHandling: z.string().max(255).optional(),
  })
  .strict();
const recordSchema = z
  .object({
    version: z.literal(1),
    actorId: identifier,
    tenantId: identifier,
    latestAttemptId: z.string().uuid().nullable(),
    command: commandSchema,
  })
  .strict();
const changeEvent = "ais:dcs:bag-registration-changed";

function notifyBagRegistration(key: string) {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(changeEvent, { detail: key }));
  }
}

/** Session storage has no native storage event in the window that wrote it. */
export function observeBagRegistration(
  scope: BagRegistrationScope,
  changed: () => void
) {
  const key = bagRegistrationStorageKey(scope);
  const listener = (event: Event) => {
    if (event instanceof CustomEvent && event.detail === key) changed();
  };
  window.addEventListener(changeEvent, listener);
  return () => window.removeEventListener(changeEvent, listener);
}

/** Same-tab recovery only. No credentials and no expiry for an uncertain result. */
export function bagRegistrationStorageKey(scope: BagRegistrationScope) {
  const parsed = scopeSchema.parse(scope);
  return `ais:dcs:bag-registration:v1:${parsed.actorId}:${parsed.tenantId}:${parsed.bookingId}:${parsed.passengerId}:${parsed.flightId}:${parsed.segmentId}`;
}

function sameCommand(a: BagRegistrationCommand, b: BagRegistrationCommand) {
  return (
    JSON.stringify(commandSchema.parse(a)) ===
    JSON.stringify(commandSchema.parse(b))
  );
}

function scopedRecord(scope: BagRegistrationScope, value: unknown) {
  const record = recordSchema.parse(value);
  if (
    record.actorId !== scope.actorId ||
    record.tenantId !== scope.tenantId ||
    record.command.expectedActorId !== scope.actorId ||
    record.command.expectedTenantId !== scope.tenantId ||
    record.command.bookingId !== scope.bookingId ||
    record.command.passengerId !== scope.passengerId ||
    record.command.flightId !== scope.flightId ||
    record.command.segmentId !== scope.segmentId
  ) {
    throw new Error("Saved baggage registration scope does not match");
  }
  return record;
}

export function readBagRegistration(
  storage: Storage,
  scope: BagRegistrationScope
): BagRegistrationCommand | null {
  const stored = storage.getItem(bagRegistrationStorageKey(scope));
  if (stored === null) return null;
  return scopedRecord(scope, JSON.parse(stored)).command;
}

function writeRecord(
  storage: Storage,
  scope: BagRegistrationScope,
  record: z.infer<typeof recordSchema>
) {
  const key = bagRegistrationStorageKey(scope);
  const encoded = JSON.stringify(record);
  storage.setItem(key, encoded);
  if (storage.getItem(key) !== encoded) {
    throw new Error("Baggage registration recovery data was not saved");
  }
  notifyBagRegistration(key);
}

/** Persist and verify the complete command before any request can leave the tab. */
export function saveBagRegistration(
  storage: Storage,
  scope: BagRegistrationScope,
  command: BagRegistrationCommand
) {
  const record = scopedRecord(scope, {
    version: 1,
    actorId: scope.actorId,
    tenantId: scope.tenantId,
    latestAttemptId: null,
    command,
  });
  const existing = readBagRegistration(storage, scope);
  if (existing && !sameCommand(existing, record.command)) {
    throw new Error("An earlier baggage registration still requires recovery");
  }
  if (!existing) writeRecord(storage, scope, record);
  return record.command;
}

/** A late rejection must not discard a retry sent by a restored component. */
export function startBagRegistrationAttempt(
  storage: Storage,
  scope: BagRegistrationScope,
  command: BagRegistrationCommand
) {
  const stored = storage.getItem(bagRegistrationStorageKey(scope));
  if (stored === null) throw new Error("Saved baggage registration is missing");
  const record = scopedRecord(scope, JSON.parse(stored));
  if (!sameCommand(record.command, command)) {
    throw new Error("Saved baggage registration changed before retry");
  }
  const latestAttemptId = crypto.randomUUID();
  writeRecord(storage, scope, { ...record, latestAttemptId });
  return latestAttemptId;
}

/** Only the exact acknowledged/rejected command may clear its stored receipt. */
export function clearBagRegistration(
  storage: Storage,
  scope: BagRegistrationScope,
  command: BagRegistrationCommand,
  rejectedAttemptId?: string
) {
  const key = bagRegistrationStorageKey(scope);
  const encoded = storage.getItem(key);
  if (encoded === null) return rejectedAttemptId === undefined;
  const record = scopedRecord(scope, JSON.parse(encoded));
  if (!sameCommand(record.command, command)) {
    throw new Error(
      "Saved baggage registration changed before acknowledgement"
    );
  }
  if (
    rejectedAttemptId !== undefined &&
    record.latestAttemptId !== rejectedAttemptId
  )
    return false;
  storage.removeItem(key);
  if (storage.getItem(key) !== null) {
    throw new Error("Baggage registration acknowledgement could not be saved");
  }
  notifyBagRegistration(key);
  return true;
}

export function recoverBagRegistration(
  storage: Storage,
  scope: BagRegistrationScope,
  command: BagRegistrationCommand
) {
  const stored = readBagRegistration(storage, scope);
  if (!stored || !sameCommand(stored, command)) {
    throw new Error("The pending baggage registration could not be recovered");
  }
  return stored;
}
