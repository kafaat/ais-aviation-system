import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { getQueryKey } from "@trpc/react-query";
import { Router, Route } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { beforeEach, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { useAuth } from "@/_core/hooks/useAuth";
import Profile from "@/pages/Profile";
import i18n from "@/i18n/config";
import { trpc } from "@/lib/trpc";
import { createTrpcFixture, deferred } from "@/test/trpc-fixture";

const owner = { id: 23, email: "owner@example.test", role: "user" };
const savedPreferences = () => ({
  id: 17,
  userId: owner.id,
  createdAt: new Date("2026-01-02T12:00:00Z"),
  updatedAt: new Date("2026-01-02T12:00:00Z"),
  preferredSeatType: "aisle",
  preferredCabinClass: "business",
  mealPreference: "halal",
  wheelchairAssistance: false,
  extraLegroom: true,
  passportNumber: "AB123456",
  passportExpiry: new Date("2030-01-02T12:00:00Z"),
  nationality: "Saudi Arabia",
  phoneNumber: "+966501234567",
  emergencyContact: "Saved contact",
  emergencyPhone: "+966509876543",
  emailNotifications: false,
  smsNotifications: true,
  autoCheckIn: false,
});

type Replies = Parameters<typeof createTrpcFixture>[0];
function visit(replies: Replies = {}) {
  const fixture = createTrpcFixture({
    "auth.me": () => owner,
    "userPreferences.getMyPreferences": savedPreferences,
    ...replies,
  });
  const route = memoryLocation({ path: "/profile", record: true });
  render(
    <fixture.Wrapper>
      <Router hook={route.hook}>
        <Route path="/profile">
          <ProtectedRoute>
            <Profile />
          </ProtectedRoute>
        </Route>
        <Route path="/login">Sign in to continue</Route>
      </Router>
    </fixture.Wrapper>
  );
  return { ...fixture, route };
}

async function openPersonalInformation() {
  await userEvent.click(
    await screen.findByRole("tab", { name: "Personal Information" })
  );
  return screen.getByRole("textbox", { name: "Emergency Contact" });
}

beforeEach(async () => {
  await i18n.changeLanguage("en");
  window.history.replaceState(null, "", "/profile");
});

it("blocks a default save after a preference read failure and recovers with the stored values", async () => {
  let unavailable = true;
  const fixture = visit({
    "userPreferences.getMyPreferences": () => {
      if (unavailable) throw new Error("Fixture preference read unavailable");
      return savedPreferences();
    },
  });
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Could not load your preferences"
  );
  expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  expect(
    fixture.requests.some(r => r.path.endsWith("updateMyPreferences"))
  ).toBe(false);
  unavailable = false;
  await userEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(await openPersonalInformation()).toHaveValue("Saved contact");
  expect(screen.getByRole("textbox", { name: "Passport Number" })).toHaveValue(
    "AB123456"
  );
});

it("preserves dirty fields while applying refreshed server values to untouched fields", async () => {
  let preferences = savedPreferences();
  const fixture = visit({
    "userPreferences.getMyPreferences": () => preferences,
  });
  const contact = await openPersonalInformation();
  fireEvent.change(contact, { target: { value: "Unsaved contact" } });
  preferences = {
    ...preferences,
    emergencyContact: "Other browser contact",
    phoneNumber: "+966511111111",
  };
  await act(async () => {
    await fixture.cache.invalidateQueries({
      queryKey: getQueryKey(trpc.userPreferences.getMyPreferences),
    });
  });
  await waitFor(() =>
    expect(screen.getByRole("textbox", { name: "Phone Number" })).toHaveValue(
      "+966511111111"
    )
  );
  expect(contact).toHaveValue("Unsaved contact");
});

it("keeps an edit made during an outstanding save and accepts later refreshes after that edit is saved", async () => {
  let preferences = savedPreferences();
  const pending = deferred<ReturnType<typeof savedPreferences>>();
  const update = vi.fn((input: unknown) => {
    preferences = { ...preferences, ...(input as object) };
    return update.mock.calls.length === 1 ? pending.promise : preferences;
  });
  const fixture = visit({
    "userPreferences.getMyPreferences": () => preferences,
    "userPreferences.updateMyPreferences": update,
  });
  const contact = await openPersonalInformation();
  fireEvent.change(contact, { target: { value: "First saved contact" } });
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
  expect(screen.getByRole("button", { name: "Saving..." })).toBeDisabled();
  fireEvent.change(contact, { target: { value: "Newer unsaved contact" } });
  await act(async () => pending.resolve(preferences));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled()
  );
  await waitFor(() =>
    expect(
      fixture.requests.filter(r => r.path.endsWith("getMyPreferences"))
    ).toHaveLength(2)
  );
  expect(contact).toHaveValue("Newer unsaved contact");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(update).toHaveBeenCalledTimes(2));
  await waitFor(() =>
    expect(
      fixture.requests.filter(r => r.path.endsWith("getMyPreferences"))
    ).toHaveLength(3)
  );
  preferences = {
    ...preferences,
    emergencyContact: "Updated on another device",
  };
  await act(async () => {
    await fixture.cache.invalidateQueries({
      queryKey: getQueryKey(trpc.userPreferences.getMyPreferences),
    });
  });
  await waitFor(() => expect(contact).toHaveValue("Updated on another device"));
});

