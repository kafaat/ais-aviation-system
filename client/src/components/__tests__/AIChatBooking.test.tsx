import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import AIChatBooking from "../AIChatBooking";
import en from "@/i18n/locales/en.json";
import ar from "@/i18n/locales/ar.json";
import { QueryClient } from "@tanstack/react-query";

const feedback = {
  sendBusy:
    "This conversation was busy with another reply. Your message was not sent.",
  sendTimedOut: "This message was not sent before the request time limit.",
  sendLimited: "This message was not sent because a chat limit was reached.",
  replyUnavailable:
    "Your message was accepted, but this reply is no longer available. Refresh the conversation to see saved messages.",
  sendUnknown:
    "We could not confirm the result of this message. It may have been saved. Refresh the conversation before sending it again.",
  refreshHistory: "Refresh conversation",
  refreshFailed:
    "Could not refresh the conversation. Your draft and current messages have been kept.",
  restoreDraft: "Use this draft",
  notSent: "Not sent",
  closeChat: "Close chat",
};
const busyArabic = "كانت هذه المحادثة تُعالج طلبًا آخر. لم تُرسل رسالتك.";

const current = vi.hoisted(() => ({
  language: "en",
  start: vi.fn(),
  send: vi.fn(),
  select: vi.fn(),
  history: vi.fn(),
  queryClient: null as QueryClient | null,
  errorToast: vi.fn(),
  successToast: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    i18n: { language: current.language },
    t: (key: string) => {
      let value: unknown = current.language === "ar" ? ar : en;
      for (const part of key.split(".")) {
        if (typeof value !== "object" || value === null) return key;
        value = (value as Record<string, unknown>)[part];
      }
      return typeof value === "string" ? value : key;
    },
  }),
}));
vi.mock("sonner", () => ({
  toast: { error: current.errorToast, success: current.successToast },
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      client: { aiChat: { getHistory: { query: current.history } } },
      aiChat: {
        getHistory: {
          fetch: (input: { conversationId: number }) => {
            if (!current.queryClient) throw new Error("Query client missing");
            return current.queryClient.fetchQuery({
              queryKey: [["aiChat", "getHistory"], { input, type: "query" }],
              queryFn: () => current.history(input),
            });
          },
        },
      },
    }),
    aiChat: {
      startConversation: {
        useMutation: () => ({ mutateAsync: current.start }),
      },
      sendMessage: { useMutation: () => ({ mutateAsync: current.send }) },
      selectSuggestion: {
        useMutation: () => ({ mutateAsync: current.select }),
      },
    },
  },
}));

