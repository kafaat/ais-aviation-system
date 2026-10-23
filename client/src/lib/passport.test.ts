import { describe, expect, it } from "vitest";
import { hasValidOptionalPassport } from "@shared/passport";

describe("existing optional passport format policy", () => {
  it.each([undefined, "", "aB1234", "123456789012"])("accepts %s", value => {
    expect(hasValidOptionalPassport(value)).toBe(true);
  });
  it.each([
    "12345",
    "1234567890123",
    "ABC!234",
    " AB123456",
    "AB123456 ",
    "       ",
    "أب123456",
  ])("rejects %s", value => {
    expect(hasValidOptionalPassport(value)).toBe(false);
  });
});