it("waits for authentication and redirects without requesting preferences for a signed-out visitor", async () => {
  const session = deferred<null>();
  const fixture = visit({ "auth.me": () => session.promise });
  await waitFor(() =>
    expect(fixture.requests.some(r => r.path === "auth.me")).toBe(true)
  );
  expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  expect(
    fixture.requests.some(r => r.path.startsWith("userPreferences."))
  ).toBe(false);
  await act(async () => session.resolve(null));
  expect(await screen.findByText("Sign in to continue")).toBeVisible();
  expect(fixture.route.history.at(-1)).toBe("/login?returnTo=%2Fprofile");
  expect(
    fixture.requests.some(r => r.path.startsWith("userPreferences."))
  ).toBe(false);
});

it("waits for preferences before saving defaults for an account with no stored preferences", async () => {
  const pending = deferred<null>();
  const update = vi.fn((input: unknown) => ({
    ...savedPreferences(),
    ...(input as object),
  }));
  const fixture = visit({
    "userPreferences.getMyPreferences": () => pending.promise,
    "userPreferences.updateMyPreferences": update,
  });
  await waitFor(() =>
    expect(
      fixture.requests.some(r => r.path.endsWith("getMyPreferences"))
    ).toBe(true)
  );
  expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  await act(async () => pending.resolve(null));
  await userEvent.click(await screen.findByRole("button", { name: "Save" }));
  await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
  expect(update.mock.calls[0][0]).toEqual({
    preferredSeatType: "window",
    preferredCabinClass: "economy",
    mealPreference: "regular",
    wheelchairAssistance: false,
    extraLegroom: false,
    passportNumber: "",
    passportExpiry: undefined,
    nationality: "",
    phoneNumber: "",
    emergencyContact: "",
    emergencyPhone: "",
    emailNotifications: true,
    smsNotifications: false,
  });
});

it("rejects invalid identity and contact fields, then sends corrected values and preserves stored false preferences", async () => {
  const update = vi.fn((input: unknown) => ({
    ...savedPreferences(),
    ...(input as object),
  }));
  visit({ "userPreferences.updateMyPreferences": update });
  await openPersonalInformation();
  const passport = screen.getByRole("textbox", { name: "Passport Number" });
  const phone = screen.getByRole("textbox", { name: "Phone Number" });
  const emergencyPhone = screen.getByRole("textbox", {
    name: "Emergency Phone",
  });
  fireEvent.change(passport, { target: { value: "bad!" } });
  fireEvent.change(phone, { target: { value: "invalid" } });
  fireEvent.change(emergencyPhone, { target: { value: "12" } });
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(update).not.toHaveBeenCalled();
  expect(passport).toHaveAttribute("aria-invalid", "true");
  expect(phone).toHaveAttribute("aria-invalid", "true");
  expect(emergencyPhone).toHaveAttribute("aria-invalid", "true");
  expect(screen.getAllByRole("alert")).toHaveLength(3);
  fireEvent.change(passport, { target: { value: "xy987654" } });
  fireEvent.change(phone, { target: { value: "+966500000001" } });
  fireEvent.change(emergencyPhone, { target: { value: "+966500000002" } });
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
  expect(update.mock.calls[0][0]).toEqual({
    preferredSeatType: "aisle",
    preferredCabinClass: "business",
    mealPreference: "halal",
    wheelchairAssistance: false,
    extraLegroom: true,
    passportNumber: "XY987654",
    passportExpiry: savedPreferences().passportExpiry,
    nationality: "Saudi Arabia",
    phoneNumber: "+966500000001",
    emergencyContact: "Saved contact",
    emergencyPhone: "+966500000002",
    emailNotifications: false,
    smsNotifications: true,
  });
  expect(screen.queryByRole("alert")).toBeNull();
});

it("retains edits after a failed save and only clears their protection after a successful retry", async () => {
  let preferences = savedPreferences();
  let unavailable = true;
  const feedback = vi.spyOn(toast, "error");
  const update = vi.fn((input: unknown) => {
    if (unavailable) throw new Error("Fixture save unavailable");
    preferences = { ...preferences, ...(input as object) };
    return preferences;
  });
  const fixture = visit({
    "userPreferences.getMyPreferences": () => preferences,
    "userPreferences.updateMyPreferences": update,
  });
  const contact = await openPersonalInformation();
  fireEvent.change(contact, { target: { value: "Retain after failure" } });
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(feedback).toHaveBeenCalledWith(
      "Failed to update preferences: Fixture save unavailable",
      expect.any(Object)
    )
  );
  expect(contact).toHaveValue("Retain after failure");
  preferences = { ...preferences, emergencyContact: "Unrelated server update" };
  await act(async () => {
    await fixture.cache.invalidateQueries({
      queryKey: getQueryKey(trpc.userPreferences.getMyPreferences),
    });
  });
  expect(contact).toHaveValue("Retain after failure");
  unavailable = false;
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(update).toHaveBeenCalledTimes(2));
  expect(update.mock.calls[1][0]).toMatchObject({
    emergencyContact: "Retain after failure",
  });
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled()
  );
  feedback.mockRestore();
});

