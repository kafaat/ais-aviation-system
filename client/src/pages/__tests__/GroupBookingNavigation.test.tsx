import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { Route, Router, Switch } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { createTrpcFixture } from "@/test/trpc-fixture";
import { FlightCompareProvider } from "@/contexts/FlightCompareContext";
import { TooltipProvider } from "@/components/ui/tooltip";
import i18n from "@/i18n/config";
import SearchResults from "../SearchResults";
import GroupBookingRequest from "../GroupBookingRequest";

function visit(signedIn = true, economyAvailable = 20) {
  const flight = {
    id: 451,
    flightNumber: "JA451",
    status: "scheduled",
    departureTime: new Date("2027-02-01T08:00:00Z"),
    arrivalTime: new Date("2027-02-01T10:00:00Z"),
    economyAvailable,
    businessAvailable: 25,
    economyPrice: 50000,
    businessPrice: 150000,
    airline: { id: 1, name: "Journey Air", code: "JA", logo: null },
    origin: { id: 1, code: "RUH", city: "Riyadh", timezone: "Asia/Riyadh" },
    destination: {
      id: 2,
      code: "JED",
      city: "Jeddah",
      timezone: "Asia/Riyadh",
    },
  };
  const submit = vi.fn(() => ({
    id: 72,
    suggestedDiscount: 5,
    message: "Request awaiting review",
  }));
  const fixture = createTrpcFixture({
    "auth.me": () =>
      signedIn ? { id: 23, role: "user", email: "owner@example.test" } : null,
    "ibePublic.config": () => ({
      brandName: "Journey Air",
      logoPath: null,
      embedSearchEnabled: false,
    }),
    "flights.search": () => [flight],
    "flights.statusBatch": () => [
      { flightId: flight.id, status: "scheduled", lastUpdated: new Date() },
    ],
    "favorites.getAll": () => [],
    "reference.airports": () => [flight.origin, flight.destination],
    "flights.getById": () => flight,
    "groupBookings.calculateDiscount": () => ({
      groupSize: 10,
      discountPercent: 5,
      tier: "Small",
      eligible: true,
    }),
    "groupBookings.getDiscountTiers": () => ({ minGroupSize: 10, tiers: [] }),
    "groupBookings.submitRequest": submit,
  });
  const route = memoryLocation({
    path: "/search?origin=1&destination=2&date=2027-02-01",
    record: true,
  });
  render(
    <fixture.Wrapper>
      <FlightCompareProvider>
        <TooltipProvider>
          <Router hook={route.hook}>
            <Switch>
              <Route path="/search">
                <SearchResults />
              </Route>
              <Route path="/group-booking/:id">
                <GroupBookingRequest />
              </Route>
              <Route path="/login">
                <h1>Sign in to continue</h1>
              </Route>
            </Switch>
          </Router>
        </TooltipProvider>
      </FlightCompareProvider>
    </fixture.Wrapper>
  );
  return { ...fixture, route, submit };
}

beforeEach(async () => {
  await i18n.changeLanguage("en");
  window.history.replaceState(null, "", "/");
});

it("carries the selected flight from search to the real group request form and mutation", async () => {
  const fixture = visit();
  await userEvent.click(
    await screen.findByRole("link", { name: "Group Booking Request" })
  );
  expect(
    await screen.findByRole("heading", { name: "Group Booking Request" })
  ).toBeVisible();
  expect(screen.getByRole("heading", { name: "JA451" })).toBeVisible();
  expect(
    fixture.requests.find(r => r.path === "flights.getById")?.input
  ).toEqual({ id: 451 });
  await userEvent.type(screen.getByLabelText(/Full Name/), "Group Organizer");
  await userEvent.type(
    screen.getByLabelText(/Email Address/),
    "owner@example.test"
  );
  await userEvent.type(screen.getByLabelText(/Phone Number/), "+966500000000");
  await userEvent.click(
    screen.getByRole("button", { name: "Submit Group Booking Request" })
  );
  await waitFor(() =>
    expect(fixture.submit).toHaveBeenCalledWith({
      organizerName: "Group Organizer",
      organizerEmail: "owner@example.test",
      organizerPhone: "+966500000000",
      groupSize: 10,
      notes: "",
      flightId: 451,
    })
  );
  expect(
    await screen.findByRole("heading", {
      name: "Request Submitted Successfully",
    })
  ).toBeVisible();
});

it("sends a guest to sign-in before requesting a group and retains the selected flight", async () => {
  const fixture = visit(false);
  await userEvent.click(
    await screen.findByRole("link", { name: "Group Booking Request" })
  );
  expect(
    await screen.findByRole("heading", { name: "Sign in to continue" })
  ).toBeVisible();
  expect(fixture.route.history.at(-1)).toBe(
    "/login?returnTo=%2Fgroup-booking%2F451"
  );
  expect(fixture.requests.some(r => r.path.startsWith("groupBookings."))).toBe(
    false
  );
});

it("does not offer the economy group flow when only business has ten seats", async () => {
  visit(true, 9);
  expect(await screen.findByTestId("flight-card")).toBeVisible();
  expect(
    screen.queryByRole("link", { name: "Group Booking Request" })
  ).toBeNull();
});
