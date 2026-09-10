import { expect, it } from "vitest";
import { appRouter } from "../routers";
import { responseContracts as providers } from "../contracts/travel-agent";
import { responseContracts as booking } from "../contracts/bookings";
import { outputNumber, structuredValue } from "../contracts/primitives";
it("requires an explicit output contract for every runtime procedure", () => {
  const missing = Object.entries(appRouter._def.procedures)
    .filter(([, procedure]) => !(procedure._def as { output?: unknown }).output)
    .map(([name]) => name);
  expect(missing).toEqual([]);
});
it("strips unexpected internal fields and fails broken producer responses", () => {
  const dto = {
    bookingId: 1,
    bookingReference: "AB1234",
    pnr: "CD1234",
    totalAmount: 10000,
    lockId: 1,
  };
  const parsed = booking.create.parse({
    ...dto,
    passwordHash: "INTERNAL",
    paymentSecret: "INTERNAL",
  });
  expect(parsed).not.toHaveProperty("passwordHash");
  expect(parsed).not.toHaveProperty("paymentSecret");
  expect(() =>
    booking.create.parse({ ...dto, bookingId: "invalid" })
  ).toThrow();
});
it("omits stored agency secrets from reads and registration's nested agent", () => {
  expect(Object.keys(providers.getById.shape)).not.toContain("apiSecret");
  expect(Object.keys(providers.register.shape.agent.shape)).not.toContain(
    "apiSecret"
  );
  expect(Object.keys(providers.register.shape.credentials.shape)).toContain(
    "apiSecret"
  );
});
it("validates extensible metadata and decimal aggregates without treating missing values as zero", () => {
  expect(outputNumber.parse("42.5")).toBe(42.5);
  for (const invalid of ["", null, undefined, Infinity, "NaN"])
    expect(outputNumber.safeParse(invalid).success).toBe(false);
  expect(
    structuredValue.parse({ details: { tokenHash: "INTERNAL", status: "ok" } })
  ).toEqual({ details: { status: "ok" } });
  expect(structuredValue.safeParse({ fn: () => true }).success).toBe(false);
});