it("blocks saves after a failed background refresh and preserves local edits through retry", async () => {
  let unavailable = false;
  let preferences = savedPreferences();
  const fixture = visit({
    "userPreferences.getMyPreferences": () => {
      if (unavailable) throw new Error("Fixture background read unavailable");
      return preferences;
    },
  });
  fireEvent.change(await openPersonalInformation(), {
    target: { value: "Keep across retry" },
  });
  unavailable = true;
  await act(async () => {
    await fixture.cache.invalidateQueries({
      queryKey: getQueryKey(trpc.userPreferences.getMyPreferences),
    });
  });
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Could not load your preferences"
  );
  expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  preferences = { ...preferences, nationality: "Updated nationality" };
  unavailable = false;
  await userEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(
    await screen.findByRole("textbox", { name: "Emergency Contact" })
  ).toHaveValue("Keep across retry");
  expect(screen.getByRole("textbox", { name: "Nationality" })).toHaveValue(
    "Updated nationality"
  );
});

it("shows the translated read failure and retry action in Arabic", async () => {
  await i18n.changeLanguage("ar");
  visit({
    "userPreferences.getMyPreferences": () => {
      throw new Error("Fixture read unavailable");
    },
  });
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "تعذّر تحميل تفضيلاتك. يرجى إعادة المحاولة قبل إجراء تغييرات."
  );
  expect(screen.getByRole("button", { name: "إعادة المحاولة" })).toBeEnabled();
});

it("does not recreate private preference cache when an outstanding save finishes after logout", async () => {
  const pending = deferred<ReturnType<typeof savedPreferences>>();
  const fixture = visit({
    "auth.logoutCookie": () => ({ success: true }),
    "userPreferences.updateMyPreferences": () => pending.promise,
  });
  const contact = await openPersonalInformation();
  fireEvent.change(contact, {
    target: { value: "Do not restore after logout" },
  });
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(
      fixture.requests.some(r => r.path.endsWith("updateMyPreferences"))
    ).toBe(true)
  );
  const mutation = fixture.cache
    .getMutationCache()
    .getAll()
    .find(row => row.state.status === "pending");
  expect(mutation).toBeDefined();
  const session = renderHook(() => useAuth(), { wrapper: fixture.Wrapper });
  await act(async () => session.result.current.logout());
  expect(await screen.findByText("Sign in to continue")).toBeVisible();
  const queryKey = getQueryKey(
    trpc.userPreferences.getMyPreferences,
    undefined,
    "query"
  );
  expect(fixture.cache.getQueryData(queryKey)).toBeUndefined();
  await act(async () =>
    pending.resolve({
      ...savedPreferences(),
      emergencyContact: "Do not restore after logout",
    })
  );
  await waitFor(() => expect(mutation?.state.status).toBe("success"));
  expect(fixture.cache.getQueryData(queryKey)).toBeUndefined();
  expect(
    screen.queryByRole("textbox", { name: "Emergency Contact" })
  ).toBeNull();
});

it("resets edits for a new authenticated identity and ignores the previous owner's outstanding save", async () => {
  let identity = owner;
  let preferences = savedPreferences();
  const pending = deferred<ReturnType<typeof savedPreferences>>();
  const fixture = visit({
    "auth.me": () => identity,
    "userPreferences.getMyPreferences": () => preferences,
    "userPreferences.updateMyPreferences": () => pending.promise,
  });
  const contact = await openPersonalInformation();
  fireEvent.change(contact, { target: { value: "First owner draft" } });
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(
      fixture.requests.some(r => r.path.endsWith("updateMyPreferences"))
    ).toBe(true)
  );
  const mutation = fixture.cache
    .getMutationCache()
    .getAll()
    .find(row => row.state.status === "pending");
  expect(mutation).toBeDefined();
  identity = { ...owner, id: 24, email: "next-owner@example.test" };
  preferences = {
    ...savedPreferences(),
    userId: 24,
    emergencyContact: "Second owner saved",
  };
  await act(async () => {
    await Promise.all([
      fixture.cache.invalidateQueries({ queryKey: getQueryKey(trpc.auth.me) }),
      fixture.cache.invalidateQueries({
        queryKey: getQueryKey(trpc.userPreferences.getMyPreferences),
      }),
    ]);
  });
  expect(await screen.findByText("next-owner@example.test")).toBeVisible();
  expect(contact).toHaveValue("Second owner saved");
  fireEvent.change(contact, { target: { value: "Second owner draft" } });
  await act(async () =>
    pending.resolve({
      ...savedPreferences(),
      emergencyContact: "First owner draft",
    })
  );
  await waitFor(() => expect(mutation?.state.status).toBe("success"));
  expect(contact).toHaveValue("Second owner draft");
  expect(
    fixture.cache.getQueryData(
      getQueryKey(trpc.userPreferences.getMyPreferences, undefined, "query")
    )
  ).toMatchObject({ userId: 24 });
});
