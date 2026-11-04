import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Router, Route } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { beforeEach, expect, it } from "vitest";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import Notifications from "@/pages/Notifications";
import i18n from "@/i18n/config";
import { createTrpcFixture, deferred } from "@/test/trpc-fixture";

const notification = () => ({
  id: 41,
  userId: 23,
  type: "booking",
  title: "Booking confirmed",
  message: "Your booking is ready.",
  isRead: false,
  createdAt: new Date(),
  readAt: null,
  data: null,
});

type Replies = Parameters<typeof createTrpcFixture>[0];
function visit(replies: Replies = {}) {
  const fixture = createTrpcFixture({
    "auth.me": () => ({ id: 23, email: "owner@example.test", role: "user" }),
    "notifications.list": () => [notification()],
    "notifications.unreadCount": () => ({ count: 1 }),
    ...replies,
  });
  const route = memoryLocation({ path: "/notifications", record: true });
  render(
    <fixture.Wrapper>
      <Router hook={route.hook}>
        <Route path="/notifications">
          <ProtectedRoute>
            <Notifications />
          </ProtectedRoute>
        </Route>
        <Route path="/login">Sign in to continue</Route>
      </Router>
    </fixture.Wrapper>
  );
  return { ...fixture, route };
}

beforeEach(async () => {
  await i18n.changeLanguage("en");
  window.history.replaceState(null, "", "/notifications");
});

it("distinguishes a failed list request from an empty inbox and retries the request", async () => {
  let unavailable = true;
  const fixture = visit({
    "notifications.list": () => {
      if (unavailable) throw new Error("Fixture notifications unavailable");
      return [notification()];
    },
  });
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Could not load your notifications"
  );
  expect(screen.queryByText("No Notifications")).toBeNull();
  unavailable = false;
  await userEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(await screen.findByText("Booking confirmed")).toBeVisible();
  expect(
    fixture.requests.filter(r => r.path === "notifications.list")
  ).toHaveLength(2);
});

it("reports a failed mutation without pretending the unread notification was changed", async () => {
  const fixture = visit({
    "notifications.markAllAsRead": () => {
      throw new Error("Fixture mutation unavailable");
    },
  });
  await screen.findByText("Booking confirmed");
  await userEvent.click(
    screen.getByRole("button", { name: "Mark all as read" })
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Could not update your notifications"
  );
  expect(screen.getByText("Booking confirmed")).toBeVisible();
  expect(screen.getByText("1 unread")).toBeVisible();
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Mark all as read" })
    ).toBeEnabled()
  );
  expect(
    fixture.requests.filter(r => r.path === "notifications.list")
  ).toHaveLength(1);
});

it("waits for authentication and redirects signed-out visitors without querying account notifications", async () => {
  const session = deferred<null>();
  const fixture = visit({ "auth.me": () => session.promise });
  await waitFor(() =>
    expect(fixture.requests.some(r => r.path === "auth.me")).toBe(true)
  );
  expect(fixture.requests.some(r => r.path.startsWith("notifications."))).toBe(
    false
  );
  expect(screen.queryByText("No Notifications")).toBeNull();
  await act(async () => session.resolve(null));
  expect(await screen.findByText("Sign in to continue")).toBeVisible();
  expect(fixture.route.history.at(-1)).toBe("/login?returnTo=%2Fnotifications");
  expect(fixture.requests.some(r => r.path.startsWith("notifications."))).toBe(
    false
  );
});

it("does not show an empty inbox while loading and shows the empty state only after a successful empty response", async () => {
  const pending = deferred<ReturnType<typeof notification>[]>();
  const fixture = visit({
    "notifications.list": () => pending.promise,
    "notifications.unreadCount": () => ({ count: 0 }),
  });
  await waitFor(() =>
    expect(fixture.requests.some(r => r.path === "notifications.list")).toBe(
      true
    )
  );
  expect(screen.queryByText("No Notifications")).toBeNull();
  await act(async () => pending.resolve([]));
  expect(await screen.findByText("No Notifications")).toBeVisible();
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.queryByRole("button", { name: "Delete All" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Mark all as read" })).toBeNull();
});

it("sends selected filters, distinguishes no unread matches, and restores the selected type when showing all", async () => {
  const receipt = {
    ...notification(),
    id: 42,
    type: "payment",
    title: "Payment receipt",
    isRead: true,
  };
  const fixture = visit({
    "notifications.list": input => {
      const { type, unreadOnly } = input as {
        type?: string;
        unreadOnly: boolean;
      };
      return [notification(), receipt].filter(
        row => (!type || row.type === type) && (!unreadOnly || !row.isRead)
      );
    },
  });
  await screen.findByText("Booking confirmed");
  await userEvent.click(
    screen.getByRole("combobox", { name: "Filter by type" })
  );
  await userEvent.click(screen.getByRole("option", { name: "Payment" }));
  await waitFor(() =>
    expect(screen.queryByText("Booking confirmed")).toBeNull()
  );
  expect(await screen.findByText("Payment receipt")).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "Unread Only" }));
  expect(await screen.findByText("No unread notifications")).toBeVisible();
  expect(screen.queryByRole("alert")).toBeNull();
  await userEvent.click(
    screen.getByRole("button", { name: "Show All Notifications" })
  );
  expect(await screen.findByText("Payment receipt")).toBeVisible();
  expect(screen.getByRole("button", { name: "Unread Only" })).toHaveAttribute(
    "aria-pressed",
    "false"
  );
  expect(
    fixture.requests
      .filter(r => r.path === "notifications.list")
      .map(r => r.input)
  ).toEqual([
    { limit: 50, type: undefined, unreadOnly: false },
    { limit: 50, type: "payment", unreadOnly: false },
    { limit: 50, type: "payment", unreadOnly: true },
    { limit: 50, type: "payment", unreadOnly: false },
  ]);
});

