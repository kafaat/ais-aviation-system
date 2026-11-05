import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { Route, Router, Switch } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { useAuth } from "@/_core/hooks/useAuth";
import { createTrpcFixture } from "@/test/trpc-fixture";
import i18n from "@/i18n/config";
import { ServiceNavigation } from "../ServiceNavigation";
import { ProtectedRoute } from "../ProtectedRoute";
import { AdminRoute } from "../AdminRoute";
import { SiteFooter } from "../SiteFooter";

type Replies = Parameters<typeof createTrpcFixture>[0];
const user = (role = "user") => ({ id: 23, role, name: "Traveler" });

function AuthProbe() {
  const auth = useAuth();
  return (
    <output data-testid="identity">
      {auth.loading ? "pending" : (auth.user?.role ?? "guest")}
    </output>
  );
}

function visit({
  role = "user",
  replies = {},
  path = "/",
  footer = false,
}: {
  role?: string | null;
  replies?: Replies;
  path?: string;
  footer?: boolean;
} = {}) {
  const fixture = createTrpcFixture({
    "auth.me": () => (role ? user(role) : null),
    "corporate.getMyAccount": () => null,
    "corporate.myInvitations": () => [],
    "notifications.unreadCount": () => ({ count: 0 }),
    "notifications.list": () => [],
    "ibePublic.config": () => ({
      brandName: "Journey Air",
      logoPath: null,
      embedSearchEnabled: false,
    }),
    ...replies,
  });
  const route = memoryLocation({ path, record: true });
  render(
    <fixture.Wrapper>
      <Router hook={route.hook}>
        <AuthProbe />
        <Switch>
          <Route path="/">
            <h1>Travel home</h1>
            {footer ? <SiteFooter /> : <ServiceNavigation />}
          </Route>
          <Route path="/login">
            <h1>Sign in to continue</h1>
          </Route>
          <Route path="/admin">
            <AdminRoute>
              <h1>Admin workspace</h1>
            </AdminRoute>
          </Route>
          {[
            "/notifications",
            "/saved-passengers",
            "/corporate",
            "/airline",
            "/airline/dcs",
          ].map(target => (
            <Route key={target} path={target}>
              <ProtectedRoute>
                <h1>Account destination: {target}</h1>
              </ProtectedRoute>
            </Route>
          ))}
          {[
            "/track-flight",
            "/baggage",
            "/ai-chat",
            "/privacy-policy",
            "/accessibility",
          ].map(target => (
            <Route key={target} path={target}>
              <h1>Public destination: {target}</h1>
            </Route>
          ))}
        </Switch>
      </Router>
    </fixture.Wrapper>
  );
  return { ...fixture, route };
}

async function openServices(role = "user") {
  await waitFor(() =>
    expect(screen.getByTestId("identity")).toHaveTextContent(role)
  );
  await userEvent.click(screen.getByRole("button", { name: "Our Services" }));
}

beforeEach(async () => {
  await i18n.changeLanguage("en");
  window.history.replaceState(null, "", "/");
});

it.each([
  ["Live Flight Tracking", "/track-flight"],
  ["Baggage Tracking", "/baggage"],
  ["AI Booking Assistant", "/ai-chat"],
])("opens the public %s service through the router", async (label, target) => {
  const fixture = visit({ role: null });
  await openServices("guest");
  expect(
    screen.queryByRole("menuitem", { name: "Saved Passengers" })
  ).toBeNull();
  expect(screen.queryByRole("button", { name: "Notifications" })).toBeNull();
  await userEvent.click(screen.getByRole("menuitem", { name: label }));
  expect(
    await screen.findByRole("heading", {
      name: `Public destination: ${target}`,
    })
  ).toBeVisible();
  expect(fixture.route.history.at(-1)).toBe(target);
  expect(
    fixture.requests.some(r => /^(corporate|notifications)\./.test(r.path))
  ).toBe(false);
});

it.each([
  ["Saved Passengers", "/saved-passengers"],
  ["Notifications", "/notifications"],
])(
  "opens the signed-in %s page behind its existing guard",
  async (label, target) => {
    const fixture = visit();
    await openServices();
    await userEvent.click(screen.getByRole("menuitem", { name: label }));
    expect(
      await screen.findByRole("heading", {
        name: `Account destination: ${target}`,
      })
    ).toBeVisible();
    expect(fixture.route.history.at(-1)).toBe(target);
  }
);

it.each(["/saved-passengers", "/notifications", "/corporate"])(
  "keeps direct guest access to %s behind sign-in",
  async path => {
    const fixture = visit({ role: null, path });
    expect(
      await screen.findByRole("heading", { name: "Sign in to continue" })
    ).toBeVisible();
    expect(fixture.route.history.at(-1)).toBe(
      `/login?returnTo=${encodeURIComponent(path)}`
    );
  }
);

it.each(["user", "ops", "finance", "airline_admin"])(
  "does not expose or unlock platform administration for %s",
  async role => {
    const fixture = visit({ role, path: "/admin" });
    expect(
      await screen.findByRole("heading", { name: "Travel home" })
    ).toBeVisible();
    await openServices(role);
    expect(screen.queryByRole("menuitem", { name: "Dashboard" })).toBeNull();
    expect(fixture.route.history.at(-1)).toBe("/");
  }
);

it.each(["admin", "super_admin"])(
  "opens platform administration for %s",
  async role => {
    const fixture = visit({ role });
    await openServices(role);
    await userEvent.click(screen.getByRole("menuitem", { name: "Dashboard" }));
    expect(
      await screen.findByRole("heading", { name: "Admin workspace" })
    ).toBeVisible();
    expect(fixture.route.history.at(-1)).toBe("/admin");
  }
);

