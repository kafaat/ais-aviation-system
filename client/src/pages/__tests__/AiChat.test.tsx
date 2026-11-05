import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import AiChat from "../AiChat";
import en from "@/i18n/locales/en.json";
import ar from "@/i18n/locales/ar.json";
import { passengerRightsSource } from "@shared/passenger-policy";
import { Route, Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";

afterEach(() => vi.unstubAllEnvs());

const current = vi.hoisted(() => ({
  language: "en",
  authenticated: true,
  pending: null as Promise<{
    message: string;
    policySourceLanguage?: "ar" | "en";
    exchangeBookings?: { id: number; bookingReference: string }[];
  }> | null,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const locale = current.language === "en" ? en : ar;
      const [, field] = key.split(".");
      return key.startsWith("aiChat.")
        ? locale.aiChat[field as keyof typeof locale.aiChat]
        : key;
    },
  }),
}));
vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ user: current.authenticated ? { id: 1 } : null }),
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    aiChat: {
      getQuickReplies: { useQuery: () => ({}) },
      startConversation: {
        useMutation: () => ({
          mutateAsync: async () => ({ conversationId: 1, greeting: "Hello" }),
        }),
      },
      sendMessage: {
        useMutation: () => ({
          mutateAsync: async () =>
            current.pending ?? {
              message: "Flight found",
              suggestions: [
                {
                  id: 1,
                  flightId: 99,
                  airline: "Test airline",
                  origin: "RUH",
                  destination: "JED",
                  price: 10049,
                  originTimezone: "Asia/Riyadh",
                  destinationTimezone: "Asia/Riyadh",
                  cabinClass: "economy",
                  departureTime: "2026-11-04T09:00:00Z",
                  arrivalTime: "2026-11-04T11:00:00Z",
                },
              ],
            },
        }),
      },
    },
  },
}));

beforeEach(() => {
  current.authenticated = true;
});

it("takes a guest to sign-in and preserves the AI chat return destination", async () => {
  current.authenticated = false;
  const route = memoryLocation({ path: "/ai-chat", record: true });
  render(
    <Router hook={route.hook}>
      <Route path="/ai-chat">
        <AiChat />
      </Route>
      <Route path="/login">
        <h1>Sign in to continue</h1>
      </Route>
    </Router>
  );
  fireEvent.click(screen.getByRole("link", { name: "common.login" }));
  expect(
    await screen.findByRole("heading", { name: "Sign in to continue" })
  ).toBeVisible();
  expect(route.history.at(-1)).toBe("/login?returnTo=%2Fai-chat");
});

it.each([
  ["en", en.aiChat],
  ["ar", ar.aiChat],
] as const)(
  "discloses AI before and during chat and provides accessible flight links in %s",
  async (language, labels) => {
    current.language = language;
    Element.prototype.scrollIntoView = vi.fn();
    render(<AiChat />);
    expect(screen.getByText(labels.disclaimer)).toBeVisible();
    fireEvent.click(
      screen.getByRole("button", { name: labels.startConversation })
    );
    const log = await screen.findByRole("log", {
      name: labels.conversationLog,
    });
    expect(log).toHaveTextContent("Hello");
    expect(screen.getByText(labels.disclaimer)).toBeVisible();
    fireEvent.change(
      screen.getByRole("textbox", { name: labels.messageLabel }),
      {
        target: { value: "RUH to JED" },
      }
    );
    fireEvent.click(screen.getByRole("button", { name: labels.sendMessage }));
    expect(
      await screen.findByRole("link", { name: /Test airline/ })
    ).toHaveAttribute("href", "/booking/99");
    expect(log).toHaveTextContent("Flight found");
    expect(log).toHaveTextContent("12:00 – 14:00");
    expect(log).toHaveTextContent("100.49");
  }
);

it("discards an old answer after a new conversation starts", async () => {
  const labels = en.aiChat;
  current.language = "en";
  Element.prototype.scrollIntoView = vi.fn();
  let finish!: (value: { message: string }) => void;
  current.pending = new Promise(resolve => {
    finish = resolve;
  });
  render(<AiChat />);
  fireEvent.click(
    screen.getByRole("button", { name: labels.startConversation })
  );
  fireEvent.change(
    await screen.findByRole("textbox", { name: labels.messageLabel }),
    {
      target: { value: "A question about the old booking" },
    }
  );
  fireEvent.click(screen.getByRole("button", { name: labels.sendMessage }));
  fireEvent.click(screen.getByRole("button", { name: labels.newChat }));
  fireEvent.click(
    screen.getByRole("button", { name: labels.startConversation })
  );
  const log = await screen.findByRole("log");
  await act(async () => finish({ message: "Stale response" }));
  current.pending = null;
  expect(log).not.toHaveTextContent("Stale response");
});

it.each([
  "",
  "javascript:alert(1)",
  "http://example.test/help",
  "https://u:p@example.test/help",
])(
  "uses the airline contact fallback when the support URL is unavailable or unsafe (%s)",
  value => {
    current.language = "en";
    vi.stubEnv("VITE_AIRLINE_SUPPORT_URL", value);
    render(<AiChat />);
    expect(screen.getByText(en.aiChat.supportFallback)).toBeVisible();
    expect(
      screen.queryByRole("link", { name: en.aiChat.contactSupport })
    ).toBeNull();
  }
);

it("opens the configured human support channel without forwarding the conversation", () => {
  current.language = "en";
  const url = "https://support.example.test/help";
  vi.stubEnv("VITE_AIRLINE_SUPPORT_URL", url);
  render(<AiChat />);
  const link = screen.getByRole("link", { name: en.aiChat.contactSupport });
  expect(link).toHaveAttribute("href", url);
  expect(link).toHaveAttribute("rel", "noopener noreferrer");
});

it.each([
  ["ar", ar.aiChat],
  ["en", en.aiChat],
] as const)(
  "opens local policy guidance from the %s chat and only links the application source",
  async (language, labels) => {
    current.language = language;
    current.pending = Promise.resolve({
      message: "Claim statement: https://unknown.example",
      policySourceLanguage: language,
    });
    try {
      render(<AiChat />);
      fireEvent.click(
        screen.getByRole("button", { name: labels.startConversation })
      );
      fireEvent.click(
        await screen.findByRole("button", { name: labels.policyHelp })
      );
      const source = await screen.findByRole("link", {
        name: labels.policySource,
      });
      expect(source).toHaveAttribute("href", passengerRightsSource[language]);
      expect(screen.queryByRole("link", { name: /unknown/ })).toBeNull();
    } finally {
      current.pending = null;
    }
  }
);

it.each([
  ["ar", ar.aiChat],
  ["en", en.aiChat],
] as const)(
  "opens the owned booking review from an assistant exchange referral in %s",
  async (language, labels) => {
    current.language = language;
    current.pending = Promise.resolve({
      message: "Review only",
      exchangeBookings: [{ id: 17, bookingReference: "MYBOOK" }],
    });
    try {
      render(<AiChat />);
      fireEvent.click(
        screen.getByRole("button", { name: labels.startConversation })
      );
      fireEvent.click(
        await screen.findByRole("button", { name: labels.exchangeHelp })
      );
      expect(
        await screen.findByRole("link", { name: new RegExp("MYBOOK") })
      ).toHaveAttribute("href", "/my-bookings?exchange=17");
      expect(
        screen.getByRole("link", { name: "myBookings.title" })
      ).toHaveAttribute("href", "/my-bookings");
    } finally {
      current.pending = null;
    }
  }
);
