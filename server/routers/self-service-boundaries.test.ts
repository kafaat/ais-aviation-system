import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("self-service router authority boundaries", () => {
  const kiosk = readFileSync(new URL("./kiosk.ts", import.meta.url), "utf8");
  const bagDrop = readFileSync(
    new URL("./bag-drop.ts", import.meta.url),
    "utf8"
  );

  it("does not accept raw kiosk booking identifiers after authentication", () => {
    expect(kiosk).toContain("capabilityToken");
    expect(kiosk).toContain("assertPassengerInKioskCapability");
    expect(kiosk).not.toMatch(/bookingId:\s*z\.number/);
  });

  it("requires signed boarding-pass admission for bag drop", () => {
    expect(bagDrop).toContain("verifyBoardingPass");
    expect(bagDrop).toContain('"bag-drop-admission"');
    expect(bagDrop).toContain('"bag-drop-session"');
    expect(bagDrop).not.toMatch(/bookingId:\s*z\.number/);
    expect(bagDrop).not.toMatch(/passengerId:\s*z\.number/);
  });

  it("does not accept a client-provided payment amount or mark it paid", () => {
    expect(bagDrop).not.toMatch(/amount:\s*z\.number/);
    expect(bagDrop).not.toContain("bagDropService.processPayment");
    expect(bagDrop).toContain("PRECONDITION_FAILED");
  });
});
