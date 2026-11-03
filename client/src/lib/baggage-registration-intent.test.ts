import { beforeEach, expect, it } from "vitest";
import {
  bagRegistrationStorageKey,
  clearBagRegistration,
  readBagRegistration,
  recoverBagRegistration,
  saveBagRegistration,
  startBagRegistrationAttempt,
  type BagRegistrationCommand,
} from "./baggage-registration-intent";

const scope = {
  actorId: 17,
  tenantId: 4,
  bookingId: 82,
  passengerId: 92,
  flightId: 41,
  segmentId: 102,
};
const command: BagRegistrationCommand = {
  bookingId: 82,
  passengerId: 92,
  flightId: 41,
  segmentId: 102,
  weight: 5,
  description: "Blue cabin bag",
  specialHandling: "Fragile",
  idempotencyKey: crypto.randomUUID(),
  expectedActorId: scope.actorId,
  expectedTenantId: scope.tenantId,
};

beforeEach(() => sessionStorage.clear());

it("restores the complete original request without inventing a key or an expiry", () => {
  saveBagRegistration(sessionStorage, scope, command);
  expect(readBagRegistration(sessionStorage, scope)).toEqual(command);
  expect(recoverBagRegistration(sessionStorage, scope, command)).toEqual(
    command
  );
  expect(
    JSON.parse(sessionStorage.getItem(bagRegistrationStorageKey(scope))!)
  ).toEqual({
    version: 1,
    actorId: scope.actorId,
    tenantId: scope.tenantId,
    latestAttemptId: null,
    command,
  });
});

it("refuses to overwrite or acknowledge a different pending command", () => {
  saveBagRegistration(sessionStorage, scope, command);
  const other = { ...command, weight: 6, idempotencyKey: crypto.randomUUID() };
  expect(() => saveBagRegistration(sessionStorage, scope, other)).toThrow();
  expect(() => clearBagRegistration(sessionStorage, scope, other)).toThrow();
  expect(() => recoverBagRegistration(sessionStorage, scope, other)).toThrow();
  expect(readBagRegistration(sessionStorage, scope)).toEqual(command);
  clearBagRegistration(sessionStorage, scope, command);
  expect(readBagRegistration(sessionStorage, scope)).toBeNull();
});

it("does not let an earlier failed attempt erase a newer retry", () => {
  saveBagRegistration(sessionStorage, scope, command);
  const first = startBagRegistrationAttempt(sessionStorage, scope, command);
  const retry = startBagRegistrationAttempt(sessionStorage, scope, command);
  expect(retry).not.toBe(first);
  expect(clearBagRegistration(sessionStorage, scope, command, first)).toBe(
    false
  );
  expect(readBagRegistration(sessionStorage, scope)).toEqual(command);
  expect(clearBagRegistration(sessionStorage, scope, command, retry)).toBe(
    true
  );
  expect(readBagRegistration(sessionStorage, scope)).toBeNull();
});

it.each([
  "actorId",
  "tenantId",
  "bookingId",
  "passengerId",
  "flightId",
  "segmentId",
] as const)(
  "isolates a different %s and rejects a copied foreign record",
  field => {
    saveBagRegistration(sessionStorage, scope, command);
    const other = { ...scope, [field]: scope[field] + 1 };
    expect(readBagRegistration(sessionStorage, other)).toBeNull();
    const original = sessionStorage.getItem(bagRegistrationStorageKey(scope))!;
    sessionStorage.setItem(bagRegistrationStorageKey(other), original);
    expect(() => readBagRegistration(sessionStorage, other)).toThrow();
    expect(readBagRegistration(sessionStorage, scope)).toEqual(command);
  }
);

it.each([
  { version: 2 },
  { command: { ...command, idempotencyKey: "invalid-key" } },
  { command: { ...command, weight: 0 } },
  { command: { ...command, weight: 33 } },
  { command: { ...command, weight: 5.001 } },
  { command: { ...command, description: "x".repeat(501) } },
  { command: { ...command, unexpected: "untrusted" } },
  { command: { ...command, expectedActorId: 18 } },
  { command: { ...command, expectedTenantId: 5 } },
])(
  "keeps an invalid stored record blocked without replacing it: %j",
  change => {
    const raw = JSON.stringify({
      version: 1,
      actorId: scope.actorId,
      tenantId: scope.tenantId,
      latestAttemptId: null,
      command,
      ...change,
    });
    const key = bagRegistrationStorageKey(scope);
    sessionStorage.setItem(key, raw);
    expect(() => readBagRegistration(sessionStorage, scope)).toThrow();
    expect(() => saveBagRegistration(sessionStorage, scope, command)).toThrow();
    expect(sessionStorage.getItem(key)).toBe(raw);
  }
);
