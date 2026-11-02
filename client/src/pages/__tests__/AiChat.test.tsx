import { afterEach, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import AiChat from "../AiChat";
import en from "@/i18n/locales/en.json";
import ar from "@/i18n/locales/ar.json";

afterEach(() => vi.unstubAllEnvs());

const current = vi.hoisted(() => ({
  language: "en",
  pending: null as Promise<{ message: string }> | null,
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
  useAuth: () => ({ user: { id: 1 } }),
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
                  price: 10000,
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
