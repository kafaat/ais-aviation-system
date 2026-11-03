import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { Route, Router, Switch, useLocation } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { loginPath } from "@shared/return-to";
import { useRawSearch } from "@/lib/useRawSearch";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AdminRoute } from "@/components/AdminRoute";
import Login from "../Login";
import BookingPage from "../BookingPage";
import SearchResults from "../SearchResults";

const state = vi.hoisted(() => ({
  user: null as { id: number; role: string } | null,
  mfa: false,
  login: vi.fn(),
  register: vi.fn(),
  completeMfa: vi.fn(),
  refresh: vi.fn(),
}));
type Callbacks<T> = { onSuccess: (data: T) => void | Promise<void> };
vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({
    user: state.user,
    loading: false,
    isAuthenticated: !!state.user,
    refresh: state.refresh,
  }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));
vi.mock("@/const", () => ({
  APP_LOGO: "#",
  getLoginUrl: () => "#login-not-configured",
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    auth: {
      login: {
        useMutation: (
          options: Callbacks<
            { mfaRequired: boolean; challengeToken: string } | { id: number }
          >
        ) => ({
          isPending: false,
          mutate: (input: unknown) => {
            state.login(input);
            void options.onSuccess(
              state.mfa
                ? { mfaRequired: true, challengeToken: "test-challenge" }
                : { id: 1 }
            );
          },
        }),
      },
      register: {
        useMutation: (options: Callbacks<undefined>) => ({
          isPending: false,
          mutate: (input: unknown) => {
            state.register(input);
            void options.onSuccess(undefined);
          },
        }),
      },
      completeMfa: {
        useMutation: (options: Callbacks<undefined>) => ({
          isPending: false,
          mutate: (input: unknown) => {
            state.completeMfa(input);
            void options.onSuccess(undefined);
          },
        }),
      },
    },
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  state.user = null;
  state.mfa = false;
  state.refresh.mockImplementation(async () => {
    state.user = { id: 1, role: "user" };
  });
});

function LocationText() {
  const [path] = useLocation();
  const search = useRawSearch();
  return (
    <output data-testid="location">
      {path}
      {search ? `?${search}` : ""}
    </output>
  );
}
function renderFlow(path: string) {
  const location = memoryLocation({ path });
  render(
    <Router hook={location.hook}>
      <LocationText />
      <Switch>
        <Route path="/login">
          <Login />
        </Route>
        <Route path="/">
          <p>Public home</p>
        </Route>
        <Route>
          <ProtectedRoute>
            <p>Owned account page</p>
          </ProtectedRoute>
        </Route>
      </Switch>
    </Router>
  );
}
const locationText = () => screen.getByTestId("location").textContent;
function submitCredentials() {
  fireEvent.change(screen.getByLabelText("login.email"), {
    target: { value: "passenger@example.test" },
  });
  fireEvent.change(screen.getByLabelText("login.password"), {
    target: { value: "test-password" },
  });
  fireEvent.click(screen.getByTestId("login-submit"));
}

it("resumes the guarded page and its query after password login", async () => {
  const target = "/checkout/700?canceled=true&currency=USD";
  renderFlow(target);
  await screen.findByLabelText("login.email");
  expect(screen.queryByText("Owned account page")).not.toBeInTheDocument();
  expect(
    new URL(locationText()!, "https://ais.test").searchParams.get("returnTo")
  ).toBe(target);
  submitCredentials();
  await screen.findByText("Owned account page");
  expect(locationText()).toBe(target);
});

it("keeps a direct booking's nested search query encoded through login", async () => {
  const search = new URLSearchParams({
    origin: "1",
    destination: "2",
    date: "2030-11-15",
    currency: "USD",
    airline: "A&B 50%",
  });
  const target = `/booking/42?${new URLSearchParams({ class: "business", search: search.toString() })}`;
  renderFlow(target);
  await screen.findByLabelText("login.email");
  submitCredentials();
  await screen.findByText("Owned account page");
  expect(locationText()).toBe(target);
  const restored = new URL(
    locationText()!,
    "https://ais.test"
  ).searchParams.get("search")!;
  expect([...new URLSearchParams(restored)]).toEqual([...search]);
});

it("keeps the same destination when registration auto-logs in", async () => {
  const target = "/manage-booking?tab=services";
  renderFlow(loginPath(target));
  fireEvent.click(
    screen.getByRole("button", { name: "login.noAccountRegister" })
  );
  fireEvent.change(screen.getByLabelText("login.name"), {
    target: { value: "Test Passenger" },
  });
  submitCredentials();
  await screen.findByText("Owned account page");
  expect(state.register).toHaveBeenCalledWith({
    name: "Test Passenger",
    email: "passenger@example.test",
    password: "test-password",
  });
  expect(state.login).toHaveBeenCalledWith({
    email: "passenger@example.test",
    password: "test-password",
  });
  expect(locationText()).toBe(target);
});

it("preserves the complete multi-city data query through password login and real MFA UI", async () => {
  state.mfa = true;
  const data = JSON.stringify({
    version: 1,
    passengerCount: 2,
    cabinClass: "business",
    segments: [{ flightId: 42 }, { flightId: 43 }],
    searchLabel: "A&B 50% / عرض",
  });
  const target = `/booking/multi-city?${new URLSearchParams({ data, currency: "USD" })}`;
  renderFlow(target);
  await screen.findByLabelText("login.email");
  submitCredentials();
  fireEvent.change(await screen.findByLabelText("Verification Code"), {
    target: { value: "123456" },
  });
  await screen.findByText("Owned account page");
  expect(state.completeMfa).toHaveBeenCalledWith({
    challengeToken: "test-challenge",
    code: "123456",
  });
  expect(locationText()).toBe(target);
  expect(localStorage.setItem).not.toHaveBeenCalled();
});

it("removes the OAuth MFA token from the URL while preserving returnTo", async () => {
  const target = "/my-bookings?exchange=700";
  renderFlow(`${loginPath(target)}&mfaChallenge=oauth-challenge`);
  const code = await screen.findByLabelText("Verification Code");
  await waitFor(() => expect(locationText()).toBe(loginPath(target)));
  fireEvent.change(code, { target: { value: "123456" } });
  await screen.findByText("Owned account page");
  expect(state.completeMfa).toHaveBeenCalledWith({
    challengeToken: "oauth-challenge",
    code: "123456",
  });
  expect(locationText()).toBe(target);
});

it("retains the destination when returning from MFA to the password form", async () => {
  const target = "/booking/42?class=business";
  renderFlow(`${loginPath(target)}&mfaChallenge=oauth-challenge`);
  fireEvent.click(await screen.findByRole("button", { name: "Back" }));
  await screen.findByLabelText("login.email");
  expect(locationText()).toBe(loginPath(target));
  submitCredentials();
  await screen.findByText("Owned account page");
  expect(locationText()).toBe(target);
});

it.each(["//evil.test", "/%256cogin?returnTo=%2Fbooking%2F42"])(
  "falls back to home after login for an unsafe destination: %s",
  async target => {
    renderFlow(`/login?${new URLSearchParams({ returnTo: target })}`);
    submitCredentials();
    await screen.findByText("Public home");
    expect(locationText()).toBe("/");
  }
);

it("guards the actual booking form before asking for any passenger details", async () => {
  const target =
    "/booking/42?class=economy&search=origin%3D1%26destination%3D2%26date%3D2030-11-15";
  const location = memoryLocation({ path: target });
  render(
    <Router hook={location.hook}>
      <LocationText />
      <Switch>
        <Route path="/login">
          <Login />
        </Route>
        <Route path="/booking/:id">
          <BookingPage />
        </Route>
      </Switch>
    </Router>
  );
  await screen.findByLabelText("login.email");
  expect(
    screen.queryByLabelText("booking.passportNumber")
  ).not.toBeInTheDocument();
  expect(
    new URL(locationText()!, "https://ais.test").searchParams.get("returnTo")
  ).toBe(target);
  expect(localStorage.setItem).not.toHaveBeenCalled();
});

it.each(["/search", "/search?origin=1&destination=2&date=2030-02-31"])(
  "opens the existing public search entry point for an incomplete search: %s",
  async path => {
    const location = memoryLocation({ path });
    render(
      <Router hook={location.hook}>
        <LocationText />
        <Switch>
          <Route path="/search">
            <SearchResults />
          </Route>
          <Route path="/">
            <p>Public search entry</p>
          </Route>
        </Switch>
      </Router>
    );
    await screen.findByText("Public search entry");
    expect(locationText()).toBe("/");
  }
);

it("keeps the admin role restriction after authentication", async () => {
  state.user = { id: 1, role: "user" };
  const location = memoryLocation({ path: "/admin?tab=operations" });
  render(
    <Router hook={location.hook}>
      <LocationText />
      <Switch>
        <Route path="/admin">
          <AdminRoute>
            <p>Admin data</p>
          </AdminRoute>
        </Route>
        <Route path="/">
          <p>Public home</p>
        </Route>
      </Switch>
    </Router>
  );
  await screen.findByText("Public home");
  expect(screen.queryByText("Admin data")).not.toBeInTheDocument();
});