beforeEach(() => {
  current.queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  current.language = "en";
  current.start
    .mockReset()
    .mockResolvedValue({ conversationId: 1, greeting: "Hello" });
  current.send.mockReset().mockResolvedValue({ message: "Saved answer" });
  current.select
    .mockReset()
    .mockResolvedValue({ flightId: 99, cabinClass: "economy" });
  current.history.mockReset().mockResolvedValue([]);
  current.errorToast.mockReset();
  current.successToast.mockReset();
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => current.queryClient?.clear());

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function chatError(code: string) {
  return Object.assign(new Error("Synthetic chat failure"), { data: { code } });
}

function historyRow(id: number, role: "user" | "assistant", content: string) {
  return {
    id,
    conversationId: 1,
    role,
    content,
    metadata: null,
    tokensUsed: null,
    processingTimeMs: null,
    createdAt: new Date("2031-09-12T12:00:00Z"),
  };
}

async function openChat(locale = en) {
  render(<AIChatBooking />);
  fireEvent.click(screen.getByRole("button"));
  return screen.findByPlaceholderText(locale.chat.placeholder);
}

function submit(input: HTMLElement, text: string) {
  fireEvent.change(input, { target: { value: text } });
  fireEvent.keyPress(input, { key: "Enter", code: "Enter", charCode: 13 });
}

it.each([
  ["en", en],
  ["ar", ar],
] as const)(
  "restores an unaccepted booking-widget draft and explains busy admission in %s",
  async (language, locale) => {
    current.language = language;
    current.send.mockRejectedValue(chatError("CONFLICT"));
    const input = await openChat(locale);
    submit(input, "  My rejected draft  ");
    await waitFor(() => expect(input).toHaveValue("  My rejected draft  "));
    expect(screen.queryByText("My rejected draft")).toBeNull();
    expect(screen.getByText("Hello")).toBeVisible();
    expect(
      screen.getByText(language === "ar" ? busyArabic : feedback.sendBusy)
    ).toBeVisible();
    expect(current.send).toHaveBeenCalledTimes(1);
    expect(current.errorToast).not.toHaveBeenCalled();
  }
);

it.each([
  ["TIMEOUT", "sendTimedOut"],
  ["TOO_MANY_REQUESTS", "sendLimited"],
] as const)(
  "restores an unaccepted booking-widget draft on typed %s",
  async (code, label) => {
    current.send.mockRejectedValue(chatError(code));
    const input = await openChat();
    submit(input, "Limited draft");
    await waitFor(() => expect(input).toHaveValue("Limited draft"));
    expect(screen.getByText(feedback[label])).toBeVisible();
    expect(
      screen.getByRole("button", { name: feedback.refreshHistory })
    ).toBeEnabled();
    expect(current.send).toHaveBeenCalledTimes(1);
  }
);

it("retains an accepted stale widget turn while reconciling saved history", async () => {
  const history = deferred<ReturnType<typeof historyRow>[]>();
  current.send.mockRejectedValue(chatError("PRECONDITION_FAILED"));
  current.history.mockReturnValue(history.promise);
  const input = await openChat();
  submit(input, "Accepted widget question");
  await waitFor(() =>
    expect(current.history).toHaveBeenCalledExactlyOnceWith({
      conversationId: 1,
    })
  );
  expect(input).toHaveValue("");
  expect(screen.getByText("Accepted widget question")).toBeVisible();
  expect(screen.getByText(feedback.replyUnavailable)).toBeVisible();
  await act(async () =>
    history.resolve([
      historyRow(1, "user", "Accepted widget question"),
      historyRow(2, "assistant", "Recovered widget answer"),
    ])
  );
  expect(screen.getAllByText("Accepted widget question")).toHaveLength(1);
  expect(screen.getByText("Recovered widget answer")).toBeVisible();
  expect(input).toHaveValue("");
  expect(current.send).toHaveBeenCalledTimes(1);
  expect(current.errorToast).not.toHaveBeenCalled();
});

it("retains unknown widget delivery and retries only a failed history read", async () => {
  current.send.mockRejectedValue(
    Object.assign(new Error("TIMEOUT"), { data: { httpStatus: 504 } })
  );
  current.history
    .mockRejectedValueOnce(new Error("Read failed"))
    .mockResolvedValueOnce([
      historyRow(1, "user", "Maybe saved"),
      historyRow(2, "assistant", "Saved eventually"),
    ]);
  const input = await openChat();
  submit(input, "Maybe saved");
  expect(await screen.findByText(feedback.sendUnknown)).toBeVisible();
  expect(input).toHaveValue("");
  expect(screen.getByText("Maybe saved")).toBeVisible();
  fireEvent.click(
    screen.getByRole("button", { name: feedback.refreshHistory })
  );
  expect(await screen.findByText(feedback.refreshFailed)).toBeVisible();
  fireEvent.change(input, { target: { value: "Newer draft" } });
  fireEvent.click(
    screen.getByRole("button", { name: feedback.refreshHistory })
  );
  expect(await screen.findByText("Saved eventually")).toBeVisible();
  expect(input).toHaveValue("Newer draft");
  expect(current.send).toHaveBeenCalledTimes(1);
  expect(current.history).toHaveBeenCalledTimes(2);
});

it("does not let a late widget history read replace a newer question", async () => {
  const history = deferred<ReturnType<typeof historyRow>[]>();
  const second = deferred<{ message: string }>();
  current.send
    .mockRejectedValueOnce(chatError("PRECONDITION_FAILED"))
    .mockReturnValueOnce(second.promise);
  current.history.mockReturnValue(history.promise);
  const input = await openChat();
  submit(input, "Older question");
  await waitFor(() => expect(current.history).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(input).toBeEnabled());
  submit(input, "Newer widget question");
  await act(async () =>
    history.resolve([historyRow(1, "assistant", "Old widget snapshot")])
  );
  expect(screen.getByText("Newer widget question")).toBeVisible();
  expect(screen.queryByText("Old widget snapshot")).toBeNull();
  expect(input).toBeDisabled();
  await act(async () => second.resolve({ message: "Newer widget answer" }));
  expect(screen.getByText("Newer widget answer")).toBeVisible();
});

it("issues a fresh widget history read after a newer accepted turn instead of reusing a cached in-flight snapshot", async () => {
  const oldHistory = deferred<ReturnType<typeof historyRow>[]>();
  const freshHistory = deferred<ReturnType<typeof historyRow>[]>();
  current.history
    .mockReturnValueOnce(oldHistory.promise)
    .mockReturnValueOnce(freshHistory.promise);
  current.send.mockRejectedValue(chatError("PRECONDITION_FAILED"));
  const input = await openChat();
  submit(input, "First accepted widget question");
  await waitFor(() => expect(current.history).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(input).toBeEnabled());

  submit(input, "Second accepted widget question");
  await waitFor(() => expect(current.send).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(input).toBeEnabled());
  fireEvent.change(input, { target: { value: "Separate widget draft" } });
  await act(async () =>
    oldHistory.resolve([
      historyRow(1, "assistant", "Hello"),
      historyRow(2, "user", "First accepted widget question"),
    ])
  );

  expect(screen.getByRole("log")).toHaveTextContent(
    "Second accepted widget question"
  );
  expect(current.history).toHaveBeenCalledTimes(2);
  expect(input).toHaveValue("Separate widget draft");
  await act(async () =>
    freshHistory.resolve([
      historyRow(1, "assistant", "Hello"),
      historyRow(2, "user", "First accepted widget question"),
      historyRow(3, "assistant", "First saved widget reply"),
      historyRow(4, "user", "Second accepted widget question"),
      historyRow(5, "assistant", "Second saved widget reply"),
    ])
  );
  expect(screen.getByRole("log")).toHaveTextContent(
    "Second saved widget reply"
  );
  expect(current.send).toHaveBeenCalledTimes(2);
  expect(input).toHaveValue("Separate widget draft");
});

it("does not let a closed widget's old response or finally mutate a reopened conversation", async () => {
  const first = deferred<{ message: string }>();
  const second = deferred<{ message: string }>();
  current.send
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(second.promise);
  const input = await openChat();
  submit(input, "Old widget question");
  fireEvent.click(screen.getByRole("button", { name: feedback.closeChat }));
  current.start.mockResolvedValue({
    conversationId: 2,
    greeting: "Fresh widget greeting",
  });
  fireEvent.click(
    screen.getByRole("button", { name: en.aiChat.startConversation })
  );
  await screen.findByText("Fresh widget greeting");
  const nextInput = screen.getByPlaceholderText(en.chat.placeholder);
  submit(nextInput, "Fresh widget question");
  await act(async () => first.resolve({ message: "Old hidden answer" }));
  expect(nextInput).toBeDisabled();
  expect(screen.queryByText("Old hidden answer")).toBeNull();
  await act(async () => second.resolve({ message: "Fresh widget answer" }));
  expect(nextInput).toBeEnabled();
  expect(screen.getByText("Fresh widget answer")).toBeVisible();
});

it("does not dispatch flight selection while a widget send is pending", async () => {
  const pending = deferred<{ message: string }>();
  current.send
    .mockResolvedValueOnce({
      message: "Choose this flight",
      suggestions: [
        {
          id: 7,
          flightId: 99,
          airline: "Test airline",
          origin: "RUH",
          destination: "JED",
          originTimezone: "Asia/Riyadh",
          destinationTimezone: "Asia/Riyadh",
          departureTime: "2031-09-12T12:00:00Z",
          arrivalTime: "2031-09-12T14:00:00Z",
          price: 10000,
          cabinClass: "economy",
        },
      ],
    })
    .mockReturnValueOnce(pending.promise);
  const input = await openChat();
  submit(input, "Find a flight");
  await screen.findByText("Test airline");
  submit(input, "Compare that flight");
  fireEvent.click(screen.getByText("Test airline"));
  expect(current.select).not.toHaveBeenCalled();
  expect(input).toBeDisabled();
  await act(async () => pending.resolve({ message: "Comparison complete" }));
  expect(input).toBeEnabled();
});