it.each([
  { procedure: "markAsRead", label: "Mark Booking confirmed as read" },
  { procedure: "delete", label: "Delete notification: Booking confirmed" },
])(
  "retries $procedure for the selected notification, updates both queries, and does not follow the enclosing link",
  async ({ procedure, label }) => {
    let unavailable = true;
    let rows = [{ ...notification(), data: { link: "/bookings/700" } }];
    const fixture = visit({
      "notifications.list": () => rows,
      "notifications.unreadCount": () => ({
        count: rows.filter(row => !row.isRead).length,
      }),
      [`notifications.${procedure}`]: () => {
        if (unavailable) throw new Error("Fixture action unavailable");
        rows =
          procedure === "delete"
            ? []
            : rows.map(row => ({ ...row, isRead: true }));
        return { success: true };
      },
    });
    await screen.findByText("Booking confirmed");
    await userEvent.click(screen.getByRole("button", { name: label }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not update your notifications"
    );
    expect(screen.getByText("Booking confirmed")).toBeVisible();
    expect(screen.getByText("1 unread")).toBeVisible();
    unavailable = false;
    await userEvent.click(screen.getByRole("button", { name: label }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    await waitFor(() => expect(screen.queryByText("1 unread")).toBeNull());
    if (procedure === "delete") {
      expect(await screen.findByText("No Notifications")).toBeVisible();
    } else {
      expect(screen.getByText("Booking confirmed")).toBeVisible();
      expect(screen.queryByRole("button", { name: label })).toBeNull();
    }
    expect(fixture.route.history).toEqual(["/notifications"]);
    expect(
      fixture.requests.filter(r => r.path === `notifications.${procedure}`)
    ).toEqual([
      { path: `notifications.${procedure}`, input: { id: 41 } },
      { path: `notifications.${procedure}`, input: { id: 41 } },
    ]);
    expect(
      fixture.requests.filter(r => r.path === "notifications.list")
    ).toHaveLength(2);
    expect(
      fixture.requests.filter(r => r.path === "notifications.unreadCount")
    ).toHaveLength(2);
  }
);

it("marks all unread notifications and refreshes the filtered list and unread count", async () => {
  let row = notification();
  const fixture = visit({
    "notifications.list": input =>
      (input as { unreadOnly: boolean }).unreadOnly && row.isRead ? [] : [row],
    "notifications.unreadCount": () => ({ count: row.isRead ? 0 : 1 }),
    "notifications.markAllAsRead": () => {
      row = { ...row, isRead: true };
      return { count: 1 };
    },
  });
  await screen.findByText("Booking confirmed");
  await userEvent.click(screen.getByRole("button", { name: "Unread Only" }));
  await screen.findByText("Booking confirmed");
  await userEvent.click(
    screen.getByRole("button", { name: "Mark all as read" })
  );
  expect(await screen.findByText("No unread notifications")).toBeVisible();
  expect(screen.queryByText("1 unread")).toBeNull();
  expect(
    fixture.requests.filter(r => r.path === "notifications.markAllAsRead")
  ).toHaveLength(1);
  await userEvent.click(
    screen.getByRole("button", { name: "Show All Notifications" })
  );
  expect(await screen.findByText("Booking confirmed")).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "Mark Booking confirmed as read" })
  ).toBeNull();
});

it("requires delete-all confirmation, surfaces a failed deletion, and refreshes after a confirmed retry", async () => {
  let unavailable = true;
  let rows = [notification()];
  const fixture = visit({
    "notifications.list": () => rows,
    "notifications.unreadCount": () => ({ count: rows.length }),
    "notifications.deleteAll": () => {
      if (unavailable) throw new Error("Fixture delete unavailable");
      rows = [];
      return { count: 1 };
    },
  });
  await screen.findByText("Booking confirmed");
  await userEvent.click(screen.getByRole("button", { name: "Delete All" }));
  const cancelled = await screen.findByRole("alertdialog");
  await userEvent.click(
    within(cancelled).getByRole("button", { name: "Cancel" })
  );
  expect(fixture.requests.some(r => r.path === "notifications.deleteAll")).toBe(
    false
  );
  await userEvent.click(screen.getByRole("button", { name: "Delete All" }));
  await userEvent.click(
    within(await screen.findByRole("alertdialog")).getByRole("button", {
      name: "Delete",
    })
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Could not update your notifications"
  );
  expect(screen.getByText("Booking confirmed")).toBeVisible();
  unavailable = false;
  await userEvent.click(screen.getByRole("button", { name: "Delete All" }));
  await userEvent.click(
    within(await screen.findByRole("alertdialog")).getByRole("button", {
      name: "Delete",
    })
  );
  expect(await screen.findByText("No Notifications")).toBeVisible();
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.queryByText("1 unread")).toBeNull();
  expect(
    fixture.requests.filter(r => r.path === "notifications.deleteAll")
  ).toHaveLength(2);
});

it("shows translated mutation feedback in Arabic and retains the notification on failure", async () => {
  await i18n.changeLanguage("ar");
  visit({
    "notifications.markAllAsRead": () => {
      throw new Error("Fixture action unavailable");
    },
  });
  await screen.findByText("Booking confirmed");
  await userEvent.click(
    screen.getByRole("button", { name: "تعليم الكل كمقروء" })
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "تعذّر تحديث إشعاراتك. يرجى إعادة المحاولة."
  );
  expect(screen.getByText("Booking confirmed")).toBeVisible();
});