it.each([
  ["ops", "Departure desk", "/airline/dcs"],
  ["airline_admin", "Airline console", "/airline"],
  ["finance", "Airline console", "/airline"],
])("opens the permitted workspace for %s", async (role, label, target) => {
  const fixture = visit({ role });
  await openServices(role);
  if (role === "finance") {
    expect(
      screen.queryByRole("menuitem", { name: "Departure desk" })
    ).toBeNull();
  }
  await userEvent.click(screen.getByRole("menuitem", { name: label }));
  expect(
    await screen.findByRole("heading", {
      name: `Account destination: ${target}`,
    })
  ).toBeVisible();
  expect(fixture.route.history.at(-1)).toBe(target);
});

it("does not offer staff workspaces to an ordinary traveler", async () => {
  visit();
  await openServices();
  expect(
    screen.queryByRole("menuitem", { name: "Airline console" })
  ).toBeNull();
  expect(screen.queryByRole("menuitem", { name: "Departure desk" })).toBeNull();
});

it.each(["user", "admin"])(
  "requires an actual corporate entitlement even for %s",
  async role => {
    const fixture = visit({ role });
    await openServices(role);
    await waitFor(() =>
      expect(
        fixture.requests.some(r => r.path === "corporate.myInvitations")
      ).toBe(true)
    );
    expect(
      screen.queryByRole("menuitem", { name: "Corporate Travel" })
    ).toBeNull();
  }
);

it.each(["membership", "invitation"])(
  "opens the corporate workspace for an actual %s",
  async entitlement => {
    const fixture = visit({
      replies:
        entitlement === "membership"
          ? {
              "corporate.getMyAccount": () => ({
                id: 7,
                status: "active",
                role: "traveler",
              }),
            }
          : {
              "corporate.myInvitations": () => [
                { id: "invitation-1", companyName: "Test company" },
              ],
            },
    });
    await openServices();
    await userEvent.click(
      await screen.findByRole("menuitem", { name: "Corporate Travel" })
    );
    expect(
      await screen.findByRole("heading", {
        name: "Account destination: /corporate",
      })
    ).toBeVisible();
    expect(fixture.route.history.at(-1)).toBe("/corporate");
  }
);

it("does not infer corporate access when entitlement reads fail", async () => {
  const unavailable = () => {
    throw new Error("Unavailable");
  };
  const fixture = visit({
    replies: {
      "corporate.getMyAccount": unavailable,
      "corporate.myInvitations": unavailable,
    },
  });
  await openServices();
  await waitFor(() =>
    expect(
      fixture.requests.filter(r => r.path.startsWith("corporate."))
    ).toHaveLength(2)
  );
  expect(
    screen.queryByRole("menuitem", { name: "Corporate Travel" })
  ).toBeNull();
});

it("opens the full inbox from the notification bell even when the inbox is empty", async () => {
  const fixture = visit();
  await userEvent.click(
    await screen.findByRole("button", { name: "Notifications" })
  );
  expect(await screen.findByText("No Notifications")).toBeVisible();
  await userEvent.click(
    screen.getByRole("link", { name: "View all notifications" })
  );
  expect(
    await screen.findByRole("heading", {
      name: "Account destination: /notifications",
    })
  ).toBeVisible();
  expect(fixture.route.history.at(-1)).toBe("/notifications");
});

it("keeps the inbox link and offers a real retry after a notification read fails", async () => {
  let fail = true;
  const fixture = visit({
    replies: {
      "notifications.list": () => {
        if (fail) throw new Error("Unavailable");
        return [];
      },
    },
  });
  await userEvent.click(
    await screen.findByRole("button", { name: "Notifications" })
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Could not load your notifications"
  );
  expect(screen.queryByText("No Notifications")).toBeNull();
  expect(
    screen.getByRole("link", { name: "View all notifications" })
  ).toBeVisible();
  fail = false;
  await userEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(await screen.findByText("No Notifications")).toBeVisible();
  expect(
    fixture.requests.filter(r => r.path === "notifications.list")
  ).toHaveLength(2);
});

it("deletes a linked notification without following its destination or marking it read", async () => {
  const remove = vi.fn(() => ({ success: true }));
  const fixture = visit({
    replies: {
      "notifications.list": () => [
        {
          id: 41,
          type: "system",
          title: "Company invitation",
          message: "Review your invitation",
          isRead: false,
          createdAt: new Date(),
          data: { link: "/corporate" },
        },
      ],
      "notifications.delete": remove,
    },
  });
  await userEvent.click(
    await screen.findByRole("button", { name: "Notifications" })
  );
  await userEvent.click(
    await screen.findByRole("button", {
      name: "Delete notification: Company invitation",
    })
  );
  await waitFor(() => expect(remove).toHaveBeenCalledWith({ id: 41 }));
  expect(fixture.route.history.at(-1)).toBe("/");
  expect(
    fixture.requests.some(r => r.path === "notifications.markAsRead")
  ).toBe(false);
});

it.each([
  ["Privacy Policy", "/privacy-policy"],
  ["Accessibility statement", "/accessibility"],
])(
  "keeps the footer %s route and removes misleading home placeholders",
  async (label, target) => {
    const fixture = visit({ role: null, footer: true });
    for (const name of ["About Us", "Contact Us", "Terms & Conditions"]) {
      expect(screen.queryByRole("link", { name })).toBeNull();
    }
    await userEvent.click(screen.getByRole("link", { name: label }));
    expect(
      await screen.findByRole("heading", {
        name: `Public destination: ${target}`,
      })
    ).toBeVisible();
    expect(fixture.route.history.at(-1)).toBe(target);
  }
);
