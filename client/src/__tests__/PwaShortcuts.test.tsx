import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { expect, it, vi } from "vitest";
import App from "@/App";
import { createTrpcFixture } from "@/test/trpc-fixture";

const manifest = JSON.parse(
  readFileSync(resolve(process.cwd(), "client/public/manifest.json"), "utf8")
) as {
  shortcuts: { name: string; url: string }[];
};

vi.mock("@/pages/SearchResults", () => ({
  default: () => <h1>Search flights route</h1>,
}));

vi.mock("@/pages/MyBookings", () => ({
  default: () => <h1>Private bookings route</h1>,
}));

vi.mock("@/pages/Login", () => ({
  default: () => <h1>Login route</h1>,
}));

function renderShortcut(name: string) {
  const shortcut = manifest.shortcuts.find(item => item.name === name);
  if (!shortcut) throw new Error(`Missing PWA shortcut: ${name}`);

  const route = memoryLocation({ path: shortcut.url, record: true });
  const fixture = createTrpcFixture({
    "auth.me": () => null,
    "consent.getMyConsent": () => ({ needsReconsent: false }),
  });
  render(
    <fixture.Wrapper>
      <Router hook={route.hook}>
        <App />
      </Router>
    </fixture.Wrapper>
  );
  return { route, shortcut };
}

it("opens the public search entrypoint from the Search Flights shortcut", async () => {
  const { route, shortcut } = renderShortcut("Search Flights");

  expect(
    await screen.findByRole("heading", { name: "Search flights route" })
  ).toBeVisible();
  expect(route.history.at(-1)).toBe(shortcut.url);
});

it("redirects an unauthenticated My Bookings shortcut to login", async () => {
  renderShortcut("My Bookings");

  expect(
    await screen.findByRole("heading", { name: "Login route" })
  ).toBeVisible();
  expect(
    screen.queryByRole("heading", { name: "Private bookings route" })
  ).not.toBeInTheDocument();
});
