import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import App from "@/App";
import i18n from "@/i18n/config";
import { createTrpcFixture } from "@/test/trpc-fixture";

const page = vi.hoisted(() => ({
  failure: new Error("Fixture route render failure"),
  shouldThrow: true,
}));

// Substitute the route's child, not React.lazy, the router or either boundary.
// Rendering App must drive its real error lifecycle and fallback handlers.
vi.mock("@/pages/Home", () => ({
  default: function UnstableHome() {
    if (page.shouldThrow) throw page.failure;
    return <h1>Recovered home route</h1>;
  },
}));

beforeAll(async () => {
  await i18n.changeLanguage("en");
});

beforeEach(() => {
  page.shouldThrow = true;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

function visitHome() {
  const route = memoryLocation({ path: "/", record: true });
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
  return route;
}

it("catches a routed render error in App's own boundary and recovers through its retry button", async () => {
  const route = visitHome();

  expect(
    await screen.findByRole("heading", {
      name: i18n.t("errorBoundary.failedToLoad"),
    })
  ).toBeVisible();
  expect(screen.getByText(i18n.t("errorBoundary.errorMessage"))).toBeVisible();
  expect(console.error).toHaveBeenCalledWith(
    "Route loading error:",
    page.failure
  );
  expect(console.error).toHaveBeenCalledWith(
    "Component stack:",
    expect.stringContaining("UnstableHome")
  );
  expect(screen.queryByText("Fixture route render failure")).toBeNull();
  expect(screen.queryByText("Recovered home route")).toBeNull();

  page.shouldThrow = false;
  fireEvent.click(
    screen.getByRole("button", { name: i18n.t("errorBoundary.tryAgain") })
  );

  expect(
    await screen.findByRole("heading", { name: "Recovered home route" })
  ).toBeVisible();
  expect(
    screen.queryByRole("heading", {
      name: i18n.t("errorBoundary.failedToLoad"),
    })
  ).toBeNull();
  expect(route.history.at(-1)).toBe("/");
});

it("keeps the route fallback usable when retry encounters the same render failure", async () => {
  visitHome();
  const retry = await screen.findByRole("button", {
    name: i18n.t("errorBoundary.tryAgain"),
  });
  const caughtErrors = () =>
    vi
      .mocked(console.error)
      .mock.calls.filter(([message]) => message === "Route loading error:");
  expect(caughtErrors()).toHaveLength(1);

  fireEvent.click(retry);

  await waitFor(() => expect(caughtErrors()).toHaveLength(2));
  expect(
    screen.getByRole("heading", {
      name: i18n.t("errorBoundary.failedToLoad"),
    })
  ).toBeVisible();
  expect(
    screen.getByRole("button", { name: i18n.t("errorBoundary.tryAgain") })
  ).toBeEnabled();
  expect(
    screen.getByRole("button", { name: i18n.t("errorBoundary.goHome") })
  ).toBeEnabled();
});
