import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const appSource = readFileSync("client/src/App.tsx", "utf8");

const protectedPaths = [
  "/my-bookings",
  "/profile",
  "/favorites",
  "/price-alerts",
  "/saved-passengers",
  "/notifications",
  "/my-waitlist",
  "/rebook/:bookingId",
  "/payment-history",
  "/corporate",
  "/corporate/bookings",
] as const;

function routeBody(path: string): string {
  const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = appSource.match(
    new RegExp(`<Route path="${escaped}">([\\s\\S]*?)<\\/Route>`)
  );
  expect(match, `route ${path} must exist`).not.toBeNull();
  return match?.[1] ?? "";
}

describe("account route protection contract", () => {
  it("imports the authenticated route guard", () => {
    expect(appSource).toContain(
      'import { ProtectedRoute } from "./components/ProtectedRoute";'
    );
  });

  for (const path of protectedPaths) {
    it(`protects ${path}`, () => {
      expect(routeBody(path)).toContain("<ProtectedRoute>");
      expect(routeBody(path)).toContain("</ProtectedRoute>");
    });
  }
});
